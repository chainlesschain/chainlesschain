# RSIAgent 第二十三次工程实施：SQLite 恢复快照耐久保留与迁移绑定

> 日期：2026-09-18（Asia/Shanghai）<br>
> 前置实施：[第二十二次认证迁移链头回读与重启状态重建](./rsiagent-twenty-second-batch-implementation-2026-09-18.md)<br>
> 状态：签名 Desktop deployment 现在可提供品牌化、用途单一的 PM recovery snapshot store。Desktop 从同一次 SQLite backup 同时取得 seal 与真实快照字节，先经外部 durability authority 保留并精确回读，再把 snapshot ack 绑定进 transition durability ack。该接线建立了数据库恢复介质，但尚不自动替换运行中的应用主库。

## 1. 同源 SQLite seal 与恢复字节

[Desktop PM pre-run seal](../desktop-app-vue/src/main/evolution/desktop-pm-pre-run-seal.js) 新增恢复快照捕获端口。它仍通过 `DatabaseManager.backup()` 生成一致的临时 SQLite 文件，但在同一次文件读取中同时完成：

- 固定域 SHA-256 snapshot digest；
- 实际 snapshot 字节数；
- 可交给窄化耐久端口的原始 SQLite backup 字节；
- backup 前后数据库 manager 与绝对路径身份复核；
- 文件类型、符号链接、目录边界、大小和读取期间稳定性检查。

普通 seal 路径仍只返回摘要，不扩大既有调用面的权限；只有签名 deployment 同时交付 recovery snapshot store 时，Desktop execution wrapper 才使用含字节的私有捕获端口。临时文件仍在捕获结束后删除。

真实 `better-sqlite3` 回归会把捕获字节写到新的数据库文件，重新以只读模式打开并查询原始业务行。这证明留存的是可用 SQLite backup，而不是仅为测试构造的任意 Buffer；它仍不等同于在线恢复流程已经实现。

## 2. 品牌化 recovery snapshot store

新增 [PM recovery snapshot store](../packages/cli/src/lib/evolution/pm-exploration-recovery-snapshot-store.js)。签名 deployment 通过内建 factory 创建品牌化 store，Desktop 只能从受信模块的 capture 端口取得 `retainTransitionSnapshot`，不能取得通用 artifact store、文件路径、Ledger writer 或 durability authority。

固定请求 `chainlesschain.pm-exploration-recovery-snapshot-request/v1` 绑定：

- execution manifest digest；
- `success`/`failure` 迁移类型；
- 成功使用 `post-run`、失败使用 `pre-run` 的固定 snapshot role；
- transition evidence digest；
- 完整 SQLite seal；
- 与 seal 同源的原始 backup 字节。

store 会重新计算 seal digest、固定域 snapshot digest、字节数和原始 artifact digest。随后使用外部 durability authority 执行同步 retain，再以相同 tenant、purpose、ref、retention、type 与 digest 精确 resolve；只有认证、耐久回执和逐字节回读全部一致才返回 `chainlesschain.pm-exploration-recovery-snapshot-ack/v1`。

snapshot ack 继续绑定 manifest、迁移类型、role、evidence、seal、snapshot、artifact、authority 和 durability receipt，并拥有独立可复算的 `snapshotAckDigest`。Proxy、accessor、错误原型、多余字段、替换字节、错误角色、错误 manifest、非耐久回执和副本篡改均失败关闭。

## 3. 先快照、后迁移的提交顺序

[Desktop execution wrapper](../desktop-app-vue/src/main/evolution/desktop-evolution-deployment.js) 的 snapshot-backed 路径使用以下顺序：

```text
成功 round
  pre-run backup → Actor/grader → post-run backup
  → retain/resolve post-run snapshot
  → commit success transition + snapshot ack
  → v2 durability ack → 推进内存状态链

失败 round
  pre-run backup → Actor/grader/证据失败 → failure-state backup
  → 构造 failure evidence
  → retain/resolve pre-run snapshot
  → commit failure transition + snapshot ack
  → host 保持 tainted
```

成功状态需要保留 post-run 快照，因为它是该成功链头代表的数据库状态；失败状态保留 pre-run 快照，因为它才是未来回滚的目标。failure-state seal 仍用于证明失败后的实际数据库变化，但不会被错误地当作恢复目标。

