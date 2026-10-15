# 第四轮源码出口审计与搜索预算证据（2026-10-15）

对应[实施计划第 13 节](../../../../cli-ide-codex-claude-implementation-plan-2026-10-15.md#13-第四轮实施记录源码出口审计与搜索预算边界2026-10-15)。本轮只进行源码分析、离线模型桩和本地测试；没有执行真实 provider 探针或诊断 broker，没有新增付费调用、升级版本或发布。

正式评测保持 `NOT_RUN`、`0/36` 与 `0/9`；预算 `paidReady:false`，native `NOT_ADMITTED`，晋升 `HOLD`。历史共享 $99 未重置。分类清单由实现方检查源码形成，不是独立财务或 OS 准入意见。

## 实现与范围

Acorn 语法树扫描识别调用、已知 import/require/字面量动态导入、HTTP 选择器及解构/绑定别名，排除注释、声明名称与生成代码字符串正文。模板表达式继续扫描。源码分类绑定精确 SHA-256；新候选、失效摘要、候选移除、解析错误和跳过软链接都使 `--check` 拒绝通过。

默认范围 `packages/cli/src` 共 1,440 个 JS/MJS/CJS 文件、59 个候选文件，全部源码分类摘要匹配，解析错误及跳过路径均为 0。分类包括模型请求、预算边界、任务网络、服务 API、分发下载、诊断、本地 IPC、远端控制、内容寻址数据与搜索服务。源码用途分类不承诺免费、不证明服务端行为，也不计算付费覆盖率。

历史词法清单的 48 个候选和 37 个未关联路径与本轮语法树分母不同。报告把源码未审查/失效数 0 与未关联既有八类调用链数 48 分开呈现；后者仍需逐调用链和宿主验收。

扩展脚本扫描共 1,638 个文件、73 个候选，其中 14 个脚本尚未按当前分类清单审查，`--check --include-scripts` **预期拒绝，退出码 1**。它们包含真实 provider 探针、诊断 broker 和公开发布回读；完整路径见 `scripts-audit.json` 的 `unclassifiedCandidatePaths`。该结果保留未完成范围，没有自动批准脚本执行。

搜索服务缺少当前 Chat 合同所需的计费证明。正式预算作用域内，`webSearch` 在读取配置/密钥、获取工具租约或发起 HTTP 请求之前拒绝；`executeTool("web_search", ...)` 保留预算错误。该规则覆盖包括无密钥及自建实例在内的全部 provider 选择；普通作用域外搜索维持原行为。

扫描是最多八轮、文件级的保守别名分析，不是跨过程调用图。未知 SDK、计算属性、动态模块名、生成代码执行、worker、工具子进程和 OS 出口仍在证明范围之外。CLI CI 三系统检查已接线，本轮没有远端 CI / Strict Sandbox 结果，不能据此发布。

## 验证与原始回执

4 个 Node 文件 **134 项全部通过**，含新增审计及搜索负例 17 项；6 个 Vitest 文件 **236 项全部通过**，其中已有普通搜索测试 24 项。没有失败、取消或跳过计作通过。36 个 JS/MJS 语法、31 个改动文件 Prettier 检查通过；ESLint 未安装，记 `NOT_RUN`。本轮计数独立于前轮，不重复相加。

| 证据                                                 | 内容                                                                              |
| ---------------------------------------------------- | --------------------------------------------------------------------------------- |
| [source-binding.json](./source-binding.json)         | 测试前冻结 40 个文件，绑定含前三轮未提交改动的工作区、父提交与工具版本            |
| [node-tests.xml](./node-tests.xml)                   | authority、冻结计划、provider scope 与审计/搜索测试；总数采用原始 tests/pass 注释 |
| [vitest-tests.json](./vitest-tests.json)             | 普通搜索、Agent 工具、usage、流式异常、自动压缩和 prepareCall 定向回归            |
| [source-audit.json](./source-audit.json)             | 默认源码范围；分类通过，正式付费准入仍关闭                                        |
| [scripts-audit.json](./scripts-audit.json)           | 扩展脚本范围；14 个未审查脚本导致预期拒绝                                         |
| [local-checks.json](./local-checks.json)             | 语法、Prettier、ESLint 状态及源码一致性检查                                       |
| [baseline.json](./baseline.json)                     | 本机源码包版本与 13 个工作包状态；源码版本不等于公开发布版本                      |
| [validation-summary.json](./validation-summary.json) | 命令、退出码、测试计数、原始回执摘要及测试后源码一致性                            |

JSON/XML 保留原始字节，不修改历史回执。父提交自身不标识含未提交改动的测试版本；后续源码变化也不能用旧回执宣称验证通过。

## 复现

仓库根目录执行以下命令，默认源码检查不发送 provider 请求：

```powershell
node --test packages/cli/test-node/formal-budget-authority.test.mjs packages/cli/test-node/formal-budget-frozen-plan.node-test.mjs packages/cli/test-node/formal-budget-provider-scope.node-test.mjs packages/cli/test-node/budget-egress-inventory.node-test.mjs
node packages/cli/scripts/implementation-plan-budget-egress.mjs --check --output <新的源码审计路径>
node packages/cli/scripts/implementation-plan-budget-egress.mjs --check --include-scripts --output <新的扩展审计路径>
```

第三条命令当前预期退出 1，不应把未审查脚本自动加入清单使它通过。在 `packages/cli` 下运行 `node ../../node_modules/vitest/vitest.mjs run <测试文件>`；精确文件见 `source-binding.json` 的 `vitestSuites`。分类源码变更后，先检查对应调用、用途和风险，再更新单个摘要与理由，不批量自动接受变更。
