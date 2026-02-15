# backup-manager

**Source**: `src/main/system/backup-manager.js`

**Generated**: 2026-02-15T10:10:53.365Z

---

## const

```javascript
const
```

* 数据备份恢复管理器
 * 提供数据库和配置文件的备份与恢复功能

---

## ensureBackupDir()

```javascript
ensureBackupDir()
```

* 确保备份目录存在

---

## async createBackup(options =

```javascript
async createBackup(options =
```

* 创建备份

---

## createZipArchive(outputPath, items)

```javascript
createZipArchive(outputPath, items)
```

* 创建ZIP压缩包

---

## async restoreBackup(backupPath, options =

```javascript
async restoreBackup(backupPath, options =
```

* 恢复备份

---

## copyDir(src, dest)

```javascript
copyDir(src, dest)
```

* 复制目录

---

## getBackupList()

```javascript
getBackupList()
```

* 获取备份列表

---

## deleteBackup(backupPath)

```javascript
deleteBackup(backupPath)
```

* 删除备份

---

## async cleanOldBackups()

```javascript
async cleanOldBackups()
```

* 清理旧备份

---

## async exportBackup(backupPath, targetPath)

```javascript
async exportBackup(backupPath, targetPath)
```

* 导出备份到指定位置

---

## async importBackup(sourcePath)

```javascript
async importBackup(sourcePath)
```

* 导入备份

---

## async autoBackup()

```javascript
async autoBackup()
```

* 自动备份

---

## startAutoBackup(interval = 24 * 60 * 60 * 1000)

```javascript
startAutoBackup(interval = 24 * 60 * 60 * 1000)
```

* 启动自动备份

---

## stopAutoBackup()

```javascript
stopAutoBackup()
```

* 停止自动备份

---

