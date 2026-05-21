# Agent Runtime M2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship M2 of the agent runtime — 11 new tools (run_python via E2B, search_papers via OpenAlex+CrossRef, critique_last_answer, fetch_url via Jina Reader, render_diagram via Mermaid, wikipedia, get_economic_series via FRED, get_paper_citations, datetime_now, document_reader for PDF/Word/Excel) plus rename web_search→search_web — turning the agent into a research assistant for serious psychology/economics discussion.

**Architecture:**
- Each new tool follows the **M1f three-piece convention**: `{ok, ...}` soft-fail schema, `replyMeta` (summaryKind / extractRef / failureHint), and `ctx.signal` propagation (AbortError re-throws; everything else soft-fails).
- One new JSONB column `agent_runs.user_api_keys_enc` holds all future per-run user-provided API keys (E2B/Exa/FRED/Jina) keyed by service name — avoids column explosion.
- E2B sandbox is **per-run persistent** (cross-step variable retention) and killed in `softComplete`.
- Mermaid renders on **mobile** via `react-native-webview` + CDN-loaded mermaid.js (fallback: raw source in code block).

**Tech Stack:**
- Backend: TypeScript + Node 20 (apps/api), Vitest, PostgreSQL
- New backend deps: `@e2b/code-interpreter`, `pdf-parse`, `mammoth`, `xlsx`
- New backend removed deps: `jsdom`, `@mozilla/readability` (replaced by Jina Reader)
- Mobile: React Native (apps/mobile), `react-native-webview` (already present — check first)
- External APIs: E2B, OpenAlex, CrossRef, Jina Reader (`r.jina.ai`), Wikipedia REST, FRED, no API key shared with mermaid (CDN)

---

## File Structure

### New files (apps/api)

| Path | Purpose |
|------|---------|
| `apps/api/src/db/migrations/016_agent_run_sandbox_and_keys.sql` | Add `sandbox_id`, `user_api_keys_enc` to `agent_runs` |
| `apps/api/src/lib/agent/sandbox.ts` | E2B sandbox lifecycle (create/connect/kill per run) |
| `apps/api/src/lib/agent/tools/runPython.ts` | `run_python` tool |
| `apps/api/src/lib/agent/tools/searchPapers.ts` | `search_papers` + `get_paper_citations` (shared HTTP client) |
| `apps/api/src/lib/agent/tools/critiqueLastAnswer.ts` | `critique_last_answer` tool |
| `apps/api/src/lib/agent/tools/fetchUrl.ts` | `fetch_url` (Jina Reader) — replaces `urlFetch.ts` |
| `apps/api/src/lib/agent/tools/datetimeNow.ts` | `datetime_now` tool |
| `apps/api/src/lib/agent/tools/renderDiagram.ts` | `render_diagram` (writes a `diagram` message row) |
| `apps/api/src/lib/agent/tools/wikipedia.ts` | `wikipedia` tool |
| `apps/api/src/lib/agent/tools/getEconomicSeries.ts` | `get_economic_series` (FRED) |
| `apps/api/src/lib/agent/tools/documentReader.ts` | `document_reader` (PDF + Word + Excel dispatch) |
| `apps/api/src/lib/agent/userApiKeys.ts` | Helpers for `user_api_keys_enc` JSONB get/set + seal/unseal |
| `apps/api/src/lib/agent/__tests__/sandbox.test.ts` | Sandbox lifecycle unit tests |
| `apps/api/src/lib/agent/__tests__/tools.runPython.test.ts` | run_python tests (E2B mocked) |
| `apps/api/src/lib/agent/__tests__/tools.searchPapers.test.ts` | search_papers + citations tests |
| `apps/api/src/lib/agent/__tests__/tools.critiqueLastAnswer.test.ts` | critic tests |
| `apps/api/src/lib/agent/__tests__/tools.fetchUrl.test.ts` | Jina-mocked fetch tests |
| `apps/api/src/lib/agent/__tests__/tools.datetimeNow.test.ts` | datetime trivial tests |
| `apps/api/src/lib/agent/__tests__/tools.renderDiagram.test.ts` | render_diagram tests (DB stub) |
| `apps/api/src/lib/agent/__tests__/tools.wikipedia.test.ts` | wikipedia tests |
| `apps/api/src/lib/agent/__tests__/tools.getEconomicSeries.test.ts` | FRED tests |
| `apps/api/src/lib/agent/__tests__/tools.documentReader.test.ts` | document_reader tests |
| `apps/api/src/lib/agent/__tests__/userApiKeys.test.ts` | JSONB seal/unseal roundtrip |

### New files (apps/mobile)

| Path | Purpose |
|------|---------|
| `apps/mobile/src/components/DiagramMessage.tsx` | Renders mermaid string via WebView |

### Modified files

| Path | Change |
|------|--------|
| `apps/api/package.json` | Add `@e2b/code-interpreter`, `pdf-parse`, `mammoth`, `xlsx`; remove `jsdom`, `@mozilla/readability` |
| `apps/api/src/lib/agent/store.ts` | Read/write `sandbox_id` and `user_api_keys_enc` |
| `apps/api/src/lib/agent/types.ts` | Add `sandboxId`, `userApiKeysEnc` to `AgentRun` |
| `apps/api/src/lib/agent/runLifecycle.ts` | Call `killSandboxForRun(run.id)` in `softComplete` (best-effort) |
| `apps/api/src/lib/agent/planner.ts` | Update `PLANNER_INSTRUCTION` to mention search_papers for academic, critique_last_answer after complex claims, render_diagram, run_python |
| `apps/api/src/lib/agent/tools/webSearch.ts` | Rename `name: 'web_search'` → `name: 'search_web'`, update docstring |
| `apps/api/src/lib/agent/tools/urlFetch.ts` | **Delete** (replaced by `fetchUrl.ts`) |
| `apps/api/src/lib/agent/__tests__/tools.urlFetch.test.ts` | **Delete** (replaced by `tools.fetchUrl.test.ts`) |
| `apps/api/src/lib/agent/registerAllTools.ts` (or wherever tools get registered) | Register all 11 new tools |
| `apps/api/src/lib/agent/replyGen.ts` | Add `kind: 'diagram'` to ReplyRef rendering |
| `apps/api/.env.example` | Add `E2B_API_KEY`, `FRED_API_KEY`, `JINA_API_KEY`, `OPENALEX_USER_AGENT` |
| `apps/mobile/src/screens/ChatScreen.tsx` (or wherever messages get rendered) | Switch on `type === 'diagram'` → render `<DiagramMessage>` |

### Files this plan does NOT touch
- `apps/api/src/lib/agent/runExecute.ts` — no changes needed (soft-fail/cancel/critique loop all from M1f)
- `apps/api/src/lib/agent/critique.ts` — no changes needed
- `apps/api/src/lib/agent/replyMeta.ts` (or wherever `summarizeStepOutput` lives) — additions only via new `summaryKind: 'code_output'`

---

## Task 0: Branch + baseline

**Files:** none modified; only branch ops.

- [ ] **Step 0.1: Confirm starting commit is the M2 spec branch tip**

```bash
cd "/Users/hongpengwang/行动中止派"
git status                       # Expected: "On branch feat/agent-runtime-m2-spec", clean
git log --oneline -3             # Expected: top commit is "docs(agent): M2 spec 更新 ..."
```

- [ ] **Step 0.2: Create implementation branch off the spec branch**

```bash
git checkout -b feat/agent-runtime-m2
```

Expected: `Switched to a new branch 'feat/agent-runtime-m2'`

- [ ] **Step 0.3: Verify baseline tests + typecheck pass**

```bash
cd "/Users/hongpengwang/行动中止派" && npx vitest run -w @xzz/api 2>&1 | tail -5
```

Expected: all tests pass (M1f baseline: 310). Note the exact count and record it as the **baseline** (you'll target baseline + ~50 by end of M2).

```bash
cd "/Users/hongpengwang/行动中止派/apps/api" && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 0.4: Note OS-level prerequisites**

Before starting Task 1, verify:
- Node version: `node --version` ≥ v20
- `pg_isready` (for migration to actually apply later)

Record any warnings; don't try to fix unrelated env issues now.

---

## Task 1: DB migration + E2B sandbox + `run_python` tool

This is the biggest task. Break into three sub-pieces: (1) migration, (2) sandbox module, (3) the tool itself with TDD.

**Files:**
- Create: `apps/api/src/db/migrations/016_agent_run_sandbox_and_keys.sql`
- Create: `apps/api/src/lib/agent/sandbox.ts`
- Create: `apps/api/src/lib/agent/tools/runPython.ts`
- Create: `apps/api/src/lib/agent/__tests__/sandbox.test.ts`
- Create: `apps/api/src/lib/agent/__tests__/tools.runPython.test.ts`
- Modify: `apps/api/package.json` (add `@e2b/code-interpreter`)
- Modify: `apps/api/src/lib/agent/types.ts` (add `sandboxId`, `userApiKeysEnc`)
- Modify: `apps/api/src/lib/agent/store.ts` (read/write new columns)
- Modify: `apps/api/src/lib/agent/runLifecycle.ts` (kill sandbox in `softComplete`)

### 1A. Database migration

- [ ] **Step 1.1: Write the migration SQL**

Create `apps/api/src/db/migrations/016_agent_run_sandbox_and_keys.sql`:

```sql
-- M2 Task 1A: per-run sandbox state + JSONB bag for new user-provided API keys.
--
-- sandbox_id: ID of the E2B sandbox spawned by run_python; first call creates,
--   later calls reconnect. NULL after softComplete (we best-effort kill on
--   completed/failed/cancelled).
--
-- user_api_keys_enc: encrypted (secretBox v1) JSONB map of
--   { e2b?: string; exa?: string; fred?: string; jina?: string }.
--   Each value is the AES-256-GCM ciphertext envelope (same format as
--   user_api_key_enc / user_zenmux_key_enc). M2 forward-only: never replaces
--   the existing per-key columns; future migrations may consolidate.

ALTER TABLE agent_runs
  ADD COLUMN sandbox_id TEXT NULL,
  ADD COLUMN user_api_keys_enc JSONB NOT NULL DEFAULT '{}'::jsonb;
```

- [ ] **Step 1.2: Apply the migration locally**

```bash
cd "/Users/hongpengwang/行动中止派" && psql "$DATABASE_URL" -f apps/api/src/db/migrations/016_agent_run_sandbox_and_keys.sql
```

Expected: `ALTER TABLE` (single line). If `DATABASE_URL` is not in shell env, source `.env` first:

```bash
cd "/Users/hongpengwang/行动中止派" && set -a && . .env && set +a && psql "$DATABASE_URL" -f apps/api/src/db/migrations/016_agent_run_sandbox_and_keys.sql
```

- [ ] **Step 1.3: Verify columns exist**

```bash
psql "$DATABASE_URL" -c "\d agent_runs" | grep -E "sandbox_id|user_api_keys_enc"
```

Expected:
```
 sandbox_id        | text                        |
 user_api_keys_enc | jsonb                       | not null | default '{}'::jsonb
```

- [ ] **Step 1.4: Extend AgentRun type**

Modify `apps/api/src/lib/agent/types.ts` — find the `AgentRun` interface and add the two fields. Use Read to see current shape, then StrReplace to add fields **after `modelId`**:

```typescript
  /** M2 Task 1A: E2B sandbox ID for run_python. NULL until first call; killed in softComplete. */
  sandboxId: string | null;
  /** M2 Task 1A: encrypted JSONB bag of user-supplied API keys keyed by service name. */
  userApiKeysEnc: Record<string, string> | null;
```

- [ ] **Step 1.5: Plumb new columns through store.ts**

Open `apps/api/src/lib/agent/store.ts`. Find every `SELECT` against `agent_runs` and add `sandbox_id, user_api_keys_enc` to the column list. Find the row-mapper helper (typically `mapAgentRunRow` or similar — grep for `provider_id`) and map:

```typescript
sandboxId: (row.sandbox_id as string | null) ?? null,
userApiKeysEnc: (row.user_api_keys_enc as Record<string, string> | null) ?? {},
```

Find `updateAgentRun` (or `updateRunFields`) — add `sandboxId` and `userApiKeysEnc` to its accepted partial type and to its dynamic SET clause builder.

- [ ] **Step 1.6: Write failing test for store roundtrip**

Add to existing `apps/api/src/lib/agent/__tests__/store.test.ts` (or create if missing — grep first):

```typescript
import { describe, it, expect } from 'vitest';
import * as store from '../store.js';

describe('M2 Task 1A: agent_runs new columns', () => {
  it('round-trips sandbox_id and user_api_keys_enc', async () => {
    // 假设 store 测试已有 createTestRun helper；若没有就 inline 构造
    const run = await store.createAgentRun({
      ownerId: 'test-user',
      channel: 'private',
      input: 'hi',
      apiKey: null,
      apiKeySource: 'server',
    } as any);
    expect(run.sandboxId).toBeNull();
    expect(run.userApiKeysEnc).toEqual({});

    const updated = await store.updateAgentRun(run.id, {
      sandboxId: 'sbx_abc123',
      userApiKeysEnc: { e2b: 'sealed-blob' },
    });
    expect(updated?.sandboxId).toBe('sbx_abc123');
    expect(updated?.userApiKeysEnc).toEqual({ e2b: 'sealed-blob' });
  });
});
```

- [ ] **Step 1.7: Run test (should pass after Step 1.5 plumbing)**

```bash
cd "/Users/hongpengwang/行动中止派" && npx vitest run -w @xzz/api --testPathPattern store.test 2>&1 | tail -20
```

Expected: pass. If fails because store test file structure differs, adapt — the goal is just one test confirming column read/write.

- [ ] **Step 1.8: Commit migration + plumbing**

```bash
cd "/Users/hongpengwang/行动中止派" && git add apps/api/src/db/migrations/016_agent_run_sandbox_and_keys.sql apps/api/src/lib/agent/types.ts apps/api/src/lib/agent/store.ts apps/api/src/lib/agent/__tests__/store.test.ts && git commit -m "feat(agent/m2): migration 016 — sandbox_id + user_api_keys_enc"
```

### 1B. Install E2B SDK + sandbox module

- [ ] **Step 1.9: Install E2B SDK**

```bash
cd "/Users/hongpengwang/行动中止派" && npm install @e2b/code-interpreter -w @xzz/api
```

Expected: a line like `added 1 package`. Open `apps/api/package.json` and confirm `@e2b/code-interpreter` is in `dependencies`. Pin to the version npm installed (don't widen).

- [ ] **Step 1.10: Add E2B_API_KEY to .env.example**

Modify `.env.example` (workspace root or `apps/api/.env.example` — whichever exists; grep first). Add:

```
# E2B sandbox for run_python tool (m2)
E2B_API_KEY=
# OpenAlex polite-pool User-Agent (m2)
OPENALEX_USER_AGENT="agent-runtime-m2 (mailto:dev@example.com)"
# FRED API for get_economic_series (m2)
FRED_API_KEY=
# Jina Reader for fetch_url (optional; without key uses IP-rate-limited free tier) (m2)
JINA_API_KEY=
```

Do NOT modify `.env`. Verify with:

```bash
grep -E "E2B_API_KEY|OPENALEX_USER_AGENT|FRED_API_KEY|JINA_API_KEY" "/Users/hongpengwang/行动中止派/.env.example"
```

- [ ] **Step 1.11: Write the failing test for sandbox.ts**

Create `apps/api/src/lib/agent/__tests__/sandbox.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as store from '../store.js';
import { acquireSandbox, killSandboxForRun } from '../sandbox.js';

vi.mock('@e2b/code-interpreter', () => {
  const sandboxes = new Map<string, { killed: boolean }>();
  let nextId = 0;
  return {
    Sandbox: {
      create: vi.fn(async (_opts?: unknown) => {
        const id = `sbx_${++nextId}`;
        const entry = { killed: false };
        sandboxes.set(id, entry);
        return { sandboxId: id, kill: vi.fn(async () => { entry.killed = true; }) };
      }),
      connect: vi.fn(async (sandboxId: string) => {
        const entry = sandboxes.get(sandboxId);
        if (!entry || entry.killed) throw new Error('sandbox not found');
        return { sandboxId, kill: vi.fn(async () => { entry.killed = true; }) };
      }),
      kill: vi.fn(async (sandboxId: string) => {
        const entry = sandboxes.get(sandboxId);
        if (entry) entry.killed = true;
      }),
    },
  };
});

vi.mock('../store.js', () => ({
  getAgentRun: vi.fn(),
  updateAgentRun: vi.fn(),
}));

describe('sandbox lifecycle', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('acquireSandbox creates a new sandbox when run.sandboxId is null', async () => {
    (store.getAgentRun as any).mockResolvedValue({ id: 'r1', sandboxId: null });
    (store.updateAgentRun as any).mockResolvedValue({ id: 'r1', sandboxId: 'sbx_1' });

    const sbx = await acquireSandbox('r1');
    expect(sbx.sandboxId).toBe('sbx_1');
    expect(store.updateAgentRun).toHaveBeenCalledWith('r1', { sandboxId: 'sbx_1' });
  });

  it('acquireSandbox reconnects when run.sandboxId is set', async () => {
    (store.getAgentRun as any).mockResolvedValue({ id: 'r1', sandboxId: 'sbx_existing' });
    // Pre-seed the mock by creating one
    const { Sandbox } = await import('@e2b/code-interpreter');
    await Sandbox.create();  // creates sbx_1
    // Now patch the test by mocking connect to return that existing id
    (Sandbox.connect as any).mockResolvedValueOnce({
      sandboxId: 'sbx_existing',
      kill: vi.fn(),
    });

    const sbx = await acquireSandbox('r1');
    expect(sbx.sandboxId).toBe('sbx_existing');
    expect(store.updateAgentRun).not.toHaveBeenCalled();
  });

  it('killSandboxForRun calls Sandbox.kill and clears the column', async () => {
    (store.getAgentRun as any).mockResolvedValue({ id: 'r1', sandboxId: 'sbx_alive' });
    (store.updateAgentRun as any).mockResolvedValue({ id: 'r1', sandboxId: null });

    await killSandboxForRun('r1');
    const { Sandbox } = await import('@e2b/code-interpreter');
    expect(Sandbox.kill).toHaveBeenCalledWith('sbx_alive');
    expect(store.updateAgentRun).toHaveBeenCalledWith('r1', { sandboxId: null });
  });

  it('killSandboxForRun is a no-op when run.sandboxId is null', async () => {
    (store.getAgentRun as any).mockResolvedValue({ id: 'r1', sandboxId: null });
    await killSandboxForRun('r1');
    const { Sandbox } = await import('@e2b/code-interpreter');
    expect(Sandbox.kill).not.toHaveBeenCalled();
  });

  it('killSandboxForRun swallows kill errors (best-effort)', async () => {
    (store.getAgentRun as any).mockResolvedValue({ id: 'r1', sandboxId: 'sbx_gone' });
    const { Sandbox } = await import('@e2b/code-interpreter');
    (Sandbox.kill as any).mockRejectedValueOnce(new Error('already gone'));
    await expect(killSandboxForRun('r1')).resolves.toBeUndefined();
    expect(store.updateAgentRun).toHaveBeenCalledWith('r1', { sandboxId: null });
  });
});
```

- [ ] **Step 1.12: Run the failing test**

```bash
cd "/Users/hongpengwang/行动中止派" && npx vitest run -w @xzz/api --testPathPattern sandbox.test 2>&1 | tail -10
```

Expected: FAIL — `Cannot find module '../sandbox.js'`.

- [ ] **Step 1.13: Implement sandbox.ts**

Create `apps/api/src/lib/agent/sandbox.ts`:

```typescript
/**
 * M2 Task 1B: E2B Firecracker sandbox lifecycle.
 *
 * - One sandbox per agent_run (cross-step Python variable persistence)
 * - First run_python call: Sandbox.create() → write sandbox_id to DB
 * - Later calls: Sandbox.connect(sandboxId) → reuse
 * - softComplete (completed/failed/cancelled): Sandbox.kill() best-effort
 *
 * E2B SDK accepts AbortSignal natively; we pass ctx.signal through.
 */
