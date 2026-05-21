/**
 * Agent runtime barrel —— 保持 `import ... from './runtime.js'` 外部路径不变。
 *
 * M1e task 1：拆分前的 `runtime.ts` 是 762 行的单文件。已拆为：
 *   - `runtimeShared.ts`：TOOL_TIMEOUT_MS / withTimeout / resolveEffectiveApiKey
 *   - `runLifecycle.ts`：createAgentRun / softComplete / cancelRun / confirmRun
 *   - `runReply.ts`：pickFallbackFinalContent / formatBudgetExhaustedReply / buildFinalContent
 *   - `runPlanGlue.ts`：buildInitialPlan
 *   - `runExecute.ts`：executeRun + resolveToolCallKey
 *
 * 行为零变更。本文件仅做 re-export。
 */
export type {
  CreateAgentRunInput,
  CreateAgentRunResult,
} from './runLifecycle.js';
export {
  createAgentRun,
  cancelRun,
  confirmRun,
} from './runLifecycle.js';
export { executeRun, resolveToolCallKey } from './runExecute.js';
