# 语音输入系统完整实现方案

## 项目概述

实现一个全面的语音输入系统，支持：
1. **改进现有实现**：增强 Web Speech API 实现，添加后端引擎选择
2. **离线语音识别**：集成 Whisper API（OpenAI）和本地 Whisper
3. **音频文件转文字**：上传音频文件并转录为文本
4. **多场景集成**：AI聊天、笔记编辑器、项目聊天、音频文件导入

## 技术架构

### 整体设计
```
前端 Vue 组件层 (VoiceInput.vue + AudioFileUpload.vue)
        ↓ IPC 通信
主进程 IPC Handlers (index.js)
        ↓
speech/ 模块目录
  ├─ speech-manager.js      统一管理器（参考 image-uploader.js）
  ├─ speech-recognizer.js   多引擎识别（Web Speech/Whisper API/本地）
  ├─ audio-processor.js     FFmpeg音频处理（参考 image-processor.js）
  ├─ audio-storage.js       数据库存储
  └─ speech-config.js       配置管理
```

### 语音识别引擎选择

**Phase 1**: Web Speech API（保留） + **OpenAI Whisper API**（新增，优先）
**Phase 2**: Whisper.cpp 本地离线识别（可选）

理由：
- Whisper API 高精度、多语言、易集成
- 本地 Whisper 适合离线场景和敏感数据
- Web Speech API 作为快速输入备选

## 分阶段实施计划

### Phase 1: 基础架构 + Whisper API（核心功能）

#### 任务 1.1: 后端模块创建

**创建文件**：
1. `desktop-app-vue/src/main/speech/speech-manager.js`
   - 继承 EventEmitter（参考 image-uploader.js 第36行）
   - 统一入口，协调所有子模块
   - 核心API：
     ```javascript
     async transcribeFile(filePath, options)  // 音频文件转文字
     async transcribeBatch(filePaths, options) // 批量转录
     async getConfig() / updateConfig(config)  // 配置管理
     async getHistory() / deleteHistory(id)    // 历史记录
     ```
   - 事件：`transcribe-start`, `transcribe-progress`, `transcribe-complete`, `transcribe-error`

2. `desktop-app-vue/src/main/speech/audio-processor.js`
   - FFmpeg 集成（参考 video-engine.js）
   - 音频格式转换为 WAV 16kHz 单声道（Whisper最佳格式）
   - 核心方法：
     ```javascript
     async convertToWhisperFormat(inputPath, outputPath)
     async getMetadata(audioPath)  // 提取时长、采样率等
     async normalizeVolume(inputPath, outputPath)  // 音量归一化
     ```
   - 使用 fluent-ffmpeg（已有依赖）

3. `desktop-app-vue/src/main/speech/speech-recognizer.js`
   - 多引擎抽象层（策略模式）
   - 实现 `WhisperAPIRecognizer` 类
   - OpenAI Whisper API 调用：
     ```javascript
     // POST https://api.openai.com/v1/audio/transcriptions
     // 需要 form-data: file, model='whisper-1', language='zh'
     // 读取 .env 中的 OPENAI_API_KEY
     ```

4. `desktop-app-vue/src/main/speech/audio-storage.js`
   - SQLite 数据库表设计：
     ```sql
     CREATE TABLE audio_files (
       id TEXT PRIMARY KEY,
       file_name TEXT,
       file_path TEXT,
       duration REAL,
       format TEXT,
       transcription_text TEXT,
       transcription_engine TEXT,
       created_at TEXT DEFAULT CURRENT_TIMESTAMP
     );

     CREATE TABLE transcription_history (
       id TEXT PRIMARY KEY,
       audio_file_id TEXT,
       engine TEXT,
       text TEXT,
       confidence REAL,
       status TEXT,
       created_at TEXT DEFAULT CURRENT_TIMESTAMP
     );
     ```

5. `desktop-app-vue/src/main/speech/speech-config.js`
   - 默认配置（参考 llm-config.js）
   - 读取 `.env` 中的 `OPENAI_API_KEY`
   - 引擎配置：whisper-api, webspeech

#### 任务 1.2: IPC 通信实现

**修改文件**：`desktop-app-vue/src/main/index.js`

