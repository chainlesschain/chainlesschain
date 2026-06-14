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

### 4.5 U-Key 重新接通（Phase 3，gated，2026-06-08 定方案 B）

**死因（实测 HEAD 250755268）**：`database-adapter.js:233` `forcePassword: effectivePassword ? true : false`，而 `core-initializer` 经 `resolveDbPassword()` **永远传一个 dbPassword**（managed 随机口令或 legacy）→ `effectivePassword` 恒真 → `forcePassword=true` → `key-manager.js:201` `if (!options.forcePassword && this.hasUKey())` 永远短路 → `deriveKeyFromUKey`（:105）即使插着已解锁 U-Key 也不触发。`hasUKey()`(:96) / `deriveKeyFromUKey(pin)`(:105) / `getOrCreateKey`(:183) U-Key 分支全是**现成可用的死代码**。

**两种威胁模型（2026-06-08 评估）**：

| | 方案 A：U-Key 直接派生 DB key | 方案 B：U-Key 包裹 managed 口令（**选定**） |
|---|---|---|
| DB key 来源 | `deriveKeyFromUKey(pin)` 的硬件派生值 | 稳定的 managed 随机口令（不变） |
| U-Key 角色 | DB 主 key 本身 | 加密「口令存储」的因子（替代/叠加 safeStorage） |
| 插拔/换 key | **每次都要 rekey 整库**（复用 Phase 2 `legacy-rekey.js`，反复触发迁移风险窗口） | **不需 rekey**（DB key 不变，只换口令的包裹层） |
| 丢 U-Key | **数据永久锁死，不可恢复** | 默认走 safeStorage escrow 副本恢复（dual-escrow）；hardware-only 模式下 fail-closed |
| 适配个人第二大脑 | ❌ 数据丢失灾难性 | ✅ 可用性优先，迁移面近零 |

**选定方案 B + 默认 dual-escrow + 可选 hardware-only**：
- **默认 dual-escrow**：managed 口令同时被 (a) safeStorage(DPAPI) 与 (b) U-Key 各包裹一份落盘。开机优先用 U-Key 解包；U-Key 不在 → 回退 safeStorage 副本。无锁死风险。
- **opt-in `hardware-only`**：仅 U-Key 包裹 + 强制导出一次性备份码（口令的离线 escrow），不写 safeStorage 副本。丢 U-Key 且无备份码 = 锁死（用户显式接受）。兑现"硬件级安全"话术。
- **诚实标注**：dual-escrow 下口令仍可经 OS keychain 恢复，故"纯硬件安全"只对 hardware-only 用户成立；UI/文档须如实说明，不得对默认用户宣称纯硬件不可绕过。

**接线点（实现时）**：
1. `db-secret-provider.js`：`getOrCreateManagedPassphrase()` 旁加 U-Key 包裹层——`wrapWithUKey(passphrase)` / `unwrapWithUKey()`，复用 `key-manager.js` 的 `ukeyManager.encrypt/decrypt`（已存在，:121）。落盘格 `db-secret-ukey.enc`，与 `db-secret.enc`（safeStorage）并存（dual-escrow）。
2. `core-initializer.js:resolveDbPassword`：provider 选口令源时，若 `hasUKey()` 优先 `unwrapWithUKey()`，失败回退 safeStorage（dual）或 fail-closed（hardware-only），返回的仍是同一 managed 口令字符串 → **下游 DatabaseManager / database-adapter 完全不变**（关键：避免改 `forcePassword` 那条 DB key 派生路径，绕开 rekey 风险）。
3. `pin` 来源链待补：`database-adapter.this.pin` → 谁注入？默认 PIN `123456` 来自 SIMKey SDK（见 `.claude/rules/desktop-dev.md` U-Key 段）。需在 bootstrap 接 U-Key unlock 流（PIN 输入 UI 或配置）。
4. flag gate：新 `CHAINLESSCHAIN_ENABLE_UKEY_WRAP`（默认 OFF）+ 子模式 `UKEY_HARDWARE_ONLY`（默认 OFF）。跟 Phase 1.5 同款三态，真机签核前不翻默认。

