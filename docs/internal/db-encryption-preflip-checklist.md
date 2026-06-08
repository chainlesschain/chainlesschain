# DB 加密 gate-flip 前置检查清单（pre-release / pre-flip）

> 用途：在把 `desktop-app-vue/src/main/database/db-encryption-flag.js` 的
> `PHASE_1_5_DEFAULT_ON` 从 `false` 改成 `true`（=打包版默认开启 DB 加密 + 给现存
> 明文库做"明文→.encrypted"迁移）**之前**，逐项跑完并签核。
>
> 背景：翻 gate 的那一刻，**所有现存生产用户的明文库首次进入加密迁移路径**——有
> 数据丢失风险的单点。设计见 `db-master-key-hardening-design.md`，测试分层见
> `db-encryption-migration-test-plan.md`，真机步骤见 `db-encryption-phase1-realdevice-smoke.md`。

**要改的那一行**：`db-encryption-flag.js` 内 `const PHASE_1_5_DEFAULT_ON = false;`（保持 false 直到本清单全绿 + 签核）。

---

## A. 自动化门禁（本机即可，**必须全绿**）

一条命令跑齐 L1+L3+L2：

```bash
cd desktop-app-vue
npm run test:db-encryption
```

它依次跑：

- [ ] **L1 + L3 单测**（`npm run test:db-encryption-unit`，普通 vitest / CI）——当前 **45 passed**：
  - `db-secret-provider.test.js`(7) safeStorage 托管口令随机性/幂等/持久/seam
  - `db-encryption-flag.test.js`(7) gate 三态（env 强开/强关 + `PHASE_1_5_DEFAULT_ON`×packaged），含**断言 shipped gate 仍 false**
  - `encrypted-migration.test.js`(5) 并发锁 / 陈旧锁 / 重开校验失败→删可疑库（fake fs）
  - `legacy-rekey.test.js`(11) rekey 保留备份 / 回滚 / 编排提交顺序 / 恢复三分支（fake fs）
  - `core-initializer-db-password.test.js`(8) **resolveDbPassword 选路矩阵**：legacy-no-safestorage / managed / legacy-pending-rekey / managed-new / legacy-error + env override + post-rekey + factory seam
  - `core-initializer-rekey.test.js`(8) **maybeRunLegacyRekey 选路**：gate-off×2 / no-encrypted-db / recover-then-skip(already-managed | unavailable) / recover-BEFORE-rekey 顺序 / env override / 异常吞掉保持 legacy
- [ ] **L2 真 SQLCipher 集成**（`npm run test:db-encryption-native`，Electron-as-Node，**非 CI**）——当前 **7 passed**：
  - G1 明文→.encrypted 迁移**数据逐字段一致**（中文/emoji/NULL/BLOB/TEXT-number）
  - G2 legacy("123456")→managed rekey **真换 key**（新开 / 旧败）
  - G3 fail-closed：不可解密目标**抛错 + 删除**（绝不静默落明文）
  - G5a/G5b 崩溃恢复（drop-stale-backup / restored-legacy，真文件）
  - G6 并发锁跳过第二次迁移（同进程预占锁）
  - G7 **真·双进程并发**：spawn 两个 Electron-as-Node 子进程同时迁移同一库 → 恰好一个真迁移、无双写/损坏、锁清理

> ⚠️ L2 必须用 **Electron-as-Node（bs3mc ABI 140）** 跑，cwd 必须 `desktop-app-vue/`（sql.js WASM 相对 cwd 定位）。plain Node/vitest 加载不了 bs3mc，故 L2 **不进 CI gate**——翻 gate 前**手动跑一次并贴结果**。

## B. 真机门禁（**Win 不可代**，翻 gate 前必过）

### B.1 半自动 real-safeStorage 探针（已自动化，本机即可，**必须全绿**）

```bash
cd desktop-app-vue
npm run test:db-encryption-realstore   # 真 Electron 主进程（非 RUN_AS_NODE）+ 真 DPAPI/Keychain
```

它在**真 OS keychain** 上跑（L2 用内存 provider 替身，碰不到 keychain），当前 **6 passed**：

- [ ] R0 真 keychain 可用（`safeStorage.isEncryptionAvailable()===true`）
- [ ] R1 首启 mint + safeStorage 加密落盘 `db-secret.enc`
- [ ] R2 `db-secret.enc` 是真密文（口令明文不出现在文件内）
- [ ] R3 二次启动用真 DPAPI 解出**同一**托管口令（managed 复用，不重 mint）
- [ ] R4 **端到端**：keychain 口令 → 真 KeyManager PBKDF2 → 真明文→加密迁移 → 重开数据逐字段一致（中文/emoji/NULL/BLOB/TEXT-number）+ 错误 key 被拒（§3 的真实一半）
- [ ] R5 kill-switch + gate 三态（env=0 压过开 gate；shipped 默认 OFF；开 gate×packaged→ON）

