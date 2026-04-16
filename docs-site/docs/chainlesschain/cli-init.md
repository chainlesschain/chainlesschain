# 项目初始化 (init)

> Headless 命令 — 不依赖桌面 GUI，直接使用核心包运行。适用于服务器、CI/CD、容器化等无桌面环境。

## 核心特性

- 🏗️ **项目初始化**: 类似 `git init`，在当前目录创建 `.chainlesschain/` 项目结构
- 📋 **9 种模板**: code-project、data-science、devops、medical-triage、agriculture-expert、general-assistant、ai-media-creator、**ai-doc-creator**（新）、空项目
- 🎭 **Persona 系统**: 5 种 Persona 模板自动配置 AI 角色、行为约束和工具权限
- 🎬 **AI 媒体技能自动生成**: ai-media-creator 模板自动生成 comfyui-image / comfyui-video / audio-gen 3 个 workspace 层技能
- 📄 **AI 文档技能自动生成**: ai-doc-creator 模板自动生成 doc-generate / libre-convert / doc-edit 3 个 workspace 层技能
- ⚡ **非交互模式**: `--yes` 跳过确认，`--bare` 最小初始化
- 📁 **标准目录结构**: `config.json` + `rules.md` + `skills/`
- 🔍 **项目检测**: 自动检测已有项目，防止重复初始化

## 系统架构

```
init 命令 → init.js (Commander) → project-detector.js
                                        │
               ┌────────────────────────┼──────────────────────────┐
               ▼                        ▼                          ▼
        检查现有项目              选择模板                    生成目录结构
    findProjectRoot()      interactive/--template         .chainlesschain/
               │                        │                  ├── config.json
               ▼                        ▼                  ├── rules.md
        已存在则报错         9种模板规则 + 可选            └── skills/
                              tmpl.generateSkills              ├── <name>-persona/
                                        │                      ├── comfyui-image/  ← ai-media-creator
                                        ▼                      ├── comfyui-video/  ← ai-media-creator
                              生成额外技能文件               ├── audio-gen/     ← ai-media-creator
                              + workflows/或templates/ 目录 ├── doc-generate/  ← ai-doc-creator
                                                           ├── libre-convert/ ← ai-doc-creator
                                                           └── doc-edit/      ← ai-doc-creator
```

## 概述

CLI Phase 102 — 在当前目录初始化 `.chainlesschain/` 项目结构，用于自定义技能、项目规则和配置管理。

## 命令参考

```bash
chainlesschain init                              # 交互式初始化
chainlesschain init --bare                       # 最小初始化（空项目模板）
chainlesschain init --template code-project      # 使用代码项目模板
chainlesschain init --template data-science --yes # 数据科学模板，跳过确认
chainlesschain init --template devops --yes      # DevOps 模板，跳过确认
chainlesschain init --template medical-triage --yes  # 医疗分诊模板（含 Persona）
chainlesschain init --template agriculture-expert --yes # 农业专家模板（含 Persona）
chainlesschain init --template general-assistant --yes  # 通用助手模板（含 Persona）
chainlesschain init --template ai-media-creator --yes   # AI音视频模板（含 Persona + 3个媒体技能）
chainlesschain init --template ai-doc-creator --yes     # AI文档模板（含 Persona + 3个文档技能）
```

## 选项

| 选项 | 说明 |
|------|------|
| `--template <name>` | 指定模板（code-project / data-science / devops / medical-triage / agriculture-expert / general-assistant / ai-media-creator / **ai-doc-creator** / empty） |
| `--yes` | 跳过交互确认，使用默认值 |
| `--bare` | 最小初始化，等同于 `--template empty --yes` |

## 模板说明

### 空项目（默认 / `--bare`）

```markdown
# Project Rules
## General
- Follow project conventions
- Write clean, maintainable code
```

### code-project

```markdown
# Project Rules
## Code Style
- Use consistent naming conventions
- Write unit tests for new features
- Document public APIs
## Git Workflow
- Use feature branches
- Write descriptive commit messages
## Code Review
- All changes require review
- Check for security issues
```

