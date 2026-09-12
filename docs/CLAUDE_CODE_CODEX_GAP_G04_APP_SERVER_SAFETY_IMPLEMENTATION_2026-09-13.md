# Claude Code / Codex 差距优化：G04 App Server 接线前安全修复

> 日期：2026-09-13（Asia/Shanghai）<br>
> 对应审计：[最新版本差距报告](./CLAUDE_CODE_CODEX_LATEST_GAP_ANALYSIS_2026-09-12.md)<br>
> 范围：关闭实验 Codex App Server 适配器的失败终态误投影和不明提交重复回退反例。适配器仍未接入产品主链，版本兼容矩阵也未扩展。

## 1. 已修复的协议反例

主要实现：[实验适配器](../packages/cli/src/lib/codex-app-server-adapter.js)、[故障注入测试](../packages/cli/__tests__/unit/codex-app-server-adapter.test.js)。

| 场景                                              | 修复前                           | 修复后                                                                  |
| ------------------------------------------------- | -------------------------------- | ----------------------------------------------------------------------- |
| `turn/completed` 携带 `turn.status:"failed"`      | 被重写为 completed，错误丢失     | 保留 failed，并优先保留 `turn.error`                                    |
| `turn/completed` 携带 `turn.status:"interrupted"` | 被重写为 completed               | 保留 interrupted，不冒充成功                                            |
| terminal event 缺少受支持状态                     | 默认当成成功                     | fail closed 为 failed，返回稳定协议错误码                               |
| `turn/start` 已发出 `turn/started` 后响应丢失     | 仍可能调用 `codex exec` fallback | 返回 admission 后失败，禁止第二次执行                                   |
| `turn/start` promise 拒绝且没有 receipt           | 当作未提交并 fallback            | 返回 `CC_CODEX_APP_SERVER_SUBMISSION_UNKNOWN`，禁止未经核对的第二次执行 |

官方 [App Server 生命周期](https://learn.chatgpt.com/docs/app-server) 说明，结束通知仍使用 `turn/completed`，最终 `turn.status` 可以是 `completed`、`interrupted` 或 `failed`，失败信息位于 turn 的 error 中。因此方法名本身不是成功判据。

## 2. 回退边界

feature 未启用、上游版本不在 fail-closed 矩阵、client 不可用、启动/建 thread 失败或没有 thread identity 时，适配器尚未开始 `turn/start`，仍可回退到稳定的 `codex exec --json` 路径。

从调用 `turn/start` 开始，连接错误不能证明请求未到达服务端。当前适配器没有可验证的幂等 key 或提交状态查询，所以选择保守阻断并返回以下状态之一：

- 已观察到 `turn/started`、item 或 terminal：`CC_CODEX_APP_SERVER_FAILED_AFTER_ADMISSION`；
- 没有 receipt，提交结果未知：`CC_CODEX_APP_SERVER_SUBMISSION_UNKNOWN`；
- 已观察到 terminal：直接按该 terminal 返回，不再因丢失 RPC response 覆写结果。

这会在少数“实际未发送、但 client 未提供可证据化状态”的故障中牺牲自动回退可用性，换取不重复执行可能产生副作用的任务。未来只有在上游提供并验证幂等/状态核对合同后，才能安全缩小该阻断范围。

## 3. 本地验证

| 检查                                            | 结果                                                                    |
| ----------------------------------------------- | ----------------------------------------------------------------------- |
| App Server adapter + 稳定 external adapter 合同 | 2 files，15 passed                                                      |
| 故障注入                                        | failed、interrupted、非法 terminal、已接收后断线、无 receipt 断线均通过 |
| 生产引用扫描                                    | `packages/cli/src` 除适配器自身外无调用方                               |
| ESLint / diff                                   | 目标 ESLint 0 errors/warnings；`git diff --check` 通过                  |

测试仅使用进程内 fake client，没有启动 Codex、没有外部网络，也没有执行真实任务。

## 4. 仍未关闭的边界

- `0.154.0` 尚未加入兼容矩阵；不能以本地 fake 测试代替其真实 schema、握手和生命周期验证。
- 尚未获得同一候选 SHA 的 Linux/Windows/macOS 完整工作流证据。
- 适配器仍是 feature-gated、experimental、non-authoritative，且没有产品调用方。
- 没有对真实 App Server 执行提交状态恢复、取消、审批、断线重连和持久 thread 旅程。

因此，本批关闭的是两个接线前代码反例，不是 G04 的真实版本兼容或产品接线验收。只有精确候选 SHA 的规定矩阵通过后，才应扩展 `CODEX_APP_SERVER_COMPATIBILITY_MATRIX`；即使通过，也仍需单独决定是否接入产品。
