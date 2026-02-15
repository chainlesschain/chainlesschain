# core-initializer

**Source**: `src/main/bootstrap/core-initializer.js`

**Generated**: 2026-02-15T07:37:13.856Z

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

## function registerCoreInitializers(factory)

```javascript
function registerCoreInitializers(factory)
```

* 注册核心模块初始化器
 * @param {import('./initializer-factory').InitializerFactory} factory - 初始化器工厂

---

