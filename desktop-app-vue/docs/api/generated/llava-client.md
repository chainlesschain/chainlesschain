# llava-client

**Source**: `src/main/llm/llava-client.js`

**Generated**: 2026-02-15T07:37:13.824Z

---

## const

```javascript
const
```

* LLaVA 视觉模型客户端
 *
 * 支持本地 Ollama LLaVA 模型进行多模态视觉理解
 *
 * @module llava-client
 * @version 1.0.0

---

## const SUPPORTED_FORMATS = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"];

```javascript
const SUPPORTED_FORMATS = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"];
```

* 支持的图片格式

---

## const DEFAULT_VISION_MODEL = "llava:7b";

```javascript
const DEFAULT_VISION_MODEL = "llava:7b";
```

* 默认视觉模型

---

## class LLaVAClient extends EventEmitter

```javascript
class LLaVAClient extends EventEmitter
```

* LLaVA 客户端类
 * 继承 EventEmitter 以支持事件驱动

---

## async checkStatus()

```javascript
async checkStatus()
```

* 检查 LLaVA 服务状态
   * @returns {Promise<Object>} 服务状态

---

## async imageToBase64(imagePath)

```javascript
async imageToBase64(imagePath)
```

* 将图片转换为 Base64
   * @param {string} imagePath - 图片路径
   * @returns {Promise<string>} Base64 编码的图片

---

## async analyzeImage(

```javascript
async analyzeImage(
```

* 分析图片内容
   * @param {Object} params - 分析参数
   * @param {string} params.imagePath - 图片路径
   * @param {string} [params.imageBase64] - Base64 图片数据（优先使用）
   * @param {string} [params.prompt] - 提示词
   * @param {Object} [options] - 选项
   * @returns {Promise<Object>} 分析结果

---

## async analyzeImageStream(

```javascript
async analyzeImageStream(
```

* 流式分析图片
   * @param {Object} params - 分析参数
   * @param {Function} onChunk - 流式回调
   * @param {Object} [options] - 选项
   * @returns {Promise<Object>} 完整分析结果

---

## async visualQA(

```javascript
async visualQA(
```

* 视觉问答 (VQA)
   * @param {Object} params - 问答参数
   * @param {string} params.imagePath - 图片路径
   * @param {string} [params.imageBase64] - Base64 图片数据
   * @param {string} params.question - 问题
   * @param {Object} [options] - 选项
   * @returns {Promise<Object>} 问答结果

---

## async performOCR(

```javascript
async performOCR(
```

* 图片 OCR（文字识别）
   * @param {Object} params - OCR 参数
   * @param {string} params.imagePath - 图片路径
   * @param {string} [params.imageBase64] - Base64 图片数据
   * @param {string} [params.language] - 语言（默认中英文）
   * @param {Object} [options] - 选项
   * @returns {Promise<Object>} OCR 结果

---

## async describeImage(

```javascript
async describeImage(
```

* 图片描述（详细）
   * @param {Object} params - 描述参数
   * @param {string} params.imagePath - 图片路径
   * @param {string} [params.imageBase64] - Base64 图片数据
   * @param {string} [params.style] - 描述风格 (detailed|brief|technical)
   * @param {Object} [options] - 选项
   * @returns {Promise<Object>} 描述结果

---

## async chat(messages, options =

```javascript
async chat(messages, options =
```

* 聊天对话（带图片上下文）
   * @param {Array} messages - 消息数组（可包含图片）
   * @param {Object} [options] - 选项
   * @returns {Promise<Object>} 对话结果

---

## async pullModel(modelName = DEFAULT_VISION_MODEL, onProgress)

```javascript
async pullModel(modelName = DEFAULT_VISION_MODEL, onProgress)
```

* 拉取视觉模型
   * @param {string} modelName - 模型名称
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<Object>} 拉取结果

---

## updateConfig(config)

```javascript
updateConfig(config)
```

* 更新配置
   * @param {Object} config - 新配置

---

