# ocr-service

**Source**: `src/main/image/ocr-service.js`

**Generated**: 2026-02-21T22:45:05.292Z

---

## const

```javascript
const
```

* OCR 服务
 *
 * 使用 Tesseract.js 进行图片文字识别

---

## const DEFAULT_CONFIG =

```javascript
const DEFAULT_CONFIG =
```

* OCR 配置

---

## class OCRService extends EventEmitter

```javascript
class OCRService extends EventEmitter
```

* OCR 服务类

---

## constructor(config =

```javascript
constructor(config =
```

* @param {Object} config - OCR配置
   * @param {Object} tesseract - Tesseract模块 (可选，用于测试注入)

---

## async initialize()

```javascript
async initialize()
```

* 初始化 OCR Worker

---

## async recognize(image, options =

```javascript
async recognize(image, options =
```

* 识别图片中的文字
   * @param {string|Buffer} image - 图片路径或 Buffer
   * @param {Object} options - 识别选项
   * @returns {Promise<Object>} 识别结果

---

## async recognizeBatch(images, options =

```javascript
async recognizeBatch(images, options =
```

* 批量识别多张图片
   * @param {Array} images - 图片列表
   * @param {Object} options - 识别选项
   * @returns {Promise<Array>} 识别结果列表

---

## async detectTextRegions(image)

```javascript
async detectTextRegions(image)
```

* 检测图片中的文字区域
   * @param {string|Buffer} image - 图片路径或 Buffer
   * @returns {Promise<Array>} 文字区域列表

---

## getSupportedLanguages()

```javascript
getSupportedLanguages()
```

* 获取支持的语言列表
   * @returns {Array} 语言代码列表

---

## evaluateQuality(result)

```javascript
evaluateQuality(result)
```

* 评估识别质量
   * @param {Object} result - 识别结果
   * @returns {Object} 质量评估

---

## getQualityRecommendation(quality)

```javascript
getQualityRecommendation(quality)
```

* 获取质量建议
   * @param {string} quality - 质量等级
   * @returns {string}

---

## async terminate()

```javascript
async terminate()
```

* 终止 OCR Worker

---

## async updateConfig(newConfig)

```javascript
async updateConfig(newConfig)
```

* 更新配置
   * @param {Object} newConfig

---

## getConfig()

```javascript
getConfig()
```

* 获取当前配置
   * @returns {Object}

---

