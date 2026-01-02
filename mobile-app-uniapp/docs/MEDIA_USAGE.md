# 统一媒体管理系统 - 使用指南

> 移动端统一媒体管理系统 v2.2.0
> 支持文档、图片、视频、音频的完整生命周期管理

---

## 快速开始

```javascript
import { createMediaManager } from '@/services/media/media-manager.js'

// 创建管理器实例
const db = uni.requireNativePlugin('SQLite')
const mediaManager = createMediaManager(db)

// 初始化
await mediaManager.initialize()

// 导入文件
const file = await mediaManager.importFile({
  name: 'document.pdf',
  path: '/storage/documents/document.pdf',
  size: 1024 * 500,  // 500KB
  tags: ['工作', '重要']
})

console.log('文件已导入:', file.id)
```

---

## 支持的文件类型

### 文档类型
- **PDF**: `.pdf`
- **Word**: `.doc`, `.docx`
- **文本**: `.txt`, `.md`, `.markdown`

### 图片类型
- **常用格式**: `.jpg`, `.jpeg`, `.png`, `.gif`
- **现代格式**: `.webp`
- **位图**: `.bmp`

### 视频类型
- **常用格式**: `.mp4`, `.mov`, `.avi`
- **现代格式**: `.mkv`, `.webm`

### 音频类型
- **常用格式**: `.mp3`, `.wav`, `.m4a`
- **其他格式**: `.aac`, `.ogg`

---

## 文件大小限制（移动端优化）

| 文件类型 | 最大大小 |
|---------|---------|
| 文档 | 50 MB |
| 图片 | 20 MB |
| 视频 | 200 MB |
| 音频 | 50 MB |

---

## 核心功能

### 1. 导入单个文件

```javascript
const fileData = {
  name: 'presentation.pdf',
  path: '/storage/documents/presentation.pdf',
  size: 1024 * 1024 * 5,  // 5MB
  pageCount: 20,  // PDF页数（可选）
  tags: ['工作', '演示']  // 标签（可选）
}

// 带进度回调
const file = await mediaManager.importFile(fileData, {
  extractText: true,  // 提取文本内容
  generateThumbnail: true,  // 生成缩略图
  onProgress: (progress) => {
    console.log(`导入进度: ${progress.stage} - ${progress.progress}%`)
  }
})

console.log('导入成功:', file.id)
```

**进度阶段**:
- `validating`: 验证文件 (10%)
- `processing`: 处理文件 (30%)
- `metadata`: 提取元数据 (50%)
- `thumbnail`: 生成缩略图 (70%)
- `text`: 提取文本 (90%)
- `complete`: 完成 (100%)

### 2. 批量导入文件

```javascript
const files = [
  { name: 'doc1.pdf', path: '/storage/doc1.pdf', size: 1000000 },
  { name: 'image1.jpg', path: '/storage/image1.jpg', size: 500000 },
  { name: 'video1.mp4', path: '/storage/video1.mp4', size: 50000000 }
]

const result = await mediaManager.importFiles(files, {
  extractText: true,
  generateThumbnail: true,
  onProgress: (progress) => {
    console.log(`批量导入: ${progress.current}/${progress.total} - ${progress.file}`)
  }
})

console.log('成功:', result.success.length)
console.log('失败:', result.failed.length)

// 处理失败的文件
result.failed.forEach(item => {
  console.error(`${item.file} 导入失败: ${item.error}`)
})
```

### 3. 查询文件

#### 获取所有文件

```javascript
const allFiles = await mediaManager.getAllFiles()
```

#### 按类型过滤

```javascript
// 获取所有文档
const documents = await mediaManager.getAllFiles({ type: 'document' })

// 获取所有图片
const images = await mediaManager.getAllFiles({ type: 'image' })

// 获取所有视频
const videos = await mediaManager.getAllFiles({ type: 'video' })
```

#### 按大小过滤

```javascript
// 获取5MB以上的文件
const largeFiles = await mediaManager.getAllFiles({
  minSize: 5 * 1024 * 1024
})

// 获取1-10MB之间的文件
const mediumFiles = await mediaManager.getAllFiles({
  minSize: 1 * 1024 * 1024,
  maxSize: 10 * 1024 * 1024
})
```

#### 按日期过滤

```javascript
// 获取最近7天的文件
const recent = await mediaManager.getAllFiles({
  startDate: Date.now() - 7 * 24 * 60 * 60 * 1000
})

// 获取特定日期范围的文件
const rangeFiles = await mediaManager.getAllFiles({
  startDate: new Date('2024-01-01').getTime(),
  endDate: new Date('2024-01-31').getTime()
})
```

#### 按标签过滤

```javascript
// 获取带有"工作"标签的文件
const workFiles = await mediaManager.getAllFiles({
  tags: ['工作']
})

// 获取带有多个标签之一的文件
const taggedFiles = await mediaManager.getAllFiles({
  tags: ['重要', '紧急']
})
```

