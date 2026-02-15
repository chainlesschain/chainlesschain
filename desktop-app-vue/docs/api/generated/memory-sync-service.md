# memory-sync-service

**Source**: `src/main/memory/memory-sync-service.js`

**Generated**: 2026-02-15T10:10:53.404Z

---

## const

```javascript
const
```

* MemorySyncService - 内存数据文件系统同步服务
 *
 * 负责将数据库中的数据同步到 .chainlesschain/ 文件系统目录，
 * 确保数据同时存在于数据库和文件系统中。
 *
 * 功能：
 * - 初始化时自动同步所有数据
 * - 定期后台同步
 * - 按类别同步（preferences, patterns, sessions, reports 等）
 * - 增量同步和全量同步
 *
 * @module memory-sync-service
 * @version 1.0.0
 * @since 2026-01-18

---

## class MemorySyncService extends EventEmitter

```javascript
class MemorySyncService extends EventEmitter
```

* MemorySyncService 类

---

## constructor(options =

```javascript
constructor(options =
```

* 创建同步服务实例
   * @param {Object} options - 配置选项
   * @param {Object} options.configManager - UnifiedConfigManager 实例
   * @param {Object} [options.preferenceManager] - PreferenceManager 实例
   * @param {Object} [options.learnedPatternManager] - LearnedPatternManager 实例
   * @param {Object} [options.sessionManager] - SessionManager 实例
   * @param {Object} [options.autoBackupManager] - AutoBackupManager 实例
   * @param {Object} [options.usageReportGenerator] - UsageReportGenerator 实例
   * @param {Object} [options.behaviorTracker] - BehaviorTracker 实例
   * @param {Object} [options.contextAssociator] - ContextAssociator 实例
   * @param {number} [options.syncInterval=300000] - 同步间隔（毫秒，默认5分钟）
   * @param {boolean} [options.enablePeriodicSync=true] - 启用定期同步

---

## async initialize()

```javascript
async initialize()
```

* 初始化并执行首次同步

---

## async ensureDirectories()

```javascript
async ensureDirectories()
```

* 确保所有目录存在

---

## async syncAll()

```javascript
async syncAll()
```

* 同步所有数据到文件系统
   * @returns {Promise<Object>} 同步结果

---

## async syncPreferences()

```javascript
async syncPreferences()
```

* 同步偏好设置到文件系统

---

## async syncPatterns()

```javascript
async syncPatterns()
```

* 同步学习模式到文件系统

---

## async syncSessions()

```javascript
async syncSessions()
```

* 同步会话到文件系统

---

## async syncBehaviors()

```javascript
async syncBehaviors()
```

* 同步行为数据到文件系统

---

## async syncContexts()

```javascript
async syncContexts()
```

* 同步上下文关联到文件系统

---

## async generateSyncReport()

```javascript
async generateSyncReport()
```

* 生成同步报告

---

## startPeriodicSync()

```javascript
startPeriodicSync()
```

* 启动定期同步

---

## stopPeriodicSync()

```javascript
stopPeriodicSync()
```

* 停止定期同步

---

## async syncCategory(category)

```javascript
async syncCategory(category)
```

* 按类别同步
   * @param {string} category - 类别名称
   * @returns {Promise<Object>} 同步结果

---

## getStatus()

```javascript
getStatus()
```

* 获取同步状态
   * @returns {Object} 同步状态

---

## updateManagers(managers)

```javascript
updateManagers(managers)
```

* 更新 Manager 引用
   * @param {Object} managers - 新的 manager 引用

---

## stop()

```javascript
stop()
```

* 停止服务

---

