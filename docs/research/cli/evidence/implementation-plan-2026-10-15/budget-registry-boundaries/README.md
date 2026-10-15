# 第七轮登记库身份、检查点与租约证据（2026-10-15）

对应[实施计划第 16 节](../../../../cli-ide-codex-claude-implementation-plan-2026-10-15.md#16-第七轮实施记录登记库身份与检查点边界2026-10-15)。本轮只使用真实 SQLite、本地 Node 进程及离线 provider fixture；没有真实付费请求、版本升级、发布或正式样本执行。

正式状态保持 `NOT_RUN`、`0/36`、`0/9`、`paidReady:false`、native `NOT_ADMITTED`、晋升 `HOLD`。原共享 $99 不重置。下文的 46 微美元和恢复后的 0 都是合成用量的账本值，不是实际账单。

## 实现范围

登记库 descriptor 必须固定 `registryFileIdentity`；authority 的 guard 表进一步固定登记库 UUID、规范路径及文件身份。复制后 UUID 相同也不能替换原登记库，改写 descriptor 指向副本同样会被 authority 的持久绑定拒绝。事务开始时再次检查文件身份及库内 UUID。

活跃实例记录每个已见 lineage 的版本、摘要和固定元数据。降低版本、同版本换摘要、删除已知登记或换 binding 等固定字段会停止访问。`checkpoint(lineageId)` 返回冻结且可序列化的头记录；重启时可通过 `trustedCheckpoints` 输入由宿主独立保存并认证的比较下界，允许合法更高版本，拒绝已知旧状态。

检查点 API 不提供签名认证或独立持久化，也未接入每次物理发送前的推进流程。只有形状和下界比较不能证明调用者提供的检查点可信、足够新或不可回滚。宿主强制使用和保护检查点仍是正式准入条件。

旧 guard 缺少物理绑定字段时直接拒绝，没有自动迁移。未接入 guard 的离线兼容路径继续存在，不能代替正式宿主策略。

## 必须保留的反例

测试先在固定 fixture 下结算 46 微美元，再把 authority 内容和登记库头恢复到此前匹配快照，文件物理身份保持不变：

| 情况                         | 实际结果                          | 证明范围                               |
| ---------------------------- | --------------------------------- | -------------------------------------- |
| 活跃登记库实例已经观察过新头 | 拒绝 `CC_BUDGET_LINEAGE_ROLLBACK` | 进程内观察记录发现回退                 |
| 重启时提供独立固定的新检查点 | 打开 authority 前拒绝             | 下界比较；含真实新进程回归             |
| 重启且省略全部独立检查点     | 可打开匹配旧库，曝险回到 0        | 预期复现的未完成边界，不能据此开放付费 |

这不是“所有登记库回滚都已阻止”的证明。过旧检查点不能覆盖其后消费；有权限修改两库、提供伪造检查点或伪造更高版本的行为仍需外部认证和隔离。把同一数据库的当前头重新读出再当作独立检查点，也不能证明新鲜度。

## 租约合同

成功、失败或返回 Promise 后，捕获的事务租约都会在回调结束时失效。旧租约即使在另一合法事务内调用，也不能发布新摘要。直接 async/生成器函数在调用前拒绝，普通回调返回 Promise 则报同步合同错误；租约不能用于延迟推进。

相关错误具有 `CC_BUDGET_LINEAGE_*` 代码，沿用预算终止策略。没有新增网络授权、凭据下发或解除历史未知费用的入口。

## 验证和证据

本轮新增 17 项边界测试，连同既有 authority、冻结计划、scope、谱系、出口和诊断测试执行完整 Node 回归。最终计数不与前轮或开发检查重复累计。源码/脚本审计仍为 1,639 个文件、73 个候选，不宣称静态穷尽或运行时覆盖。

Windows x64、Node 22.22.2 下，最终 7 个 Node 文件 **178 项全部通过**，无失败、取消或跳过计作通过。41 个 JS/MJS 语法、41 个改动文件 Prettier 检查通过；45 个冻结文件、源码/脚本树和历史原始回执在最终核对中验证摘要。

| 证据                                                 | 内容                                                                       |
| ---------------------------------------------------- | -------------------------------------------------------------------------- |
| [source-binding.json](./source-binding.json)         | 测试前冻结 45 个工作区源码、测试、工作流和依赖文件；父提交不代替未提交改动 |
| [node-tests.xml](./node-tests.xml)                   | 七个 Node 文件完整原始回执，tests/pass 注释为总数依据                      |
| [egress-review.json](./egress-review.json)           | 73 个候选审计及检查点认证、发送前持久化、强制重启策略仍未验证的状态        |
| [local-checks.json](./local-checks.json)             | JS/MJS 语法、Prettier、ESLint 及来源一致性                                 |
| [validation-summary.json](./validation-summary.json) | 最终计数、命令、退出码、原始字节摘要、源码核对及无检查点反例               |

JSON/XML 保留原始字节，前六轮回执不覆盖。ESLint 缺依赖仍为 `NOT_RUN`；没有新增 Vitest、真实宿主/OS、独立账单、九入口、36+9、真人长时或远端 CI/Strict Sandbox 回执。

## 复现

仓库根目录执行，provider 和价格均为 fixture：

```powershell
node --test packages/cli/test-node/formal-budget-authority.test.mjs packages/cli/test-node/formal-budget-frozen-plan.node-test.mjs packages/cli/test-node/formal-budget-provider-scope.node-test.mjs packages/cli/test-node/formal-budget-lineage.node-test.mjs packages/cli/test-node/formal-budget-registry-boundary.node-test.mjs packages/cli/test-node/budget-egress-inventory.node-test.mjs packages/cli/test-node/budget-diagnostic-boundaries.node-test.mjs
node packages/cli/scripts/implementation-plan-budget-egress.mjs --check --include-scripts --output <新的审计路径>
```

单独执行 `formal-budget-registry-boundary.node-test.mjs` 可检查本轮边界和反例；静态审计只检查分类摘要，不能替代正式付费准入。
