# 第三轮模型出口与预算终止证据（2026-10-15）

对应[实施计划第 12 节](../../../../cli-ide-codex-claude-implementation-plan-2026-10-15.md#12-第三轮实施记录模型适配器与终止边界2026-10-15)。本轮使用离线 provider、真实 SQLite、真实演进权限和 Hub SDK 类型验证接线。默认网络出口与 grader broker 在新增测试中被替换为拒绝桩，避免回归失败时意外发送请求或启动子进程。

正式评测保持 `NOT_RUN`、`0/36` 与 `0/9`；预算 `paidReady:false`，native `NOT_ADMITTED`，晋升 `HOLD`。历史共享 $99 未重置，本轮没有真实 provider 请求、版本升级或发布。

## 实现与边界

`ask`、Cowork 和旧版 provider probe 经过同一 `providerFetch`，继续要求原有演进权限及输入投影。Hub 默认 Ollama 请求也经过作用域；Desktop/任意 SDK 回调、原生/自定义 embeddings 和独立 grader worker 不具备当前 Chat 计费合同，在作用域内拒绝原始调用或 broker 启动。拒绝入口不会读取并下发新的 transport 凭据，也不会给予 SDK 或子进程新的执行权限。

预算错误沿有界 cause 链识别。模型 fallback、认证恢复、流式重试、父子 Agent、后台任务和隔离 skill 不将其改写为普通失败继续执行。自动压缩和 prepareCall 也必须向宿主传播预算异常，主模型不能在未知费用之后继续调用。宿主 callback 直接返回 AsyncIterable 会报 `CC_BUDGET_SCOPE_UNCONSUMED`，必须在 callback 内完成消费。

这仍是宿主显式启用的进程内作用域。任意任务网络、动态 SDK、worker 和工具子进程没有取得系统级隔离证明。grader 入口拒绝不能证明任意方式启动的同一 worker 都不可执行；全部正式 gate 继续关闭。

## 原始证据

最终结果：3 个 Node 文件 **117 项全部通过**，其中作用域与调用链 42 项，比第二轮新增 13 项；23 个 Vitest 文件 **540 项全部通过**。26 个 JS/MJS 语法、27 文件 Prettier 和测试后源码摘要检查均通过。Vitest 完整耗时约 370 秒，真实 Hub SDK 回归是主要耗时来源；没有超时、跳过或未完成用例计作通过。

| 证据                                                 | 内容                                                                                      |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [source-binding.json](./source-binding.json)         | 测试开始前冻结 27 个改动文件；包含第二轮未提交实现，父提交自身不等于测试源码              |
| [node-tests.xml](./node-tests.xml)                   | authority、冻结计划、作用域及真实调用链测试；采用原始 tests/pass 注释，保留父子测试组口径 |
| [vitest-tests.json](./vitest-tests.json)             | 本轮定向回归原始结果，精确文件及去重计数以验证汇总为准                                    |
| [local-checks.json](./local-checks.json)             | 源码摘要、语法及 Prettier 检查；ESLint 缺依赖的检查状态                                   |
| [egress-review.json](./egress-review.json)           | 8 类、48 个词法候选、37 个待分类路径；记录新拒绝入口，不计算付费覆盖率                    |
| [baseline.json](./baseline.json)                     | 本机环境、当前源码包版本及未开放的正式准入状态                                            |
| [validation-summary.json](./validation-summary.json) | 最终测试计数、执行命令、原始回执摘要及测试后源码一致性核对                                |

本轮尚未取得准确提交的三系统 CI / Strict Sandbox 结果。ESLint 依赖仍未安装，因此不能记作通过。JSON/XML 沿用上级 `.gitattributes` 的原始字节保护。后续代码变更可以使历史源码摘要与工作区不同，不能覆盖旧回执或声称旧报告验证了新源码。

## 复现

仓库根目录运行：

```powershell
node --test packages/cli/test-node/formal-budget-authority.test.mjs packages/cli/test-node/formal-budget-frozen-plan.node-test.mjs packages/cli/test-node/formal-budget-provider-scope.node-test.mjs
node packages/cli/scripts/implementation-plan-budget-egress.mjs --output <新的审查输出路径>
node packages/cli/scripts/implementation-plan-status.mjs --output <新的基线输出路径>
```

在 `packages/cli` 目录，使用 `node ../../node_modules/vitest/vitest.mjs run <测试文件>` 执行验证汇总 `vitest.suites` 中的精确文件。含真实演进证据链的用例会持久写入临时目录，在 Windows 上可能耗时较长；测试总数不代表真实任务或公开安装分母。
