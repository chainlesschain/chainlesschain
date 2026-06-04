# DB 加密迁移 —— 测试计划（翻 `PHASE_1_5_DEFAULT_ON` 前的验证矩阵）

> 状态：**待执行**。2026-06-04 起草，配合 `db-master-key-hardening-design.md`（Phase 0/1/1.5/2 代码已 landed，gate 默认全关）。
> 关联：`docs/internal/db-master-key-hardening-design.md`（设计）、`docs/internal/db-encryption-phase1-realdevice-smoke.md`（真机门禁清单）。
> 关联 memory：`did_private_key_at_rest_encryption`、`bs3mc_bs3_abi_dual_load_adapter`、`bs3mc_electron_abi_sandbox_workaround`、`feedback_sqlite_wasm_fallback`、`better_sqlite3_text_number_trap`。

## 0. 目标与非目标

**目标**：在把 `db-encryption-flag.js` 的 `PHASE_1_5_DEFAULT_ON` 从 `false` 翻成 `true`（=打包版默认开启 DB 加密 + 给现存明文库做"明文→.encrypted"迁移）之前，把"自动化能覆盖的部分"全部覆盖，**最大限度缩小只能靠真机 smoke 兜底的面积**。

**核心风险（来自设计 §1.0 / §4.3）**：翻 gate 的那一刻，**所有现存生产用户的明文 `chainlesschain.db` 会首次进入加密路径 → 触发有数据丢失风险的迁移**。这是必须在发版前钉死的单点。

**非目标**：不在本计划内引入用户主密码 UI（设计 §8 已排除）；不改 DID 列级加密；不重新接通 U-Key（Phase 3 backlog）。

## 1. 当前覆盖盘点（已 landed，全部 fake-fs + fake-cipher 单测）

| 模块 | 测试文件 | 用例数 | 覆盖内容 | 层级 |
|---|---|---|---|---|
| Phase 0 口令托管 | `db-secret-provider.test.js` | 7 | 随机性/幂等/持久/safeStorage 不可用分流/seam | L1 单测 |
| Phase 1.5 gate 解析 | `db-encryption-flag.test.js` | 7 | env 强开/强关 × packaged × gated 默认；断言 shipped gate 仍 false | L1 单测 |
| Phase 1 明文→加密迁移 | `encrypted-migration.test.js` | 5 | 并发锁 held/stale、重开校验失败→删可疑库 | L1 单测（**fake fs**） |
| Phase 2 legacy rekey | `legacy-rekey.test.js` | 11 | rekey 保留备份 / 旧 key 错回滚 / 重开校验失败回滚 / 锁占用跳过 / 编排提交顺序 / no-salt / no-safestorage / 恢复三分支 | L1 单测（**fake fs + fake `db.rekey`**） |

**盘点结论**：逻辑分支覆盖**好**（30 用例，含锁、回滚、提交顺序、崩溃恢复三分支）。但**全部跑在内存 fake fs + 假 SQLCipher 之上** —— `makeDbFactory` 用一个 `{key}` 字段模拟"密钥匹配"，`db.rekey` 只是改个字符串。**没有任何一个测试碰过真实的 `better-sqlite3-multiple-ciphers`**，因此以下命题**至今 0 自动化证据**：

- 真·明文 `better-sqlite3` 库 →`migratePlaintextToEncrypted`→ 真·SQLCipher `.encrypted` 库，**数据逐表逐行一致**。
- 真·`.encrypted("123456")` 库 → 真·`db.rekey(newKey)` → **新 key 能开、旧 key 必败**。
- fail-closed：一个**真·不可解密**的 `.encrypted` 库，初始化**确实抛错而非静默落明文**。
- `core-initializer.resolveDbPassword()` + `maybeRunLegacyRekey()` 的**端到端选路**在真文件上正确（fresh→managed / 明文→迁移 / legacy→rekey / unavailable→fail-closed）。

## 2. 缺口分析（按风险排序）

