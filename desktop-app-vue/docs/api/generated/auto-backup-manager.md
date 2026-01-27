# auto-backup-manager

**Source**: `src\main\memory\auto-backup-manager.js`

**Generated**: 2026-01-27T06:44:03.842Z

---

## const

```javascript
const
```

* AutoBackupManager - Automatic Backup Management
 *
 * Provides automatic backup functionality for memory system data:
 * - Full and incremental backups
 * - Scheduled backup execution
 * - Backup retention and cleanup
 * - Backup restoration
 *
 * @module auto-backup-manager
 * @version 1.0.0
 * @since 2026-01-18

---

## class AutoBackupManager extends EventEmitter

```javascript
class AutoBackupManager extends EventEmitter
```

* AutoBackupManager class

---

## constructor(options =

```javascript
constructor(options =
```

* Create an AutoBackupManager instance
   * @param {Object} options - Configuration options
   * @param {Object} options.database - SQLite database instance
   * @param {string} options.backupsDir - Directory for backup files
   * @param {Object} [options.configManager] - UnifiedConfigManager instance

---

## async initialize()

```javascript
async initialize()
```

* Initialize the manager

---

## async _ensureTables()

```javascript
async _ensureTables()
```

* Ensure database tables exist
   * @private

---

## async _initializeManifest()

```javascript
async _initializeManifest()
```

* Initialize manifest file
   * @private

---

## _startScheduleChecker()

```javascript
_startScheduleChecker()
```

* Start schedule checker
   * @private

---

## stopScheduleChecker()

```javascript
stopScheduleChecker()
```

* Stop schedule checker

---

## async _checkAndRunSchedules()

```javascript
async _checkAndRunSchedules()
```

* Check and run due schedules
   * @private

---

## _calculateNextRun(schedule)

```javascript
_calculateNextRun(schedule)
```

* Calculate next run time for a schedule
   * @param {Object} schedule - Schedule config
   * @returns {number} Next run timestamp
   * @private

---

## async createFullBackup(scope = "all")

```javascript
async createFullBackup(scope = "all")
```

* Create a full backup
   * @param {string} scope - Backup scope ('patterns', 'preferences', 'sessions', 'all')
   * @returns {Promise<Object>} Backup result

---

## async createIncrementalBackup(scope = "all")

```javascript
async createIncrementalBackup(scope = "all")
```

* Create an incremental backup
   * @param {string} scope - Backup scope
   * @returns {Promise<Object>} Backup result

---

## async configureSchedule(config)

```javascript
async configureSchedule(config)
```

* Configure a backup schedule
   * @param {Object} config - Schedule configuration
   * @returns {Promise<Object>} Created schedule

---

## async updateSchedule(id, updates)

```javascript
async updateSchedule(id, updates)
```

* Update a backup schedule
   * @param {string} id - Schedule ID
   * @param {Object} updates - Updates to apply
   * @returns {Promise<Object>} Updated schedule

---

## async deleteSchedule(id)

```javascript
async deleteSchedule(id)
```

* Delete a backup schedule
   * @param {string} id - Schedule ID

---

## async getSchedules()

```javascript
async getSchedules()
```

* Get all schedules
   * @returns {Promise<Array>} List of schedules

---

## async restoreFromBackup(backupId, options =

```javascript
async restoreFromBackup(backupId, options =
```

* Restore from backup
   * @param {string} backupId - Backup ID to restore from
   * @param {Object} options - Restore options
   * @returns {Promise<Object>} Restore result

---

## async _restoreFullBackup(backupData, options =

```javascript
async _restoreFullBackup(backupData, options =
```

* Restore from full backup
   * @private

---

## async _restoreIncrementalBackup(backupData, backup, options =

```javascript
async _restoreIncrementalBackup(backupData, backup, options =
```

* Restore from incremental backup
   * @private

---

## async _cleanupOldBackups(schedule)

```javascript
async _cleanupOldBackups(schedule)
```

* Cleanup old backups based on retention policy
   * @param {Object} schedule - Schedule with retention settings
   * @private

---

## async deleteBackup(backupId)

```javascript
async deleteBackup(backupId)
```

* Delete a backup
   * @param {string} backupId - Backup ID

---

## async getBackupHistory(options =

```javascript
async getBackupHistory(options =
```

* Get backup history
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Backup history

---

## async getStats()

```javascript
async getStats()
```

* Get backup statistics
   * @returns {Promise<Object>} Backup statistics

---

## _getTablesForScope(scope)

```javascript
_getTablesForScope(scope)
```

* Get tables for a scope
   * @param {string} scope - Backup scope
   * @returns {string[]} Table names
   * @private

---

## async _updateManifest(updates)

```javascript
async _updateManifest(updates)
```

* Update manifest file
   * @param {Object} updates - Updates to apply
   * @private

---