**关键设计取舍**：方案 B 刻意**不碰** `database-adapter.js:233` 的 `forcePassword` 与 `deriveKeyFromUKey` 直接派生路径——让 U-Key 作用在「口令存储的包裹」而非「DB key 派生」，DB key 始终是稳定 managed 口令，从而 U-Key 状态变化不触发整库 rekey。原 §4.5 草案假设的方案 A（改 forcePassword=false 直接派生）已否决。

**验证**：纯逻辑层（provider 包裹/解包、选路、fail-closed、dual-escrow 回退）可单测，Win 即可写。U-Key 真硬件 encrypt/decrypt + PIN unlock + 拔 key 回退 E2E 需 Win + SIMKey 真机（mac/Linux 仅模拟，见 U-Key 限制）。

**已落地（2026-06-08）**：provider 包裹层 `9da5bb5c7`（`db-secret-provider.js` 追加 wrap/unwrap/backup/resolvePassphrase + `createUKeyEscrowAdapter`，27 测试）+ bootstrap 路由 `d98a057fd`（`core-initializer.js resolveDbPasswordWithEscrow` + `buildUKeyAdapter` seam，10 测试）。两者 gated OFF（`PHASE_3_UKEY_DEFAULT_ON=false`），生产零变化。**剩余全部 device/UI/硬件耦合**，见 §4.6。

### 4.6 Phase 3 后续设计（PIN 解锁流 + 备份码 UI + 真适配器，需真机验证）

> 以下为**设计**，不含未验证代码。延续 Phase 0/1/2 "先设计后真机落地" 模式。四块对应 §4.5「剩余」①②③④。

**A. 真 U-Key 适配器修正（`buildUKeyAdapter` 实装，对应①）**

已 ship 的 `createUKeyEscrowAdapter` 假设 `ukeyManager.encrypt(buf)` 返回**裸 Buffer**——**实际不然**（`ukey-manager.js:360-401`）：encrypt/decrypt 返回 `{success, reason, message}` 结果对象，且前置要求 `isDeviceUnlocked()` 为真（即先 `unlock(pin)`，否则返回 `{success:false, reason:"device_locked"}`）。实装时适配器必须：

1. 持有一个**已解锁**的 `ukeyManager`（解锁见 B），或在 wrap/unwrap 内确保 unlock；
2. **解包 result 对象**：`success:false` → `throw`（让 dual-escrow 回退 safeStorage / hardware-only fail-closed 正确生效）；`success:true` → 取其密文/明文字段；
3. 密文落 `db-secret-ukey.enc`，unwrap 还原。

⚠️ 这是对已 ship adapter 的**已知修正点**——当前 `wrap: async (buf) => Buffer.from(await ukeyManager.encrypt(buf))` 会把 result 对象误当 Buffer。`buildUKeyAdapter` 目前返回 null（生产安全降级），所以该 bug **尚未在生产暴露**，但真实装前必修。

**B. PIN 解锁流 —— bootstrap 时序约束（核心难点，对应②）**

约束：`resolveDbPasswordWithEscrow` 在 main 进程 DB init **早期**跑，**此时还没创建任何 BrowserWindow**，无法弹 renderer PIN 框。鸡生蛋：app UI 依赖 DB，DB 又依赖 PIN（来自 UI）。三个选项：

