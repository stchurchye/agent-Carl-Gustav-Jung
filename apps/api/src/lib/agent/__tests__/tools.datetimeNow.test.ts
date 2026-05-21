import { describe, it, expect } from 'vitest';
import { datetimeNowTool, registerDatetimeNow } from '../tools/datetimeNow.js';
import { toolRegistry } from '../toolRegistry.js';

const fakeCtx = {
  runId: 'r', stepId: 's', ownerId: 'u', channel: 'private' as const,
  signal: new AbortController().signal,
};

describe('datetime_now tool', () => {
  it('registers idempotently', () => {
    registerDatetimeNow();
    registerDatetimeNow();
    expect(toolRegistry.get('datetime_now')).toBeDefined();
  });

  it('returns valid ISO + dayOfWeek + timezone', async () => {
    const out = await datetimeNowTool.handler({}, fakeCtx);
    expect(out.ok).toBe(true);
    expect(out.iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(['Mon','Tue','Wed','Thu','Fri','Sat','Sun']).toContain(out.dayOfWeek);
    expect(out.timezone).toBe('UTC');
  });

  it('iso parses as valid Date', async () => {
    const out = await datetimeNowTool.handler({}, fakeCtx);
    expect(isNaN(new Date(out.iso).getTime())).toBe(false);
  });
});
