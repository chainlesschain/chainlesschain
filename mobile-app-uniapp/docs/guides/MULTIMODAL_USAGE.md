# 多模态功能使用指南

## 📖 概述

移动端多模态管理器支持图像+文本混合输入，可以使用GPT-4V、Claude 3、Qwen-VL等视觉模型进行图像理解。

## 🚀 快速开始

### 1. 基本配置

```javascript
import { getMultimodalManager } from '@/services/llm/multimodal-manager'

const multimodal = getMultimodalManager({
  // API密钥
  openaiApiKey: 'sk-...',
  anthropicApiKey: 'sk-ant-...',
  dashscopeApiKey: 'sk-...',

  // 默认模型
  defaultModel: 'gpt-4-vision-preview',

  // 图像处理配置
  maxImageSize: 2048,
  maxFileSize: 5 * 1024 * 1024,
  imageQuality: 0.8,

  // 缓存配置
  enableCache: true,
  cacheSize: 50
})

// 初始化
await multimodal.initialize()
```

### 2. 图像问答

```javascript
// 单张图像
const result = await multimodal.askAboutImage(
  '/path/to/image.jpg',
  '这张图片中有什么？'
)

console.log(result.content) // AI的回答

// 多张图像
const result2 = await multimodal.askAboutImage(
  ['/path/to/image1.jpg', '/path/to/image2.jpg'],
  '比较这两张图片的异同'
)
```

### 3. 图像描述

```javascript
const result = await multimodal.describeImage('/path/to/image.jpg')

console.log(result.content) // 详细的图像描述
```

### 4. 图像OCR

```javascript
const result = await multimodal.extractTextFromImage('/path/to/document.jpg')

console.log(result.content) // 提取的文字
```

## 📋 完整使用示例

### 场景1: 在笔记中使用图像理解

```vue
<template>
  <view class="image-note">
    <image :src="imagePath" mode="aspectFit" />

    <button @click="analyzeImage">分析图片</button>

    <view v-if="analysis" class="analysis">
      {{ analysis }}
    </view>
  </view>
</template>

<script>
import { getMultimodalManager } from '@/services/llm/multimodal-manager'

export default {
  data() {
    return {
      imagePath: '',
      analysis: ''
    }
  },

  methods: {
    async analyzeImage() {
      const multimodal = getMultimodalManager()

      uni.showLoading({ title: '分析中...' })

      const result = await multimodal.describeImage(this.imagePath, {
        model: 'gpt-4-vision-preview'
      })

      uni.hideLoading()

      if (result.success) {
        this.analysis = result.content
      } else {
        uni.showToast({
          title: '分析失败',
          icon: 'none'
        })
      }
    }
  }
}
</script>
```

### 场景2: 图像问答对话

```javascript
import { getMultimodalManager } from '@/services/llm/multimodal-manager'

export default {
  data() {
    return {
      messages: [],
      currentImage: ''
    }
  },

  methods: {
    async sendMessage(text) {
      const multimodal = getMultimodalManager()

      // 添加用户消息
      const userMessage = {
        role: 'user',
        content: text
      }

      // 如果有图像，添加到消息中
      if (this.currentImage) {
        userMessage.images = [this.currentImage]
      }

      this.messages.push(userMessage)

      // 调用API
      const result = await multimodal.chat(this.messages, {
        model: 'gpt-4-vision-preview'
      })

      if (result.success) {
        // 添加AI回复
        this.messages.push({
          role: 'assistant',
          content: result.content
        })
      }
    },

    selectImage() {
      uni.chooseImage({
        count: 1,
        success: (res) => {
          this.currentImage = res.tempFilePaths[0]
        }
      })
    }
  }
}
```

### 场景3: 批量图像分析

```javascript
async function batchAnalyzeImages(imagePaths) {
  const multimodal = getMultimodalManager()

  const results = []

  for (const imagePath of imagePaths) {
    const result = await multimodal.analyzeImage(imagePath, '内容', {
      model: 'claude-3-haiku' // 使用快速模型
    })

    if (result.success) {
      results.push({
        path: imagePath,
        analysis: result.content
      })
    }
  }

  return results
}
```

### 场景4: 图像信息提取

```javascript
async function extractProductInfo(productImagePath) {
  const multimodal = getMultimodalManager()

  const result = await multimodal.askAboutImage(
    productImagePath,
    `请从这张产品图片中提取以下信息：
    1. 产品名称
    2. 品牌
    3. 主要特征
    4. 价格（如果可见）
    请以JSON格式返回。`,
    {
      model: 'gpt-4-vision-preview',
      maxTokens: 500
    }
  )

  if (result.success) {
    try {
      return JSON.parse(result.content)
    } catch (e) {
      return { raw: result.content }
    }
  }

  return null
}
```

## 🎯 支持的模型

### OpenAI GPT-4V

```javascript
const result = await multimodal.chat(messages, {
  model: 'gpt-4-vision-preview',  // 或 'gpt-4o'
  maxTokens: 1000,
  temperature: 0.7
})
```

**特点**:
- 强大的图像理解能力
- 支持多图像比较
- 支持URL和base64图像

### Anthropic Claude 3

```javascript
const result = await multimodal.chat(messages, {
  model: 'claude-3-sonnet',  // 或 'claude-3-opus', 'claude-3-haiku'
  maxTokens: 1000,
  temperature: 0.7
})
```

**特点**:
- 细致的图像分析
- 较好的OCR能力
- 仅支持base64图像

### Alibaba Qwen-VL

