# session-manager

**Source**: `src/main/browser/actions/session-manager.js`

**Generated**: 2026-02-15T10:10:53.437Z

---

## const

```javascript
const
```

* SessionManager - 浏览器会话管理器
 *
 * 管理浏览器会话状态：
 * - Cookie 管理
 * - LocalStorage/SessionStorage
 * - 会话持久化和恢复
 * - 认证状态跟踪
 *
 * @module browser/actions/session-manager
 * @author ChainlessChain Team
 * @since v0.33.0

---

## const SameSitePolicy =

```javascript
const SameSitePolicy =
```

* Cookie SameSite 策略

---

## const StorageType =

```javascript
const StorageType =
```

* 存储类型

---

## const SessionState =

```javascript
const SessionState =
```

* 会话状态

---

## constructor(browserEngine = null, config =

```javascript
constructor(browserEngine = null, config =
```

* @param {Object} browserEngine - Browser engine instance
   * @param {Object} config - Configuration options

---

## setBrowserEngine(browserEngine)

```javascript
setBrowserEngine(browserEngine)
```

* 设置浏览器引擎
   * @param {Object} browserEngine

---

## async getCookies(targetId, filter =

```javascript
async getCookies(targetId, filter =
```

* 获取所有 Cookies
   * @param {string} targetId - 标签页 ID
   * @param {Object} filter - 过滤条件
   * @returns {Promise<Object>}

---

## async setCookie(targetId, cookie)

```javascript
async setCookie(targetId, cookie)
```

* 设置 Cookie
   * @param {string} targetId - 标签页 ID
   * @param {Object} cookie - Cookie 数据
   * @returns {Promise<Object>}

---

## async deleteCookies(targetId, filter =

```javascript
async deleteCookies(targetId, filter =
```

* 删除 Cookie
   * @param {string} targetId - 标签页 ID
   * @param {Object} filter - 删除条件
   * @returns {Promise<Object>}

---

## async clearAllCookies(targetId)

```javascript
async clearAllCookies(targetId)
```

* 清除所有 Cookies
   * @param {string} targetId - 标签页 ID
   * @returns {Promise<Object>}

---

## async getLocalStorage(targetId, key = null)

```javascript
async getLocalStorage(targetId, key = null)
```

* 获取 LocalStorage
   * @param {string} targetId - 标签页 ID
   * @param {string} key - 可选的键名
   * @returns {Promise<Object>}

---

## async setLocalStorage(targetId, key, value)

```javascript
async setLocalStorage(targetId, key, value)
```

* 设置 LocalStorage
   * @param {string} targetId - 标签页 ID
   * @param {string} key - 键名
   * @param {string} value - 值
   * @returns {Promise<Object>}

---

## async removeLocalStorage(targetId, key = null)

```javascript
async removeLocalStorage(targetId, key = null)
```

* 删除 LocalStorage
   * @param {string} targetId - 标签页 ID
   * @param {string} key - 可选的键名，不传则清除全部
   * @returns {Promise<Object>}

---

## async getSessionStorage(targetId, key = null)

```javascript
async getSessionStorage(targetId, key = null)
```

* 获取 SessionStorage
   * @param {string} targetId - 标签页 ID
   * @param {string} key - 可选的键名
   * @returns {Promise<Object>}

---

## async setSessionStorage(targetId, key, value)

```javascript
async setSessionStorage(targetId, key, value)
```

* 设置 SessionStorage
   * @param {string} targetId - 标签页 ID
   * @param {string} key - 键名
   * @param {string} value - 值
   * @returns {Promise<Object>}

---

## async removeSessionStorage(targetId, key = null)

```javascript
async removeSessionStorage(targetId, key = null)
```

* 删除 SessionStorage
   * @param {string} targetId - 标签页 ID
   * @param {string} key - 可选的键名
   * @returns {Promise<Object>}

---

## async _getStorage(targetId, storageType, key)

```javascript
async _getStorage(targetId, storageType, key)
```

* 通用存储获取
   * @private

---

## async _setStorage(targetId, storageType, key, value)

```javascript
async _setStorage(targetId, storageType, key, value)
```

* 通用存储设置
   * @private

---

## async _removeStorage(targetId, storageType, key)

```javascript
async _removeStorage(targetId, storageType, key)
```

* 通用存储删除
   * @private

---

## async saveSession(targetId, sessionId = null)

```javascript
async saveSession(targetId, sessionId = null)
```

* 保存会话快照
   * @param {string} targetId - 标签页 ID
   * @param {string} sessionId - 会话 ID
   * @returns {Promise<Object>}

---

## async restoreSession(targetId, sessionId)

```javascript
async restoreSession(targetId, sessionId)
```

* 恢复会话
   * @param {string} targetId - 标签页 ID
   * @param {string} sessionId - 会话 ID
   * @returns {Promise<Object>}

---

## deleteSession(sessionId)

```javascript
deleteSession(sessionId)
```

* 删除会话
   * @param {string} sessionId - 会话 ID
   * @returns {Object}

---

## listSessions()

```javascript
listSessions()
```

* 列出所有会话
   * @returns {Array}

---

## async detectAuthState(targetId, indicators =

```javascript
async detectAuthState(targetId, indicators =
```

* 检测认证状态
   * @param {string} targetId - 标签页 ID
   * @param {Object} indicators - 认证指标
   * @returns {Promise<Object>}

---

## getAuthState(targetId)

```javascript
getAuthState(targetId)
```

* 获取认证状态
   * @param {string} targetId - 标签页 ID
   * @returns {Object}

---

## getStats()

```javascript
getStats()
```

* 获取统计
   * @returns {Object}

---

## resetStats()

```javascript
resetStats()
```

* 重置统计

---

## cleanupExpiredSessions(maxAge = 86400000)

```javascript
cleanupExpiredSessions(maxAge = 86400000)
```

* 清理过期会话
   * @param {number} maxAge - 最大年龄（毫秒）
   * @returns {Object}

---

## cleanup()

```javascript
cleanup()
```

* 清理资源

---