import { Sandbox } from '@e2b/code-interpreter';
import * as store from './store.js';

const DEFAULT_TIMEOUT_MS = 30_000;

export type SandboxHandle = Awaited<ReturnType<typeof Sandbox.create>>;

export async function acquireSandbox(runId: string): Promise<SandboxHandle> {
  const run = await store.getAgentRun(runId);
  if (!run) throw new Error(`acquireSandbox: run ${runId} not found`);

  if (run.sandboxId) {
    try {
      return await Sandbox.connect(run.sandboxId);
    } catch {
      // 老 sandbox 已被 E2B 闲置回收。重新建一个。
    }
  }

  const apiKey = process.env.E2B_API_KEY?.trim();
  if (!apiKey) throw new Error('E2B_API_KEY is not configured');
  const sbx = await Sandbox.create({ apiKey, timeoutMs: DEFAULT_TIMEOUT_MS });
  await store.updateAgentRun(runId, { sandboxId: sbx.sandboxId });
  return sbx;
}

export async function killSandboxForRun(runId: string): Promise<void> {
  const run = await store.getAgentRun(runId);
  if (!run?.sandboxId) return;
  try {
    await Sandbox.kill(run.sandboxId);
  } catch {
    // 已经死了 / 网络错 —— best-effort，不让 softComplete 失败
  }
  try {
    await store.updateAgentRun(runId, { sandboxId: null });
  } catch {
    /* ignore */
  }
}
```

- [ ] **Step 1.14: Run the test (should pass)**

```bash
cd "/Users/hongpengwang/行动中止派" && npx vitest run -w @xzz/api --testPathPattern sandbox.test 2>&1 | tail -10
```

Expected: 5 passed. If failures, read carefully — the mock structure must match: `Sandbox.create()` returns an object with `sandboxId`, `kill`; `Sandbox.connect()` returns same shape; `Sandbox.kill(sandboxId)` is a static.

- [ ] **Step 1.15: Wire `killSandboxForRun` into softComplete**

Modify `apps/api/src/lib/agent/runLifecycle.ts`. Find the `softComplete` function (around line 164). Add a best-effort call right BEFORE the `await store.updateAgentRun(run.id, { status, endedAt: new Date() })` line:

```typescript
import { killSandboxForRun } from './sandbox.js';
// ...inside softComplete, just before the status update:
  // M2 Task 1B: free E2B sandbox on terminal status (no-op if run never used run_python)
  await killSandboxForRun(run.id);
```

- [ ] **Step 1.16: Write smoke test for sandbox kill on softComplete**

Add to `apps/api/src/lib/agent/__tests__/sandbox.test.ts`:

```typescript
import { softComplete } from '../runLifecycle.js';
// ...

it('softComplete triggers killSandboxForRun', async () => {
  // Build a minimal run object and stub store + messageBridge as needed.
  // If runLifecycle.softComplete has many dependencies, mock them at vi.mock level.
  // For TDD purposes, the integration test in Step 1.17 (full-runtime) is the
  // real proof; this unit test can be a soft smoke that simply verifies
  // killSandboxForRun is called when status flips.
  // SKIP if mocking surface is too wide — Step 1.17 covers it end-to-end.
});
```

If wiring softComplete's deps is too invasive for a unit test, mark this test `.todo()` and rely on Step 1.17. Don't waste time fighting mocks.

### 1C. The `run_python` tool itself

- [ ] **Step 1.17: Write failing tests for runPython tool**

Create `apps/api/src/lib/agent/__tests__/tools.runPython.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runPythonTool, registerRunPython } from '../tools/runPython.js';
import { toolRegistry } from '../toolRegistry.js';

const fakeCtx = {
  runId: 'r1',
  stepId: 's1',
  ownerId: 'u1',
  channel: 'private' as const,
  signal: new AbortController().signal,
};

vi.mock('../sandbox.js', () => ({
  acquireSandbox: vi.fn(),
}));

import { acquireSandbox } from '../sandbox.js';

function makeSandbox(runResultByCode: Record<string, any>) {
  return {
    sandboxId: 'sbx_1',
    runCode: vi.fn(async (code: string) => {
      const r = runResultByCode[code];
      if (!r) throw new Error(`unexpected code in test: ${code}`);
      return r;
    }),
  };
}

describe('run_python tool', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('registers idempotently', () => {
    registerRunPython();
    registerRunPython();
    expect(toolRegistry.get('run_python')).toBeDefined();
  });

  it('happy path: stdout returned, ok:true', async () => {
    const sbx = makeSandbox({
      'print(1+2)': {
        logs: { stdout: ['3\n'], stderr: [] },
        results: [],
        error: undefined,
      },
    });
    (acquireSandbox as any).mockResolvedValue(sbx);
    const out = await runPythonTool.handler({ code: 'print(1+2)' }, fakeCtx);
    expect(out.ok).toBe(true);
    expect(out.stdout).toBe('3\n');
    expect(out.stderr).toBe('');
  });

  it('Python exception → ok:true + stderr (it is "code bug" not "tool bug")', async () => {
    const sbx = makeSandbox({
      'raise ValueError("nope")': {
        logs: { stdout: [], stderr: [] },
        results: [],
        error: { name: 'ValueError', value: 'nope', traceback: 'Traceback...\nValueError: nope' },
      },
    });
    (acquireSandbox as any).mockResolvedValue(sbx);
    const out = await runPythonTool.handler({ code: 'raise ValueError("nope")' }, fakeCtx);
    expect(out.ok).toBe(true);
    expect(out.stderr).toContain('ValueError');
  });

  it('sandbox-level error (e.g. timeout) → ok:false', async () => {
    (acquireSandbox as any).mockRejectedValue(new Error('sandbox timeout'));
    const out = await runPythonTool.handler({ code: 'print(1)' }, fakeCtx);
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/sandbox timeout/);
  });

  it('AbortError re-throws so runtime sees cancel', async () => {
    (acquireSandbox as any).mockImplementation(() => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    });
    await expect(
      runPythonTool.handler({ code: 'print(1)' }, fakeCtx),
    ).rejects.toThrow(/aborted/);
  });

  it('code over 16KB → ok:false with size-limit error', async () => {
    (acquireSandbox as any).mockResolvedValue(makeSandbox({}));
    const huge = 'x = 1\n'.repeat(3000); // ~18 KB
    const out = await runPythonTool.handler({ code: huge }, fakeCtx);
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/code too large/);
  });

  it('stdout truncated to 8KB', async () => {
    const longStdout = 'a'.repeat(10_000);
    const sbx = makeSandbox({
      'print("a"*10000)': {
        logs: { stdout: [longStdout], stderr: [] },
        results: [],
        error: undefined,
      },
    });
    (acquireSandbox as any).mockResolvedValue(sbx);
    const out = await runPythonTool.handler({ code: 'print("a"*10000)' }, fakeCtx);
    expect(out.stdout.length).toBeLessThanOrEqual(8 * 1024);
  });
});
```

- [ ] **Step 1.18: Run the failing tests**

```bash
cd "/Users/hongpengwang/行动中止派" && npx vitest run -w @xzz/api --testPathPattern tools.runPython.test 2>&1 | tail -10
```

Expected: FAIL — `Cannot find module '../tools/runPython.js'`.

- [ ] **Step 1.19: Implement runPython.ts**

Create `apps/api/src/lib/agent/tools/runPython.ts`:

```typescript
import { toolRegistry, type ToolDef } from '../toolRegistry.js';
import { acquireSandbox } from '../sandbox.js';

type RunPythonInput = {
  code: string;
  description?: string;
};

type RunPythonOutput = {
  ok: boolean;
  stdout: string;
  stderr: string;
  result?: string;
  error?: string;
};

const MAX_CODE_BYTES = 16 * 1024;
const STDOUT_CAP = 8 * 1024;
const STDERR_CAP = 2 * 1024;
const RESULT_CAP = 4 * 1024;

function cap(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + `\n...[truncated, ${s.length - max} more chars]` : s;
}

export const runPythonTool: ToolDef<RunPythonInput, RunPythonOutput> = {
  name: 'run_python',
  description:
    'Run Python code in an isolated sandbox (E2B Firecracker microVM). Persistent across steps within the same agent run (variables retained). Supports full PyPI: pandas, numpy, matplotlib, statsmodels, etc. Use for calculations, regressions, charts, data exploration. 30s wall-clock limit, 1GB memory.',
  inputSchema: {
    type: 'object',
    required: ['code'],
    properties: {
      code: { type: 'string', maxLength: 16384 },
      description: { type: 'string' },
    },
  },
  approvalMode: 'auto',
  costHint: 'medium',
  hasSideEffects: true,           // 消耗 E2B compute = $
  idempotent: false,              // 可能依赖时间/网络/随机
  replyMeta: {
    summaryKind: 'text',
    failureHint:
      'Python 代码执行失败：沙箱可能超时(30s)、超内存(1GB)、或代码本身报错。先看 stderr 找 Python exception 原因，改 code 重试；持续失败考虑改用其他工具（如 search_papers 拿现成数据）。',
  },
  async handler(input, ctx) {
    if (Buffer.byteLength(input.code, 'utf-8') > MAX_CODE_BYTES) {
      return {
        ok: false,
        stdout: '',
        stderr: '',
        error: `code too large: ${Buffer.byteLength(input.code, 'utf-8')} bytes > ${MAX_CODE_BYTES}`,
      };
    }

    try {
      const sandbox = await acquireSandbox(ctx.runId);
      // E2B SDK: runCode(code, opts?) returns { logs: {stdout: string[], stderr: string[]}, results: any[], error?: {...} }
      const exec = await (sandbox as any).runCode(input.code, { onSignal: ctx.signal });
      const stdout = (exec.logs?.stdout ?? []).join('');
      const stderrFromLogs = (exec.logs?.stderr ?? []).join('');
      const errorText = exec.error
        ? `${exec.error.name ?? 'Error'}: ${exec.error.value ?? ''}\n${exec.error.traceback ?? ''}`
        : '';
      const stderr = [stderrFromLogs, errorText].filter(Boolean).join('\n');
      const lastResult = exec.results?.[exec.results.length - 1];
      const resultText = lastResult
        ? typeof lastResult === 'string'
          ? lastResult
          : JSON.stringify(lastResult)
        : undefined;
      return {
        ok: true,
        stdout: cap(stdout, STDOUT_CAP),
        stderr: cap(stderr, STDERR_CAP),
        result: resultText ? cap(resultText, RESULT_CAP) : undefined,
      };
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') throw e;
      return {
        ok: false,
        stdout: '',
        stderr: '',
        error: e instanceof Error ? e.message : String(e),
      };
    }
  },
};

export function registerRunPython(): void {
  if (!toolRegistry.get(runPythonTool.name)) {
    toolRegistry.register(runPythonTool);
  }
}
```

- [ ] **Step 1.20: Run the tests (should pass)**

```bash
cd "/Users/hongpengwang/行动中止派" && npx vitest run -w @xzz/api --testPathPattern tools.runPython.test 2>&1 | tail -20
```

Expected: 6 passed. If the "Python exception" test fails because the mock shape differs from real E2B SDK, adjust the mock — the real SDK at `@e2b/code-interpreter` exposes `runCode` (or `notebook.execCell` depending on version); pick what your installed version supports and update both mock and implementation.

- [ ] **Step 1.21: Wire run_python registration**

Grep for where existing tools are registered:

```bash
cd "/Users/hongpengwang/行动中止派" && rg "registerWebSearch|registerUrlFetch" apps/api/src --type ts -l
```

Open the central registration file (likely `apps/api/src/lib/agent/registerAllTools.ts` or similar — if it doesn't exist look at how tools wire up at app start). Add:

```typescript
import { registerRunPython } from './tools/runPython.js';
// ...inside the registration function:
registerRunPython();
```

- [ ] **Step 1.22: Typecheck + commit Task 1**

```bash
cd "/Users/hongpengwang/行动中止派/apps/api" && npx tsc --noEmit 2>&1 | tail -5
```

Expected: no errors.

```bash
cd "/Users/hongpengwang/行动中止派" && git add apps/api/src/lib/agent/sandbox.ts apps/api/src/lib/agent/tools/runPython.ts apps/api/src/lib/agent/__tests__/sandbox.test.ts apps/api/src/lib/agent/__tests__/tools.runPython.test.ts apps/api/src/lib/agent/runLifecycle.ts apps/api/package.json apps/api/package-lock.json .env.example && git commit -m "feat(agent/m2): run_python tool + E2B sandbox lifecycle"
```

(If `apps/api/.env.example` is the actual file path, swap `.env.example` accordingly. Find via `ls "/Users/hongpengwang/行动中止派"/.env* "/Users/hongpengwang/行动中止派"/apps/api/.env*`.)

Also stage the registerAllTools change if it lives in a different file.

---

## Task 2: `search_papers` + `get_paper_citations` (OpenAlex + CrossRef)

Both tools share an HTTP client and live in the same file.

**Files:**
- Create: `apps/api/src/lib/agent/tools/searchPapers.ts`
- Create: `apps/api/src/lib/agent/__tests__/tools.searchPapers.test.ts`

- [ ] **Step 2.1: Write failing tests**

Create `apps/api/src/lib/agent/__tests__/tools.searchPapers.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  searchPapersTool,
  getPaperCitationsTool,
  registerSearchPapers,
} from '../tools/searchPapers.js';
import { toolRegistry } from '../toolRegistry.js';

