# knowledge-sync-handler

**Source**: `src/main/p2p/knowledge-sync-handler.js`

**Generated**: 2026-02-21T22:45:05.274Z

---

## const

```javascript
const
```

* Knowledge Sync Handler - 知识库同步处理器
 *
 * 功能：
 * - 处理移动端知识库查询请求
 * - 同步知识库笔记列表
 * - 同步笔记内容
 * - 搜索笔记
 * - 处理离线缓存

---

## async handleMessage(mobilePeerId, message)

```javascript
async handleMessage(mobilePeerId, message)
```

* 统一消息处理入口
   * 由主进程的消息路由调用

---

## async handleListNotes(mobilePeerId, message)

```javascript
async handleListNotes(mobilePeerId, message)
```

* 处理获取笔记列表请求

---

## async handleGetNote(mobilePeerId, message)

```javascript
async handleGetNote(mobilePeerId, message)
```

* 处理获取笔记详情请求

---

## async handleSearch(mobilePeerId, message)

```javascript
async handleSearch(mobilePeerId, message)
```

* 处理搜索请求

---

## async handleGetFolders(mobilePeerId, message)

```javascript
async handleGetFolders(mobilePeerId, message)
```

* 处理获取文件夹列表请求

---

## async handleGetTags(mobilePeerId, message)

```javascript
async handleGetTags(mobilePeerId, message)
```

* 处理获取标签列表请求

---

## buildFolderTree(folders)

```javascript
buildFolderTree(folders)
```

* 构建文件夹树形结构

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

