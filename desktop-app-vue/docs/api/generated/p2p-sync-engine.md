# p2p-sync-engine

**Source**: `src/main/sync/p2p-sync-engine.js`

**Generated**: 2026-02-21T20:04:16.199Z

---

## class P2PSyncEngine extends EventEmitter

```javascript
class P2PSyncEngine extends EventEmitter
```

* P2P 数据同步引擎
 * 负责去中心化组织的数据同步、冲突检测和解决
 *
 * @class P2PSyncEngine

---

## async initialize()

```javascript
async initialize()
```

* 初始化同步引擎
   * @returns {Promise<void>}

---

## setMainWindow(mainWindow)

```javascript
setMainWindow(mainWindow)
```

* 设置主窗口引用
   * @param {BrowserWindow} mainWindow - Electron 主窗口

---

## startAutoSync(orgId)

```javascript
startAutoSync(orgId)
```

* 启动自动同步
   * @param {string} orgId - 组织ID

---

## stopAutoSync()

```javascript
stopAutoSync()
```

* 停止自动同步

---

## async sync(orgId, options =

```javascript
async sync(orgId, options =
```

* 执行同步
   * @param {string} orgId - 组织ID
   * @param {Object} options - 同步选项
   * @returns {Promise<Object>} 同步结果

---

## async getPendingResources(orgId)

```javascript
async getPendingResources(orgId)
```

* 获取待同步的资源
   * @param {string} orgId - 组织ID
   * @returns {Promise<Array>} 待同步资源列表

---

## async requestRemoteChanges(orgId, options =

```javascript
async requestRemoteChanges(orgId, options =
```

* 请求远程变更
   * @param {string} orgId - 组织ID
   * @param {Object} options - 请求选项
   * @returns {Promise<Array>} 远程变更列表

---

## createResponseCollector(requestId, timeout, minResponses)

```javascript
createResponseCollector(requestId, timeout, minResponses)
```

* 创建响应收集器
   * @param {string} requestId - 请求ID
   * @param {number} timeout - 超时时间（毫秒）
   * @param {number} minResponses - 最少响应数量
   * @returns {Object} 收集器对象

---

## aggregateChanges(responses)

```javascript
aggregateChanges(responses)
```

* 聚合多个响应的变更
   * @param {Array} responses - 响应列表
   * @returns {Array} 去重后的变更列表

---

## async applyRemoteChanges(orgId, changes)

```javascript
async applyRemoteChanges(orgId, changes)
```

* 应用远程变更
   * @param {string} orgId - 组织ID
   * @param {Array} changes - 远程变更列表
   * @returns {Promise<Object>} 应用结果

---

## async applyChange(orgId, change)

```javascript
async applyChange(orgId, change)
```

* 应用单个变更
   * @param {string} orgId - 组织ID
   * @param {Object} change - 变更对象
   * @returns {Promise<Object>} 应用结果

---

## async pushLocalChanges(orgId, resources)

```javascript
async pushLocalChanges(orgId, resources)
```

* 推送本地变更
   * @param {string} orgId - 组织ID
   * @param {Array} resources - 待推送资源列表
   * @returns {Promise<number>} 推送数量

---

## detectConflict(localState, remoteState)

```javascript
detectConflict(localState, remoteState)
```

* 检测冲突
   * @param {Object} localState - 本地状态
   * @param {Object} remoteState - 远程状态
   * @returns {Object} 冲突检测结果

---

## async recordConflict(

```javascript
async recordConflict(
```

* 记录冲突
   * @param {string} orgId - 组织ID
   * @param {string} resourceType - 资源类型
   * @param {string} resourceId - 资源ID
   * @param {Object} localState - 本地状态
   * @param {Object} remoteChange - 远程变更
   * @returns {Promise<string>} 冲突记录ID

---

## async resolveConflict(

```javascript
async resolveConflict(
```

* 解决冲突
   * @param {string} orgId - 组织ID
   * @param {string} resourceType - 资源类型
   * @param {string} resourceId - 资源ID
   * @param {Object} localState - 本地状态
   * @param {Object} remoteChange - 远程变更
   * @returns {Promise<boolean>} 是否成功解决

---

## async resolveLWW(orgId, resourceType, resourceId, localState, remoteChange)

