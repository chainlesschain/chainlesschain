# file-manager

**Source**: `src/main/file/file-manager.js`

**Generated**: 2026-02-15T10:10:53.423Z

---

## const

```javascript
const
```

* 文件管理器 - Phase 2
 * 负责文件上传、下载、共享、锁定等核心功能

---

## constructor(db, organizationManager)

```javascript
constructor(db, organizationManager)
```

* @param {Object} db - Better-SQLite3数据库实例
   * @param {Object} organizationManager - 组织管理器实例

---

## async uploadFile(fileData, uploaderDID)

```javascript
async uploadFile(fileData, uploaderDID)
```

* 上传文件
   * @param {Object} fileData - 文件数据
   * @param {string} uploaderDID - 上传者DID
   * @returns {Object} 文件信息

---

## getFile(fileId)

```javascript
getFile(fileId)
```

* 获取文件信息
   * @param {string} fileId - 文件ID
   * @returns {Object} 文件信息

---

## getFiles(filters =

```javascript
getFiles(filters =
```

* 获取文件列表
   * @param {Object} filters - 筛选条件
   * @returns {Array} 文件列表

---

## async updateFile(fileId, updates, updaterDID)

```javascript
async updateFile(fileId, updates, updaterDID)
```

* 更新文件元数据
   * @param {string} fileId - 文件ID
   * @param {Object} updates - 更新数据
   * @param {string} updaterDID - 更新者DID
   * @returns {Object} 结果

---

## async deleteFile(fileId, deleterDID)

```javascript
async deleteFile(fileId, deleterDID)
```

* 删除文件
   * @param {string} fileId - 文件ID
   * @param {string} deleterDID - 删除者DID
   * @returns {Object} 结果

---

## async lockFile(fileId, lockerDID, expiresIn = 3600000)

```javascript
async lockFile(fileId, lockerDID, expiresIn = 3600000)
```

* 锁定文件
   * @param {string} fileId - 文件ID
   * @param {string} lockerDID - 锁定者DID
   * @param {number} expiresIn - 锁定时长（毫秒）
   * @returns {Object} 结果

---

## async unlockFile(fileId, unlockerDID)

```javascript
async unlockFile(fileId, unlockerDID)
```

* 解锁文件
   * @param {string} fileId - 文件ID
   * @param {string} unlockerDID - 解锁者DID
   * @returns {Object} 结果

---

## addTag(fileId, tag, adderDID)

```javascript
addTag(fileId, tag, adderDID)
```

* 添加文件标签
   * @param {string} fileId - 文件ID
   * @param {string} tag - 标签
   * @param {string} adderDID - 添加者DID

---

## removeTag(fileId, tag)

```javascript
removeTag(fileId, tag)
```

* 移除文件标签
   * @param {string} fileId - 文件ID
   * @param {string} tag - 标签

---

## getTags(fileId)

```javascript
getTags(fileId)
```

* 获取文件标签
   * @param {string} fileId - 文件ID
   * @returns {Array} 标签列表

---

## getAccessLogs(fileId, limit = 50)

```javascript
getAccessLogs(fileId, limit = 50)
```

* 获取文件访问日志
   * @param {string} fileId - 文件ID
   * @param {number} limit - 限制数量
   * @returns {Array} 访问日志

---

## _calculateChecksum(content)

```javascript
_calculateChecksum(content)
```

* 计算文件checksum
   * @private

---

## async _saveFileToDisk(originalPath, content)

```javascript
async _saveFileToDisk(originalPath, content)
```

* 保存文件到磁盘
   * @private

---

## async _logFileAccess(fileId, userDID, action, metadata =

```javascript
async _logFileAccess(fileId, userDID, action, metadata =
```

* 记录文件访问日志
   * @private

---

