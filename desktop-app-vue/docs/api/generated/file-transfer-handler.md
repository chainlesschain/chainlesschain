# file-transfer-handler

**Source**: `src\main\remote\handlers\file-transfer-handler.js`

**Generated**: 2026-01-27T06:44:03.823Z

---

## const

```javascript
const
```

* 文件传输命令处理器
 *
 * 处理文件传输相关命令：
 * - file.requestUpload: 请求上传文件（Android → PC）
 * - file.uploadChunk: 上传文件分块
 * - file.completeUpload: 完成上传
 * - file.requestDownload: 请求下载文件（PC → Android）
 * - file.downloadChunk: 下载文件分块
 * - file.cancelTransfer: 取消传输
 * - file.listTransfers: 列出传输任务
 *
 * @module remote/handlers/file-transfer-handler

---

## class FileTransferHandler

```javascript
class FileTransferHandler
```

* 文件传输命令处理器类

---

## async _ensureDirectories()

```javascript
async _ensureDirectories()
```

* 确保必要的目录存在

---

## async handle(action, params, context)

```javascript
async handle(action, params, context)
```

* 处理命令（统一入口）

---

## async requestUpload(params, context)

```javascript
async requestUpload(params, context)
```

* 请求上传文件（Android → PC）

---

## async uploadChunk(params, context)

```javascript
async uploadChunk(params, context)
```

* 上传文件分块

---

## async completeUpload(params, context)

```javascript
async completeUpload(params, context)
```

* 完成上传

---

## async requestDownload(params, context)

```javascript
async requestDownload(params, context)
```

* 请求下载文件（PC → Android）

---

## async downloadChunk(params, context)

```javascript
async downloadChunk(params, context)
```

* 下载文件分块（PC → Android）

---

## async cancelTransfer(params, context)

```javascript
async cancelTransfer(params, context)
```

* 取消传输

---

## async listTransfers(params, context)

```javascript
async listTransfers(params, context)
```

* 列出传输任务

---

## async _calculateChecksum(filePath)

```javascript
async _calculateChecksum(filePath)
```

* 计算文件校验和（MD5）

---

## async cleanupExpiredTransfers(maxAge = 24 * 60 * 60 * 1000)

```javascript
async cleanupExpiredTransfers(maxAge = 24 * 60 * 60 * 1000)
```

* 清理过期传输任务（可定期调用）

---

