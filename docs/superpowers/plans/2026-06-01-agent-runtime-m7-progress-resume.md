# Agent Runtime M7 Progress & Resume Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement the referenced M7 plan task-by-task. This document is a progress/resume wrapper and must not replace or rewrite the original implementation plan.

**Goal:** Resume `agent-runtime` v0.m7 exactly from the existing M7 documents, without changing the previously reviewed scope, order, or acceptance criteria.

**Architecture:** Keep `docs/superpowers/plans/2026-05-22-agent-runtime-m7.md` as the source of truth for implementation details. This document only records current progress, execution order, and handoff notes so work can restart cleanly after the pause.

**Tech Stack:** TypeScript / Hono / pg / Vitest (`apps/api`); Expo / React Native (`apps/mobile`); no new dependencies beyond the original M7 plan.

---

## 1. Existing Progress Documents

The project already has clear M7 documents:

| Purpose | File | Status |
|---|---|---|
| M7 design/spec | `docs/superpowers/specs/2026-05-22-agent-runtime-m7-design.md` | Design written and reviewed through multiple doc revisions |
| M7 implementation plan | `docs/superpowers/plans/2026-05-22-agent-runtime-m7.md` | Complete `T0-T12` bite-sized plan; all implementation checkboxes still open |
| This resume wrapper | `docs/superpowers/plans/2026-06-01-agent-runtime-m7-progress-resume.md` | Current progress index and restart guide |

Do not change the original M7 scope from this wrapper. If implementation details are needed, follow `2026-05-22-agent-runtime-m7.md` directly.

---

## 2. Current State

As of 2026-06-01:

- Current branch: `main`
- Working tree: clean when checked
- Latest relevant commits are documentation-only M7 revisions:
  - `62e9d36 docs(agent/m7): plan/spec review 修订 —— 4 Critical + 4 Important + 1 Minor`
  - `20acb22 docs(agent/m7): writing-plans 实施计划 —— T0-T12 bite-sized 步骤`
  - `e3438db docs(agent/m7): M7 spec —— 子项目 B 群聊 Agent 并发协调`
- M1-M6 are considered completed; M7 is the next unfinished block.
- Original M7 plan contains 100 unchecked implementation steps and 0 checked implementation steps.

Progress summary:

| Milestone | Progress | Notes |
|---|---:|---|
| M7 spec | Complete | Existing design document is present |
| M7 implementation plan | Complete | Original plan is present and detailed |
| M7 coding | 0% | No `feat/agent-runtime-m7` implementation branch found |
| M7 tests | 0% | TB1-TB17 are planned but not implemented |
| M7 mobile work | 0% | T9-T10 are planned but not implemented |
| M7 merge/tag | 0% | `v0.m7` not created |

---

## 3. M7 Scope To Preserve

Use the original M7 goals exactly:

| ID | Acceptance Target |
|---|---|
| G1 | Same-topic later `agent_run` triggers merge into an active run when allowed; card shows merged follow-up count |
| G2 | Cross-window different-owner triggers become `queued`; active terminal state dequeues the next run |
| G3 | Group `ask_user` is enabled with 30s owner-only response, then opens to group members |
| G4 | Group `deep_research` creates a child run card in the same group/topic and supports parent-to-child drilldown |
| G5 | Existing private chat M1-M6 paths remain unaffected |

Non-goals stay exactly as written in the M7 spec:

- No content-similarity matching.
- No cross-topic merge.
- No coordination for normal `chat_group_llm`.
- No admin dashboard.
- No group voting/approval.
- No separate `topic_locks` table.
- No Redis or external queue middleware.

---

## 4. Original Execution Order

Follow this order from `docs/superpowers/plans/2026-05-22-agent-runtime-m7.md`:

