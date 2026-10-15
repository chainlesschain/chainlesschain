# 第五轮诊断脚本审查与预算边界证据（2026-10-15）

对应[实施计划第 14 节](../../../../cli-ide-codex-claude-implementation-plan-2026-10-15.md#14-第五轮实施记录诊断脚本审查与预算拒绝2026-10-15)。本轮只分析源码、运行离线 provider 桩和本地协议测试，没有执行真实模型调用、生产证据收集或发布。

正式评测仍为 `NOT_RUN`、`0/36`、`0/9`；预算 `paidReady:false`，native `NOT_ADMITTED`，晋升 `HOLD`。原共享 $99 不重置。审查由实现方完成，不是独立财务、平台或正式样本准入意见。

## 实现与审查范围

上一轮的 14 个未分类脚本现已逐项记录源码摘要和用途。直接模型入口有校准探针、实施计划诊断、PM exploration 探针及 native 诊断 broker 四类；其余为三个本地协议测试、三个制品/元数据下载、两个 GitHub 证据 API、一个生产证据收集控制及一个 CONNECT 代理测试。详细路径和理由在 [script-review.json](./script-review.json)；外部服务、远端任务和通用代理没有被推断为免费或已获预算。

完整审计覆盖源码和脚本目录的 1,638 个 JS/MJS/CJS 文件、73 个候选，分类摘要匹配，未审查、解析错误和跳过路径均为 0。默认源码审计仍为 1,440 个文件、59 个候选，另外 14 个清单条目通过 `outOfScopeReviewedPaths` 明确不属于本次检查。CI 现执行完整扩展检查，文件变化、删除或新增候选仍需重新审查。空扫描根集合和扫描根软链接也被拒绝。

诊断 runner 使用已有 `CC_BUDGET_TRANSPORT_NOT_COVERED` 拒绝活动预算作用域，检查先于参数解构、真实配置、文件/环境修改或网络/子进程启动。PM 探针改为只在直接 CLI 调用时运行；导入不会执行探针或修改退出码。已有 native broker 的 `beginTask` 也拒绝作用域内领取任务，拒绝不消耗普通诊断的任务名额。

这些拒绝不把诊断估算转换成正式预留，也不能跨 HTTP/IPC 传播 AsyncLocalStorage。作用域外预先运行并领取任务的服务，其请求回调不会因客户端进入预算作用域而自动受控。可信宿主、凭据隔离、OS 出口和后代 containment 仍须单独证明。

## 最终验证

6 个 Node 文件 **81 项全部通过**，新增诊断边界 8 项及审计根 2 项。既有校准、broker、任务 trace 和冻结计划回归使用注入桩、本地 HTTP、固定 fixture 或只读本地结果收集，没有真实 paid provider 请求。计数独立于前轮，不重复相加。

39 个 JS/MJS 语法、37 个改动文件 Prettier 检查通过。ESLint 未安装，记 `NOT_RUN`。本轮没有修改 Vitest 旅程涉及的生产代码，不重复运行上一轮的 Vitest 集合；没有远端 CI/Strict Sandbox、公开安装、真人长时验收或发布回执。

| 证据                                                 | 内容                                                                   |
| ---------------------------------------------------- | ---------------------------------------------------------------------- |
| [source-binding.json](./source-binding.json)         | 测试前固定 43 个文件、工作区父提交、分支和工具版本；包含前轮未提交改动 |
| [node-tests.xml](./node-tests.xml)                   | 本轮六个 Node 文件完整原始结果，以 tests/pass 注释统计总数             |
| [source-audit.json](./source-audit.json)             | 默认源码范围 59 个候选；14 个脚本条目在本次范围外                      |
| [scripts-audit.json](./scripts-audit.json)           | 扩展源码与脚本范围 73 个候选全部分类通过                               |
| [script-review.json](./script-review.json)           | 本轮 14 个脚本的用途、源码摘要及未获财务准入状态，另绑定任务启动器     |
| [local-checks.json](./local-checks.json)             | 语法、Prettier、ESLint 和源码一致性结果                                |
| [validation-summary.json](./validation-summary.json) | 最终计数、命令、退出码、回执摘要及测试后源码核对                       |

JSON/XML 保留原始字节。上一轮的扩展审计失败回执保持原样；本轮新报告绑定新分类清单和新脚本源码，不能覆盖旧回执或宣称它验证了历史版本。父提交自身也不能标识含未提交修改的测试源码。

## 复现

仓库根目录运行以下命令。它们执行离线测试和静态审计，不授权付费诊断：

```powershell
node --test packages/cli/test-node/budget-egress-inventory.node-test.mjs packages/cli/test-node/budget-diagnostic-boundaries.node-test.mjs packages/cli/test-node/context-token-volcengine-live-probe.node-test.mjs packages/cli/test-node/verify01-volcengine-diagnostic-broker.node-test.mjs packages/cli/test-node/verify01-volcengine-task-diagnostic.node-test.mjs packages/cli/test-node/verify01-volcengine-plan.node-test.mjs
node packages/cli/scripts/implementation-plan-budget-egress.mjs --check --output <新的源码审计路径>
node packages/cli/scripts/implementation-plan-budget-egress.mjs --check --include-scripts --output <新的扩展审计路径>
```

第二、三条命令本轮均退出 0。不得把分类通过转换成真实 provider 探针、诊断 broker 或正式 36+9 执行授权。
