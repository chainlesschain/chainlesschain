# 多模态协作

> **版本: v1.1.0+ | 多模态融合 | 文档解析 | 跨模态上下文 | 多格式输出 | 屏幕录制 (12 IPC)**

多模态协作系统支持文本、图像、音频、文档、屏幕等多种模态的输入融合和多格式输出生成。

## 系统概述

### 架构

```
多模态协作 (4 模块)
├─ ModalityFusion        — 5 模态输入融合
├─ DocumentParser        — 多格式文档解析
├─ MultimodalContext     — 跨模态上下文构建
└─ MultimodalOutput      — 多格式输出生成
```

### 数据流

```
输入                      处理                      输出
─────                    ─────                    ─────
文本 ───┐              ┌─ OCR提取 ──┐
图像 ───┤              │            │
音频 ───┤→ Modality ──→│ 文档解析 ──┤→ Multimodal ──→ Multimodal ──→ Markdown
文档 ───┤   Fusion     │            │   Context       Output        HTML
屏幕 ───┘              └─ 转录 ────┘                               图表
                                                                   幻灯片
                                                                   JSON/CSV
```

---

## 模态融合引擎

### 支持的模态

| 模态       | 处理方式                     | 说明                   |
| ---------- | ---------------------------- | ---------------------- |
| `text`     | 直接输入                     | 文本消息、代码片段     |
| `image`    | Tesseract OCR + Sharp 预处理 | 截图、照片中的文字提取 |
| `audio`    | 语音转录（预留接口）         | 语音输入               |
| `document` | DocumentParser 解析          | PDF/DOCX/XLSX 等       |
| `screen`   | 屏幕截图 + OCR               | 当前屏幕内容           |

### 会话管理

每个多模态交互创建一个会话，支持多次输入：

```json
{
  "sessionId": "session-uuid",
  "inputs": [
    { "modality": "text", "content": "分析这个错误" },
    { "modality": "image", "path": "/tmp/screenshot.png" },
    { "modality": "document", "path": "/docs/api-spec.pdf" }
  ],
  "status": "processing",
  "maxInputs": 20
}
```

### 图像处理流程

```
原始图像 → Sharp 预处理 (灰度/锐化/缩放)
         → Tesseract OCR 文字识别
         → 提取文本内容
         → 融合到上下文
```

---

## 文档解析

### 支持格式

| 格式     | 解析内容                 | 库依赖    |
| -------- | ------------------------ | --------- |
| PDF      | 文本、表格、图片、页结构 | pdf-parse |
| DOCX     | 段落、标题、表格、图片   | mammoth   |
| XLSX     | 工作表、行列、命名区域   | xlsx      |
| TXT      | 纯文本                   | 内置      |
| Markdown | 结构化文本               | 内置      |
| CSV      | 结构化数据               | 内置      |
| JSON     | 结构化数据               | 内置      |

### 解析配置

```json
{
  "documentParser": {
    "maxFileSizeMB": 50,
    "maxPages": 100,
    "csvDelimiter": ",",
    "encoding": "utf-8",
    "extractTables": true,
    "extractImages": false
  }
}
```

### 解析示例

```
PDF 解析结果:
{
  "pages": 15,
  "text": "...",
  "tables": [
    { "page": 3, "rows": [...] }
  ],
  "metadata": {
    "title": "API 设计文档",
    "author": "张三"
  }
}
```

---

## 跨模态上下文

### 上下文构建

将多模态输入融合为 LLM 可理解的统一上下文：

```
多模态输入                    统一上下文
──────────                   ──────────
[文本] "分析错误"      →     "用户请求分析错误。
[截图] error.png       →      屏幕截图OCR内容：TypeError: xxx
[文档] api-spec.pdf    →      参考文档：API规范第3章..."
```

### Token 预算管理

```json
{
  "contextBudget": {
    "maxTokens": 4000,
    "modalityWeights": {
      "text": 1.0,
      "document": 0.9,
      "image": 0.8,
      "audio": 0.7,
      "screen": 0.6
    }
  }
}
```

- 按权重分配 Token 预算
- 高权重模态获得更多上下文空间
- 按相关性 + 时间优先级排序
- 上下文缓存 5 分钟 TTL
- 每个上下文最多 15 个输入

---

## 多格式输出

### 输出格式

| 格式       | 说明             | 用途           |
| ---------- | ---------------- | -------------- |
| `markdown` | Markdown 文本    | 技术文档、笔记 |
| `html`     | HTML 页面        | 邮件、网页     |
| `chart`    | ECharts 图表配置 | 数据可视化     |
| `slides`   | Reveal.js 幻灯片 | 演示文稿       |
| `json`     | JSON 数据        | 结构化输出     |
| `csv`      | CSV 数据         | 表格导出       |

### 内置模板

| 模板               | 说明       |
| ------------------ | ---------- |
| `technical-report` | 技术报告   |
| `api-docs`         | API 文档   |
| `analysis-slides`  | 分析幻灯片 |
| `data-dashboard`   | 数据仪表盘 |

### 输出配置

```json
{
  "output": {
    "maxSizeBytes": 5242880,
    "defaultFormat": "markdown",
    "chartLibrary": "echarts",
    "slideFramework": "revealjs"
  }
}
```

---

## 关键文件

| 文件                                              | 职责             |
| ------------------------------------------------- | ---------------- |
| `src/main/ai-engine/cowork/modality-fusion.js`    | 5 模态输入融合   |
| `src/main/ai-engine/cowork/document-parser.js`    | 多格式文档解析   |
| `src/main/ai-engine/cowork/multimodal-context.js` | 跨模态上下文构建 |
| `src/main/ai-engine/cowork/multimodal-output.js`  | 多格式输出生成   |
| `src/main/ai-engine/cowork/evolution-ipc.js`      | IPC 处理器       |
