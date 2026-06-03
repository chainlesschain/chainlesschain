# DB 主密钥加固设计（去硬编码 "123456" + rekey 迁移 + fail-closed）

> 状态：**设计待评审**（未实施）。2026-06-03 由安全审计触发。
> 前置：DID 私钥列级加密已落地（commit `4f9057d0c`，`did/did-keystore.js`），本文复用其 safeStorage 模式。
> 关联 memory：`did_private_key_at_rest_encryption`。

## 1. 问题陈述（root cause）

### 1.0 最关键发现（2026-06-03 复查，纠正本文初稿前提）

**打包的生产版整个 SQLite 主库是明文落盘的，SQLCipher/"123456" 那条路在生产里是死代码。**

链条：
- `scripts/build-main.js` 只在**构建时**用 `NODE_ENV` 决定是否 minify，**不把 `process.env.NODE_ENV="production"` 注入运行时**（`build-main.js:5`）；Electron 运行时也不设 NODE_ENV。
- 故装好的 app 里 `process.env.NODE_ENV === undefined`。
- `isDevelopmentMode()` = `NODE_ENV==="development" || !NODE_ENV` → **true**（`config-manager.js:18-19`、`database.js:189-190`、`database-adapter.js:54-56` 三处同款误判）。
- ⇒ `EncryptionConfigManager` 默认 `encryptionEnabled = !isDev = false`（`config-manager.js:37`；且 bootstrap `new EncryptionConfigManager(app)` 把 `app` 对象当 configPath，`loadConfig` 永远落默认值）。
- ⇒ `database.js initialize()` 命中 `isDevelopment` 分支，用**无加密 Better-SQLite3**（`database.js:188-209`）。

**净效果**：生产版的笔记 / 会话 / P2P / 知识 / DID 行……全部明文在磁盘。先前以为的"PBKDF2('123456') 弱加密"在生产里**根本没发生**。

推论：
1. 已落地的 **DID 列级加密（`4f9057d0c`）是生产里唯一在保护 DID 私钥的机制**，价值被低估了。
2. 真正的修复不是"换个强密码"，而是**让生产真正开启加密**：把 dev 判定从 `NODE_ENV` 改成 `app.isPackaged`（`database.js:50-59` 已 import `app`，line 365 已用 `app.isPackaged`，信号现成）。
3. 一旦开启，已有用户的**明文 `chainlesschain.db` 需要"明文→`.encrypted`"迁移**（走 `database-adapter.performMigration` / `migrateDatabase`），这是**有数据丢失风险的数据迁移**，与 rekey 同级，必须真机门禁。
4. ⇒ **不存在"既高价值又零风险"的 Phase 1 切片**：去硬编码密码在生产里休眠（生产没开加密），有价值的开加密+迁移天然有风险。

### 1.1 原始证据（即便加密开启也存在的弱点）

桌面端 SQLite/SQLCipher 主库的"加密"即使被启用也形同虚设：

| 证据 | 位置 |
|---|---|
| 生产 SQLCipher 密码**硬编码** `"123456"`（仅 env `DEFAULT_PASSWORD` 可覆盖，默认值在公开源码里） | `src/main/bootstrap/core-initializer.js:32` |
| DB key = `PBKDF2(password, salt)`，salt 以**明文**存在元数据文件 | `database/key-manager.js:145-178`、`saveKeyMetadata:241` |
| SQLCipher 初始化失败 → **静默回退明文 sql.js**（`fs.writeFileSync` 落明文库） | `database.js:223-235`、`database-adapter.js:361` |
| dev 模式直接用 **无加密** Better-SQLite3（无密码） | `database.js:188-209`、`config-manager.js:37` |
| 已有的 U-Key 硬件派生路径被绕过：bootstrap 永远传 password → `forcePassword:true` | `database-adapter.js:157,233`、`key-manager.js:200-208` |

**净效果**：攻击者拿到 `chainlesschain.encrypted.db` + 明文 salt + 公开源码里的 `"123456"`，即可重算 PBKDF2 派生出 DB key，完整解库。与产品"硬件级安全（U-Key/SIMKey）"定位直接冲突。

## 2. 威胁模型

- **In-scope**：磁盘静态泄露——笔记本被盗（无全盘加密）、云同步/备份泄露、用户态 malware 读应用数据目录、误传含 DB 的诊断包。
- **Out-of-scope（本设计不解决）**：root/管理员实时内存抓取（safeStorage 解出的 key 在进程内存里）、键盘记录、对 OS 用户会话已登录态的攻击（safeStorage 绑定当前 OS 用户，已登录即可解）。这是 safeStorage 的固有边界，与浏览器密码管理器同档。

