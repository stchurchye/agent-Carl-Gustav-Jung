import type { ChatUiMessage } from '../../../lib/uiMessage';
import { buildPrivateStage } from './privateStageAdapter';

const msg = (over: Partial<ChatUiMessage>): ChatUiMessage =>
  ({
    id: 'm1',
    sessionId: 's',
    role: 'user',
    content: 'hi',
    createdAt: '2026-06-11T00:00:00Z',
    ...over,
  }) as ChatUiMessage;

const OPTS = {
  userId: 'u1',
  userName: '老王',
  userAvatarUri: null,
  assistantName: '旺财',
};

describe('buildPrivateStage', () => {
  it('两个 actor:人(user:<id>)与狗(dog:self,seed=assistant 与现有头像色一致)', () => {
    const { actors } = buildPrivateStage([], OPTS);
    expect(actors.map((a) => a.id)).toEqual(['dog:self', 'user:u1']);
    const dog = actors[0];
    expect(dog.kind).toBe('dog');
    expect(dog.name).toBe('旺财');
    expect(dog.seed).toBe('assistant');
    expect(actors[1].name).toBe('老王');
  });

  it('role 映射 + displayContent 优先(打字机直通)', () => {
    const { lines } = buildPrivateStage(
      [
        msg({ id: 'a', role: 'user', content: '你好' }),
        msg({ id: 'b', role: 'assistant', content: '全文', displayContent: '全' }),
      ],
      OPTS,
    );
    expect(lines[0]).toMatchObject({ actorId: 'user:u1', text: '你好', kind: 'chat' });
    expect(lines[1]).toMatchObject({ actorId: 'dog:self', text: '全', kind: 'chat' });
  });

  it('pending/error/agent 状态映射', () => {
    const { lines } = buildPrivateStage(
      [
        msg({ id: 'p', role: 'assistant', status: 'pending', displayContent: '想…' }),
        msg({ id: 'e', role: 'assistant', status: 'error', content: '失败', retryText: '重发' }),
        msg({
          id: 'g',
          role: 'assistant',
          content: '',
          agentRun: { agentRunId: 'run-9' },
        }),
      ],
      OPTS,
    );
    expect(lines[0].kind).toBe('pending');
    expect(lines[1]).toMatchObject({ kind: 'error', retryText: '重发' });
    expect(lines[2]).toMatchObject({ kind: 'agent', agentRunId: 'run-9' });
  });
});