### data-science

```markdown
# Project Rules
## Data Handling
- Document data sources and transformations
- Version control datasets and models
- Use reproducible pipelines
## Analysis
- Include visualizations for key findings
- Document assumptions and limitations
## Notebooks
- Keep notebooks clean and well-organized
- Use markdown cells for explanations
```

### devops

```markdown
# Project Rules
## Infrastructure
- Use Infrastructure as Code
- Document all configurations
- Follow least-privilege principle
## Deployment
- Use CI/CD pipelines
- Implement health checks
- Plan for rollback
## Monitoring
- Set up alerts for critical metrics
- Document runbooks
```

### medical-triage（医疗分诊，含 Persona）

自动配置医疗分诊 AI 角色，生成 Persona 配置和自动激活的 Persona Skill。

```json
{
  "persona": {
    "name": "智能分诊助手",
    "role": "你是一个医疗分诊AI助手...",
    "behaviors": ["始终先询问患者症状再给出建议", "使用标准分诊分类 (ESI 1-5)", ...],
    "toolsPriority": ["read_file", "search_files"],
    "toolsDisabled": []
  }
}
```

### agriculture-expert（农业专家，含 Persona）

自动配置农业领域 AI 专家角色。

### general-assistant（通用助手，含 Persona）

通用 AI 助手角色，无编码偏向，适合非技术项目。

### ai-media-creator（AI 音视频创作，含 Persona + 媒体技能）

> **v5.0.2.0 新增**

自动配置 AI 创作助手角色，并生成 3 个工作区层媒体技能。

```json
{
  "persona": {
    "name": "AI创作助手",
    "role": "你是一个专业的AI音视频创作助手，熟悉 ComfyUI / AnimateDiff / TTS...",
    "behaviors": [
      "根据用户创作需求推荐合适的工作流和参数",
      "提供专业的 Stable Diffusion 提示词建议",
      "在批量任务前确认存储空间和 ComfyUI 连接状态",
      "推荐免费开源工具（edge-tts、piper-tts）优先于付费 API"
    ],
    "toolsPriority": ["run_shell", "write_file", "read_file"]
  }
}
```

**自动生成目录结构：**

```
<project-root>/
├── .chainlesschain/
│   ├── config.json
│   ├── rules.md            # 包含 ComfyUI + cli-anything 集成说明
│   └── skills/
│       ├── ai-media-creator-persona/   # 自动激活 Persona
│       ├── comfyui-image/              # ComfyUI 文生图/图生图
│       │   ├── SKILL.md
│       │   └── handler.js              # REST API 调用 + 轮询
│       ├── comfyui-video/              # ComfyUI + AnimateDiff 视频
│       │   ├── SKILL.md
│       │   └── handler.js
│       └── audio-gen/                  # TTS 语音合成（4后端降级）
│           ├── SKILL.md
│           └── handler.js
└── workflows/
    └── README.md           # ComfyUI 工作流导出指南
```

**三个媒体技能说明：**

| 技能 | 后端 | 需要 |
|------|------|------|
| `comfyui-image` | ComfyUI REST API | 本地 ComfyUI 运行（默认端口 8188） |
| `comfyui-video` | ComfyUI + AnimateDiff | ComfyUI + AnimateDiff 扩展 + 工作流 JSON |
| `audio-gen` | edge-tts / piper-tts / ElevenLabs / OpenAI | 至少安装一个 TTS 后端 |

**使用示例：**

```bash
cd my-media-project
chainlesschain init --template ai-media-creator --yes

# 安装免费 TTS 后端
pip install edge-tts

# 生成图像（需 ComfyUI 运行）
chainlesschain skill run comfyui-image "a sunset over mountains, oil painting style"

# 生成语音
chainlesschain skill run audio-gen "欢迎使用 AI 音视频创作助手"

# 使用 Agent 进行批量创作
chainlesschain agent

# 注册有 CLI 的外部工具（如 FFmpeg）
chainlesschain cli-anything register ffmpeg
```

