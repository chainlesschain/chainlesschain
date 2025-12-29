# 语音输入系统使用指南

## 概述

ChainlessChain 现已支持完整的语音输入系统，您可以：
- 将音频文件转录为文本
- 使用多种语音识别引擎
- 自动保存转录结果到知识库
- 管理转录历史和音频文件

## 功能特性

### 1. 音频文件转录
- **支持格式**: MP3, WAV, M4A, AAC, OGG, FLAC, WebM
- **文件大小限制**: 单个文件最大 25MB
- **自动分段**: 超长音频自动分段处理
- **进度反馈**: 实时显示转录进度

### 2. 多引擎支持
- **Whisper API** (OpenAI): 高精度云端识别，支持多语言
- **Whisper Local**: 本地离线识别（Phase 2）
- **Web Speech API**: 浏览器实时识别

### 3. 知识库集成
- 自动将转录文本保存为笔记
- 支持 RAG 检索索引
- 关联原始音频文件

## 快速开始

### 1. 配置 API 密钥

在项目根目录的 `.env` 文件中添加：

```bash
# OpenAI Whisper API 密钥
OPENAI_API_KEY=sk-your-api-key-here

# 可选：自定义 API 地址
OPENAI_BASE_URL=https://api.openai.com/v1
```

### 2. 安装依赖

```bash
cd desktop-app-vue
npm install
```

### 3. 启动应用

```bash
npm run dev
```

## 使用方法

### 方式一：音频导入页面

1. 在应用中导航到"音频导入"页面
2. 选择"上传转录"标签
3. 拖拽或点击上传音频文件
4. 系统自动开始转录
5. 查看转录结果并保存到知识库

### 方式二：程序化调用

在 Vue 组件中使用：

```javascript
// 选择音频文件
const filePaths = await window.electronAPI.speech.selectAudioFiles();

// 转录单个文件
const result = await window.electronAPI.speech.transcribeFile(filePaths[0], {
  engine: 'whisper-api',        // 使用 Whisper API
  language: 'zh',               // 中文
  saveToDatabase: true,         // 保存到数据库
  saveToKnowledge: true,        // 保存到知识库
  addToIndex: true,             // 添加到 RAG 索引
});

console.log('转录结果:', result.text);
console.log('字数:', result.wordCount);
console.log('处理时间:', result.processingTime, 'ms');

// 批量转录
const results = await window.electronAPI.speech.transcribeBatch(filePaths, {
  engine: 'whisper-api',
});
```

### 监听进度事件

```javascript
import { onMounted, onUnmounted } from 'vue';

onMounted(() => {
  window.electronAPI.speech.on('speech:progress', (progress) => {
    console.log('进度:', progress.percent + '%');
    console.log('当前步骤:', progress.step);
  });
});

onUnmounted(() => {
  window.electronAPI.speech.off('speech:progress');
});
```

## 组件使用

### AudioFileUpload 组件

```vue
<template>
  <AudioFileUpload
    :auto-transcribe="true"
    :engine="'whisper-api'"
    @result="handleResult"
    @insert="handleInsert"
  />
</template>

<script setup>
import AudioFileUpload from '@/components/speech/AudioFileUpload.vue';

const handleResult = (result) => {
  console.log('转录完成:', result.text);
};

const handleInsert = (text) => {
  // 插入到编辑器
  console.log('插入文本:', text);
};
</script>
```

## API 参考

### speech.transcribeFile(filePath, options)

转录单个音频文件。

**参数:**
- `filePath` (string): 音频文件路径
- `options` (object):
  - `engine` (string): 识别引擎，默认 'whisper-api'
  - `language` (string): 语言代码，默认 'zh'
  - `saveToDatabase` (boolean): 是否保存到数据库，默认 true
  - `saveToKnowledge` (boolean): 是否保存到知识库，默认 true
  - `addToIndex` (boolean): 是否添加到 RAG 索引，默认 true

**返回:**
```javascript
{
  success: true,
  id: 'audio-file-id',
  knowledgeId: 'knowledge-item-id',
  text: '转录的文本内容',
  language: 'zh',
  engine: 'whisper-api',
  duration: 180.5,          // 音频时长（秒）
  processingTime: 5000,     // 处理时间（毫秒）
  segments: 2,              // 分段数量
  confidence: 0.95,         // 置信度
  wordCount: 1500           // 字数
}
```

### speech.getHistory(limit, offset)

获取转录历史记录。

**参数:**
- `limit` (number): 返回记录数，默认 100
- `offset` (number): 偏移量，默认 0

**返回:**
```javascript
[
  {
    id: 'history-id',
    audio_file_id: 'audio-id',
    engine: 'whisper-api',
    text: '转录内容',
    confidence: 0.95,
    duration: 5000,
    created_at: '2025-12-29T...'
  },
  // ...
]
```

