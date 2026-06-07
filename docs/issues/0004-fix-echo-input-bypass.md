# [0004] 修 `/echo` 输入旁路

## Parent
EPIC: 0000-epic-agent-loop-deepening(题外独立 bug,与深化主线无依赖)

## What to build
现状:用户消息只要含子串 "echo"(大小写不敏感),就**跳过 LLM planner**、直接跑写死的 echo 计划。真实用户问"echo 命令怎么用"会中招,拿到一堆"第 N 次 echo"而不是真回答。

把 echo-fallback 的触发**收窄到真正的测试/开发条件**(测试环境,或显式 dev flag),而不是看用户内容里有没有 "echo"。这是测试夹具和生产路由耦合在一处的浅化症状,顺手拆。

## Acceptance criteria
- [ ] 生产模式下含 "echo" 的真实消息(如"echo 命令怎么用")走 LLM planner,**不再**进写死 echo 计划。
- [ ] echo-fallback 在预期的测试/dev 条件下仍正常工作(CI 不依赖外部 LLM 的能力不丢)。
- [ ] 测试:生产模式 + 含 "echo" → LLM planner 路径;测试模式 → echo fallback。

## Blocked by
None - can start immediately
