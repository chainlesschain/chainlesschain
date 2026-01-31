# http-server

**Source**: `src\main\native-messaging\http-server.js`

**Generated**: 2026-01-27T06:44:03.837Z

---

## const

```javascript
const
```

* ChainlessChain Native Messaging HTTP Server
 * 为 Native Messaging Host 提供 HTTP API，用于接收浏览器扩展的剪藏请求

---

## start(port = DEFAULT_PORT)

```javascript
start(port = DEFAULT_PORT)
```

* 启动服务器

---

## stop()

```javascript
stop()
```

* 停止服务器

---

## async handleRequest(req, res)

```javascript
async handleRequest(req, res)
```

* 处理请求

---

## handlePingRequest(req, res)

```javascript
handlePingRequest(req, res)
```

* 处理 Ping 请求

---

## async handleClipRequest(req, res)

```javascript
async handleClipRequest(req, res)
```

* 处理剪藏请求

---

## async handleGenerateTagsRequest(req, res)

```javascript
async handleGenerateTagsRequest(req, res)
```

* 处理AI标签生成请求

---

## async handleGenerateSummaryRequest(req, res)

```javascript
async handleGenerateSummaryRequest(req, res)
```

* 处理AI摘要生成请求

---

## extractSimpleTags(data)

```javascript
extractSimpleTags(data)
```

* 简单的标签提取（fallback）

---

## extractSimpleSummary(content)

```javascript
extractSimpleSummary(content)
```

* 简单的摘要提取（fallback）

---

## async handleUploadScreenshotRequest(req, res)

```javascript
async handleUploadScreenshotRequest(req, res)
```

* 处理截图上传请求

---

## readRequestBody(req)

```javascript
readRequestBody(req)
```

* 读取请求体

---

## sendSuccess(res, data)

```javascript
sendSuccess(res, data)
```

* 发送成功响应

---

## sendError(res, statusCode, error)

```javascript
sendError(res, statusCode, error)
```

* 发送错误响应

---

## async handleBatchClipRequest(req, res)

```javascript
async handleBatchClipRequest(req, res)
```

* 处理批量剪藏请求

---

## async handleSearchRequest(req, res)

```javascript
async handleSearchRequest(req, res)
```

* 处理搜索请求

---

## async handleStatsRequest(req, res)

```javascript
async handleStatsRequest(req, res)
```

* 处理统计请求

---

