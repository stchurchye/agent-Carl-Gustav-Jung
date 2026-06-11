/**
 * W1b:聊天消息的进程内缓存(stale-while-revalidate)。
 *
 * 重开会话先渲染上次的消息(挂载即有内容,不再白屏),后台刷新后用
 * mergeMessagesById 引用稳定地并入 —— 未变的消息保留旧对象引用
 * (memo 行不重渲染),全量未变时直接返回旧数组(连 setState 重渲染都省)。
 *
 * key:私聊用 sessionId,群聊用 `${groupId}:${topicId}`。
 */

const MAX_SESSIONS = 8;
const MAX_MESSAGES = 200;

// Map 迭代序 = 插入序,作 LRU 用:get 命中重插,set 超额删最老。
const cache = new Map<string, unknown[]>();

export function getCachedMessages<T>(key: string): T[] | null {
  const hit = cache.get(key);
  if (!hit) return null;
  cache.delete(key);
  cache.set(key, hit);
  return hit as T[];
}

export function setCachedMessages<T>(key: string, messages: T[]): void {
  cache.delete(key);
  cache.set(key, messages.slice(-MAX_MESSAGES));
  while (cache.size > MAX_SESSIONS) {
    const oldest = cache.keys().next().value as string;
    cache.delete(oldest);
  }
}

/**
 * 服务端为序、引用稳定的并入:逐条与旧列表同 id 项比对(整条 JSON),
 * 未变复用旧引用;整体未变返回旧数组引用。
 * preserveLocal:保留服务端还不知道的乐观占位(id 以 local- 开头,如群聊发送中
 * 的用户消息与"思考中"气泡)——否则全量刷新会把发送中的消息吞掉(终审 BUG②)。
 */
export function mergeMessagesById<T extends { id: string }>(
  prev: T[],
  next: T[],
  opts?: { preserveLocal?: boolean },
): T[] {
  if (prev.length === 0) return next;
  const prevById = new Map(prev.map((m) => [m.id, m]));
  let allSame = prev.length === next.length;
  const merged = next.map((n, i) => {
    const p = prevById.get(n.id);
    const keep = p && JSON.stringify(p) === JSON.stringify(n) ? p : n;
    if (allSame && keep !== prev[i]) allSame = false;
    return keep;
  });
  if (opts?.preserveLocal) {
    const nextIds = new Set(next.map((m) => m.id));
    const locals = prev.filter((m) => m.id.startsWith('local-') && !nextIds.has(m.id));
    if (locals.length > 0) return [...merged, ...locals];
  }
  return allSame ? prev : merged;
}

export function __resetChatMessageCacheForTests(): void {
  cache.clear();
}
