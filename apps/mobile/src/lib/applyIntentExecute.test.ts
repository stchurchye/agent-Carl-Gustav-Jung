import type { ChatMessage, IntentExecuteResult } from '@xzz/shared';
import { applyPrivateIntentResult } from './applyIntentExecute';

const msg = (role: 'user' | 'assistant', content: string): ChatMessage =>
  ({ id: `${role}-${content}`, sessionId: 's', role, content, createdAt: 'now' }) as ChatMessage;

describe('applyPrivateIntentResult: persona_rename(tool + personaUpdated)', () => {
  it('tool 结果带 personaUpdated 时回调 onPersonaUpdated(狗名即时刷新)', async () => {
    const onTool = jest.fn();
    const onPersonaUpdated = jest.fn();
    const data: IntentExecuteResult = {
      type: 'tool',
      userMessage: msg('user', '你以后就叫旺财'),
      assistantMessage: msg('assistant', '汪!记住了'),
      confirmation: '汪!记住了',
      personaUpdated: { identity: { assistantName: '旺财' } },
    };
    const handled = await applyPrivateIntentResult(data, {
      onChat: jest.fn(),
      onMemory: jest.fn(),
      onTool,
      onPersonaUpdated,
    });
    expect(handled).toBe(true);
    expect(onTool).toHaveBeenCalled();
    expect(onPersonaUpdated).toHaveBeenCalledWith({ identity: { assistantName: '旺财' } });
  });

  it('普通 tool 结果(无 personaUpdated)不触发回调', async () => {
    const onPersonaUpdated = jest.fn();
    const data: IntentExecuteResult = {
      type: 'tool',
      userMessage: msg('user', 'a'),
      assistantMessage: msg('assistant', 'b'),
      confirmation: 'b',
    };
    await applyPrivateIntentResult(data, {
      onChat: jest.fn(),
      onMemory: jest.fn(),
      onTool: jest.fn(),
      onPersonaUpdated,
    });
    expect(onPersonaUpdated).not.toHaveBeenCalled();
  });
});
