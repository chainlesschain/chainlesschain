# DB 加密 Phase 1 — 真机 Smoke Checklist（翻 gate 前必跑）

> 配套：`db-master-key-hardening-design.md` §5.2/§5.3。本清单**全过**后，才可把
> `desktop-app-vue/src/main/database/db-encryption-flag.js` 的 `PHASE_1_5_DEFAULT_ON`
> 由 `false` 改 `true`（Phase 1.5 翻 gate）。任一项失败 → 不翻，记录现象回报。
>
> 代码已 landed 且**默认 OFF**：Phase 0 `01f8b00b2` / Phase 1 `4983ab124` / Phase 1.5 `c7e1b38c5`。
> 本清单靠 `CHAINLESSCHAIN_ENABLE_DB_ENCRYPTION=1` 显式开启来验证，不依赖翻 gate。

## 0. 准备

- [ ] 一台**真机**（首选 Windows，因 U-Key/safeStorage 行为最完整；mac/Linux 亦可）。
- [ ] 能拿到两个构建：**(A) 当前默认版**（明文库，未设 env）、**(B) 含 Phase 1 的版本**。可同一安装包，靠 env 区分。
- [ ] 会看应用日志（main 进程日志）。关键行：`数据库路径:`、`数据库加密状态:`、`数据库口令来源:`、`[encrypted-migration]`、`[db-secret-provider]`。

### 路径速查（`<userData>` = 应用数据目录）

| 平台 | `<userData>` |
|---|---|
| Windows | `%APPDATA%\chainlesschain-desktop-vue` |
| macOS | `~/Library/Application Support/chainlesschain-desktop-vue` |
| Linux | `~/.config/chainlesschain-desktop-vue` |

| 文件 | 路径 | 含义 |
|---|---|---|
| 明文库 | `<userData>/data/chainlesschain.db` | 迁移前 |
| 加密库 | `<userData>/data/chainlesschain.encrypted.db` | 迁移后 |
| 旧库（改名） | `<userData>/data/chainlesschain.db.old` | 迁移成功后源库被改名 |
| 迁移备份 | `<userData>/data/chainlesschain.db.backup.<ts>` | DatabaseMigrator 备份 |
| 迁移锁 | `<userData>/data/chainlesschain.encrypted.db.migrating.lock` | 迁移中存在，完成即删 |
| 托管口令 | `<userData>/db-secret.enc` | safeStorage 加密的 DB 口令 |
| 密钥元数据 | `<userData>/db-key-config.json` | salt 等（不含密钥） |

## 1. 基线（默认 OFF 不变）

- [ ] 构建 (A) **不设 env** 启动 → 日志 `数据库加密状态: 未启用`（或走 Better-SQLite3 明文）。
- [ ] 正常用一会儿：建 ≥3 条笔记 / ≥1 个会话 / 任意可计数数据。**记下条数：__________**。
- [ ] 确认此时**无** `chainlesschain.encrypted.db`、**无** `db-secret.enc`。
- [ ] 完全退出应用。

## 2. 首次开启 + 明文→加密迁移（核心）

- [ ] 用构建 (B)、设 `CHAINLESSCHAIN_ENABLE_DB_ENCRYPTION=1` 启动。
  - Windows(PowerShell): `$env:CHAINLESSCHAIN_ENABLE_DB_ENCRYPTION=1; & '<App>.exe'`
  - macOS/Linux: `CHAINLESSCHAIN_ENABLE_DB_ENCRYPTION=1 <app>`
- [ ] 日志出现 `DB 加密 opt-in 已开启` + `数据库加密状态: 已启用` + `数据库口令来源: managed-new`（或 `managed`）。
- [ ] 日志出现 `[encrypted-migration] 迁移 + 重开校验通过`（迁移真的跑了且重开校验过）。
- [ ] **数据完好**：应用内笔记/会话条数 == 第 1 步记下的数 `__________`。
- [ ] 文件检查：
  - [ ] 出现 `<userData>/data/chainlesschain.encrypted.db`
  - [ ] 出现 `<userData>/data/chainlesschain.db.old`（源库已改名）
  - [ ] 出现 `<userData>/db-secret.enc`
  - [ ] 迁移锁文件**已消失**（`*.migrating.lock` 不存在）
- [ ] 完全退出，**再次**用 `=1` 启动 → 日志 `数据库口令来源: managed`（复用托管口令，不再 migrate）；数据仍完好。

## 3. 加密真实性（旧密钥打不开）

- [ ] 用任意 SQLite/SQLCipher 工具尝试以**空密钥**或旧 `"123456"` 打开 `chainlesschain.encrypted.db` → **应失败 / 读不到表**。
- [ ] 用同工具直接打开（不带密钥）应报 "file is not a database" 或加密错误。
  > 说明：真正的 key 在 OS keychain（safeStorage），文件单独不可解。

## 4. fail-closed（加密必需时不静默落明文）

- [ ] 模拟加密初始化失败（任选其一，能做哪个做哪个）：
  - 临时改名/占用 `chainlesschain.encrypted.db` 使其打不开，`=1` 启动；或
  - 在 safeStorage 不可用的环境（如某些无 keychain 的 Linux）`=1` 启动。