在 `setupIPC()` 方法中添加（参考 image:* handlers）：
```javascript
// 导入
const SpeechManager = require('./speech/speech-manager');
let speechManager;

// 初始化
async function initializeSpeechManager() {
  if (!speechManager) {
    speechManager = new SpeechManager(dbManager, ragManager);
    await speechManager.initialize();
  }
  return speechManager;
}

// 注册 IPC handlers
ipcMain.handle('speech:transcribe-file', async (event, filePath, options) => {
  const manager = await initializeSpeechManager();
  manager.on('transcribe-progress', (progress) => {
    event.sender.send('speech:progress', progress);
  });
  return await manager.transcribeFile(filePath, options);
});

ipcMain.handle('speech:transcribe-batch', async (event, filePaths, options) => {
  // 批量转录实现
});

ipcMain.handle('speech:select-audio-files', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: '音频文件', extensions: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'] }
    ]
  });
  return result.canceled ? [] : result.filePaths;
});

ipcMain.handle('speech:get-config', async () => {
  // 获取配置
});

ipcMain.handle('speech:update-config', async (event, config) => {
  // 更新配置
});

ipcMain.handle('speech:get-history', async (event, limit, offset) => {
  // 获取历史记录
});
```

**修改文件**：`desktop-app-vue/src/preload/index.js`

添加暴露的API：
```javascript
speech: {
  transcribeFile: (filePath, options) => ipcRenderer.invoke('speech:transcribe-file', filePath, options),
  transcribeBatch: (filePaths, options) => ipcRenderer.invoke('speech:transcribe-batch', filePaths, options),
  selectAudioFiles: () => ipcRenderer.invoke('speech:select-audio-files'),
  getConfig: () => ipcRenderer.invoke('speech:get-config'),
  updateConfig: (config) => ipcRenderer.invoke('speech:update-config', config),
  getHistory: (limit, offset) => ipcRenderer.invoke('speech:get-history', limit, offset),
  on: (event, callback) => ipcRenderer.on(event, (_event, ...args) => callback(...args)),
  off: (event, callback) => ipcRenderer.removeListener(event, callback),
}
```

#### 任务 1.3: 前端组件开发

**修改文件**：`desktop-app-vue/src/renderer/components/projects/VoiceInput.vue`

增强功能：
- 添加引擎选择器（Web Speech / Whisper API）
- 支持调用后端语音识别
- 添加识别质量评分显示

关键改动：
```vue
<script setup>
const selectedEngine = ref('whisper-api');  // 新增
const useBackendRecognition = ref(true);    // 新增

// 新增：使用后端识别
const startBackendRecognition = async () => {
  try {
    // 录音到临时文件
    const audioBlob = await recordAudioToFile();
    const audioPath = await saveTempAudio(audioBlob);

    // 调用后端转录
    const result = await window.electronAPI.speech.transcribeFile(audioPath, {
      engine: selectedEngine.value
    });

    emit('result', result.text);
  } catch (error) {
    handleVoiceError(error);
  }
};

// 监听进度
onMounted(() => {
  window.electronAPI.speech.on('speech:progress', (progress) => {
    progressPercent.value = progress.percent;
  });
});
</script>
```

**创建新文件**：`desktop-app-vue/src/renderer/components/speech/AudioFileUpload.vue`

音频文件上传组件（参考图片上传模式）：
```vue
<template>
  <div class="audio-upload-panel">
    <!-- 文件拖拽上传 -->
    <a-upload-dragger
      :before-upload="handleBeforeUpload"
      :custom-request="handleUpload"
      accept=".mp3,.wav,.m4a,.aac,.ogg,.flac"
      :multiple="true"
    >
      <p class="upload-icon"><InboxOutlined /></p>
      <p class="upload-text">拖拽音频文件到此区域</p>
      <p class="upload-hint">支持 MP3, WAV, M4A 等格式</p>
    </a-upload-dragger>

    <!-- 转录进度 -->
    <div v-if="transcribing" class="progress-section">
      <a-progress :percent="progress" />
      <p>{{ currentFile }} ({{ currentIndex }}/{{ totalFiles }})</p>
    </div>

    <!-- 转录结果列表 -->
    <a-list :data-source="results">
      <template #renderItem="{ item }">
        <a-list-item>
          <a-list-item-meta :title="item.fileName" />
          <div class="result-text">{{ item.text }}</div>
          <template #actions>
            <a @click="copyText(item.text)">复制</a>
            <a @click="insertToNote(item.text)">插入笔记</a>
          </template>
        </a-list-item>
      </template>
    </a-list>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { message } from 'ant-design-vue';

const transcribing = ref(false);
const progress = ref(0);
const results = ref([]);

const handleUpload = async ({ file }) => {
  transcribing.value = true;

  try {
    const result = await window.electronAPI.speech.transcribeFile(file.path, {
      engine: 'whisper-api'
    });

    results.value.push({
      fileName: file.name,
      text: result.text,
      duration: result.duration,
      confidence: result.confidence || 95,
    });

    message.success(`${file.name} 转录完成`);
  } catch (error) {
    message.error(`转录失败: ${error.message}`);
  } finally {
    transcribing.value = false;
  }
};

// 监听进度事件
window.electronAPI.speech.on('speech:progress', (data) => {
  progress.value = data.percent;
});
</script>
```