> 这一项把清单 §2「managed-new key 驱动真迁移」、§3「旧/错 key 打不开」的真实一半、§7 kill-switch 全自动覆盖。**剩下只有两件真·人工 GUI 项**（B.2）。

### B.2 真·人工 GUI smoke（探针无法替代，仍须人工跑）

**照着跑**：`docs/internal/db-encryption-b2-powershell-runbook.md`（PowerShell 步骤单，含重置/启动/日志 grep/判据，已剔除 A 层+B.1 覆盖项）。底层场景出处见 `db-encryption-phase1-realdevice-smoke.md`。B.1 全绿后只剩这两条**真实用户路径**需人工签核：

- [ ] **装旧版 → 升级**：先装当前默认版产生明文库 + ≥3 条笔记/会话数据 → 升级到本版 + `CHAINLESSCHAIN_ENABLE_DB_ENCRYPTION=1` 启动 → 真 `<userData>` 目录内数据完好（条数一致）、出现 `db-secret.enc`/`chainlesschain.encrypted.db`、原库变 `.old`。（探针用临时 fixture 库，验不了真实安装升级路径）
- [ ] **真断电/强杀中断**：迁移进行中物理断电/强杀进程，重启后源库或 `.old`/`.backup.<ts>` 仍在、可恢复重试、无 `*.migrating.lock` 残留、无数据丢失。（探针不做真断电；崩溃恢复的逻辑分支已由 L2 G5a/G5b 证过）

## C. 回滚预案（翻 gate 后若线上告警）

- [ ] 确认 kill-switch 可用：设 `CHAINLESSCHAIN_ENABLE_DB_ENCRYPTION=0` 强制关停（L3 `db-encryption-flag.test.js` 已验该三态；真机再确认一次）。
- [ ] 确认 fail-closed 行为：迁移失败时 app 提示"无法解密"而非静默明文（L2 G3 + 真机 smoke 已验）。

## D. 翻 gate（A+B+C 全签核后）

- [ ] 改一行：`PHASE_1_5_DEFAULT_ON = false` → `true`（需 code review）。
- [ ] 同步改 `db-encryption-flag.test.js` 里 `shipped gate 仍 false` 的断言（`toBe(false)` → 新预期），否则该回归锁会红。
- [ ] 打包构建验证：packaged 默认开、dev/test 仍明文、`=0` 仍可紧急关停。

---

## 签核

| 项 | 命令 / 文档 | 结果 | 签核人 / 日期 |
|---|---|---|---|
| A. L1+L3 单测 | `npm run test:db-encryption-unit` | **45 passed** | longfa 本机自动跑 2026-06-08 |
| A. L2 真 SQLCipher | `npm run test:db-encryption-native` | **7 passed** | longfa 本机自动跑 2026-06-08 |
| B.1 real-safeStorage 探针 | `npm run test:db-encryption-realstore` | **6 passed** | longfa 本机真 DPAPI 2026-06-08 |
| B.2 人工 GUI smoke（装旧版→升级 + 真断电） | realdevice-smoke.md / b2-powershell-runbook.md | ✅ 2 场景真机通过 | longfa 真机 2026-06-08 |
| C. kill-switch + fail-closed | env `=0` + 真机 | ✅ L3/L2 + 真机确认 | longfa 2026-06-08 |
| D. 翻 gate + 改断言 | db-encryption-flag.js / .test.js | ✅ flipped → true + 断言同步改 | longfa 2026-06-08 |

> 任一项未签核，`PHASE_1_5_DEFAULT_ON` 保持 `false`。
>
> **2026-06-08 — gate 已翻 ✅**：A 自动化层（L1+L3 45 + L2 7 + B.1 6 = 58）本机全绿，
> B.2 两条真·人工 GUI 场景（装旧版→升级迁移、真断电中断）真机签核通过，C 回滚兜底
> （kill-switch + fail-closed）确认。`PHASE_1_5_DEFAULT_ON` 已 `false → true`，同步改
> `db-encryption-flag.test.js` shipped-gate 断言（`toBe(true)`）+ B.1 探针 R5 消息。
> **打包生产现默认开 DB 加密 + 首次明文→.encrypted 迁移**；dev/test 仍明文；
> 紧急关停 `CHAINLESSCHAIN_ENABLE_DB_ENCRYPTION=0`。
