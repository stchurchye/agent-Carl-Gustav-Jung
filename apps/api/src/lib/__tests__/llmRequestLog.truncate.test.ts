import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { LlmRequestLogDetail } from '@xzz/shared';

/**
 * Review 2026-06-11 [P1][security] llmRequestLog.ts:85
 * 用户消息全文(可能含密码/医疗信息/整篇文档)无界落库,且随 rawJson 双份存。
 * 修后:入库前每条消息内容与 responseText 截断到 LLM_LOG_CONTENT_CAP,
 * 标注截断;rawJson 基于截断后的消息构建。自查功能保留(预览/调试足够)。
 */
const insertMock = vi.fn<(userId: string, detail: LlmRequestLogDetail) => Promise<void>>();
vi.mock('../../store/pg-llm-logs.js', () => ({
  insertLlmRequestLog: (...a: unknown[]) =>
    insertMock(...(a as Parameters<typeof insertMock>)),
  listLlmRequestLogs: vi.fn(),
  getLlmRequestLog: vi.fn(),
}));

const { recordLlmRequest, LLM_LOG_CONTENT_CAP } = await import('../llmRequestLog.js');

describe('recordLlmRequest 内容截断', () => {
  beforeEach(() => insertMock.mockReset().mockResolvedValue(undefined));

  it('超长消息内容入库前被截断(messages 与 rawJson 都不含全文)', async () => {
    const secretTail = 'SECRET-TAIL-MARKER-1234';
    const huge = 'x'.repeat(LLM_LOG_CONTENT_CAP + 5000) + secretTail;
    recordLlmRequest({
      userId: 'u1',
      channel: 'chat',
      provider: 'deepseek',
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: huge },
      ],
      responseText: huge,
      status: 'ok',
    });
    await vi.waitFor(() => expect(insertMock).toHaveBeenCalledTimes(1));
    const detail = insertMock.mock.calls[0][1];
    expect(detail.messages[1].content.length).toBeLessThanOrEqual(LLM_LOG_CONTENT_CAP + 50);
    expect(detail.messages[1].content).not.toContain(secretTail);
    expect(detail.messages[1].content).toContain('截断'); // 有截断标注
    expect(detail.responseText?.length ?? 0).toBeLessThanOrEqual(LLM_LOG_CONTENT_CAP + 50);
    expect(detail.rawJson).not.toContain(secretTail);
    // 短消息不受影响
    expect(detail.messages[0].content).toBe('sys');
  });

  it('普通长度消息原样保留', async () => {
    recordLlmRequest({
      userId: 'u1',
      channel: 'chat',
      provider: 'deepseek',
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: '你好' }],
      responseText: '汪!',
      status: 'ok',
    });
    await vi.waitFor(() => expect(insertMock).toHaveBeenCalledTimes(1));
    const detail = insertMock.mock.calls[0][1];
    expect(detail.messages[0].content).toBe('你好');
    expect(detail.responseText).toBe('汪!');
  });
});
