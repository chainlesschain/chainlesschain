# 多模态协作

> v1.1.0 新功能

## 概述

多模态协作系统支持文本、文档、图像、屏幕截图等多种输入模态的统一融合处理，并提供 Markdown、HTML、ECharts 图表和 PPT 等多格式输出生成能力。系统内置智能 Token 预算管理，自动优化上下文窗口分配，确保在最大 128K Token 限制内高效利用多模态信息。

## 核心特性

- 🔀 **多模态输入融合**: 文本 + 文档 + 图像 + 屏幕截图统一处理，构建跨模态上下文
- 🎯 **智能 Token 预算**: 自动管理上下文窗口（最大 128K），优化 Token 分配与使用
- 📄 **多格式文档解析**: 支持 PDF、Word、TXT、Markdown 等格式的结构化提取
- 📊 **丰富输出格式**: Markdown、HTML、ECharts 图表、PPT 演示文稿一键生成
- 🖥️ **屏幕捕获**: 一键截取屏幕内容作为输入，支持全屏/区域/窗口模式

## 系统架构

```
┌──────────────────────────────────────────────┐
│             多模态输入层                      │
│  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────────┐ │
│  │ 文本  │  │ 文档  │  │ 图像  │  │ 屏幕截图 │ │
│  └───┬──┘  └───┬──┘  └───┬──┘  └────┬─────┘ │
└──────┼─────────┼─────────┼──────────┼────────┘
       │         │         │          │
       ▼         ▼         ▼          ▼
┌──────────────────────────────────────────────┐
│         融合引擎 (Modality Fusion)            │
│  ┌──────────────┐  ┌──────────────────────┐  │
│  │ Token 预算管理 │  │ 上下文构建器         │  │
│  └──────────────┘  └──────────────────────┘  │
└──────────────────────┬───────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────┐
│          输出生成引擎 (Output Generator)      │
│  ┌────────┐  ┌──────┐  ┌───────┐  ┌──────┐ │
│  │Markdown│  │ HTML │  │ECharts│  │ PPT  │ │
│  └────────┘  └──────┘  └───────┘  └──────┘ │
└──────────────────────────────────────────────┘
```

## 关键文件

| 文件 | 职责 |
| --- | --- |
| `src/main/ai-engine/cowork/modality-fusion.js` | 多模态输入融合引擎 |
| `src/main/ai-engine/cowork/multimodal-context.js` | 跨模态上下文构建与 Token 预算管理 |
| `src/main/ai-engine/cowork/multimodal-output.js` | 多格式输出生成引擎 |
| `src/main/ai-engine/cowork/document-parser.js` | 文档解析器（PDF/Word/TXT/MD） |
| `src/renderer/stores/multimodal.ts` | Pinia 状态管理 |

## 系统概述

多模态协作系统（Multimodal Collaboration）支持文本、文档、图像、屏幕截图等多种输入模态的融合，提供智能上下文构建和多格式输出生成能力。

### 核心能力

- **多模态输入融合**：文本 + 文档 + 图像 + 屏幕截图统一处理
- **智能 Token 预算**：自动管理上下文窗口，优化 Token 使用
- **文档解析**：支持 PDF、Word、TXT、Markdown 等格式
- **屏幕捕获**：一键截取屏幕内容作为输入
- **多格式输出**：Markdown、HTML、ECharts 图表、PPT 演示文稿

## IPC 通道

| 通道                          | 说明               |
| ----------------------------- | ------------------ |
| `mm:fuse-input`               | 融合多模态输入     |
| `mm:parse-document`           | 解析文档           |
| `mm:build-context`            | 构建上下文         |
| `mm:get-session`              | 获取会话详情       |
| `mm:get-supported-modalities` | 获取支持的模态列表 |
| `mm:capture-screen`           | 捕获屏幕           |
| `mm:generate-output`          | 生成指定格式输出   |
| `mm:get-artifacts`            | 获取会话产物       |
| `mm:get-stats`                | 获取统计数据       |

## 配置

在 `.chainlesschain/config.json` 中配置：

```json
{
  "multimodal": {
    "enabled": true,
    "maxTokenBudget": 128000,
    "supportedModalities": ["text", "document", "image", "screen"],
    "documentFormats": [".pdf", ".doc", ".docx", ".txt", ".md"],
    "imageFormats": [".png", ".jpg", ".jpeg", ".gif", ".webp"],
    "outputFormats": ["markdown", "html", "echarts", "ppt"]
  }
}
```

## 使用示例

### 基本流程

1. 打开「多模态协作」页面
2. 选择输入模态（文本/文档/图像/屏幕）
3. 添加一个或多个输入项
4. 点击「融合输入」，系统构建统一上下文
5. 选择输出格式并点击「生成输出」
6. 在渲染区查看生成结果

### 典型使用场景

- **会议纪要**：截取白板照片 + 文本笔记 → 生成 Markdown 文档
- **代码审查**：代码截图 + 需求文档 → 生成审查报告
- **数据分析**：CSV 数据文件 + 分析描述 → 生成 ECharts 图表

## 故障排除

| 问题           | 解决方案                            |
| -------------- | ----------------------------------- |
| Token 预算超限 | 减少输入内容或提高 `maxTokenBudget` |
| 文档解析失败   | 检查文件格式是否在支持列表中        |
| 屏幕捕获失败   | 确认应用有屏幕录制权限              |

## 故障排查

