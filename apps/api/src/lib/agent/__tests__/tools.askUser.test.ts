import { describe, it, expect, vi, beforeEach } from 'vitest';
import { askUserTool, registerAskUser } from '../tools/askUser.js';
import { toolRegistry } from '../toolRegistry.js';

vi.mock('../../../db/client.js', () => ({
  getPool: () => ({
    query: vi.fn(async () => ({ rows: [{ id: 'msg_q_1' }] })),
  }),
}));

const fakeCtx = {
  runId: 'r',
  stepId: 's',
  ownerId: 'u',
  channel: 'private' as const,
  sessionId: 'sess1',
  signal: new AbortController().signal,
};

describe('ask_user tool', () => {
  beforeEach(() => vi.clearAllMocks());

  it('registers idempotently', () => {
    registerAskUser();
    registerAskUser();
    expect(toolRegistry.get('ask_user')).toBeDefined();
  });

  it('private + valid question → ok:true paused:true with messageId', async () => {
    const out = await askUserTool.handler({ question: '你想分析哪一年？' }, fakeCtx);
    expect(out.ok).toBe(true);
    expect(out.paused).toBe(true);
    expect(out.messageId).toBe('msg_q_1');
    expect(out.error).toBeUndefined();
  });

  it('group channel → ok:false (error mentions private)', async () => {
    const out = await askUserTool.handler(
      { question: '你想分析哪一年？' },
      { ...fakeCtx, channel: 'group' as const },
    );
    expect(out.ok).toBe(false);
    expect(out.paused).toBe(false);
    expect(out.messageId).toBe('');
    expect(out.error).toMatch(/private/i);
  });

  it('empty question → ok:false (error mentions empty)', async () => {
    const out = await askUserTool.handler({ question: '   ' }, fakeCtx);
    expect(out.ok).toBe(false);
    expect(out.paused).toBe(false);
    expect(out.error).toMatch(/empty/);
  });

  it('options array passed through without crashing', async () => {
    const out = await askUserTool.handler(
      { question: 'choose', options: ['A', 'B', 'C'] },
      fakeCtx,
    );
    expect(out.ok).toBe(true);
    expect(out.paused).toBe(true);
  });

  it('replyMeta.summaryKind === "silent"', () => {
    expect(askUserTool.replyMeta?.summaryKind).toBe('silent');
  });

  it('missing sessionId → ok:false (defensive guard)', async () => {
    const out = await askUserTool.handler(
      { question: 'q?' },
      { ...fakeCtx, sessionId: undefined },
    );
    expect(out.ok).toBe(false);
    expect(out.paused).toBe(false);
    expect(out.error).toMatch(/session/i);
  });
});
