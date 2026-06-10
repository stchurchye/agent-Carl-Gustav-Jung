/**
 * M4 review fix 3：验证 runExecute 在 tool call 后 reload run 再 incrementUsage，
 * 不会覆盖 wrapWithCostAccounting 写入的 costCny。
 *
 * 这是一个 store 级别的集成测试，模拟竞态场景：
 *  1. run 在 tool call 开始时 costCny = 0
 *  2. tool 内部调用 LLM → wrapWithCostAccounting 写 costCny = X 进 DB
 *  3. runExecute reload 最新 run → incrementUsage 在新基准上累加 steps
 *  4. 最终 costCny 应保持 X，而非被旧基准 0 覆盖
 */
import { it, expect, beforeAll, beforeEach } from 'vitest';
import { describeDb } from '../../../testUtils/dbGuard.js';
import { getPool } from '../../../db/client.js';
import { runMigrations } from '../../../db/migrate.js';
import * as store from '../store.js';
import { DEFAULT_BUDGET } from '../types.js';
import { incrementUsage } from '../stepRecorder.js';
import { ensureUser } from './_groupFixture.js';

describeDb('runExecute cost preservation（reload-before-increment）', { timeout: 15000 }, () => {
  beforeAll(async () => {
    await runMigrations();
  });
  beforeEach(async () => {
    await getPool().query('DELETE FROM agent_steps');
    await getPool().query('DELETE FROM agent_runs');
  });

  it('reload run after tool call → costCny written by cost-accounting wrapper is preserved', async () => {
    const { id: ownerId } = await ensureUser('cost-preserve');
    const run = await store.insertAgentRun({
      ownerId,
      channel: 'private',
      sessionId: null,
      groupId: null,
      topicId: null,
      intentTurnId: null,
      role: 'generalist',
      status: 'running',
      inputText: 'x',
      budget: DEFAULT_BUDGET,
      apiKeySource: 'server',
      apiKeyOwnerId: null,
    });

    // step 1：stale snapshot（tool call 开始前）
    const staleRun = run; // costCny = 0
    expect(staleRun.usage.costCny).toBe(0);

    // step 2：模拟 wrapWithCostAccounting 在 tool 内部执行期间写入 DB
    const costFromTool = 0.0123;
    await store.updateAgentRun(run.id, {
      usage: { ...run.usage, costCny: costFromTool, tokens: 1500 },
    });

    // step 3（OLD behavior）：用 staleRun 做 incrementUsage → 会把 costCny 清零
    {
      const oldUsage = incrementUsage(staleRun, { steps: 1, tokens: 0, elapsedSeconds: 5 });
      expect(oldUsage.costCny).toBe(0); // 旧行为：cost 丢失
    }

    // step 4（NEW / fixed behavior）：先 reload 再 incrementUsage → cost 保留
    const freshRun = (await store.getAgentRun(run.id))!;
    expect(freshRun.usage.costCny).toBeCloseTo(costFromTool, 6); // reload 拿到最新值

    const newUsage = incrementUsage(freshRun, { steps: 1, tokens: 0, elapsedSeconds: 5 });
    expect(newUsage.costCny).toBeCloseTo(costFromTool, 6); // 新行为：cost 保留

    const finalRun = (await store.updateAgentRun(run.id, { usage: newUsage }))!;
    expect(finalRun.usage.costCny).toBeCloseTo(costFromTool, 6);
    expect(finalRun.usage.steps).toBe(1);
    expect(finalRun.usage.tokens).toBe(1500); // tokens 也保留
  });
});