#### 组合过滤

```javascript
// 获取最近7天、大于1MB的工作文档
const filtered = await mediaManager.getAllFiles({
  type: 'document',
  minSize: 1 * 1024 * 1024,
  startDate: Date.now() - 7 * 24 * 60 * 60 * 1000,
  tags: ['工作']
})
```

### 4. 根据ID获取文件

```javascript
const file = await mediaManager.getFileById('media_1234567890_abc')

if (file) {
  console.log('文件名:', file.name)
  console.log('类型:', file.type)
  console.log('大小:', mediaManager.formatFileSize(file.size))
  console.log('标签:', file.tags)
}
```

### 5. 搜索文件

```javascript
// 搜索文件名包含"报告"的文件
const results = await mediaManager.searchFiles('报告')

// 搜索会匹配：
// - 文件名
// - 提取的文本内容
// - 标签
```

### 6. 更新文件信息

```javascript
// 更新文件名
await mediaManager.updateFile(fileId, {
  name: 'new-name.pdf'
})

// 更新标签
await mediaManager.updateFile(fileId, {
  tags: ['新标签1', '新标签2']
})

// 同时更新多个字段
const updated = await mediaManager.updateFile(fileId, {
  name: 'updated-document.pdf',
  tags: ['已更新', '重要']
})

console.log('更新后:', updated)
```

### 7. 删除文件

```javascript
// 删除单个文件（软删除）
await mediaManager.deleteFile(fileId)

// 批量删除
const deletedCount = await mediaManager.deleteFiles([id1, id2, id3])
console.log(`已删除 ${deletedCount} 个文件`)
```

---

## 统计信息

### 1. 获取总体统计

```javascript
const stats = await mediaManager.getStatistics()

console.log('总文件数:', stats.total)
console.log('总大小:', mediaManager.formatFileSize(stats.totalSize))
console.log('文档数:', stats.document)
console.log('图片数:', stats.image)
console.log('视频数:', stats.video)
console.log('音频数:', stats.audio)

// 按类型详细统计
console.log('文档总大小:', stats.byType.document?.totalSize || 0)
console.log('图片总大小:', stats.byType.image?.totalSize || 0)
```

### 2. 获取最近文件

```javascript
// 获取最近10个文件
const recent = await mediaManager.getRecentFiles(10)

recent.forEach(file => {
  console.log(`${file.name} - ${new Date(file.createdAt).toLocaleString()}`)
})
```

### 3. 获取最大文件

```javascript
// 获取最大的10个文件
const largest = await mediaManager.getLargestFiles(10)

largest.forEach(file => {
  console.log(`${file.name} - ${mediaManager.formatFileSize(file.size)}`)
})
```

---

## 工具方法

### 格式化文件大小

```javascript
console.log(mediaManager.formatFileSize(1024))           // "1 KB"
console.log(mediaManager.formatFileSize(1024 * 1024))    // "1 MB"
console.log(mediaManager.formatFileSize(1024 * 1024 * 1024))  // "1 GB"
```

### 格式化时长

```javascript
console.log(mediaManager.formatDuration(60))    // "01:00"
console.log(mediaManager.formatDuration(3661))  // "01:01:01"
```

### 获取支持的格式

```javascript
const formats = mediaManager.getSupportedFormats()

console.log('支持的文档格式:', formats.document)
// ["pdf", "doc", "docx", "txt", "md", "markdown"]

console.log('支持的图片格式:', formats.image)
// ["jpg", "jpeg", "png", "gif", "webp", "bmp"]
```

### 获取文件大小限制

```javascript
const limits = mediaManager.getFileSizeLimits()

console.log('文档最大:', limits.document)  // 52428800 (50MB)
console.log('图片最大:', limits.image)     // 20971520 (20MB)
console.log('视频最大:', limits.video)     // 209715200 (200MB)
```

---

## 完整示例

### 示例1: 文件管理器应用

```javascript
// 初始化
const mediaManager = createMediaManager(db)
await mediaManager.initialize()

// 获取所有文件并显示
const files = await mediaManager.getAllFiles()

files.forEach(file => {
  console.log('='.repeat(40))
  console.log('文件名:', file.name)
  console.log('类型:', file.type)
  console.log('大小:', mediaManager.formatFileSize(file.size))

  if (file.duration) {
    console.log('时长:', mediaManager.formatDuration(file.duration))
  }

  if (file.width && file.height) {
    console.log('尺寸:', `${file.width}x${file.height}`)
  }

  if (file.pageCount) {
    console.log('页数:', file.pageCount)
  }

  if (file.tags.length > 0) {
    console.log('标签:', file.tags.join(', '))
  }

  console.log('创建时间:', new Date(file.createdAt).toLocaleString())
})

// 显示统计信息
const stats = await mediaManager.getStatistics()
console.log('\n统计信息:')
console.log('总文件数:', stats.total)
console.log('总大小:', mediaManager.formatFileSize(stats.totalSize))
console.log('文档:', stats.document, '个')
console.log('图片:', stats.image, '个')
console.log('视频:', stats.video, '个')
console.log('音频:', stats.audio, '个')
```