| | 方案 | 适用 | 代价 |
|---|---|---|---|
| C1 | **预-DB 解锁窗**：DB init 前先建一个不依赖 DB 的轻量"解锁窗"（类 OS 锁屏），收 PIN → 解锁 U-Key → unwrap 口令 → 再继续 DB init + 主窗 | **推荐 hardware-only** | 启动多一屏 + 需一个 DB-free BrowserWindow |
| C2 | **延迟 DB 到主窗后**：先起主窗（degraded 无 DB），窗内弹 PIN，拿到再开 DB | 不推荐 | 主窗要支持 DB-未就绪态，侵入大 |
| C3 | **SDK 原生 PIN + session 缓存**：用 SIMKey SDK 自带 PIN 弹窗（非 Electron），unlock 后 ukeyManager 整 session 保持 unlocked，口令解出缓存内存 | dual-escrow 退化用 | 依赖 SDK 是否提供原生 PIN UI |

**推荐**：hardware-only 用 **C1**（安全门禁本就该在 DB 打开前）；**dual-escrow 不强制 PIN**——若 U-Key 未解锁/无 PIN，dual 已实现的"回退 safeStorage"直接生效，不阻塞启动（PIN 在 dual 下是锦上添花）。PIN 重试：SIMKey 有**硬件重试计数**（连错锁死卡），解锁窗必须显示剩余次数 + 危险提示。

**C. hardware-only 备份码导出 UI（对应③）**

- **时机**：用户在设置里开启 hardware-only 时，**强制**走一次性导出向导（不可跳过——否则 `resolvePassphrase` 首次设置 `throw "必须提供备份码"`）。
- **流程**：(1) 解释"丢 U-Key 后唯一恢复手段，请离线妥善保管"；(2) 生成/让用户设高熵备份码（provider 要求 ≥6 位，建议更长）；(3) 调 main `exportBackupEscrow` 落 `db-secret-backup.enc`；(4) 显示一次 + 二次抄写校验确认；(5) 之后永不再显示。
- **恢复 UI**：hardware-only 且 U-Key 不在时，解锁窗给"用备份码恢复"入口 → `recoverFromBackupEscrow(code)`，GCM auth 失败 → "备份码错误"。

**D. IPC 面（B/C 共用）**

新增 main handler：`ukey-escrow:setup-hardware-only`（导出向导）/ `ukey-escrow:unlock`（PIN → 解锁 + 返回成功/剩余次数）/ `ukey-escrow:recover-backup`（备份码恢复），经 preload 暴露给解锁窗/设置页。**铁律**：PIN / 备份码**只在 main 内存流转，绝不落 renderer 持久态 / 日志 / IPC echo**。

**真机验证（对应④）**：A 修复后跑真 encrypt/decrypt round-trip；C1 解锁窗在真 SIMKey 上验 PIN→unwrap→DB 开；拔 key 后 dual 回退 safeStorage、hardware-only fail-closed；备份码恢复路径；连错 PIN 触发硬件锁定的 UI 表现。

## 5. 分阶段落地（按 §1.0 修正后重排）

| Phase | 内容 | 状态 | 风险 | 门禁 |
|---|---|---|---|---|
| 0 | `db-secret-provider.js` + bootstrap 去 `"123456"` | ✅ `01f8b00b2` | 低（生产休眠） | 单测 |
| 1 | opt-in flag + 明文→.encrypted 安全迁移（lock + reopen-verify）+ fail-closed | ✅ **代码 landed，默认 OFF** | **高**（开启时给现存明文库做加密迁移） | **真机 smoke 后才可 flip 默认** |
| 1.5 | gated flip：打包生产默认开（`isDbEncryptionOptIn()` opt-in override，非改 config NODE_ENV） | ✅ **代码 landed，gate `PHASE_1_5_DEFAULT_ON=true`（已翻 ON，2026-06-08 实测）** | **高** | 翻前已过真机 smoke + 自动化 58 |
| 2 | 罕见 legacy .encrypted("123456") 库 rekey 到托管随机口令 | ✅ **代码 landed，gate `CHAINLESSCHAIN_ENABLE_DB_REKEY` 默认 OFF** | **高**（in-place re-encrypt） | 真机（需先造 legacy .encrypted 库），见 smoke §Phase 2 |
| 3 | U-Key 包裹 managed 口令（方案 B，**非**直接派生）+ dual-escrow / hardware-only opt-in | 🟡 **provider 层 + bootstrap 路由 landed（`9da5bb5c7`+`d98a057fd`，37 测试，gated OFF）**；剩 PIN 流/备份码 UI/真适配器/真机 E2E（§4.6） | 中（不碰 DB key 派生，迁移面近零） | Win + SIMKey 真机 |
| 3.1 | §4.6 A 真适配器修正 + B PIN 解锁流（C1 预-DB 窗）+ C 备份码 UI + D IPC | ⬜ 设计定（§4.6，2026-06-08） | 中 | Win + SIMKey 真机 |

