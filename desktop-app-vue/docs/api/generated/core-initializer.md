# core-initializer

**Source**: `src/main/bootstrap/core-initializer.js`

---

## const path = require("path");

```javascript
const path = require("path");
```

* 核心模块初始化器
 * 负责数据库、LLM、RAG等核心模块的初始化
 *
 * @module bootstrap/core-initializer

---

## function legacyEncryptedDbExists()

```javascript
function legacyEncryptedDbExists()
```

* 是否已存在 legacy 加密库（曾用 "123456" 开过加密的 .encrypted 库）。
 * 用同 database-adapter.getEncryptedDbPath 的派生规则：<base>.encrypted<ext>。
 * @returns {boolean}

---

## function resolveDbPassword(deps =

```javascript
function resolveDbPassword(deps =
```

* 解析 DB 加密口令来源（Phase 0：去硬编码 "123456"）。
 *
 * 优先 safeStorage 托管的随机口令；不可用 / 已有 legacy 库 / 出错时退回 legacy
 * 口令（不更弱）。仅在加密启用时调用 —— 自 Phase 1.5（db-encryption-flag.js
 * `PHASE_1_5_DEFAULT_ON=true`）起，打包生产默认开启加密，故本逻辑在生产里**生效**：
 * safeStorage 可用（Windows DPAPI 一向可用）→ 返回 managed 随机口令；仅在 safeStorage
 * 不可用 / 已有 legacy 库 / provider 出错时才退回 legacy "123456"。kill-switch=0 可关停。
 *
 * @returns {{ password: string, source: string }}

---

## function buildUKeyAdapter(deps =

```javascript
function buildUKeyAdapter(deps =
```

* Build the U-Key escrow seam for the provider. Injected in tests via deps.uKey.
 *
 * In production the real adapter must be constructed from a U-Key/SIMKey driver
 * (`createUKeyEscrowAdapter` over a UKeyManager). That construction is Windows +
 * SIMKey hardware-coupled and only verifiable on a real device, so it is
 * intentionally NOT wired here yet — this returns null by default. With a null
 * seam the gated escrow path degrades SAFELY: dual-escrow falls back to the
 * safeStorage-managed passphrase, hardware-only fails closed. See design §4.5
 * (deferred items) and memory did_private_key_at_rest_encryption.
 *
 * @param {Object} deps
 * @returns {object|null} uKey seam, or null when unavailable.

---

## async function resolveDbPasswordWithEscrow(deps =

```javascript
async function resolveDbPasswordWithEscrow(deps =
```

* Phase 3 (gated): resolve the DB passphrase honoring the U-Key escrow mode.
 *
 * - safestorage-only (default / gate OFF) → byte-for-byte the existing
 *   resolveDbPassword() path. Zero behavior change in production.
 * - dual-escrow → prefer the U-Key-wrapped copy, fall back to the safeStorage
 *   managed passphrase (same key, no lockout). The outer guard only catches the
 *   case where safeStorage is ALSO unavailable.
 * - hardware-only → U-Key (+ backup code) only, FAIL-CLOSED: no safeStorage
 *   fallback. A throw leaves the DB closed (init is required:false → degraded),
 *   which is the intended hardware-gating behavior.
 *
 * The returned passphrase is the SAME managed passphrase across modes, so the
 * downstream DB key derivation never changes and no full-DB rekey is triggered.
 *
 * @param {Object} [deps] - seams (escrowMode, uKey, provider, backupCode,
 *   createDbSecretProvider, userDataPath); with deps={} this is production.
 * @returns {Promise<{password: string, source: string}>}

---

## async function maybeRunLegacyRekey(deps =

```javascript
async function maybeRunLegacyRekey(deps =
```

* Phase 2（默认 OFF，gated）：把 legacy `.encrypted("123456")` 库 rekey 到 safeStorage
 * 托管随机口令。仅当加密 opt-in **且** rekey opt-in 时运行；先做中断恢复，再在确有
 * legacy 库且尚无托管口令时执行 rekey。任何异常都吞掉并保持 legacy（不阻塞启动）。
 * 成功后会写出 db-secret.enc → 随后的 resolveDbPassword() 走 managed 分支用新 key 开库。

---

## function registerCoreInitializers(factory)

```javascript
function registerCoreInitializers(factory)
```

* 注册核心模块初始化器
 * @param {import('./initializer-factory').InitializerFactory} factory - 初始化器工厂

---