快照必须先于迁移提交：快照已保留但迁移未提交只会产生可回收的孤儿介质；反向顺序会产生已提交 Ledger 链头却没有恢复介质的不可恢复窗口。snapshot-backed transition 使用 `chainlesschain.pm-exploration-transition-durability-ack/v2`，其 `recoverySnapshotAckDigest` 必须与已验证 snapshot ack 完全相等。伪造或替换该字段会拒绝整个迁移确认。

兼容路径没有 snapshot store 时仍使用 v1 transition ack 和 v3 Desktop result，但新的 readiness 门槛不会允许它进入候选执行配置。snapshot-backed 成功结果使用 `chainlesschain.desktop-pm-sealed-execution-result/v4` 并携带只读 snapshot ack，不携带数据库字节。

## 4. Readiness 与权限边界

[Desktop PM readiness](../desktop-app-vue/src/main/evolution/desktop-pm-exploration-readiness.js) 新增 `durable-database-recovery-snapshot` 检查。配置兼容现在同时要求：

- 品牌化 transition committer；
- 认证 transition recovery readback；
- 品牌化 recovery snapshot retention；
- execution host 未 taint。

只读 execution inspector 仅增加 `recoverySnapshotConfigured`，不暴露快照字节、retain 函数、artifact ref、authority 或恢复文件路径。`snapshot-bound-transition-durability-ack` 仍列为缺失的当轮运行时证据；配置了 store 不代表某次执行已经完成耐久保留。

`readyForExecution`、`runtimeVerified`、`authenticated` 和 `qualifiesForPromotion` 继续为 `false`。

## 5. 回归证据

新增和更新的回归覆盖：

- 从真实 SQLite backup 同源产生 seal 与恢复字节；
- 将恢复字节写回新文件后可重新打开并查询；
- 成功迁移保留 post-run snapshot，失败迁移保留 pre-run snapshot；
- retain、认证耐久 receipt、resolve 和逐字节回读；
- store 重开后的确定性幂等保留；
- seal/字节、manifest、role、evidence 和 snapshot ack 摘要篡改失败关闭；
- 非耐久 receipt、替换后的 durability replica 和伪造 v2 transition ack 被拒绝；
- Desktop 明确执行 capture → retain/readback → transition commit 顺序；
- recovery snapshot store 不作为 Desktop dependency 暴露；
- 缺少 snapshot store 的 execution host 在 readiness 中保持 blocked。

验证结果：

| 检查                                               | 结果                 |
| -------------------------------------------------- | -------------------- |
| Desktop seal + reader + deployment + readiness     | 4 files，65 passed   |
| CLI PM、snapshot store、loader 与签名 test fixture | 16 files，184 passed |
| Node 语法、ESLint、Prettier、diff whitespace       | passed               |

本批没有调用火山引擎或产生新的模型费用；数据库快照保留不需要模型参与。

## 6. 保留边界

- 测试 durability authority 是本地合成 replica；本机仍没有 operator 签发的生产 snapshot store 或远端断电 durability 证据；
- 当前实现把单个 SQLite backup 作为 Buffer 交给窄化 store，虽有 8 GiB 协议上限，但真实大库上线前仍需改为受控流式传输并建立更低的运行时内存预算；
- snapshot store 建立了可恢复介质和精确回读证据，但没有向普通 Desktop 代码暴露 resolve/restore 能力；
- 失败链头仍保持 tainted，本批不会关闭数据库连接、替换文件、重开连接或解除 taint；
- workspace 文件尚未进入同一 snapshot binding，外部服务、操作系统资源和未提交应用内存仍不可回滚；
- JavaScript 捕获或 retain 前的进程崩溃、断电和 native fatal error 仍可能只留下旧链头；
- 尚未运行真实 Electron 身份、RBAC、工具 broker、生产 durability authority、数据库恢复和本地火山引擎组成的 PM E2E。

下一步应给隔离 PM clone 增加 manifest 绑定的 workspace snapshot，并把数据库与 workspace 两种介质纳入同一恢复集合摘要。完成后才能实现拥有独占数据库连接生命周期的恢复控制器：关闭连接、在 clone 根内原子替换、重开复核双 seal，再以认证恢复事件解除 taint。没有独占 clone 所有权时，不应操作应用主库。
