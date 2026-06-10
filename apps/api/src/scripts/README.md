# scripts 索引

开发/验证用脚本,均不进生产构建。

## 深测驱动器(2026-06 E2E campaign,Phase 1 集成验证)

来源:`docs/reports/2026-06-08-deep-agent-test-design.md` §6;证据笔记见 `docs/reports/test-campaign-2026-06-08.md`。
全程只走 HTTP API + PG 读查(无 shell/文件执行面),驱动真 LLM 跑多轮场景并捕获内部逻辑链。

| 脚本 | 用途 | 产物 |
|---|---|---|
| `deep-test-driver.mjs` | 对话场景驱动(S1 荣格深挖等,逐轮 user 话术 → run 元 + agent_steps 全链 + 终稿) | `/tmp/deep-test-<SCENARIO>.json` |
| `deep-test-s7-driver.mjs` | S7 控制面闭环(ask_user / approval / steer 三种暂停-续跑) | `/tmp/deep-test-S7.json` |
| `deep_test_pdf.py` | 把上述 JSON 渲染成厚 PDF 报告(reportlab,中文字体 STHeiti) | `deep-agent-test.pdf` |

**运行前提**:① 本地 api 起在 `:3922` 且连测试 PG;② `.env` 注入(`set -a; . .env; set +a`);③ `DSK=<deepseek-key>`(真 LLM);④ PDF 需 `pip install reportlab`。脚本内 USER/SESSION 为本地测试库的种子 ID。

**现状定位**:Phase 1「真 LLM 活体验收」驱动器;Phase 2(mock LLM 的 vitest e2e)是后续扩展方向。

## 其他

- `seed.ts` — 本地开发种子数据。
- `llmSpike.ts` — LLM 接口连通性 spike。
- `react-latency-prototype.ts` — M2 纯 ReAct 延迟原型(路线图 go/no-go 依据,结论:plan-once 保留)。
