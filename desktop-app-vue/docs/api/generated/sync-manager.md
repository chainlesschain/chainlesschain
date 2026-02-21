# sync-manager

**Source**: `src/main/file-sync/sync-manager.js`

**Generated**: 2026-02-21T22:04:25.834Z

---

## class FileSyncManager extends EventEmitter

```javascript
class FileSyncManager extends EventEmitter
```

* 文件同步管理器
 * 负责数据库与文件系统之间的双向同步

---

## calculateHash(content)

```javascript
calculateHash(content)
```

* 计算内容的 SHA256 哈希

---

## isLocalPath(filePath)

```javascript
isLocalPath(filePath)
```

* 检查路径是否为本地文件系统路径

---

## async saveFile(fileId, content, projectId)

```javascript
async saveFile(fileId, content, projectId)
```

* 保存文件（双向同步：数据库 + 文件系统）
   * @param {string} fileId - 文件 ID
   * @param {string} content - 文件内容
   * @param {string} projectId - 项目 ID

---

## async syncFromFilesystem(projectId, relativePath)

```javascript
async syncFromFilesystem(projectId, relativePath)
```

* 从文件系统读取文件并更新到数据库
   * @param {string} projectId - 项目 ID
   * @param {string} relativePath - 相对路径

---

## async resolveConflict(fileId, resolution, manualContent = null)

```javascript
async resolveConflict(fileId, resolution, manualContent = null)
```

* 解决文件冲突
   * @param {string} fileId - 文件 ID
   * @param {string} resolution - 解决方式: 'use-db' | 'use-fs' | 'manual'
   * @param {string} manualContent - 手动合并的内容（当 resolution 为 'manual' 时）

---

## async flushAllChanges(projectId)

```javascript
async flushAllChanges(projectId)
```

* 刷新所有项目文件的更改到文件系统
   * @param {string} projectId - 项目 ID

---

## async watchProject(projectId, rootPath)

```javascript
async watchProject(projectId, rootPath)
```

* 监听项目文件变化
   * @param {string} projectId - 项目 ID
   * @param {string} rootPath - 项目根路径

---

## getFileType(ext)

```javascript
getFileType(ext)
```

* 获取文件类型
   * @param {string} ext - 文件扩展名

---

## stopWatch(projectId)

```javascript
stopWatch(projectId)
```

* 停止监听项目
   * @param {string} projectId - 项目 ID

---

## stopAll()

```javascript
stopAll()
```

* 停止所有监听

---

