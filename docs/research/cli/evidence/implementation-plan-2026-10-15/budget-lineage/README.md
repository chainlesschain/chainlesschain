# 第六轮独立谱系登记与回滚拒绝证据（2026-10-15）

对应[实施计划第 15 节](../../../../cli-ide-codex-claude-implementation-plan-2026-10-15.md#15-第六轮实施记录独立谱系登记与账本回滚拒绝2026-10-15)。本轮使用真实 SQLite、真实并发/终止的 Node 进程及离线 provider 响应，不读取真实 provider 凭据、不执行付费模型调用、不发布。

正式评测仍为 `NOT_RUN`、`0/36`、`0/9`；预算 `paidReady:false`，native `NOT_ADMITTED`，晋升 `HOLD`。历史共享 $99 不重置。工程证明只适用于登记库由可信宿主保护、没有与 authority 一起回滚的前提。

## 实现与提交合同

[FormalBudgetLineageRegistry](../../../../../../packages/cli/src/lib/formal-budget-lineage-registry.js) 为每个 lineage 固定一次注册、plan/activation、规范路径、文件身份、完整状态摘要及版本。相同 lineage 不会在第二路径初始化新额度；guarded authority 不能省略或换用另一登记库。

authority 对 schema、激活记录、task/run/call/event/guard 的逻辑状态整体取摘要，并在读取状态、预留合同和每次修改前校验。只比较事件数不能发现的金额改动也会拒绝。读取预留合同的路径在取凭据前仍经过同一检查。

锁定顺序为登记库 → authority。修改 authority 后，先把新摘要持久提交至登记库，再提交 authority；全部完成才返回。这不是分布式原子事务：提交中断会使两边不一致并拒绝继续，留给外部核对。没有清空既有登记、降低版本或自动恢复额度的接口。结算的两库提交中断会保留本地完整未决预留，不能被计作额度释放。

新能力由宿主通过 `lineageRegistry` 显式注入，仅对新建且显式登记的 authority 生效。旧库不自动迁移；也不能拿旧激活历史重新建库当作迁移。历史实际消费、未决费用和已用 run 必须先按原合同核对。路径、binding 和 registry descriptor 是可信宿主能力，不能传给任务或后代。

## 证明范围与限制

本轮新增 17 项测试覆盖唯一登记、错配/缺失 guard、数据库副本/替换、原位恢复、同事件数改金额、多进程竞争、登记库写失败、两次提交之间的真实进程终止、结算中断、历史支出/未决/run 次数，以及普通 transport 的成功/拒绝路径。网络桩只接受固定 fixture；预算状态异常时凭据回调和 HTTP 调用均为 0。

登记库不是硬件或 OS 单调计数器。复制/还原登记库本身、同时还原两库、让任务修改文件、在新登记库重复使用旧历史，或者由宿主主动省略注册策略，都需要另外的权限和验收控制。本轮没有证明这些条件不可发生，不允许据此开放实际付费执行。账本摘要取全量状态，也没有取得规模化性能 SLO 证明。

本轮没有真实账单核对、宿主凭据/网络隔离、独立人工恢复批准、九入口安装、36+9 执行、真人长时观察、远端 CI/Strict Sandbox 或发布结果。

## 原始回执与复核

第一轮冻结后的 Node 回归和首次扩展审计分别保存在 `node-tests.xml`、`scripts-audit.json`。前者通过；后者正确拒绝已变化但未更新摘要的状态脚本。随后只刷新该脚本分类的摘要/理由，记录为 `source-binding-final.json` 中唯一变化，再执行最终回归；最终计数只取最终回执，不重复相加。

Windows x64、Node 22.22.2 的最终 6 个 Node 文件 **161 项全部通过**，没有失败、取消或跳过计作通过；其中本轮新增谱系测试 17 项。40 个 JS/MJS 语法与 40 个改动文件 Prettier 检查通过。最终执行前冻结的 44 个文件、完整源码/脚本树摘要和历史回执在最终核对中逐项验证。

| 证据                                                     | 内容                                                                           |
| -------------------------------------------------------- | ------------------------------------------------------------------------------ |
| [source-binding-final.json](./source-binding-final.json) | 最终验证前冻结 44 个工作区、测试、工作流与依赖文件，父提交不代替这些未提交源码 |
| [node-tests-final.xml](./node-tests-final.xml)           | authority、冻结计划、provider scope、谱系、出口清单及诊断边界完整回归          |
| [egress-review-final.json](./egress-review-final.json)   | 最终 1,639 文件、73 候选审计；登记库部署证明仍为 false                         |
| [local-checks-final.json](./local-checks-final.json)     | 40 个 JS/MJS 语法、40 个改动文件 Prettier、ESLint 状态及绑定检查               |
| [baseline.json](./baseline.json)                         | 含 registry 来源摘要的本机 13 工作包清单与关闭的正式状态                       |
| [validation-summary.json](./validation-summary.json)     | 最终计数、命令、退出码、原始回执摘要及测试后源码一致性                         |
| [source-binding.json](./source-binding.json)             | 清单复核前的首次冻结，保留原样                                                 |
| [scripts-audit.json](./scripts-audit.json)               | 首次审计失败：一个 STALE 状态脚本，原退出码 1                                  |
| [node-tests.xml](./node-tests.xml)                       | 清单刷新前的重复回归，不能与最终结果累计                                       |
| [local-checks.json](./local-checks.json)                 | 首次冻结的本地检查，不能代替最终来源清单身份                                   |

JSON/XML 沿用上级原始字节保护；前五轮回执不覆盖。ESLint 未安装，记 `NOT_RUN`；本轮未修改 Vitest 旅程覆盖的调用行为，不额外累计前轮 Vitest 结果。

## 复现

仓库根目录运行，所有 provider 响应均为离线 fixture：

```powershell
node --test packages/cli/test-node/formal-budget-authority.test.mjs packages/cli/test-node/formal-budget-frozen-plan.node-test.mjs packages/cli/test-node/formal-budget-provider-scope.node-test.mjs packages/cli/test-node/formal-budget-lineage.node-test.mjs packages/cli/test-node/budget-egress-inventory.node-test.mjs packages/cli/test-node/budget-diagnostic-boundaries.node-test.mjs
node packages/cli/scripts/implementation-plan-budget-egress.mjs --check --include-scripts --output <新的扩展审计路径>
```

第二条静态审计只接受当前已审查源码摘要。任何审计通过都不等于真实 provider、额外支出、重新激活历史 $99 或发布授权。
