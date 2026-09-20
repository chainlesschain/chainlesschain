# RSIAgent 第二十次工程实施：异常状态 seal 与执行 host 污染门禁

> 日期：2026-09-18（Asia/Shanghai）<br>
> 前置实施：[第十九次执行后 SQLite seal 与状态迁移证据](./rsiagent-nineteenth-batch-implementation-2026-09-18.md)<br>
> 后续实施：[第二十一次状态迁移耐久提交能力](./rsiagent-twenty-first-batch-implementation-2026-09-18.md)<br>
> 状态：Desktop 在 pre-run seal 已验证之后，如果 Actor、grader、回执解析或 post-run seal 任一步失败，会尝试捕获 failure-state SQLite seal、生成失败迁移证据，并将当前 execution host 标记为 tainted。未完成受认证恢复前，该 host 的后续 round 全部失败关闭。

## 1. 异常后的数据库状态证据

[Desktop execution wrapper](../../../desktop-app-vue/src/main/evolution/desktop-evolution-deployment.js) 现在把 pre-run seal 之后的执行与证据处理放在同一个失败边界内。下列任一情况都会进入污染流程：

- 底层受治理 Actor 或 grader 抛出异常；
- execution/grader receipt 缺失、使用 accessor，或摘要格式无效；
- post-run seal 捕获或校验失败；
- 执行后数据库路径身份与 pre-run seal 不一致；
- 状态迁移摘要生成前的其他验证失败。

失败路径会再次调用同一个 SQLite seal 捕获能力。若捕获成功，证据记录数据库身份是否保持一致，以及 snapshot 内容是否已经变化；若捕获本身失败，`failureSeal`、`databaseIdentityUnchanged` 和 `databaseChanged` 明确为 `null`，不会伪造“数据库未变化”。第二次捕获失败也不会覆盖最初的执行错误，原始错误保留在包装错误的 `cause` 中。

规范 schema 为 `chainlesschain.desktop-pm-failed-execution-evidence/v1`。`evidenceDigest` 使用独立域并绑定：

- 签名 execution manifest 摘要；
- 已验证的 pre-run seal；
- 可取得时的 failure-state seal；
- 数据库身份与内容变化判断；
- 上一条成功状态迁移摘要；
- 固定失败分类和治理标志。

该证据明确返回 `authenticated:false`、`durable:false`、`qualifiesForPromotion:false`。它用于检测和阻断，不是 operator 签名或 Ledger 留存的替代品。

## 2. tainted host 门禁

一旦失败发生在已验证 pre-run seal 之后，host 状态立即变为 tainted。共享执行 lane 中已经排队或之后提交的 round 会在捕获下一份 seal、调用 Actor、grader 或工具 broker 之前，以 `CC_DESKTOP_PM_EXECUTION_TAINTED` 拒绝。

pre-run seal 自身不匹配时仍沿用第十八批行为：由于底层执行从未开始，不把 host 标记为“执行后污染”。这一区分避免把部署配置错误错误地表述为未知的执行副作用。

新增的只读 `inspectDesktopPmExplorationExecutionHost()` 仅投影：

- `tainted`；
- `requiresRecovery`；
- 始终为 `false` 的 `qualifiesForPromotion`。

它不暴露 runner、grader、工具 broker、签名私钥、seal 捕获函数或内部状态摘要。Desktop readiness 新增 `execution-host-untainted` 检查，并继续把 `authenticated-failure-transition-evidence` 列为缺失运行时证据。第二十一批在该只读投影上增加了 `transitionDurabilityConfigured`，仍未暴露提交函数或存储权威。

## 3. Ledger 权限边界复核

现有 Desktop PM storage host 故意只保留 `load`，不会暴露底层 store 的 `commitJournal` 或 `restoreLatestJournal`。本批没有为了保存 failure evidence 而放宽该边界，因为让普通 Desktop 代码直接取得 journal/evidence 写端口会重新暴露签名 deployment 内部的持久化权威。

第二十一批已由签名 deployment 增加用途单一的 success/failure transition committer：它重新校验 manifest、seal、前序迁移摘要和失败分类，并要求绑定的 authenticated/durable/readback acknowledgement；readiness 仍不会把本批内存证据或“仅配置了提交器”视为已经取得运行时耐久证据。

## 4. 回归证据

新增回归验证：

- Actor 在已提交数据库变化后抛错时，错误携带 pre/failure seal 与 `databaseChanged:true`；
- 原始 Actor 错误保留为 `cause`；
- failure evidence 为冻结对象并具有独立 SHA-256 摘要；
- failure-state seal 捕获再次失败时保留原始执行错误，并把三个未知字段明确置为 `null`；
- failure evidence 明确为未认证、未耐久、不可 promotion；
- host 立即投影为 `tainted:true / requiresRecovery:true`；
- 第二轮在 seal、Actor 和 grader 之前被拒绝，底层执行调用次数保持为一次；
- 未品牌化 execution host 的 readiness 同时无法通过签名 host 与 untainted 检查。

验证结果：

| 检查                                           | 结果                 |
| ---------------------------------------------- | -------------------- |
| Desktop seal + reader + deployment + readiness | 4 files，53 passed   |
| Node 语法、ESLint、Prettier、diff whitespace   | passed               |
| CLI PM/deployment 上一批最终回归               | 14 files，173 passed |

本批没有调用火山引擎或产生新的模型费用。

## 5. 保留边界

- 当前只能检测失败后的数据库状态并阻止继续执行，不能自动恢复；
- failure seal 仍是临时 backup 的摘要，backup 在哈希后删除，不是恢复介质；
- 进程崩溃、断电或 native fatal error 可能使 JavaScript catch 根本没有机会生成 failure evidence；
- workspace 文件、外部服务和操作系统资源仍未进入失败 seal；
- taint 状态只存在当前进程内，重启后必须依赖未来的耐久 Ledger 恢复；
- 现有 workflow 逐表 restore 不满足原子性，仍未接入；
- 当前机器没有 operator 签发的 PM deployment，也未运行真实 Electron DID/RBAC PM 工具 E2E。

第二十一批已补充窄化的 transition durability capability；下一步应为一次性隔离 clone 实现拥有独占连接生命周期的原子替换恢复，并在恢复后复核初始数据库与 workspace seal。没有独占 clone 所有权时，不应对应用主库执行自动文件替换。