### speech.listAudioFiles(options)

列出所有音频文件。

**参数:**
- `options` (object):
  - `limit` (number): 返回记录数，默认 100
  - `offset` (number): 偏移量，默认 0
  - `orderBy` (string): 排序字段，默认 'created_at'
  - `order` (string): 排序方向，'ASC' 或 'DESC'

### speech.getStats(userId)

获取统计信息。

**返回:**
```javascript
{
  totalFiles: 50,           // 总文件数
  totalSize: 1048576000,    // 总大小（字节）
  totalDuration: 9000,      // 总时长（秒）
  transcribedFiles: 45      // 已转录文件数
}
```

## 配置选项

### 识别引擎配置

编辑 `data/speech-config.json`：

```json
{
  "defaultEngine": "whisper-api",
  "whisperAPI": {
    "apiKey": "sk-...",
    "model": "whisper-1",
    "language": "zh",
    "temperature": 0
  },
  "audio": {
    "targetSampleRate": 16000,
    "targetChannels": 1,
    "maxFileSize": 26214400,
    "segmentDuration": 300
  },
  "knowledgeIntegration": {
    "autoSaveToKnowledge": true,
    "autoAddToIndex": true,
    "defaultType": "note"
  }
}
```

## 数据库表结构

### audio_files 表

存储音频文件元数据：

```sql
CREATE TABLE audio_files (
  id TEXT PRIMARY KEY,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size INTEGER,
  duration REAL,
  format TEXT,
  sample_rate INTEGER,
  channels INTEGER,
  transcription_text TEXT,
  transcription_engine TEXT,
  transcription_confidence REAL,
  language TEXT,
  knowledge_id TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  user_id TEXT DEFAULT 'local-user'
);
```

### transcription_history 表

存储转录历史记录：

```sql
CREATE TABLE transcription_history (
  id TEXT PRIMARY KEY,
  audio_file_id TEXT,
  engine TEXT NOT NULL,
  text TEXT NOT NULL,
  confidence REAL,
  duration REAL,
  status TEXT DEFAULT 'completed',
  error TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

## 故障排除

### 1. FFmpeg 未找到

**问题**: 提示 "FFmpeg 不可用"

**解决**:
- Windows: 下载 FFmpeg 并添加到 PATH
- macOS: `brew install ffmpeg`
- Linux: `sudo apt-get install ffmpeg`

### 2. Whisper API 错误

**问题**: 转录失败，提示 API 密钥无效

**解决**:
1. 检查 `.env` 文件中的 `OPENAI_API_KEY`
2. 确认 API 密钥有效且有余额
3. 检查网络连接

### 3. 文件过大错误

**问题**: 提示 "文件大小超过 25MB 限制"

**解决**:
- 使用音频压缩工具减小文件大小
- 系统会自动分段处理超长音频（>5分钟）

### 4. 权限错误

**问题**: 无法读取音频文件

**解决**:
- 确保应用有文件访问权限
- 检查文件路径是否正确
- Windows: 以管理员身份运行

## 性能优化

### 1. 并发控制

系统默认最多同时处理 2 个音频文件，可在配置中调整：

```json
{
  "performance": {
    "maxConcurrentJobs": 2
  }
}
```

### 2. 缓存配置

```json
{
  "performance": {
    "enableCache": true,
    "cacheExpiration": 3600000
  }
}
```

### 3. 文件清理

定期清理旧文件：

```javascript
// 清理 30 天前的文件
const result = await window.electronAPI.speech.cleanupOldFiles(30);
```

## 费用估算

### Whisper API 定价（仅供参考）

- 价格: $0.006 / 分钟
- 示例: 1小时音频 ≈ $0.36

**节省费用的建议**:
- 使用本地 Whisper（Phase 2）
- 压缩音频文件
- 只转录必要的音频

## 下一步

- [ ] **Phase 2**: 实现本地 Whisper 离线识别
- [ ] **Phase 3**: 添加音频增强（降噪、音量归一化）
- [ ] **Phase 3**: 字幕生成（SRT/VTT）
- [ ] **Phase 3**: 多语言混合识别

## 技术支持

遇到问题？
- 查看 [CLAUDE.md](./CLAUDE.md) 了解项目架构
- 提交 Issue: https://github.com/your-repo/issues
- 查看日志: `data/logs/speech.log`

## 更新日志

### v0.16.0 (2025-12-29)
- ✅ 初始发布
- ✅ 支持 Whisper API 转录
- ✅ 音频文件管理
- ✅ 转录历史记录
- ✅ 知识库集成
- ✅ 完整的 UI 组件

---

**提示**: 本功能基于 OpenAI Whisper API，需要有效的 API 密钥。如果您希望完全离线使用，请等待 Phase 2 的本地 Whisper 实现。
