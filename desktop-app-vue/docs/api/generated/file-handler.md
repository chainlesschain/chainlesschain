# file-handler

**Source**: `src/main/browser/actions/file-handler.js`

**Generated**: 2026-02-21T20:04:16.266Z

---

## const

```javascript
const
```

* FileHandler - 文件处理管理器
 *
 * 处理浏览器自动化中的文件操作：
 * - 下载跟踪和管理
 * - 上传处理
 * - 文件类型验证
 * - 下载进度监控
 *
 * @module browser/actions/file-handler
 * @author ChainlessChain Team
 * @since v0.33.0

---

## const DownloadState =

```javascript
const DownloadState =
```

* 下载状态

---

## const FileCategory =

```javascript
const FileCategory =
```

* 文件类型分类

---

## const FILE_TYPE_MAP =

```javascript
const FILE_TYPE_MAP =
```

* 文件类型映射

---

## constructor(browserEngine = null, config =

```javascript
constructor(browserEngine = null, config =
```

* @param {Object} browserEngine - Browser engine instance
   * @param {Object} config - Configuration options
   * @param {Object} [dependencies] - Optional dependency injection for testing

---

## setBrowserEngine(browserEngine)

```javascript
setBrowserEngine(browserEngine)
```

* 设置浏览器引擎
   * @param {Object} browserEngine

---

## setDownloadDir(dir)

```javascript
setDownloadDir(dir)
```

* 设置下载目录
   * @param {string} dir - 下载目录
   * @returns {Object}

---

## async startDownload(targetId, url, options =

```javascript
async startDownload(targetId, url, options =
```

* 开始下载
   * @param {string} targetId - 标签页 ID
   * @param {string} url - 下载 URL
   * @param {Object} options - 选项
   * @returns {Promise<Object>}

---

## async _downloadViaPage(download, options)

```javascript
async _downloadViaPage(download, options)
```

* 通过页面下载
   * @private

---

## async _downloadViaFetch(download, options)

```javascript
async _downloadViaFetch(download, options)
```

* 通过 fetch 下载
   * @private

---

## cancelDownload(downloadId)

```javascript
cancelDownload(downloadId)
```

* 取消下载
   * @param {string} downloadId - 下载 ID
   * @returns {Object}

---

## getDownload(downloadId)

```javascript
getDownload(downloadId)
```

* 获取下载状态
   * @param {string} downloadId - 下载 ID
   * @returns {Object}

---

## listDownloads(filter =

```javascript
listDownloads(filter =
```

* 列出下载
   * @param {Object} filter - 过滤条件
   * @returns {Array}

---

## recordUpload(targetId, selector, files)

```javascript
recordUpload(targetId, selector, files)
```

* 记录上传
   * @param {string} targetId - 标签页 ID
   * @param {string} selector - 上传元素选择器
   * @param {Array} files - 文件信息列表
   * @returns {Object}

---

## getUploads(limit = 20)

```javascript
getUploads(limit = 20)
```

* 获取上传历史
   * @param {number} limit - 返回数量
   * @returns {Array}

---

## validateFile(filePath, rules =

```javascript
validateFile(filePath, rules =
```

* 验证文件
   * @param {string} filePath - 文件路径
   * @param {Object} rules - 验证规则
   * @returns {Object}

---

## getFileInfo(filePath)

```javascript
getFileInfo(filePath)
```

* 获取文件信息
   * @param {string} filePath - 文件路径
   * @returns {Object}

---

## _parseUrl(url)

```javascript
_parseUrl(url)
```

* 解析 URL
   * @private

---

## _generateUniqueName(dir, filename)

```javascript
_generateUniqueName(dir, filename)
```

* 生成唯一文件名
   * @private

---

## _getCategory(filename)

```javascript
_getCategory(filename)
```

* 获取文件分类
   * @private

---

## _updateCategoryStats(category)

```javascript
_updateCategoryStats(category)
```

* 更新分类统计
   * @private

---

## getStats()

```javascript
getStats()
```

* 获取统计
   * @returns {Object}

---

## resetStats()

```javascript
resetStats()
```

* 重置统计

---

## cleanup(options =

```javascript
cleanup(options =
```

* 清理下载记录
   * @param {Object} options - 清理选项
   * @returns {Object}

---

