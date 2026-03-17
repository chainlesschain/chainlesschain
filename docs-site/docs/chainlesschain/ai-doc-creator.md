# AI 文档创作模板

> **版本**: v5.0.2.1
> Headless 命令 — 不依赖桌面 GUI，直接使用核心包运行。

`cc init --template ai-doc-creator` 在项目目录中一键配置 AI 文档创作环境，自动生成 **Persona（AI文档助手）** 和 3 个工作区层技能。

## 三个文档技能

| 技能 | 功能 | 依赖 |
|------|------|------|
| `doc-generate` | AI 自动生成结构化文档，输出 md / html / docx / pdf | md/html 内置；docx 需要 pandoc；pdf 需要 LibreOffice |
| `libre-convert` | LibreOffice 无头模式格式转换（docx/pdf/html/odt 等） | LibreOffice 本地安装 |
| `doc-edit` | AI 修改现有文档，保留公式 / 图表 / 样式（xlsx/pptx 结构完整） | md/txt/html 内置；docx 需 pandoc 或 LibreOffice；xlsx 需 Python + openpyxl；pptx 需 Python + python-pptx |

## 快速开始

```bash
cd my-doc-project
chainlesschain init --template ai-doc-creator --yes
```

生成目录结构：

```
<project-root>/
├── .chainlesschain/
│   ├── config.json         # AI文档助手 Persona 配置
│   ├── rules.md            # LibreOffice + pandoc + cli-anything 集成规则
│   └── skills/
│       ├── ai-doc-creator-persona/   # 自动激活 Persona
│       ├── doc-generate/             # AI 文档生成技能
│       ├── libre-convert/            # LibreOffice 格式转换技能
│       └── doc-edit/                 # AI 修改现有文档技能
└── templates/
    └── README.md           # 文档模板使用指南
```

## 安装依赖

```bash
# DOCX 输出（doc-generate / doc-edit）
winget install pandoc                        # Windows
brew install pandoc                          # macOS
apt install pandoc                           # Linux

# PDF 输出 / 格式转换（libre-convert / doc-generate）
winget install LibreOffice.LibreOffice       # Windows
brew install --cask libreoffice              # macOS
apt install libreoffice                      # Linux

# Excel 编辑（doc-edit .xlsx）
pip install openpyxl

# PowerPoint 编辑（doc-edit .pptx）
pip install python-pptx
```

## 技能使用

### doc-generate — AI 生成文档

```bash
# 生成 Markdown 文档（内置，无需依赖）
chainlesschain skill run doc-generate "2026年AI技术趋势分析报告"

# 指定文档风格
chainlesschain skill run doc-generate "项目方案" --args '{"style":"proposal","format":"md"}'

# 生成 DOCX（需要 pandoc）
chainlesschain skill run doc-generate "项目方案" --args '{"style":"proposal","format":"docx"}'

# 生成 PDF（需要 LibreOffice）
chainlesschain skill run doc-generate "产品需求说明书" --args '{"format":"pdf","style":"manual"}'

# 使用大纲精确控制文档结构
chainlesschain skill run doc-generate "API文档" --args '{"outline":"1.概述 2.认证方式 3.接口列表 4.错误码","format":"md"}'
```

**文档风格（`style` 参数）：**

| 风格 | 说明 | 典型章节 |
|------|------|---------|
| `report`（默认） | 分析报告 | 执行摘要、背景、详细分析、结论和建议 |
| `proposal` | 项目方案 | 项目背景、目标、实施方案、资源需求、风险分析 |
| `manual` | 说明书 / 手册 | 概述、安装配置、功能说明、常见问题 |
| `readme` | README 文档 | 项目简介、快速开始、功能特性、安装使用 |

### libre-convert — LibreOffice 格式转换

```bash
# 转换为 PDF（默认）
chainlesschain skill run libre-convert "report.docx"

# 指定输出格式
chainlesschain skill run libre-convert "slides.pptx" --args '{"format":"pdf"}'
chainlesschain skill run libre-convert "data.xlsx" --args '{"format":"csv"}'

# 指定输出目录
chainlesschain skill run libre-convert "report.docx" --args '{"format":"html","outdir":"./output"}'
```

**支持的转换格式：** `pdf` / `docx` / `html` / `odt` / `pptx` / `xlsx` / `csv` / `txt` / `png`

### doc-edit — AI 修改现有文档

输出文件自动命名为 `{原文件名}_edited.{扩展名}`，不覆盖原文件。

```bash
# 修改 Markdown 文档
chainlesschain skill run doc-edit --args '{"input_file":"report.md","instruction":"优化摘要部分，使语气更正式"}'

# 修改 Word 文档（保留样式，需要 pandoc）
chainlesschain skill run doc-edit --args '{"input_file":"report.docx","instruction":"将结论部分翻译为英文","action":"translate"}'

# 修改 Excel（保留公式和图表，需要 Python + openpyxl）
chainlesschain skill run doc-edit --args '{"input_file":"data.xlsx","instruction":"将产品名称首字母大写"}'

# 修改 PowerPoint（仅修改文字，不影响图形图表，需要 Python + python-pptx）
chainlesschain skill run doc-edit --args '{"input_file":"slides.pptx","instruction":"使语气更正式","action":"edit"}'

# 生成文档摘要
chainlesschain skill run doc-edit --args '{"input_file":"report.md","instruction":"提取核心要点","action":"summarize"}'
```

**`action` 参数：**

| 值 | 说明 |
|----|------|
| `edit`（默认） | 按指令修改文档内容 |
| `summarize` | 生成文档摘要 |
| `translate` | 翻译文档内容 |

## 使用 Agent 批量处理文档

```bash
chainlesschain agent
```

Agent 启动后自动加载 `AI文档助手` Persona，可通过自然语言描述批量任务：

> 帮我把 docs/ 目录下所有 .md 文件转换为 PDF，并生成一份项目技术总结报告

## cli-anything 集成

LibreOffice 具有完整的 CLI 接口，**同时支持**内置技能和 `cli-anything` 两种方式：

```bash
# 注册 LibreOffice 完整 CLI（用于宏、模板样式等高级功能）
chainlesschain cli-anything register soffice

# 注册 pandoc
chainlesschain cli-anything register pandoc
```

**选择方式：**

| 场景 | 推荐方式 |
|------|---------|
| 日常 AI 文档生成和格式转换 | 使用内置 `doc-generate` / `libre-convert` 技能 |
| 宏执行、样式管理、批量脚本等高级功能 | `cli-anything register soffice` 后通过 Agent 调用 |

## 故障排查

| 问题 | 解决方案 |
|------|---------|
| `doc-generate` 请求 docx 但输出了 md | 安装 pandoc 后重试；或安装 LibreOffice |
| `libre-convert` 报错"LibreOffice not found" | 安装 LibreOffice，或运行 `chainlesschain cli-anything register soffice` |
| `doc-edit .xlsx` 报错 | 安装 `pip install openpyxl` |
| `doc-edit .pptx` 报错 | 安装 `pip install python-pptx` |
| `doc-edit .docx` 输出格式损坏 | 优先安装 pandoc；没有 pandoc 时回退使用 LibreOffice |

## 相关文档

- [项目初始化 (init)](./cli-init) — 所有 9 种初始化模板
- [CLI-Anything 集成](./cli-cli-anything) — 注册外部 CLI 工具为技能
- [技能系统 (skill)](./cli-skill) — 自定义技能与 4 层优先级
- [Persona 命令](./cli-persona) — 查看/修改 AI 角色配置