### 5.1 Phase 1 已落地内容（默认 OFF）

- `database/db-encryption-flag.js`：`isDbEncryptionOptIn()` 读 `CHAINLESSCHAIN_ENABLE_DB_ENCRYPTION`，**默认 false** → 生产行为零变化。
- `database/encrypted-migration.js`：`migratePlaintextToEncrypted()` 在现有 `DatabaseMigrator`（已含 backup + 行数 verify + 失败保留源库）外再加 **并发锁**（`<target>.migrating.lock`，陈旧锁 10min 回收）+ **重开校验**（用 key 重新打开 .encrypted 跑 `sqlite_master` 查询，证明可解密）。
- `database-adapter.performMigration` 改调上面的安全包装。
- `database.js`：新增 `requireEncryption`（默认 false）。为 true 时：(a) 跳过 dev 明文 Better-SQLite3 分支（否则永远到不了加密适配器）；(b) 加密初始化失败 / 适配器不可用时 **fail-closed 抛错**，绝不回退明文。
- `core-initializer.js`：opt-in 时 `encryptionEnabled=true` + `requireEncryption=true` + Phase 0 托管随机口令。
- 测试：`db-encryption-flag.test.js`(3) + `encrypted-migration.test.js`(5)，含 lock-held/stale-lock/reopen-verify-fail→删可疑库。

### 5.2 真机验证步骤（flip 默认前必跑，真机已可用）

> 可勾选清单：`docs/internal/db-encryption-phase1-realdevice-smoke.md`（含精确文件路径、日志锚点、中断/并发/kill-switch/fail-closed 场景 + 翻 gate 签核）。下面是摘要。

1. 装一个**当前默认版**（明文库），正常用一会儿，产生笔记/会话等数据。
2. 升级到含本 Phase 1 的版本，**设 `CHAINLESSCHAIN_ENABLE_DB_ENCRYPTION=1` 启动**。
3. 验证：(a) 数据完好（笔记/会话条数一致）；(b) 出现 `<userData>/db-secret.enc`；(c) 出现 `chainlesschain.encrypted.db`、原 `chainlesschain.db` 变 `.old`；(d) 用旧 "123456"/空 key 打不开新库。
4. 杀进程/断电模拟中断重启，确认源库未丢、能恢复或重试。
5. 多实例/并行启动，确认锁生效不双写坏库。
6. 通过后再做 Phase 1.5（flip 默认）。

### 5.3 Phase 1.5 gated flip（已落地，gate 仍关）

`db-encryption-flag.js` 现在支持三态解析：
- env `CHAINLESSCHAIN_ENABLE_DB_ENCRYPTION=1|true` → 强开；`=0|false` → 强关（kill-switch）。
- 无 env → **gated 默认**：`PHASE_1_5_DEFAULT_ON`（**已翻 `true`，2026-06-08**）为 true 时，打包构建（`app.isPackaged`）默认开、dev/test 默认关。

**翻 gate 已完成（2026-06-08）**：真机 smoke §5.2 + 自动化 58（L1+L3 45 + L2 7 + B.1 6）+ 回滚签核后，`PHASE_1_5_DEFAULT_ON` 已 `false→true`。打包用户默认加密，dev/test 仍明文，`=0` 仍可紧急关停。

