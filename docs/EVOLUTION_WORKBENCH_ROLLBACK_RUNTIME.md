# Workbench 真实回滚运行时接线

此运行时把已有工作台回滚计划接入实际 `SkillPromotionController` / `SkillReleaseRegistry`，不是生产身份或完整部署宿主。缺少受信部署时，CLI/IDE 继续显示 unavailable。普通计划允许选择已批准历史版本，但真实控制器只允许当前 LKG；该约束在请求人工授权前检查，不放宽底层回滚策略。

## 依赖与部署入口

签名 deployment loader 仅为 `evolution` / `serve` 提供 `createEvolutionWorkbenchRollbackRuntime(options)`，并强制 descriptor 的 handlerArtifactDigest 等于当前已认证部署模块字节摘要。工厂返回 `rollbackExecutor`、`activeStateReader`、`resume()`，可交给原 `createEvolutionWorkbenchCliHost`。

| 依赖                                                           | 约束                                                                                                                                    |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| descriptor / artifactPorts / ledger / ledgerArtifactResolver   | 实际 ArtifactPorts、Ledger 和 branded resolver；descriptor 必须与审核运行时完全相同，限定同一 tenant/run/Skill/stream                   |
| projectionReader                                               | 审核运行时产生的只读 capability，绑定同一 Ledger；重新读取保留投影、原 Review packet、目标批准决定及其真实序号/制品引用                 |
| releaseRegistry / transactionLedger                            | 实际 Registry 及与其绑定的 branded transaction Ledger；writer 必须使用上述同一个 Ledger                                                 |
| verifierReleaseRegistry / verifierTransactionLedger            | 独立重新打开的实际实例，与 writer 使用同一身份、epoch、当前完整账本及持久文件；拒绝复用 writer 对象或伪造 reader                        |
| rollbackProvider                                               | 实际控制器为该 writer Registry 产生的 branded rollback capability，不接受任意回调                                                       |
| authorizationProvider.authorizeRollback                        | 部署的 mutation authority，返回精确 `{ request, capability }`；request 必须绑定目标、预期修订、transition subject 和下述 policy receipt |
| humanRollbackProvider.authorize / humanRollbackVerifier.verify | 真人授权及独立的当前 PKI/撤销验证；固定 own 方法，verifier 必须返回严格 true                                                            |

两个 reader 独立重新读取真实发布字节、依赖锁与实际事务证明，不能用相同 JSON 对象模拟“独立验证”。同一机器上两个实例并不等于独立主机故障域。

## 人工授权与 mutation 绑定

人工服务接收 `{ plan }`，返回以下精确字段，不能添加“authenticated”等自报成功字段：

```js
const authorization = {
  schema: "chainlesschain.evolution-workbench-rollback-authorization/v1",
  tenantId,
  skillName,
  planDigest,
  requestedBy,
  reason,
  automated: false,
  issuedAt,
  expiresAt,
  receiptDigest,
  signature,
};
```

有效期最多十分钟。`receiptDigest` 是 `digestWorkbenchRollbackAuthorization(core)`，core 包含除 receiptDigest/signature 外的所有字段；部署 verifier 按自己的 PKI 协议验证签名和当前身份/权限/撤销状态。摘要相等、签名长度或测试私钥均不构成生产身份。每次实际回滚前重新检查时效，包括异步验签后；目标 Review 决定也必须有效。

授权先保存为不可变 preparation，再申请 mutation capability。authority 收到精确 basis、planDigest、authorizationReceiptDigest、最晚 expiresAt 和 canonical JSON 字符串 policyReceipt，必须将 policyReceipt 原样放进 `mutationRequest.receipts.policyReceipt`。最晚 expiresAt 取人工回滚授权与目标 Review 批准的较早到期时间；mutation request 不能超出此期限，让控制器在实际消费权限时也执行相同期限。该字符串包含 schema `chainlesschain.evolution-workbench-rollback-policy/v1`、tenantId、planDigest、authorizationReceiptDigest 以及实际 preparationRef。不能替换成任意“策略已批准”文本。

