import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../integrations/magi.js', () => ({
  queryMagiSystem: vi.fn(),
  ingestMagiContent: vi.fn(),
  magiSystemEnabled: vi.fn(() => true),
  magiContentEnabled: vi.fn(() => true),
}));

import * as magi from '../../integrations/magi.js';
import { magiSystemReadTool, registerMagiSystemRead } from '../tools/magiSystemRead.js';
import {
  magiContentIngestTool,
  registerMagiContentIngest,
} from '../tools/magiContentIngest.js';
import { toolRegistry } from '../toolRegistry.js';

const queryMagiSystem = vi.mocked(magi.queryMagiSystem);
const ingestMagiContent = vi.mocked(magi.ingestMagiContent);
const magiSystemEnabled = vi.mocked(magi.magiSystemEnabled);
const magiContentEnabled = vi.mocked(magi.magiContentEnabled);

const fakeCtx = {
  runId: 'r',
  stepId: 's',
  ownerId: 'u',
  channel: 'private' as const,
  signal: new AbortController().signal,
};

describe('magiSystemRead tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    magiSystemEnabled.mockReturnValue(true);
  });

  it('registers idempotently', () => {
    registerMagiSystemRead();
    registerMagiSystemRead();
    expect(toolRegistry.get('magi_system_read')).toBeDefined();
  });

  it('returns answer from queryMagiSystem', async () => {
    queryMagiSystem.mockResolvedValue('已知用户喜欢小猫');
    const out = await magiSystemReadTool.handler(
      { question: '我喜欢什么' },
      fakeCtx,
    );
    expect(out.answer).toBe('已知用户喜欢小猫');
    expect(out.enabled).toBe(true);
    expect(queryMagiSystem).toHaveBeenCalledOnce();
  });

  it('on upstream error: returns friendly stub, does not throw', async () => {
    queryMagiSystem.mockRejectedValue(new Error('boom'));
    const out = await magiSystemReadTool.handler({ question: 'x' }, fakeCtx);
    expect(out.answer).toContain('MAGI 查询失败');
    expect(out.answer).toContain('boom');
  });

  it('computeIdempotencyKey hashes trimmed question', () => {
    const k1 = magiSystemReadTool.computeIdempotencyKey!({ question: '  abc  ' });
    const k2 = magiSystemReadTool.computeIdempotencyKey!({ question: 'abc' });
    expect(k1).toBe(k2);
    expect(k1).toMatch(/^q:abc$/);
  });
});

describe('magiContentIngest tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    magiContentEnabled.mockReturnValue(true);
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('registers idempotently', () => {
    registerMagiContentIngest();
    registerMagiContentIngest();
    expect(toolRegistry.get('magi_content_ingest')).toBeDefined();
  });

  it('forwards result from ingestMagiContent', async () => {
    ingestMagiContent.mockResolvedValue({
      title: 'foo',
      summary: 'sum',
      videoUrl: 'https://v',
    });
    const out = await magiContentIngestTool.handler(
      { url: 'https://example.com/page' },
      fakeCtx,
    );
    expect(out).toMatchObject({
      title: 'foo',
      summary: 'sum',
      videoUrl: 'https://v',
      enabled: true,
    });
    expect(ingestMagiContent).toHaveBeenCalledWith('https://example.com/page');
  });

  it('idempotency key is stable sha256 of url', () => {
    const k1 = magiContentIngestTool.computeIdempotencyKey!({
      url: 'https://a.com/x',
    });
    const k2 = magiContentIngestTool.computeIdempotencyKey!({
      url: 'https://a.com/x',
    });
    const k3 = magiContentIngestTool.computeIdempotencyKey!({
      url: 'https://b.com/y',
    });
    expect(k1).toBe(k2);
    expect(k1).not.toBe(k3);
    expect(k1).toMatch(/^url-sha256:[0-9a-f]{64}$/);
  });

  it('declares ask + side effects', () => {
    expect(magiContentIngestTool.approvalMode).toBe('ask');
    expect(magiContentIngestTool.hasSideEffects).toBe(true);
    expect(magiContentIngestTool.idempotent).toBe(false);
  });
});
