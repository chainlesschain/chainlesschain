# 第十五轮：凭据 worker 与引用 IPC 边界（2026-10-15）

对应[实施计划第 24 节](../../../../cli-ide-codex-claude-implementation-plan-2026-10-15.md#24-第十五轮实施记录凭据-worker-与引用-ipc-边界2026-10-15)。本轮只执行离线作用域拒绝与本地凭据传输回归，没有真实付费模型请求。

| 验证                   | 结果                                                         | 原始回执                                                                                                   |
| ---------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| 完整预算 Node 回归     | 15 个文件、235/235 项通过；新增 4 项                         | [node-tests.xml](./node-tests.xml)                                                                         |
| 凭据 Agent/传输 Vitest | 3 个文件、20/20 项通过                                       | [vitest-credential-worker.json](./vitest-credential-worker.json)                                           |
| 扩展出口审计           | 测试前后均为 1,639 文件、73 候选、零未分类/解析错误/跳过     | [egress-review.json](./egress-review.json)、[egress-review-post-test.json](./egress-review-post-test.json) |
| 源码与历史回执         | 测试前冻结 6 个文件，测试后无差异；先前 102 份回执摘要无差异 | [source-binding.json](./source-binding.json)、[integrity-check.json](./integrity-check.json)               |

传输构造、凭据注册与直接 IPC 引用解析在正式预算作用域内提前拒绝。既有传输仍可撤销引用或关闭；凭据 Agent 的签发、解析、环境过滤和子进程参数准备也在读取输入与写审计前拒绝。测试对调用者输入使用不可读取的代理对象，并向既有传输注入 worker 桩，确认拒绝前没有注册消息。作用域外原有引用约束由现有 Vitest 覆盖。

这仍是进程内调用边界，不识别其他进程发来的 IPC 请求，也不撤回作用域外已经签发的引用。固定文本搜索 worker 只执行本地有界扫描，本轮没有封禁；任意 SDK、原生插件、其他 worker 和 OS 出口未由此验证。Windows x64 / Node 22.22.2 本地通过；三系统 `CLI CI` 已接线，但准确提交的远端矩阵与 Strict Sandbox 尚未运行。本地 ESLint 依赖缺失。正式状态仍为 `NOT_RUN`（0/36、0/9）、`paidReady:false`、native `NOT_ADMITTED`、晋升 `HOLD`；历史共享 **$99** 不重置，本轮付费请求为 0。

在仓库根可离线复现：

```powershell
node --test packages/cli/test-node/formal-budget-credential-worker-boundary.node-test.mjs
node packages/cli/scripts/implementation-plan-budget-egress.mjs --check --include-scripts
```
