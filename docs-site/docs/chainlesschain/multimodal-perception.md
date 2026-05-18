# 多模态感知层

> **版本: v4.1.0 | 状态: ✅ 生产就绪 | 8 IPC Handlers | Phase 84**

## 概述

多模态感知层集成视觉语言模型（VLM）、Whisper 语音识别与合成、多格式文档智能解析和视频理解能力，为 AI Agent 提供全方位的环境感知与跨模态推理。系统支持屏幕实时分析、语音对话、PDF/PPT/Excel 文档提取以及视频关键帧检测，并通过跨模态融合引擎将多种输入信息联合推理，构建统一的感知上下文。

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

## 故障排查

### 常见问题

| 症状 | 可能原因 | 解决方案 |
| --- | --- | --- |
| 图像 OCR 精度低 | 图片分辨率不足或文字倾斜 | 预处理图片（增强对比度、纠偏），使用高分辨率输入 |
| 语音识别延迟高 | 音频采样率不匹配或模型过大 | 确认采样率为 16kHz，切换轻量模型 |
| 文档解析格式错误 | PDF 含扫描页或表格嵌套复杂 | 启用 OCR 模式处理扫描页，使用 `--table-mode` |
| 屏幕分析无输出 | 截屏权限未授予或分辨率过高 | 检查系统截屏权限，降低捕获分辨率 |
| 多模态融合结果质量差 | 模态间对齐不准确 | 减少融合模态数量，提高单模态质量 |

### 常见错误修复

**错误: `OCR_LOW_CONFIDENCE` OCR 识别置信度低**

```bash
# 使用增强预处理重新识别
chainlesschain perception ocr --file <image> --preprocess enhance

# 指定语言模型提高精度
chainlesschain perception ocr --file <image> --lang chi_sim+eng
```

**错误: `ASR_TIMEOUT` 语音识别超时**

```bash
# 检查音频格式和采样率
chainlesschain perception audio-info --file <audio>

# 使用流式识别模式
chainlesschain perception asr --file <audio> --mode streaming
```

**错误: `DOC_PARSE_FAILED` 文档解析失败**

```bash
# 使用 OCR 模式解析扫描 PDF
chainlesschain perception parse --file <pdf> --ocr-mode

# 分页解析大文档
chainlesschain perception parse --file <pdf> --pages 1-10
```

## 配置参考

以下为完整配置项说明：

| 配置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | 是否启用多模态感知层 |
| `screenAnalysis.model` | string | `"qwen-vl-plus"` | 屏幕分析使用的视觉语言模型 |
| `screenAnalysis.maxResolution` | number | `1920` | 截屏最大宽度（像素），超出自动缩放 |
| `screenAnalysis.captureInterval` | number | `1000` | 连续分析时的截屏间隔（毫秒） |
| `voice.whisperModel` | string | `"large-v3"` | Whisper 语音识别模型（`base` / `medium` / `large-v3`） |
| `voice.language` | string | `"zh-CN"` | 默认语音识别语言 |
| `voice.ttsEngine` | string | `"edge-tts"` | 语音合成引擎 |
| `voice.ttsVoice` | string | `"zh-CN-XiaoxiaoNeural"` | TTS 合成音色 |
| `document.ocrEngine` | string | `"tesseract"` | OCR 引擎（需本地安装） |
| `document.maxFileSize` | string | `"50MB"` | 文档解析最大文件体积 |
| `document.supportedFormats` | array | `["pdf","pptx","xlsx","docx"]` | 支持的文档格式列表 |
| `video.maxDuration` | number | `600` | 视频分析最大时长（秒） |
| `video.sampleInterval` | number | `5` | 关键帧采样间隔（秒） |
| `video.gpuAcceleration` | boolean | `true` | 是否启用 GPU 加速视频解码 |

---

## 性能指标

多模态感知层在典型硬件（RTX 3080 / Apple M2）下的基准数据：

| 模态 | 操作 | 延迟（GPU） | 延迟（CPU） | 说明 |
| --- | --- | --- | --- | --- |
| 屏幕理解 | 单帧 VLM 分析 | ~800ms | ~4500ms | 1080p 截图，`qwen-vl-plus` |
| 语音识别 | 10 秒音频转写 | ~600ms | ~2200ms | Whisper `large-v3`，16kHz |
| 文档解析 | PDF 10 页提取 | ~1200ms | ~1500ms | 含文字层 PDF，无需 OCR |
| 文档 OCR | PDF 10 页扫描版 | ~3500ms | ~8000ms | Tesseract OCR 回退 |
| 视频分析 | 60 秒视频关键帧 | ~2000ms | ~9000ms | 每 5 秒采样，12 帧 |
| 跨模态融合 | 3 模态联合推理 | ~1500ms | ~5000ms | 屏幕 + 语音 + 文档 |

