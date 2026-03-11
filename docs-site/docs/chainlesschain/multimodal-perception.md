# 多模态感知层

> **版本: v4.1.0 | 状态: ✅ 生产就绪 | 8 IPC Handlers | Phase 84**

ChainlessChain 多模态感知层（Multimodal Perception）集成视觉语言模型、语音识别与合成、文档智能解析和视频理解能力，为 AI Agent 提供全方位的环境感知与跨模态推理能力。

## 核心特性

- 👁️ **屏幕理解**: Vision-Language Model 实时分析屏幕内容，理解 UI 布局与操作上下文
- 🎙️ **语音对话**: Whisper 语音识别 + TTS 语音合成，支持实时语音交互
- 📄 **文档智能**: PDF/PPT/Excel 多格式文档解析，提取结构化信息与语义
- 🎬 **视频理解**: 视频内容分析与关键帧提取，带时间戳的事件检测
- 🧠 **跨模态推理**: 融合视觉、语音、文本等多模态信息进行联合推理

## 系统架构

```
┌──────────────────────────────────────────────────┐
│              用户输入 (多模态)                     │
│  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────────────┐ │
│  │ 屏幕  │  │ 语音  │  │ 文档  │  │ 视频        │ │
│  └───┬──┘  └───┬──┘  └───┬──┘  └──────┬───────┘ │
└──────┼─────────┼─────────┼─────────────┼─────────┘
       │         │         │             │
       ▼         ▼         ▼             ▼
┌──────────────────────────────────────────────────┐
│           多模态感知层 (Perception Engine)         │
│  ┌──────────┐  ┌──────────┐  ┌────────────────┐ │
│  │ VLM 引擎  │  │ Whisper  │  │ 文档解析器     │ │
│  │(屏幕理解) │  │ (ASR/TTS)│  │(PDF/PPT/Excel) │ │
│  └──────────┘  └──────────┘  └────────────────┘ │
│  ┌──────────┐  ┌──────────────────────────────┐  │
│  │视频分析器 │  │    跨模态推理引擎 (Fusion)    │  │
│  └──────────┘  └──────────────────────────────┘  │
└──────────────────────┬───────────────────────────┘
                       │
                       ▼
              ┌─────────────────┐
              │   AI Agent 层   │
              │  (统一感知上下文) │
              └─────────────────┘
```

## 关键文件

| 文件 | 职责 |
| --- | --- |
| `src/main/ai-engine/perception/perception-engine.js` | 多模态感知层核心引擎 |
| `src/main/ai-engine/perception/screen-analyzer.js` | VLM 屏幕分析模块 |
| `src/main/ai-engine/perception/voice-engine.js` | Whisper 语音识别与 TTS 合成 |
| `src/main/ai-engine/perception/document-parser.js` | 多格式文档智能解析 |
| `src/main/ai-engine/perception/video-analyzer.js` | 视频内容分析与关键帧提取 |
| `src/main/ai-engine/perception/cross-modal-fusion.js` | 跨模态信息融合推理 |

## IPC 接口

### 感知操作（8 个）

| 通道                           | 功能           | 说明                                 |
| ------------------------------ | -------------- | ------------------------------------ |
| `perception:analyze-screen`    | 屏幕分析       | VLM 分析当前屏幕内容，返回结构化理解 |
| `perception:start-voice`       | 启动语音       | 开始语音录制与实时识别               |
| `perception:stop-voice`        | 停止语音       | 停止录制，返回完整识别结果           |
| `perception:parse-document`    | 文档解析       | 解析 PDF/PPT/Excel，提取文本与结构   |
| `perception:analyze-video`     | 视频分析       | 分析视频内容，返回带时间戳的事件列表 |
| `perception:cross-modal-query` | 跨模态查询     | 融合多模态上下文回答用户问题         |
| `perception:get-context`       | 获取感知上下文 | 返回当前所有模态的感知状态           |
| `perception:configure`         | 配置感知层     | 更新模型、语言、精度等配置           |

## 使用示例

### 屏幕分析

```javascript
const result = await window.electron.ipcRenderer.invoke(
  "perception:analyze-screen",
  {
    region: "full", // full | selection | active-window
    query: "当前页面显示了什么内容？",
    model: "qwen-vl-plus",
  },
);
// result = { success: true, description: "...", elements: [...], confidence: 0.95 }
```

### 语音对话

```javascript
// 开始语音录制
await window.electron.ipcRenderer.invoke("perception:start-voice", {
  language: "zh-CN",
  realtime: true,
});

// 停止录制并获取识别结果
const result = await window.electron.ipcRenderer.invoke(
  "perception:stop-voice",
);
// result = { success: true, text: "请帮我分析这份报告", confidence: 0.92, duration: 3500 }
```

### 文档解析

```javascript
const result = await window.electron.ipcRenderer.invoke(
  "perception:parse-document",
  {
    filePath: "/path/to/report.pdf",
    extractTables: true,
    extractImages: true,
    ocrFallback: true,
  },
);
// result = { success: true, pages: 12, text: "...", tables: [...], images: [...] }
```

### 视频分析

```javascript
const result = await window.electron.ipcRenderer.invoke(
  "perception:analyze-video",
  {
    filePath: "/path/to/demo.mp4",
    interval: 5, // 每 5 秒采样一帧
    detectEvents: true,
  },
);
// result = { success: true, duration: 120, events: [{ timestamp: 15, description: "用户点击了提交按钮" }, ...] }
```

### 跨模态推理

```javascript
const result = await window.electron.ipcRenderer.invoke(
  "perception:cross-modal-query",
  {
    query: "根据屏幕上的图表和刚才的语音描述，总结数据趋势",
    modalities: ["screen", "voice", "document"],
  },
);
// result = { success: true, answer: "...", sources: [{ modality: "screen", confidence: 0.88 }, ...] }
```

## 配置

在 `.chainlesschain/config.json` 中配置：

```json
{
  "multimodalPerception": {
    "enabled": true,
    "screenAnalysis": {
      "model": "qwen-vl-plus",
      "maxResolution": 1920,
      "captureInterval": 1000
    },
    "voice": {
      "whisperModel": "large-v3",
      "language": "zh-CN",
      "ttsEngine": "edge-tts",
      "ttsVoice": "zh-CN-XiaoxiaoNeural"
    },
    "document": {
      "ocrEngine": "tesseract",
      "maxFileSize": "50MB",
      "supportedFormats": ["pdf", "pptx", "xlsx", "docx"]
    },
    "video": {
      "maxDuration": 600,
      "sampleInterval": 5,
      "gpuAcceleration": true
    }
  }
}
```

## 故障排除

| 问题             | 解决方案                                     |
| ---------------- | -------------------------------------------- |
| 屏幕分析无结果   | 检查 VLM 模型是否已下载，确认 GPU 可用       |
| 语音识别不准确   | 切换 Whisper 模型为 large-v3，检查麦克风设置 |
| 文档解析失败     | 确认文件格式支持，检查文件大小是否超限       |
| 视频分析速度慢   | 启用 GPU 加速，增大采样间隔                  |
| 跨模态查询延迟高 | 减少融合模态数量，使用更轻量模型             |

## 相关文档

- [多模态协作](/chainlesschain/multimodal)
- [Computer Use 计算机操控](/chainlesschain/computer-use)
- [Cowork 多智能体协作](/chainlesschain/cowork)
