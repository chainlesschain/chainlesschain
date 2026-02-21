# knowledge-sync-manager

**Source**: `src/main/p2p/knowledge-sync-manager.js`

**Generated**: 2026-02-21T20:04:16.228Z

---

## const

```javascript
const
```

* 知识库增量同步管理器
 *
 * 功能：
 * - 变更检测（基于时间戳和版本号）
 * - 增量数据传输
 * - 冲突检测和解决
 * - 同步状态管理
 * - 双向同步支持

---

## async startSync(peerId, options =

```javascript
async startSync(peerId, options =
```

* 开始同步
   * @param {string} peerId - 目标设备ID
   * @param {Object} options - 同步选项

---

## async detectLocalChanges(since)

```javascript
async detectLocalChanges(since)
```

* 检测本地变更

---

## async requestRemoteChanges(peerId, since)

```javascript
async requestRemoteChanges(peerId, since)
```

* 请求远程变更

---

## detectConflicts(localChanges, remoteChanges)

```javascript
detectConflicts(localChanges, remoteChanges)
```

* 检测冲突

---

## analyzeConflict(localChange, remoteChange)

```javascript
analyzeConflict(localChange, remoteChange)
```

* 分析冲突

---

## async resolveConflicts(conflicts)

```javascript
async resolveConflicts(conflicts)
```

* 解决冲突

---

## async mergeChanges(local, remote)

```javascript
async mergeChanges(local, remote)
```

* 合并变更

---

## async applyRemoteChanges(remoteChanges, resolved)

```javascript
async applyRemoteChanges(remoteChanges, resolved)
```

* 应用远程变更

---

## async uploadLocalChanges(peerId, localChanges)

```javascript
async uploadLocalChanges(peerId, localChanges)
```

* 上传本地变更

---

## async handleSyncRequest(peerId, since)

```javascript
async handleSyncRequest(peerId, since)
```

* 处理同步请求（作为服务端）

---

## async handleSyncPush(peerId, changes)

```javascript
async handleSyncPush(peerId, changes)
```

* 处理同步推送（作为客户端）

---

## calculateHash(note)

```javascript
calculateHash(note)
```

* 计算哈希

---

## chunkArray(array, size)

```javascript
chunkArray(array, size)
```

* 分块数组

---

## setupChangeTracking()

```javascript
setupChangeTracking()
```

* 设置变更追踪

---

## startAutoSync()

```javascript
startAutoSync()
```

* 启动自动同步

---

## getConflicts()

```javascript
getConflicts()
```

* 获取冲突列表

---

## async resolveConflictManually(conflictId, resolution)

```javascript
async resolveConflictManually(conflictId, resolution)
```

* 手动解决冲突

---

## getStats()

```javascript
getStats()
```

* 获取统计信息

---

## cleanup()

```javascript
cleanup()
```

* 清理资源

---

