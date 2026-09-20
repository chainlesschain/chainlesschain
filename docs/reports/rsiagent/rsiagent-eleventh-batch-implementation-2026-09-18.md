# RSIAgent 第十一次工程实施：真实 Provider 结算进入签名证据与 Ledger

> 日期：2026-09-18（Asia/Shanghai）<br>
> 前置实施：[第十次本机火山引擎真实调用与用量结算](./rsiagent-tenth-batch-implementation-2026-09-18.md)<br>
> 状态：成功的受治理 Volcengine PM 调用可把真实 usage/费用结算绑定至 execution receipt，并随 provider-aware evidence bundle v2 由 PM Ledger retain、重启回读和复验。真实 Desktop Explorer 仍未配置或开放。

## 1. 本批收口

[PM Volcengine provider adapter](../../../packages/cli/src/lib/evolution/pm-exploration-volcengine-provider.js)现在在结算记录中绑定所属 `executionRequestDigest`。结算记录包含 provider、model、operation、请求和响应摘要、输入/输出/缓存 token、使用费率和估算费用；不包含 API key、提示词或模型正文。

[PM execution host](../../../packages/cli/src/lib/evolution/pm-exploration-execution-host.js)允许可信 runner 返回可选的 `providerSettlement`。若返回：

1. settlement 和可选 durable persistence 确认先被严格复验；
2. settlement digest 必须与 runner 的 `traceDigest` 完全相同；
3. execution signer 因此把该 digest 写入签名 receipt；
4. host 的结果只携带已验证的 settlement record，调用方不能以另一个 digest 替换。

[PM evidence bundle](../../../packages/cli/src/lib/evolution/pm-exploration-evidence-bundle.js)保持 v1 读取兼容，并新增 v2：

- v1：历史 synthetic/非 provider 轨迹，结构不变；
- v2：`providerSettlements` 必须与每个 execution receipt 一一对应；每个 settlement 的 request digest 和 settlement digest 分别必须匹配 execution receipt 的 request/trace digest；缺失、重复、额外或篡改记录均拒绝；
- bundle digest 采用对应 schema 域分离重算；PM Ledger adapter 按既有完整 evidence bundle 复验路径 retain v2，不需要放宽认证条件。

因此，成功的真实 provider 调用现在具备如下链路：

```text
Volcengine API usage
  → budget capability token 计量 + 费用结算摘要
  → runner traceDigest
  → Ed25519 execution receipt
  → evidence bundle v2
  → v2 PM Ledger artifact / durability authority / 重启复验
```

## 2. 自动化验证

新增覆盖：

- provider settlement 的 execution-request、response、usage、费用和摘要复验；
- runner 不能把 settlement 与不同 trace digest 组合；
- provider evidence bundle v2 对每个 checkpoint 强制一一绑定；
- settlement usage 篡改被拒绝；
- v1 evidence bundle 继续通过已有回归；
- 含真实-provider-shaped settlement 的 v2 bundle 通过 PM Ledger commit，重开后保留并回读相同 bundle。

本批定向验证：

| 检查                                                | 结果                                                |
| --------------------------------------------------- | --------------------------------------------------- |
| provider / execution host / Ledger adapter 定向测试 | 25 passed                                           |
| 完整 PM 定向回归（不含多进程演练）                  | 126 passed                                          |
| 本机 Volcengine live probe                          | HTTP 200，109 tokens，估算 `$0.00001834`            |
| 多进程恢复故障演练                                  | 2 passed，31 processes（synthetic authority/fault） |

Ledger round-trip 测试使用受控的 provider-shaped API 响应，以确定性覆盖签名、摘要和重开语义；本机 live probe 单独验证实际 Volcengine endpoint 的 usage 字段。两者不能合并表述为已在生产签名 deployment 中完成真实 PM 任务。

## 3. 仍然未宣称的能力

这不是对供应商账单的外部审计，也不解决真实调用已发生但宿主在结算持久化前崩溃的全部故障语义；该类场景仍需生产 payment/usage authority 的幂等查询和对账。

本机也没有签名 Evolution deployment、生产独立 signer、一次性 Desktop workspace/database clone、真实 DID/RBAC PM 工具路径或 holdout/Pilot。因此本批不开放 Explorer、Desktop IPC 写端口或自动晋级。只有目标部署把经过审查的 settlement persistence port、真实身份与业务工具接入后，才可进行合法/越权任务和等预算效果验收。
