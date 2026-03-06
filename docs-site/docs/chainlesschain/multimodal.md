# 多模态协作

> v1.1.0 新功能

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

## 相关文档

- [Context Engineering](/chainlesschain/context-engineering)
- [自然语言编程](/chainlesschain/nl-programming)
