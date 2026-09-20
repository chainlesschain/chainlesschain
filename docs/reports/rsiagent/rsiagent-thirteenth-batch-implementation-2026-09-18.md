# RSIAgent 第十三次工程实施：Provider settlement 持久化端口与耐久回读

> 日期：2026-09-18（Asia/Shanghai）<br>
> 前置实施：[第十二次签名 Desktop deployment 组装与执行 capability 接线](./rsiagent-twelfth-batch-implementation-2026-09-18.md)<br>
> 后续实施：[第十四次本地签名 deployment 火山引擎真实烟测](./rsiagent-fourteenth-batch-implementation-2026-09-18.md)<br>
> 状态：真实 Volcengine provider 已有的 `persistSettlement` 回调现在可以接入仓库内置持久化适配器。适配器把脱敏 settlement 写入 `EvolutionArtifactPorts`，要求外部 durability authority 同步 retain 并立即按精确字节回读，再返回与 artifact digest 绑定的 durable ack。签名 Desktop deployment 可以组装该适配器，但当前机器仍没有 operator 签发的 deployment 或生产 durability authority，因此未自动启动真实 PM Explorer。

## 1. 本批闭合的缺口

此前 provider 已经要求：只要配置了 settlement persistence，真实请求就必须在返回调用结果前得到 `persisted:true`、`durable:true` 且 digest 一致的确认。但仓库尚无一个可供目标 deployment 直接使用的真实端口实现，测试主要依靠内联回调。

[PM provider settlement adapter](../../../packages/cli/src/lib/evolution/pm-exploration-provider-settlement-adapter.js) 现在提供该端口：

1. 严格复验 provider settlement，并把 deployment descriptor digest 与 settlement 一起组成规范记录；
2. 以 `pm-exploration-provider-settlement` 类型和 `ledger` retention 写入真实 `EvolutionArtifactPorts`；
3. 重新构造规范持久化字节，确认其 SHA-256 与 artifact port 返回的 digest 完全一致；
4. 调用 descriptor 指定的外部 durability authority 执行同步 `retain`；
5. 立即执行 `resolve`，要求 authority、tenant、purpose、type、ref、retention、digest 和精确字节全部一致；
6. 只有上述步骤全部成功后，才向 provider 返回与 settlement/artifact digest 绑定的 durable persistence ack。

验证入口会用同一规范记录重新物化 artifact，并从外部 authority 再次回读。因此，重启后使用新建的 artifact ports 和 adapter 仍可复验原 ack；重复持久化同一 settlement 保持幂等。不存在“外部 authority 仅声称成功但无法回读”时继续运行的降级路径。

## 2. 签名 deployment 绑定

[Evolution deployment loader](../../../packages/cli/src/lib/evolution/evolution-deployment-loader.js) 向已验签且允许 `desktop` 的 deployment 新增两个工厂：

- `createPmExplorationProviderSettlementAdapter`
- `capturePmExplorationProviderSettlementStore`

适配器 descriptor 的 `handlerArtifactDigest` 必须等于已经认证的 deployment module digest。用替换模块摘要创建适配器会在读取 artifact store 或调用外部 authority 之前失败关闭。deployment 仍需自行提供 tenant、audience、purpose、真实 artifact ports 和目标环境的 durability authority；loader 不会合成生产权威。

完成后的证据顺序为：

```text
Volcengine API response
  → budget runtime usage/cost settlement
  → canonical settlement artifact
  → external durability retain + exact-byte resolve
  → provider durable persistence ack
  → runner traceDigest + Ed25519 execution receipt
  → evidence bundle v2
  → PM Ledger retain / restart verification
```

API key、提示词和模型正文不进入 settlement artifact、durable ack、execution receipt 或证据包。

## 3. 自动化验证

新增和扩展的验证覆盖：

- provider 必须在 durable persistence 完成后才返回成功结果；
- 关闭并重建 artifact ports/adapter 后，原 settlement 与 ack 仍能回读复验；
- 同一 settlement 重放得到同一 record digest；
- `durable:false`、外部副本字节替换和伪造 persistence digest 均失败关闭；
- 未品牌化对象不能通过 settlement store 捕获；
- Desktop deployment loader 暴露新工厂，并拒绝替换后的 handler artifact digest；
- 既有 budget、round、receipt、provider、execution host、evidence、recovery、Ledger 和 deployment loader 回归继续通过。

本批验证结果：

| 检查                            | 结果                 |
| ------------------------------- | -------------------- |
| settlement adapter 定向测试     | 1 file，3 passed     |
| deployment loader 定向测试      | 1 file，57 passed    |
| CLI PM 全组 + deployment loader | 11 files，157 passed |
| artifact ports 基础回归         | 42 passed，1 skipped |
| ESLint                          | 0 errors             |
| Node syntax                     | passed               |

## 4. 保留边界

自动化测试中的外部 durability authority 是独立目录中的合成 replica，用于验证协议、精确字节回读、重开和故障关闭；它不是生产对象存储、WORM、共识副本或断电测试结果。`ArtifactStore` 本身仍只声明持久化和读回完整性，不声明父目录 fsync 或掉电安全。

本批没有重新发起 Volcengine live probe；此前本机 HTTP 200 探针只证明 endpoint、模型和 usage 字段可用，并未经过当前缺失的签名 deployment。当前也仍缺少：

- operator 签发的 Evolution deployment 与独立密钥托管；
- 生产 durability authority 及其故障/掉电演练；
- 一次性 workspace/database clone、真实 DID/RBAC PM 工具 broker；
- 独立业务 grader、holdout/Pilot 与等预算 baseline 对照；
- 四角色进程级隔离及完整的崩溃对账语义。

因此 Desktop readiness、renderer/IPC 写入口、自动 Explorer、自动晋级和 release 权限继续保持关闭。
