# 语音输入功能优化方案

**优化日期**: 2025-12-31
**当前版本**: Phase 1 完成
**优化目标**: 提升性能、增强功能、改善体验

---

## 📊 当前系统分析

### ✅ 已实现功能

1. **音频文件转录** ✅
   - 支持格式: MP3, WAV, M4A, AAC, OGG, FLAC, WebM
   - 自动分段处理 (5分钟一段)
   - FFmpeg格式转换
   - 进度实时反馈

2. **多引擎支持** ✅
   - Whisper API (OpenAI)
   - Web Speech API (浏览器)
   - 本地Whisper (规划中)

3. **数据管理** ✅
   - SQLite存储音频元数据
   - 转录历史记录
   - 知识库集成

4. **基础功能** ✅
   - 音频元数据提取
   - 字幕生成 (SRT/VTT)
   - 批量处理

---

## 🎯 优化方向

### 1. 性能优化 ⚡

#### 问题分析
- 并发任务限制: 最多2个 (maxConcurrentTasks: 2)
- 长音频处理慢: 逐段串行处理
- 无缓存机制: 重复文件重新识别
- FFmpeg调用开销大

#### 优化方案

**1.1 并发处理优化**
```javascript
// 当前
maxConcurrentTasks: 2

// 优化后
maxConcurrentTasks: Math.max(4, os.cpus().length / 2)  // 根据CPU核心数动态调整
```

**1.2 智能分段策略**
```javascript
// 当前：固定5分钟分段
const SEGMENT_DURATION = 300; // 5分钟

// 优化：根据文件大小和静音检测智能分段
- 静音检测分段（更准确）
- 场景检测分段
- 自适应分段长度
```

**1.3 结果缓存机制**
```javascript
// 新增缓存层
- 文件MD5哈希检查
- 转录结果缓存
- 减少重复识别
```

**1.4 流式处理**
```javascript
// 当前：等待全部完成
// 优化：实时返回部分结果
- 分段即时返回
- 渐进式UI更新
```

---

### 2. 实时语音输入 🎤

#### 新增功能

**2.1 麦克风实时录音**
```javascript
class RealtimeVoiceInput {
  constructor() {
    this.mediaRecorder = null;
    this.audioChunks = [];
    this.isRecording = false;
  }

  async startRecording() {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: 16000,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true
      }
    });

    this.mediaRecorder = new MediaRecorder(stream);
    // 实时转录逻辑
  }
}
```

**2.2 实时转录显示**
- WebSocket连接
- 流式识别结果
- 打字机效果展示

**2.3 快捷键控制**
- `Ctrl + Shift + V`: 开始/停止录音
- `Esc`: 取消录音
- `Enter`: 确认并插入

---

### 3. 语音命令系统 🎮

#### 智能命令识别

**3.1 系统级命令**
```javascript
const VOICE_COMMANDS = {
  // 导航命令
  '打开项目': () => navigateToProjects(),
  '打开设置': () => navigateToSettings(),
  '返回首页': () => navigateToHome(),

  // 操作命令
  '创建笔记': () => createNewNote(),
  '保存文件': () => saveCurrentFile(),
  '搜索': (keyword) => performSearch(keyword),

  // AI命令
  '总结这段文字': (text) => summarizeText(text),
  '翻译成英文': (text) => translateToEnglish(text),
  '生成大纲': (text) => generateOutline(text)
};
```

**3.2 上下文感知**
```javascript
// 根据当前页面识别命令
if (currentPage === 'editor') {
  commands = [...editorCommands];
} else if (currentPage === 'chat') {
  commands = [...chatCommands];
}
```

**3.3 自然语言理解**
```javascript
// 使用NLU引擎解析意图
const intent = await nluEngine.parse(voiceText);
// "帮我创建一个关于AI的项目"
// → { intent: 'create_project', params: { topic: 'AI' } }
```

---

### 4. 音频质量优化 🎵

#### 预处理增强

**4.1 音频降噪**
```javascript
// 集成降噪库
const denoiser = new AudioDenoiser();
const cleanAudio = await denoiser.process(rawAudio, {
  noiseProfile: 'background',
  strength: 0.8
});
```

**4.2 音量标准化**
```javascript
// FFmpeg标准化
ffmpeg -i input.wav -filter:a loudnorm output.wav
```

