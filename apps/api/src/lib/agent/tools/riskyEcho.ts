import { toolRegistry, type ToolDef } from '../toolRegistry.js';

type RiskyEchoInput = {
  text: string;
  sleepMs?: number;
};

type RiskyEchoOutput = {
  text: string;
  sleptMs: number;
};

/**
 * 测试用工具：approvalMode='ask' + costHint='medium'，用于覆盖 M1b-2 approval 流程。
 * 行为与 echoSleep 一致（睡眠后回显），不调外部服务。
 */
export const riskyEchoTool: ToolDef<RiskyEchoInput, RiskyEchoOutput> = {
  name: 'risky_echo',
  description: '需要用户确认的 echo,用于测试 approval 流程',
  inputSchema: {
    type: 'object',
    required: ['text'],
    properties: {
      text: { type: 'string' },
      sleepMs: { type: 'number', minimum: 0, maximum: 30_000 },
    },
  },
  approvalMode: 'ask',
  costHint: 'medium',
  hasSideEffects: true,
  idempotent: false,
  async handler(input, ctx) {
    const ms = Math.max(0, Math.min(input.sleepMs ?? 500, 30_000));
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, ms);
      ctx.signal.addEventListener(
        'abort',
        () => {
          clearTimeout(t);
          reject(new Error('aborted'));
        },
        { once: true },
      );
    });
    return { text: input.text, sleptMs: ms };
  },
};

export function registerRiskyEcho(): void {
  if (!toolRegistry.get(riskyEchoTool.name)) {
    toolRegistry.register(riskyEchoTool);
  }
}
