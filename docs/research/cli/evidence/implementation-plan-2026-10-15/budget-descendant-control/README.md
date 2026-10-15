# 第十轮：直接子进程与 keeper 控制边界（2026-10-15）

对应[实施计划第 19 节](../../../../cli-ide-codex-claude-implementation-plan-2026-10-15.md#19-第十轮实施记录直接子进程与-keeper-控制边界2026-10-15)。本轮只收紧进程内直接 IPC 控制入口，没有生产部署或真实付费调用。

| 验证                | 结果                                            | 原始回执                                             |
| ------------------- | ----------------------------------------------- | ---------------------------------------------------- |
| 预算 Node 回归      | 10 个文件、217 项通过；新增直接控制边界 3 项    | [node-tests.xml](./node-tests.xml)                   |
| IPC / keeper Vitest | 3 个文件、25 项通过                             | [vitest-ipc-keeper.json](./vitest-ipc-keeper.json)   |
| 扩展出口审计        | 1,639 文件、73 候选、未分类/解析错误/跳过均为 0 | [egress-review.json](./egress-review.json)           |
| 测试前源码身份      | 6 个本轮相关文件，测试后摘要不变                | [source-binding.json](./source-binding.json)         |
| 历史证据            | 前八轮 58 份、第九轮 13 份摘要未变化            | [validation-summary.json](./validation-summary.json) |

`AgentIPCBus.spawnAgentProcess` 在读取调用者选项与执行 broker 前拒绝；`connectBackgroundAgentKeeper` 在解析握手与建连前拒绝。已有 keeper 连接的 `arm` 也重新检查当前作用域；关闭后的异步调用拒绝。`retire` 继续可发送本地清理请求。离线测试对参数施加会抛错的代理，用注入桩确认零 spawn、零 socket connect，再由真实本地 keeper fixture 确认零违规 ARM 帧；作用域外 ARM 与作用域内 RETIRE 各产生一次预期帧。两种预算错误均标记 `noReplay:true`。

分类清单将本轮改动后的 keeper 客户端继续列为 `LOCAL_IPC`，预算作用域继续列为 `BUDGET_BOUNDARY`，并绑定精确 SHA-256。IPC 总线本身不是当前网络候选，并未因此取得子进程安全认证。`AsyncLocalStorage` 无法约束其他进程、既有 keeper 自行继续执行、任意 worker 或 OS 出口；未接线的直接 spawn、team 命令与网络 SDK 仍在范围外。`retire` 是必要的清理控制，并不意味着该 IPC 通道没有副作用。

原始 Node JUnit 的 `tests/pass` 行为 217/217，含父测试组；Vitest 计数来自最终 JSON，前一次 25 项预跑保存在 [vitest-preliminary.json](./vitest-preliminary.json)，不累计。环境为 Windows x64、Node 22.22.2。源码身份是未提交工作区摘要，父提交不能替代。语法、Prettier、`git diff --check` 与历史摘要核对见汇总；本轮没有取得三系统准确提交的远端 `CLI CI` 或 `CLI Strict Sandbox` 回执。

在仓库根可离线复现：

```powershell
node --test packages/cli/test-node/formal-budget-descendant-control.node-test.mjs
node packages/cli/scripts/implementation-plan-budget-egress.mjs --check --include-scripts
```

正式评测仍为 `NOT_RUN`（0/36、0/9），`paidReady:false`，native `NOT_ADMITTED`，晋升 `HOLD`。历史共享 **$99** 不重置；本轮真实付费请求为 0。生产认证检查点、系统级出口隔离、账单核对和正式安装/任务验收仍待完成。
