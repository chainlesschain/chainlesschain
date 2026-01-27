# incremental-sync

**Source**: `src\renderer\utils\incremental-sync.js`

**Generated**: 2026-01-27T06:44:03.899Z

---

## class IncrementalSyncManager

```javascript
class IncrementalSyncManager
```

* Incremental Data Sync Manager
 * 增量数据同步管理器 - 只同步变更的数据
 *
 * Features:
 * - Delta synchronization (only changed data)
 * - Conflict detection and resolution
 * - Automatic sync intervals
 * - Offline support with queue
 * - Optimistic updates integration
 * - Real-time sync with WebSocket support

---

## init()

```javascript
init()
```

added to permitAll
      enabled: options.enabled || false,
      syncInterval: options.syncInterval || 30000, // 30 seconds
      enableAutoSync: options.enableAutoSync !== false,
      enableRealtime: options.enableRealtime || false,
      conflictResolution: options.conflictResolution || "server-wins", // 'server-wins', 'client-wins', 'manual'
      debug: options.debug || false,
    };

    // State
    this.lastSyncTime = null;
    this.syncTimer = null;
    this.pendingChanges = new Map(); // entity -> changes
    this.syncQueue = [];
    this.isOnline = navigator.onLine;
    this.isSyncing = false;
    this.websocket = null;
    this.isDestroyed = false;
    this.isReconnecting = false;
    this.reconnectTimer = null;

    // Statistics
    this.stats = {
      totalSyncs: 0,
      successfulSyncs: 0,
      failedSyncs: 0,
      conflictsResolved: 0,
      dataSaved: 0, // bytes saved by incremental sync
    };

    // Initialize
    this.init();

    if (this.options.debug) {
      logger.info("[IncrementalSyncManager] Initialized");
    }
  }

  /**
   * Initialize sync manager

---

## trackChange(entity, operation, data)

```javascript
trackChange(entity, operation, data)
```

* Track a change for synchronization
   * @param {string} entity - Entity identifier (e.g., 'file:123', 'project:456')
   * @param {string} operation - 'create', 'update', 'delete'
   * @param {Object} data - Changed data

---

## async syncNow(options =

```javascript
async syncNow(options =
```

* Sync now (manual trigger)
   * @param {Object} options - Sync options

---

## async sendChanges(changes)

```javascript
async sendChanges(changes)
```

* Send changes to server
   * @param {Array} changes - Array of changes
   * @returns {Promise<Object>} Server response

---

## groupChangesByTable(changes)

```javascript
groupChangesByTable(changes)
```

* Group changes by table name
   * @param {Array} changes - Array of changes
   * @returns {Object} Changes grouped by table

---

## async fetchRemoteChanges()

```javascript
async fetchRemoteChanges()
```

* Fetch remote changes from server
   * @returns {Promise<Array>} Remote changes

---

## async applyRemoteChanges(remoteChanges)

```javascript
async applyRemoteChanges(remoteChanges)
```

* Apply remote changes from server
   * @param {Array} remoteChanges - Changes from server

---

## async resolveConflicts(conflicts)

```javascript
async resolveConflicts(conflicts)
```

* Resolve conflicts
   * @param {Array} conflicts - Array of conflicts

---

## requestManualResolution(conflict)

```javascript
requestManualResolution(conflict)
```

* Request manual conflict resolution from user
   * @param {Object} conflict - Conflict data
   * @returns {Promise<Object>} Resolution

---

## startAutoSync()

```javascript
startAutoSync()
```

* Auto-sync management

---

## startAutoSync()

```javascript
startAutoSync()
```

* Start automatic synchronization

---

## stopAutoSync()

```javascript
stopAutoSync()
```

* Stop automatic synchronization

---

## debouncedSync = (() =>

```javascript
debouncedSync = (() =>
```

* Debounced sync (prevents too frequent syncs)

---

## setupRealtimeSync()

```javascript
setupRealtimeSync()
```

* Real-time sync with WebSocket

---

## setupRealtimeSync()

```javascript
setupRealtimeSync()
```

* Setup WebSocket connection for real-time sync

---

## getWebSocketURL()

```javascript
getWebSocketURL()
```

* Get WebSocket URL

---

## estimateFullDataSize()

```javascript
estimateFullDataSize()
```

* Estimate data size (for statistics)

---

## estimateFullDataSize()

```javascript
estimateFullDataSize()
```

* Estimate full data size

---

## estimateDeltaSize(changes)

```javascript
estimateDeltaSize(changes)
```

* Estimate delta size

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

* Clear all pending changes

---

## destroy()

```javascript
destroy()
```

* Destroy and cleanup

---

## export function getIncrementalSyncManager(options)

```javascript
export function getIncrementalSyncManager(options)
```

* Get or create incremental sync manager instance

---

## export function trackChange(entity, operation, data)

```javascript
export function trackChange(entity, operation, data)
```

* Convenience function: track a change

---

## export async function syncNow(options)

```javascript
export async function syncNow(options)
```

* Convenience function: sync now

---

