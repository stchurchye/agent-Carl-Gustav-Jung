import { toolRegistry, type ToolDef } from '../toolRegistry.js';

type EchoSleepInput = {
  text: string;
  sleepMs?: number;
};

type EchoSleepOutput = {
  ok: boolean;
  text: string;
  sleptMs: number;
};

export const echoSleepTool: ToolDef<EchoSleepInput, EchoSleepOutput> = {
  name: 'echo_after_sleep',
  description: '在 sleepMs 毫秒后回显 text；用于测试 agent runtime，不调外部服务。',
  inputSchema: {
    type: 'object',
    required: ['text'],
    properties: {
      text: { type: 'string' },
      sleepMs: { type: 'number', minimum: 0, maximum: 30_000 },
    },
  },
  approvalMode: 'auto',
  costHint: 'low',
  hasSideEffects: false,
  idempotent: true,
  replyMeta: { summaryKind: 'silent' },
  async handler(input, ctx) {
    const ms = Math.max(0, Math.min(input.sleepMs ?? 1000, 30_000));
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
    return { ok: true, text: input.text, sleptMs: ms };
  },
};

export function registerEchoSleep(): void {
  if (!toolRegistry.get(echoSleepTool.name)) {
    toolRegistry.register(echoSleepTool);
  }
}