目标：把"DB 文件 + 公开源码即可解库"提升到"需要攻陷该 OS 用户的活动会话/keychain"。

## 3. 现状数据流

```
core-initializer.js  ── password:"123456" ──▶ DatabaseManager
DatabaseManager.initialize()
  ├─ dev?               → Better-SQLite3（明文，无 key）
  ├─ encryptionEnabled? → DatabaseAdapter → KeyManager.getOrCreateKey({password,salt,forcePassword:true})
  │                          → deriveKeyFromPassword = PBKDF2("123456", salt)  ← 唯一秘密是公开常量
  │                          → createEncryptedDatabase(path, key); db.open()
  └─ 上面任一抛错        → 静默 initializeWithSqlJs()（明文落盘）
```

salt 存 `KeyManager.configPath` 指向的元数据 JSON（`method/salt/encryptionEnabled`），**不含 key 但含 salt**。

## 4. 提案

### 4.1 新模块 `database/db-secret-provider.js`（safeStorage 托管随机口令）

复用 DID 的 `did-keystore` 思路，但托管的是 **DB passphrase**（高熵随机，喂给现有 PBKDF2 流程，最小改动）。

职责：
- `getOrCreateManagedPassphrase()`：
  - 若 safeStorage 已存有密文口令（持久在 `.chainlesschain/db-secret.enc`）→ 解出返回。
  - 否则生成 `crypto.randomBytes(32).toString("base64")`，`safeStorage.encryptString` 后写文件，返回。
- `hasManagedPassphrase()`：是否已存在托管口令文件。
- `isAvailable()`：`safeStorage.isEncryptionAvailable()`。
- 测试 seam `_setSafeStorageForTesting`（同 did-keystore）。

**关键点**：托管口令文件 `db-secret.enc` 用 OS keychain 加密，磁盘上是密文；salt 仍可明文（PBKDF2 的 salt 公开无妨，秘密在口令）。

### 4.2 bootstrap 接入（`core-initializer.js`）—— 去掉 "123456"

```
const provider = createDbSecretProvider({ configDir });
let password;
if (provider.isAvailable()) {
  if (provider.hasManagedPassphrase()) {
    password = provider.getOrCreateManagedPassphrase();         // 已托管
  } else if (legacyEncryptedDbExists()) {
    password = LEGACY_PASSWORD;                                  // 见 4.3 决策
  } else {
    password = provider.getOrCreateManagedPassphrase();         // 全新安装 → 随机
  }
} else {
  // safeStorage 不可用：见 4.4 fail-closed 策略
}
```

- `LEGACY_PASSWORD` = `process.env.DEFAULT_PASSWORD || "123456"`（保留 env 逃生口）。
- **兼容矩阵**（按 §1.0 修正：生产现状是**明文 Better-SQLite3 库**，不是 legacy .encrypted）：

| 场景 | 行为 | 数据丢失风险 |
|---|---|---|
| 全新安装（无任何库） | 开加密 + 随机口令 + 托管 | 无 |
| **已有明文生产库（绝大多数现存用户）** | **开加密需"明文→.encrypted"迁移**（performMigration） | **有**（数据迁移，需真机门禁） |
| dev（Better-SQLite3 明文） | 保持明文（开发便利） | 无 |
| 罕见：已有 .encrypted（曾手动开过加密，legacy "123456"） | rekey 到随机口令（§4.3 路径 B） | 有（rekey） |
| safeStorage 不可用 | 见 4.4 | — |

> **前置改动**：开加密必须先把 `isDevelopmentMode()` 的判定从 `NODE_ENV` 改为 `app.isPackaged`（三处：config-manager / database.js / database-adapter），否则生产永远走 dev 明文分支。这一改动本身就会让所有现存生产用户**首次进入加密路径 → 触发明文→.encrypted 迁移**，故与迁移同属高风险、同一门禁。

### 4.3 已有库迁移 —— 高风险，需真机门禁

> **§1.0 修正**：现存生产用户绝大多数是**明文 Better-SQLite3 库**，主迁移路径是 **"明文→.encrypted"**（走 `database-adapter.performMigration` → `migrateDatabase`，已存在），而非 rekey。rekey（下文路径 B）只针对**罕见**的、曾手动开过加密的 legacy `.encrypted("123456")` 库。两类迁移都必须带下方安全网 + 真机门禁。