测试 `db-encryption-flag.test.js` 已用 opts seam 验证 gate 开/关 × packaged 各组合（翻 gate 时同步把 shipped-gate 断言改成 `true`）。

### 5.4 Phase 2 legacy rekey（已落地，双 gate）

针对**罕见**的、曾手动开过加密的 legacy `.encrypted("123456")` 库，rekey 到 safeStorage 托管随机口令。**双重 gate**：须 `CHAINLESSCHAIN_ENABLE_DB_ENCRYPTION` 开 **且** `CHAINLESSCHAIN_ENABLE_DB_REKEY=1` 才运行；默认全关。

- `database/file-lock.js`：抽出共享 lockfile（`acquireLock/releaseLock/STALE_LOCK_MS`），migration 与 rekey 共用一份实现（encrypted-migration 已重构为引用它，5 测试仍绿）。
- `database/legacy-rekey.js`：
  - `rekeyEncryptedDb()`：lock → backup `.rekey-bak` → 用旧 key 开（校验旧 key）→ `db.rekey(newKey)` in-place → 用新 key 重开校验 → 失败回滚恢复 legacy。**成功时保留备份**交给上层（提交后才删，crash-safe）。
  - `rekeyLegacyDbToManaged()`：mint 托管口令（不落盘）→ 派生 old/new key → rekey → **提交顺序：persist 口令 → save 新 salt → 删备份**。
  - `recoverInterruptedRekey()`：启动时若 `.rekey-bak` 残留：托管 key 能开目标=提交完成→删陈旧备份；否则→恢复 legacy 备份+回退，供下次重试。**rekey 只改加密 key 不改数据，故任何分支都不丢数据。**
- `db-secret-provider.js` 新增 `mintPassphrase()`/`persistPassphrase()`，支持"先 mint 后提交"。
- `core-initializer.maybeRunLegacyRekey()`：双 gate 开时，先 recover 再 rekey（仅当有 .encrypted 且无托管口令）；任何异常吞掉保持 legacy。须在 `resolveDbPassword()` 前 —— 成功后 db-secret.enc 出现，自动走 managed 分支用新 key 开库。
- 测试 `legacy-rekey.test.js`(11)：rekey 成功保留备份 / 旧 key 错回滚 / 重开校验失败回滚 / 锁占用跳过 / 编排提交顺序 / no-salt / no-safestorage / 恢复三分支。

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

## 附录：规范章节补全（v5.0.3.108）

> 为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文细节。

### 1. 概述
见正文头部。本文：DB 主密钥加固设计（去硬编码 "123456" + rekey 迁移 + fail-closed）。

### 2. 核心特性
见正文要点 / 特性 / 范围章节。

### 3. 系统架构
见正文架构 / 设计章节（或项目根 docs/design/ 系统设计主文档）。

### 4. 系统定位
见正文定位 / 背景章节。

### 5. 核心功能
见正文功能 / 内容章节。

### 6. 技术架构
见正文技术 / 实现章节。

### 7. 系统特点
见正文（状态 / 版本 / 特性）。

### 8. 应用场景
见正文应用场景 / 背景。

### 9. 竞品对比
见正文对比 / 借鉴（如有）。

### 10. 配置参考
见正文配置 / 参数 / 环境章节。

### 11. 性能指标
见正文性能 / 指标章节（如有）。

### 12. 测试覆盖
见正文测试 / 验证章节（如有）。

### 13. 安全考虑
见正文安全 / 权限章节（如适用）。

### 14. 故障排除
见正文故障 / 已知限制 / 常见问题章节。

### 15. 关键文件
见正文实现位置 / 关键文件章节。

### 16. 使用示例
见正文命令 / 操作 / API 示例。

### 17. 相关文档
见正文相关链接；项目根 docs/design/ 系统设计主文档与对应模块文档。
