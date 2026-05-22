/**
 * M3 ADR-3: 子 agent 工具白名单。只读 / 检索类 / 无副作用；禁止递归和暂停。
 */
export const SUBAGENT_TOOL_WHITELIST: ReadonlySet<string> = new Set([
  'search_papers',
  'search_web',
  'wikipedia',
  'fetch_url',
  'document_reader',
  'get_paper_citations',
  'datetime_now',
  'magi_system_read',
  'get_economic_series',
]);
