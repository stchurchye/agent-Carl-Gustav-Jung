import type { IntentKind } from '@xzz/shared';
import { pickTaskProfile } from '@xzz/shared';

// M1e Task 13.5：删了死代码 `analyzeIntent` —— 生产路径走 intentAnalyzer.analyzeIntentUnified
// （通过 routes/orchestrate.ts 和 routes/intent.ts），那条函数从来没人调用过。
// agent_run 不 autoExecute 的守卫已迁到 intentAnalyzer.pickAutoExecute 里。

export function taskProfileForIntent(
  kind: IntentKind,
  hasAttachments: boolean,
) {
  return pickTaskProfile({ hasAttachments, intentKind: kind });
}