**性能调优建议**：
- 屏幕分析优先启用 GPU 加速；无 GPU 时将 `captureInterval` 调高至 3000ms 避免堆积
- 长文档建议分页解析（每批 10 页），防止单次解析内存溢出
- 视频分析增大 `sampleInterval`（如 10s）可显著降低延迟，适合长视频概述场景

---

## 测试覆盖率

| 测试类型 | 文件 | 用例数 | 覆盖场景 |
| --- | --- | --- | --- |
| 单元测试 | `tests/unit/ai-engine/perception/screen-analyzer.test.js` | 22 | VLM 调用、区域裁剪、置信度过滤 |
| 单元测试 | `tests/unit/ai-engine/perception/voice-engine.test.js` | 19 | ASR 启停、语言检测、TTS 合成 |
| 单元测试 | `tests/unit/ai-engine/perception/document-parser.test.js` | 28 | PDF/PPTX/XLSX 解析、OCR 回退、大文件限制 |
| 单元测试 | `tests/unit/ai-engine/perception/video-analyzer.test.js` | 17 | 关键帧提取、时间戳标注、时长限制 |
| 单元测试 | `tests/unit/ai-engine/perception/cross-modal-fusion.test.js` | 21 | 模态对齐、融合推理、单模态降级 |
| 集成测试 | `tests/integration/perception-e2e.test.js` | 11 | 8 个 IPC 通道端到端响应格式、配置热更新 |
| **合计** | — | **118** | — |

**核心测试用例**：
- `ScreenAnalyzer` — 全屏/区域/活动窗口三种捕获模式，VLM 超时降级处理
- `VoiceEngine` — 实时 ASR 流断开重连，TTS 合成音频格式兼容性
- `DocumentParser` — 含表格/图片的复合 PDF 解析，OCR 精度低于阈值时的警告上报
- `CrossModalFusion` — 任意模态缺失时的单模态回退，融合结果 sources 字段准确性

---

## 安全考虑

- **屏幕隐私**: 屏幕分析仅在用户显式触发时执行，不后台持续截屏
- **语音数据本地化**: 语音识别优先使用本地 Whisper 模型，音频数据不上传云端
- **文档访问控制**: 文档解析遵循文件系统权限，加密文件需先解密后解析
- **视频帧过滤**: 视频分析支持指定区域和时间段，避免采集无关隐私画面
- **跨模态数据隔离**: 各模态感知数据独立存储，融合推理仅在内存中进行
- **临时数据清理**: 截屏、音频录制等临时文件在分析完成后自动清理

## 故障深度排查

### 图像识别失败

1. **VLM 模型检查**: 确认 `qwen-vl-plus` 或配置的视觉模型已下载到本地（`chainlesschain llm models` 查看）
2. **GPU 可用性**: VLM 推理需要 GPU 加速，运行 `chainlesschain doctor` 检查 CUDA/Metal 状态；无 GPU 时切换到轻量模型
3. **分辨率限制**: `maxResolution` 默认 1920，超大屏幕截图可能被裁剪导致识别不完整，可适当调大
4. **截屏权限**: macOS 需在系统偏好设置中授予屏幕录制权限，Linux 需确认 X11/Wayland 截屏工具可用

### 语音流断开

| 现象 | 排查步骤 |
|------|---------|
| 实时识别中途停止 | 检查麦克风设备是否被其他应用占用；确认 `realtime: true` 已设置；查看 Whisper 进程是否因内存不足被 OOM Kill |
| 识别结果为空 | 确认麦克风音量正常（非静音），检查 `language` 配置是否与实际语言匹配 |
| 延迟过高(>3s) | 切换 Whisper 模型为 `base` 或 `medium`（`large-v3` 精度高但推理慢），启用 GPU 加速 |

### 文档解析错误

1. **格式支持**: 确认文件后缀在 `supportedFormats` 列表中（pdf/pptx/xlsx/docx），不支持 `.doc` 等旧格式
2. **文件大小**: 超过 `maxFileSize`（默认 50MB）的文件将被拒绝，大文件建议分割后解析
3. **OCR 回退**: 扫描版 PDF 无文本层时需 `ocrFallback: true`，确认 Tesseract 已安装（`tesseract --version`）
4. **表格提取失败**: 复杂合并单元格可能导致表格结构错乱，尝试设置 `extractTables: false` 跳过表格提取

## 相关文档

- [多模态协作](/chainlesschain/multimodal)
- [Computer Use 计算机操控](/chainlesschain/computer-use)
- [Cowork 多智能体协作](/chainlesschain/cowork)
