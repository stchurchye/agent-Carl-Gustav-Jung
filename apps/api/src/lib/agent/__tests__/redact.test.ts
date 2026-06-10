import { describe, beforeAll, expect, it } from 'vitest';
import { describeDb } from '../../../testUtils/dbGuard.js';
import { redactSecrets } from '../redact.js';
import { runMigrations } from '../../../db/migrate.js';
import * as store from '../store.js';
import { recordStep } from '../stepRecorder.js';
import { DEFAULT_BUDGET } from '../types.js';
import { ensureUser } from './_groupFixture.js';

/**
 * S0：密钥脱敏。落库 step.input 前刮掉用户误粘的密钥（research agent 工具入参常带 key）。
 * 行为 1（tracer）：字符串里的 OpenAI 风格密钥被打码，返回新值、不改原对象。
 */
describe('redactSecrets', () => {
  it('redacts an OpenAI-style secret inside a string and does not mutate input', () => {
    const input = { note: 'use key sk-abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJ to call' };
    const out = redactSecrets(input) as { note: string };

    expect(out.note).not.toContain('sk-abcdefghijklmnopqrstuvwxyz');
    expect(out.note).toContain('[REDACTED');
    // 原对象未被篡改
    expect(input.note).toContain('sk-abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJ');
  });

  it('redacts common secret formats (GitHub PAT, AWS key, Bearer, generic key=value)', () => {
    const out = redactSecrets({
      gh: 'ghp_0123456789abcdefghijklmnopqrstuvwx',
      aws: 'AKIAIOSFODNN7EXAMPLE',
      auth: 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789',
      generic: 'api_key=supersecretvalue12345',
    }) as Record<string, string>;

    expect(out.gh).not.toContain('ghp_0123456789');
    expect(out.aws).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(out.auth).not.toContain('abcdefghijklmnopqrstuvwxyz0123456789');
    expect(out.generic).not.toContain('supersecretvalue12345');
    for (const v of Object.values(out)) expect(v).toContain('[REDACTED');
  });

  it('preserves non-secret data (types, structure, innocuous strings) unchanged', () => {
    const input = {
      query: '强化学习领域的 Richard Sutton 有哪些贡献？',
      url: 'https://www.nsf.gov/news/ai-pioneers',
      limit: 4,
      ok: true,
      nested: { items: ['gdp', 'cpi'], score: 0.42, empty: null },
    };
    const out = redactSecrets(input);

    expect(out).toEqual(input); // 无密钥 → 深相等
    expect(out).not.toBe(input); // 但是新对象（非破坏）
    expect((out as typeof input).nested).not.toBe(input.nested);
  });

  it('does NOT over-redact innocuous research prose (no false positives on token/secret/password)', () => {
    const out = redactSecrets({
      a: 'secret: informationabout caloric restriction longevity',
      b: 'token: economics101 总量与通胀的关系',
      c: 'password: rememberthis advice from the bank manager',
    }) as Record<string, string>;
    expect(out.a).not.toContain('[REDACTED');
    expect(out.b).not.toContain('[REDACTED');
    expect(out.c).not.toContain('[REDACTED');
    // 但真正的 key=value 仍被打码
    expect(redactSecrets('api_key=supersecretvalue12345')).toContain('[REDACTED');
  });

  it('redacts sk-proj-/sk-svcacct- keys fully (hyphen/underscore body) and not mid-identifier sk-', () => {
    const proj = 'sk-proj-AbC12dEf-GhI34jKl_MnO56pQr-StU78vWxYz9012';
    const redacted = redactSecrets(proj) as string;
    expect(redacted).toBe('[REDACTED:openai]'); // 整把刮掉、无残留尾巴
    // 普通带连字符的 slug 不应被当 openai key
    expect(redactSecrets('task-sk-build-step-one')).toBe('task-sk-build-step-one');
    // 即便 slug 以 sk- 开头、足够长，也不该被误当 key（裸 sk- 只认纯字母数字 body）
    const slug2 = 'sk-button-primary-hover-state-active-large';
    expect(redactSecrets(slug2)).toBe(slug2);
  });

  it('redacts other common provider keys (Groq gsk_, xAI xai-) and secret_key= compound', () => {
    expect(redactSecrets('gsk_0123456789abcdefghijklmnopqrstuvwxyz0123')).toContain('[REDACTED');
    expect(redactSecrets('xai-0123456789abcdefghijklmnopqrstuvwxyz')).toContain('[REDACTED');
    expect(redactSecrets('secret_key=aB3xY9zQ1w8e7r6t5y4u')).toContain('[REDACTED');
    // 但 "secret: <长词>" 这种 prose 仍不误伤（裸 secret 不在清单）
    expect(redactSecrets('secret: informationaboutlongevity')).not.toContain('[REDACTED');
  });

  it('redacts DB connection-string passwords', () => {
    const out = redactSecrets('postgres://admin:Sup3rS3cret@db.internal:5432/prod') as string;
    expect(out).not.toContain('Sup3rS3cret');
    expect(out).toContain('[REDACTED');
  });

  it('does not corrupt non-plain objects (Date stays a Date)', () => {
    const d = new Date('2026-06-04T00:00:00Z');
    const out = redactSecrets({ when: d }) as { when: unknown };
    expect(out.when).toBeInstanceOf(Date);
    expect((out.when as Date).toISOString()).toBe(d.toISOString());
  });
});

/**
 * 行为 4（集成）：recordStep 落库时脱敏 step.input（用户误粘的 key 不进库），
 * 但 step.output 保持原始（幂等 replay / extractRef 结构化读它，留到投影点脱敏），
 * 且 toolCallKey 原样（幂等 key 在 recordStep 之前已算好）。
 */
describeDb('recordStep redaction', () => {
  beforeAll(async () => {
    await runMigrations();
  });

  it('redacts step.input but preserves step.output and toolCallKey', async () => {
    const u = await ensureUser('redact');
    const run = await store.insertAgentRun({
      ownerId: u.id,
      channel: 'private',
      sessionId: null,
      groupId: null,
      topicId: null,
      intentTurnId: null,
      role: 'generalist',
      status: 'running',
      inputText: 'x',
      budget: DEFAULT_BUDGET,
      apiKeySource: 'server',
      apiKeyOwnerId: null,
    });

    const SECRET = 'sk-abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJ';
    await recordStep({
      runId: run.id,
      kind: 'tool_call',
      toolName: 'fetch_url',
      toolCallKey: 'stable-key-123',
      input: { apiKey: SECRET, url: 'https://example.com' },
      output: { result: { ok: true, echoed: SECRET } },
    });

    const steps = await store.listSteps(run.id);
    const step = steps.find((s) => s.kind === 'tool_call')!;
    const input = step.input as { apiKey: string; url: string };
    const output = step.output as { result: { ok: boolean; echoed: string } };

    // input 已脱敏
    expect(input.apiKey).not.toContain(SECRET);
    expect(input.apiKey).toContain('[REDACTED');
    expect(input.url).toBe('https://example.com'); // 非密钥原样
    // output 保持原始（投影点才脱敏）
    expect(output.result.echoed).toBe(SECRET);
    // 幂等 key 不受影响
    expect(step.toolCallKey).toBe('stable-key-123');
  });
});

describe('redactSecrets robustness', () => {
  it('does not stack-overflow on pathologically deep nesting (adversarial tool output)', () => {
    // 外部工具输出是任意 JSON；超深嵌套不该让落库路径崩。
    let deep: unknown = { v: 'x' };
    for (let i = 0; i < 20000; i++) deep = { nested: deep };
    expect(() => redactSecrets(deep)).not.toThrow();
  });
});