| Task | Original Name | Progress | Resume Notes |
|---|---|---:|---|
| T0 | 分支 + baseline | Not started | Start here. Create `feat/agent-runtime-m7`, run backend baseline and mobile `tsc` |
| T1a | migration `021_agent_topic_coord.sql` | Not started | First code/data-model change |
| T1b | backend `types.ts` 扩展 | Not started | Add `queued`, merged input fields, ask_user fields |
| T1c | `store.ts` 扩展 | Not started | Parse/update new run fields and exclude queued from pickup |
| T1d | `hooks.ts` 扩展 | Not started | Add four M7 hook event types |
| T1e | mobile `types.ts` 同步 | Not started | Keep mobile/backend agent types aligned |
| T2a | store 查询函数 + advisory lock helper | Not started | Build DB helpers for topic coordination |
| T2b | `acquireTopicSlot` 决策函数 | Not started | Implement create/merge/queue decision |
| T3a | shared `IntentExecuteResult` 扩展 | Not started | Add merge/queue response fields |
| T3b | `intentExecute` 群聊三向路由 | Not started | Wire create_fresh / merge / queue under lock |
| T4a | `dequeueNextOnTopic` + hook | Not started | Implement queued-to-draft transition |
| T4b | terminal exits integration | Not started | Integrate dequeue into complete/cancel/reclaim paths |
| T5a | run loop check merged inputs | Not started | Trigger replan from unconsumed follow-ups |
| T5b | planner prompt merged inputs | Not started | Add follow-up section to planner prompt |
| T5c | final reply merged inputs | Not started | Add follow-up section to final reply generation |
| T5d | critique merged inputs | Not started | Pass merged inputs into critique path |
| T5e | context adapter group branch | Not started | Include `user_message_appended` context |
| T6a | `writeAskUserPrompt` helper | Not started | Group prompt message helper |
| T6b | `askUser` group handler | Not started | Remove group hard-fail and call helper |
| T6c | paused branch ask_user fields | Not started | Persist group ask_user target/start/open state |
| T6d | resume `canAnswerAskUser` | Not started | Enforce owner-lock/opened-for-all/non-member rules |
| T6e | `autoOpenAskUserForAll` worker checker | Not started | Open group ask_user after 30s |
| T7a | `writeGroupChildPlaceholder` | Not started | Child run card without fake human invoker |
| T7b | `createAgentRun.surfaceMode` | Not started | Route child card placeholder mode |
| T7c | `deepResearch` group branch | Not started | Child run inherits group/topic |
| T8 | long-poll 4 new hooks | Not started | Wake immediately for M7 status-only events |
| T9 | `AgentRunCard` UI additions | Not started | queued/merged suffix + child jump |
| T10 | `AskUserPromptCard` + `GroupChatScreen` | Not started | Group ask_user UI |
| T11 | full tests + code review | Not started | Backend full run, mobile tsc, manual checks, review |
| T12 | merge + tag | Not started | Merge and tag `v0.m7` only after T11 passes |

---

## 5. Test Plan To Preserve

Use the original M7 test matrix exactly:

| Test ID | Theme |
|---|---|
| TB1 | `acquireTopicSlot` create_fresh |
| TB2 | same-owner merge |
| TB3 | cross-owner merge inside 30s |
| TB4 | cross-owner queue after window |
| TB5 | parent run skips merge |
| TB6 | terminal run dequeues next queued run |
| TB7 | merge step injection and race safety |
| TB8 | group ask_user owner-only period |
| TB9 | group ask_user open-for-all period |
| TB10 | group ask_user rejects non-member |
| TB11 | group deep_research child run |
| TB12 | `jsonbOrNull` regression |
| TB13 | merged input P1 triggers replan |
| TB14 | merged input P2 final reply |
| TB15 | long-poll wakes on status-only M7 events |
| TB16 | blocking topic lookup excludes queued |
| TB17 | ask_user worker checker updates run and group message together |

Verification commands remain:

```bash
cd apps/api && DATABASE_URL=$(grep DATABASE_URL ../../.env | cut -d= -f2-) npx vitest run
```

```bash
cd apps/mobile && npx tsc --noEmit
```

---

## 6. Resume Checklist

Use this checklist only to track restart state. Detailed steps live in the original plan.

- [ ] Read `docs/superpowers/specs/2026-05-22-agent-runtime-m7-design.md`
- [ ] Read `docs/superpowers/plans/2026-05-22-agent-runtime-m7.md`
- [ ] Create branch `feat/agent-runtime-m7`
- [ ] Run T0 backend baseline
- [ ] Run T0 mobile baseline
- [ ] Execute T1a-T1e
- [ ] Execute T2a-T2b
- [ ] Execute T3a-T3b
- [ ] Execute T4a-T4b
- [ ] Execute T5a-T5e
- [ ] Execute T6a-T6e
- [ ] Execute T7a-T7c
- [ ] Execute T8
- [ ] Execute T9-T10
- [ ] Execute T11 full verification and review
- [ ] Execute T12 merge/tag after user confirmation

---

## 7. Handoff Rules

1. Do not change M7 scope from this document.
2. Do not renumber the original tasks.
3. Do not mark original plan checkboxes complete unless the exact corresponding implementation and verification step has passed.
4. Commit frequently using the commit messages already specified in the original plan.
5. Do not push, merge, or tag unless the user explicitly asks.

---

## 8. Next Action

Start with original plan section `T0：分支 + baseline`:

```bash
cd /Users/hongpengwang/agent-Carl-Gustav-Jung
git checkout main && git pull --ff-only
git checkout -b feat/agent-runtime-m7
cd apps/api && DATABASE_URL=$(grep DATABASE_URL ../../.env | cut -d= -f2-) npx vitest run
```

Then run:

```bash
cd /Users/hongpengwang/agent-Carl-Gustav-Jung/apps/mobile && npx tsc --noEmit
```

After T0 passes, continue with `T1a：migration 021_agent_topic_coord.sql` in the original plan.