| # | 缺口 | 现状 | 风险 | 能否本机（Win）自动化 |
|---|---|---|---|---|
| G1 | 真 SQLCipher 迁移数据一致性（明文→.encrypted round-trip） | 仅 fake fs | **最高**（翻 gate 直接命中） | **能**，需建 bs3mc native 集成 harness（见 §4） |
| G2 | 真 `db.rekey` 换 key 语义（新开旧败） | 仅 fake `db.rekey` | 高 | **能**，同 harness |
| G3 | fail-closed 在真不可解密库上抛错 | 仅逻辑分支 | 高（静默落明文是原始最严重缺陷） | **能**，同 harness |
| G4 | `core-initializer` 端到端选路 + gate 联动 | 无集成测试 | 高 | **部分**（safeStorage 需 mock；native DB 需 harness） |
| G5 | 崩溃/断电中断 → `recoverInterruptedRekey` 在**真文件**上恢复 | 仅 fake fs | 中高 | **能**（真文件 + 进程级 kill 模拟） |
| G6 | 多实例并发迁移/rekey 不双写坏库 | 仅"锁 held"单测 | 中 | **能**（真文件锁 + 并发子进程） |
| G7 | better-sqlite3-multiple-ciphers ABI 在目标 Electron 版本可加载 | 已知坑（dual-load） | 中 | **能**，先验（见 §4 前置） |
| G8 | 翻 gate 后真机升级数据完好 | 已有 smoke 清单 | **不可替代** | **否**，仅真机 |

## 3. 分层测试策略

```
L1  fake-fs 逻辑单测        ── 已 landed（30 用例），保留，回归用
L2  真 SQLCipher 集成测试   ── 【新增，本计划核心】关 G1/G2/G3/G5/G6
L3  core-initializer 选路   ── 【新增】关 G4，safeStorage 用注入 mock
L4  真机 smoke（手动门禁）  ── 已有清单，关 G8，翻 gate 前最后一关
```

**关键判断**：L2 把目前"只能靠真机 smoke（G1/G2/G3）"的核心数据安全命题**前移到可在本机 CI 跑的集成测试**。真机 smoke 仍不可省（G8：真实 OS keychain + 真实升级路径），但其"必须靠它才能首次发现的缺陷"面积大幅缩小。

## 4. L2 真 SQLCipher 集成测试（新增，核心交付）

### 4.0 前置（先验，否则后续全卡）
- 确认 `better-sqlite3-multiple-ciphers` 原生模块在当前测试运行时（Node vs Electron ABI）**可加载**。参考 memory `bs3mc_bs3_abi_dual_load_adapter`（dual-load + `:memory:` smoke）与 `bs3mc_electron_abi_sandbox_workaround`（ABI 不匹配时走 sandbox 跑 native）。
- 产出一个最小 harness：`scripts/run-db-encryption-native-tests.sh`（或复用现有 native-test 跑法），保证 CI 之外本机可手动跑；**CI 是否纳入由 ABI 验证结果决定**（若 ABI 与 CI runner 的 Electron 不一致，标记为本机/sandbox-only，并在计划里显式 `log` 说明不进 CI gate —— 不许静默缩水覆盖）。
- safeStorage：L2 不依赖真 keychain，用**注入的 fake safeStorage**（`encryptString`=identity+tag，`isEncryptionAvailable`=true/false 可切），真实性集中在 SQLCipher 一侧。

### 4.1 新测试文件 `__tests__/encrypted-migration.native.test.js`（G1, G3, G6）
> 用真 `createEncryptedDatabase` + 真临时目录（`os.tmpdir()`，禁止落项目根 —— memory `feedback_no_test_artifacts_in_repo_root`）。

1. **明文→加密 round-trip 数据一致**：建真·明文 better-sqlite3 库，写 N 张表、含中文/emoji/NULL/大 BLOB/`TEXT` 存数字（防 `better_sqlite3_text_number_trap`：断言 `String(1)` 不被存成 `"1.0"`）→ `migratePlaintextToEncrypted` → 用托管 key 开 `.encrypted` → **逐表 `count(*)` 与抽样行内容 deep-equal 源库**。
2. **重开校验**：迁移产出后用**错误 key** 开 `.encrypted` → 必抛（证明真加密，非明文改名）。
3. **fail-closed**：构造一个 header 损坏/被截断的 `.encrypted` → 初始化在 `requireEncryption=true` 时**抛错**，且**断言没有任何明文 `.db` / sql.js 文件被写出**（G3，原始最严重缺陷的回归锁）。
4. **并发锁**（G6）：起 2 个子进程同时对同一明文库迁移 → 仅一个成功产出、无双写损坏、`.migrating.lock` 最终清理。
5. **失败保留源**：注入迁移中途失败 → 源明文库**原样保留**、坏 `.encrypted` 被删、有 telemetry/log 锚点。

