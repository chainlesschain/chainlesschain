# 多媒体功能前端UI集成

本目录包含了ChainlessChain多媒体功能的前端UI组件，提供完整的图片、音频、视频处理界面。

## 📁 组件清单

### 核心组件（3个）

| 组件 | 文件 | 功能描述 | 代码行数 |
|------|------|----------|----------|
| **进度监控面板** | `ProgressMonitor.vue` | 实时显示所有任务进度，支持层级任务 | ~550行 |
| **多媒体处理控制台** | `MediaProcessor.vue` | 图片、音频、OCR批量处理 | ~650行 |
| **视频编辑器** | `VideoEditor.vue` | 13种滤镜、音轨处理、高级字幕 | ~750行 |

### 工具类（1个）

| 工具 | 文件 | 功能描述 | 代码行数 |
|------|------|----------|----------|
| **MultimediaAPI** | `../../utils/multimedia-api.js` | IPC通信封装，简化API调用 | ~320行 |

### 演示页面（1个）

| 页面 | 文件 | 功能描述 | 代码行数 |
|------|------|----------|----------|
| **MultimediaDemo** | `../../pages/MultimediaDemo.vue` | 完整演示页面，整合所有组件 | ~600行 |

---

## 🚀 快速开始

### 1. 导入组件

```vue
<script setup>
import ProgressMonitor from '@/components/multimedia/ProgressMonitor.vue';
import MediaProcessor from '@/components/multimedia/MediaProcessor.vue';
import VideoEditor from '@/components/multimedia/VideoEditor.vue';
import multimediaAPI from '@/utils/multimedia-api';
</script>
```

### 2. 使用组件

```vue
<template>
  <div>
    <!-- 进度监控（全局） -->
    <ProgressMonitor ref="progressMonitor" />

    <!-- 多媒体处理 -->
    <MediaProcessor />

    <!-- 视频编辑 -->
    <VideoEditor />
  </div>
</template>
```

### 3. API调用示例

```javascript
// 上传图片（带进度回调）
const result = await multimediaAPI.uploadImage(
  imagePath,
  {
    quality: 85,
    maxWidth: 1920,
    compress: true,
    performOCR: true
  },
  (progress) => {
    console.log('进度:', progress.percent, '%');
    console.log('消息:', progress.message);
  }
);

// 批量OCR识别
const results = await multimediaAPI.batchOCR(
  imagePaths,
  {
    languages: ['chi_sim', 'eng'],
    maxWorkers: 3
  },
  (progress) => {
    console.log('批量进度:', progress.percent);
  }
);

// 应用视频滤镜
await multimediaAPI.applyVideoFilter(
  inputPath,
  outputPath,
  {
    filterType: 'sepia',
    intensity: 1.5
  },
  (progress) => {
    console.log('滤镜处理进度:', progress.percent);
  }
);
```

---

## 📊 组件详细说明

### ProgressMonitor（进度监控面板）

**功能特性**：
- ✅ 实时显示所有活动任务
- ✅ 任务分类（活动、已完成、失败）
- ✅ 7种任务阶段（等待、准备、处理、收尾、完成、失败、取消）
- ✅ 层级进度聚合（父子任务）
- ✅ 自动清理过期任务
- ✅ 节流控制（减少90%事件）

**Props**：
```typescript
{
  maxCompletedTasks: number; // 最多保留的已完成任务数，默认10
}
```

**暴露方法**：
```javascript
// 手动添加任务
progressMonitor.value.addTask({
  taskId: 'task-1',
  title: '视频转换',
  description: '处理video.mp4',
  percent: 0
});

// 更新任务
progressMonitor.value.updateTask('task-1', {
  percent: 50,
  message: '处理中...'
});

// 移除任务
progressMonitor.value.removeTask('task-1');

// 清空所有
progressMonitor.value.clearAll();
```

**事件监听**：
组件自动监听主进程的 `task-progress` 事件，无需手动绑定。

---

### MediaProcessor（多媒体处理控制台）

**功能特性**：
- ✅ 图片上传和批量处理
- ✅ 图片压缩（质量、尺寸、格式转换）
- ✅ OCR识别（多语言、Worker池并发）
- ✅ 音频转录（多引擎、批量处理）
- ✅ 处理结果展示

