# ocr-worker-pool

**Source**: `src/main/image/ocr-worker-pool.js`

**Generated**: 2026-02-21T20:04:16.246Z

---

## const

```javascript
const
```

* OCR Worker 池管理器
 *
 * 解决单Worker顺序处理瓶颈，提供并发OCR能力
 *
 * v0.18.0: 新建文件
 *
 * 核心功能：
 * - 多Worker并发处理（基于CPU核心数）
 * - 任务队列自动管理
 * - 批量OCR优化
 * - Worker生命周期管理

---

## async initialize(lang)

```javascript
async initialize(lang)
```

* 初始化Worker池
   * @param {string} lang - 语言代码 (默认: 'chi_sim+eng')
   * @returns {Promise<void>}

---

## async recognize(image, options =

```javascript
async recognize(image, options =
```

* 识别单张图片
   * @param {string|Buffer} image - 图片路径或Buffer
   * @param {Object} options - 识别选项
   * @returns {Promise<Object>} OCR结果

---

## async recognizeBatch(images, options =

```javascript
async recognizeBatch(images, options =
```

* 批量识别图片
   * @param {Array<string|Buffer>} images - 图片列表
   * @param {Object} options - 识别选项
   * @returns {Promise<Array<Object>>} OCR结果列表

---

## async processQueue()

```javascript
async processQueue()
```

* 处理任务队列（内部方法）

---

## getStats()

```javascript
getStats()
```

* 获取统计信息
   * @returns {Object} 统计数据

---

## async terminate()

```javascript
async terminate()
```

* 关闭Worker池
   * @returns {Promise<void>}

---

## resetStats()

```javascript
resetStats()
```

* 重置统计信息

---

