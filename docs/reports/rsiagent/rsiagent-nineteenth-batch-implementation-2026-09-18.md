# RSIAgent 第十九次工程实施：执行后 SQLite seal 与状态迁移证据

> 日期：2026-09-18（Asia/Shanghai）<br>
> 前置实施：[第十八次签名 SQLite pre-run seal 与执行门禁](./rsiagent-eighteenth-batch-implementation-2026-09-18.md)<br>
> 后续实施：[第二十次异常状态 seal 与执行 host 污染门禁](./rsiagent-twentieth-batch-implementation-2026-09-18.md)<br>
> 状态：Desktop 在成功完成受治理 Actor 与 grader 后再次生成一致 SQLite backup seal，并把签名 manifest、执行/评分回执、执行前后 seal 以及前序迁移摘要汇入状态迁移链。同一数据库 seal 捕获能力上的 round 会串行执行，避免不同轮次的证据窗口交错；首轮核对 manifest 签入的初始 seal，后续轮核对上一轮 post seal。该结果仍不是耐久、已签名的恢复记录。

## 1. 执行后状态封口

[Desktop execution wrapper](../../../desktop-app-vue/src/main/evolution/desktop-evolution-deployment.js) 的成功路径升级为 `chainlesschain.desktop-pm-sealed-execution-result/v2`：

```text
进入同一 capture capability 的串行执行队列
  → 捕获并验证 pre-run seal 与签名 manifest
  → 执行受治理 Actor、grader 和回执校验
  → 取得 executionReceiptDigest / graderReceiptDigest
  → 再次捕获并验证 post-run SQLite seal
  → 确认数据库路径身份未变化
  → 生成 stateTransitionDigest
  → 返回冻结的本地包装结果
```

`databaseChanged` 只比较执行前后 SQLite backup 的内容摘要，不依据 Actor 返回的成功标记推测是否发生了持久化写入。post-run seal 继续通过真实 `DatabaseManager.backup()` 取得一致 SQLite 视图；捕获工厂还会在整个生命周期内锁定同一个 manager 与数据库路径摘要，不能在两次 seal 之间静默切换数据库。

## 2. 状态迁移摘要

`stateTransitionDigest` 使用独立域 `chainlesschain.desktop-pm-database-transition/v1`，绑定以下六项：

- 已验签 execution manifest 的 `manifestDigest`；
- Actor 的 `executionReceiptDigest`；
- grader 的 `graderReceiptDigest`；
- 已与 manifest 核对的 `preRunSealDigest`；
- 执行完成后的 `postRunSealDigest`。
- 首轮为 `null`、后续轮为上一轮摘要的 `previousStateTransitionDigest`。

因此，本地主进程结果不能把另一次执行的回执或另一个执行后数据库视图解释为同一次状态迁移。首轮的 pre-run seal 必须等于签名 manifest 的初始值；首轮成功后，host 将下一轮期望值推进为本轮 post-run seal，并将本轮迁移摘要作为下一轮的链前驱。合法数据库写入不会导致第二轮错误地继续与初始 seal 比较，轮间的未解释状态漂移则会在下一次 Actor 运行前失败关闭。Desktop 只从品牌化 CLI host 的只读 inspector 取得 manifest 摘要，并通过 data descriptor 读取回执摘要；accessor、Proxy 或格式错误的摘要会失败关闭。

该摘要当前没有独立 operator 签名，也没有写入 durability authority 或 Evolution Ledger。它是可复算、进程内冻结的关联证据，不是已经认证和耐久化的审计记录。

## 3. 并发归因边界

pre/post seal 若允许并发交错，会出现如下歧义：第一轮的 post seal 可能包含第二轮写入，无法再把数据库增量归因到第一轮 receipt。Desktop 现在按 seal 捕获函数建立共享执行 lane；同一能力的调用严格完成整个 `pre seal → execute → post seal` 窗口后，下一轮才可进入。

队列在成功和失败后都会释放，不会因上一轮拒绝而永久阻塞后续调用。此约束覆盖正常 Desktop 装载路径所使用的模块级单例捕获能力；若未来允许为同一数据库创建多个独立 capture capability，还必须增加按规范数据库身份共享的跨 capability 锁或由隔离进程独占数据库。

## 4. 回归证据

新增和更新的回归覆盖：

- 真实 SQLite 在相同状态下得到相同 seal，提交写入后内容与 seal 摘要变化；
- 捕获生命周期内 manager 或数据库路径替换失败关闭；
- Desktop 成功结果同时携带 pre/post seal、数据库变化标记与可复算状态迁移摘要；
- 状态迁移摘要精确绑定 manifest、两份签名 receipt、两份数据库 seal 与前序迁移摘要；
- 连续两轮以第一轮 post seal 作为第二轮 pre-run 期望值，并链接上一轮迁移摘要；
- 两个并发 round 在同一捕获能力上保持完整 seal-execute-seal 顺序；
- manifest 的 pre-run seal 不匹配时，底层 Actor、grader 与工具 broker 仍不会运行。

验证结果：

| 检查                                           | 结果               |
| ---------------------------------------------- | ------------------ |
| Desktop seal + reader + deployment + readiness | 4 files，51 passed |
| Node 语法检查                                  | passed             |

CLI manifest/receipt 协议未在本批再次修改；本批最终按 `packages/cli/vitest.config.js` 重跑 PM 全组、deployment loader 与签名 test deployment fixture，共 14 files、173 passed。本批没有调用火山引擎或产生新的模型费用。

## 5. 保留边界

- 本批 post-run seal 只在底层受治理 round 成功返回且回执结构有效后生成；后续第二十批已给可捕获的异常路径增加 failure-state seal 与 taint 门禁，但进程崩溃、断电和 native fatal error 仍无 crash-time seal；
- 临时 SQLite backup 在哈希后删除，不是可用于恢复的耐久快照；
- 现有 workflow snapshot/restore 会逐表删除和插入，并可能吞掉局部失败，不满足本试点的原子恢复要求，因而没有接入；
- 尚未覆盖 workspace 文件、外部服务、操作系统资源或未提交应用内存；
- 尚未把状态迁移摘要写入签名 receipt、evidence bundle、耐久 Ledger 或外部 durability authority；
- 当前机器仍没有 operator 签发的真实 PM deployment，也未运行 Electron DID/RBAC PM 工具 E2E；
- readiness 继续把运行时签名数据库 seal 列为缺失证据，promotion 保持 `hold`。

下一步应实现一次性 clone 的原子恢复协议：保留可恢复的数据库与 workspace 快照，在 Actor/grader 失败、超时或越权时关闭连接并原子替换隔离副本，重开后复核初始 seal，再把创建、执行、评分、恢复和清理阶段写入已认证的耐久 Ledger。只有该协议和真实 Electron DID/RBAC 工具链 E2E 均通过后，才具备受治理 PM 试点资格。