**Tab页签**：
1. **图片处理** - 压缩、OCR、知识库集成
2. **音频转录** - 多引擎转录、批量处理
3. **批量OCR** - Worker池并发识别

**配置选项**：

```javascript
// 图片处理选项
{
  quality: 85,           // 压缩质量 (1-100)
  maxWidth: 1920,        // 最大宽度
  format: 'jpeg',        // 输出格式
  compress: true,        // 是否压缩
  generateThumbnail: true, // 生成缩略图
  performOCR: false,     // 执行OCR
  addToKnowledge: false  // 添加到知识库
}

// 音频转录选项
{
  engine: 'whisper',     // 转录引擎
  language: 'zh'         // 语言
}

// OCR选项
{
  languages: ['chi_sim', 'eng'], // 识别语言
  maxWorkers: 3          // 并发Worker数
}
```

---

### VideoEditor（视频编辑器）

**功能特性**：
- ✅ 13种视频滤镜效果
- ✅ 滤镜链组合
- ✅ 音轨提取/分离/替换
- ✅ 音量调节（支持归一化）
- ✅ 高级字幕样式（10+参数）
- ✅ 4种字幕预设风格
- ✅ 基础编辑（裁剪、转换、压缩）

**滤镜列表**：
```javascript
[
  'blur',        // 模糊
  'sharpen',     // 锐化
  'grayscale',   // 黑白
  'sepia',       // 怀旧
  'vignette',    // 暗角
  'brightness',  // 亮度
  'contrast',    // 对比度
  'saturation',  // 饱和度
  'negative',    // 负片
  'mirror',      // 镜像
  'flip',        // 翻转
  'vintage',     // 复古
  'cartoon'      // 卡通
]
```

**字幕预设**：
```javascript
{
  default: {   // 默认风格
    fontSize: 24,
    fontColor: '#FFFFFF',
    outlineWidth: 2
  },
  cinema: {    // 影院风格
    fontSize: 28,
    bold: true,
    marginV: 40,
    shadowDepth: 3
  },
  minimal: {   // 简约风格
    fontSize: 20,
    outlineWidth: 1,
    shadowDepth: 0
  },
  bold: {      // 粗体风格
    fontSize: 26,
    fontColor: '#FFFF00',
    glowEffect: true
  }
}
```

---

## 🔌 IPC通信API

`MultimediaAPI` 类封装了所有与主进程的IPC通信，提供简洁的Promise API。

### 图片处理API

```javascript
// 上传单张图片
await multimediaAPI.uploadImage(imagePath, options, onProgress);

// 批量上传图片
await multimediaAPI.uploadImages(imagePaths, options, onProgress);

// 批量OCR识别
await multimediaAPI.batchOCR(imagePaths, options, onProgress);

// 图片压缩
await multimediaAPI.compressImage(imagePath, options);
```

### 音频处理API

```javascript
// 音频转录
await multimediaAPI.transcribeAudio(audioPath, options, onProgress);

// 批量转录
await multimediaAPI.batchTranscribe(audioPaths, options, onProgress);
```

### 视频处理API

```javascript
// 获取视频信息
await multimediaAPI.getVideoInfo(videoPath);

// 应用滤镜
await multimediaAPI.applyVideoFilter(inputPath, outputPath, options, onProgress);

// 应用滤镜链
await multimediaAPI.applyVideoFilterChain(inputPath, outputPath, filters, onProgress);

// 提取音频
await multimediaAPI.extractAudio(inputPath, outputPath, onProgress);

// 分离音轨
await multimediaAPI.separateAudioTracks(inputPath, outputDir);

// 替换音轨
await multimediaAPI.replaceAudio(videoPath, audioPath, outputPath, onProgress);

// 调整音量
await multimediaAPI.adjustVolume(inputPath, outputPath, volumeLevel, options, onProgress);

// 添加字幕
await multimediaAPI.addSubtitles(inputPath, subtitlePath, outputPath, options, onProgress);

// 使用预设添加字幕
await multimediaAPI.addSubtitlesWithPreset(inputPath, subtitlePath, outputPath, presetName, onProgress);

// 格式转换
await multimediaAPI.convertVideo(inputPath, outputPath, options, onProgress);

// 裁剪视频
await multimediaAPI.trimVideo(inputPath, outputPath, options, onProgress);

// 压缩视频
await multimediaAPI.compressVideo(inputPath, outputPath, options, onProgress);

// 生成缩略图
await multimediaAPI.generateThumbnail(inputPath, outputPath, options);

// 合并视频
await multimediaAPI.mergeVideos(videoPaths, outputPath, options, onProgress);
```