```javascript
async resolveLWW(orgId, resourceType, resourceId, localState, remoteChange)
```

* Last-Write-Wins 冲突解决
   * @param {string} orgId - 组织ID
   * @param {string} resourceType - 资源类型
   * @param {string} resourceId - 资源ID
   * @param {Object} localState - 本地状态
   * @param {Object} remoteChange - 远程变更
   * @returns {Promise<boolean>} 是否成功解决

---

## getConflictResolutionStrategy(resourceType)

```javascript
getConflictResolutionStrategy(resourceType)
```

* 获取冲突解决策略
   * @param {string} resourceType - 资源类型
   * @returns {string} 策略名称

---

## getSyncState(orgId, resourceType, resourceId)

```javascript
getSyncState(orgId, resourceType, resourceId)
```

* 获取同步状态
   * @param {string} orgId - 组织ID
   * @param {string} resourceType - 资源类型
   * @param {string} resourceId - 资源ID
   * @returns {Object|null} 同步状态

---

## updateSyncState(orgId, resourceType, resourceId, updates)

```javascript
updateSyncState(orgId, resourceType, resourceId, updates)
```

* 更新同步状态
   * @param {string} orgId - 组织ID
   * @param {string} resourceType - 资源类型
   * @param {string} resourceId - 资源ID
   * @param {Object} updates - 更新字段

---

## async getResourceData(resourceType, resourceId)

```javascript
async getResourceData(resourceType, resourceId)
```

* 获取资源数据
   * @param {string} resourceType - 资源类型
   * @param {string} resourceId - 资源ID
   * @returns {Promise<Object|null>} 资源数据

---

## async applyResourceChange(resourceType, resourceId, action, data)

```javascript
async applyResourceChange(resourceType, resourceId, action, data)
```

* 应用资源变更
   * @param {string} resourceType - 资源类型
   * @param {string} resourceId - 资源ID
   * @param {string} action - 操作类型
   * @param {Object} data - 数据
   * @returns {Promise<void>}

---

## async signMessage(message)

```javascript
async signMessage(message)
```

* 签名消息
   * @param {Object} message - 消息对象
   * @returns {Promise<string>} 签名

---

## async verifyMessage(message)

```javascript
async verifyMessage(message)
```

* 验证消息签名
   * @param {Object} message - 消息对象
   * @returns {Promise<boolean>} 是否有效

---

## async handleSyncRequest(message, senderPeerId = null)

```javascript
async handleSyncRequest(message, senderPeerId = null)
```

* 处理同步请求
   * @param {Object} message - 同步请求消息
   * @param {string} senderPeerId - 发送者的 Peer ID

---

## async handleSyncResponse(message)

```javascript
async handleSyncResponse(message)
```

* 处理同步响应
   * @param {Object} message - 同步响应消息

---

## async handleSyncChange(message)

```javascript
async handleSyncChange(message)
```

* 处理同步变更
   * @param {Object} message - 同步变更消息

---

## async handleSyncConflict(message)

```javascript
async handleSyncConflict(message)
```

* 处理同步冲突
   * @param {Object} message - 同步冲突消息

---

## async getChangesSince(

```javascript
async getChangesSince(
```

* 获取指定时间之后的变更
   * @param {string} orgId - 组织ID
   * @param {number} sinceTime - 起始时间戳
   * @param {Array} resourceTypes - 资源类型列表
   * @returns {Promise<Array>} 变更列表

---

## async processQueue(orgId)

```javascript
async processQueue(orgId)
```

* 处理离线队列
   * @param {string} orgId - 组织ID
   * @returns {Promise<number>} 处理数量

---

## addToQueue(orgId, action, resourceType, resourceId, data)

```javascript
addToQueue(orgId, action, resourceType, resourceId, data)
```

* 添加到离线队列
   * @param {string} orgId - 组织ID
   * @param {string} action - 操作类型
   * @param {string} resourceType - 资源类型
   * @param {string} resourceId - 资源ID
   * @param {Object} data - 数据
   * @returns {string} 队列项ID

---

## getSyncStats(orgId)

```javascript
getSyncStats(orgId)
```

* 获取同步统计
   * @param {string} orgId - 组织ID
   * @returns {Object} 统计信息

---

