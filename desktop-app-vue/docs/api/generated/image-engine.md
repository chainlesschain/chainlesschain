# image-engine

**Source**: `src/main/engines/image-engine.js`

**Generated**: 2026-02-16T22:06:51.487Z

---

## const

```javascript
const
```

* 图像设计引擎
 * 负责AI文生图、背景移除、图片增强和批量处理
 * 使用Sharp进行图像处理，支持AI图像生成

---

## async handleProjectTask(params, onProgress = null)

```javascript
async handleProjectTask(params, onProgress = null)
```

* 处理项目任务
   * @param {Object} params - 任务参数
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<Object>} 处理结果

---

## async generateImageFromText(

```javascript
async generateImageFromText(
```

* AI文生图
   * @param {string} prompt - 文本描述
   * @param {string} outputPath - 输出文件路径
   * @param {Object} options - 生成选项
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<Object>} 生成结果

---

## async generateWithStableDiffusion(prompt, options, onProgress)

```javascript
async generateWithStableDiffusion(prompt, options, onProgress)
```

* 使用Stable Diffusion生成图片
   * @param {string} prompt - 提示词
   * @param {Object} options - 选项
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<Buffer>} 图片缓冲区

---

## async generateWithDALLE(prompt, options, onProgress)

```javascript
async generateWithDALLE(prompt, options, onProgress)
```

* 使用DALL-E生成图片
   * @param {string} prompt - 提示词
   * @param {Object} options - 选项
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<Buffer>} 图片缓冲区

---

## async generatePlaceholderImage(width, height, text)

```javascript
async generatePlaceholderImage(width, height, text)
```

* 生成占位图
   * @param {number} width - 宽度
   * @param {number} height - 高度
   * @param {string} text - 文本
   * @returns {Promise<Buffer>} 图片缓冲区

---

## async removeBackground(

```javascript
async removeBackground(
```

* 移除背景
   * @param {string} inputPath - 输入文件路径
   * @param {string} outputPath - 输出文件路径
   * @param {Object} options - 选项
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<Object>} 处理结果

---

## async resizeImage(inputPath, outputPath, options =

```javascript
async resizeImage(inputPath, outputPath, options =
```

* 调整图片大小
   * @param {string} inputPath - 输入文件路径
   * @param {string} outputPath - 输出文件路径
   * @param {Object} options - 选项
   * @returns {Promise<Object>} 处理结果

---

## async cropImage(inputPath, outputPath, options =

```javascript
async cropImage(inputPath, outputPath, options =
```

* 裁剪图片
   * @param {string} inputPath - 输入文件路径
   * @param {string} outputPath - 输出文件路径
   * @param {Object} options - 选项
   * @returns {Promise<Object>} 处理结果

---

## async enhanceImage(inputPath, outputPath, options =

```javascript
async enhanceImage(inputPath, outputPath, options =
```

* 增强图片
   * @param {string} inputPath - 输入文件路径
   * @param {string} outputPath - 输出文件路径
   * @param {Object} options - 选项
   * @returns {Promise<Object>} 处理结果

---

## async upscaleImage(inputPath, outputPath, options =

```javascript
async upscaleImage(inputPath, outputPath, options =
```

* 图片超分辨率
   * @param {string} inputPath - 输入文件路径
   * @param {string} outputPath - 输出文件路径
   * @param {Object} options - 选项
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<Object>} 处理结果

---

## async addWatermark(inputPath, outputPath, options =

```javascript
async addWatermark(inputPath, outputPath, options =
```

* 添加水印
   * @param {string} inputPath - 输入文件路径
   * @param {string} outputPath - 输出文件路径
   * @param {Object} options - 选项
   * @returns {Promise<Object>} 处理结果

---

## async batchProcess(imageList, outputDir, options =

```javascript
async batchProcess(imageList, outputDir, options =
```

* 批量处理图片
   * @param {Array<string>} imageList - 图片路径列表
   * @param {string} outputDir - 输出目录
   * @param {Object} options - 处理选项
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<Object>} 处理结果

---

## async convertFormat(inputPath, outputPath, options =

```javascript
async convertFormat(inputPath, outputPath, options =
```

* 转换图片格式
   * @param {string} inputPath - 输入文件路径
   * @param {string} outputPath - 输出文件路径
   * @param {Object} options - 选项
   * @returns {Promise<Object>} 处理结果

---

## async createCollage(imageList, outputPath, options =

```javascript
async createCollage(imageList, outputPath, options =
```

* 创建图片拼贴
   * @param {Array<string>} imageList - 图片路径列表
   * @param {string} outputPath - 输出文件路径
   * @param {Object} options - 选项
   * @returns {Promise<Object>} 处理结果

---

## async getImageInfo(imagePath)

```javascript
async getImageInfo(imagePath)
```

* 获取图片信息
   * @param {string} imagePath - 图片文件路径
   * @returns {Promise<Object>} 图片信息

---

## function getImageEngine(llmManager = null)

```javascript
function getImageEngine(llmManager = null)
```

* 获取图像引擎实例
 * @param {Object} llmManager - LLM管理器
 * @returns {ImageEngine}

---

