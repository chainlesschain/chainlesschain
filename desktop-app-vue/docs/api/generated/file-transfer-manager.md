# file-transfer-manager

**Source**: `src/main/p2p/file-transfer-manager.js`

**Generated**: 2026-02-15T10:10:53.399Z

---

## const

```javascript
const
```

* 文件传输管理器 - 支持大文件分块传输和断点续传
 *
 * 功能：
 * - 大文件分块传输
 * - 断点续传
 * - 传输进度跟踪
 * - 传输速度计算
 * - 文件完整性校验
 * - 并发传输控制

---

## async uploadFile(peerId, filePath, options =

```javascript
async uploadFile(peerId, filePath, options =
```

* 上传文件
   * @param {string} peerId - 目标节点ID
   * @param {string} filePath - 文件路径
   * @param {Object} options - 上传选项

---

## async downloadFile(peerId, transferId, savePath)

```javascript
async downloadFile(peerId, transferId, savePath)
```

* 下载文件
   * @param {string} peerId - 源节点ID
   * @param {string} transferId - 传输ID
   * @param {string} savePath - 保存路径

---

## async uploadChunks(uploadTask)

```javascript
async uploadChunks(uploadTask)
```

* 上传分块

---

## async sendChunk(uploadTask, chunkIndex, chunkData)

```javascript
async sendChunk(uploadTask, chunkIndex, chunkData)
```

* 发送分块

---

## async requestMissingChunks(downloadTask)

```javascript
async requestMissingChunks(downloadTask)
```

* 请求缺失的分块

---

## async assembleFile(downloadTask)

```javascript
async assembleFile(downloadTask)
```

* 组装文件

---

## async verifyFile(downloadTask)

```javascript
async verifyFile(downloadTask)
```

* 验证文件

---

## async calculateFileHash(filePath)

```javascript
async calculateFileHash(filePath)
```

* 计算文件哈希

---

## generateTransferId()

```javascript
generateTransferId()
```

* 生成传输ID

---

## async sendTransferRequest(peerId, metadata)

```javascript
async sendTransferRequest(peerId, metadata)
```

* 发送传输请求

---

## async waitForTransferAccept(transferId)

```javascript
async waitForTransferAccept(transferId)
```

* 等待传输接受

---

## async waitForTransferComplete(transferId)

```javascript
async waitForTransferComplete(transferId)
```

* 等待传输完成

---

## async waitForAllChunks(downloadTask)

```javascript
async waitForAllChunks(downloadTask)
```

* 等待所有分块

---

## setupMessageHandlers()

```javascript
setupMessageHandlers()
```

* 设置消息处理器

---

## async handleTransferRequest(peerId, payload)

```javascript
async handleTransferRequest(peerId, payload)
```

* 处理传输请求

---

## async handleChunk(peerId, payload)

```javascript
async handleChunk(peerId, payload)
```

* 处理分块

---

## async handleRequestChunks(peerId, payload)

```javascript
async handleRequestChunks(peerId, payload)
```

* 处理请求分块

---

## async handleTransferComplete(peerId, payload)

```javascript
async handleTransferComplete(peerId, payload)
```

* 处理传输完成

---

## ensureTempDir()

```javascript
ensureTempDir()
```

* 确保临时目录存在

---

## getProgress(transferId)

```javascript
getProgress(transferId)
```

* 获取传输进度

---

## async cancelTransfer(transferId)

```javascript
async cancelTransfer(transferId)
```

* 取消传输

---

## getStats()

```javascript
getStats()
```

* 获取统计信息

---

## cleanup()

```javascript
cleanup()
```

* 清理资源

---

