# file-transfer-handler

**Source**: `src/main/remote/handlers/file-transfer-handler.js`

**Generated**: 2026-02-15T10:10:53.382Z

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

## async readFile(params, context)

```javascript
async readFile(params, context)
```

* 读取文件内容

---

## async writeFile(params, context)

```javascript
async writeFile(params, context)
```

* 写入文件内容

---

## async listDirectory(params, context)

```javascript
async listDirectory(params, context)
```

* 列出目录内容

---

## async deleteFile(params, context)

```javascript
async deleteFile(params, context)
```

* 删除文件或目录

---

## async moveFile(params, context)

```javascript
async moveFile(params, context)
```

* 移动文件

---

## async copyFile(params, context)

```javascript
async copyFile(params, context)
```

* 复制文件

---

## async getFileStats(params, context)

```javascript
async getFileStats(params, context)
```

* 获取文件统计信息

---

## async fileExists(params, context)

```javascript
async fileExists(params, context)
```

* 检查文件是否存在

---

## async createFile(params, context)

```javascript
async createFile(params, context)
```

* 创建文件（语义更清晰的 writeFile 别名）
   *
   * @param {Object} params - 参数
   * @param {string} params.filePath - 文件路径
   * @param {string} params.content - 文件内容
   * @param {string} params.encoding - 编码（默认 utf8）
   * @param {boolean} params.createDir - 是否自动创建目录（默认 true）

---

## async makeDirectory(params, context)

```javascript
async makeDirectory(params, context)
```

* 创建目录
   *
   * @param {Object} params - 参数
   * @param {string} params.dirPath - 目录路径
   * @param {boolean} params.recursive - 是否递归创建（默认 true）

---

## _resolvePath(filePath)

```javascript
_resolvePath(filePath)
```

* 解析文件路径（安全性检查）

---

## _getBasePath()

```javascript
_getBasePath()
```

* 获取基础路径

---