**cli-anything 集成说明：**

ComfyUI 以 REST API 为主，不适合通过 `cli-anything` 注册，请直接使用 `comfyui-image` / `comfyui-video` 技能。
有 CLI 接口的 AI 工具（如 FFmpeg、yt-dlp、第三方 CLI 包装脚本）可通过 `cli-anything` 注册：

```bash
chainlesschain cli-anything scan              # 扫描 PATH 中的工具
chainlesschain cli-anything register ffmpeg   # 注册 FFmpeg
chainlesschain cli-anything list              # 查看已注册工具
```

### ai-doc-creator（AI 文档创作，含 Persona + 文档技能）

> **v5.0.2.0 新增**

自动配置 AI 文档助手角色，并生成 3 个工作区层文档技能。

```json
{
  "persona": {
    "name": "AI文档助手",
    "role": "你是一个专业的AI文档创作助手，擅长生成各类结构化文档（报告、方案、说明书、README等），熟悉 LibreOffice 文档格式转换和 pandoc 文档处理...",
    "behaviors": [
      "根据用户描述自动选择合适的文档风格（报告/方案/说明书/README）",
      "主动询问文档目标读者和使用场景以优化内容",
      "批量任务前确认 LibreOffice 已安装或告知安装方式",
      "对长文档建议分章节生成以确保质量"
    ],
    "toolsPriority": ["run_shell", "write_file", "read_file"]
  }
}
```

**自动生成目录结构：**

```
<project-root>/
├── .chainlesschain/
│   ├── config.json
│   ├── rules.md            # 包含 LibreOffice + pandoc + cli-anything 集成说明
│   └── skills/
│       ├── ai-doc-creator-persona/   # 自动激活 Persona
│       ├── doc-generate/             # AI 文档生成（md/html/docx/pdf 输出）
│       │   ├── SKILL.md
│       │   └── handler.js            # LLM生成 + pandoc/soffice格式转换
│       ├── libre-convert/            # LibreOffice 格式转换
│       │   ├── SKILL.md
│       │   └── handler.js
│       └── doc-edit/                 # AI 修改现有文档（保留公式/图表/样式）
│           ├── SKILL.md
│           └── handler.js
└── templates/
    └── README.md           # 文档模板使用指南
```

**三个文档技能说明：**

| 技能 | 功能 | 依赖 |
|------|------|------|
| `doc-generate` | AI 生成结构化文档，支持 md/html/docx/pdf 输出 | md/html 内置；docx 需要 pandoc；pdf 需要 LibreOffice |
| `libre-convert` | LibreOffice 无头模式格式转换（docx/pdf/html/odt 等） | LibreOffice 本地安装 |
| `doc-edit` | AI 修改现有文档，保留公式/图表/样式（xlsx/pptx 结构完整） | md/txt/html 内置；docx 需要 pandoc 或 LibreOffice；xlsx 需要 Python + openpyxl；pptx 需要 Python + python-pptx |

**使用示例：**

```bash
cd my-doc-project
chainlesschain init --template ai-doc-creator --yes

# 安装 pandoc（DOCX 输出）
winget install pandoc         # Windows
brew install pandoc           # macOS
apt install pandoc            # Linux

# 安装 LibreOffice（PDF 输出）
winget install LibreOffice.LibreOffice

# AI 生成文档（Markdown）
chainlesschain skill run doc-generate "2026年AI技术趋势分析报告"

# 生成 DOCX（需要 pandoc）
chainlesschain skill run doc-generate "项目方案" --args '{"style":"proposal","format":"docx"}'

# 生成 PDF（需要 LibreOffice）
chainlesschain skill run doc-generate "产品需求说明书" --args '{"format":"pdf","style":"manual"}'

# 使用大纲精确控制文档结构
chainlesschain skill run doc-generate "API文档" --args '{"outline":"1.概述 2.认证方式 3.接口列表 4.错误码","format":"md"}'

# LibreOffice 格式转换
chainlesschain skill run libre-convert "report.docx"             # 默认转 PDF
chainlesschain skill run libre-convert "slides.pptx" --args '{"format":"pdf"}'

# AI 修改现有文档（保留格式/公式/图表）
chainlesschain skill run doc-edit --args '{"input_file":"report.md","instruction":"优化摘要部分"}'
chainlesschain skill run doc-edit --args '{"input_file":"data.xlsx","instruction":"将产品名称首字母大写"}'
chainlesschain skill run doc-edit --args '{"input_file":"slides.pptx","instruction":"使语气更正式","action":"edit"}'

# 使用 Agent 批量生成文档
chainlesschain agent
```

