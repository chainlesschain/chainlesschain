# image-storage

**Source**: `src/main/image/image-storage.js`

**Generated**: 2026-02-17T10:13:18.238Z

---

## const

```javascript
const
```

* 图片存储管理器
 *
 * 负责图片文件的存储、检索和管理

---

## const DEFAULT_CONFIG =

```javascript
const DEFAULT_CONFIG =
```

* 图片存储配置

---

## class ImageStorage

```javascript
class ImageStorage
```

* 图片存储类

---

## async initialize()

```javascript
async initialize()
```

* 初始化存储目录

---

## async initializeDatabase()

```javascript
async initializeDatabase()
```

* 初始化数据库表

---

## generateFilename(originalFilename)

```javascript
generateFilename(originalFilename)
```

* 生成文件名
   * @param {string} originalFilename - 原始文件名
   * @returns {string} 新文件名

---

## async saveImage(sourcePath, metadata =

```javascript
async saveImage(sourcePath, metadata =
```

* 保存图片
   * @param {string} sourcePath - 源文件路径
   * @param {Object} metadata - 图片元信息
   * @returns {Promise<Object>} 保存结果

---

## async saveThumbnail(imageId, thumbnailPath)

```javascript
async saveThumbnail(imageId, thumbnailPath)
```

* 保存缩略图
   * @param {string} imageId - 图片 ID
   * @param {string} thumbnailPath - 缩略图路径
   * @returns {Promise<Object>}

---

## async addImageRecord(record)

```javascript
async addImageRecord(record)
```

* 添加图片记录到数据库
   * @param {Object} record - 图片记录

---

## async updateImageRecord(imageId, updates)

```javascript
async updateImageRecord(imageId, updates)
```

* 更新图片记录
   * @param {string} imageId - 图片 ID
   * @param {Object} updates - 更新字段

---

## async getImageRecord(imageId)

```javascript
async getImageRecord(imageId)
```

* 获取图片记录
   * @param {string} imageId - 图片 ID
   * @returns {Promise<Object|null>}

---

## async getAllImages(options =

```javascript
async getAllImages(options =
```

* 获取所有图片记录
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

## async cleanOrphanFiles()

```javascript
async cleanOrphanFiles()
```

* 清理孤立文件 (数据库中不存在的文件)
   * @returns {Promise<Object>}

---

## getStoragePaths()

```javascript
getStoragePaths()
```

* 获取存储路径
   * @returns {Object}

---

