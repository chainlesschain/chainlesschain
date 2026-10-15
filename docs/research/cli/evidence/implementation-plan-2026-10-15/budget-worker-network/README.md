# 第十四轮：网络相关 worker 与 Marketplace 传输边界（2026-10-15）

对应[实施计划第 23 节](../../../../cli-ide-codex-claude-implementation-plan-2026-10-15.md#23-第十四轮实施记录网络相关-worker-与-marketplace-传输边界2026-10-15)。本轮只运行离线作用域拒绝及本地代理/Marketplace 回归，未发送付费模型请求。

| 验证               | 结果                                                        | 原始回执                                                                                                   |
| ------------------ | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 完整预算 Node 回归 | 14 个文件、231/231 项通过；新增 3 项                        | [node-tests.xml](./node-tests.xml)                                                                         |
| 相关 Vitest        | 2 个文件、8 项通过；1 项 Linux 专用用例在 Windows 跳过      | [vitest-worker-network.json](./vitest-worker-network.json)                                                 |
| 扩展出口审计       | 测试前后均为 1,639 文件、73 候选、零未分类/解析错误/跳过    | [egress-review.json](./egress-review.json)、[egress-review-post-test.json](./egress-review-post-test.json) |
| 源码与历史回执     | 测试前冻结 6 个文件，测试后无差异；先前 95 份回执摘要无差异 | [source-binding.json](./source-binding.json)、[integrity-check.json](./integrity-check.json)               |

egress 代理 worker 在创建前拒绝正式作用域，作用域外已创建代理的策略更新也拒绝；关闭与中止仍可用于清理。Marketplace 自定义网络传输在创建和 `fetch` 两处检查作用域，避免预先创建后复用；直接 PAC 解析在创建 worker 前检查。新增测试使用不可读取的调用者输入验证检查顺序，并实际创建本地代理测试复用和清理。作用域关闭后的异步 PAC 调用也被拒绝。

这些检查只覆盖当前接线入口；凭据传输 worker、文本搜索 worker、能力探测脚本、其他进程的 worker、未经过 Marketplace transport 的全局 fetch、SDK 与 OS 出口未由本轮证明受控。静态审计为源码分类，不是物理出口证明。Windows x64 / Node 22.22.2 本地通过；三系统 `CLI CI` 已接线，准确提交的远端矩阵和 Strict Sandbox 尚未运行。本地 ESLint 依赖缺失。正式状态仍为 `NOT_RUN`（0/36、0/9）、`paidReady:false`、native `NOT_ADMITTED`、晋升 `HOLD`；历史共享 **$99** 不重置，本轮付费请求为 0。

在仓库根可离线复现：

```powershell
node --test packages/cli/test-node/formal-budget-worker-network-boundary.node-test.mjs
node packages/cli/scripts/implementation-plan-budget-egress.mjs --check --include-scripts
```
