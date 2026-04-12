# AI 音视频创作模板

> **版本**: v5.0.2.0
> Headless 命令 — 不依赖桌面 GUI，直接使用核心包运行。

`cc init --template ai-media-creator` 在项目目录中一键配置 AI 音视频创作环境，自动生成 **Persona（AI创作助手）** 和 3 个工作区层技能。

## 概述

AI Media Creator 是一个 CLI 初始化模板，通过 `cc init --template ai-media-creator` 一键生成 3 个工作区技能，为用户提供 AI 驱动的图像、视频和音频创作能力。图像与视频生成依赖本地运行的 ComfyUI 实例（REST API），音频合成支持 4 种 TTS 后端自动降级。所有媒体生成均在本地完成，无需上传数据到云端。

## 核心特性

- **ComfyUI 文生图** — 通过 REST API 调用本地 ComfyUI，支持自定义工作流 JSON 和默认 SD 1.5 工作流
- **ComfyUI 图生图** — 基于已有图像进行风格迁移或修改，复用 comfyui-image 技能
- **AnimateDiff 视频生成** — 通过 ComfyUI + AnimateDiff 扩展生成短视频，需用户导出工作流 JSON
- **4 后端 TTS 自动降级** — `edge-tts`（免费） → `piper-tts`（离线） → ElevenLabs（云端高质量） → OpenAI TTS（云端），自动选择可用后端
- **工作流 JSON 导出** — 支持从 ComfyUI UI 导出 API 格式工作流供技能调用
- **Persona 自动激活** — 初始化后 Agent 模式自动加载"AI创作助手"角色，引导批量创作
- **cli-anything 集成** — FFmpeg、yt-dlp 等 CLI 工具可通过 `cli-anything register` 注册后由 Agent 调用

## 系统架构

```
┌─────────────────────────────────────────────────────────┐
│                   chainlesschain agent                   │
│                  (AI创作助手 Persona)                     │
├──────────────┬──────────────────┬────────────────────────┤
│              │                  │                        │
│  comfyui-image   comfyui-video      audio-gen           │
│  (handler.js)    (handler.js)       (handler.js)        │
│       │               │                 │               │
│       ▼               ▼                 ▼               │
│  ┌─────────┐   ┌────────────┐   ┌──────────────────┐   │
│  │ComfyUI  │   │ ComfyUI    │   │ TTS 降级链       │   │
│  │REST API │   │ REST API   │   │                  │   │
│  │:8188    │   │ :8188      │   │ 1. edge-tts      │   │
│  │         │   │            │   │ 2. piper-tts     │   │
│  │ 文生图  │   │ AnimateDiff│   │ 3. ElevenLabs API│   │
│  │ 图生图  │   │ 视频工作流 │   │ 4. OpenAI TTS API│   │
│  └─────────┘   └────────────┘   └──────────────────┘   │
│       │               │                 │               │
│       ▼               ▼                 ▼               │
│   输出图像         输出视频          输出音频            │
│  (output/)        (output/)         (output/)           │
└─────────────────────────────────────────────────────────┘
```

## 安全考虑

| 安全项 | 说明 |
|--------|------|
| ComfyUI 本地运行 | 图像/视频生成完全在本地完成，不上传数据到云端 |
| TTS API Key 管理 | ElevenLabs 和 OpenAI 的 API Key 通过环境变量或 config.json 管理，不硬编码 |
| 生成文件本地存储 | 所有生成的图像、视频、音频文件存储在项目本地 `output/` 目录 |
| 本地后端无外传 | edge-tts 和 piper-tts 后端不向外部传输用户数据 |
| 工作流 JSON 验证 | 提交到 ComfyUI 的工作流 JSON 在发送前经过格式验证，防止注入恶意节点 |

## 关键文件

| 文件 | 说明 |
|------|------|
| `packages/cli/src/commands/init.js` | 模板定义与技能生成逻辑（`ai-media-creator` 模板及 `SKILL_TEMPLATES`） |
| `.chainlesschain/skills/comfyui-image/SKILL.md` | 文生图/图生图技能定义（生成到项目目录） |
| `.chainlesschain/skills/comfyui-image/handler.js` | ComfyUI REST API 调用、默认工作流构建、图像保存 |
| `.chainlesschain/skills/comfyui-video/SKILL.md` | AnimateDiff 视频生成技能定义（生成到项目目录） |
| `.chainlesschain/skills/comfyui-video/handler.js` | ComfyUI 视频工作流提交、进度轮询、视频输出 |
| `.chainlesschain/skills/audio-gen/SKILL.md` | TTS 语音合成技能定义（生成到项目目录） |
| `.chainlesschain/skills/audio-gen/handler.js` | 4 后端 TTS 降级链（edge-tts → piper → ElevenLabs → OpenAI） |
| `.chainlesschain/config.json` | AI创作助手 Persona 配置 |
| `.chainlesschain/rules.md` | ComfyUI + cli-anything 集成规则 |
| `workflows/README.md` | ComfyUI 工作流导出指南 |

