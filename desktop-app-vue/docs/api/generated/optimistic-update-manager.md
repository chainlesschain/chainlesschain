# optimistic-update-manager

**Source**: `src\renderer\utils\optimistic-update-manager.js`

**Generated**: 2026-01-27T06:44:03.896Z

---

## class OptimisticUpdateManager

```javascript
class OptimisticUpdateManager
```

* Optimistic Update Manager
 * 乐观更新管理器 - 提供即时 UI 响应和自动回滚
 *
 * Features:
 * - Instant UI updates before server response
 * - Automatic rollback on failure
 * - Undo/Redo support
 * - Conflict detection and resolution
 * - Offline queue
 * - Batch operations

---

## async update(config)

```javascript
async update(config)
```

* Perform optimistic update
   * @param {Object} config - Update configuration
   * @returns {Promise} Update result

---

## async rollbackUpdate(updateId, customRollback)

```javascript
async rollbackUpdate(updateId, customRollback)
```

* Rollback an update

---

## async undo()

```javascript
async undo()
```

* Undo last update

---

## async redo()

```javascript
async redo()
```

* Redo last undone update

---

## async batchUpdate(updates)

```javascript
async batchUpdate(updates)
```

* Batch optimistic updates

---

## async processOfflineQueue()

```javascript
async processOfflineQueue()
```

* Process offline queue when back online

---

## detectConflict(entity, incomingData)

```javascript
detectConflict(entity, incomingData)
```

* Detect conflicts

---

## createSnapshot(entity)

```javascript
createSnapshot(entity)
```

* Create snapshot

---

## restoreSnapshot(entity, snapshot)

```javascript
restoreSnapshot(entity, snapshot)
```

* Restore snapshot

---

## addToUndoStack(updateMetadata)

```javascript
addToUndoStack(updateMetadata)
```

* Add to undo stack

---

## setupOnlineListener()

```javascript
setupOnlineListener()
```

* Setup online/offline listener

---

## on(event, handler)

```javascript
on(event, handler)
```

* Event system

---

## generateUpdateId()

```javascript
generateUpdateId()
```

* Generate unique update ID

---

## updateAverageResponseTime(newTime)

```javascript
updateAverageResponseTime(newTime)
```

* Update average response time

---

## delay(ms)

```javascript
delay(ms)
```

* Delay utility

---

## getStats()

```javascript
getStats()
```

* Get statistics

---

## clear()

```javascript
clear()
```

* Clear all updates

---

## destroy()

```javascript
destroy()
```

* Destroy

---

## export function getOptimisticUpdateManager(options)

```javascript
export function getOptimisticUpdateManager(options)
```

* Get or create optimistic update manager instance

---

## export async function optimisticUpdate(config)

```javascript
export async function optimisticUpdate(config)
```

* Convenience function: perform optimistic update

---

