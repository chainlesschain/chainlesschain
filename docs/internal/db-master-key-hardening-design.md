# DB 主密钥加固设计（去硬编码 "123456" + rekey 迁移 + fail-closed）

> 状态：**设计待评审**（未实施）。2026-06-03 由安全审计触发。
> 前置：DID 私钥列级加密已落地（commit `4f9057d0c`，`did/did-keystore.js`），本文复用其 safeStorage 模式。
> 关联 memory：`did_private_key_at_rest_encryption`。

## 1. 问题陈述（root cause）

桌面端 SQLite/SQLCipher 主库的"加密"目前形同虚设：

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
- **兼容矩阵**：

| 场景 | 行为 | 数据丢失风险 |
|---|---|---|
| 全新安装（无 .encrypted） | 随机口令 + 托管 | 无 |
| dev（Better-SQLite3 明文） | 不变（本就无 key） | 无 |
| 已有 .encrypted（legacy "123456"） | **取决于 4.3 选项** | 见下 |
| safeStorage 不可用 | 见 4.4 | — |

### 4.3 已有 legacy 库迁移（rekey）—— 高风险，需真机门禁

两种落地路径，二选一（由发版决策）：

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

## 5. 分阶段落地（建议顺序）

| Phase | 内容 | 风险 | 门禁 |
|---|---|---|---|
| 1 | `db-secret-provider.js` + 单测；bootstrap 接入**路径 A**（仅新库随机）；fail-closed 分流（4.4） | 低（零数据丢失） | 单测绿即可 |
| 2 | 路径 B legacy rekey（backup/verify/rollback + 文件锁） | **高** | 真机 smoke：旧版建库→升级→数据在 + 已 rekey；多实例并发 rekey 不坏库 |
| 3 | U-Key 重新接通 | 中 | Win + SIMKey 真机 |

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
