# image-uploader

**Source**: `src/main/image/image-uploader.js`

**Generated**: 2026-02-15T08:42:37.236Z

---

## const

```javascript
const
```

* 图片上传管理器
 *
 * 整合图片处理、OCR 识别、存储管理等功能
 *
 * v0.17.0: 集成文件安全验证

---

## const DEFAULT_CONFIG =

```javascript
const DEFAULT_CONFIG =
```

* 上传配置

---

## class ImageUploader extends EventEmitter

```javascript
class ImageUploader extends EventEmitter
```

* 图片上传管理器类

---

## setupEventForwarding()

```javascript
setupEventForwarding()
```

* 设置事件转发

---

## async initialize()

```javascript
async initialize()
```

* 初始化
   *
   * v0.18.0: 添加Worker池初始化
   * v0.18.0: 添加ResumableProcessor初始化

---

## async uploadImage(imagePath, options =

```javascript
async uploadImage(imagePath, options =
```

* 上传单个图片
   * @param {string} imagePath - 图片路径
   * @param {Object} options - 上传选项
   * @returns {Promise<Object>} 上传结果

---

## async uploadImages(imagePaths, options =

```javascript
async uploadImages(imagePaths, options =
```

* 批量上传图片
   * @param {Array} imagePaths - 图片路径列表
   * @param {Object} options - 上传选项
   * @returns {Promise<Array>} 上传结果列表
   *
   * v0.18.0: 集成统一进度通知

---

## async performOCR(imagePath)

```javascript
async performOCR(imagePath)
```

* 仅执行 OCR (不保存图片)
   * @param {string} imagePath - 图片路径
   * @returns {Promise<Object>} OCR 结果

---

## async performBatchOCR(imagePaths, options =

```javascript
async performBatchOCR(imagePaths, options =
```

* 批量执行 OCR (使用Worker池并发处理)
   * @param {Array<string>} imagePaths - 图片路径列表
   * @param {Object} options - OCR选项
   * @returns {Promise<Array<Object>>} OCR 结果列表
   *
   * v0.18.0: 新增方法，提供3-4倍并发加速

---

## async getImageInfo(imageId)

```javascript
async getImageInfo(imageId)
```

* 获取图片信息
   * @param {string} imageId - 图片 ID
   * @returns {Promise<Object|null>}

---

## async getAllImages(options =

```javascript
async getAllImages(options =
```

* 获取所有图片
   * @param {Object} options - 查询选项
   * @returns {Promise<Array>}

---

## async searchImages(query)

```javascript
async searchImages(query)
```

* 搜索图片 (通过 OCR 文本)
   * @param {string} query - 搜索关键词
   * @returns {Promise<Array>}

---

## async deleteImage(imageId)

```javascript
async deleteImage(imageId)
```

* 删除图片
   * @param {string} imageId - 图片 ID
   * @returns {Promise<Object>}

---

## async getStats()

```javascript
async getStats()
```

* 获取统计信息
   * @returns {Promise<Object>}

---

## getSupportedFormats()

```javascript
getSupportedFormats()
```

* 获取支持的图片格式
   * @returns {Array}

---

## getSupportedLanguages()

```javascript
getSupportedLanguages()
```

* 获取支持的 OCR 语言
   * @returns {Array}

---

## async updateConfig(newConfig)

```javascript
async updateConfig(newConfig)
```

* 更新配置
   * @param {Object} newConfig

---

## async terminate()

```javascript
async terminate()
```

* 终止服务
   *
   * v0.18.0: 添加Worker池终止

---