**明文→.encrypted（主路径）安全网**：迁移前 `copyFile(plaintext.db → plaintext.db.premigrate-bak)`；`migrateDatabase` 产出 `.encrypted` 后校验（开新库 + 抽查表行数 == 源）；通过→写托管口令 + 删 bak（或保留一个版本周期）；失败→删坏的 .encrypted、保留明文库 + 明文路径、telemetry 告警。同样需进程内文件锁防并发。

下面是 legacy `.encrypted` 的 rekey 路径（罕见场景），两种落地二选一（由发版决策）：

**路径 A（零风险，先上）**：legacy 库继续用 "123456" 开，不 rekey。只有新库随机。老用户保持现状（不更弱），全新用户立即受保护。`db-secret-provider` 与 wiring 先 land + 单测。rekey 留作 Phase 2。

**路径 B（彻底，需真机）**：启动时把 legacy 库 rekey 到托管随机口令。**必须**带安全网：
1. `copyFile(encrypted.db → encrypted.db.rekey-bak)`。
2. 用 `PBKDF2(LEGACY_PASSWORD, salt_old)` 开库 → `db.rekey(PBKDF2(managedPassphrase, salt_new))`。
3. 校验：重开新 key，`SELECT count(*) FROM sqlite_master`，再抽查一张业务表行数 == rekey 前。
4. 校验通过 → 删 bak + 写托管口令 + 更新元数据 salt_new；失败 → 删坏库、`rename(bak → encrypted.db)` 回滚、保留 "123456" 路径、telemetry 告警。
5. 全程加进程内文件锁，防并行 session/多实例同时 rekey（参考 memory `feedback_parallel_session_git_race` 的隔离思路，但这是运行时锁不是 git）。

`db.rekey` 已存在于 `database-adapter.js:437`（`changePassword` 用过），SQLCipher/`better-sqlite3-multiple-ciphers` 原生支持。

> ⚠️ **rekey 本机（Win dev）无法真机验证**——packaged better-sqlite3-multiple-ciphers + 真实 .encrypted 库。路径 B 落地后**发版前必须真机 smoke**（装旧版建库→升级→确认数据在 + 库已 rekey）。在此之前不得默认开启路径 B。

### 4.4 fail-closed 策略（替换静默明文回退）

当前：SQLCipher 失败 → 静默 sql.js 明文。问题：把"应加密"的库悄悄落明文。

提案（**保守、避免可用性回归**）：
- 仅当**预期加密**（`encryptionEnabled && managed-passphrase 存在或 .encrypted 库存在`）却初始化失败时 → **fail-closed 抛错**，不落明文；UI 提示"数据库无法解密，请联系支持"，绝不静默降级。
- dev / 从未加密过 / 明确 `encryptionEnabled:false` → 保持 sql.js 允许（无回归）。
- 关键：**绝不**在"本该加密"的库上写明文文件。

> 注意：直接把所有 sql.js 回退改成 fail-closed 会让 native 模块缺失的环境**开不了机**——属可用性回归，不可取。必须按"是否预期加密"分流。

### 4.5 U-Key 重新接通（Phase 3，可选）

现状 `forcePassword:true` 让 `deriveKeyFromUKey`（`key-manager.js:105`）永不触发。Windows 真插 U-Key 时应优先硬件派生：bootstrap 检测 U-Key 可用 → 不传 password、传 pin、`forcePassword:false`。需真机 + Win + SIMKey SDK 验证（见 memory `ios_*`/U-Key 限制：仅 Windows，mac/Linux 模拟）。本期不做，仅记 backlog。

## 5. 分阶段落地（按 §1.0 修正后重排）

| Phase | 内容 | 状态 | 风险 | 门禁 |
|---|---|---|---|---|
| 0 | `db-secret-provider.js` + bootstrap 去 `"123456"` | ✅ `01f8b00b2` | 低（生产休眠） | 单测 |
| 1 | opt-in flag + 明文→.encrypted 安全迁移（lock + reopen-verify）+ fail-closed | ✅ **代码 landed，默认 OFF** | **高**（开启时给现存明文库做加密迁移） | **真机 smoke 后才可 flip 默认** |
| 1.5 | flip 默认开启（改 flag 默认或 `isDevelopmentMode`→`app.isPackaged`） | ⬜ 待真机验证 | **高** | 真机 smoke 通过 |
| 2 | 罕见 legacy .encrypted("123456") 库 rekey 到随机口令 | ⬜ | 中 | 真机（需先造 legacy .encrypted 库） |
| 3 | U-Key 重新接通（`forcePassword:true` → `deriveKeyFromUKey`） | ⬜ | 中 | Win + SIMKey 真机 |

