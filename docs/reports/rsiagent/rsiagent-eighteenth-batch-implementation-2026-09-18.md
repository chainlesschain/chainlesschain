# RSIAgent 第十八次工程实施：签名 SQLite pre-run seal 与执行门禁

> 日期：2026-09-18（Asia/Shanghai）<br>
> 前置实施：[第十七次签名数据库路径与 grader source digest 绑定](./rsiagent-seventeenth-batch-implementation-2026-09-18.md)<br>
> 后续实施：[第十九次执行后 SQLite seal 与状态迁移证据](./rsiagent-nineteenth-batch-implementation-2026-09-18.md)<br>
> 状态：PM execution manifest v2 现在必须签入 `preRunSealDigest`。Desktop 每轮调用 Actor 前从当前 `DatabaseManager` 生成一致 SQLite backup、计算路径与内容 seal，并与 manifest 核对；不匹配时不运行 Actor、grader 或工具 broker。

## 1. 一致数据库快照

[Desktop pre-run seal](../../../desktop-app-vue/src/main/evolution/desktop-pm-pre-run-seal.js) 只在 Electron 主进程使用，执行步骤为：

1. 通过 property descriptor 捕获 `DatabaseManager.backup()` 和 `getCurrentDatabasePath()`，拒绝 Proxy 与 accessor；
2. 在系统临时目录创建一次性目标，调用现有 `DatabaseManager.backup()`；真实 `better-sqlite3` 路径由 SQLite backup API 合并当前已提交状态，而不是直接拼接读取 `.db/.db-wal/.db-shm`；
3. 确认备份是临时目录中的普通文件，限制为非空且不超过 8 GiB；
4. 以固定域分隔串流计算备份内容 SHA-256，并在读取前后核对大小与修改时间；
5. 再次确认 DatabaseManager 对象和数据库路径未变化；
6. 删除临时备份和目录，不把数据库副本暴露给 deployment 或 renderer。

seal 绑定：

- 规范绝对数据库路径摘要；
- SQLite backup 内容摘要；
- backup 字节数；
- 固定 `database-manager-backup` 方法标识。

规范 seal schema 为 `chainlesschain.desktop-pm-database-pre-run-seal/v1`。任一字段修改、路径漂移、内容变化或备份期间 manager 替换都会改变 seal 或直接失败。

## 2. 签名 manifest 与执行门

[PM execution manifest](../../../packages/cli/src/lib/evolution/pm-exploration-execution-host.js) 升级为 `chainlesschain.pm-exploration-execution-manifest/v2`，新增必填 `preRunSealDigest`。该字段参与 `manifestDigest`；既有 run/grade request、execution/grader receipt 和 evidence bundle 已绑定 `executionManifestDigest`，因此无需给每种 receipt 重复增加一份 seal 字段。

CLI execution host 新增只读 inspection，只返回 plan、environment、manifest 与 pre-run seal 摘要。Desktop loader 从品牌化 host 取得签名期望值，但不取得 runner、grader、工具 broker或签名私钥。

`executeDesktopPmExplorationRound()` 的顺序现在是：

```text
捕获 SQLite backup seal
  → 复算并校验 seal 自身摘要
  → 与签名 manifest.preRunSealDigest 精确比较
  → 调用受治理 PM execution host
  → 返回 seal + 原执行结果的冻结 Desktop 包装
```

seal 不匹配发生在底层 `executePmExplorationRound()` 之前，因而 runner prepare、Actor、grader、模型 ingress 和工具 broker 均不会被调用。merge/evaluate 是内存证据处理，本批只给可能运行 PM 工具的 round 增加该门禁。

## 3. 回归证据

真实 SQLite 测试创建文件数据库并验证：

- 同一已提交状态的两次 backup 产生相同 seal；
- 提交数据修改后，路径摘要保持不变，但 snapshot 与 seal 摘要改变；
- backup 期间数据库路径变化会失败关闭；
- accessor 形式的 backup 不会执行 getter；
- 篡改 seal 字段或摘要会被拒绝；
- Desktop 收到与 manifest 不同的 seal 时，底层 execution mock 调用次数为零；
- manifest 的 `preRunSealDigest` 被修改但未重签时，manifest 校验失败。

验证结果：

| 检查                                             | 结果                 |
| ------------------------------------------------ | -------------------- |
| Desktop seal + reader + deployment + readiness   | 4 files，48 passed   |
| CLI execution + grader + ledger + loader         | 4 files，87 passed   |
| CLI PM 全组 + deployment loader + signed fixture | 14 files，172 passed |

本批没有调用火山引擎或产生新的模型费用。第十四批的真实 provider 调用证据继续保留，本批只变更执行前本地状态门禁。

## 4. 保留边界

- 当前机器没有 operator 对真实隔离 clone 的 seal 签发 deployment；测试使用真实 SQLite backup，但 manifest signer 与数据库内容是测试身份；
- seal 覆盖 SQLite 已提交状态，不覆盖 workspace 文件、外部服务、操作系统资源或未提交的应用内存；
- 临时 backup 在计算后删除，返回的是摘要证据，不是可用于恢复的耐久快照；
- 本批只验证 Actor 前状态；后续第十九批已补成功执行后的 seal，但 grader 前、异常中断、恢复后及清理后的多阶段 seal 仍未形成；
- 尚未运行真实 Electron DID/RBAC PM 工具链，也未证明工具只能修改隔离 clone；
- readiness 继续把 `signed-database-pre-run-seal` 列为缺失运行时证据；代码门存在不等于目标 deployment 已提供正确 seal；
- promotion 继续保持 `hold`，不得据此进入 Pilot 或发布。

下一步应建立一次性 workspace/database clone contract：签入 workspace 初始摘要和允许变更范围，执行后记录数据库与文件增量，恢复后复核初始 seal，并把创建、执行、grader、恢复、清理五个阶段的证据写入耐久 Ledger。完成后再运行真实 Electron DID/RBAC PM 工具 E2E。