### 4.2 新测试文件 `__tests__/legacy-rekey.native.test.js`（G2, G5）
1. **真 rekey 换 key**：建 `.encrypted("123456")` 真库 + 真 salt 元数据 → `rekeyLegacyDbToManaged` → **新托管 key 能开、`"123456"` 旧 key 必败**、数据逐行一致（rekey 只换 key 不改数据）。
2. **崩溃恢复 = drop-stale-backup**（G5）：rekey 完整提交后留下 `.rekey-bak` → 重启跑 `recoverInterruptedRekey`（真文件、真 key 校验）→ 删陈旧备份、目标用新 key 正常开。
3. **崩溃恢复 = restored-legacy**（G5）：rekey 到"已 rekey 文件但未 persist 托管口令"的中断态（删掉 db-secret.enc 模拟 step 3 前死）→ 恢复**回滚到 legacy**、`"123456"` 仍能开、可重试。
4. **回滚不丢数据**：rekey 中途强制校验失败 → 源 `.encrypted` 从 `.rekey-bak` 恢复，旧 key 仍开，行数不变。

## 5. L3 core-initializer 选路集成测试（新增，G4）
> `resolveDbPassword()` / `maybeRunLegacyRekey()` 用注入 seam（fake safeStorage + 临时 userData），断言**选了哪条路 + source 标签**，native DB 可用 §4 的真 harness 或在纯选路断言里用 fake。

选路矩阵（断言 `{password 来源, source}`）：

| 场景（磁盘状态） | safeStorage | encryption gate | rekey gate | 期望 source | 期望副作用 |
|---|---|---|---|---|---|
| 全新（无库） | 可用 | on | off | `managed-new` | 生成 db-secret.enc + 随机口令 |
| 已有明文库 | 可用 | on | off | （迁移路径）`managed-new` | 触发明文→.encrypted 迁移 + 备份 |
| 已有 `.encrypted("123456")` | 可用 | on | **on** | rekey 后 `managed` | db-secret.enc 出现、库已换 key |
| 已有 `.encrypted("123456")` | 可用 | on | off | `legacy-pending-rekey` | 不动，沿用 "123456" |
| 任意 | **不可用** | on | * | `legacy-no-safestorage` | **fail-closed 分流**：预期加密却不可用 → 抛错不落明文 |
| 任意 | provider 抛错 | on | * | `legacy-error` | 退回 legacy，不更弱 |
| 任意 | 可用 | **off**（默认） | * | （走旧明文路径） | 生产行为零变化（回归锁） |

额外断言：**`maybeRunLegacyRekey` 必须在 `resolveDbPassword` 之前**（设计 §5.4）；`CHAINLESSCHAIN_ENABLE_DB_ENCRYPTION=0` kill-switch 在任何 gate 下都强关。

## 6. L4 真机 smoke（不可替代，翻 gate 最后一关）
直接复用 `docs/internal/db-encryption-phase1-realdevice-smoke.md` 现有清单（数据完好 / db-secret.enc 出现 / 库改名 / 旧 key 打不开 / 中断重启 / 多实例 / kill-switch / fail-closed 签核）。**本计划不改它**，只把它定位为 L2/L3 全绿之后的终审。

## 7. 退出标准（翻 `PHASE_1_5_DEFAULT_ON=true` 的前置）
全部满足方可改那一行（一行、需评审）：
1. L1 30 用例保持绿（回归）。
2. L2 §4.1+§4.2 全绿（真 SQLCipher 数据一致 + 换 key + fail-closed + 并发 + 崩溃恢复）。
3. L3 §5 选路矩阵全绿，含 kill-switch 与"gate off 零变化"回归锁。
4. L4 真机 smoke 清单逐项签核（Win 不可代，需真桌面）。
5. ABI 前置（§4.0）结论明确：harness 进 CI 或显式标注 sandbox-only 且 `log` 记录覆盖边界（不许静默缩水）。
6. 回滚预案：`CHAINLESSCHAIN_ENABLE_DB_ENCRYPTION=0` kill-switch 经 L3 验证可紧急关停。

## 8. 本机可做 vs 必须真机
- **本机（Win，现在就能做）**：§4 全部 L2、§5 全部 L3（前置过 §4.0 ABI 验证）。这是本计划的可执行交付，**不需要任何设备**。
- **必须真机（Win 不可代）**：§6 L4 —— 真实 OS keychain（DPAPI）+ 真实"装旧版→升级→翻 gate"路径 + 真断电。defer 到下次有真桌面的发版窗口。

## 9. 执行顺序建议
1. §4.0 ABI 前置先验（决定 L2 进不进 CI）。
2. 写 `encrypted-migration.native.test.js`（G1/G3 最高风险先封）。
3. 写 `legacy-rekey.native.test.js`（G2/G5）。
4. 写 core-initializer 选路集成测试（G4）。
5. 全绿后排真机窗口跑 L4，签核 → 评审翻 gate 那一行。

