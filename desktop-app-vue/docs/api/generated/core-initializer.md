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

## function resolveDbPassword()

```javascript
function resolveDbPassword()
```

* 解析 DB 加密口令来源（Phase 0：去硬编码 "123456"）。
 *
 * 优先 safeStorage 托管的随机口令；不可用 / 已有 legacy 库 / 出错时退回 legacy
 * 口令（不更弱）。仅在加密启用时调用 —— 当前打包生产 encryptionEnabled=false
 * （NODE_ENV 误判，见 docs/internal/db-master-key-hardening-design.md §1.0），
 * 故本逻辑在生产里休眠。
 *
 * @returns {{ password: string, source: string }}

---

## function registerCoreInitializers(factory)

```javascript
function registerCoreInitializers(factory)
```

* 注册核心模块初始化器
 * @param {import('./initializer-factory').InitializerFactory} factory - 初始化器工厂

---

