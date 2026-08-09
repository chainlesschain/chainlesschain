# social-initializer

**Source**: `src/main/bootstrap/social-initializer.js`

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

## function wireMtcAutoBridge(p2pManager, mtcFederationManager)

```javascript
function wireMtcAutoBridge(p2pManager, mtcFederationManager)
```

* Wire the MTC auto-bridge between Phase A's P2PManager and Phase B's
 * MtcFederationManager. Extracted from the factory closure so it's testable
 * in isolation without bootstrapping the full DI container.
 *
 * Behavior:
 *   - On `p2pManager.on('peer:connected', {peerId})`: send a typed
 *     `mtc:advertise` message back to that peer with our MTC peerId +
 *     multiaddrs (so they can dial our gossipsub node)
 *   - On `p2pManager.on('mtc:peer-advertise', {peerId, multiaddrs})`:
 *     try to dial those multiaddrs via mtcFedMgr.connectPeer (sequentially,
 *     stop on first success, swallow per-addr errors)
 *
 * Both directions are no-ops when mtcFederationManager isn't initialized
 * (graceful degradation to Phase A direct gossip).
 *
 * @param {EventEmitter} p2pManager
 * @param {MtcFederationManager} mtcFederationManager
 * @returns {{ wired: true } | null}

---

