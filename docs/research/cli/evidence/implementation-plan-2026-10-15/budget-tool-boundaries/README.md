# 第九轮：Agent 工具预算边界（2026-10-15）

对应[实施计划第 18 节](../../../../cli-ide-codex-claude-implementation-plan-2026-10-15.md#18-第九轮实施记录agent-工具与并行错误传播2026-10-15)。本轮收紧进程内 Agent 的共同工具入口；没有部署生产宿主、执行真实付费任务或发布制品。

| 检查                     | 结果                                            | 回执                                                         |
| ------------------------ | ----------------------------------------------- | ------------------------------------------------------------ |
| 最终 Node 回归           | 9 个文件、214 项通过，其中新增工具边界 6 项     | [node-tests.xml](./node-tests.xml)                           |
| Agent 单测               | 1 个 Vitest 文件、139 项通过                    | [vitest-agent-core.json](./vitest-agent-core.json)           |
| 扩展出口审计             | 1,639 文件、73 候选，未分类/解析错误/跳过均为 0 | [egress-review.json](./egress-review.json)                   |
| 语法与格式               | 44 个 JS/MJS、43 个改动文件检查通过             | [local-checks.json](./local-checks.json)                     |
| 测试前源码身份           | 48 个选定文件，工作区未提交改动；测试后均未变化 | [source-binding.json](./source-binding.json)                 |
| 历史原始回执             | 前七个预算证据子目录 58 个文件摘要保持不变      | [prior-artifact-binding.json](./prior-artifact-binding.json) |
| ESLint / 远端 CI         | `NOT_RUN`；ESLint 未安装                        | [validation-summary.json](./validation-summary.json)         |
| 正式评测 / native / 晋升 | `NOT_RUN`（0/36、0/9）/ `NOT_ADMITTED` / `HOLD` | 同上                                                         |

Node 计数取最终 JUnit 末尾的 `tests/pass`，包含父测试组；不累计前轮或重复运行。环境为 Windows x64、Node 22.22.2。父提交 `62b407bbefee02a2ac14495fcef9e59b237c05a7` 不能代表未提交源码；精确摘要见绑定文件，完整源码/脚本树另由审计摘要核对。

## 实现与验证范围

`requireUnscopedToolExecution()` 在 `executeTool` 开始时执行，先于参数、上下文、权限、hook 与 broker。它使正式预算作用域内的 canonical 工具调用抛出 `CC_BUDGET_TOOL_NOT_COVERED`，关闭后的异步后代抛出 `CC_BUDGET_SCOPE_CLOSED`，错误均标记 `noReplay:true`。当前连只读工具都停线，等待可信宿主逐项给出真实后代及外部服务合同。

Agent 并行只读批次原先把预算异常包装为普通工具结果。现在保留每个 promise 的统一结算，但在有序结果处抛出原预算错误；顺序路径已有传播规则。新测试运行真实 `agentLoop` 的两条分支，用注入模型桩验证预算拒绝后不再请求模型、没有正常工具结果。被拒的名称覆盖 shell、代码、网页、搜索、浏览器、技能、子代理、MCP、发布、只读与未知工具；参数/上下文代理会在被触及时抛错，测试证明前置拒绝无需读取它们。

首轮完整 Node 回归 **214 项、213 通过、1 失败**：[原始 JUnit](./node-tests-before-assertion-fix.xml)显示既有 canonical `web_search` 测试仍期待原服务错误码。直接搜索服务的 `CC_BUDGET_SERVICE_NOT_COVERED` 负例继续通过；共同工具入口提前拒绝后的错误码是 `CC_BUDGET_TOOL_NOT_COVERED`。只修正此项测试预期后重新冻结与完整回归，原生产拒绝顺序没有因测试而放宽。[首轮源码绑定](./source-binding-before-assertion-fix.json)、[审计](./egress-review-before-assertion-fix.json)、[本地检查](./local-checks-before-assertion-fix.json)及[Agent 单测](./vitest-agent-core-before-assertion-fix.json)保留；两次结果不累计。

变更触及两项网络候选：预算作用域模块维持 `BUDGET_BOUNDARY`，`agent-core.js` 维持 `MODEL_REQUEST`，精确源码摘要和理由已逐项复核于[分类清单](../../../../../../packages/cli/scripts/budget-egress-reviewed-sources.json)。[冻结前审计](./egress-review-before-freeze.json)保留为中间结果；最终审计与绑定在同一源码下。

本轮的拒绝不证明任意直接工具 API、插件、worker、已有服务、远端任务或 OS 出口受到控制。`withFormalBudgetProviderScope` 仍为显式、进程内作用域；不能把测试内的 `chatFn` 桩当作生产模型调用。真实子进程权限、网络撤销和计费需宿主与平台验收。历史共享 **$99**、`paidReady:false`、正式 `NOT_RUN`、native `NOT_ADMITTED`、晋升 `HOLD` 均保持，真实付费请求为 0。

## 复现

在仓库根执行以下离线命令；需要保存回执时写到新目录，以保留本轮原始字节。

```powershell
node --test packages/cli/test-node/formal-budget-tool-boundary.node-test.mjs
node packages/cli/scripts/implementation-plan-budget-egress.mjs --check --include-scripts
```

完整 9 文件命令、Vitest 命令和 artifact SHA-256 见[验证汇总](./validation-summary.json)。工作流已接线三系统 Node 检查，但本轮没有准确提交的远端 `CLI CI` 或 `CLI Strict Sandbox` 结果；发布 gate 仍关闭。
