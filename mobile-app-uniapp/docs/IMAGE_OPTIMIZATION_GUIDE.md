# 图片优化指南

本指南介绍如何在 ChainlessChain mobile-app-uniapp 中使用图片优化功能。

## 功能概述

图片优化工具提供以下功能：

- ✅ **WebP 格式转换**: 自动将图片转换为WebP格式（比JPEG小25-35%）
- ✅ **智能压缩**: 根据平台选择最优压缩方案
- ✅ **尺寸调整**: 自动调整图片尺寸以节省空间
- ✅ **跨平台支持**: App (plus.zip), H5 (Canvas), 微信小程序 (uni API)
- ✅ **批量处理**: 支持批量优化多张图片
- ✅ **WebP 兼容性检测**: 自动检测并回退到JPEG

## 快速开始

### 基础用法

```javascript
import { optimizeImage } from '@/utils/image-optimizer'

// 选择图片
uni.chooseImage({
  count: 1,
  success: async (res) => {
    const tempFilePath = res.tempFilePaths[0]

    try {
      // 优化图片
      const optimizedPath = await optimizeImage(tempFilePath, {
        quality: 0.8,        // 质量: 0-1
        maxWidth: 1920,      // 最大宽度
        maxHeight: 1920,     // 最大高度
        format: 'webp',      // 输出格式
        useWebP: true        // 自动检测WebP支持
      })

      console.log('优化后的图片:', optimizedPath)

      // 上传或保存优化后的图片
      // ...
    } catch (error) {
      console.error('图片优化失败:', error)
    }
  }
})
```

### 批量优化

```javascript
import { batchOptimizeImages } from '@/utils/image-optimizer'

// 选择多张图片
uni.chooseImage({
  count: 9,
  success: async (res) => {
    const imagePaths = res.tempFilePaths

    // 批量优化并显示进度
    const results = await batchOptimizeImages(
      imagePaths,
      {
        quality: 0.8,
        maxWidth: 1920,
        maxHeight: 1920,
        format: 'webp'
      },
      (current, total, result) => {
        console.log(`优化进度: ${current}/${total}`)

        if (result) {
          console.log('优化成功:', result)
        }
      }
    )

    // 处理结果
    const successful = results.filter(r => r.success)
    console.log(`成功优化 ${successful.length}/${results.length} 张图片`)
  }
})
```

### 获取优化统计

```javascript
import {
  optimizeImage,
  getImageSize,
  formatFileSize,
  calculateCompressionRatio
} from '@/utils/image-optimizer'

// 优化前
const originalSize = await getImageSize(originalPath)
console.log('原始大小:', formatFileSize(originalSize))

// 优化
const optimizedPath = await optimizeImage(originalPath)

// 优化后
const optimizedSize = await getImageSize(optimizedPath)
console.log('优化后大小:', formatFileSize(optimizedSize))

// 计算压缩率
const ratio = calculateCompressionRatio(originalSize, optimizedSize)
console.log('压缩率:', ratio)  // 例如: "35.67%"
```

## API 参考

### optimizeImage(imagePath, options)

优化单张图片。

**参数:**
- `imagePath` (String): 图片路径
- `options` (Object): 可选配置
  - `quality` (Number, 默认: 0.8): 图片质量 (0-1)
  - `maxWidth` (Number, 默认: 1920): 最大宽度(像素)
  - `maxHeight` (Number, 默认: 1920): 最大高度(像素)
  - `format` (String, 默认: 'webp'): 输出格式 ('webp' | 'jpg')
  - `useWebP` (Boolean, 默认: true): 是否启用WebP（自动检测）

**返回:** `Promise<String|Blob>` - 优化后的图片路径(App/小程序) 或 Blob对象(H5)

**示例:**
```javascript
const result = await optimizeImage('/path/to/image.jpg', {
  quality: 0.7,
  maxWidth: 1024,
  format: 'webp'
})
```

### batchOptimizeImages(imagePaths, options, onProgress)

批量优化图片。

**参数:**
- `imagePaths` (Array<String>): 图片路径数组
- `options` (Object): 优化选项（同optimizeImage）
- `onProgress` (Function): 进度回调 `(current, total, result) => {}`

