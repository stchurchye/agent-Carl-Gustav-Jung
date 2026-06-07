/**
 * 取消检测助手。LLM provider 把 abort 重包成 `LlmProviderError(kind:'timeout')`
 * (见 llm/providers/zenmux.ts wrapNetworkError),`e.name` 不再是 'AbortError' —— 故
 * 仅查 e.name 会漏掉 LLM 路径的取消。对齐 agent/checkpoint.ts 约定:优先查 signal.aborted。
 *
 * 用于记忆子系统各 fail-open 边界:`if (isAbortError(e, signal)) throw e;` —— 取消要透传(让
 * runtime 看到 cancel),其余错误才 fail-open 吞掉。
 */
export function isAbortError(e: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  return e instanceof Error && e.name === 'AbortError';
}
