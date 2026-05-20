import type { MemoryCategory, MemoryIntentSlots, MemoryScope } from '@xzz/shared';
import * as intel from '../store/pg-intelligence.js';
import { assertMemoryScopeAccess } from './memoryScopeAuth.js';
import { memoryTitleFromContent } from './memoryText.js';
import { consolidateUserMemoriesIfNeeded } from './memoryConsolidate.js';

export type MemoryApplyContext = {
  userId: string;
  sessionId?: string;
  groupId?: string;
  topicId?: string;
  apiKey?: string;
};

function resolveScope(
  slots: MemoryIntentSlots,
  ctx: MemoryApplyContext,
): {
  scope: MemoryScope;
  groupId: string | null;
  topicId: string | null;
  sessionId: string | null;
} {
  const scope = slots.explicitGlobal
    ? 'user'
    : (slots.scope ??
      (ctx.topicId ? 'topic' : ctx.sessionId ? 'session' : 'user'));

  return {
    scope,
    groupId: scope === 'topic' ? (ctx.groupId ?? null) : null,
    topicId: scope === 'topic' ? (ctx.topicId ?? null) : null,
    sessionId: scope === 'session' ? (ctx.sessionId ?? null) : null,
  };
}

function inferCategory(content: string, explicit?: MemoryCategory): MemoryCategory {
  if (explicit && explicit !== 'general') return explicit;
  if (/称呼|语气|偏好|习惯|时区|叫我|说话|温柔|简洁/.test(content)) {
    return 'user_profile';
  }
  if (/项目|代码|仓库|技术栈|API|部署|测试|工作流/.test(content)) {
    return 'project_note';
  }
  return 'general';
}

export async function applyMemoryIntent(
  kind: 'memory_remember' | 'memory_correct' | 'memory_forget',
  slots: MemoryIntentSlots,
  ctx: MemoryApplyContext,
): Promise<{ confirmation: string; fragmentId?: string }> {
  const content = slots.content?.trim() ?? '';
  if (kind !== 'memory_forget' && !content) {
    throw new Error('MEMORY_CONTENT_REQUIRED');
  }

  const { scope, groupId, topicId, sessionId } = resolveScope(slots, ctx);
  await assertMemoryScopeAccess(ctx.userId, scope, {
    groupId,
    topicId,
    sessionId,
  });

  if (kind === 'memory_remember') {
    const category = inferCategory(content, slots.category);
    if (scope === 'user' && ctx.apiKey) {
      await consolidateUserMemoriesIfNeeded(ctx.apiKey, ctx.userId, content.length, {
        userId: ctx.userId,
        channel: 'memory_extract',
        sessionId: ctx.sessionId,
        groupId: ctx.groupId,
        topicId: ctx.topicId,
      });
    }
    const title = memoryTitleFromContent(content);
    const { fragment } = await intel.createMemoryFragment({
      userId: ctx.userId,
      scope,
      groupId,
      topicId,
      sessionId,
      title,
      content,
      category,
      source: 'user',
    });
    await intel.logMemoryUsage({
      userId: ctx.userId,
      fragmentId: fragment.id,
      versionId: fragment.currentVersionId ?? undefined,
      payload: { action: 'remember', scope, category },
    });
    const scopeLabel =
      scope === 'user' ? '全局' : scope === 'topic' ? '本话题' : '本会话';
    return {
      confirmation: `已记住（${scopeLabel}）：${content}`,
      fragmentId: fragment.id,
    };
  }

  const targetId = slots.targetFragmentId;
  if (!targetId) throw new Error('MEMORY_TARGET_REQUIRED');

  if (kind === 'memory_correct') {
    const { fragment } = await intel.appendMemoryVersion({
      userId: ctx.userId,
      fragmentId: targetId,
      content,
      source: 'user',
    });
    await intel.logMemoryUsage({
      userId: ctx.userId,
      fragmentId: fragment.id,
      versionId: fragment.currentVersionId ?? undefined,
      payload: { action: 'correct' },
    });
    return {
      confirmation: `已修正记忆：${content}`,
      fragmentId: fragment.id,
    };
  }

  const updated = await intel.setMemoryFragmentStatus(
    ctx.userId,
    targetId,
    'suppressed',
  );
  if (!updated) throw new Error('MEMORY_NOT_FOUND');
  await intel.logMemoryUsage({
    userId: ctx.userId,
    fragmentId: targetId,
    payload: { action: 'forget' },
  });
  return {
    confirmation: '好的，这条记忆以后不会再提起。',
    fragmentId: targetId,
  };
}

export async function confirmPendingMemory(
  userId: string,
  fragmentId: string,
  apiKey?: string,
): Promise<{ confirmation: string; fragmentId: string }> {
  const fragment = await intel.getMemoryFragment(userId, fragmentId);
  if (!fragment || fragment.status !== 'pending') {
    throw new Error('MEMORY_NOT_FOUND');
  }
  if (fragment.scope === 'user' && apiKey && fragment.content) {
    await consolidateUserMemoriesIfNeeded(apiKey, userId, fragment.content.length, {
      userId,
      channel: 'memory_extract',
    });
  }
  const updated = await intel.setMemoryFragmentStatus(userId, fragmentId, 'active');
  if (!updated) throw new Error('MEMORY_NOT_FOUND');
  await intel.dismissMemoryReview(userId, fragmentId);
  return {
    confirmation: `已确认记住：${fragment.content ?? ''}`,
    fragmentId,
  };
}
