# social-initializer

**Source**: `src\main\bootstrap\social-initializer.js`

**Generated**: 2026-01-27T06:44:03.869Z

---

## const path = require("path");

```javascript
const path = require("path");
```

* 社交模块初始化器
 * 负责 DID、P2P、联系人、好友、组织等社交功能的初始化
 *
 * @module bootstrap/social-initializer

---

## function registerSocialInitializers(factory)

```javascript
function registerSocialInitializers(factory)
```

* 注册社交模块初始化器
 * @param {import('./initializer-factory').InitializerFactory} factory - 初始化器工厂

---

## async function setupP2PPostInit(

```javascript
async function setupP2PPostInit(
```

* 设置 P2P 后台初始化完成后的回调
 * @param {Object} context - 包含所有初始化实例的上下文
 * @param {Function} setupEncryptionEvents - 设置加密消息事件的回调
 * @param {Function} initializeMobileBridge - 初始化移动端桥接的回调

---

