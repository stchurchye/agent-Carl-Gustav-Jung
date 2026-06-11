import { activityText, formatElapsed } from '../agent/runActivityText';
import { isTerminalRunStatus } from '../agent/types';
import type { AgentRun, AgentStep } from '../agent/types';

export type StageBubbleTone = 'normal' | 'attention' | 'error' | 'muted';

export type StageAgentLine = {
  text: string;
  tone: StageBubbleTone;
  /** 狗头顶「!」角标:等你点头/等你回答 */
  badge?: 'attention';
};

const ARTIFACT_PREVIEW_LEN = 120;

export type RunStageTextOpts = {
  nowMs: number;
  /** runStore 404/403 永久缺失态 */
  missing?: boolean;
  selfUserId?: string;
  /** ask_user 等的是别人时,显示对方名字 */
  targetUserName?: string;
};

/** run 状态 → 舞台上狗的台词。完整步骤/todo/授权按钮在历史浮层的 AgentRunCard 里。 */
export function runStageText(
  run: AgentRun | null,
  steps: AgentStep[],
  opts: RunStageTextOpts,
): StageAgentLine {
  if (opts.missing) return { text: '汪…这个任务已经不在了', tone: 'muted' };
  if (!run) return { text: '正在找任务…', tone: 'muted' };

  switch (run.status) {
    case 'queued':
      return {
        text: `排队中 · 第 ${run.queuePosition ?? '?'} 位,轮到我就开干`,
        tone: 'muted',
      };
    case 'awaiting_approval':
      return {
        text: `想用 ${run.pendingApprovalToolName ?? '一个工具'},等你点头(点我授权)`,
        tone: 'attention',
        badge: 'attention',
      };
    case 'awaiting_user_input': {
      const target = run.askUserTargetUserId ?? null;
      if (target && opts.selfUserId && target !== opts.selfUserId) {
        return { text: `在等 ${opts.targetUserName ?? 'TA'} 回答…`, tone: 'muted' };
      }
      const q = run.pendingUserPrompt?.trim() || '有个问题想问你';
      const text = q.length > 56 ? `${q.slice(0, 56)}…` : q;
      return { text: `${text}(点我回答)`, tone: 'attention', badge: 'attention' };
    }
    case 'failed':
      return { text: '汪呜…任务没成功,点我看哪里出了问题', tone: 'error' };
    case 'cancelled':
      return { text: '好的,这个任务不做了', tone: 'muted' };
    case 'budget_exhausted':
      return { text: '预算用完了,先停在这儿;点我看已完成的部分', tone: 'muted' };
    case 'completed': {
      const content = run.artifact?.finalContent?.trim();
      if (!content) return { text: '搞定啦!点我看结果', tone: 'normal' };
      const preview =
        content.length > ARTIFACT_PREVIEW_LEN
          ? `${content.slice(0, ARTIFACT_PREVIEW_LEN)}…`
          : content;
      return { text: `${preview}\n(点我看全文)`, tone: 'normal' };
    }
    default: {
      if (isTerminalRunStatus(run.status)) return { text: '任务结束了,点我看详情', tone: 'muted' };
      return {
        text: `${activityText(run, steps)} · ${formatElapsed(run.createdAt, opts.nowMs)}`,
        tone: 'normal',
      };
    }
  }
}
