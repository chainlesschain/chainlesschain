# image-processor

**Source**: `src/main/image/image-processor.js`

**Generated**: 2026-02-21T22:04:25.830Z

---

## const

```javascript
const
```

* 图片处理器
 *
 * 负责图片压缩、缩略图生成、格式转换等

---

## const DEFAULT_CONFIG =

```javascript
const DEFAULT_CONFIG =
```

* 图片处理配置

---

## class ImageProcessor extends EventEmitter

```javascript
class ImageProcessor extends EventEmitter
```

* 图片处理器类

---

## isSupportedImage(filePath)

```javascript
isSupportedImage(filePath)
```

* 检查文件是否为支持的图片格式
   * @param {string} filePath - 文件路径
   * @returns {boolean}

---

## async getMetadata(input)

```javascript
async getMetadata(input)
```

* 获取图片元信息
   * @param {string|Buffer} input - 图片路径或 Buffer
   * @returns {Promise<Object>} 元信息

---

## async compress(input, outputPath, options =

```javascript
async compress(input, outputPath, options =
```

* 压缩图片
   * @param {string|Buffer} input - 输入图片
   * @param {string} outputPath - 输出路径
   * @param {Object} options - 压缩选项
   * @returns {Promise<Object>} 处理结果
   *
   * v0.18.0: 新增大文件优化（流式输出、像素限制）

---

## async generateThumbnail(input, outputPath, options =

```javascript
async generateThumbnail(input, outputPath, options =
```

* 生成缩略图
   * @param {string|Buffer} input - 输入图片
   * @param {string} outputPath - 输出路径
   * @param {Object} options - 缩略图选项
   * @returns {Promise<Object>} 处理结果
   *
   * v0.18.0: 新增大文件支持

---

## async convertFormat(input, outputPath, format)

```javascript
async convertFormat(input, outputPath, format)
```

* 转换图片格式
   * @param {string|Buffer} input - 输入图片
   * @param {string} outputPath - 输出路径
   * @param {string} format - 目标格式 (jpeg/png/webp)
   * @returns {Promise<Object>}
   *
   * v0.18.0: 新增大文件支持

---

## async batchProcess(images, operation = "compress")

```javascript
async batchProcess(images, operation = "compress")
```

* 批量处理图片
   * @param {Array} images - 图片列表 [{input, outputPath, options}]
   * @param {string} operation - 操作类型 (compress/thumbnail)
   * @returns {Promise<Array>} 处理结果列表

---

## async rotate(input, outputPath, angle)

```javascript
async rotate(input, outputPath, angle)
```

* 旋转图片
   * @param {string|Buffer} input - 输入图片
   * @param {string} outputPath - 输出路径
   * @param {number} angle - 旋转角度 (90, 180, 270)
   * @returns {Promise<Object>}

---

## async crop(input, outputPath, region)

```javascript
async crop(input, outputPath, region)
```

* 裁剪图片
   * @param {string|Buffer} input - 输入图片
   * @param {string} outputPath - 输出路径
   * @param {Object} region - 裁剪区域 {left, top, width, height}
   * @returns {Promise<Object>}

---

## getSupportedFormats()

```javascript
getSupportedFormats()
```

* 获取支持的格式列表
   * @returns {Array}

---

## updateConfig(newConfig)

```javascript
updateConfig(newConfig)
```

* 更新配置
   * @param {Object} newConfig

---