**创建新文件**：`desktop-app-vue/src/renderer/pages/AudioImportPage.vue`

音频导入页面：
- 集成 AudioFileUpload 组件
- 批量转录历史记录
- 导出字幕文件功能（SRT/VTT）

**修改文件**：`desktop-app-vue/src/renderer/components/editors/MarkdownEditor.vue`

在工具栏添加语音输入按钮（第6-30行工具栏区域）：
```vue
<VoiceInput
  @result="insertVoiceText"
  :use-backend="true"
  :engine="'whisper-api'"
/>
```

添加插入方法：
```javascript
const insertVoiceText = (text) => {
  // 在光标位置插入识别的文本
  const currentContent = content.value;
  content.value = currentContent + '\n\n' + text;
  message.success('语音文本已插入');
};
```

#### 任务 1.4: 依赖包和配置

**修改文件**：`desktop-app-vue/package.json`

添加依赖：
```json
{
  "dependencies": {
    "form-data": "^4.0.0"  // 用于 Whisper API 文件上传
  }
}
```

**修改文件**：`.env`（在根目录）

添加环境变量：
```bash
# 语音识别配置
OPENAI_API_KEY=sk-...           # Whisper API 密钥
SPEECH_DEFAULT_ENGINE=whisper-api
```

#### 任务 1.5: 数据库迁移

**创建文件**：`desktop-app-vue/src/main/database/migrations/002_audio_system.sql`

```sql
-- 音频文件表
CREATE TABLE IF NOT EXISTS audio_files (
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
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  user_id TEXT DEFAULT 'local-user'
);

-- 转录历史表
CREATE TABLE IF NOT EXISTS transcription_history (
  id TEXT PRIMARY KEY,
  audio_file_id TEXT,
  engine TEXT NOT NULL,
  text TEXT NOT NULL,
  confidence REAL,
  duration REAL,
  status TEXT DEFAULT 'completed',
  error TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (audio_file_id) REFERENCES audio_files(id) ON DELETE CASCADE
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_audio_files_user ON audio_files(user_id);
CREATE INDEX IF NOT EXISTS idx_audio_files_created ON audio_files(created_at);
CREATE INDEX IF NOT EXISTS idx_transcription_history_audio ON transcription_history(audio_file_id);
```

**修改文件**：`desktop-app-vue/src/main/database.js`

在初始化方法中运行迁移（参考现有 migrations 目录）

### Phase 2: 离线 Whisper 支持（可选）

**仅在 Phase 1 完成并测试通过后实施**

1. **评估 Whisper.cpp 绑定库**：
   - 方案A: 使用 `whisper-node` npm 包
   - 方案B: 使用 Koffi FFI 自行绑定（参考 ukey/ 目录）

2. **实现 WhisperLocalRecognizer**：
   - 下载和管理模型文件（tiny/base/small）
   - GPU 加速支持（CUDA）

3. **模型管理UI**：
   - 在设置页面添加模型下载功能
   - 模型大小选择

### Phase 3: 高级功能（可选）

**仅在 Phase 2 完成后考虑**

1. 音频增强（降噪、音量归一化）
2. 多语言支持和自动检测
3. 字幕生成（SRT/VTT 导出）
4. 知识库深度集成（自动将转录保存为笔记）

## 关键文件清单