**cli-anything 集成说明：**

LibreOffice 具有完整的 CLI 接口（`soffice --headless`），**适合通过 `cli-anything` 注册**以获得高级功能访问。
日常 AI 文档生成使用内置技能；需要宏、模板样式等高级功能时，可注册 `soffice`：

```bash
chainlesschain cli-anything register soffice    # 注册完整 LibreOffice CLI
chainlesschain cli-anything register pandoc     # 注册 pandoc
chainlesschain cli-anything scan                # 扫描 PATH 中可用工具
```

## Persona 系统

当使用含 Persona 的模板初始化时，`config.json` 会包含 `persona` 字段，控制 Agent 的行为：

| 字段 | 说明 |
|------|------|
| `persona.name` | AI 角色名称 |
| `persona.role` | 系统级角色描述（替换默认编码助手 prompt） |
| `persona.behaviors` | 行为约束列表 |
| `persona.toolsPriority` | 优先使用的工具 |
| `persona.toolsDisabled` | 禁用的工具列表 |

Persona 模板还会在 `skills/` 下创建自动激活的 Persona Skill（`activation: auto`），在 Agent 启动时自动注入到系统 prompt。

使用 `chainlesschain persona` 命令可以随时查看、修改或重置 Persona 配置。详见 [Persona 命令](./cli-persona)。

## 生成目录结构

```
<project-root>/
└── .chainlesschain/
    ├── config.json     # 项目配置
    ├── rules.md        # 项目编码规则
    └── skills/         # 自定义技能目录
                        # ai-media-creator 模板额外生成:
workflows/              # ComfyUI 工作流 JSON（ai-media-creator 专用）
    └── README.md
                        # ai-doc-creator 模板额外生成:
templates/              # 文档模板目录（ai-doc-creator 专用）
    └── README.md
```

### config.json 结构

```json
{
  "name": "my-project",
  "template": "code-project",
  "version": "1.0.0",
  "createdAt": "2026-03-12T10:00:00.000Z",
  "persona": {
    "name": "AI Assistant Name",
    "role": "Role description",
    "behaviors": ["Behavior 1", "Behavior 2"],
    "toolsPriority": ["read_file", "search_files"],
    "toolsDisabled": []
  }
}
```

> `persona` 字段仅在使用 Persona 模板时生成。非 Persona 模板（code-project/data-science/devops/empty）不包含此字段。Persona 模板包括：medical-triage / agriculture-expert / general-assistant / ai-media-creator / **ai-doc-creator**。

## 项目检测

`project-detector.js` 提供项目根目录检测工具：

- `findProjectRoot(startDir?)` — 从指定目录向上遍历，查找包含 `.chainlesschain/config.json` 的目录
- `loadProjectConfig(projectRoot)` — 读取并解析项目配置
- `isInsideProject(startDir?)` — 快捷布尔判断是否在项目内

```javascript
import { findProjectRoot, isInsideProject } from "../lib/project-detector.js";

const root = findProjectRoot(); // 向上遍历查找
if (isInsideProject()) {
  // 在项目内，可加载工作区技能
}
```

## 配置参考

