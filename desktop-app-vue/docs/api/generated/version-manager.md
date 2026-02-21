# version-manager

**Source**: `src/main/file/version-manager.js`

**Generated**: 2026-02-21T22:04:25.834Z

---

## const

```javascript
const
```

* 版本控制管理器 - Phase 2
 * 负责文件版本历史、版本比较、版本回滚等功能

---

## constructor(db)

```javascript
constructor(db)
```

* @param {Object} db - Better-SQLite3数据库实例

---

## createVersion(versionData, creatorDID)

```javascript
createVersion(versionData, creatorDID)
```

* 创建新版本
   * @param {Object} versionData - 版本数据
   * @param {string} creatorDID - 创建者DID
   * @returns {Object} 版本信息

---

## getVersion(versionId)

```javascript
getVersion(versionId)
```

* 获取版本信息
   * @param {string} versionId - 版本ID
   * @returns {Object} 版本信息

---

## getFileVersions(fileId)

```javascript
getFileVersions(fileId)
```

* 获取文件的所有版本
   * @param {string} fileId - 文件ID
   * @returns {Array} 版本列表

---

## getVersionByNumber(fileId, versionNumber)

```javascript
getVersionByNumber(fileId, versionNumber)
```

* 获取特定版本号的版本
   * @param {string} fileId - 文件ID
   * @param {number} versionNumber - 版本号
   * @returns {Object} 版本信息

---

## getLatestVersion(fileId)

```javascript
getLatestVersion(fileId)
```

* 获取最新版本
   * @param {string} fileId - 文件ID
   * @returns {Object} 版本信息

---

## rollbackToVersion(fileId, targetVersion, rollerDID)

```javascript
rollbackToVersion(fileId, targetVersion, rollerDID)
```

* 回滚到指定版本
   * @param {string} fileId - 文件ID
   * @param {number} targetVersion - 目标版本号
   * @param {string} rollerDID - 回滚者DID
   * @returns {Object} 新版本信息

---

## compareVersions(fileId, version1, version2)

```javascript
compareVersions(fileId, version1, version2)
```

* 比较两个版本
   * @param {string} fileId - 文件ID
   * @param {number} version1 - 版本号1
   * @param {number} version2 - 版本号2
   * @returns {Object} 比较结果

---

## pruneVersions(fileId, keepCount = 10)

```javascript
pruneVersions(fileId, keepCount = 10)
```

* 删除旧版本（保留最近N个版本）
   * @param {string} fileId - 文件ID
   * @param {number} keepCount - 保留版本数
   * @returns {number} 删除的版本数

---

## getVersionStats(fileId)

```javascript
getVersionStats(fileId)
```

* 获取版本统计信息
   * @param {string} fileId - 文件ID
   * @returns {Object} 统计信息

---

## getVersionContributors(fileId)

```javascript
getVersionContributors(fileId)
```

* 获取版本创建者列表
   * @param {string} fileId - 文件ID
   * @returns {Array} 创建者DID列表

---

## versionExists(fileId, versionNumber)

```javascript
versionExists(fileId, versionNumber)
```

* 检查版本是否存在
   * @param {string} fileId - 文件ID
   * @param {number} versionNumber - 版本号
   * @returns {boolean}

---

## getVersionHistory(fileId, limit = 20)

```javascript
getVersionHistory(fileId, limit = 20)
```

* 获取版本变更摘要
   * @param {string} fileId - 文件ID
   * @param {number} limit - 限制数量
   * @returns {Array} 变更摘要列表

---