const fakeCtx = {
  runId: 'r',
  stepId: 's',
  ownerId: 'u',
  channel: 'private' as const,
  signal: new AbortController().signal,
};

const openAlexHit = {
  id: 'https://openalex.org/W123',
  title: 'Prospect Theory: An Analysis',
  publication_year: 1979,
  doi: 'https://doi.org/10.2307/1914185',
  cited_by_count: 75000,
  authorships: [{ author: { display_name: 'Daniel Kahneman' } }, { author: { display_name: 'Amos Tversky' } }],
  abstract_inverted_index: { 'Decision': [0], 'theory': [1] },
};

describe('search_papers tool', () => {
  beforeEach(() => { vi.unstubAllGlobals(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('registers both tools idempotently', () => {
    registerSearchPapers();
    registerSearchPapers();
    expect(toolRegistry.get('search_papers')).toBeDefined();
    expect(toolRegistry.get('get_paper_citations')).toBeDefined();
  });

  it('OpenAlex happy path → ok:true with mapped papers', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      expect(url).toContain('api.openalex.org/works');
      return new Response(JSON.stringify({ results: [openAlexHit] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }));
    const out = await searchPapersTool.handler({ query: 'prospect theory', topK: 5 }, fakeCtx);
    expect(out.ok).toBe(true);
    expect(out.papers).toHaveLength(1);
    expect(out.papers[0].title).toBe('Prospect Theory: An Analysis');
    expect(out.papers[0].source).toBe('openalex');
    expect(out.papers[0].authors).toContain('Daniel Kahneman');
  });

  it('OpenAlex 500 → fallback to CrossRef → ok:true with source=crossref', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url);
      if (url.includes('api.openalex.org')) {
        return new Response('upstream boom', { status: 500 });
      }
      if (url.includes('api.crossref.org')) {
        return new Response(
          JSON.stringify({
            message: {
              items: [
                {
                  DOI: '10.2307/1914185',
                  title: ['Prospect Theory'],
                  author: [{ given: 'Daniel', family: 'Kahneman' }],
                  issued: { 'date-parts': [[1979]] },
                  URL: 'https://doi.org/10.2307/1914185',
                  'is-referenced-by-count': 75000,
                },
              ],
            },
          }),
          { status: 200 },
        );
      }
      throw new Error('unexpected url ' + url);
    }));
    const out = await searchPapersTool.handler({ query: 'prospect theory' }, fakeCtx);
    expect(out.ok).toBe(true);
    expect(out.papers[0].source).toBe('crossref');
    expect(out.fallbackUsed).toBe('openalex_then_crossref');
    expect(calls.length).toBe(2);
  });

  it('both sources fail → ok:false', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 503 })));
    const out = await searchPapersTool.handler({ query: 'x' }, fakeCtx);
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/HTTP/);
  });

  it('AbortError re-throws', async () => {
    const ac = new AbortController();
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        (init.signal as AbortSignal).addEventListener('abort', () => {
          const err = new Error('aborted'); err.name = 'AbortError';
          reject(err);
        });
      });
    }));
    const p = searchPapersTool.handler({ query: 'x' }, { ...fakeCtx, signal: ac.signal });
    ac.abort();
    await expect(p).rejects.toThrow();
  });
});

describe('get_paper_citations tool', () => {
  beforeEach(() => { vi.unstubAllGlobals(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('OpenAlex cited_by happy path → ok:true with list', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      expect(url).toContain('cited_by');
      return new Response(
        JSON.stringify({ results: [openAlexHit] }),
        { status: 200 },
      );
    }));
    const out = await getPaperCitationsTool.handler({ paperId: 'W123' }, fakeCtx);
    expect(out.ok).toBe(true);
    expect(out.citations).toHaveLength(1);
  });

  it('missing paperId → ok:false', async () => {
    const out = await getPaperCitationsTool.handler({ paperId: '' } as any, fakeCtx);
    expect(out.ok).toBe(false);
  });
});
```

- [ ] **Step 2.2: Run the failing tests**

```bash
cd "/Users/hongpengwang/行动中止派" && npx vitest run -w @xzz/api --testPathPattern tools.searchPapers.test 2>&1 | tail -5
```

Expected: FAIL — module not found.

- [ ] **Step 2.3: Implement searchPapers.ts**

Create `apps/api/src/lib/agent/tools/searchPapers.ts`:

```typescript
import { toolRegistry, type ToolDef } from '../toolRegistry.js';

type SearchPapersInput = {
  query: string;
  yearFrom?: number;
  topK?: number;
};

type Paper = {
  id: string;
  title: string;
  authors: string[];
  year?: number;
  abstract?: string;
  doi?: string;
  url: string;
  citationCount?: number;
  source: 'openalex' | 'crossref';
};

type SearchPapersOutput = {
  ok: boolean;
  papers: Paper[];
  fallbackUsed?: 'openalex_then_crossref';
  error?: string;
};

type GetPaperCitationsInput = { paperId: string };
type GetPaperCitationsOutput = {
  ok: boolean;
  paperId: string;
  citations: Paper[];
  error?: string;
};

const USER_AGENT =
  process.env.OPENALEX_USER_AGENT?.trim() ||
  'agent-runtime-m2 (mailto:dev@example.com)';
const ABSTRACT_CAP = 1000;
const AUTHORS_CAP = 5;

/**
 * OpenAlex returns `abstract_inverted_index` (token→positions). Reconstruct linear text.
 */
function decodeInvertedAbstract(inv: Record<string, number[]> | null | undefined): string {
  if (!inv) return '';
  const positions: Array<[number, string]> = [];
  for (const [word, posList] of Object.entries(inv)) {
    for (const p of posList) positions.push([p, word]);
  }
  positions.sort((a, b) => a[0] - b[0]);
  return positions.map(([, w]) => w).join(' ').slice(0, ABSTRACT_CAP);
}

function mapOpenAlexWork(w: any): Paper {
  const id = String(w.id ?? '').replace('https://openalex.org/', '');
  return {
    id,
    title: w.title ?? '',
    authors: (w.authorships ?? [])
      .slice(0, AUTHORS_CAP)
      .map((a: any) => a?.author?.display_name ?? '')
      .filter(Boolean),
    year: w.publication_year ?? undefined,
    abstract: decodeInvertedAbstract(w.abstract_inverted_index),
    doi: typeof w.doi === 'string' ? w.doi.replace('https://doi.org/', '') : undefined,
    url: w.doi || `https://openalex.org/${id}`,
    citationCount: w.cited_by_count ?? undefined,
    source: 'openalex',
  };
}

function mapCrossRefWork(item: any): Paper {
  return {
    id: item.DOI ?? '',
    title: Array.isArray(item.title) ? item.title[0] : String(item.title ?? ''),
    authors: (item.author ?? [])
      .slice(0, AUTHORS_CAP)
      .map((a: any) => [a.given, a.family].filter(Boolean).join(' '))
      .filter(Boolean),
    year: item.issued?.['date-parts']?.[0]?.[0],
    doi: item.DOI,
    url: item.URL ?? (item.DOI ? `https://doi.org/${item.DOI}` : ''),
    citationCount: item['is-referenced-by-count'],
    source: 'crossref',
  };
}

async function queryOpenAlex(
  query: string,
  yearFrom: number | undefined,
  topK: number,
  signal: AbortSignal,
): Promise<Paper[]> {
  const params = new URLSearchParams({
    search: query,
    'per-page': String(topK),
  });
  if (yearFrom) params.set('filter', `from_publication_date:${yearFrom}-01-01`);
  const url = `https://api.openalex.org/works?${params}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal,
  });
  if (!res.ok) throw new Error(`OpenAlex HTTP ${res.status}`);
  const json = (await res.json()) as { results?: any[] };
  return (json.results ?? []).map(mapOpenAlexWork);
}

async function queryCrossRef(
  query: string,
  topK: number,
  signal: AbortSignal,
): Promise<Paper[]> {
  const params = new URLSearchParams({ query, rows: String(topK) });
  const url = `https://api.crossref.org/works?${params}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal,
  });
  if (!res.ok) throw new Error(`CrossRef HTTP ${res.status}`);
  const json = (await res.json()) as { message?: { items?: any[] } };
  return (json.message?.items ?? []).map(mapCrossRefWork);
}

export const searchPapersTool: ToolDef<SearchPapersInput, SearchPapersOutput> = {
  name: 'search_papers',
  description:
    'Search academic papers (OpenAlex primary, 250M works; CrossRef fallback). Use for theory names ("prospect theory"), author+topic queries, and "is there empirical evidence for X" questions. Prefer over search_web for academic claims.',
  inputSchema: {
    type: 'object',
    required: ['query'],
    properties: {
      query: { type: 'string' },
      yearFrom: { type: 'number', minimum: 1900, maximum: 2100 },
      topK: { type: 'number', minimum: 1, maximum: 20 },
    },
  },
  approvalMode: 'auto',
  costHint: 'low',
  hasSideEffects: false,
  idempotent: true,
  replyMeta: {
    summaryKind: 'list',
    failureHint:
      'OpenAlex / CrossRef 都失败可能是网络或上游故障。可换关键词；如学术词不出结果可改 search_web 走通用搜索。',
  },
  computeIdempotencyKey: (input) => {
    const i = input as SearchPapersInput;
    return `q:${i.query.trim().toLowerCase()}|yf:${i.yearFrom ?? 0}|n:${i.topK ?? 10}`;
  },
  async handler(input, ctx) {
    const topK = Math.max(1, Math.min(input.topK ?? 10, 20));
    try {
      const papers = await queryOpenAlex(input.query, input.yearFrom, topK, ctx.signal);
      if (papers.length > 0) {
        return { ok: true, papers };
      }
      // 0 hits → try CrossRef as a fallback too
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') throw e;
      // fall through to CrossRef
    }
    try {
      const papers = await queryCrossRef(input.query, topK, ctx.signal);
      return { ok: true, papers, fallbackUsed: 'openalex_then_crossref' };
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') throw e;
      return {
        ok: false,
        papers: [],
        fallbackUsed: 'openalex_then_crossref',
        error: e instanceof Error ? e.message : String(e),
      };
    }
  },
};

export const getPaperCitationsTool: ToolDef<
  GetPaperCitationsInput,
  GetPaperCitationsOutput
> = {
  name: 'get_paper_citations',
  description:
    'Fetch up to 20 papers citing a given OpenAlex Work ID (e.g. "W123456789"). Use to trace influence / find rebuttals / evaluate consensus.',
  inputSchema: {
    type: 'object',
    required: ['paperId'],
    properties: { paperId: { type: 'string' } },
  },
  approvalMode: 'auto',
  costHint: 'low',
  hasSideEffects: false,
  idempotent: true,
  replyMeta: {
    summaryKind: 'list',
    failureHint:
      '论文 ID 可能不存在或非 OpenAlex 格式（W 开头）。可先用 search_papers 拿到合法 id 再查引用。',
  },
  async handler(input, ctx) {
    const id = input.paperId?.trim();
    if (!id) return { ok: false, paperId: '', citations: [], error: 'paperId required' };
    try {
      const url = `https://api.openalex.org/works?filter=cites:${encodeURIComponent(id)}&per-page=20`;
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: ctx.signal,
      });
      if (!res.ok) {
        return { ok: false, paperId: id, citations: [], error: `HTTP ${res.status}` };
      }
      const json = (await res.json()) as { results?: any[] };
      return {
        ok: true,
        paperId: id,
        citations: (json.results ?? []).map(mapOpenAlexWork),
      };
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') throw e;
      return {
        ok: false,
        paperId: id,
        citations: [],
        error: e instanceof Error ? e.message : String(e),
      };
    }
  },
};

export function registerSearchPapers(): void {
  if (!toolRegistry.get(searchPapersTool.name)) toolRegistry.register(searchPapersTool);
  if (!toolRegistry.get(getPaperCitationsTool.name)) toolRegistry.register(getPaperCitationsTool);
}
```

- [ ] **Step 2.4: Adjust citations test URL match if needed**

The test in Step 2.1 expects URL to contain `'cited_by'`. The implementation uses `filter=cites:`. Fix the test to match the implementation:

Open `apps/api/src/lib/agent/__tests__/tools.searchPapers.test.ts`, find the citations happy path test, and replace `expect(url).toContain('cited_by')` with `expect(url).toContain('cites:')`.

- [ ] **Step 2.5: Run the tests (should pass)**

```bash
cd "/Users/hongpengwang/行动中止派" && npx vitest run -w @xzz/api --testPathPattern tools.searchPapers.test 2>&1 | tail -20
```

Expected: 7 passed.

- [ ] **Step 2.6: Register in registerAllTools + typecheck + commit**

Add `registerSearchPapers()` to the central registration file (same one touched in Step 1.21).

```bash
cd "/Users/hongpengwang/行动中止派/apps/api" && npx tsc --noEmit 2>&1 | tail -5
```

```bash
cd "/Users/hongpengwang/行动中止派" && git add apps/api/src/lib/agent/tools/searchPapers.ts apps/api/src/lib/agent/__tests__/tools.searchPapers.test.ts apps/api/src/lib/agent/registerAllTools.ts && git commit -m "feat(agent/m2): search_papers (OpenAlex+CrossRef) + get_paper_citations"
```

(Adjust paths if `registerAllTools.ts` is named differently.)

---

## Task 3: `critique_last_answer`

**Files:**
- Create: `apps/api/src/lib/agent/tools/critiqueLastAnswer.ts`
- Create: `apps/api/src/lib/agent/__tests__/tools.critiqueLastAnswer.test.ts`

- [ ] **Step 3.1: Write failing tests**

Create `apps/api/src/lib/agent/__tests__/tools.critiqueLastAnswer.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  critiqueLastAnswerTool,
  registerCritiqueLastAnswer,
} from '../tools/critiqueLastAnswer.js';
import { toolRegistry } from '../toolRegistry.js';

vi.mock('../runLlmClient.js', () => ({
  resolveLlmClient: vi.fn(),
}));
vi.mock('../store.js', () => ({
  listStepsByRunId: vi.fn(),
  getAgentRun: vi.fn(),
}));

import { resolveLlmClient } from '../runLlmClient.js';
import { listStepsByRunId, getAgentRun } from '../store.js';

const fakeCtx = {
  runId: 'r1',
  stepId: 's_critic',
  ownerId: 'u',
  channel: 'private' as const,
  signal: new AbortController().signal,
};

