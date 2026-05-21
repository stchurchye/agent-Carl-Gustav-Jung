/**
 * M1c：统一注册所有 agent runtime 工具。
 *
 * 调用顺序：
 * 1. `registerEchoSleep` / `registerRiskyEcho` 已由 index 单独管（test fixture，仅 non-prod）
 * 2. 这里只装 "真" 工具：MAGI、Web、Doc
 * 3. MCP 远端在 M1d 才接入；这里留 hook
 *
 * 每个 `register*` 内部已自带去重（同名跳过），重复调用安全。
 */
import { registerMagiSystemRead } from './tools/magiSystemRead.js';
import { registerMagiContentIngest } from './tools/magiContentIngest.js';
import { registerWebSearch } from './tools/webSearch.js';
import { registerUrlFetch } from './tools/urlFetch.js';
import { registerDocExportMarkdown } from './tools/docExportMarkdown.js';
import { registerRunPython } from './tools/runPython.js';

export function registerAgentTools(): void {
  registerMagiSystemRead();
  registerMagiContentIngest();
  registerWebSearch();
  registerUrlFetch();
  registerDocExportMarkdown();
  registerRunPython();
}