## 10. 状态 (2026-06-04)：L2 已落地，并捕到 2 个真 bug

- **L2 实现**：`src/main/database/__tests__/native/db-encryption.native.js`（单文件覆盖 G1/G2/G3/G5a/G5b/G6，6/6 绿）。命名不带 `.test.`（vitest glob 不收），经 `npm run test:db-encryption-native` 用 **Electron-as-Node（ABI 140）** 跑——**不进 CI gate**（CI runner 是 Node ABI 127，bs3mc 加载不了；覆盖边界显式，不静默缩水）。cwd 必须 `desktop-app-vue/`（sql.js WASM 相对 cwd 定位）。
- **§4.0 ABI 前置结论**：bs3mc prebuilt `.node` = NODE_MODULE_VERSION 140（Electron），plain Node(127) `new Database()` 直接 `ERR_DLOPEN_FAILED`。故走 Electron-as-Node，**不纳入 vitest CI**。
- **L2 当场捕到 2 个真 production bug（fake-fs 单测结构上看不到，因为它们 inject 假 migrator / 假 `db.rekey`）——均已修，由 L2 守住**：
  1. **迁移 verify 永远失败**：`database-migration.js` verifyMigration 把目标行数当数组读 `result[0]`，但 `SQLCipherWrapper.get()` 返回**行对象** `{count:N}` → `[0]`=undefined → `源=3 ≠ 目标=undefined` → 每次真迁移都在 verify 抛错。修：改读 `result.count`。（该行此前**零单测**。）
  2. **rekey 在 WAL 下不可用**：wrapper `open()` 强制 `journal_mode=WAL`，但 SQLCipher 报 *"Rekeying is not supported in WAL journal mode."* → Phase 2 legacy rekey 真机必败。修：`SQLCipherWrapper.rekey()` 先 `journal_mode=DELETE` 再 `PRAGMA rekey`（rekey 后重开会重新 WAL，不持久）。
  - **影响**：两者都在加密 gate 关时休眠，但**翻 `PHASE_1_5_DEFAULT_ON=true` 会直接命中** → 正是本计划要在翻 gate 前堵的洞。
- **L3 已落地（2026-06-04）**：`src/main/bootstrap/__tests__/core-initializer-db-password.test.js`（8/8，普通 vitest CI 测试——纯逻辑，无 electron/native）。覆盖 `resolveDbPassword` 全选路矩阵：legacy-no-safestorage / managed / legacy-pending-rekey / managed-new / legacy-error + DEFAULT_PASSWORD override + post-rekey managed 态 + 默认 provider factory seam。为此给 `core-initializer.resolveDbPassword` 加了**向后兼容的 DI seam**（`deps={}` 时行为与原来逐字节一致），并 export 之——该函数此前**零单测**。gate 三态（env 强开/关 + PHASE_1_5_DEFAULT_ON）仍由 `db-encryption-flag.test.js`(7) 覆盖。
- **`maybeRunLegacyRekey` 端到端选路已落地（2026-06-04）**：`src/main/bootstrap/__tests__/core-initializer-rekey.test.js`（8/8 普通 vitest CI）。给该函数加了向后兼容 DI seam（flags/provider/getAppConfig/fs/KeyManager/deriveKey/loadMetadata/saveMetadata/recover/rekey 均可注入；`deps={}` 行为不变）+ 结构化返回值（caller 忽略）。覆盖：gate-off×2 / no-encrypted-db / recover-then-skip（already-managed | unavailable）/ **recover 必先于 rekey** / env override / 异常吞掉保持 legacy。
- **剩余待补**：§4.1 的真·并发双进程迁移（当前 G6 用"预占锁"确定性验门，未起真子进程）——L2/L3 逻辑层已全覆盖，此为唯一剩余自动化缺口。

### 10.1 翻 gate 前置检查清单（已 wire）
- **一条命令跑 L1+L3+L2**：`npm run test:db-encryption`（= `test:db-encryption-unit` 37 单测 + `test:db-encryption-native` 6 真 SQLCipher）。
- **签核清单**：`docs/internal/db-encryption-preflip-checklist.md`（A 自动化门禁 + B 真机 smoke + C 回滚预案 + D 翻 gate 步骤 + 签核表）。
- **gate 处指针**：`db-encryption-flag.js` 的 `PHASE_1_5_DEFAULT_ON` 常量注释直接指向本清单 + `npm run test:db-encryption`——改那一行的人必看到。