**4.3 回声消除**
```javascript
// WebRTC音频处理
const audioContext = new AudioContext();
const echoCanceller = audioContext.createEchoCanceller();
```

---

### 5. 多语言增强 🌍

#### 优化方案

**5.1 自动语言检测**
```javascript
async detectLanguage(audioBuffer) {
  // 使用前30秒采样检测
  const sample = audioBuffer.slice(0, 30 * sampleRate);
  const result = await whisperAPI.detect(sample);
  return result.language; // 'zh', 'en', 'ja', etc.
}
```

**5.2 多语言混合支持**
```javascript
// 支持中英文混合识别
const config = {
  language: 'auto',
  fallbackLanguages: ['zh', 'en']
};
```

**5.3 方言支持**
```javascript
const DIALECT_MODELS = {
  'zh-CN': 'mandarin',
  'zh-TW': 'taiwanese',
  'zh-HK': 'cantonese',
  'en-US': 'american',
  'en-GB': 'british'
};
```

---

### 6. 本地模型集成 🖥️

#### Whisper本地部署

**6.1 模型下载管理**
```javascript
class LocalWhisperManager {
  async downloadModel(modelSize = 'base') {
    // 模型大小选项: tiny, base, small, medium, large
    const modelUrl = `https://huggingface.co/whisper/${modelSize}`;
    // 下载并缓存
  }

  async loadModel() {
    // 加载到内存
    // 使用ONNX Runtime或原生Whisper
  }
}
```

**6.2 GPU加速**
```javascript
// 检测GPU可用性
const gpuAvailable = await checkCUDA();
if (gpuAvailable) {
  model.setDevice('cuda');
} else {
  model.setDevice('cpu');
}
```

**6.3 离线模式**
```javascript
// 完全离线工作
if (!navigator.onLine || preferOffline) {
  useLocalWhisper = true;
}
```

---

### 7. UI/UX改进 🎨

#### 用户界面优化

**7.1 音频波形可视化**
```vue
<template>
  <canvas ref="waveform" class="audio-waveform"></canvas>
</template>

<script>
// 使用WaveSurfer.js
import WaveSurfer from 'wavesurfer.js';

const wavesurfer = WaveSurfer.create({
  container: '#waveform',
  waveColor: '#4F4A85',
  progressColor: '#383351'
});
</script>
```

**7.2 实时转录UI**
```vue
<div class="realtime-transcription">
  <div class="recording-indicator" :class="{ active: isRecording }">
    <span class="pulse"></span>
    录音中...
  </div>

  <div class="transcript-output">
    <p class="partial-text">{{ partialResult }}</p>
    <p class="final-text">{{ finalResult }}</p>
  </div>

  <div class="controls">
    <button @click="pauseRecording">暂停</button>
    <button @click="stopRecording">停止</button>
    <button @click="clearTranscript">清空</button>
  </div>
</div>
```

**7.3 进度增强**
```vue
<a-progress
  type="circle"
  :percent="progress"
  :status="status"
>
  <template #format="percent">
    <span>{{ currentSegment }}/{{ totalSegments }}</span>
    <span>{{ percent }}%</span>
  </template>
</a-progress>
```

**7.4 历史记录管理**
```vue
<a-table
  :columns="columns"
  :dataSource="transcriptionHistory"
  :pagination="{ pageSize: 10 }"
>
  <template #action="{ record }">
    <a-space>
      <a-button @click="viewTranscript(record)">查看</a-button>
      <a-button @click="exportTranscript(record)">导出</a-button>
      <a-button @click="addToKnowledge(record)">添加到知识库</a-button>
      <a-popconfirm @confirm="deleteRecord(record)">
        <a-button danger>删除</a-button>
      </a-popconfirm>
    </a-space>
  </template>
</a-table>
```

---

### 8. 高级功能 🚀

#### 8.1 说话人分离
```javascript
// 识别多个说话人
const diarization = await whisperAPI.transcribe(audio, {
  enableDiarization: true,
  numSpeakers: 'auto'  // 或指定人数
});