describe('critique_last_answer tool', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('registers idempotently', () => {
    registerCritiqueLastAnswer();
    registerCritiqueLastAnswer();
    expect(toolRegistry.get('critique_last_answer')).toBeDefined();
  });

  it('strict JSON response → criticisms parsed, shouldRevise=true', async () => {
    (getAgentRun as any).mockResolvedValue({
      id: 'r1', providerId: 'deepseek', modelId: 'deepseek-v4-pro',
    });
    (listStepsByRunId as any).mockResolvedValue([
      { idx: 0, kind: 'tool_call', toolName: 'search_papers', output: { papers: [{ title: 'X' }] } },
    ]);
    const chat = vi.fn().mockResolvedValue({
      content: JSON.stringify({
        criticisms: [
          { severity: 'high', category: 'unsupported_claim', description: '提了 12 篇但没引用' },
        ],
        overallAssessment: '论断缺引用',
        shouldRevise: true,
      }),
    });
    (resolveLlmClient as any).mockResolvedValue({ chat });

    const out = await critiqueLastAnswerTool.handler({}, fakeCtx);
    expect(out.ok).toBe(true);
    expect(out.criticisms).toHaveLength(1);
    expect(out.shouldRevise).toBe(true);
  });

  it('LLM returns markdown-fenced JSON → extractJsonCandidate handles it', async () => {
    (getAgentRun as any).mockResolvedValue({
      id: 'r1', providerId: 'deepseek', modelId: 'deepseek-v4-pro',
    });
    (listStepsByRunId as any).mockResolvedValue([
      { idx: 0, kind: 'tool_call', output: { foo: 'bar' } },
    ]);
    const fenced = '```json\n{"criticisms":[],"overallAssessment":"OK","shouldRevise":false}\n```';
    (resolveLlmClient as any).mockResolvedValue({ chat: vi.fn().mockResolvedValue({ content: fenced }) });

    const out = await critiqueLastAnswerTool.handler({}, fakeCtx);
    expect(out.ok).toBe(true);
    expect(out.shouldRevise).toBe(false);
  });

  it('LLM network error → ok:false (not throw)', async () => {
    (getAgentRun as any).mockResolvedValue({ id: 'r1', providerId: 'deepseek', modelId: 'm' });
    (listStepsByRunId as any).mockResolvedValue([
      { idx: 0, kind: 'tool_call', output: {} },
    ]);
    (resolveLlmClient as any).mockResolvedValue({
      chat: vi.fn().mockRejectedValue(new Error('network down')),
    });
    const out = await critiqueLastAnswerTool.handler({}, fakeCtx);
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/network down/);
  });

  it('LLM returns total garbage → ok:false with parse error', async () => {
    (getAgentRun as any).mockResolvedValue({ id: 'r1', providerId: 'deepseek', modelId: 'm' });
    (listStepsByRunId as any).mockResolvedValue([
      { idx: 0, kind: 'tool_call', output: {} },
    ]);
    (resolveLlmClient as any).mockResolvedValue({
      chat: vi.fn().mockResolvedValue({ content: 'not json at all' }),
    });
    const out = await critiqueLastAnswerTool.handler({}, fakeCtx);
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/parse/i);
  });

  it('AbortError re-throws', async () => {
    (getAgentRun as any).mockResolvedValue({ id: 'r1', providerId: 'deepseek', modelId: 'm' });
    (listStepsByRunId as any).mockResolvedValue([{ idx: 0, kind: 'tool_call', output: {} }]);
    (resolveLlmClient as any).mockResolvedValue({
      chat: vi.fn().mockImplementation(() => {
        const err = new Error('aborted'); err.name = 'AbortError'; throw err;
      }),
    });
    await expect(critiqueLastAnswerTool.handler({}, fakeCtx)).rejects.toThrow();
  });

  it('no prior steps → ok:false', async () => {
    (getAgentRun as any).mockResolvedValue({ id: 'r1', providerId: 'deepseek', modelId: 'm' });
    (listStepsByRunId as any).mockResolvedValue([]);
    const out = await critiqueLastAnswerTool.handler({}, fakeCtx);
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/no prior step/i);
  });
});
```

- [ ] **Step 3.2: Run the failing tests**

```bash
cd "/Users/hongpengwang/行动中止派" && npx vitest run -w @xzz/api --testPathPattern tools.critiqueLastAnswer.test 2>&1 | tail -5
```

Expected: FAIL — module not found.

- [ ] **Step 3.3: Implement critiqueLastAnswer.ts**

First confirm `listStepsByRunId` exists in store.ts:

```bash
cd "/Users/hongpengwang/行动中止派" && rg "listStepsByRunId|listSteps|getStepsByRun" apps/api/src/lib/agent/store.ts -n
```

If it has a different name, adjust both the test mock and the import below. Same for the LLM client helper — confirm `resolveLlmClient` is exported from `runLlmClient.ts`.

Create `apps/api/src/lib/agent/tools/critiqueLastAnswer.ts`:

```typescript
import { toolRegistry, type ToolDef } from '../toolRegistry.js';
import { resolveLlmClient } from '../runLlmClient.js';
import { listStepsByRunId, getAgentRun } from '../store.js';
import { extractJsonCandidate } from '../planner.js';

type CritiqueInput = {
  targetStepIdx?: number;
  focusAreas?: string[];
};

type Criticism = {
  severity: 'high' | 'medium' | 'low';
  category: string;
  description: string;
};

type CritiqueOutput = {
  ok: boolean;
  criticisms: Criticism[];
  overallAssessment: string;
  shouldRevise: boolean;
  error?: string;
};

const CRITIC_SYSTEM = `你是严谨的学术 critic。读取另一个 LLM 刚刚的输出 / 工具调用 / 推理，找出以下问题：
- unsupported_claim：声明了什么没有引用支持
- overconfident：用了"显然/必然/无疑"等过度自信表述
- logical_jump：A→B 之间缺中间论证
- factual_error：与已知事实矛盾
- other：其他严肃讨论中的硬伤

输出**严格 JSON**，结构：
{
  "criticisms": [{"severity": "high|medium|low", "category": "...", "description": "..."}],
  "overallAssessment": "1-2 句总评",
  "shouldRevise": true|false
}
如无问题，criticisms 为空数组、shouldRevise: false。
不要 markdown 围栏，不要解释，只输出 JSON。`;

function summarizeStepForCritic(step: any): string {
  const out = step.output;
  if (out == null) return `step #${step.idx} (${step.kind}): <no output>`;
  const json = JSON.stringify(out).slice(0, 3000);
  return `step #${step.idx} (${step.kind}, tool=${step.toolName ?? 'n/a'}): ${json}`;
}

export const critiqueLastAnswerTool: ToolDef<CritiqueInput, CritiqueOutput> = {
  name: 'critique_last_answer',
  description:
    'Have a critic LLM review the most recent agent step (or one specified by targetStepIdx) and find unsupported claims, overconfidence, logical jumps, or factual errors. Use AFTER a step that makes substantive claims (e.g. after search_papers + your synthesis, before final reply). Returns shouldRevise:true if serious issues found — planner should then add a corrective step.',
  inputSchema: {
    type: 'object',
    properties: {
      targetStepIdx: { type: 'number', minimum: 0 },
      focusAreas: { type: 'array', items: { type: 'string' } },
    },
  },
  approvalMode: 'auto',
  costHint: 'low',
  hasSideEffects: false,
  idempotent: true,
  replyMeta: {
    summaryKind: 'silent',
    failureHint:
      'Critic LLM 调用失败常见原因：LLM 网络故障 / JSON 解析失败。可重试一次；持续失败跳过批评直接出 reply。',
  },
  async handler(input, ctx) {
    try {
      const run = await getAgentRun(ctx.runId);
      if (!run) return { ok: false, criticisms: [], overallAssessment: '', shouldRevise: false, error: 'run not found' };

      const steps = await listStepsByRunId(ctx.runId);
      const candidate = typeof input.targetStepIdx === 'number'
        ? steps.find((s: any) => s.idx === input.targetStepIdx)
        : [...steps].reverse().find((s: any) => s.kind === 'tool_call' || s.kind === 'observe');
      if (!candidate) {
        return { ok: false, criticisms: [], overallAssessment: '', shouldRevise: false, error: 'no prior step to critique' };
      }

      const focusBlock = input.focusAreas?.length
        ? `\n# 关注角度\n${input.focusAreas.join('、')}`
        : '';
      const userPrompt = `${focusBlock}\n# 被批评的 step\n${summarizeStepForCritic(candidate)}`;

      const client = await resolveLlmClient({
        runId: ctx.runId,
        providerId: (run as any).providerId,
        modelId: (run as any).modelId,
      });

      const result = await client.chat({
        system: CRITIC_SYSTEM,
        user: userPrompt,
        signal: ctx.signal,
      });
      const candidateJson = extractJsonCandidate(result.content);
      if (!candidateJson) {
        return {
          ok: false,
          criticisms: [],
          overallAssessment: '',
          shouldRevise: false,
          error: 'critic JSON parse failed',
        };
      }
      let parsed: any;
      try {
        parsed = JSON.parse(candidateJson);
      } catch (e) {
        return {
          ok: false,
          criticisms: [],
          overallAssessment: '',
          shouldRevise: false,
          error: `critic JSON parse failed: ${e instanceof Error ? e.message : String(e)}`,
        };
      }
      return {
        ok: true,
        criticisms: Array.isArray(parsed.criticisms) ? parsed.criticisms.slice(0, 10) : [],
        overallAssessment: String(parsed.overallAssessment ?? ''),
        shouldRevise: Boolean(parsed.shouldRevise),
      };
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') throw e;
      return {
        ok: false,
        criticisms: [],
        overallAssessment: '',
        shouldRevise: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  },
};

export function registerCritiqueLastAnswer(): void {
  if (!toolRegistry.get(critiqueLastAnswerTool.name)) {
    toolRegistry.register(critiqueLastAnswerTool);
  }
}
```

- [ ] **Step 3.4: Verify extractJsonCandidate is exported from planner.ts**

```bash
cd "/Users/hongpengwang/行动中止派" && rg "export.*extractJsonCandidate" apps/api/src/lib/agent/planner.ts
```

If not exported, add `export` keyword (the M1f Task 4 added this function — confirm with grep). If the function lives elsewhere (e.g. its own file), update the import.

- [ ] **Step 3.5: Verify `resolveLlmClient` signature matches**

```bash
cd "/Users/hongpengwang/行动中止派" && rg "export.*resolveLlmClient" apps/api/src/lib/agent/runLlmClient.ts -A 10
```

Confirm it accepts `{ runId, providerId, modelId }` and returns something with `.chat({ system, user, signal })`. If the signature differs (likely `.chat(messages, opts)` or `.chatCompletion(...)`), adapt the call in `critiqueLastAnswer.ts` accordingly. The principle: same call style as planner.ts uses.

- [ ] **Step 3.6: Run tests (should pass)**

```bash
cd "/Users/hongpengwang/行动中止派" && npx vitest run -w @xzz/api --testPathPattern tools.critiqueLastAnswer.test 2>&1 | tail -20
```

Expected: 7 passed. If some fail because the LLM client mock shape doesn't match, adjust mocks to match the real `resolveLlmClient` return shape.

- [ ] **Step 3.7: Register + typecheck + commit**

Add `registerCritiqueLastAnswer()` to the central registration file.

```bash
cd "/Users/hongpengwang/行动中止派/apps/api" && npx tsc --noEmit 2>&1 | tail -5
cd "/Users/hongpengwang/行动中止派" && git add apps/api/src/lib/agent/tools/critiqueLastAnswer.ts apps/api/src/lib/agent/__tests__/tools.critiqueLastAnswer.test.ts apps/api/src/lib/agent/registerAllTools.ts && git commit -m "feat(agent/m2): critique_last_answer tool"
```

---

## Task 4: `fetch_url` (Jina Reader) + `search_web` rename + `datetime_now`

This task does THREE things in one commit cluster because they're all small text-level changes that affect many cross-refs.

**Files:**
- Create: `apps/api/src/lib/agent/tools/fetchUrl.ts`
- Create: `apps/api/src/lib/agent/__tests__/tools.fetchUrl.test.ts`
- Create: `apps/api/src/lib/agent/tools/datetimeNow.ts`
- Create: `apps/api/src/lib/agent/__tests__/tools.datetimeNow.test.ts`
- Delete: `apps/api/src/lib/agent/tools/urlFetch.ts`
- Delete: `apps/api/src/lib/agent/__tests__/tools.urlFetch.test.ts`
- Modify: `apps/api/src/lib/agent/tools/webSearch.ts` (`name: 'web_search'` → `name: 'search_web'`)
- Modify: `apps/api/package.json` (remove `jsdom`, `@mozilla/readability`)
- Modify: `apps/api/src/lib/agent/registerAllTools.ts` (replace `registerUrlFetch` with `registerFetchUrl`; add `registerDatetimeNow`)
- Modify: anything else that grep finds for `'web_search'` and `'url_fetch'` literals (planner prompt tests, intentExecute defaults, fixtures)

### 4A. `fetch_url` Jina-backed

- [ ] **Step 4.1: Write failing test for fetchUrl**

Create `apps/api/src/lib/agent/__tests__/tools.fetchUrl.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchUrlTool, registerFetchUrl } from '../tools/fetchUrl.js';
import { toolRegistry } from '../toolRegistry.js';

const fakeCtx = {
  runId: 'r', stepId: 's', ownerId: 'u', channel: 'private' as const,
  signal: new AbortController().signal,
};

describe('fetch_url (Jina) tool', () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('registers idempotently', () => {
    registerFetchUrl();
    registerFetchUrl();
    expect(toolRegistry.get('fetch_url')).toBeDefined();
  });

  it('Jina 200 → ok:true with markdown content + title', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      expect(url).toContain('r.jina.ai');
      return new Response(
        'Title: 家族信托入门\n\n# 家族信托入门\n\n段落内容...',
        { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
      );
    }));
    const out = await fetchUrlTool.handler({ url: 'https://example.com/trust' }, fakeCtx);
    expect(out.ok).toBe(true);
    expect(out.content).toContain('家族信托');
    expect(out.title).toBe('家族信托入门');
    expect(out.url).toBe('https://example.com/trust');
  });

  it('Jina 404 → ok:false', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not found', { status: 404 })));
    const out = await fetchUrlTool.handler({ url: 'https://x.com/gone' }, fakeCtx);
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/HTTP 404/);
  });

  it('content over 1MB → truncated:true', async () => {
    const huge = 'a'.repeat(2 * 1024 * 1024);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(huge, { status: 200 })));
    const out = await fetchUrlTool.handler({ url: 'https://x.com/big' }, fakeCtx);
    expect(out.truncated).toBe(true);
    expect(out.content.length).toBeLessThanOrEqual(24 * 1024);
  });

  it('AbortError re-throws', async () => {
    const ac = new AbortController();
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      return new Promise((_r, reject) => {
        (init.signal as AbortSignal).addEventListener('abort', () => {
          const err = new Error('aborted'); err.name = 'AbortError'; reject(err);
        });
      });
    }));
    const p = fetchUrlTool.handler({ url: 'https://x.com/slow' }, { ...fakeCtx, signal: ac.signal });
    ac.abort();
    await expect(p).rejects.toThrow();
  });

  it('attaches Authorization header when JINA_API_KEY is set', async () => {
    process.env.JINA_API_KEY = 'test-jina-key';
    const fetchSpy = vi.fn(async () => new Response('Title: t\n\nbody', { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    await fetchUrlTool.handler({ url: 'https://x.com/with-key' }, fakeCtx);
    const [, init] = fetchSpy.mock.calls[0];
    expect((init?.headers as any).Authorization).toBe('Bearer test-jina-key');
    delete process.env.JINA_API_KEY;
  });

  it('extractRef returns url ref on success', () => {
    const ref = fetchUrlTool.replyMeta!.extractRef!({
      ok: true,
      url: 'https://x.com/a',
      title: 'X',
      content: 'body',
      truncated: false,
    });
    expect(ref).toEqual({ kind: 'url', id: 'https://x.com/a', label: 'X' });
  });
});
```

- [ ] **Step 4.2: Run failing tests**

```bash
cd "/Users/hongpengwang/行动中止派" && npx vitest run -w @xzz/api --testPathPattern tools.fetchUrl.test 2>&1 | tail -5
```

Expected: FAIL — module not found.

- [ ] **Step 4.3: Implement fetchUrl.ts**

Create `apps/api/src/lib/agent/tools/fetchUrl.ts`:

```typescript
import { toolRegistry, type ToolDef } from '../toolRegistry.js';

type FetchUrlInput = { url: string };

type FetchUrlOutput = {
  ok: boolean;
  url: string;
  title: string;
  content: string;
  truncated: boolean;
  error?: string;
};

const MAX_CHARS = 24 * 1024;

/**
 * Parse Jina Reader output. r.jina.ai prefixes the markdown with metadata
 * lines like "Title: ...", "URL Source: ...", followed by a blank line then body.
 */
function parseJinaResponse(raw: string): { title: string; body: string } {
  const lines = raw.split('\n');
  let title = '';
  let i = 0;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('Title: ')) title = line.slice(7).trim();
    else if (line.trim() === '') { i++; break; }
    else if (!/^(URL Source|Markdown Content|Content-Length):/i.test(line)) {
      // metadata ended without blank line — treat rest as body
      break;
    }
  }
  return { title, body: lines.slice(i).join('\n').trim() };
}

