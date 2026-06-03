# [0002] stall guard:无进展检测

## Parent
EPIC: 0000-epic-agent-loop-deepening

## What to build
给续跑加一道**无进展防呆**:当连续几轮续跑后"已完成 todo 数"不再增加(或超过 N 轮续跑上限)时,**干净停住并收尾**,而不是一路烧到 budget 硬顶。避免一个不可完成的目标把整轮预算空转掉。

补在 0001 的续跑机制之上 —— 0001 靠现有 budget 兜底防无限循环,本票把"兜底"升级为"察觉无进展就早停"。

## Acceptance criteria
- [ ] 一个续跑多轮但 todo 完成数不增长的任务,**在无进展/轮数上限处**干净停住并给合理终稿,而不是耗尽 maxSteps 才停。
- [ ] 续跑轮数上限可配置并被强制执行。
- [ ] 真在推进的正常多轮任务**不受影响**(不会被误停)。
- [ ] 测试:不可完成任务 → 停在无进展/轮数上限,而非 budget 耗尽。

## Blocked by
- [0001] 续跑且带观察

---

## 实现（MVP,2026-06-03,TDD）

- [x] **无进展检测** —— 续跑触发时算「累计成功 tool_call 步数」`successCount`,存进 continuation replan step;下次触发时若 `successCount` 没比上一轮续跑时多 → 判无进展 → **提前收尾**(`shouldContinue && madeProgress` 门控),不傻等到 `CONTINUATION_ROUND_CAP=2`。
- [x] **正常推进不受影响** —— 首次续跑(无 prior continuation)`madeProgress` 默认 true;`successCount > prior` 才算进展。B1/M7/cap 测试均不受影响。
- 注:轮数上限部分(CONTINUATION_ROUND_CAP)在 0001 已加;0002 补的是"无进展智能停"。
- 测试:`runtime.continuationReplan.test.ts` 的 "stall guard" 用例(预录 successCount=0 的续跑 + probe 持续失败 → 收尾而非续到 CAP)。RED→GREEN,429/429 全绿。

**坑记录**:测试不能预录成功 tool_call 来造 baseline —— 会被 reclaim 当成已完成的 plan step 把后续 step 跳过(debug 时 hadSoftFail=false 暴露)。改为只预录 continuation replan + successCount=0。

### Code-review（stall guard 后）

算术/类型/首轮/字段兼容全 CORRECT。修 1 个真 bug + 记 1 个权衡:
- [x] **缓存命中假停(低-中)** —— successCount 只数 tool_call,但 idempotency 缓存命中是 `observe` kind。某轮全靠缓存推进 → successCount 不增 → 误判无进展、提前收尾(还盖掉 reflection 的"没完成")。**已修**:successCount 也计入 observe(成功复用=有进展)。
- 记(可接受权衡):stall guard 在 `madeProgress=false` 时会**覆盖 reflection 的"没完成"** —— 若某轮的有效工作不是新的成功 tool_call(纯推理/合成),会被提前停。作为 CAP 限住的安全阀可接受;是有意的产品取舍。

429/429 全绿,tsc 干净。
