# AI 音视频创作模板

> **版本**: v5.0.2.0
> Headless 命令 — 不依赖桌面 GUI，直接使用核心包运行。

`cc init --template ai-media-creator` 在项目目录中一键配置 AI 音视频创作环境，自动生成 **Persona（AI创作助手）** 和 3 个工作区层技能。

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

有 CLI 接口的工��（FFmpeg、yt-dlp 等）可通过 `cli-anything` 注册：

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