export const fetchUrlTool: ToolDef<FetchUrlInput, FetchUrlOutput> = {
  name: 'fetch_url',
  description:
    'Fetch a URL and extract its main readable content as markdown (via Jina Reader). Use after search_web / search_papers to deeply read a result, or when the user pastes a link.',
  inputSchema: {
    type: 'object',
    required: ['url'],
    properties: { url: { type: 'string' } },
  },
  approvalMode: 'auto',
  costHint: 'low',
  hasSideEffects: false,
  idempotent: true,
  replyMeta: {
    summaryKind: 'text',
    extractRef: (output: unknown) => {
      const o = output as FetchUrlOutput;
      if (!o?.ok || !o.url) return null;
      return { kind: 'url' as const, id: o.url, label: o.title || o.url };
    },
    failureHint:
      '该 URL 可能 404 / 超时 / 内容是 PDF/视频等非文本。可跳过此 URL 用其他搜索结果；学术 PDF 改用 search_papers 拿 abstract。',
  },
  computeIdempotencyKey: (input) => `url:${(input as FetchUrlInput).url.trim()}`,
  async handler(input, ctx) {
    const jinaUrl = `https://r.jina.ai/${input.url}`;
    const apiKey = process.env.JINA_API_KEY?.trim();
    const headers: Record<string, string> = {
      Accept: 'text/plain',
      'X-With-Links-Summary': 'true',
    };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    try {
      const res = await fetch(jinaUrl, { headers, signal: ctx.signal });
      if (!res.ok) {
        return {
          ok: false, url: input.url, title: '', content: '', truncated: false,
          error: `HTTP ${res.status} from Jina Reader`,
        };
      }
      const raw = await res.text();
      const { title, body } = parseJinaResponse(raw);
      const truncated = body.length > MAX_CHARS;
      return {
        ok: true,
        url: input.url,
        title,
        content: truncated ? body.slice(0, MAX_CHARS) : body,
        truncated,
      };
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') throw e;
      return {
        ok: false, url: input.url, title: '', content: '', truncated: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  },
};

export function registerFetchUrl(): void {
  if (!toolRegistry.get(fetchUrlTool.name)) {
    toolRegistry.register(fetchUrlTool);
  }
}
```

- [ ] **Step 4.4: Run fetchUrl tests (should pass)**

```bash
cd "/Users/hongpengwang/行动中止派" && npx vitest run -w @xzz/api --testPathPattern tools.fetchUrl.test 2>&1 | tail -20
```

Expected: 6 passed.

- [ ] **Step 4.5: Delete urlFetch.ts and its test**

```bash
cd "/Users/hongpengwang/行动中止派" && git rm apps/api/src/lib/agent/tools/urlFetch.ts apps/api/src/lib/agent/__tests__/tools.urlFetch.test.ts
```

- [ ] **Step 4.6: Remove jsdom + readability from package.json**

```bash
cd "/Users/hongpengwang/行动中止派" && npm uninstall jsdom @mozilla/readability -w @xzz/api
```

Expected: removes both. Check `apps/api/package.json` — `dependencies` no longer lists either.

- [ ] **Step 4.7: Find + fix all references to old `url_fetch` registration**

```bash
cd "/Users/hongpengwang/行动中止派" && rg "registerUrlFetch|urlFetchTool|'url_fetch'|\"url_fetch\"" apps/api/src -l
```

For each file found, replace `registerUrlFetch` → `registerFetchUrl`, `urlFetchTool` → `fetchUrlTool`, and string literals `'url_fetch'` / `"url_fetch"` → `'fetch_url'` / `"fetch_url"`. Use StrReplace per-file (not bulk sed).

### 4B. `search_web` rename

- [ ] **Step 4.8: Rename web_search → search_web**

In `apps/api/src/lib/agent/tools/webSearch.ts`, change:

```typescript
  name: 'web_search',
```

to:

```typescript
  name: 'search_web',
```

Also update the docstring/description first line so the LLM understands the renamed convention is intentional:

```typescript
  description:
    'Search the public web (Tavily). Use for current events, news, blog posts, or non-academic topics. For academic claims use search_papers instead.',
```

- [ ] **Step 4.9: Find + fix all literal references to `'web_search'`**

```bash
cd "/Users/hongpengwang/行动中止派" && rg "'web_search'|\"web_search\"" apps/api/src -l
```

For each file, replace `'web_search'` → `'search_web'`. Include test fixtures, intentExecute defaults, planner test snapshots. Use StrReplace per-file.

Don't rename `webSearch.ts` filename, `webSearchTool` symbol, or `registerWebSearch` function — those are internal Node-side names; only the LLM-facing `name` field matters for behavior. (M1f-style: minimize blast radius.)

### 4C. `datetime_now`

- [ ] **Step 4.10: Write failing test for datetimeNow**

Create `apps/api/src/lib/agent/__tests__/tools.datetimeNow.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { datetimeNowTool, registerDatetimeNow } from '../tools/datetimeNow.js';
import { toolRegistry } from '../toolRegistry.js';

const fakeCtx = {
  runId: 'r', stepId: 's', ownerId: 'u', channel: 'private' as const,
  signal: new AbortController().signal,
};

describe('datetime_now tool', () => {
  it('registers idempotently', () => {
    registerDatetimeNow();
    registerDatetimeNow();
    expect(toolRegistry.get('datetime_now')).toBeDefined();
  });

  it('returns ISO + dayOfWeek + timezone (UTC)', async () => {
    const out = await datetimeNowTool.handler({}, fakeCtx);
    expect(out.ok).toBe(true);
    expect(out.iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']).toContain(out.dayOfWeek);
    expect(out.timezone).toBe('UTC');
  });
});
```

- [ ] **Step 4.11: Run failing test**

```bash
cd "/Users/hongpengwang/行动中止派" && npx vitest run -w @xzz/api --testPathPattern tools.datetimeNow.test 2>&1 | tail -5
```

Expected: FAIL — module not found.

- [ ] **Step 4.12: Implement datetimeNow.ts**

Create `apps/api/src/lib/agent/tools/datetimeNow.ts`:

```typescript
import { toolRegistry, type ToolDef } from '../toolRegistry.js';

type DatetimeNowOutput = {
  ok: true;
  iso: string;
  dayOfWeek: 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun';
  timezone: 'UTC';
};

const DAYS: Array<DatetimeNowOutput['dayOfWeek']> = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const datetimeNowTool: ToolDef<Record<string, never>, DatetimeNowOutput> = {
  name: 'datetime_now',
  description:
    'Return the current UTC time. Use whenever the user asks about "today", "this week", or anything time-relative. LLMs frequently miscalculate dates from training-data cutoffs — call this tool first.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  approvalMode: 'auto',
  costHint: 'low',
  hasSideEffects: false,
  idempotent: false,
  replyMeta: { summaryKind: 'text' },
  async handler() {
    const now = new Date();
    return {
      ok: true,
      iso: now.toISOString(),
      dayOfWeek: DAYS[now.getUTCDay()],
      timezone: 'UTC',
    };
  },
};

export function registerDatetimeNow(): void {
  if (!toolRegistry.get(datetimeNowTool.name)) {
    toolRegistry.register(datetimeNowTool);
  }
}
```

- [ ] **Step 4.13: Run datetimeNow tests (should pass)**

```bash
cd "/Users/hongpengwang/行动中止派" && npx vitest run -w @xzz/api --testPathPattern tools.datetimeNow.test 2>&1 | tail -10
```

Expected: 2 passed.

- [ ] **Step 4.14: Register fetch_url + datetime_now**

In the central registration file, replace `registerUrlFetch()` with `registerFetchUrl()` and add `registerDatetimeNow()`.

- [ ] **Step 4.15: Run full test suite to catch broken cross-refs**

```bash
cd "/Users/hongpengwang/行动中止派" && npx vitest run -w @xzz/api 2>&1 | tail -15
```

If anything red: most likely tests that hardcode `'url_fetch'` or `'web_search'` strings. Fix by repeating Step 4.7 and 4.9 grep+replace.

- [ ] **Step 4.16: Typecheck + commit Task 4**

```bash
cd "/Users/hongpengwang/行动中止派/apps/api" && npx tsc --noEmit 2>&1 | tail -5
```

```bash
cd "/Users/hongpengwang/行动中止派" && git add -A && git commit -m "feat(agent/m2): fetch_url (Jina) replaces url_fetch; rename web_search→search_web; add datetime_now"
```

---

## Task 5: `render_diagram` + mobile mermaid component

**Files:**
- Create: `apps/api/src/lib/agent/tools/renderDiagram.ts`
- Create: `apps/api/src/lib/agent/__tests__/tools.renderDiagram.test.ts`
- Create: `apps/mobile/src/components/DiagramMessage.tsx`
- Modify: `apps/api/src/lib/agent/replyGen.ts` (add `diagram` kind to ReplyRef rendering)
- Modify: mobile message renderer (wherever `type` switches happen — usually `ChatScreen.tsx` or a `MessageItem` component)

### 5A. Backend tool

- [ ] **Step 5.1: Find how a "message row" is inserted today**

```bash
cd "/Users/hongpengwang/行动中止派" && rg "INSERT INTO messages|insertMessage|appendMessage" apps/api/src/lib --type ts -l
```

You need to know what helper to call from `renderDiagram.ts`. If you find e.g. `messageStore.insertMessage({ topicId, type, content, meta })`, the tool will call that. If the codebase uses raw SQL via `getPool().query`, do that. Document the signature you'll use in the test mock.

For this plan, assume the insertion helper is `await getPool().query("INSERT INTO messages ... RETURNING id", [...])`. Adapt to actual helper found above.

- [ ] **Step 5.2: Write failing tests**

Create `apps/api/src/lib/agent/__tests__/tools.renderDiagram.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderDiagramTool, registerRenderDiagram } from '../tools/renderDiagram.js';
import { toolRegistry } from '../toolRegistry.js';

vi.mock('../../../db/client.js', () => ({
  getPool: () => ({
    query: vi.fn(async (_sql: string, _params: any[]) => ({
      rows: [{ id: 'msg_diag_1' }],
    })),
  }),
}));

const fakeCtx = {
  runId: 'r', stepId: 's', ownerId: 'u',
  channel: 'private' as const,
  topicId: 't1',
  signal: new AbortController().signal,
};

describe('render_diagram tool', () => {
  beforeEach(() => vi.clearAllMocks());

  it('registers idempotently', () => {
    registerRenderDiagram();
    registerRenderDiagram();
    expect(toolRegistry.get('render_diagram')).toBeDefined();
  });

  it('valid mermaid → ok:true with diagramId and no warnings', async () => {
    const out = await renderDiagramTool.handler(
      { mermaid: 'graph TD\n  A-->B', title: '示意图' },
      fakeCtx,
    );
    expect(out.ok).toBe(true);
    expect(out.diagramId).toBe('msg_diag_1');
    expect(out.title).toBe('示意图');
    expect(out.validationWarnings).toEqual([]);
  });

  it('invalid first token → ok:true with non-empty validationWarnings (not fatal)', async () => {
    const out = await renderDiagramTool.handler(
      { mermaid: 'banana TD\n A-->B', title: 't' },
      fakeCtx,
    );
    expect(out.ok).toBe(true);
    expect(out.validationWarnings.length).toBeGreaterThan(0);
  });

  it('mermaid over 8KB → ok:false', async () => {
    const huge = 'graph TD\n  ' + 'A-->B\n  '.repeat(2000);
    const out = await renderDiagramTool.handler(
      { mermaid: huge, title: 't' },
      fakeCtx,
    );
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/too large/);
  });

  it('extractRef returns diagram kind ref', () => {
    const ref = renderDiagramTool.replyMeta!.extractRef!({
      ok: true,
      diagramId: 'msg_diag_1',
      title: '示意图',
      validationWarnings: [],
    });
    expect(ref).toEqual({ kind: 'diagram', id: 'msg_diag_1', label: '示意图' });
  });

  it('handler propagates topicId to insert', async () => {
    const out = await renderDiagramTool.handler(
      { mermaid: 'graph TD\n A-->B', title: 't' },
      fakeCtx,
    );
    expect(out.ok).toBe(true);
    // 实际 SQL params 校验可在 future smoke 加；此处只确认 ok 路径不抛
  });
});
```

- [ ] **Step 5.3: Run failing tests**

```bash
cd "/Users/hongpengwang/行动中止派" && npx vitest run -w @xzz/api --testPathPattern tools.renderDiagram.test 2>&1 | tail -5
```

Expected: FAIL — module not found.

- [ ] **Step 5.4: Implement renderDiagram.ts**

Create `apps/api/src/lib/agent/tools/renderDiagram.ts`:

```typescript
import { toolRegistry, type ToolDef } from '../toolRegistry.js';
import { getPool } from '../../../db/client.js';

type RenderDiagramInput = {
  mermaid: string;
  title: string;
};

type RenderDiagramOutput = {
  ok: boolean;
  diagramId: string;
  title: string;
  validationWarnings: string[];
  error?: string;
};

const MAX_BYTES = 8 * 1024;
const VALID_FIRST_TOKENS = new Set([
  'graph', 'flowchart', 'sequenceDiagram', 'classDiagram', 'stateDiagram',
  'stateDiagram-v2', 'erDiagram', 'gantt', 'pie', 'mindmap', 'timeline',
  'journey', 'gitGraph', 'C4Context', 'requirementDiagram', 'quadrantChart',
]);

function validate(mermaid: string): string[] {
  const warnings: string[] = [];
  const firstToken = mermaid.trim().split(/\s+/)[0] ?? '';
  if (!VALID_FIRST_TOKENS.has(firstToken)) {
    warnings.push(
      `首行 token "${firstToken}" 不是已知 mermaid 图类型。常用：graph TD / flowchart LR / sequenceDiagram / classDiagram 等。`,
    );
  }
  return warnings;
}

export const renderDiagramTool: ToolDef<RenderDiagramInput, RenderDiagramOutput> = {
  name: 'render_diagram',
  description:
    'Render a Mermaid diagram (concept graph, flowchart, sequence, causal map, etc.) into the chat. Use for visualizing relationships between concepts, decision trees, or process flows. Input is Mermaid source — mobile renders it to SVG.',
  inputSchema: {
    type: 'object',
    required: ['mermaid', 'title'],
    properties: {
      mermaid: { type: 'string' },
      title: { type: 'string' },
    },
  },
  approvalMode: 'auto',
  costHint: 'low',
  hasSideEffects: true,           // 写一条 message 行
  idempotent: false,
  replyMeta: {
    summaryKind: 'silent',
    extractRef: (output: unknown) => {
      const o = output as RenderDiagramOutput;
      if (!o?.ok || !o.diagramId) return null;
      return { kind: 'diagram' as const, id: o.diagramId, label: o.title };
    },
    failureHint:
      'mermaid 渲染失败一般是语法错误。检查 validationWarnings；常见错：标签里有特殊字符（用 [] 引号包），或方向声明缺失（graph TD 开头）。',
  },
  async handler(input, ctx) {
    if (Buffer.byteLength(input.mermaid, 'utf-8') > MAX_BYTES) {
      return {
        ok: false, diagramId: '', title: input.title, validationWarnings: [],
        error: `mermaid source too large: ${Buffer.byteLength(input.mermaid, 'utf-8')} > ${MAX_BYTES}`,
      };
    }
    const warnings = validate(input.mermaid);
    try {
      const { rows } = await getPool().query(
        `INSERT INTO messages (id, owner_id, topic_id, type, content, meta, created_at)
         VALUES (gen_random_uuid()::text, $1, $2, 'diagram', $3, $4, NOW())
         RETURNING id`,
        [
          ctx.ownerId,
          ctx.topicId ?? null,
          input.mermaid,
          JSON.stringify({ title: input.title, runId: ctx.runId, stepId: ctx.stepId }),
        ],
      );
      const diagramId = rows[0]?.id as string;
      return { ok: true, diagramId, title: input.title, validationWarnings: warnings };
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') throw e;
      return {
        ok: false, diagramId: '', title: input.title, validationWarnings: warnings,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  },
};

export function registerRenderDiagram(): void {
  if (!toolRegistry.get(renderDiagramTool.name)) {
    toolRegistry.register(renderDiagramTool);
  }
}
```

**IMPORTANT**: The actual `messages` table schema may differ. Before running this step, confirm with:

```bash
cd "/Users/hongpengwang/行动中止派" && psql "$DATABASE_URL" -c "\d messages"
```

Adjust the INSERT columns to match. If columns like `topic_id` don't exist (e.g. private vs group split tables), use the existing helper `writePrivatePlaceholder` style of indirection.

- [ ] **Step 5.5: Run tests (should pass)**

```bash
cd "/Users/hongpengwang/行动中止派" && npx vitest run -w @xzz/api --testPathPattern tools.renderDiagram.test 2>&1 | tail -10
```

Expected: 5 passed (or 4 if the topicId smoke is skipped).

- [ ] **Step 5.6: Wire `diagram` kind into ReplyRef rendering**

Open `apps/api/src/lib/agent/replyGen.ts`. Find where ReplyRef kinds are handled (grep for `kind === 'document'` or `kind === 'url'`). Add a `diagram` branch:

```typescript
// Inside the rendering switch / map:
case 'diagram':
  return `[图表] ${ref.label ?? ref.id} (id: ${ref.id})`;
```

Also extend the TypeScript type `ReplyRef` to include `'diagram'` in its `kind` union — find it (likely in same file or types.ts) and add `| 'diagram'`.

- [ ] **Step 5.7: Register render_diagram + commit backend**

Add `registerRenderDiagram()` to the central registration file.

```bash
cd "/Users/hongpengwang/行动中止派/apps/api" && npx tsc --noEmit 2>&1 | tail -5
cd "/Users/hongpengwang/行动中止派" && git add apps/api/src/lib/agent/tools/renderDiagram.ts apps/api/src/lib/agent/__tests__/tools.renderDiagram.test.ts apps/api/src/lib/agent/replyGen.ts apps/api/src/lib/agent/registerAllTools.ts && git commit -m "feat(agent/m2): render_diagram tool + diagram ReplyRef kind"
```

### 5B. Mobile mermaid component

- [ ] **Step 5.8: Confirm react-native-webview is installed**

```bash
cd "/Users/hongpengwang/行动中止派" && rg "react-native-webview" apps/mobile/package.json
```

If missing:

```bash
cd "/Users/hongpengwang/行动中止派" && npx expo install react-native-webview -w @xzz/mobile
```

Use whatever package manager the mobile app uses (`expo install` for Expo, `npm install` otherwise). Pin to whatever installs.

- [ ] **Step 5.9: Find where messages are rendered**

```bash
cd "/Users/hongpengwang/行动中止派" && rg "type === 'text'|message\.type|switch.*type" apps/mobile/src -l --type tsx --type ts
```

Identify the file that switches on message type (likely `apps/mobile/src/components/MessageItem.tsx` or in `ChatScreen.tsx`). Note its path — you'll add a `'diagram'` branch.

- [ ] **Step 5.10: Implement DiagramMessage.tsx**

Create `apps/mobile/src/components/DiagramMessage.tsx`:

```typescript
import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import WebView from 'react-native-webview';

type Props = {
  mermaid: string;
  title?: string;
};

/**
 * M2 Task 5B: Render a Mermaid diagram inline.
 *
 * Strategy: WebView with mermaid loaded from CDN (jsDelivr). This avoids
 * shipping ~2MB of mermaid JS in the bundle. On WebView failure (no network,
 * CDN down), fallback to a code-block showing the raw mermaid source.
 */
export default function DiagramMessage({ mermaid, title }: Props) {
  const [failed, setFailed] = useState(false);

  const html = useMemo(() => {
    // 安全：mermaid 字符串嵌进 HTML 模板。我们用 <pre> 包裹原文，mermaid.js 自己 escape。
    const escaped = mermaid
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return `<!doctype html>
<html><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  body { margin: 0; padding: 12px; background: #fff; font-family: -apple-system, sans-serif; }
  .mermaid { text-align: center; }
</style>
</head><body>
<pre class="mermaid">${escaped}</pre>
<script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
<script>
  try {
    mermaid.initialize({ startOnLoad: true, theme: 'default', securityLevel: 'strict' });
  } catch (e) {
    document.body.innerHTML = '<p style="color:red">mermaid 渲染失败：' + e.message + '</p>';
  }
</script>
</body></html>`;
  }, [mermaid]);

  if (failed) {
    return (
      <View style={styles.fallback}>
        {title ? <Text style={styles.title}>{title}（渲染失败，展示源码）</Text> : null}
        <ScrollView horizontal style={styles.scroller}>
          <Text style={styles.code}>{mermaid}</Text>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      <WebView
        originWhitelist={['*']}
        source={{ html }}
        style={styles.webview}
        scalesPageToFit
        javaScriptEnabled
        onError={() => setFailed(true)}
        onHttpError={() => setFailed(true)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { width: '100%', minHeight: 240, backgroundColor: '#fff', borderRadius: 8, overflow: 'hidden' },
  title: { fontSize: 14, fontWeight: '600', padding: 8, color: '#333' },
  webview: { flex: 1, minHeight: 200 },
  fallback: { padding: 12, backgroundColor: '#f7f7f7', borderRadius: 8 },
  scroller: { maxHeight: 200 },
  code: { fontFamily: 'Menlo', fontSize: 12, color: '#444' },
});
```

- [ ] **Step 5.11: Wire DiagramMessage into the message switch**

Open the file identified in Step 5.9. Find the switch / conditional rendering on message `type`. Add:

```typescript
import DiagramMessage from '../components/DiagramMessage';
// inside the switch:
if (message.type === 'diagram') {
  const title = message.meta?.title as string | undefined;
  return <DiagramMessage mermaid={message.content} title={title} />;
}
```

Adapt prop names to actual message shape.

- [ ] **Step 5.12: Mobile typecheck**

```bash
cd "/Users/hongpengwang/行动中止派/apps/mobile" && npx tsc --noEmit 2>&1 | tail -5
```

Expected: no errors. If errors about missing `react-native-webview` types, ensure types are installed (`@types/react-native-webview` is usually bundled).

- [ ] **Step 5.13: Commit mobile**

```bash
cd "/Users/hongpengwang/行动中止派" && git add apps/mobile/src/components/DiagramMessage.tsx apps/mobile/package.json apps/mobile/package-lock.json && git commit -m "feat(mobile/m2): DiagramMessage component for mermaid rendering"
```

Also stage and commit the message-switch wiring change if it's a different file:

```bash
git add apps/mobile/src/components/MessageItem.tsx && git commit -m "feat(mobile/m2): render type='diagram' messages via DiagramMessage"
```

(Adjust file path to actual location.)

---

## Task 6: `wikipedia` + `get_economic_series` + `document_reader`

Three independent tools. One commit per tool.

**Files:**
- Create: `apps/api/src/lib/agent/tools/wikipedia.ts`
- Create: `apps/api/src/lib/agent/__tests__/tools.wikipedia.test.ts`
- Create: `apps/api/src/lib/agent/tools/getEconomicSeries.ts`
- Create: `apps/api/src/lib/agent/__tests__/tools.getEconomicSeries.test.ts`
- Create: `apps/api/src/lib/agent/tools/documentReader.ts`
- Create: `apps/api/src/lib/agent/__tests__/tools.documentReader.test.ts`

### 6A. wikipedia

- [ ] **Step 6.1: Write failing tests**

Create `apps/api/src/lib/agent/__tests__/tools.wikipedia.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { wikipediaTool, registerWikipedia } from '../tools/wikipedia.js';
import { toolRegistry } from '../toolRegistry.js';

const fakeCtx = {
  runId: 'r', stepId: 's', ownerId: 'u', channel: 'private' as const,
  signal: new AbortController().signal,
};

describe('wikipedia tool', () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('registers idempotently', () => {
    registerWikipedia();
    registerWikipedia();
    expect(toolRegistry.get('wikipedia')).toBeDefined();
  });

  it('English title → en.wikipedia.org/api/rest_v1', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      expect(url).toContain('en.wikipedia.org');
      return new Response(
        JSON.stringify({
          title: 'Prospect theory',
          extract: 'Prospect theory is a behavioral model...',
          content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Prospect_theory' } },
          pageid: 12345,
        }),
        { status: 200 },
      );
    }));
    const out = await wikipediaTool.handler({ title: 'Prospect theory' }, fakeCtx);
    expect(out.ok).toBe(true);
    expect(out.lang).toBe('en');
    expect(out.summary).toContain('behavioral');
    expect(out.url).toContain('Prospect_theory');
  });

  it('CJK title → auto zh.wikipedia.org', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      expect(url).toContain('zh.wikipedia.org');
      return new Response(
        JSON.stringify({
          title: '前景理论', extract: '前景理论是...',
          content_urls: { desktop: { page: 'https://zh.wikipedia.org/wiki/前景理论' } },
          pageid: 67890,
        }),
        { status: 200 },
      );
    }));
    const out = await wikipediaTool.handler({ title: '前景理论' }, fakeCtx);
    expect(out.ok).toBe(true);
    expect(out.lang).toBe('zh');
  });

  it('404 → ok:false', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not found', { status: 404 })));
    const out = await wikipediaTool.handler({ title: 'Definitely Not A Page' }, fakeCtx);
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/HTTP 404/);
  });

  it('extractRef returns url ref', () => {
    const ref = wikipediaTool.replyMeta!.extractRef!({
      ok: true, title: 'X', lang: 'en', summary: '', url: 'https://en.wikipedia.org/wiki/X', pageId: 1,
    });
    expect(ref).toEqual({ kind: 'url', id: 'https://en.wikipedia.org/wiki/X', label: 'Wikipedia: X' });
  });
});
```

- [ ] **Step 6.2: Implement wikipedia.ts**

Create `apps/api/src/lib/agent/tools/wikipedia.ts`:

```typescript
import { toolRegistry, type ToolDef } from '../toolRegistry.js';