| 问题 | 可能原因 | 解决方案 |
| --- | --- | --- |
| Token 预算超限 | 输入内容总量超过 `maxTokenBudget` | 减少输入项数量或内容长度，或调大 `maxTokenBudget`（默认 128000） |
| 文档解析失败 | 文件格式不在支持列表中 | 确认文件扩展名为 `.pdf/.doc/.docx/.txt/.md` 之一 |
| 屏幕捕获失败 | 应用缺少屏幕录制权限 | macOS 需在「系统偏好设置 → 隐私 → 屏幕录制」中授权，Windows 需管理员权限 |
| 图像输入无法识别 | 图片格式不支持或文件损坏 | 使用 `.png/.jpg/.jpeg/.gif/.webp` 格式，确认文件可正常打开 |
| ECharts 输出为空 | 输入数据不包含可视化数据 | 确保输入中包含结构化数据（如 CSV、表格），并在描述中指明图表类型 |
| PPT 生成内容缺失 | 上下文信息不足 | 增加文本描述或补充更多文档输入，提供足够的内容素材 |
| 融合结果质量差 | 多模态输入之间缺乏关联 | 在文本描述中明确说明各输入之间的关系和期望的融合方式 |

---

## 配置参考

在 `.chainlesschain/config.json` 中配置多模态系统行为：

```json
{
  "multimodal": {
    "enabled": true,
    "maxTokenBudget": 128000,
    "tokenBudgetAllocation": {
      "text": 0.4,
      "document": 0.3,
      "image": 0.2,
      "screen": 0.1
    },
    "supportedModalities": ["text", "document", "image", "screen"],
    "documentFormats": [".pdf", ".doc", ".docx", ".txt", ".md"],
    "imageFormats": [".png", ".jpg", ".jpeg", ".gif", ".webp"],
    "outputFormats": ["markdown", "html", "echarts", "ppt"],
    "screen": {
      "defaultMode": "full",
      "quality": 85,
      "maxResolution": "1920x1080"
    },
    "document": {
      "maxPagesPDF": 50,
      "extractImages": true
    }
  }
}
```

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `maxTokenBudget` | `128000` | 单次融合最大 Token 预算 |
| `tokenBudgetAllocation` | 见上 | 各模态 Token 配额占比（合计须等于 1.0） |
| `screen.defaultMode` | `"full"` | 屏幕捕获模式（`full` / `region` / `window`） |
| `screen.quality` | `85` | 截图压缩质量（1–100） |
| `document.maxPagesPDF` | `50` | PDF 解析最大页数限制 |
| `document.extractImages` | `true` | 是否从文档中提取嵌入图像 |

---

## 性能指标

### 各模态处理延迟参考（本地环境，M2 Pro / i7-12700H）

| 操作 | 平均耗时 | P95 耗时 |
| --- | --- | --- |
| 文本融合（10K Token） | 12 ms | 20 ms |
| PDF 解析（10 页） | 380 ms | 650 ms |
| PDF 解析（50 页） | 1.8 s | 3.2 s |
| 图像描述提取（1 张） | 220 ms | 400 ms |
| 全屏截图（1080p） | 45 ms | 80 ms |
| Markdown 输出生成 | 60 ms | 120 ms |
| ECharts JSON 生成 | 90 ms | 160 ms |
| PPT 生成（10 页） | 2.1 s | 3.8 s |

### Token 预算利用率

| 场景 | 平均 Token 消耗 | 预算利用率 |
| --- | --- | --- |
| 单图 + 文本描述 | ~4,200 | 3.3% |
| 10 页 PDF + 分析指令 | ~18,000 | 14% |
| 4 图 + 2 文档 + 文本 | ~52,000 | 41% |
| 会议纪要（满载） | ~95,000 | 74% |

> 建议单次融合控制在 Token 预算 70% 以内，为 LLM 推理保留充足空间。

---

## 测试覆盖率

| 模块 | 测试文件 | 用例数 | 覆盖率 |
| --- | --- | --- | --- |
| `ModalityFusion` | `tests/unit/multimodal/modality-fusion.test.js` | 34 | 93% |
| `MultimodalContext` | `tests/unit/multimodal/multimodal-context.test.js` | 28 | 91% |
| `MultimodalOutput` | `tests/unit/multimodal/multimodal-output.test.js` | 31 | 90% |
| `DocumentParser` | `tests/unit/multimodal/document-parser.test.js` | 25 | 95% |
| IPC 通道 | `tests/unit/multimodal/ipc-handlers.test.js` | 20 | 97% |
| Pinia Store | `src/renderer/stores/__tests__/multimodal.test.ts` | 22 | 92% |

**运行测试**：

```bash
cd desktop-app-vue
npx vitest run tests/unit/multimodal/
npx vitest run src/renderer/stores/__tests__/multimodal.test.ts
```

**关键测试场景**：

- Token 预算超限时的自动裁剪策略（优先保留文本，裁减低优先级模态）
- PDF 多页并发解析与页码顺序保证
- 屏幕捕获权限缺失时的友好降级错误提示
- ECharts JSON schema 合法性校验
- PPT 幻灯片数量与内容分布算法
- 多模态上下文构建的幂等性（相同输入多次调用结果一致）

---

## 安全考虑

1. **本地处理**: 所有模态输入（文档/图像/屏幕）在本地解析处理，不上传到外部服务
2. **屏幕捕获授权**: 屏幕截图功能需要用户明确授权，不会在后台静默捕获
3. **文档隐私**: 解析后的文档内容仅用于当前会话的上下文构建，不持久化原始文件
4. **Token 管理**: 智能 Token 预算机制防止过大输入导致的内存溢出或 API 费用失控
5. **输出安全**: 生成的 HTML 输出经过 XSS 过滤，ECharts 图表使用沙箱渲染
6. **临时文件**: 处理过程中的临时文件在会话结束后自动清理

---

## 相关文档

- [Context Engineering](/chainlesschain/context-engineering)
- [自然语言编程](/chainlesschain/nl-programming)
