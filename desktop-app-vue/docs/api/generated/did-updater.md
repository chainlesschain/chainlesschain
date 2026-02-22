# did-updater

**Source**: `src/main/did/did-updater.js`

**Generated**: 2026-02-22T01:23:36.735Z

---

## const

```javascript
const
```

* DID 自动更新管理器
 *
 * 自动检测并更新DID文档变更
 *
 * 功能:
 * - DID文档版本管理
 * - 自动重新发布
 * - 变更通知机制
 * - 冲突解决

---

## const DEFAULT_CONFIG =

```javascript
const DEFAULT_CONFIG =
```

* DID更新器配置

---

## class DIDUpdater extends EventEmitter

```javascript
class DIDUpdater extends EventEmitter
```

* DID自动更新器类

---

## async initialize()

```javascript
async initialize()
```

* 初始化更新器

---

## async ensureVersionHistoryTable()

```javascript
async ensureVersionHistoryTable()
```

* 确保版本历史表存在

---

## startAutoUpdate(did)

```javascript
startAutoUpdate(did)
```

* 启动自动更新
   * @param {string} did - DID标识符

---

## stopAutoUpdate(did)

```javascript
stopAutoUpdate(did)
```

* 停止自动更新
   * @param {string} did - DID标识符

---

## startAutoRepublish(did)

```javascript
startAutoRepublish(did)
```

* 启动自动重新发布
   * @param {string} did - DID标识符

---

## stopAutoRepublish(did)

```javascript
stopAutoRepublish(did)
```

* 停止自动重新发布
   * @param {string} did - DID标识符

---

## async checkAndUpdate(did)

```javascript
async checkAndUpdate(did)
```

* 检查并更新DID
   * @param {string} did - DID标识符

---

## needsUpdate(localDoc, remoteDoc)

```javascript
needsUpdate(localDoc, remoteDoc)
```

* 判断是否需要更新
   * @param {Object} localDoc - 本地DID文档
   * @param {Object} remoteDoc - 远程DID文档
   * @returns {boolean} 是否需要更新

---

## detectChanges(oldDoc, newDoc)

```javascript
detectChanges(oldDoc, newDoc)
```

* 检测变更
   * @param {Object} oldDoc - 旧文档
   * @param {Object} newDoc - 新文档
   * @returns {Array} 变更列表

---

## async updateLocalDID(did, newDoc, remoteDID)

```javascript
async updateLocalDID(did, newDoc, remoteDID)
```

* 更新本地DID
   * @param {string} did - DID标识符
   * @param {Object} newDoc - 新DID文档
   * @param {Object} remoteDID - 远程DID数据

---

## async saveVersionHistory(did, document)

```javascript
async saveVersionHistory(did, document)
```

* 保存版本历史
   * @param {string} did - DID标识符
   * @param {Object} document - DID文档

---

## async cleanupVersionHistory(did)

```javascript
async cleanupVersionHistory(did)
```

* 清理旧版本历史
   * @param {string} did - DID标识符

---

## getVersionHistory(did)

```javascript
getVersionHistory(did)
```

* 获取版本历史
   * @param {string} did - DID标识符
   * @returns {Array} 版本历史列表

---

## async republish(did)

```javascript
async republish(did)
```

* 重新发布DID到DHT
   * @param {string} did - DID标识符

---

## async incrementVersion(did, changes = "Updated")

```javascript
async incrementVersion(did, changes = "Updated")
```

* 增加DID文档版本号
   * @param {string} did - DID标识符
   * @param {string} changes - 变更说明

---

## async destroy()

```javascript
async destroy()
```

* 销毁更新器

---

