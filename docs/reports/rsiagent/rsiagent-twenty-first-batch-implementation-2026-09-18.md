# RSIAgent 第二十一次工程实施：状态迁移耐久提交能力

> 日期：2026-09-18（Asia/Shanghai）<br>
> 前置实施：[第二十次异常状态 seal 与执行 host 污染门禁](./rsiagent-twentieth-batch-implementation-2026-09-18.md)<br>
> 后续实施：[第二十二次认证迁移链头回读与重启状态重建](./rsiagent-twenty-second-batch-implementation-2026-09-18.md)<br>
> 状态：签名 Desktop deployment 现在可交付用途单一、品牌化的 PM 状态迁移提交器。Desktop 只把固定的成功或失败迁移证据交给该能力，不取得通用 Ledger、artifact store、`commitJournal` 或 durability authority。提交器重新校验证据并要求返回与 manifest、证据摘要和迁移类型精确绑定的认证、耐久、回读确认。

## 1. 固定证据协议与窄化能力

[PM transition committer](../../../packages/cli/src/lib/evolution/pm-exploration-transition-committer.js) 接受两种且仅两种证据：

- `chainlesschain.desktop-pm-state-transition-success/v1`：绑定 execution manifest、execution/grader receipt、pre/post SQLite seal、数据库变化判断、前序迁移摘要和本次 `stateTransitionDigest`；
- `chainlesschain.desktop-pm-failed-execution-evidence/v1`：绑定 execution manifest、pre/failure SQLite seal、数据库身份/内容变化、前序迁移摘要、固定失败分类和 `evidenceDigest`。

提交前会拒绝 Proxy、accessor、多余字段、错误原型、错误摘要格式和替换后的 manifest；两类 SQLite seal 都重新计算独立 `sealDigest`。成功迁移重新计算状态迁移摘要，失败迁移重新计算失败证据摘要。部署只能通过 `createPmExplorationTransitionCommitter()` 创建品牌化对象，Desktop 再从同一受信 CLI 模块的私有 capture 端口取得 `commitTransition`；普通对象不能伪装该能力。

提交回执使用 `chainlesschain.pm-exploration-transition-durability-ack/v1`，必须同时满足：

- `authenticated:true`、`durable:true`、`readbackVerified:true`；
- manifest 摘要与当前 execution host 一致；
- evidence 摘要与成功迁移摘要或失败证据摘要一致；
- `transitionKind` 与实际证据类型一致；
- Ledger event 与 durability receipt 摘要格式有效；
- `qualifiesForPromotion:false`。

证据自身继续保留 `authenticated:false / durable:false`，耐久属性只由单独确认表达，避免把待提交的内存对象伪装成已留存记录。该确认也不授予 promotion。

## 2. Desktop 成功与失败路径

[Desktop execution wrapper](../../../desktop-app-vue/src/main/evolution/desktop-evolution-deployment.js) 只在签名 deployment 同时返回 execution host 与 transition committer 时接线，并强制两者的 `manifestDigest` 相等。提交器被封装在主进程 execution host 内部，不作为独立 Desktop dependency 返回。

成功结果升级为 `chainlesschain.desktop-pm-sealed-execution-result/v3`：

```text
pre seal → Actor/grader → post seal → 构造并复算成功迁移证据
  → 私有 commitTransition → 认证/耐久/回读确认
  → 推进 nextPreRunSealDigest 与 previousStateTransitionDigest
  → 返回 transitionEvidence + transitionDurability
```

若未配置提交器，兼容路径仍返回证据，但 `transitionDurability:null`；readiness 会因此保持 blocked。配置提交器后，成功迁移只有取得有效确认才推进进程内迁移链。

失败路径会先永久 taint 当前 host，再生成 failure-state seal 与失败证据并尝试耐久提交。若失败证据提交本身失败，原始 Actor/grader/证据错误仍保留在 `cause`，同时明确返回 `transitionDurabilityFailed:true` 和 `transitionCommitOutcomeUnknown:true`。

如果成功迁移的提交调用失败，底层写入可能已经发生而确认丢失。此时 Desktop 会捕获 failure-state seal 并 taint host，但不会再向同一提交器追加可能与已提交成功事件矛盾的失败事件；提交结果被标记为 unknown，等待后续受认证恢复按 Ledger 回读裁决。

## 3. Readiness 边界

只读 execution host inspector 新增 `transitionDurabilityConfigured`，不暴露提交函数、Ledger、authority、内部迁移摘要或签名材料。Desktop readiness 新增 `signed-transition-committer` 配置检查，并继续保持：

- `readyForExecution:false`；
- `runtimeVerified:false`；
- `authenticated:false`；
- `qualifiesForPromotion:false`。

即使配置检查通过，`authenticated-transition-durability-ack` 和 `authenticated-failure-transition-evidence` 仍列为缺失的运行时证据；只加载能力不能证明已经发生过真实耐久写入。

## 4. 回归证据

新增和更新的回归覆盖：

- 成功与失败迁移证据的完整复算；
- seal、manifest、数据库变化、前序摘要和迁移类型篡改失败关闭；
- accessor/Proxy 与额外字段不会进入 deployment writer；
- 未认证、未耐久或未回读的确认被拒绝；
- Desktop 只保留私有提交端口，不向依赖结果暴露 committer；
- execution host 与 committer manifest 不一致、孤立 committer 和 accessor 属性被拒绝；
- 成功确认在进程内状态推进前完成；
- 失败证据取得耐久确认后仍保持 host tainted；
- 成功提交结果不明时不追加第二条失败事件；
- readiness 对缺少提交器的 execution host 保持 blocked。

验证结果：

| 检查                                             | 结果                 |
| ------------------------------------------------ | -------------------- |
| Desktop seal + reader + deployment + readiness   | 4 files，57 passed   |
| CLI PM、deployment loader 与签名 test deployment | 15 files，177 passed |
| Node 语法、ESLint、Prettier、diff whitespace     | passed               |

本批没有调用火山引擎或产生新的模型费用。

## 5. 保留边界

- 当前仓库测试使用合成 commit writer；本机没有 operator 签发的生产 transition committer，也没有以真实外部 durability authority 验证断电留存；
- `authenticated/durable/readbackVerified` 确认的可信边界仍是已验签 deployment 内实现的 writer；本批校验绑定关系，不凭空创建外部存储或密钥权威；
- 写入已发生但确认丢失时只标记 unknown，尚未实现重启后按 Ledger 回读并恢复 host 状态；
- JavaScript 提交调用前的进程崩溃、断电和 native fatal error 仍可能没有 failure event；
- SQLite seal 仍不覆盖 workspace 文件、外部服务、操作系统资源或未提交应用内存；
- 现有逐表 restore 仍不满足原子替换要求，不能用来清除 taint；
- 尚未运行真实 Electron 身份、RBAC、工具 broker、数据库和本地火山引擎组成的 PM E2E。

下一步应为一次性隔离 clone 建立拥有独占数据库连接生命周期的恢复控制器：从受认证 Ledger 裁决最后一条成功、失败或 unknown 迁移，关闭全部连接后原子替换数据库与 workspace snapshot，重开并复核 seal，再以新的受认证恢复事件解除 taint。没有独占 clone 所有权和真实 operator deployment 时，不应自动替换应用主库。
