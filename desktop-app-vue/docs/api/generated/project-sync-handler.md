# project-sync-handler

**Source**: `src/main/p2p/project-sync-handler.js`

**Generated**: 2026-02-21T22:04:25.806Z

---

## const

```javascript
const
```

* Project Sync Handler - 项目文件同步处理器
 *
 * 功能：
 * - 处理移动端项目查询请求
 * - 同步项目列表
 * - 同步项目文件树
 * - 同步文件内容
 * - 搜索项目文件

---

## async handleMessage(mobilePeerId, message)

```javascript
async handleMessage(mobilePeerId, message)
```

* 统一消息处理入口

---

## async handleListProjects(mobilePeerId, message)

```javascript
async handleListProjects(mobilePeerId, message)
```

* 处理获取项目列表请求

---

## async handleGetProject(mobilePeerId, message)

```javascript
async handleGetProject(mobilePeerId, message)
```

* 处理获取项目详情请求

---

## async handleGetFileTree(mobilePeerId, message)

```javascript
async handleGetFileTree(mobilePeerId, message)
```

* 处理获取文件树请求

---

## async handleGetFile(mobilePeerId, message)

```javascript
async handleGetFile(mobilePeerId, message)
```

* 处理获取文件内容请求

---

## async handleSearchFiles(mobilePeerId, message)

```javascript
async handleSearchFiles(mobilePeerId, message)
```

* 处理搜索文件请求

---

## async countProjectFiles(projectPath)

```javascript
async countProjectFiles(projectPath)
```

* 统计项目文件数

---

## async getProjectStats(projectPath)

```javascript
async getProjectStats(projectPath)
```

* 获取项目统计信息

---

## async buildFileTree(rootPath, maxDepth, currentDepth = 0)

```javascript
async buildFileTree(rootPath, maxDepth, currentDepth = 0)
```

* 构建文件树

---

## async searchFiles(rootPath, query, fileTypes = [])

```javascript
async searchFiles(rootPath, query, fileTypes = [])
```

* 搜索文件

---

## async sendToMobile(mobilePeerId, message)

```javascript
async sendToMobile(mobilePeerId, message)
```

* 发送消息到移动端

---

## async sendError(mobilePeerId, requestId, errorMessage)

```javascript
async sendError(mobilePeerId, requestId, errorMessage)
```

* 发送错误响应

---

## getStats()

```javascript
getStats()
```

* 获取统计信息

---

