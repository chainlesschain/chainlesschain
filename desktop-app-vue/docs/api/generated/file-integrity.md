# file-integrity

**Source**: `src/main/utils/file-integrity.js`

**Generated**: 2026-02-15T08:42:37.170Z

---

## const

```javascript
const
```

* 文件完整性检查和恢复工具
 * 提供文件损坏检测、校验和恢复机制

---

## class FileIntegrityChecker extends EventEmitter

```javascript
class FileIntegrityChecker extends EventEmitter
```

* 文件完整性检查器

---

## async calculateFileHash(filePath)

```javascript
async calculateFileHash(filePath)
```

* 计算文件哈希
   * @param {string} filePath - 文件路径
   * @returns {Promise<string>} 文件哈希值

---

## async verifyFile(filePath, expectedHash)

```javascript
async verifyFile(filePath, expectedHash)
```

* 验证文件完整性
   * @param {string} filePath - 文件路径
   * @param {string} expectedHash - 预期哈希值
   * @returns {Promise<boolean>} 是否完整

---

## async checkFile(filePath, options =

```javascript
async checkFile(filePath, options =
```

* 检查文件是否损坏（基于多种检测方法）
   * @param {string} filePath - 文件路径
   * @param {Object} options - 检查选项
   * @returns {Promise<Object>} 检查结果

---

## _validateFileType(content, fileType)

```javascript
_validateFileType(content, fileType)
```

* 验证文件类型（通过魔数）
   * @param {Buffer} content - 文件内容
   * @param {string} fileType - 文件类型
   * @returns {boolean}

---

## async _deepCheckByType(filePath, fileType)

```javascript
async _deepCheckByType(filePath, fileType)
```

* 深度检查（针对特定文件类型）
   * @param {string} filePath - 文件路径
   * @param {string} fileType - 文件类型

---

## async _checkSQLiteIntegrity(dbPath)

```javascript
async _checkSQLiteIntegrity(dbPath)
```

* 检查 SQLite 数据库完整性

---

## async createBackup(filePath, options =

```javascript
async createBackup(filePath, options =
```

* 创建文件备份
   * @param {string} filePath - 源文件路径
   * @param {Object} options - 备份选项
   * @returns {Promise<string>} 备份文件路径

---

## async restoreFromBackup(filePath, backupPath = null)

```javascript
async restoreFromBackup(filePath, backupPath = null)
```

* 从备份恢复文件
   * @param {string} filePath - 目标文件路径
   * @param {string} backupPath - 备份文件路径（可选，自动查找最新备份）

---

## async _findLatestValidBackup(backupDir, fileName)

```javascript
async _findLatestValidBackup(backupDir, fileName)
```

* 查找最新的有效备份

---

## async _cleanOldBackups(backupDir, fileName)

```javascript
async _cleanOldBackups(backupDir, fileName)
```

* 清理旧备份

---

## let globalChecker = null;

```javascript
let globalChecker = null;
```

* 全局实例

---

## function getFileIntegrityChecker(options)

```javascript
function getFileIntegrityChecker(options)
```

* 获取全局文件完整性检查器

---

