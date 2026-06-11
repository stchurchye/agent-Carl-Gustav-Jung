import {
  __resetChatMessageCacheForTests,
  getCachedMessages,
  mergeMessagesById,
  setCachedMessages,
} from './chatMessageCache';

// W1b 会话打开不闪:进屏先渲染缓存(stale-while-revalidate),刷新用引用稳定 merge。

type Msg = { id: string; content: string };
const msg = (id: string, content = `c-${id}`): Msg => ({ id, content });

beforeEach(() => __resetChatMessageCacheForTests());

describe('cache', () => {
  it('round-trips messages by session key and misses unknown keys', () => {
    setCachedMessages('s1', [msg('a')]);
    expect(getCachedMessages<Msg>('s1')).toEqual([msg('a')]);
    expect(getCachedMessages('s2')).toBeNull();
  });

  it('evicts least-recently-used sessions beyond the cap', () => {
    for (let i = 0; i < 9; i++) setCachedMessages(`s${i}`, [msg(`m${i}`)]);
    expect(getCachedMessages('s0')).toBeNull(); // 最老的被逐出
    expect(getCachedMessages('s8')).not.toBeNull();
  });

  it('reading a session refreshes its recency', () => {
    for (let i = 0; i < 8; i++) setCachedMessages(`s${i}`, [msg(`m${i}`)]);
    getCachedMessages('s0'); // 触摸 s0
    setCachedMessages('s9', [msg('m9')]); // 应逐出 s1 而非 s0
    expect(getCachedMessages('s0')).not.toBeNull();
    expect(getCachedMessages('s1')).toBeNull();
  });

  it('caps stored messages to the most recent 200', () => {
    const many = Array.from({ length: 250 }, (_, i) => msg(`m${i}`));
    setCachedMessages('s1', many);
    const got = getCachedMessages<Msg>('s1')!;
    expect(got).toHaveLength(200);
    expect(got[0].id).toBe('m50');
    expect(got[199].id).toBe('m249');
  });
});

describe('mergeMessagesById', () => {
  it('reuses references for unchanged items and replaces changed ones', () => {
    const a = msg('a');
    const b = msg('b');
    const freshA = { ...a }; // 同内容新引用(重新 fetch)
    const changedB = { id: 'b', content: 'edited' };
    const merged = mergeMessagesById([a, b], [freshA, changedB, msg('c')]);
    expect(merged[0]).toBe(a); // 未变 → 复用旧引用
    expect(merged[1]).toBe(changedB); // 变了 → 用新值
    expect(merged).toHaveLength(3);
  });

  it('returns the previous array reference when nothing changed', () => {
    const prev = [msg('a'), msg('b')];
    const next = [{ ...prev[0] }, { ...prev[1] }];
    expect(mergeMessagesById(prev, next)).toBe(prev);
  });

  it('follows server order and drops items the server no longer returns', () => {
    const prev = [msg('a'), msg('b')];
    const merged = mergeMessagesById(prev, [msg('b'), msg('x')]);
    expect(merged.map((m) => m.id)).toEqual(['b', 'x']);
  });

  it('preserveLocal: keeps optimistic local- placeholders the server does not know yet', () => {
    // 群聊发送中:乐观占位(local-human/local-ai)还没落库,全量刷新不能把它们吞掉
    const prev = [msg('a'), msg('local-human-1'), msg('local-ai-2')];
    const merged = mergeMessagesById(prev, [msg('a'), msg('b')], { preserveLocal: true });
    expect(merged.map((m) => m.id)).toEqual(['a', 'b', 'local-human-1', 'local-ai-2']);
  });

  it('preserveLocal: drops the placeholder once the server returns its settled form', () => {
    const prev = [msg('local-human-1')];
    const merged = mergeMessagesById(prev, [msg('local-human-1'), msg('real')], {
      preserveLocal: true,
    });
    expect(merged.map((m) => m.id)).toEqual(['local-human-1', 'real']);
  });
});