```javascript
const result = await multimodal.chat(messages, {
  model: 'qwen-vl-plus',  // 或 'qwen-vl-max'
  maxTokens: 1000,
  temperature: 0.7
})
```

**特点**:
- 中文理解优秀
- 支持URL和base64
- 性价比高

## 📸 图像输入格式

### 1. 本地文件路径

```javascript
const result = await multimodal.askAboutImage(
  '/path/to/local/image.jpg',
  '描述这张图片'
)
```

### 2. URL

```javascript
const result = await multimodal.askAboutImage(
  'https://example.com/image.jpg',
  '描述这张图片'
)
```

### 3. Base64

```javascript
const result = await multimodal.askAboutImage(
  'data:image/jpeg;base64,/9j/4AAQSkZJRg...',
  '描述这张图片'
)
```

### 4. uni.chooseImage获取的图像

```javascript
uni.chooseImage({
  count: 1,
  success: async (res) => {
    const imagePath = res.tempFilePaths[0]

    const result = await multimodal.askAboutImage(
      imagePath,
      '这是什么？'
    )

    console.log(result.content)
  }
})
```

## 🛠️ 便捷方法

### askAboutImage - 图像问答

```javascript
await multimodal.askAboutImage(images, question, options)
```

### describeImage - 图像描述

```javascript
await multimodal.describeImage(images, options)
```

### extractTextFromImage - 图像OCR

```javascript
await multimodal.extractTextFromImage(images, options)
```

### analyzeImage - 图像分析

```javascript
await multimodal.analyzeImage(images, aspect, options)
```

**aspect可选值**:
- `'内容'` - 分析图像整体内容
- `'情感'` - 分析图像传达的情感
- `'物体'` - 识别图像中的物体
- `'场景'` - 分析图像场景
- `'颜色'` - 分析图像色彩
- 自定义

## ⚡ 性能优化

### 1. 启用缓存

```javascript
const multimodal = getMultimodalManager({
  enableCache: true,
  cacheSize: 50
})
```

相同图像的重复请求会从缓存中获取，大幅提升速度。

### 2. 图像压缩

```javascript
const multimodal = getMultimodalManager({
  maxImageSize: 1024,     // 最大尺寸
  imageQuality: 0.7,      // 压缩质量
  maxFileSize: 2 * 1024 * 1024  // 最大文件大小
})
```

### 3. 选择合适的模型

- **快速响应**: `claude-3-haiku`, `qwen-vl-plus`
- **高质量**: `gpt-4-vision-preview`, `claude-3-opus`
- **平衡**: `claude-3-sonnet`, `qwen-vl-max`

## 📊 统计信息

```javascript
const stats = multimodal.getStats()

console.log(stats)
// {
//   totalRequests: 10,
//   successfulRequests: 9,
//   failedRequests: 1,
//   successRate: '90.00%',
//   imagesProcessed: 15,
//   cacheHits: 5,
//   cacheMisses: 10,
//   cacheHitRate: '33.33%',
//   cacheSize: 10
// }
```

## 🎨 最佳实践

### 1. 提供清晰的问题

❌ 差的问题:
```javascript
await multimodal.askAboutImage(image, '这是啥？')
```

✅ 好的问题:
```javascript
await multimodal.askAboutImage(
  image,
  '请详细描述这张图片中的主要物体、场景和色彩。'
)
```

### 2. 使用结构化输出

```javascript
const result = await multimodal.askAboutImage(
  image,
  `请分析这张图片，以JSON格式返回:
  {
    "objects": ["物体列表"],
    "scene": "场景描述",
    "mood": "情感基调",
    "colors": ["主要颜色"]
  }`
)

const data = JSON.parse(result.content)
```

### 3. 处理失败情况

```javascript
const result = await multimodal.askAboutImage(image, question)

if (!result.success) {
  console.error('分析失败:', result.error)

  // 降级处理
  uni.showToast({
    title: '图像分析暂时不可用',
    icon: 'none'
  })
}
```

### 4. 批处理时控制速率

```javascript
async function batchProcess(images) {
  const results = []

  for (const image of images) {
    const result = await multimodal.describeImage(image)
    results.push(result)

    // 避免过快请求
    await new Promise(resolve => setTimeout(resolve, 1000))
  }

  return results
}
```

## 🔧 错误处理

### 常见错误

1. **API密钥未配置**
   ```
   错误: 未配置API密钥，部分功能可能不可用
   解决: 配置对应模型的API密钥
   ```

2. **图像文件不存在**
   ```
   错误: 读取图像失败: file not found
   解决: 检查图像路径是否正确
   ```

3. **图像文件过大**
   ```
   错误: 图像文件过大，可能需要压缩
   解决: 降低maxFileSize或压缩图像
   ```

4. **模型不支持**
   ```
   错误: 不支持的模型: xxx
   解决: 使用getSupportedModels()查看支持的模型
   ```

## 📝 注意事项

1. **API费用**: 多模态API通常比纯文本更贵，注意控制使用量
2. **隐私**: 上传到API的图像会被第三方处理，注意隐私问题
3. **图像大小**: 过大的图像会增加处理时间和费用
4. **缓存**: 启用缓存可以节省费用和提升速度
5. **网络**: 图像上传需要良好的网络连接

## 🔗 相关文档

- [多模态管理器API文档](./API.md#multimodal)
- [LLM管理器文档](./LLM_MANAGER.md)
- [移动端优化报告](../MOBILE_OPTIMIZATION_REPORT.md)