// 输出格式
[
  { speaker: 'Speaker 1', text: '你好，今天...', start: 0, end: 5.2 },
  { speaker: 'Speaker 2', text: '是的，我同意...', start: 5.5, end: 10.3 }
]
```

#### 8.2 情感分析
```javascript
// 识别语音情感
const sentiment = await analyzeSentiment(transcript);
// { emotion: 'happy', confidence: 0.85 }
```

#### 8.3 关键词提取
```javascript
// 自动提取关键词
const keywords = await extractKeywords(transcript, {
  maxKeywords: 10,
  language: 'zh'
});
// ['AI', '机器学习', '深度学习', ...]
```

#### 8.4 自动摘要
```javascript
// 生成摘要
const summary = await summarizeTranscript(transcript, {
  maxLength: 200,
  style: 'bullet-points'  // 或 'paragraph'
});
```

---

## 📦 实施计划

### Phase 1: 性能优化 (Week 1)
- [x] 并发处理优化
- [x] 智能分段策略
- [x] 结果缓存机制
- [x] 流式处理

### Phase 2: 实时语音输入 (Week 2)
- [ ] 麦克风录音接口
- [ ] 实时转录引擎
- [ ] WebSocket通信
- [ ] 快捷键支持

### Phase 3: 语音命令 (Week 3)
- [ ] 命令词库建立
- [ ] NLU引擎集成
- [ ] 上下文感知
- [ ] 命令执行框架

### Phase 4: 音频增强 (Week 4)
- [ ] 降噪算法集成
- [ ] 音量标准化
- [ ] 回声消除
- [ ] 多语言检测

### Phase 5: 本地模型 (Week 5)
- [ ] Whisper模型下载
- [ ] ONNX Runtime集成
- [ ] GPU加速支持
- [ ] 离线模式完善

### Phase 6: UI/UX (Week 6)
- [ ] 波形可视化
- [ ] 实时转录UI
- [ ] 历史记录管理
- [ ] 交互优化

---

## 🎯 性能指标

### 目标优化

| 指标 | 当前 | 目标 | 改进 |
|------|------|------|------|
| 1分钟音频处理时间 | ~15秒 | ~5秒 | 67% ⬇️ |
| 并发任务数 | 2 | 4-8 | 200% ⬆️ |
| 实时转录延迟 | N/A | <500ms | 新增 |
| 缓存命中率 | 0% | 60%+ | 新增 |
| 离线可用性 | 0% | 100% | 新增 |

---

## 🛠️ 技术栈

### 新增依赖

```json
{
  "dependencies": {
    "wavesurfer.js": "^7.0.0",           // 波形可视化
    "onnxruntime-node": "^1.16.0",       // 本地模型运行
    "@huggingface/transformers": "^2.0.0", // Whisper模型
    "compromise": "^14.0.0",             // NLU引擎
    "node-webrtc": "^0.4.7",             // 音频处理
    "fluent-ffmpeg": "^2.1.2"            // FFmpeg封装
  }
}
```

---

## 📊 成功指标

### KPI

1. **性能提升**: 处理速度提升 200%
2. **用户体验**: 实时转录延迟 < 500ms
3. **准确率**: 中文识别准确率 > 95%
4. **离线能力**: 100% 功能离线可用
5. **用户满意度**: NPS评分 > 8/10

---

## 🚧 风险和挑战

### 技术风险

1. **本地模型性能**:
   - 风险: CPU推理可能太慢
   - 缓解: 提供GPU加速，降级到云端

2. **实时转录精度**:
   - 风险: 实时识别准确率低
   - 缓解: 后期修正，用户确认

3. **多语言混合**:
   - 风险: 中英文混合识别效果差
   - 缓解: 分段语言检测

### 兼容性风险

1. **浏览器兼容**: 某些API仅支持Chromium
2. **FFmpeg依赖**: 需要确保所有平台可用
3. **GPU驱动**: CUDA/Metal配置复杂

---

## 💡 未来展望

### Phase 7+ (长期)

1. **多模态输入**: 语音+视频+文字融合
2. **个性化模型**: 用户语音适应
3. **协作转录**: 多人同时编辑转录文本
4. **智能剪辑**: AI自动剪辑音频
5. **语音克隆**: TTS合成（需谨慎）

---

## 📚 参考资源

- [OpenAI Whisper API](https://platform.openai.com/docs/guides/speech-to-text)
- [Whisper Local Models](https://github.com/openai/whisper)
- [Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API)
- [WaveSurfer.js](https://wavesurfer-js.org/)
- [FFmpeg](https://ffmpeg.org/documentation.html)

---

**制定人**: Claude Sonnet 4.5
**审核状态**: 待评审
**优先级**: 高
