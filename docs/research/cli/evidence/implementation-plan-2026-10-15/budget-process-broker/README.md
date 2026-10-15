# 第十三轮：统一进程 broker 的预算边界（2026-10-15）

对应[实施计划第 22 节](../../../../cli-ide-codex-claude-implementation-plan-2026-10-15.md#22-第十三轮实施记录统一进程-broker-的预算边界2026-10-15)。本轮限制进程内统一 broker 的公开执行入口，没有真实付费子进程或生产部署。

| 验证           | 结果                                             | 原始回执                                                   |
| -------------- | ------------------------------------------------ | ---------------------------------------------------------- |
| 预算 Node 回归 | 13 个文件、228 项通过；新增 broker 边界 2 项     | [node-tests.xml](./node-tests.xml)                         |
| broker Vitest  | 3 个文件、17 项通过                              | [vitest-process-broker.json](./vitest-process-broker.json) |
| 扩展出口审计   | 1,639 文件、73 候选，未分类/解析错误/跳过均为 0  | [egress-review.json](./egress-review.json)                 |
| 测试前源码身份 | 4 个本轮相关文件，测试后摘要不变                 | [source-binding.json](./source-binding.json)               |
| 既有预算回执   | 七个早期目录 58 份，之后四轮 13/6/6/6 份摘要匹配 | [validation-summary.json](./validation-summary.json)       |

`ProcessExecutionBroker` 的 `spawn`、`spawnSync`、`exec`、`execSync`、`execFile`、`execFileSync` 和 `fork` 均在读取调用者命令、参数或选项前拒绝正式预算作用域。活跃作用域抛 `CC_BUDGET_DESCENDANT_NOT_COVERED`，已关闭作用域抛 `CC_BUDGET_SCOPE_CLOSED`，均为 `noReplay:true`。检查也早于工作区事务、凭据准备、审计记录和原生启动；终止/清理方法没有加入拒绝。

Node 测试对七个真实 broker 方法传入会抛错的代理，注入原生 spawn 桩，并比较审计长度和统计，确认零参数读取、零原生调用、零审计副作用。异步后代及作用域关闭另有负例。作用域外的同步、`execFile` 和上下文行为由现有 Vitest 验证。预跑的同一 17 项结果保存在 [vitest-preliminary.json](./vitest-preliminary.json)，不与最终结果累计。原始 Node JUnit 末尾 `tests/pass` 为 228/228，含父测试组。

broker 文件不是当前 AST 网络候选，仍以精确源码摘要绑定；审计通过不证明进程启动全覆盖。CLI 启动时的 `patch-child-process` 可以把部分调用转到 broker，本轮未验证它覆盖已缓存的原生函数引用、任意原生模块、worker、其他进程或 OS 出口。测试没有启动真实子进程，也不构成平台沙箱验收。

环境为 Windows x64、Node 22.22.2；源码身份绑定未提交工作区。三系统 `CLI CI` 已接入新 Node 文件，但没有准确提交的远端矩阵回执。本地 ESLint 依赖缺失。正式评测仍为 `NOT_RUN`（0/36、0/9）、`paidReady:false`、native `NOT_ADMITTED`、晋升 `HOLD`；历史共享 **$99** 不重置，本轮付费请求为 0。

在仓库根可离线复现：

```powershell
node --test packages/cli/test-node/formal-budget-process-broker-boundary.node-test.mjs
node packages/cli/scripts/implementation-plan-budget-egress.mjs --check --include-scripts
```