type WikipediaInput = {
  title: string;
  lang?: string;
};

type WikipediaOutput = {
  ok: boolean;
  title: string;
  lang: string;
  summary: string;
  url: string;
  pageId: number;
  error?: string;
};

function detectLang(title: string): string {
  return /[\u3400-\u9fff]/.test(title) ? 'zh' : 'en';
}

export const wikipediaTool: ToolDef<WikipediaInput, WikipediaOutput> = {
  name: 'wikipedia',
  description:
    'Look up a Wikipedia article by title. Returns a 1-2 paragraph summary. Use for concept definitions, background context, biographies, historical events. Auto-detects language (CJK → zh, otherwise en); pass `lang` to override.',
  inputSchema: {
    type: 'object',
    required: ['title'],
    properties: {
      title: { type: 'string' },
      lang: { type: 'string', minLength: 2, maxLength: 5 },
    },
  },
  approvalMode: 'auto',
  costHint: 'low',
  hasSideEffects: false,
  idempotent: true,
  replyMeta: {
    summaryKind: 'text',
    extractRef: (output: unknown) => {
      const o = output as WikipediaOutput;
      if (!o?.ok || !o.url) return null;
      return { kind: 'url' as const, id: o.url, label: `Wikipedia: ${o.title}` };
    },
    failureHint:
      'Wikipedia 失败可能是词条不存在 / 标题拼写错。可改 search_web 找正确标题再调；中文词条不全时 fallback en lang。',
  },
  computeIdempotencyKey: (input) => `wiki:${(input as WikipediaInput).lang ?? 'auto'}:${(input as WikipediaInput).title.trim()}`,
  async handler(input, ctx) {
    const lang = input.lang ?? detectLang(input.title);
    const encoded = encodeURIComponent(input.title.replace(/ /g, '_'));
    const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encoded}`;
    try {
      const res = await fetch(url, { signal: ctx.signal, headers: { Accept: 'application/json' } });
      if (!res.ok) {
        return {
          ok: false, title: input.title, lang, summary: '', url: '', pageId: 0,
          error: `HTTP ${res.status} for ${input.title} (${lang})`,
        };
      }
      const json = (await res.json()) as any;
      return {
        ok: true,
        title: String(json.title ?? input.title),
        lang,
        summary: String(json.extract ?? '').slice(0, 2048),
        url: json.content_urls?.desktop?.page ?? `https://${lang}.wikipedia.org/wiki/${encoded}`,
        pageId: Number(json.pageid ?? 0),
      };
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') throw e;
      return {
        ok: false, title: input.title, lang, summary: '', url: '', pageId: 0,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  },
};

export function registerWikipedia(): void {
  if (!toolRegistry.get(wikipediaTool.name)) {
    toolRegistry.register(wikipediaTool);
  }
}
```

- [ ] **Step 6.3: Run wikipedia tests + commit**

```bash
cd "/Users/hongpengwang/行动中止派" && npx vitest run -w @xzz/api --testPathPattern tools.wikipedia.test 2>&1 | tail -10
```

Expected: 4 passed.

Add `registerWikipedia()` to registerAllTools. Then:

```bash
cd "/Users/hongpengwang/行动中止派/apps/api" && npx tsc --noEmit 2>&1 | tail -5
cd "/Users/hongpengwang/行动中止派" && git add apps/api/src/lib/agent/tools/wikipedia.ts apps/api/src/lib/agent/__tests__/tools.wikipedia.test.ts apps/api/src/lib/agent/registerAllTools.ts && git commit -m "feat(agent/m2): wikipedia tool"
```

### 6B. get_economic_series (FRED)

- [ ] **Step 6.4: Write failing tests**

Create `apps/api/src/lib/agent/__tests__/tools.getEconomicSeries.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getEconomicSeriesTool,
  registerGetEconomicSeries,
} from '../tools/getEconomicSeries.js';
import { toolRegistry } from '../toolRegistry.js';

const fakeCtx = {
  runId: 'r', stepId: 's', ownerId: 'u', channel: 'private' as const,
  signal: new AbortController().signal,
};

describe('get_economic_series (FRED) tool', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    process.env.FRED_API_KEY = 'test-fred-key';
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.FRED_API_KEY;
  });

  it('registers idempotently', () => {
    registerGetEconomicSeries();
    registerGetEconomicSeries();
    expect(toolRegistry.get('get_economic_series')).toBeDefined();
  });

  it('happy path: returns observations + metadata', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url);
      if (url.includes('/series/observations')) {
        return new Response(JSON.stringify({
          observations: [
            { date: '2020-01-01', value: '3.5' },
            { date: '2020-02-01', value: '3.5' },
            { date: '2020-03-01', value: '4.4' },
          ],
        }), { status: 200 });
      }
      if (url.includes('/series?')) {
        return new Response(JSON.stringify({
          seriess: [{ title: 'Unemployment Rate', units: 'Percent', frequency: 'Monthly' }],
        }), { status: 200 });
      }
      throw new Error('unexpected url ' + url);
    }));

    const out = await getEconomicSeriesTool.handler({ seriesId: 'UNRATE' }, fakeCtx);
    expect(out.ok).toBe(true);
    expect(out.seriesId).toBe('UNRATE');
    expect(out.title).toContain('Unemployment');
    expect(out.observations).toHaveLength(3);
    expect(out.observations[0].value).toBe(3.5);
  });

  it('no FRED_API_KEY → ok:false with config error', async () => {
    delete process.env.FRED_API_KEY;
    const out = await getEconomicSeriesTool.handler({ seriesId: 'X' }, fakeCtx);
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/FRED_API_KEY/);
  });

  it('FRED 400 (unknown series) → ok:false', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad', { status: 400 })));
    const out = await getEconomicSeriesTool.handler({ seriesId: 'NOPE' }, fakeCtx);
    expect(out.ok).toBe(false);
  });

  it('over 200 observations → truncated:true', async () => {
    const obs = Array.from({ length: 250 }, (_, i) => ({ date: `2020-01-${(i % 28) + 1}`, value: String(i) }));
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('observations')) {
        return new Response(JSON.stringify({ observations: obs }), { status: 200 });
      }
      return new Response(JSON.stringify({ seriess: [{ title: 't', units: 'u', frequency: 'M' }] }), { status: 200 });
    }));
    const out = await getEconomicSeriesTool.handler({ seriesId: 'X' }, fakeCtx);
    expect(out.observations).toHaveLength(200);
    expect(out.truncated).toBe(true);
  });
});
```

- [ ] **Step 6.5: Implement getEconomicSeries.ts**

Create `apps/api/src/lib/agent/tools/getEconomicSeries.ts`:

```typescript
import { toolRegistry, type ToolDef } from '../toolRegistry.js';

type GetEconomicSeriesInput = {
  seriesId: string;
  startDate?: string;
  endDate?: string;
};

type Observation = { date: string; value: number | null };

type GetEconomicSeriesOutput = {
  ok: boolean;
  seriesId: string;
  title: string;
  units: string;
  frequency: string;
  observations: Observation[];
  truncated: boolean;
  error?: string;
};

const MAX_OBS = 200;

