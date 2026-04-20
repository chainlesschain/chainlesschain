# database-config

**Source**: `src/main/config/database-config.js`

**Generated**: 2026-04-20T01:53:52.314Z

---

## const

```javascript
const
```

* 应用级配置管理器
 * 用于存储无法存储在数据库中的配置（如数据库路径本身）

---

## const DEFAULT_CONFIG =

```javascript
const DEFAULT_CONFIG =
```

* 默认配置

---

## class AppConfigManager

```javascript
class AppConfigManager
```

* 应用配置管理器类

---

## async loadAsync()

```javascript
async loadAsync()
```

* 异步加载配置（M2 启动期 IO 异步化）
   * 使用 fs.promises 将 readFile/mkdir/writeFile 移出事件循环。

---

## async saveAsync()

```javascript
async saveAsync()
```

* 异步保存配置

---

## getConfigPath()

```javascript
getConfigPath()
```

* 获取配置文件路径

---

## getDefaultDatabasePath()

```javascript
getDefaultDatabasePath()
```

* 获取默认数据库路径

---

## getDataPath()

```javascript
getDataPath()
```

* 获取应用数据目录路径

---

## load()

```javascript
load()
```

* 加载配置

---

## save()

```javascript
save()
```

* 保存配置

---

## get(key, defaultValue = null)

```javascript
get(key, defaultValue = null)
```

* 获取配置项

---

## set(key, value)

```javascript
set(key, value)
```

* 设置配置项

---

## getAll()

```javascript
getAll()
```

* 获取全部配置

---

## reset()

```javascript
reset()
```

* 重置为默认配置

---

## getDatabasePath()

```javascript
getDatabasePath()
```

* 获取数据库路径

---

## setDatabasePath(newPath)

```javascript
setDatabasePath(newPath)
```

* 设置数据库路径

---

## getDatabaseDir()

```javascript
getDatabaseDir()
```

* 获取数据库目录

---

## ensureDatabaseDir()

```javascript
ensureDatabaseDir()
```

* 确保数据库目录存在

---

## databaseExists()

```javascript
databaseExists()
```

* 检查数据库文件是否存在

---

## async migrateDatabaseTo(newPath)

```javascript
async migrateDatabaseTo(newPath)
```

* 迁移数据库到新位置
   * @param {string} newPath - 新的数据库路径
   * @returns {Promise<boolean>}

---

## createDatabaseBackup()

```javascript
createDatabaseBackup()
```

* 创建数据库备份
   * @returns {string} 备份文件路径

---

## cleanupOldBackups()

```javascript
cleanupOldBackups()
```

* 清理旧备份

---

## listBackups()

```javascript
listBackups()
```

* 列出所有备份
   * @returns {Array}

---

## restoreFromBackup(backupPath)

```javascript
restoreFromBackup(backupPath)
```

* 从备份恢复数据库
   * @param {string} backupPath - 备份文件路径
   * @returns {boolean}

---

## applyInitialSetup(initialConfig)

```javascript
applyInitialSetup(initialConfig)
```

* 批量应用初始设置配置
   * @param {Object} initialConfig - 来自 initial-setup-config.json 的配置

---

## async function prewarmAppConfig()

```javascript
async function prewarmAppConfig()
```

* 异步预热应用配置（M2 启动期 IO 异步化）
 * 在 bootstrap 早期 await 此函数，可将 readFile/mkdir/writeFile 移出事件循环。
 * 完成后，所有同步 getAppConfig() 将走快路径。

---