### 5.1 Phase 1 已落地内容（默认 OFF）

- `database/db-encryption-flag.js`：`isDbEncryptionOptIn()` 读 `CHAINLESSCHAIN_ENABLE_DB_ENCRYPTION`，**默认 false** → 生产行为零变化。
- `database/encrypted-migration.js`：`migratePlaintextToEncrypted()` 在现有 `DatabaseMigrator`（已含 backup + 行数 verify + 失败保留源库）外再加 **并发锁**（`<target>.migrating.lock`，陈旧锁 10min 回收）+ **重开校验**（用 key 重新打开 .encrypted 跑 `sqlite_master` 查询，证明可解密）。
- `database-adapter.performMigration` 改调上面的安全包装。
- `database.js`：新增 `requireEncryption`（默认 false）。为 true 时：(a) 跳过 dev 明文 Better-SQLite3 分支（否则永远到不了加密适配器）；(b) 加密初始化失败 / 适配器不可用时 **fail-closed 抛错**，绝不回退明文。
- `core-initializer.js`：opt-in 时 `encryptionEnabled=true` + `requireEncryption=true` + Phase 0 托管随机口令。
- 测试：`db-encryption-flag.test.js`(3) + `encrypted-migration.test.js`(5)，含 lock-held/stale-lock/reopen-verify-fail→删可疑库。

### 5.2 真机验证步骤（flip 默认前必跑，真机已可用）

1. 装一个**当前默认版**（明文库），正常用一会儿，产生笔记/会话等数据。
2. 升级到含本 Phase 1 的版本，**设 `CHAINLESSCHAIN_ENABLE_DB_ENCRYPTION=1` 启动**。
3. 验证：(a) 数据完好（笔记/会话条数一致）；(b) 出现 `<userData>/db-secret.enc`；(c) 出现 `chainlesschain.encrypted.db`、原 `chainlesschain.db` 变 `.old`；(d) 用旧 "123456"/空 key 打不开新库。
4. 杀进程/断电模拟中断重启，确认源库未丢、能恢复或重试。
5. 多实例/并行启动，确认锁生效不双写坏库。
6. 通过后再做 Phase 1.5（flip 默认）。

> 原 "Phase 1 仅新库随机零风险" 切片**作废**（§1.0：生产根本没开加密，无效果），降级为已落地的 Phase 0 休眠基建。

## 6. 测试计划

- **单测**（可本机跑）：provider 随机性/幂等/持久/seam；bootstrap 选路（fresh→随机、legacy→按选项、unavailable→fail-closed 分流）；rekey 的 backup/verify/rollback 用 fake db（mock `db.rekey` + 注入校验失败触发回滚）。
- **真机**（发版门禁，Win 不可代）：装 v5.0.3.x（建 "123456" 库）→ 升级到含路径 B 版本 → 验数据完好 + `db-secret.enc` 出现 + 库 key 已换（用旧 key 开应失败）。

## 7. 风险与未决

1. **rekey 中断 → 库损坏**：靠 backup+rollback+文件锁兜底；仍需真机验证回滚路径。
2. **safeStorage 在某些 Linux 桌面不可用**（无 libsecret/kwallet）：4.4 分流避免开不了机；这些环境退回 legacy 行为 + 告警。
3. **多实例/并行 session 同时 rekey**：必须运行时文件锁；否则双写坏库。
4. **托管口令文件丢失/损坏**：用户将无法解库（与忘记主密码同性质）。需考虑导出恢复短语或显式备份提示——**未决，需产品决策**。
5. **env `DEFAULT_PASSWORD` 逃生口**：保留以便支持排障，但文档需警示其削弱安全。

## 8. 不做什么（本设计明确排除）

- 不引入用户输入的主密码 UI（改动太大，另立项）。
- 不改 DID 列级加密（已 land，独立生效，与本设计正交——即便 DB 明文，DID 私钥仍被 safeStorage 保护）。
- 不在公开 docs-site 暴露本文（含攻击面，故置于 `docs/internal/`）。
