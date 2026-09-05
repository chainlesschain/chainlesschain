# Workbench 真实审核运行时接线

本说明覆盖工作台的投影保留、逐项人工审核与崩溃恢复，不是已经启用的生产部署。当前没有自动生成身份、部署签名、Ledger/witness 密钥或 Registry 回滚权限。缺少完整受信宿主时，CLI/IDE 仍应显示 unavailable。

## 部署入口

签名 deployment loader 在 `evolution` / `serve` 命令中提供 `factories.createEvolutionWorkbenchReviewRuntime(options)`。它要求 `options.descriptor.handlerArtifactDigest` 等于当前已认证部署模块摘要；不允许模块自报其他 handler 字节。公开 CLI 仍需同时配置绝对路径的 `CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_DESCRIPTOR` 与 `CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_TRUST_ROOT`。

运行时必须收到以下真实资源：

| 依赖                                                | 约束                                                                                                                                                                                                                           |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `descriptor`                                        | 固定 tenantId、artifactTenantId、runId、skillName、streamId、audience、`purpose: evolution-ledger`、authorityId、revision、handlerArtifactDigest；该 Workbench stream 限定一个 run/Skill，审核 producer 使用同一 review stream |
| `artifactPorts`、`ledger`、`ledgerArtifactResolver` | 实际 EvolutionArtifactPorts / EvolutionLedger 实例及 branded resolver，绑定同一持久存储、当前签名策略和独立 witness；不能提供只有成功布尔值的替身                                                                              |
| `decisionVerifier.verify`                           | 验证原 canonical Skill Review decision 签名及当前信任/撤销策略；必须返回严格 `true`                                                                                                                                            |
| `humanDecisionProvider.request`                     | 对每个精确 request 获取真人决策，不允许模型自批或整批宽授权                                                                                                                                                                    |
| `humanDecisionVerifier.verify`                      | 独立验证 Workbench 请求绑定外层签名及当前信任/撤销策略；必须返回严格 `true`                                                                                                                                                    |
| `registrySource`                                    | `createEvolutionWorkbenchRegistrySource()` 产生的 genuine source，绑定相同 Ledger 和完整 descriptor；内部读取实际 Registry 当前状态、完整事务历史及 workflow transition，不接受替换的 `transitionAdapter`                      |
| 可选 invocationReceiptSource / pilotSource          | 与原 Workbench source 相同的受治理来源；配置时仍需完整验证                                                                                                                                                                     |

生产工厂在内部构造实际 Run 和 Review Ledger reader，然后使用上述 Registry source 构造 v2 projection；不接受调用方替换的 Run/Review 汇总或空 transition 回调。它返回 `projectionLoader`、`projectionAuthority`、`projectionReader`、`batchExecutor`、`resume()`，供原 `createEvolutionWorkbenchCliHost` 复用。只读 `projectionReader` 绑定原 Ledger，可交给[真实回滚运行时](EVOLUTION_WORKBENCH_ROLLBACK_RUNTIME.md)构造 `activeStateReader` 和 `rollbackExecutor`。尚未发布任何版本的真实空 Registry 也可用于审核 pending candidate；空状态必须由两个真实 reader 证明。当前 active/LKG 的读取与不可改写的 Run 历史分开，见[Registry 状态接线](EVOLUTION_WORKBENCH_REGISTRY_RUNTIME.md)。宿主仍必须另行提供真实 `identityProvider`，完成恢复排序、相关域来源接线和部署验收；审核工厂不会单独让 IDE 声明所有工作台方法可用。

## 人工决策合同

原 `chainlesschain.skill-promotion-review-decision/v1` 字段和签名保持不变，禁止往其中添加或删除 `requestDigest` 等工作台字段。人工服务现在返回单独签名的外层：

```js
const response = {
  schema: "chainlesschain.evolution-workbench-human-decision/v1",
  tenantId,
  requestDigest,
  decision, // 完整、未修改、带原签名的 canonical Review decision
  responseDigest,
  signature, // Workbench 外层签名，不复用 decision.signature
};
```

`responseDigest` 使用 `digestWorkbenchHumanDecisionResponse(core)`，其中 core 是 schema、tenantId、requestDigest 和完整 decision（包含原签名）。外层 verifier 必须按部署自己的 PKI 协议验证该摘要；仅比较摘要或检查签名字符串长度不构成认证。内部决策还必须与 request 的 decision/reason 精确一致，reviewerIds 必须包含发起人，且满足原 quorum、content-risk 确认和时效规则。

旧的“给 decision 增加 requestDigest”格式失败关闭，不尝试删字段再验签。批处理成功回执升级为 `chainlesschain.evolution-workbench-batch-execution/v2`，每项增加 `humanResponseDigest` 并采用 v2 item digest。JetBrains 新代码同时识别旧 CLI 的 v1 和新 v2 终态回执；这种显示兼容不把旧回执转换成新审核授权。旧已安装插件仍需后续发布更新，不提前改写 CLI 推荐版本。

## 持久化与恢复

完整宿主可使用[启动组装工厂](EVOLUTION_WORKBENCH_STARTUP.md)。启动只调用 `reconcileCommitted()` 补记已有真实效果；下面的 `resume()` 是显式继续执行，不应在每次打开工作台时自动调用。未执行的过期 preparation 可审计并报告 deferred，但不会重新获得执行权限。

持久化顺序是：认证源投影并保留 → 逐项保留外层人工决策 → 写实际 Review decision → 独立回读实际效果 → 写 execution settlement → 再次回读确认。

三个新增制品类型 `evolution-workbench-projection`、`evolution-workbench-review-preparation`、`evolution-workbench-review-settlement` 只允许 `evolution-ledger` 的 ledger retention。事件通过确定性 ID、Ledger head/sequence CAS 和精确 sourceRefs 连接投影、Review packet、preparation 与真正落账的 Review decision。伪造 settlement、不同 tenant/run/Skill、错绑来源、重新散列的伪投影、并发替换人工响应或只返回成功确认都不能完成审核。

`resume()` 从实际 Ledger 发现原计划，不依赖上一进程的内存或调用者重传授权：

- 已保留但未执行的审批仍须在当前时刻有效；过期则拒绝，没有后台补批。
- 已真实落账但缺 settlement 的决策可在过期后补记执行结果，但两层签名均按当前信任策略重新验证；这不是重新授予过期审批权限。
- 已完整结算的项不再请求真人、不重复写 decision。
- 多项计划即使在第一项结算后退出，也会继续发现未准备的其他项；这些项仍逐项获取新的人工决策，不共享第一项授权。

恢复扫描有显式容量边界，超过 10,000 条本 stream 工作台事件时失败关闭，不能静默截断历史。此批没有实现无限历史归档。

## 验证边界

相关用例位于 CLI 的 `evolution-workbench-batch-executor.test.js`、`evolution-workbench-review-ledger-adapter.test.js` 和 `evolution-workbench-review-cross-process.test.js`。后者在 preparation、实际 decision、首项 settlement 三个边界执行真实 SIGKILL，由新进程重开原 ArtifactStore/Ledger/witness，验证没有重复决策，并可继续多项计划。

测试使用明确位于 `__tests__` 的 Ed25519 人工服务测试密钥及既有 Ledger/witness 测试 authority。Review packet 的 Eval 数据是夹具，不证明真实模型评测或真人验收。Windows 目录 fsync 兼容夹具也不证明物理断电恢复。本地回归不替代发布提交的 GitHub 三平台门禁，更不等于用户 IDE 当前环境已连通。