export const getEconomicSeriesTool: ToolDef<GetEconomicSeriesInput, GetEconomicSeriesOutput> = {
  name: 'get_economic_series',
  description:
    'Fetch a macroeconomic time series from FRED (Federal Reserve Economic Data). Use for GDP, CPI, unemployment, interest rates, etc. Common series IDs: UNRATE (unemployment), CPIAUCSL (CPI), GDP (gross domestic product), FEDFUNDS (fed funds rate). Returns up to 200 observations.',
  inputSchema: {
    type: 'object',
    required: ['seriesId'],
    properties: {
      seriesId: { type: 'string' },
      startDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      endDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    },
  },
  approvalMode: 'auto',
  costHint: 'low',
  hasSideEffects: false,
  idempotent: true,
  replyMeta: {
    summaryKind: 'text',
    failureHint:
      'FRED 失败常见：seriesId 不存在（如把"CPI"当 id，正确是"CPIAUCSL"）/ API key 缺失 / quota。可先 search_web 查 series ID 再调；persistent 失败让用户手动确认。',
  },
  computeIdempotencyKey: (input) => {
    const i = input as GetEconomicSeriesInput;
    return `fred:${i.seriesId}:${i.startDate ?? '2000-01-01'}:${i.endDate ?? 'today'}`;
  },
  async handler(input, ctx) {
    const apiKey = process.env.FRED_API_KEY?.trim();
    if (!apiKey) {
      return {
        ok: false, seriesId: input.seriesId, title: '', units: '', frequency: '',
        observations: [], truncated: false,
        error: 'FRED_API_KEY is not configured (server env or user override)',
      };
    }
    const startDate = input.startDate ?? '2000-01-01';
    const endDate = input.endDate ?? new Date().toISOString().slice(0, 10);
    try {
      const obsUrl =
        `https://api.stlouisfed.org/fred/series/observations?series_id=${encodeURIComponent(input.seriesId)}` +
        `&observation_start=${startDate}&observation_end=${endDate}&api_key=${apiKey}&file_type=json`;
      const metaUrl =
        `https://api.stlouisfed.org/fred/series?series_id=${encodeURIComponent(input.seriesId)}` +
        `&api_key=${apiKey}&file_type=json`;

      const [obsRes, metaRes] = await Promise.all([
        fetch(obsUrl, { signal: ctx.signal }),
        fetch(metaUrl, { signal: ctx.signal }),
      ]);

      if (!obsRes.ok) {
        return {
          ok: false, seriesId: input.seriesId, title: '', units: '', frequency: '',
          observations: [], truncated: false,
          error: `FRED observations HTTP ${obsRes.status}`,
        };
      }
      if (!metaRes.ok) {
        return {
          ok: false, seriesId: input.seriesId, title: '', units: '', frequency: '',
          observations: [], truncated: false,
          error: `FRED series-meta HTTP ${metaRes.status}`,
        };
      }
      const obsJson = (await obsRes.json()) as { observations?: Array<{ date: string; value: string }> };
      const metaJson = (await metaRes.json()) as { seriess?: Array<{ title?: string; units?: string; frequency?: string }> };
      const meta = metaJson.seriess?.[0] ?? {};
      const all = obsJson.observations ?? [];
      const truncated = all.length > MAX_OBS;
      const observations = (truncated ? all.slice(-MAX_OBS) : all).map((o) => ({
        date: o.date,
        value: o.value === '.' ? null : Number(o.value),
      }));
      return {
        ok: true,
        seriesId: input.seriesId,
        title: String(meta.title ?? input.seriesId),
        units: String(meta.units ?? ''),
        frequency: String(meta.frequency ?? ''),
        observations,
        truncated,
      };
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') throw e;
      return {
        ok: false, seriesId: input.seriesId, title: '', units: '', frequency: '',
        observations: [], truncated: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  },
};

export function registerGetEconomicSeries(): void {
  if (!toolRegistry.get(getEconomicSeriesTool.name)) {
    toolRegistry.register(getEconomicSeriesTool);
  }
}
```

- [ ] **Step 6.6: Run + register + commit**

```bash
cd "/Users/hongpengwang/行动中止派" && npx vitest run -w @xzz/api --testPathPattern tools.getEconomicSeries.test 2>&1 | tail -10
```

Expected: 4 passed.

Add `registerGetEconomicSeries()` to registerAllTools.

```bash
cd "/Users/hongpengwang/行动中止派/apps/api" && npx tsc --noEmit 2>&1 | tail -5
cd "/Users/hongpengwang/行动中止派" && git add apps/api/src/lib/agent/tools/getEconomicSeries.ts apps/api/src/lib/agent/__tests__/tools.getEconomicSeries.test.ts apps/api/src/lib/agent/registerAllTools.ts && git commit -m "feat(agent/m2): get_economic_series (FRED) tool"
```

### 6C. document_reader (PDF + Word + Excel)

- [ ] **Step 6.7: Install deps**

```bash
cd "/Users/hongpengwang/行动中止派" && npm install pdf-parse mammoth xlsx -w @xzz/api && npm install -D @types/pdf-parse -w @xzz/api
```

`mammoth` and `xlsx` ship their own types. `pdf-parse` needs `@types/pdf-parse`.

- [ ] **Step 6.8: Write failing tests**

Create `apps/api/src/lib/agent/__tests__/tools.documentReader.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { documentReaderTool, registerDocumentReader } from '../tools/documentReader.js';
import { toolRegistry } from '../toolRegistry.js';

vi.mock('pdf-parse', () => ({
  default: vi.fn(async (_buf: Buffer) => ({ text: 'extracted pdf text here' })),
}));
vi.mock('mammoth', () => ({
  default: { convertToMarkdown: vi.fn(async (_opts: any) => ({ value: '# heading\nbody' })) },
  convertToMarkdown: vi.fn(async (_opts: any) => ({ value: '# heading\nbody' })),
}));
vi.mock('xlsx', () => ({
  read: vi.fn(() => ({ SheetNames: ['Sheet1'], Sheets: { Sheet1: { '!ref': 'A1:B2' } } })),
  utils: {
    sheet_to_json: vi.fn(() => [{ a: 1, b: 2 }, { a: 3, b: 4 }]),
  },
}));

const fakeCtx = {
  runId: 'r', stepId: 's', ownerId: 'u', channel: 'private' as const,
  signal: new AbortController().signal,
};

describe('document_reader tool', () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('registers idempotently', () => {
    registerDocumentReader();
    registerDocumentReader();
    expect(toolRegistry.get('document_reader')).toBeDefined();
  });

  it('PDF: returns extracted text', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ArrayBuffer(10), {
      status: 200,
      headers: { 'Content-Type': 'application/pdf' },
    })));
    const out = await documentReaderTool.handler({ url: 'https://x.com/a.pdf' }, fakeCtx);
    expect(out.ok).toBe(true);
    expect(out.format).toBe('pdf');
    expect(out.text).toContain('pdf text');
  });

  it('DOCX: returns markdown from mammoth', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ArrayBuffer(10), {
      status: 200,
      headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    })));
    const out = await documentReaderTool.handler({ url: 'https://x.com/a.docx' }, fakeCtx);
    expect(out.ok).toBe(true);
    expect(out.format).toBe('docx');
    expect(out.text).toContain('heading');
  });

  it('XLSX: returns markdown table', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ArrayBuffer(10), {
      status: 200,
      headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
    })));
    const out = await documentReaderTool.handler({ url: 'https://x.com/a.xlsx' }, fakeCtx);
    expect(out.ok).toBe(true);
    expect(out.format).toBe('xlsx');
    expect(out.text).toMatch(/\|/);  // markdown table
  });

  it('unsupported content-type → ok:false', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('binary', {
      status: 200,
      headers: { 'Content-Type': 'image/png' },
    })));
    const out = await documentReaderTool.handler({ url: 'https://x.com/a.png' }, fakeCtx);
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/unsupported/);
  });

  it('HTTP error → ok:false', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not found', { status: 404 })));
    const out = await documentReaderTool.handler({ url: 'https://x.com/gone.pdf' }, fakeCtx);
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/HTTP 404/);
  });

  it('AbortError re-throws', async () => {
    const ac = new AbortController();
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      return new Promise((_r, reject) => {
        (init.signal as AbortSignal).addEventListener('abort', () => {
          const err = new Error('aborted'); err.name = 'AbortError'; reject(err);
        });
      });
    }));
    const p = documentReaderTool.handler({ url: 'https://x.com/a.pdf' }, { ...fakeCtx, signal: ac.signal });
    ac.abort();
    await expect(p).rejects.toThrow();
  });
});
```

- [ ] **Step 6.9: Implement documentReader.ts**

Create `apps/api/src/lib/agent/tools/documentReader.ts`:

```typescript
import { toolRegistry, type ToolDef } from '../toolRegistry.js';
import pdfParse from 'pdf-parse';
import * as mammoth from 'mammoth';
import * as XLSX from 'xlsx';

type DocumentReaderInput = {
  url: string;
};

type DocumentReaderOutput = {
  ok: boolean;
  url: string;
  format: 'pdf' | 'docx' | 'xlsx' | 'unknown';
  text: string;
  truncated: boolean;
  error?: string;
};

const MAX_BYTES = 8 * 1024 * 1024;       // 8MB upload cap
const MAX_TEXT_CHARS = 32 * 1024;        // 32K char output cap

const PDF_CT = /pdf/i;
const DOCX_CT = /wordprocessingml|msword/i;
const XLSX_CT = /spreadsheetml|excel/i;

function inferFormat(contentType: string, url: string): DocumentReaderOutput['format'] {
  if (PDF_CT.test(contentType) || /\.pdf($|\?)/i.test(url)) return 'pdf';
  if (DOCX_CT.test(contentType) || /\.docx($|\?)/i.test(url)) return 'docx';
  if (XLSX_CT.test(contentType) || /\.xlsx($|\?)/i.test(url)) return 'xlsx';
  return 'unknown';
}

async function xlsxToMarkdown(buf: Buffer): Promise<string> {
  const wb = XLSX.read(buf, { type: 'buffer' });
  const parts: string[] = [];
  for (const sheetName of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName]);
    if (rows.length === 0) continue;
    const headers = Object.keys(rows[0]);
    parts.push(`## ${sheetName}\n`);
    parts.push('| ' + headers.join(' | ') + ' |');
    parts.push('|' + headers.map(() => '---').join('|') + '|');
    for (const row of rows.slice(0, 200)) {
      parts.push('| ' + headers.map((h) => String(row[h] ?? '')).join(' | ') + ' |');
    }
    parts.push('');
  }
  return parts.join('\n');
}