- [ ] 期望：应用**不**生成新的明文 `chainlesschain.db`、**不**静默降级；日志见 `requireEncryption=true，拒绝明文回退` 或 `拒绝回退到明文 sql.js`。（DB 不可用时降级模式可接受，但**绝不能落明文库**。）
- [ ] 恢复现场（改回文件名）后 `=1` 再启动应恢复正常。

## 5. 中断与恢复（不丢数据）

- [ ] 在一台**尚未迁移**的真机（重置到第 1 步状态：删 `encrypted.db`/`db-secret.enc`，保留明文 `chainlesschain.db`）。
- [ ] `=1` 启动后，在迁移进行中**强杀进程 / 断电**（可借大库或断点）。
- [ ] 重启 `=1`：期望源明文库或其 `.old`/`.backup.<ts>` 仍在，数据可恢复，应用能重试迁移并最终成功；**不得出现数据丢失**。
- [ ] 确认无残留 `*.migrating.lock` 阻塞（若残留 >10min 应被自动回收，日志 `回收陈旧迁移锁`）。

## 6. 并发（多实例不互相踩坏）

- [ ] 重置到未迁移状态，几乎同时启动**两个**实例（都 `=1`）。
- [ ] 期望：只有一个执行迁移，另一个见锁跳过（日志 `另一进程正在迁移，跳过本次`）；最终库完好、单一 `encrypted.db`、无损坏。

## 7. Kill-switch（紧急关停可用）

- [ ] 已迁移的机器，用 `CHAINLESSCHAIN_ENABLE_DB_ENCRYPTION=0` 启动：
  - [ ] 期望加密**强制关闭**（日志 `数据库加密状态: 未启用`）。验证 kill-switch 生效（翻 gate 后仍可用此急停）。
  > 注意：此时会回到读明文/Better-SQLite3 分支；若机器已只有 `encrypted.db`，可能无明文库可读——本步仅验证 flag 解析，不要求数据可读。建议在第 2 步前先单独验 kill-switch 优先级。

## 8. 通过后：翻 gate（Phase 1.5）

全部勾选通过后：

- [ ] 改 `db-encryption-flag.js`：`const PHASE_1_5_DEFAULT_ON = false;` → `true`。
- [ ] 更新 `db-encryption-flag.test.js` 中 `expect(PHASE_1_5_DEFAULT_ON).toBe(false)` 的断言（改成 `true`）。
- [ ] 跑 `npx vitest run src/main/database/__tests__/db-encryption-flag.test.js` + DB 套件。
- [ ] commit（建议 `feat(db): flip Phase 1.5 — DB encryption on by default in packaged builds`），随下次发版生效。
- [ ] 发版后留意：老用户首启会跑迁移，关注崩溃率 / `[encrypted-migration]` 失败日志；备好 `=0` 急停话术。

## Phase 2 — legacy `.encrypted("123456")` 库 rekey（单独 smoke，双 gate）

> 仅适用于**曾手动开过加密**、已有 `chainlesschain.encrypted.db`（"123456" 加密）的机器。
> 双 gate：须 `CHAINLESSCHAIN_ENABLE_DB_ENCRYPTION=1` **且** `CHAINLESSCHAIN_ENABLE_DB_REKEY=1`。

- [ ] 造一台 legacy 现场：有 `chainlesschain.encrypted.db`（"123456" 派生）+ `db-key-config.json`（含 salt）+ **无** `db-secret.enc`。
- [ ] 两个 env 都设为 1 启动 → 日志 `legacy rekey 结果: {"success":true}` + `[legacy-rekey] rekey + 重开校验通过`。
- [ ] 数据完好；出现 `db-secret.enc`；`db-key-config.json` 的 salt 已更新；`*.rekey-bak` 已删除；`*.rekeying.lock` 不残留。
- [ ] **旧 key 验证**：用 "123456" + 旧 salt 重算 key 已**打不开** `encrypted.db`（已 rekey 到托管口令）。
- [ ] 再次启动（双 gate 仍开）→ 日志走 `managed`，不再 rekey；数据仍在。
- [ ] **中断恢复**：重置 legacy 现场，rekey 进行中强杀/断电。重启：
  - [ ] 若提交未完成 → `[legacy-rekey] 恢复：…已回滚到 legacy 加密库`，`.rekey-bak` 被恢复为主库，数据完好，可重试。
  - [ ] 若提交已完成 → `恢复：rekey 已提交，清理陈旧备份`，用托管 key 正常开。
  - [ ] **任一情况都不得丢数据**（rekey 只改加密 key、不改数据）。
- [ ] **并发**：双实例同时启动（双 gate 开），只有一个 rekey，另一个见锁跳过，库不坏。
- [ ] 全过后：Phase 2 也可纳入默认（给 rekey 加 gated 默认，或在 Phase 1.5 翻 gate 时一并；建议保持 `CHAINLESSCHAIN_ENABLE_DB_REKEY` 显式开，因受众罕见）。

## 签核

- 执行人 / 日期 / 构建版本：__________
- 结果（全过 / 失败项）：__________
- 失败现象与日志摘录：__________