**返回:** `Promise<Array>` - 优化结果数组

**示例:**
```javascript
const results = await batchOptimizeImages(
  ['/path/1.jpg', '/path/2.jpg'],
  { quality: 0.8 },
  (current, total) => {
    console.log(`${current}/${total}`)
  }
)
```

### checkWebPSupport()

检测当前平台是否支持WebP。

**返回:** `Promise<Boolean>`

**示例:**
```javascript
const supportsWebP = await checkWebPSupport()
if (supportsWebP) {
  console.log('支持WebP格式')
}
```

### getImageInfo(path)

获取图片信息。

**返回:** `Promise<Object>` - `{ width, height, path, type }`

### getImageSize(path)

获取图片文件大小（字节）。

**返回:** `Promise<Number>`

### formatFileSize(bytes)

格式化文件大小。

**参数:** `bytes` (Number)

**返回:** `String` - 例如: "1.25 MB"

### calculateCompressionRatio(originalSize, compressedSize)

计算压缩率。

**返回:** `String` - 例如: "35.67%"

## 平台差异

### App 平台 (iOS/Android)

- 使用 `plus.zip.compressImage` API
- 支持 WebP 和 JPEG 格式
- 性能最优

### H5 平台

- 使用 Canvas API
- 需要浏览器支持 WebP
- 返回 Blob 对象（需要转换为URL）

**H5 特殊处理:**
```javascript
// H5平台返回Blob，需要转换
const blob = await optimizeImage(imagePath)
const url = URL.createObjectURL(blob)

// 使用完后记得释放
URL.revokeObjectURL(url)
```

### 微信小程序

- 使用 `uni.compressImage` API
- **不支持 WebP 转换**（会自动回退到JPEG）
- 质量参数范围: 0-100

## 性能建议

### 推荐配置

不同场景的推荐配置：

| 场景 | quality | maxWidth | maxHeight | format |
|------|---------|----------|-----------|--------|
| 用户头像 | 0.7 | 512 | 512 | webp |
| 文章封面 | 0.8 | 1280 | 720 | webp |
| 文章内容图 | 0.8 | 1920 | 1920 | webp |
| 缩略图 | 0.6 | 300 | 300 | webp |
| 高质量图片 | 0.9 | 2560 | 1440 | webp |

### 优化策略

1. **智能质量调整**
```javascript
// 根据图片大小动态调整质量
const imageSize = await getImageSize(imagePath)
const quality = imageSize > 5 * 1024 * 1024 ? 0.7 : 0.8  // 大于5MB用较低质量
```

2. **渐进式加载**
```javascript
// 先显示缩略图，后加载原图
const thumbnail = await optimizeImage(imagePath, {
  maxWidth: 300,
  quality: 0.6
})

const fullSize = await optimizeImage(imagePath, {
  maxWidth: 1920,
  quality: 0.8
})
```

3. **缓存优化结果**
```javascript
// 避免重复优化
const cacheKey = `optimized_${imagePath}`
let optimizedPath = uni.getStorageSync(cacheKey)

if (!optimizedPath) {
  optimizedPath = await optimizeImage(imagePath)
  uni.setStorageSync(cacheKey, optimizedPath)
}
```

## 集成到现有代码

### 知识库图片上传

在 `src/pages/knowledge/edit/edit.vue` 中集成:

```javascript
import { optimizeImage, getImageSize, formatFileSize } from '@/utils/image-optimizer'

methods: {
  async handleImageUpload() {
    uni.chooseImage({
      count: 1,
      success: async (res) => {
        const tempFilePath = res.tempFilePaths[0]

        // 显示加载
        uni.showLoading({ title: '优化图片中...' })

        try {
          // 获取原始大小
          const originalSize = await getImageSize(tempFilePath)

          // 优化图片
          const optimizedPath = await optimizeImage(tempFilePath, {
            quality: 0.8,
            maxWidth: 1920,
            maxHeight: 1920,
            format: 'webp'
          })

          // 获取优化后大小
          const optimizedSize = await getImageSize(optimizedPath)

          uni.hideLoading()

          // 显示优化结果
          console.log(`原始: ${formatFileSize(originalSize)} → 优化: ${formatFileSize(optimizedSize)}`)

          // 保存或上传优化后的图片
          await this.saveImage(optimizedPath)

          uni.showToast({
            title: '图片已优化',
            icon: 'success'
          })
        } catch (error) {
          uni.hideLoading()
          console.error('图片优化失败:', error)

          // 失败时使用原图
          await this.saveImage(tempFilePath)

          uni.showToast({
            title: '使用原图上传',
            icon: 'none'
          })
        }
      }
    })
  }
}
```

