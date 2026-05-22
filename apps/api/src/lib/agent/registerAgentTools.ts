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
import { registerFetchUrl } from './tools/fetchUrl.js';
import { registerDocExportMarkdown } from './tools/docExportMarkdown.js';
import { registerRunPython } from './tools/runPython.js';
import { registerSearchPapers } from './tools/searchPapers.js';
import { registerCritiqueLastAnswer } from './tools/critiqueLastAnswer.js';
import { registerDatetimeNow } from './tools/datetimeNow.js';
import { registerRenderDiagram } from './tools/renderDiagram.js';
import { registerWikipedia } from './tools/wikipedia.js';
import { registerGetEconomicSeries } from './tools/getEconomicSeries.js';
import { registerDocumentReader } from './tools/documentReader.js';
import { registerAskUser } from './tools/askUser.js';

export function registerAgentTools(): void {
  registerMagiSystemRead();
  registerMagiContentIngest();
  registerWebSearch();
  registerFetchUrl();
  registerDocExportMarkdown();
  registerRunPython();
  registerSearchPapers();
  registerCritiqueLastAnswer();
  registerDatetimeNow();
  registerRenderDiagram();
  registerWikipedia();
  registerGetEconomicSeries();
  registerDocumentReader();
  registerAskUser();
}
