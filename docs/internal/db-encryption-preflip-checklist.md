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
- [ ] **L2 真 SQLCipher 集成**（`npm run test:db-encryption-native`，Electron-as-Node，**非 CI**）——当前 **6 passed**：
  - G1 明文→.encrypted 迁移**数据逐字段一致**（中文/emoji/NULL/BLOB/TEXT-number）
  - G2 legacy("123456")→managed rekey **真换 key**（新开 / 旧败）
  - G3 fail-closed：不可解密目标**抛错 + 删除**（绝不静默落明文）
  - G5a/G5b 崩溃恢复（drop-stale-backup / restored-legacy，真文件）
  - G6 并发锁跳过第二次迁移

> ⚠️ L2 必须用 **Electron-as-Node（bs3mc ABI 140）** 跑，cwd 必须 `desktop-app-vue/`（sql.js WASM 相对 cwd 定位）。plain Node/vitest 加载不了 bs3mc，故 L2 **不进 CI gate**——翻 gate 前**手动跑一次并贴结果**。

## B. 真机门禁（**Win 不可代**，翻 gate 前必过）

- [ ] 按 `docs/internal/db-encryption-phase1-realdevice-smoke.md` 全部场景逐项签核：
  - [ ] 装当前默认版（明文库）→ 产生笔记/会话数据
  - [ ] 升级到本版 + `CHAINLESSCHAIN_ENABLE_DB_ENCRYPTION=1` 启动
  - [ ] 数据完好（条数一致）+ 出现 `db-secret.enc` + `chainlesschain.encrypted.db`、原库变 `.old`
  - [ ] 旧 "123456"/空 key 打不开新库
  - [ ] 杀进程/断电模拟中断重启：源库未丢、能恢复或重试
  - [ ] 多实例并行启动：锁生效不双写坏库

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
| A. L1+L3 单测 | `npm run test:db-encryption-unit` | ____ passed | |
| A. L2 真 SQLCipher | `npm run test:db-encryption-native` | ____ passed | |
| B. 真机 smoke | realdevice-smoke.md | 全场景 ✅ | |
| C. kill-switch + fail-closed | env `=0` + 真机 | ✅ | |
| D. 翻 gate + 改断言 | db-encryption-flag.js / .test.js | merged | |

> 任一项未签核，`PHASE_1_5_DEFAULT_ON` 保持 `false`。