---

## 🎨 样式定制

所有组件都使用SCSS编写，支持自定义主题色。

### 主题色变量

```scss
// 修改组件内部变量即可自定义主题
.progress-monitor {
  // 主色调
  --primary-color: #667eea;
  --secondary-color: #764ba2;

  // 状态颜色
  --success-color: #52c41a;
  --error-color: #f5222d;
  --warning-color: #faad14;
}
```

---

## 📡 事件监听

### 主进程事件

组件自动监听以下主进程事件：

```javascript
// 任务进度事件
window.electronAPI.on('task-progress', (event, data) => {
  // data: { taskId, title, percent, stage, message, ... }
});

// 视频处理进度（特定）
window.electronAPI.on('video:processing-progress', (event, data) => {
  // data: { percent, message, taskType }
});
```

### 组件事件

```javascript
// ProgressMonitor组件事件
<ProgressMonitor
  @task-complete="handleTaskComplete"
  @task-error="handleTaskError"
/>

// MediaProcessor组件事件
<MediaProcessor
  @upload-start="handleUploadStart"
  @upload-complete="handleUploadComplete"
  @batch-progress="handleBatchProgress"
/>
```

---

## 📊 性能优化建议

### 1. 大文件处理

```javascript
// 大文件启用流式处理
await multimediaAPI.uploadImage(largePath, {
  quality: 70,        // 降低质量
  maxWidth: 1920,     // 限制尺寸
  compress: true      // 启用压缩
});
```

### 2. 批量操作

```javascript
// 批量操作使用并发API
await multimediaAPI.uploadImages(paths, options, (progress) => {
  console.log(`批量进度: ${progress.current}/${progress.total}`);
});
```

### 3. 进度节流

```javascript
// ProgressEmitter已内置节流（100ms），无需手动处理
// 如需自定义，修改throttleInterval参数
const emitter = new ProgressEmitter({
  throttleInterval: 200 // 200ms节流
});
```

---

## 🐛 常见问题

### Q1: 进度不更新？

**A**: 确保主进程已集成`ProgressEmitter`，并发送`task-progress`事件。

```javascript
// 主进程示例
this.progressEmitter.on('progress', (data) => {
  mainWindow.webContents.send('task-progress', data);
});
```

### Q2: IPC调用失败？

**A**: 检查主进程是否注册了对应的IPC handler。

```javascript
// 主进程注册
ipcMain.handle('image:upload', async (event, params) => {
  // ...
});
```

### Q3: 组件样式冲突？

**A**: 使用scoped样式，或添加唯一class前缀。

```vue
<style scoped lang="scss">
.my-custom-prefix {
  .progress-monitor {
    // 自定义样式
  }
}
</style>
```

---

## 📖 更多示例

完整示例请查看：`src/renderer/pages/MultimediaDemo.vue`

该页面展示了所有组件的集成使用方法和最佳实践。

---

## 🔗 相关文档

- [后端多媒体优化报告](../../../../MULTIMEDIA_OPTIMIZATION_REPORT.md)
- [ResumableProcessor API](../../../main/utils/resumable-processor.js)
- [ProgressEmitter API](../../../main/utils/progress-emitter.js)
- [VideoEngine API](../../../main/engines/video-engine.js)

---

## 🤝 贡献指南

欢迎提交Issue和PR来改进组件！

**开发规范**：
- 使用Vue3 Composition API
- 使用TypeScript类型注解
- 遵循Ant Design Vue组件规范
- 保持代码简洁和可维护性

---

**Created with 🤖 [Claude Code](https://claude.com/claude-code)**