### 示例2: 图库应用

```javascript
// 获取所有图片
const images = await mediaManager.getAllFiles({ type: 'image' })

// 按大小排序
const sortedImages = images.sort((a, b) => b.size - a.size)

// 显示图片网格
sortedImages.forEach(image => {
  console.log(`${image.name} (${image.width}x${image.height})`)
  console.log(`缩略图: ${image.thumbnailPath}`)
  console.log(`大小: ${mediaManager.formatFileSize(image.size)}`)
})
```

### 示例3: 文档搜索

```javascript
// 搜索关键词
const query = '合同'
const results = await mediaManager.searchFiles(query)

console.log(`找到 ${results.length} 个匹配的文件:`)

results.forEach(file => {
  console.log(`- ${file.name} (${file.type})`)

  // 如果有提取的文本，显示匹配片段
  if (file.extractedText) {
    const index = file.extractedText.indexOf(query)
    if (index !== -1) {
      const start = Math.max(0, index - 50)
      const end = Math.min(file.extractedText.length, index + 50)
      const snippet = file.extractedText.substring(start, end)
      console.log(`  摘要: ...${snippet}...`)
    }
  }
})
```

---

## 移动端特别说明

### 1. 平台API集成

媒体管理器的某些功能需要与平台API集成：

**缩略图生成**:
```javascript
// 需要使用 uni.compressImage 或平台原生API
uni.compressImage({
  src: filePath,
  quality: 70,
  success: (res) => {
    thumbnailPath = res.tempFilePath
  }
})
```

**图片尺寸获取**:
```javascript
// 需要使用 uni.getImageInfo
uni.getImageInfo({
  src: filePath,
  success: (res) => {
    width = res.width
    height = res.height
  }
})
```

**视频信息获取**:
```javascript
// 需要使用平台视频API
const videoContext = uni.createVideoContext('videoId')
// 获取视频时长、尺寸等信息
```

### 2. 文本提取

**纯文本文件**:
```javascript
// 使用 uni.getFileSystemManager 读取
const fs = uni.getFileSystemManager()
const text = fs.readFileSync(filePath, 'utf8')
```

**PDF文件**:
```javascript
// 使用 PDF.js 或平台PDF解析库
import * as pdfjsLib from 'pdfjs-dist'
// 提取PDF文本
```

**图片OCR**:
```javascript
// 使用云服务OCR API（如阿里云、腾讯云）
// 或使用 Tesseract.js
```

### 3. 性能优化

- **懒加载**: 大文件列表使用虚拟滚动
- **缓存**: 频繁访问的文件自动缓存5分钟
- **批量操作**: 使用进度回调提供用户反馈
- **文件限制**: 严格执行文件大小限制

---

## 常见问题

### Q1: 如何备份所有媒体文件？

```javascript
// 1. 获取所有文件信息
const allFiles = await mediaManager.getAllFiles()

// 2. 导出文件列表
const backup = {
  exportDate: Date.now(),
  version: '2.2.0',
  files: allFiles.map(f => ({
    id: f.id,
    name: f.name,
    type: f.type,
    size: f.size,
    filePath: f.filePath,
    tags: f.tags,
    createdAt: f.createdAt
  }))
}

// 3. 保存到文件
const fs = uni.getFileSystemManager()
fs.writeFileSync('/storage/backup.json', JSON.stringify(backup, null, 2), 'utf8')
```

### Q2: 如何清理大文件释放空间？

```javascript
// 获取最大的文件
const largest = await mediaManager.getLargestFiles(20)

// 让用户选择删除
largest.forEach(file => {
  console.log(`${file.name} - ${mediaManager.formatFileSize(file.size)}`)
})

// 删除选中的文件
await mediaManager.deleteFiles(selectedIds)
```

### Q3: 如何实现文件分类？

```javascript
// 使用标签系统
await mediaManager.updateFile(fileId, {
  tags: ['工作', '项目A', '2024年']
})

// 按标签查询
const projectAFiles = await mediaManager.getAllFiles({
  tags: ['项目A']
})
```

### Q4: 如何处理重复文件？

```javascript
// 获取所有文件
const allFiles = await mediaManager.getAllFiles()

// 按名称和大小分组
const groups = {}
allFiles.forEach(file => {
  const key = `${file.name}_${file.size}`
  if (!groups[key]) groups[key] = []
  groups[key].push(file)
})

// 找出重复文件
const duplicates = Object.values(groups).filter(g => g.length > 1)

// 删除重复项（保留第一个）
duplicates.forEach(async (group) => {
  const toDelete = group.slice(1).map(f => f.id)
  await mediaManager.deleteFiles(toDelete)
})
```

---

更多信息请参考完整报告: `MOBILE_MEDIA_COMPLETE_REPORT.md`
