# 第八轮：宿主检查点接线证据（2026-10-15）

对应[实施计划第 17 节](../../../../cli-ide-codex-claude-implementation-plan-2026-10-15.md#17-第八轮实施记录宿主检查点策略与发送顺序2026-10-15)。本轮实现显式固定的检查点宿主合同，未部署生产存储、发起真实付费调用或发布制品。

| 检查                           | 结果                                            | 回执                                                         |
| ------------------------------ | ----------------------------------------------- | ------------------------------------------------------------ |
| 最终 Node 回归                 | 8 个文件、208 项通过，其中新增宿主测试 30 项    | [node-tests.xml](./node-tests.xml)                           |
| 扩展出口审计                   | 1,639 文件、73 候选，未分类/解析错误/跳过均为 0 | [egress-review.json](./egress-review.json)                   |
| 语法与格式                     | 43 个 JS/MJS、42 个改动文件检查通过             | [local-checks.json](./local-checks.json)                     |
| 测试前源码身份                 | 47 个选定文件，工作区未提交改动；测试后均未变化 | [source-binding.json](./source-binding.json)                 |
| 历史原始回执                   | 前六个预算证据子目录 49 个文件摘要保持不变      | [prior-artifact-binding.json](./prior-artifact-binding.json) |
| ESLint / 新增 Vitest / 远端 CI | `NOT_RUN`；ESLint 未安装                        | [validation-summary.json](./validation-summary.json)         |
| 正式评测 / native / 晋升       | `NOT_RUN`（0/36、0/9）/ `NOT_ADMITTED` / `HOLD` | 同上                                                         |

计数取最终 JUnit 末尾的 Node `tests/pass` 原始统计，包含父测试组；不累计前轮或重复运行。环境为 Windows x64、Node 22.22.2。父提交 `62b407bbefee02a2ac14495fcef9e59b237c05a7` 不能代表未提交的测试源码；精确摘要见绑定文件。全源码/脚本树另由审计摘要固定并在测试后重新计算。

## 宿主合同

`FormalBudgetLineageRegistry.initialize({ filename, checkpointHostId })` 只在创建新登记库时固定宿主策略，随后必须以相同 ID 的 `checkpointHost` 打开。authority guard 也固定该 ID，不能通过省略 constructor 参数、替换宿主或删除登记策略使其降级。没有自动迁移、补种或重置历史额度。

端口为 `{ id, load(bindingIdentity), publish(checkpoint, digest) }`，两个方法必须同步：

1. `load` 返回当前登记库所有 lineage 的完整最新检查点数组。宿主负责认证与独立读取；有任何 lineage 时空数组不能当作初始值。记录必须与登记库精确一致，不能只比较“足够旧”的下界。
2. `publish` 负责独立持久写入，拒绝降低版本或同版本变更，并允许同一记录的幂等重发；成功返回 `{ durable: true, checkpointDigest: digest }`。`lineageCheckpointDigest` 按固定的已知字段序列绑定摘要，字段对象的键顺序不参与身份判断；摘要本身不构成认证。
3. 登记库提交后发布该头，检查回执并再次 `load`，然后 authority 才提交。原 transport 的 `markDispatched` 在同一同步调用中完成这一步，返回后没有 await 即调用注入 fetch。读取预留合同和状态也核对宿主记录。
4. 直接 async/生成器在调用前拒绝；普通函数返回 Promise/thenable、错误摘要、非持久回执、写入成功但未读回、回调重入均不能授权提交。函数身份在实例中固定。

错误继续携带 `CC_BUDGET_*` 和 `noReplay:true`。预留阶段失败在凭据读取之前；发送阶段失败保留 held 费用且零物理请求；结算失败阻止成功 EOF 并保留 dispatched 费用。transport 后段沿用未知结果错误，不能据此重试。注册部分成功后也不删除原数据库或重新发放额度。

## 故障及信任边界

30 项新增测试涵盖真实子进程的漏传宿主、最新头读回、双库原位恢复、并发预留、登记库/宿主已提交后终止进程，以及预留、发送、结算和取消的故障顺序。网络使用 `.invalid` 合同与注入响应，凭据是离线字符串；真实付费请求为 0。

最初定向运行 58 项、56 通过、2 失败，均为新增测试写错既有错误码：已结算 call 的重放是 `CC_BUDGET_CALL_REPLAY`，未决预留先触发 `CC_BUDGET_PENDING`。修正预期后完成最终验证。其[观察记录](./preliminary-failures.json)明确标为工具输出摘录，不冒充原始 XML；[冻结前审计](./egress-review-before-freeze.json)也保留，不替代最终源码绑定下的回执。

两份匹配旧库的恢复在最新宿主记录仍在时被新进程拒绝。反例同样保留：合成结算 46 微美元后，把两库和测试宿主文件一起恢复，新实例会接受旧的 0 曝险。测试宿主文件与数据库位于同一临时目录，完全不具备生产独立恢复域。本轮不把回执标志、读回成功或 passing assertions 当作硬件单调计数器、生产存储认证或独立验收。

登记库、宿主、authority 没有跨存储原子提交。任何部分提交均保留状态并停止，要求外部核对；并发时看到暂时不一致也可能拒绝，当前没有可用性 SLO。生产宿主仍须提供独立保护的最新记录、认证、权限和单调幂等写入；有权同时回滚全部信任根的攻击不在此合同的保护范围。旧的可选检查点模式仍保留第七轮的漏传反例。

## 复现

在仓库根执行以下命令，使用本地原生 SQLite 依赖，不需要 provider 凭据。第二次运行的回执应写入新的目录，避免覆盖本轮原始字节。

```powershell
node --test packages/cli/test-node/formal-budget-checkpoint-host.node-test.mjs
node packages/cli/scripts/implementation-plan-budget-egress.mjs --check --include-scripts
```

完整 8 文件命令及 artifact SHA-256 见[验证汇总](./validation-summary.json)。本轮没有新增 Vitest 或远端 Linux/Windows/macOS CI、Strict Sandbox 结果；工作流已接线不能替代准确提交的远端发布 gate。没有升级版本或发布包，原共享 **$99**、`paidReady:false`、正式 `NOT_RUN`、native `NOT_ADMITTED`、晋升 `HOLD` 均不变。
