# REPL 请求在途崩溃恢复验证

对应差距清单 4.3、4.8、4.11。已运行真实 loopback REPL 旅程并保留原始红/绿证据；本记录仍不作为完整恢复验收通过证明，因为预派发输入持久化、OS PTY 和跨平台仍未完成。

核对源码 `3116842b0fdc5d5c6c747a404bf37b18fb8206c9`，后续文档提交 `6f9672380dbc5e7247a13958358c38e2fa423eb5` 不改变该实现。核对本地源码及固定提交公开原文，Astra 同时复审。

`packages/cli/src/repl/agent-repl.js` 在约 682 行的 provider dispatch 前保存 usage started。约 9564 行的当前用户输入先进入内存，约 10124 行才在完成后的 Auto-save 阶段保存用户和 assistant 正文，约 10151 行持久化 turn binding。`repl-turn-binding.js` 的 beginTurn 不写盘，settle 阶段才持久化。因此，已有正常退出再 resume 的旅程不能覆盖 started 已落盘而请求仍在途的退出窗口。静态顺序本身不证明会重复请求、丢失费用或无提示地丢失输入，需要实际故障验证。

新增验证复用 `packages/cli/__tests__/e2e/repl-memory-recall-e2e.test.js` 及其 fixture 的真实 REPL、隔离配置和 loopback provider transport。该基础设施模拟 stdin 的 isTTY，不是操作系统 PTY，不覆盖真人终端操作。

验证顺序：

1. 在独立配置、工作目录、session 中输入唯一旧任务，让本机 HTTP 服务挂起响应。
2. 由独立读取端确认 session 的已验证事件链包含该物理调用的 started，保存 callId。
3. 只终止本用例拥有的 REPL 子进程，等待真实 close 并记录退出信息。
4. 恢复同一 session，立即提交不同的唯一新输入，记录所有本机 provider 请求与事件链。
5. 核对旧请求未自动重放；原 callId 不得被新请求误结算，未决费用保留未知状态，历史费用不重置。
6. 若允许新输入，请求最多一次且使用独立 callId；若恢复策略要求先核对，则应显示可操作诊断且不发送新请求。
7. 核对在途原输入及恢复边界的用户可见说明；所有断言、失败阶段和子进程清理分别留证。

不使用付费模型。首轮失败必须保留，不能以替换 started/结算事件、自动清空未决项、重放旧任务或放宽恢复策略使测试通过。实际请求、账本与用户输出共同决定结果。

实施中的代码与运行证据将单列追加；本记录不改变整体清单的未完成状态。

Final product journey evidence: real CLI/readline/Evolution/JSONL with simulated stdin.isTTY, not an OS PTY. During a held HTTP response, model_usage_started was persisted; the owned REPL was killed, the same session resumed, and a new unique input was submitted. The final receipt records old provider replays 0, one new request, the old call retained as model-usage-unsettled, known token usage increasing from 15 to 30, and a session/call-bound recovery notice requiring inspect/reconcile before explicit resubmission. billingComplete=false; scoped observability rejects a session without authority. The old prompt was excluded from resumed provider history, so pre-dispatch prompt durability remains explicitly incomplete. Startup/dependency failures and both product red runs remain archived.

The exact post-commit test source must be executed again and its measured-source digest updated; the workflow and verifier require source-before/source-after to match Git blobs.
