import type { AgentRun, AgentStep } from './types';

/**
 * 「正在做什么」一句话(从 AgentRunActivityLine 抽出的纯函数):
 * 聊天卡活动行与舞台模式狗台词共用,改文案只动这里。
 */
export function activityText(run: AgentRun, steps: AgentStep[]): string {
  switch (run.status) {
    case 'planning':
      return '正在规划';
    case 'replanning':
      return '正在重新规划';
    case 'awaiting_approval':
      return '等待你授权';
    case 'awaiting_user_input':
      return '等待你的回答';
    default: {
      const last = steps[steps.length - 1];
      if (last?.kind === 'tool_call' && last.toolName) return `正在调用 ${last.toolName}`;
      if (last?.kind === 'observe') return '正在整理结果';
      if (last?.kind === 'reply') return '正在撰写回复';
      return '正在执行';
    }
  }
}

/** mm:ss;now 注入便于测试(组件层传 Date.now()) */
export function formatElapsed(fromIso: string, nowMs: number = Date.now()): string {
  const ms = Math.max(0, nowMs - new Date(fromIso).getTime());
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