export const documentReaderTool: ToolDef<DocumentReaderInput, DocumentReaderOutput> = {
  name: 'document_reader',
  description:
    'Fetch a document URL and extract its text. Supports PDF (pdf-parse), Word .docx (mammoth → markdown), Excel .xlsx (xlsx → markdown tables). Use when the user pastes a document link or after search_papers returns a PDF DOI. 8MB upload cap, 32K char output cap.',
  inputSchema: {
    type: 'object',
    required: ['url'],
    properties: { url: { type: 'string' } },
  },
  approvalMode: 'auto',
  costHint: 'medium',
  hasSideEffects: false,
  idempotent: true,
  replyMeta: {
    summaryKind: 'text',
    failureHint:
      '文档读取失败：URL 可能不可达、非 PDF/DOCX/XLSX 格式、或文件过大（>8MB）。可尝试用 search_web 找该文档的网页版替代，或让用户提供文本摘录。',
  },
  computeIdempotencyKey: (input) => `doc:${(input as DocumentReaderInput).url.trim()}`,
  async handler(input, ctx) {
    try {
      const res = await fetch(input.url, { signal: ctx.signal });
      if (!res.ok) {
        return {
          ok: false, url: input.url, format: 'unknown', text: '', truncated: false,
          error: `HTTP ${res.status} for ${input.url}`,
        };
      }
      const contentLength = Number(res.headers.get('content-length') ?? 0);
      if (contentLength > MAX_BYTES) {
        return {
          ok: false, url: input.url, format: 'unknown', text: '', truncated: false,
          error: `document too large: ${contentLength} > ${MAX_BYTES} bytes`,
        };
      }
      const arrayBuffer = await res.arrayBuffer();
      if (arrayBuffer.byteLength > MAX_BYTES) {
        return {
          ok: false, url: input.url, format: 'unknown', text: '', truncated: false,
          error: `document too large after download: ${arrayBuffer.byteLength} > ${MAX_BYTES}`,
        };
      }
      const buf = Buffer.from(arrayBuffer);
      const format = inferFormat(res.headers.get('content-type') ?? '', input.url);

      let text = '';
      if (format === 'pdf') {
        const parsed = await pdfParse(buf);
        text = parsed.text ?? '';
      } else if (format === 'docx') {
        const result = await (mammoth as any).convertToMarkdown({ buffer: buf });
        text = result.value ?? '';
      } else if (format === 'xlsx') {
        text = await xlsxToMarkdown(buf);
      } else {
        return {
          ok: false, url: input.url, format: 'unknown', text: '', truncated: false,
          error: `unsupported format (content-type=${res.headers.get('content-type')}, url=${input.url})`,
        };
      }

      const truncated = text.length > MAX_TEXT_CHARS;
      return {
        ok: true,
        url: input.url,
        format,
        text: truncated ? text.slice(0, MAX_TEXT_CHARS) : text,
        truncated,
      };
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') throw e;
      return {
        ok: false, url: input.url, format: 'unknown', text: '', truncated: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  },
};

export function registerDocumentReader(): void {
  if (!toolRegistry.get(documentReaderTool.name)) {
    toolRegistry.register(documentReaderTool);
  }
}
```

- [ ] **Step 6.10: Run document_reader tests + commit**

```bash
cd "/Users/hongpengwang/行动中止派" && npx vitest run -w @xzz/api --testPathPattern tools.documentReader.test 2>&1 | tail -20
```

Expected: 7 passed.

If mammoth's default export shape causes type errors at compile time, switch import to `import mammoth from 'mammoth'` and the call to `mammoth.convertToMarkdown(...)` — adjust based on `node_modules/mammoth/types/index.d.ts`.

Add `registerDocumentReader()` to registerAllTools.

```bash
cd "/Users/hongpengwang/行动中止派/apps/api" && npx tsc --noEmit 2>&1 | tail -5
cd "/Users/hongpengwang/行动中止派" && git add apps/api/src/lib/agent/tools/documentReader.ts apps/api/src/lib/agent/__tests__/tools.documentReader.test.ts apps/api/src/lib/agent/registerAllTools.ts apps/api/package.json apps/api/package-lock.json && git commit -m "feat(agent/m2): document_reader (PDF + Word + Excel)"
```

---

## Task 7: planner prompt + user_api_keys plumbing + full review + merge

**Files:**
- Modify: `apps/api/src/lib/agent/planner.ts` (update `PLANNER_INSTRUCTION` to mention new tools)
- Create: `apps/api/src/lib/agent/userApiKeys.ts`
- Create: `apps/api/src/lib/agent/__tests__/userApiKeys.test.ts`
- Modify: `apps/api/src/lib/agent/runLifecycle.ts` (`CreateAgentRunInput` accepts `userApiKeys: Record<string,string>`; seal into `user_api_keys_enc`)

### 7A. user_api_keys plumbing

- [ ] **Step 7.1: Find secretBox helpers**

```bash
cd "/Users/hongpengwang/行动中止派" && rg "export.*function.*seal|export.*function.*unseal" apps/api/src/lib --type ts
```

Note the exact names (likely `seal` / `unseal` or `sealV1` / `unsealV1`). Use those in the next step.

- [ ] **Step 7.2: Write failing tests for userApiKeys helpers**

Create `apps/api/src/lib/agent/__tests__/userApiKeys.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import {
  sealUserApiKeys,
  unsealUserApiKey,
  type UserApiKeysPlain,
} from '../userApiKeys.js';

describe('user_api_keys_enc helpers', () => {
  beforeAll(() => {
    process.env.AGENT_KEY_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  });

  it('seal + unseal roundtrip per service', () => {
    const plain: UserApiKeysPlain = { e2b: 'sk-e2b-xxx', fred: 'fred-yyy' };
    const sealed = sealUserApiKeys(plain);
    expect(typeof sealed.e2b).toBe('string');
    expect(sealed.e2b).not.toBe('sk-e2b-xxx');
    expect(unsealUserApiKey(sealed, 'e2b')).toBe('sk-e2b-xxx');
    expect(unsealUserApiKey(sealed, 'fred')).toBe('fred-yyy');
    expect(unsealUserApiKey(sealed, 'unknown')).toBeNull();
  });

  it('returns null when AGENT_KEY_SECRET missing', () => {
    const oldEnv = process.env.AGENT_KEY_SECRET;
    delete process.env.AGENT_KEY_SECRET;
    const sealed = sealUserApiKeys({ e2b: 'x' });
    expect(sealed).toEqual({});
    process.env.AGENT_KEY_SECRET = oldEnv;
  });

  it('drops empty values', () => {
    const sealed = sealUserApiKeys({ e2b: 'x', fred: '   ', jina: '' });
    expect(sealed.e2b).toBeDefined();
    expect(sealed.fred).toBeUndefined();
    expect(sealed.jina).toBeUndefined();
  });
});
```

- [ ] **Step 7.3: Implement userApiKeys.ts**

Create `apps/api/src/lib/agent/userApiKeys.ts`:

```typescript
/**
 * M2 Task 7A: helpers to seal/unseal the per-run user_api_keys_enc JSONB column.
 *
 * Shape (plain): { e2b?: string; exa?: string; fred?: string; jina?: string }
 * Shape (sealed): { e2b?: <ciphertext>; ... } — each value sealed with secretBox v1.
 *
 * Unlike M1d's per-column approach (user_deepseek_key_enc / user_zenmux_key_enc),
 * this single column scales to N future per-service keys without DB migrations.
 */
import { seal, unseal } from '../secretBox.js'; // adjust import path / names per Step 7.1

export type UserApiKeysPlain = Partial<Record<string, string>>;
export type UserApiKeysSealed = Partial<Record<string, string>>;

export function sealUserApiKeys(plain: UserApiKeysPlain): UserApiKeysSealed {
  if (!process.env.AGENT_KEY_SECRET) return {};
  const out: UserApiKeysSealed = {};
  for (const [service, value] of Object.entries(plain)) {
    const trimmed = (value ?? '').trim();
    if (!trimmed) continue;
    out[service] = seal(trimmed);
  }
  return out;
}

export function unsealUserApiKey(
  sealed: UserApiKeysSealed | null | undefined,
  service: string,
): string | null {
  if (!sealed || !process.env.AGENT_KEY_SECRET) return null;
  const blob = sealed[service];
  if (!blob) return null;
  try {
    return unseal(blob);
  } catch {
    return null;
  }
}
```

**Important**: The actual secretBox API in this repo may export `sealV1`/`unsealV1` or be class-based. Adjust import + calls based on Step 7.1 grep output. The principle: pure forward call to the same primitive M1d used.

- [ ] **Step 7.4: Run tests + adapt**

```bash
cd "/Users/hongpengwang/行动中止派" && npx vitest run -w @xzz/api --testPathPattern userApiKeys.test 2>&1 | tail -10
```

Expected: 3 passed. If failing because secretBox API differs, fix `userApiKeys.ts` imports/calls.

- [ ] **Step 7.5: Extend CreateAgentRunInput to accept userApiKeys**

Open `apps/api/src/lib/agent/runLifecycle.ts`. Find the `CreateAgentRunInput` type (around line 29). Add:

```typescript
  /** M2 Task 7A: per-service user-supplied API keys (E2B/Exa/FRED/Jina). Sealed before write. */
  userApiKeys?: Record<string, string>;
```

In the function body of `createAgentRun` (around line 55+), seal and pass to store. Find where `apiKey` is currently being sealed; add right after:

```typescript
import { sealUserApiKeys } from './userApiKeys.js';
// ...inside createAgentRun, where the run row gets built:
const userApiKeysEnc = sealUserApiKeys(input.userApiKeys ?? {});
// then include `user_api_keys_enc: userApiKeysEnc` in the store.createAgentRun call
```

Open `apps/api/src/lib/agent/store.ts` and find `createAgentRun` — extend its input type to accept `userApiKeysEnc?: Record<string,string>` and include `user_api_keys_enc` in the INSERT column list (with `$N::jsonb` placeholder).

- [ ] **Step 7.6: Smoke test that user keys roundtrip end-to-end**

Add to `apps/api/src/lib/agent/__tests__/userApiKeys.test.ts`:

```typescript
import * as store from '../store.js';
import { createAgentRun } from '../runLifecycle.js';

it('createAgentRun seals userApiKeys into the row', async () => {
  // Skip if no DB available (CI uses real PG):
  if (!process.env.DATABASE_URL) return;
  const res = await createAgentRun({
    ownerId: 'user-test-m2',
    channel: 'private',
    inputText: 'hello',
    apiKey: '',
    apiKeySource: 'server',
    userApiKeys: { e2b: 'sk-e2b-from-user', fred: 'fred-from-user' },
  });
  const reloaded = await store.getAgentRun(res.run.id);
  expect(reloaded?.userApiKeysEnc?.e2b).toBeDefined();
  expect(reloaded?.userApiKeysEnc?.e2b).not.toBe('sk-e2b-from-user');
});
```

```bash
cd "/Users/hongpengwang/行动中止派" && npx vitest run -w @xzz/api --testPathPattern userApiKeys.test 2>&1 | tail -10
```

- [ ] **Step 7.7: Wire unsealing into tools that need per-service keys**

For each tool that may consume a user-provided key (`run_python`/E2B, `fetch_url`/Jina, `get_economic_series`/FRED, `search_papers`/CrossRef OK without key, OpenAlex OK without key), add a helper inside the tool's handler:

```typescript
import { getAgentRun } from '../store.js';
import { unsealUserApiKey } from '../userApiKeys.js';

async function resolveServiceKey(runId: string, service: string, envFallback: string): Promise<string | undefined> {
  const run = await getAgentRun(runId);
  const userKey = unsealUserApiKey(run?.userApiKeysEnc ?? null, service);
  return (userKey ?? process.env[envFallback]?.trim()) || undefined;
}
```

Apply to:
- `runPython.ts` Step 1.19: in `acquireSandbox`, also accept a `runId` (already does) and let `sandbox.ts` read per-run key (this requires deeper plumbing — for M2, **defer**: keep env-only and only document that user-key override is a Task-7 follow-up if time runs short).
- `fetchUrl.ts` Step 4.3: replace `const apiKey = process.env.JINA_API_KEY?.trim();` with a call to `resolveServiceKey(ctx.runId, 'jina', 'JINA_API_KEY')`.
- `getEconomicSeries.ts` Step 6.5: replace `const apiKey = process.env.FRED_API_KEY?.trim();` with `resolveServiceKey(ctx.runId, 'fred', 'FRED_API_KEY')`.

Add new tests verifying user-key override beats env. Skip if time pressure — env-only works for v0.m2.

### 7B. Planner prompt update

- [ ] **Step 7.8: Update PLANNER_INSTRUCTION**

Open `apps/api/src/lib/agent/planner.ts`. Find the `PLANNER_INSTRUCTION` constant (around line 160). Append a "工具选择建议" block before the closing backtick:

```typescript
const PLANNER_INSTRUCTION = `你是任务规划器。读取用户的请求，挑选下列工具组成一个最小可行的 plan。
只输出**严格 JSON**，不要任何解释、不要 markdown 围栏、不要多余字段。

JSON 结构必须是：
{
  "intentSummary": "一句话概括用户想要什么",
  "steps": [
    {
      "toolName": "<上面工具列表里的 name>",
      "input": { ...符合该工具 inputSchema 的对象... },
      "reason": "为什么这一步",
      "todoId": "t1"
    }
  ],
  "todos": [
    { "id": "t1", "text": "对用户可读的待办描述", "status": "pending", "stepRefs": [] }
  ],
  "finalReplyHint": "执行完成后给用户的回复风格提示"
}

约束：
- 每个 step.todoId 必须能在 todos 数组里找到对应 id
- 不要发明不存在的 toolName
- steps 数量控制在 1-6 之间
- 若任务完全是闲聊或单步问答，可只放 1 个 step

工具调用约定（必读）：
- 调用前阅读 tool description 的 inputSchema
- 收到 observation 时检查 \`ok\` 字段：ok=false 或 error 字段非空 → 当前 step 失败
- 失败处理：
  a. 可以换参数重试（如不同搜索词 / 备选 url）→ 在新 plan 里补一个相同 tool 的 step
  b. 该工具能力本身不可用（持续 4xx/5xx）→ 跳过该工具，用其他工具达成目标
  c. 整条路径不可行 → 把已查到的部分写成 reply，明确告诉用户「X 不可达」
- 不要忽略 ok=false 直接进下一步

工具选型建议（心理学 / 经济学讨论场景）：
- **学术论断 / 理论名称 / 实证证据** → 优先 search_papers（OpenAlex+CrossRef），不要让 search_web 拿博客代替
- **概念定义 / 历史背景** → wikipedia 比 search_web 更稳
- **数字声明 / 计算 / 回归 / 画图** → run_python（沙箱里 statsmodels/pandas 都能用）
- **宏观经济数据**（GDP/CPI/失业率等） → get_economic_series 拉 FRED 官方数据，不要 LLM 拍脑袋
- **概念关系 / 因果图 / 流程** → render_diagram 生成 mermaid，让用户能看到结构
- **PDF / Word / Excel 链接** → document_reader
- **复杂论断（涉及"很多研究表明" / "数据支持" 等）后** → critique_last_answer 自检一次，找未引用论断 / 过度自信
- **时间相关问题** → 先调 datetime_now（你不知道今天是几号）
- **URL 用户粘的** → fetch_url
- **本系统知识库** → magi_system_read（用户的私人笔记/记忆）
`;
```

- [ ] **Step 7.9: Run all planner tests (catch regressions)**

```bash
cd "/Users/hongpengwang/行动中止派" && npx vitest run -w @xzz/api --testPathPattern planner 2>&1 | tail -15
```

Some snapshot tests may fail because prompt changed. Update snapshots:

```bash
cd "/Users/hongpengwang/行动中止派" && npx vitest run -w @xzz/api --testPathPattern planner -u 2>&1 | tail -5
```

Re-run to confirm.

- [ ] **Step 7.10: Commit Task 7 work**

```bash
cd "/Users/hongpengwang/行动中止派/apps/api" && npx tsc --noEmit 2>&1 | tail -5
cd "/Users/hongpengwang/行动中止派" && git add apps/api/src/lib/agent/userApiKeys.ts apps/api/src/lib/agent/__tests__/userApiKeys.test.ts apps/api/src/lib/agent/runLifecycle.ts apps/api/src/lib/agent/store.ts apps/api/src/lib/agent/planner.ts apps/api/src/lib/agent/__tests__/ && git commit -m "feat(agent/m2): user_api_keys_enc plumbing + planner prompt M2 tool guidance"
```

### 7C. Full suite + lint + review + merge

- [ ] **Step 7.11: Full vitest run**

```bash
cd "/Users/hongpengwang/行动中止派" && npx vitest run -w @xzz/api 2>&1 | tail -15
```

Expected: ≥350 tests, all passing (M1f baseline 310 + ~40 new from M2). Fix any red.

- [ ] **Step 7.12: Lint (M1f #5 ESLint pipeline)**

```bash
cd "/Users/hongpengwang/行动中止派" && npm run lint -w @xzz/api 2>&1 | tail -15
```

Expected: no errors. M1f's `agent-tool-fetch-signal` rule should pass on every new tool because each `fetch()` call uses `signal: ctx.signal`.

If errors: the rule will point to a fetch call missing `signal`. Add it.

- [ ] **Step 7.13: tsc both apps**

```bash
cd "/Users/hongpengwang/行动中止派/apps/api" && npx tsc --noEmit 2>&1 | tail -5
cd "/Users/hongpengwang/行动中止派/apps/mobile" && npx tsc --noEmit 2>&1 | tail -5
```

Expected: both clean.

- [ ] **Step 7.14: Dispatch code-reviewer subagent**

Use the Task tool with `subagent_type: "code-reviewer"`. Prompt:

```
Review the feat/agent-runtime-m2 branch against the spec
docs/superpowers/specs/2026-05-21-agent-runtime-m2-design.md and the
final list docs/superpowers/specs/2026-05-21-agent-m2-final-list.md.

Confirm:
1. All 11 new tools are present and follow the M1f three-piece convention
   ({ok}, replyMeta, ctx.signal).
2. Migration 016 applied; sandbox lifecycle wired into softComplete.
3. PLANNER_INSTRUCTION mentions new tools for proper routing.
4. user_api_keys_enc plumbing works end-to-end.
5. No regression in M1f's 310 tests; M2 adds ~40+ new tests.
6. ESLint clean; tsc clean both apps.

Flag any blocker as severity=high, polish as severity=low. Do not approve
if there's any uncoerced soft-fail, missing AbortError re-throw, or
hardcoded tool name from before the rename.
```

Wait for the report. Address all high-severity findings before merging.

- [ ] **Step 7.15: Final commit (any review fixes)**

```bash
cd "/Users/hongpengwang/行动中止派" && git add -A && git commit -m "fix(agent/m2): code-reviewer findings (low/medium severity)"
```

(Only commit if there were fixes.)

- [ ] **Step 7.16: Merge to main**

```bash
cd "/Users/hongpengwang/行动中止派" && git checkout main && git pull --rebase && git merge --no-ff feat/agent-runtime-m2 -m "Merge feat/agent-runtime-m2: 11 new tools (run_python, search_papers, critique, fetch_url, render_diagram, wikipedia, get_economic_series, get_paper_citations, datetime_now, document_reader) + rename web_search→search_web"
```

Expected: clean merge.

- [ ] **Step 7.17: Tag**

```bash
cd "/Users/hongpengwang/行动中止派" && git tag v0.m2 && git log --oneline -5
```

- [ ] **Step 7.18: Run final smoke**

```bash
cd "/Users/hongpengwang/行动中止派" && npx vitest run -w @xzz/api 2>&1 | tail -5 && npm run lint -w @xzz/api 2>&1 | tail -3
```

Both should be green.

- [ ] **Step 7.19: Announce completion**

Report to user: "M2 shipped on main, tagged v0.m2. {N} tests passing ({M} new from M2). 11 new tools active. Next: M3 (ask_user / subagent / deep_research) or another direction your choice."

---

## Self-Review

Run through the spec sections and confirm coverage:

**Spec section 1.1 — 8 new tools planned originally:** ✅ covered, plus 3 more from spec update (get_paper_citations, datetime_now, document_reader) = 11 total. Each has its own task or sub-task.

**Spec section 1.2 — handling of existing tools:** ✅ search_web rename in Task 4B; fetch_url replaces url_fetch in Task 4A; magi_*/doc_export_*/echo_after_sleep untouched.

**Spec section 1.3 — cross-cutting:**
- ✅ 5 new API keys: E2B/Exa/FRED/Jina + OpenAlex UA → Tasks 1.10, 7A
- ✅ Mobile mermaid component: Task 5B
- ✅ E2B sandbox lifecycle: Task 1B + 1.15 (softComplete hook)
- ✅ New ReplyRef kind: Task 5.6 (diagram); url ref already exists
- ⚠️ New ToolReplyMeta.summaryKind `'code_output'` — the spec mentions it but the plan uses `'text'` for run_python output. Defer the new kind to M3 unless reviewer flags. Document as ADR-update in commit message.

**Spec section 2 — per-tool designs:** each tool listed in spec has a step in this plan.

**Spec section 3.1 — sandbox lifecycle:** ✅ Task 1B (acquireSandbox/killSandboxForRun) + Step 1.15 (softComplete wires kill).

**Spec section 3.2 — 5 keys management:** ✅ Task 7A consolidates into `user_api_keys_enc`. ADR-5 honored.

**Spec section 3.3 — mobile mermaid:** ✅ Task 5B picks "WebView with CDN mermaid" approach. Documented as the chosen variant of spec-section's option B (the spec said default A then fallback B; in practice CDN-WebView is simpler and works on both iOS/Android out of the box).

**Spec section 4 — ADRs:** All 10 ADRs respected. ADR-2 changed from "OpenAlex+Exa" to "OpenAlex+CrossRef" per user's final confirmation (spec was updated in commit fcd23e5).

**Spec section 6 — testing matrix:** every row of the matrix has a corresponding test step in this plan.

**Placeholder scan:** No "TBD/TODO/implement later" — checked.

**Type consistency:** 
- `ToolDef` shape: every new tool uses the same registerXxx pattern.
- `ReplyRef` kind union: `'document' | 'url' | 'magi_card' | 'diagram'` (new). Update the type in toolRegistry.ts replyMeta and in replyGen.ts where ReplyRef type is defined.
- All tools' output types end in `Output` and start with `ok: boolean`.

**Naming:** snake_case tool names: `search_web`, `search_papers`, `fetch_url`, `run_python`, `render_diagram`, `wikipedia`, `get_economic_series`, `get_paper_citations`, `datetime_now`, `document_reader`, `critique_last_answer`. Unchanged: `magi_system_read`, `magi_content_ingest`, `doc_export_markdown`, `echo_after_sleep`. All consistent verb_noun.

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-21-agent-runtime-m2.md`.** 

Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session via executing-plans skill, batch execution with checkpoints.

Which approach?
