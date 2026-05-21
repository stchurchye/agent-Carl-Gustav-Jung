import { toolRegistry, type ToolDef } from '../toolRegistry.js';

type DatetimeNowOutput = {
  ok: true;
  iso: string;
  dayOfWeek: 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun';
  timezone: 'UTC';
};

const DAYS: Array<DatetimeNowOutput['dayOfWeek']> = [
  'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat',
];

export const datetimeNowTool: ToolDef<Record<string, never>, DatetimeNowOutput> = {
  name: 'datetime_now',
  description:
    'Return the current UTC time (ISO 8601). Call this whenever the user asks about "today", "this week", or any time-relative question. LLMs frequently miscalculate dates from training cutoffs — always call this first.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  approvalMode: 'auto',
  costHint: 'low',
  hasSideEffects: false,
  idempotent: false,
  replyMeta: { summaryKind: 'text', failureHint: '（内置工具，不应失败）' },
  async handler() {
    const now = new Date();
    return {
      ok: true,
      iso: now.toISOString(),
      dayOfWeek: DAYS[now.getUTCDay()],
      timezone: 'UTC',
    };
  },
};

export function registerDatetimeNow(): void {
  if (!toolRegistry.get(datetimeNowTool.name)) {
    toolRegistry.register(datetimeNowTool);
  }
}
