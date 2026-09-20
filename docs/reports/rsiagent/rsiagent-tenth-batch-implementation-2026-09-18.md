# RSIAgent 第十次工程实施：本机火山引擎真实调用与用量结算

> 日期：2026-09-18（Asia/Shanghai）<br>
> 前置实施：[第九次预算执行与签名轮次证据](./rsiagent-ninth-batch-implementation-2026-09-18.md)<br>
> 状态：已复用本机 ChainlessChain 的火山引擎配置完成真实联网连通和 usage 探针，并新增只能在受治理 Evolution ingress 与 PM 宿主预算 capability 下调用的 Volcengine provider adapter。后续 [第十一次实施](./rsiagent-eleventh-batch-implementation-2026-09-18.md)已将成功调用的 settlement 绑定至 execution receipt、evidence bundle v2 和 PM Ledger。当前机器没有签名 Evolution deployment，因此没有把连通探针表述为真实受治理 PM 任务或生产试点通过。

本批依据操作者明确许可使用本机火山引擎。凭据只从现有本地配置、API key helper 或 `VOLCENGINE_API_KEY` 解析，没有写入源码、测试、日志或证据文档。

## 1. 实施结果

新增 [PM Volcengine provider adapter](../../../packages/cli/src/lib/evolution/pm-exploration-volcengine-provider.js)：

- 固定使用仓库内置的火山方舟 HTTPS endpoint，不接受带凭据、查询参数或任意代理地址；
- 默认复用 `config.llm` 中的本机 `volcengine` 模型、endpoint、凭据和价格覆盖，也允许可信 composition 显式注入；
- 构造时必须提供品牌化 `AgentEvolutionIngress`，不能从 PM 路径退回无治理的普通 chat；
- 每次调用必须持有 PM budget executor 签发的 runtime capability，模型返回前先把 API 响应中的真实 token usage 记入 token budget；
- 输出、缓存和输入 token 分项结算；缺失/畸形/零 usage、超预算或未定价模型全部失败关闭；
- 使用现有 `llm-pricing` 价格表生成 USD 估算，结算记录绑定 provider、model、operation、请求摘要、响应摘要、usage 和费率；不保存提示词、响应正文或凭据；
- 可选 `persistSettlement` 端口必须返回与结算摘要一致的 `persisted:true`、`durable:true` 确认，否则本次 provider 操作失败；
- 对外只暴露品牌化空对象与脱敏 descriptor，凭据保留在闭包中。

这条 adapter 可直接由第九批 `createPmExplorationRunner`、grader、merger 或 evaluator 的可信 handler 调用。adapter 返回的 `settlementDigest` 可作为 handler 的 trace/evidence 引用；具体业务 Memory 写入、只读 grader 和签名 receipt 仍由 PM execution host 的既有合同负责，模型响应不能自行声明任务成功。

## 2. 可重复真实探针

新增 [脱敏 live probe](../../../packages/cli/scripts/pm-exploration-volcengine-live-probe.mjs)与 npm 命令：

```powershell
cd packages\cli
npm run test:pm-exploration-volcengine-live
```

脚本必须显式带内部 `--confirm-live` 才发起付费网络调用；只输出 provider、model、HTTP 状态、延迟、token 分项、价格匹配和估算费用，不输出 API key 或响应正文。直接执行脚本而不确认会拒绝调用。

本机实测结果：

| 检查                     | 结果                                                                              |
| ------------------------ | --------------------------------------------------------------------------------- |
| `cc llm test`            | `volcengine / deepseek-v4-flash-ga-260731`，HTTP 调用成功，1557 ms，回复存在      |
| 首次脱敏 usage 探针      | HTTP 200，1533 ms，87 input + 12 output = 99 tokens，价格匹配，估算 `$0.00001554` |
| 仓库 live probe 命令复验 | HTTP 200，1617 ms，87 input + 9 output = 96 tokens，价格匹配，估算 `$0.00001470`  |
| 凭据/响应正文输出        | 均为 `false`                                                                      |

费用是当前仓库价格表对 API usage 的估算，不是火山引擎账单或发票。两次输出 token 数不同属于真实模型调用差异，结算使用每次 API 实际返回值，不以本地字符估算替代。

## 3. 自动化验证

新增 [provider adapter 单元测试](../../../packages/cli/__tests__/unit/pm-exploration-volcengine-provider.test.js)，覆盖：

- OpenAI-compatible usage 的输入、输出、缓存分项归一化；
- provider usage 先进入 PM token budget，再返回结算结果；
- Volcengine/DeepSeek V4 Flash 价格匹配与费用计算；
- durable settlement 回执、摘要绑定和凭据/正文不泄露；
- provider 缺失 usage、token 超限、非 durable 确认、任意 endpoint、无 ingress 和未定价模型拒绝。

本批阶段性验证：

| 检查                                                | 结果                              |
| --------------------------------------------------- | --------------------------------- |
| provider adapter + budget + execution host 定向测试 | 15 passed                         |
| 完整 PM 定向回归（不含多进程演练）                  | 124 passed                        |
| 本机 Volcengine live probe                          | passed，HTTP 200，真实 usage 可用 |

相关 ESLint 为 0 error，Prettier、Node syntax 和 `git diff --check` 均通过；ESLint 仅输出仓库既有的根 `package.json` module type 配置警告。

## 4. 仍然保留的边界

本机部署探测结果为：`deploymentConfigured:false`、`compositionFactory:false`。因此本批明确不声称：

- 已通过签名 Evolution deployment 运行真实 PM Explorer；
- 已完成真实 DID/RBAC、一次性 workspace/database clone 或结构化 PM 工具副作用验证；
- 价格估算已与供应商账单逐项核销；
- provider settlement 可以替代供应商账单对账或崩溃前的使用量追回；
- 四个 signer 已进程隔离，或 Desktop runner 已获得生产运行令牌；
- baseline/Explorer holdout、Pilot、回滚或三系统 release SHA 已通过。

下一步需要目标环境提供签名 Evolution deployment 和受审查的 settlement 持久化端口，再通过本 adapter 执行合法/越权结构化 PM 任务，并把结算摘要纳入完整 evidence bundle。上述条件完成前，Desktop readiness 与自动晋级继续保持关闭。