实际 Registry intent 保留这个 request，因而完整 human authorization 制品与真实副作用不可分离。重试使用同一 operationId；如旧 capability 已消耗但 Registry 尚未准备，部署 authority 只能在原人工授权仍有效时重新签发有新 nonce 的 capability。

## 持久化与恢复

顺序为：重新认证已保留投影/Review/active/LKG → 验证真人授权 → preparation 落账 → mutation authority → 实际控制器 prepare/CAS/finalize → 两个 Registry reader 核验内容、依赖锁及实际事务 → settlement 落账并回读。

新增制品类型 `evolution-workbench-rollback-preparation` 和 `evolution-workbench-rollback-settlement` 只允许 evolution-ledger 的 ledger retention。preparation 的四个 sourceRefs 精确指向投影、源 packet、目标 packet、目标批准；settlement 的两个 sourceRefs 指向 preparation 和实际 Registry finalization。计划、授权、request、basis、事务、内容或引用不匹配都拒绝。

`resume()` 从真实账本发现计划：

- 尚未产生实际效果的授权必须当前有效，不会后台补批。
- Registry 有未完成事务时应先重新打开 Registry，执行其自身恢复；工作台不另起一笔相同回滚。
- 已实际完成但缺结算记录时，按真实 mutation consumption receipt 的时间验证原授权有效性，并按当前 PKI 重新验签，之后只补记结果。
- 即使已有后续合法晋升，恢复也只补记旧事务，不重做回滚或覆盖新 active；恢复返回的是该历史事务的回执，不声明它仍是当前版本。
- 完整结算后重复恢复不再请求真人或 mutation capability。普通显式执行仍要求该回滚效果是当前 active，不能把后来晋升的版本倒退回历史执行结果。

回执继续使用原 `chainlesschain.evolution-workbench-rollback-receipt/v1`，本次不改 IDE wire schema 或推荐 CLI 版本。扫描上限为本 stream 的 10,000 条回滚事件，超限失败关闭，不静默丢历史。

## 尚未关闭的启动条件

真实回滚效果不等于整个工作台已经可用。当前[Registry source](EVOLUTION_WORKBENCH_REGISTRY_RUNTIME.md)已将真实事务历史和当前 active/LKG 接入 Workbench v2 投影；完成的 EvolutionRun 仍保持历史原样，不追加伪事件来改写它。宿主应先让实际 Registry 完成自身 journal 恢复，再恢复工作台 settlement，之后开放工作台读取。目标宿主仍须组装真实身份与密钥、签名 descriptor、authority 和独立 witness，以及 Wiki/Pilot/实际调用等相关域来源。完成 CLI → App Server → IDE 的目标环境验收前，不声明截图中的工作台已启用。

## 验证边界

单元用例覆盖真实发布内容/依赖锁回读、过期/自动化/错误 policy/撤销/状态漂移拒绝，以及后续合法晋升后的历史补记。跨进程用例在 preparation、authority 已消费但仅获取 Registry lease、Registry 指针写入、实际回滚已完成及 settlement 五个窗口执行 SIGKILL，由新进程重新打开原文件恢复。具体执行结果记录在总任务文档；测试文件存在本身不等于验收通过。

测试使用 `__tests__` 中的 Ed25519 人工测试密钥、测试 mutation authority 及 Ledger/witness 测试签名。回滚夹具的投影现在读取实际 Registry source，不再手写两个晋升的 transition 摘要；另有 canonical workflow 读取夹具绑定实际已完成事务，用于正向与伪造事务拒绝测试，它不是生产 Eval→promotion producer。没有证明真实用户审批、目标模型评测、跨主机故障域或物理断电恢复；本地测试也不替代 exact release commit 的 GitHub 三平台发布门禁。