### 需要创建的文件
1. `desktop-app-vue/src/main/speech/speech-manager.js` - 核心管理器
2. `desktop-app-vue/src/main/speech/speech-recognizer.js` - 识别引擎
3. `desktop-app-vue/src/main/speech/audio-processor.js` - 音频处理
4. `desktop-app-vue/src/main/speech/audio-storage.js` - 数据库存储
5. `desktop-app-vue/src/main/speech/speech-config.js` - 配置管理
6. `desktop-app-vue/src/main/database/migrations/002_audio_system.sql` - 数据库迁移
7. `desktop-app-vue/src/renderer/components/speech/AudioFileUpload.vue` - 音频上传组件
8. `desktop-app-vue/src/renderer/pages/AudioImportPage.vue` - 音频导入页面

### 需要修改的文件
1. `desktop-app-vue/src/main/index.js` - 添加 IPC handlers（第1271行 setupIPC 方法）
2. `desktop-app-vue/src/preload/index.js` - 暴露 speech API
3. `desktop-app-vue/src/main/database.js` - 运行数据库迁移
4. `desktop-app-vue/src/renderer/components/projects/VoiceInput.vue` - 增强功能
5. `desktop-app-vue/src/renderer/components/editors/MarkdownEditor.vue` - 添加语音按钮
6. `desktop-app-vue/src/renderer/router/index.js` - 添加音频导入页面路由
7. `desktop-app-vue/package.json` - 添加 form-data 依赖
8. `.env` - 添加 OPENAI_API_KEY

## 实现顺序

**建议按以下顺序实施，确保每一步都可测试**：

1. ✅ **后端基础架构**（1-2天）
   - 创建 speech/ 目录和所有 .js 文件
   - 实现基础类结构和 EventEmitter
   - 数据库迁移

2. ✅ **Whisper API 集成**（1-2天）
   - 实现 speech-recognizer.js 中的 WhisperAPIRecognizer
   - 实现 audio-processor.js FFmpeg 转换
   - 单元测试（手动调用 API）

3. ✅ **IPC 通信**（1天）
   - 在 index.js 注册所有 handlers
   - 在 preload.js 暴露 API
   - 测试前后端通信

4. ✅ **前端组件**（2-3天）
   - 创建 AudioFileUpload.vue
   - 增强 VoiceInput.vue
   - 创建 AudioImportPage.vue
   - 集成到编辑器

5. ✅ **集成测试**（1-2天）
   - 端到端测试
   - 错误处理完善
   - 用户体验优化

## 技术风险与缓解

1. **OpenAI API 限制**：
   - 风险：文件大小限制25MB，速率限制
   - 缓解：自动分段处理，队列管理，显示费用估算

2. **FFmpeg 依赖**：
   - 风险：用户系统未安装 FFmpeg
   - 缓解：启动检测，提供安装指引，降级到直接上传

3. **音频质量问题**：
   - 风险：背景噪音导致识别率低
   - 缓解：提供音频预处理选项，手动编辑结果

4. **API 费用**：
   - 风险：大量使用导致费用高
   - 缓解：显示费用估算，提供本地 Whisper 备选

## 测试计划

### 单元测试
- audio-processor.js: FFmpeg 转换、元数据提取
- speech-recognizer.js: API 调用、错误处理
- audio-storage.js: 数据库 CRUD

### 集成测试
- 完整流程：上传 → 转录 → 保存 → 检索
- 大文件处理（30分钟音频）
- 批量处理（10个文件）

### 用户测试
- 不同口音、语速的中文音频
- 中英混合音频
- 带背景噪音的音频

## 参考模式

**本实现严格参考现有代码模式**：

1. **模块结构**：参考 `src/main/image/` 目录
   - image-uploader.js → speech-manager.js
   - image-processor.js → audio-processor.js
   - ocr-service.js → speech-recognizer.js

2. **EventEmitter 使用**：参考 image-uploader.js 第36-69行
   - 事件转发机制
   - 进度回调

3. **IPC 注册**：参考 index.js 第2147-2200行（llm:chat handler）
   - 事件监听和转发到前端
   - 错误处理模式

4. **前端组件**：参考 VoiceInput.vue
   - 保持现有 UI 风格
   - 状态管理模式

## 成功标准

Phase 1 完成后应实现：
- ✅ 用户可以在聊天界面使用语音输入（Web Speech 或 Whisper API）
- ✅ 用户可以上传音频文件并转录为文本
- ✅ 转录结果可以插入到笔记中
- ✅ 转录历史可查询和管理
- ✅ 音频文件元数据存储在数据库
- ✅ 支持批量转录多个音频文件