## 三个媒体技能

| 技能 | 功能 | 需要 |
|------|------|------|
| `comfyui-image` | ComfyUI 文生图 / 图生图 | 本地 ComfyUI 运行（默认端口 8188） |
| `comfyui-video` | ComfyUI + AnimateDiff 视频生成 | ComfyUI + AnimateDiff 扩展 + 工作流 JSON |
| `audio-gen` | TTS 语音合成（4 后端自动降级） | 至少安装一个 TTS 后端 |

## 快速开始

```bash
cd my-media-project
chainlesschain init --template ai-media-creator --yes
```

生成目录结构：

```
<project-root>/
├── .chainlesschain/
│   ├── config.json         # AI创作助手 Persona 配置
│   ├── rules.md            # ComfyUI + cli-anything 集成规则
│   └── skills/
│       ├── ai-media-creator-persona/   # 自动激活 Persona
│       ├── comfyui-image/              # 文生图技能
│       ├── comfyui-video/              # AnimateDiff 视频技能
│       └── audio-gen/                  # TTS 语音合成技能
└── workflows/
    └── README.md           # ComfyUI 工作流导出指南
```

## 技能使用

### comfyui-image — 生成图像

```bash
# 使用内置默认工作流生成图像（需 ComfyUI 正在运行）
chainlesschain skill run comfyui-image "a sunset over mountains, oil painting style"

# 使用自定义工作流 JSON
chainlesschain skill run comfyui-image "portrait photo" --args '{"workflow":"workflows/my-workflow.json"}'
```

**默认工作流参数：**

| 参数 | 默认值 | 说明 |
|------|--------|------|
| 宽度 / 高度 | 512 × 512 | 图像尺寸 |
| 步数 | 20 | 采样步数 |
| 引导系数 | 7 | CFG scale |
| 模型 | v1-5-pruned-emaonly.ckpt | 需与本地模型名匹配 |

### comfyui-video — 生成视频

AnimateDiff 工作流需用户从 ComfyUI UI 导出（**Save → API Format**）。

```bash
# 必须提供工作流文件
chainlesschain skill run comfyui-video "walking in the rain" --args '{"workflow":"workflows/animatediff.json"}'
```

### audio-gen — 语音合成

自动按优先级尝试 4 个 TTS 后端：`edge-tts` → `piper-tts` → ElevenLabs → OpenAI TTS

```bash
# 生成语音（自动选择可用后端）
chainlesschain skill run audio-gen "欢迎使用 AI 音视频创作助手"

# 指定输出文件
chainlesschain skill run audio-gen "Hello world" --args '{"output":"output/hello.mp3"}'
```

**TTS 后端安装：**

```bash
# 推荐：edge-tts（免费，无需 API Key）
pip install edge-tts

# 离线本地：piper-tts
# 下载模型后运行：echo "text" | piper --output_file output.wav

# 云端高质量（需 API Key）
export ELEVENLABS_API_KEY=your_key
export OPENAI_API_KEY=your_key
```

## 使用 Agent 批量创作

```bash
chainlesschain agent
```

Agent 启动后会自动加载 `AI创作助手` Persona，引导完成批量创作任务。

## cli-anything 集成

ComfyUI 以 REST API 为主，**不适合**通过 `cli-anything` 注册，请直接使用内置技能。

有 CLI 接口的工具（FFmpeg、yt-dlp 等）可通过 `cli-anything` 注册：

```bash
chainlesschain cli-anything register ffmpeg    # 注册 FFmpeg
chainlesschain cli-anything register yt-dlp   # 注册 yt-dlp
chainlesschain cli-anything scan               # 扫描 PATH 中可用工具
```

注册后可直接通过 Agent 调用：`帮我用 ffmpeg 将 video.mp4 转为 720p`

## 故障排查

| 问题 | 解决方案 |
|------|---------|
| `comfyui-image` 连接失败 | 确认 ComfyUI 正在运行：`python main.py --listen 0.0.0.0`，默认端口 8188 |
| `comfyui-video` 提示"需要工作流" | AnimateDiff 必须提供工作流 JSON，从 ComfyUI UI 导出（Save → API Format） |
| `audio-gen` 提示无后端 | 安装 `pip install edge-tts`，或设置 `OPENAI_API_KEY` / `ELEVENLABS_API_KEY` |

## 相关文档

- [项目初始化 (init)](./cli-init) — 所有 9 种初始化模板
- [CLI-Anything 集成](./cli-cli-anything) — 注册外部 CLI 工具为技能
- [技能系统 (skill)](./cli-skill) — 自定义技能与 4 层优先级
- [Persona 命令](./cli-persona) — 查看/修改 AI 角色配置