```bash
# init 选项
--template <name>              # 9 种模板：
                               #   code-project / data-science / devops
                               #   medical-triage / agriculture-expert / general-assistant
                               #   ai-media-creator / ai-doc-creator / empty
--yes                          # 跳过交互确认
--bare                         # 等同于 --template empty --yes

# 生成路径
# .chainlesschain/config.json   项目配置（含 persona / template / version）
# .chainlesschain/rules.md      项目规则
# .chainlesschain/skills/       工作区层技能目录
# workflows/                    仅 ai-media-creator
# templates/                    仅 ai-doc-creator

# 项目检测：findProjectRoot() 向上遍历查找 .chainlesschain/config.json
```

## 性能指标

| 操作 | 目标 | 实际 | 状态 |
|------|------|------|------|
| empty 模板初始化 | < 300ms | ~150ms | ✅ |
| code-project 模板生成 | < 500ms | ~280ms | ✅ |
| ai-media-creator（含 3 技能） | < 1.2s | ~700ms | ✅ |
| ai-doc-creator（含 3 技能） | < 1.2s | ~750ms | ✅ |
| 已有项目检测 | < 100ms | ~40ms | ✅ |

## 测试覆盖率

```
✅ init.test.js  - 覆盖 CLI 主要路径
  ├── 参数解析
  ├── 正常路径
  ├── 错误处理
  └── JSON 输出
```

## 安全考虑

- `init` 检查 `.chainlesschain/` 是否已存在，防止覆盖
- 生成的 `config.json` 不包含敏感信息
- `rules.md` 仅包含项目编码规范模板

## 使用示例

### 场景 1：交互式初始化项目

```bash
cd my-project
chainlesschain init
```

在项目根目录运行交互式初始化，选择模板并自动生成 `.chainlesschain/` 目录结构。

### 场景 2：使用模板快速初始化

```bash
chainlesschain init --template code-project --yes
chainlesschain skill sources
```

使用代码项目模板一键初始化，跳过确认提示。初始化后查看技能来源确认工作区层已就绪。

### 场景 3：最小空白项目

```bash
chainlesschain init --bare
```

创建最小项目结构，仅包含 `config.json`、`rules.md` 和空的 `skills/` 目录，适合完全自定义的场景。

## 故障排查

| 问题 | 解决方案 |
|------|---------|
| 报错"已存在" | 当前目录或父目录已有 `.chainlesschain/`，不支持重复初始化 |
| 模板不存在 | 仅支持 code-project / data-science / devops / medical-triage / agriculture-expert / general-assistant / ai-media-creator / ai-doc-creator / empty，其他名称会报错 |
| 权限不足 | 检查当前目录写权限 |
| comfyui-image 连接失败 | 确认 ComfyUI 正在运行：`python main.py --listen 0.0.0.0`，默认端口 8188 |
| audio-gen 无后端 | 安装 `pip install edge-tts` 或设置 `OPENAI_API_KEY` / `ELEVENLABS_API_KEY` |
| comfyui-video 需要工作流 | AnimateDiff 必须提供工作流 JSON 文件，从 ComfyUI UI 导出（Save → API Format） |
| doc-generate 输出 md 但请求了 docx | 需要安装 pandoc 或 LibreOffice；安装后重试 |
| libre-convert 报错"LibreOffice not found" | 安装 LibreOffice：`winget install LibreOffice.LibreOffice`；或通过 `cli-anything register soffice` 注册 |

## 关键文件

- `packages/cli/src/commands/init.js` — init 命令实现
- `packages/cli/src/lib/project-detector.js` — 项目检测工具

## 相关文档

- [Persona 命令](./cli-persona) — 查看/设置/重置项目 AI 角色
- [代理模式 (agent)](./cli-agent) — Agent 模式自动加载 Persona 配置
- [技能系统 (skill)](./cli-skill) — 自定义技能与 4 层优先级
- [CLI 指令技能包](./cli-skill-packs) — 9个 CLI 指令技能包（sync-cli）
- [多智能体协作 (cowork)](./cli-cowork) — 多智能体协作命令
- [CLI-Anything 集成](./cli-cli-anything) — 将外部 CLI 工具注册为技能
- [CLI 命令行工具](./cli) — CLI 总览