### AI 对话图片发送

在 `src/pages/ai/chat/conversation.vue` 中集成:

```javascript
import { optimizeImage } from '@/utils/image-optimizer'

methods: {
  async sendImageMessage() {
    uni.chooseImage({
      count: 1,
      success: async (res) => {
        const tempFilePath = res.tempFilePaths[0]

        try {
          // 对话图片使用中等质量，快速上传
          const optimizedPath = await optimizeImage(tempFilePath, {
            quality: 0.75,
            maxWidth: 1280,
            maxHeight: 1280
          })

          await this.sendMessage({
            type: 'image',
            content: optimizedPath
          })
        } catch (error) {
          // 优化失败使用原图
          await this.sendMessage({
            type: 'image',
            content: tempFilePath
          })
        }
      }
    })
  }
}
```

## WebP 格式优势

### 大小对比

典型压缩效果（与同质量JPEG对比）:

| 图片类型 | WebP vs JPEG | 节省空间 |
|---------|--------------|---------|
| 照片 | 25-35% 更小 | 约30% |
| 插图 | 30-50% 更小 | 约40% |
| 简单图形 | 50-70% 更小 | 约60% |

### 浏览器支持

- Chrome: 完全支持
- Safari: iOS 14+ / macOS 11+
- Firefox: 完全支持
- Edge: 完全支持
- 微信浏览器: 支持

本工具会自动检测支持情况并回退到JPEG。

## 故障排除

### 问题: 图片优化后变模糊

**解决方案:**
```javascript
// 提高质量参数
const optimizedPath = await optimizeImage(imagePath, {
  quality: 0.9,  // 提高到0.9
  maxWidth: 2560  // 保留更大尺寸
})
```

### 问题: H5平台Blob转换失败

**解决方案:**
```javascript
// #ifdef H5
const blob = await optimizeImage(imagePath)

// 创建FormData上传
const formData = new FormData()
formData.append('file', blob, 'image.webp')

// 或转换为base64
const reader = new FileReader()
reader.readAsDataURL(blob)
reader.onload = () => {
  const base64 = reader.result
  // 使用base64...
}
// #endif
```

### 问题: 小程序不支持WebP

这是正常的，小程序会自动使用JPEG格式。检查format是否正确回退:

```javascript
import { checkWebPSupport } from '@/utils/image-optimizer'

const supportsWebP = await checkWebPSupport()
console.log('WebP支持:', supportsWebP)  // 小程序会返回false
```

## 性能测试

### 测试压缩效果

```javascript
import {
  optimizeImage,
  getImageSize,
  formatFileSize,
  calculateCompressionRatio
} from '@/utils/image-optimizer'

async function testOptimization(imagePath) {
  const startTime = Date.now()

  const originalSize = await getImageSize(imagePath)

  const optimizedPath = await optimizeImage(imagePath, {
    quality: 0.8,
    format: 'webp'
  })

  const optimizedSize = await getImageSize(optimizedPath)
  const duration = Date.now() - startTime

  console.log('===== 优化测试结果 =====')
  console.log(`原始大小: ${formatFileSize(originalSize)}`)
  console.log(`优化后大小: ${formatFileSize(optimizedSize)}`)
  console.log(`压缩率: ${calculateCompressionRatio(originalSize, optimizedSize)}`)
  console.log(`耗时: ${duration}ms`)
}
```

## 相关文档

- [性能优化报告](../OPTIMIZATION_REPORT.md)
- [性能工具文档](../src/utils/performance.js)
- [uni-app 图片API](https://uniapp.dcloud.net.cn/api/media/image.html)
