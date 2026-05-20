import type { IntentAnalyzeResult, IntentKind } from '@xzz/shared';
import { pickTaskProfile } from '@xzz/shared';

const URL_RE = /https?:\/\/\S+/i;

export function analyzeIntent(input: {
  text: string;
  scope: 'private' | 'group';
  hasAttachments: boolean;
}): IntentAnalyzeResult {
  const text = input.text.trim();
  const candidates: IntentAnalyzeResult['candidates'] = [];

  if (URL_RE.test(text) && !input.hasAttachments) {
    candidates.push({
      kind: 'magi_content_link',
      label: '处理链接（视频/摘要）',
      confidence: 0.85,
    });
  }
  if (/记住|记下|保存到记忆|别忘了|要记得/.test(text)) {
    candidates.push({
      kind: 'memory_remember',
      label: '记住',
      confidence: 0.88,
    });
  }
  if (/记错了|不对|应该是|你记错/.test(text)) {
    candidates.push({
      kind: 'memory_correct',
      label: '修正记忆',
      confidence: 0.9,
    });
  }
  if (/别再说|不要再提|忘掉|别提了/.test(text)) {
    candidates.push({
      kind: 'memory_forget',
      label: '不再提起',
      confidence: 0.9,
    });
  }
  if (/压缩|compact|整理上下文/i.test(text)) {
    candidates.push({
      kind: 'context_compact',
      label: '压缩上下文',
      confidence: 0.75,
    });
  }
  if (/问.*知识库|magi/i.test(text)) {
    candidates.push({
      kind: 'magi_system_query',
      label: '查询 MAGI 知识库',
      confidence: 0.7,
    });
  }

  const defaultKind: IntentKind =
    input.scope === 'group' ? 'chat_group_llm' : 'chat_private_llm';

  candidates.push({
    kind: defaultKind,
    label: input.scope === 'group' ? '请 AI 回复（群聊）' : '和小助手聊聊',
    confidence: 0.6,
  });

  if (input.scope === 'group' && !input.hasAttachments) {
    candidates.push({
      kind: 'human_group_message',
      label: '仅发送群消息（不请 AI）',
      confidence: 0.55,
    });
  }

  candidates.sort((a, b) => b.confidence - a.confidence);

  const sliced = candidates.slice(0, 4);
  const top = sliced[0];
  const second = sliced[1];
  const autoExecute =
    top &&
    top.kind !== 'memory_correct' &&
    top.kind !== 'memory_forget' &&
    top.confidence >= 0.82 &&
    (!second || top.confidence - second.confidence >= 0.15);

  return {
    candidates: sliced,
    suggested: top?.kind ?? defaultKind,
    autoExecute: Boolean(autoExecute),
  };
}

export function taskProfileForIntent(
  kind: IntentKind,
  hasAttachments: boolean,
) {
  return pickTaskProfile({ hasAttachments, intentKind: kind });
}
