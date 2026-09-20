# RSIAgent 第二十二次工程实施：认证迁移链头回读与重启状态重建

> 日期：2026-09-18（Asia/Shanghai）<br>
> 前置实施：[第二十一次状态迁移耐久提交能力](./rsiagent-twenty-first-batch-implementation-2026-09-18.md)<br>
> 后续实施：[第二十三次 SQLite 恢复快照耐久保留与迁移绑定](./rsiagent-twenty-third-batch-implementation-2026-09-18.md)<br>
> 状态：签名 Desktop deployment 现在可通过同一品牌化 transition committer 提供用途单一的恢复读口。恢复端口按 execution manifest 回读并验证最后一条耐久迁移；Desktop 在 execution host 建立前重建成功链，或从失败链头重建 taint。该能力不暴露通用 Ledger 读写权威，也不声称已经具备数据库或 workspace 文件恢复介质。

## 1. 认证链头恢复协议

[PM transition committer](../../../packages/cli/src/lib/evolution/pm-exploration-transition-committer.js) 新增可选的 `recover` 部署端口。品牌化 capture 端口不会把任意查询能力交给 Desktop，而是固定发送：

```text
chainlesschain.pm-exploration-transition-recovery-request/v1
  + manifestDigest
```

部署回读必须返回精确的 `chainlesschain.pm-exploration-transition-recovery/v1` 记录，并同时满足：

- `authenticated:true`、`durable:true`、`readbackVerified:true`；
- manifest 摘要与当前 committer 完全相等；
- `revision` 为非负安全整数，Ledger 链头摘要为有效 SHA-256 摘要；
- 空链头只能使用 revision 0，迁移类型、证据、事件和耐久回执摘要全部为 `null`；
- 非空链头 revision 至少为 1，迁移类型只能是 `success` 或 `failure`；
- 成功/失败证据会沿用第二十一批的完整校验重新计算 seal、数据库变化判断、状态迁移摘要或失败证据摘要；
- 恢复记录中的证据摘要和迁移类型必须与重新验证后的证据完全一致；
- Ledger event 与 durability receipt 摘要必须存在且格式有效；
- `qualifiesForPromotion:false`。

恢复请求、部署输入和恢复结果都会拒绝 Proxy、accessor、错误原型、多余字段与缺失字段。`recover` 仍位于已验签 deployment 的可信边界内；本批验证它返回的绑定记录，不凭空创建 Ledger、签名密钥或外部 durability authority。

## 2. Desktop 重启状态重建

[Desktop execution wrapper](../../../desktop-app-vue/src/main/evolution/desktop-evolution-deployment.js) 在创建 PM execution host 前捕获并调用私有 `recoverTransition`。恢复失败、结果结构无效或 manifest 不匹配时，依赖装载直接失败关闭；恢复函数和原始 Ledger 记录不会出现在 Desktop 依赖结果中。

三种合法状态分别处理为：

```text
空链头
  → 保留签名 manifest 的初始 pre-run seal
  → previousStateTransitionDigest = null

成功链头
  → nextPreRunSealDigest = recovered postRunSeal.sealDigest
  → previousStateTransitionDigest = recovered stateTransitionDigest
  → 下一轮仍在 Actor 前重新捕获真实 SQLite seal 并精确比较

失败链头
  → tainted = true
  → 保留失败证据中的前序成功迁移摘要
  → 后续 round 在 seal 捕获、Actor、grader 和工具调用前拒绝
```

这也给第二十一批“成功提交结果不明”的情况提供了重启裁决路径：若 Ledger 已提交成功，成功链头与当前 post-run seal 可继续组成链；若 Ledger 没有该事件，而数据库已经发生变化，下一轮的实际 SQLite seal 无法匹配恢复后的期望链头，会在 Actor 前失败关闭。恢复读口不绕过 seal 门禁。

只读 inspector 新增 `transitionRecoveryConfigured`、`transitionRecoveryStatus` 和 `transitionRecoveryRevision`。它只投影配置与裁决状态，不泄露证据、seal、Ledger event、提交/恢复函数或存储 authority。

## 3. Readiness 门槛

[Desktop PM readiness](../../../desktop-app-vue/src/main/evolution/desktop-pm-exploration-readiness.js) 新增独立的 `signed-transition-recovery` 检查。仅有耐久提交器但没有认证恢复读口时，配置仍为 blocked；恢复到失败链头时，已有 `execution-host-untainted` 检查同样保持 blocked。

通过空链头或成功链头回读只证明恢复能力已配置且本次链头记录满足协议，不会把 readiness 提升为执行授权：

- `readyForExecution:false`；
- `runtimeVerified:false`；
- `authenticated:false`；
- `qualifiesForPromotion:false`。

真实 provider 探针、当轮数据库 seal、耐久迁移确认、失败证据、独立 grader、预算执行与重启无残留演练仍必须在目标运行时分别取得。

## 4. 回归证据

新增和更新的回归覆盖：

- 空、成功和失败三类认证耐久链头回读；
- 固定恢复请求与 manifest 的精确绑定；
- 成功/失败嵌套证据的完整复算和摘要绑定；
- 替换证据摘要、错误 manifest、accessor 恢复输入和错误字段失败关闭；
- Desktop 在装载阶段只调用一次私有恢复端口；
- 成功恢复后，下一轮从 recovered post-run seal 和前序迁移摘要继续；
- 失败恢复后，重启 host 在任何 seal 捕获或 Actor 调用前保持 tainted；
- readiness 对缺少恢复读口的 committer 保持 blocked；
- 原有无恢复端口兼容路径仍可装载，但不会通过新的 readiness 门槛。

验证结果：

| 检查                                             | 结果                 |
| ------------------------------------------------ | -------------------- |
| Desktop seal + reader + deployment + readiness   | 4 files，61 passed   |
| CLI PM、deployment loader 与签名 test deployment | 15 files，179 passed |
| Node 语法、ESLint、Prettier、diff whitespace     | passed               |

本批没有调用火山引擎或产生新的模型费用；恢复协议和 Desktop 接线不需要再次消费模型。

## 5. 保留边界

- 当前仓库仍只以合成恢复 provider 验证协议；本机没有 operator 签发的生产 transition committer/recovery provider，也没有真实外部 durability authority 的断电回读证据；
- 当前 SQLite seal 来自临时 `DatabaseManager.backup()` 的摘要，临时备份在哈希后删除；Ledger 只保存迁移证据，不保存可用于恢复的数据库文件字节；
- 当前 PM manifest 没有绑定 workspace snapshot，现有 PM Ledger adapter 保存的是 journal snapshot，不是数据库或 workspace 的原子恢复介质；
- 成功链头可以安全重建继续执行所需的摘要链，但无法修复已经偏离该链的数据库；seal 不匹配只会阻断，不会回滚；
- 失败链头会可靠重建 taint，但本批没有提供解除 taint 的操作；在没有可验证恢复介质时自动解除是不安全的；
- JavaScript 提交前的进程崩溃、断电或 native fatal error 仍可能没有 failure event；
- 尚未运行真实 Electron 身份、RBAC、工具 broker、数据库、恢复 authority 和本地火山引擎组成的 PM E2E。

下一步应先为一次性隔离 clone 持久保存与 manifest/迁移事件绑定的 SQLite 和 workspace snapshot 字节，并验证 retain 后精确回读。只有恢复控制器拥有该 clone 的独占数据库连接生命周期时，才能关闭连接、原子替换文件、重开复核 seal，并用新的认证恢复事件解除 taint；没有这些前提时，不应替换应用主库。
