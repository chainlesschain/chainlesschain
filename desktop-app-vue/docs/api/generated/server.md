# server

**Source**: `src/main/native-messaging/server.js`

**Generated**: 2026-02-15T08:42:37.218Z

---

## const

```javascript
const
```

* Native Messaging Server - 桌面应用端
 *
 * 处理来自浏览器扩展的消息
 * 使用标准输入/输出进行通信

---

## start()

```javascript
start()
```

* 启动服务器

---

## async handleMessage(message)

```javascript
async handleMessage(message)
```

* 处理消息

---

## sendResponse(id, data)

```javascript
sendResponse(id, data)
```

* 发送响应

---

## sendError(id, error)

```javascript
sendError(id, error)
```

* 发送错误

---

## sendMessage(message)

```javascript
sendMessage(message)
```

* 发送消息

---

## registerHandler(action, handler)

```javascript
registerHandler(action, handler)
```

* 注册消息处理器

---

## registerDefaultHandlers()

```javascript
registerDefaultHandlers()
```

* 注册默认处理器

---

## async handleSaveClip(data)

```javascript
async handleSaveClip(data)
```

* 处理保存剪藏

---

## async handleGetTags()

```javascript
async handleGetTags()
```

* 处理获取标签

---

## async handleSearchKnowledge(data)

```javascript
async handleSearchKnowledge(data)
```

* 处理搜索知识库

---

## async handleGetRecentClips(data)

```javascript
async handleGetRecentClips(data)
```

* 处理获取最近剪藏

---

## async handleUploadImage(data)

```javascript
async handleUploadImage(data)
```

* 处理上传图片

---

