# 视频剪辑 Agent (video)

> Headless 命令 — 不依赖桌面 GUI，直接使用核心包运行。适用于服务器、CI/CD、容器化等无桌面环境。

## 核心特性

- 🎬 **一键剪辑**: 从长素材 + 音乐 → 自动蒙太奇（deconstruct → plan → assemble → render）
- 🎵 **音频智能**: madmom 节拍检测、beat-snap 对齐、对话 ducking
- ⚡ **并行编辑**: 多 section 并行 + 冲突解决 + 质量门控（VLM review）
- 📦 **素材缓存**: 解构结果按内容哈希缓存，避免重复处理
- 📊 **NDJSON 流**: 全流程事件流，适配 Web 进度展示

## 概述

ChainlessChain CLI 视频剪辑模块（借鉴 CutClaw 架构）提供 AI 驱动的视频编辑管线。`edit` 是一键完整流程，`deconstruct` 解构素材（抽帧 + ASR + beat 分析），`plan` 由 LLM 生成 shot_plan，`assemble` 通过 Editor ReAct 循环选择时间戳，`render` 用 ffmpeg 渲染成片。支持并行 section 处理和 VLM 质量审查。

## 命令参考

### video edit — 一键完整流程

```bash
chainlesschain video edit --video raw.mp4
chainlesschain video edit --video raw.mp4 --audio bgm.mp3 --instruction "节奏感强的角色蒙太奇"
chainlesschain video edit --video raw.mp4 --audio bgm.mp3 --instruction "..." --parallel --review
chainlesschain video edit --video raw.mp4 --audio bgm.mp3 --use-madmom --snap-beats --ducking
chainlesschain video edit --video raw.mp4 --output final.mp4 --stream
chainlesschain video edit --video raw.mp4 --json
```

执行完整管线：deconstruct → plan → assemble → render。

| 选项 | 说明 |
|------|------|
| `--video <path>` | 输入视频文件（必填） |
| `--audio <path>` | 背景音乐文件 |
| `--instruction <text>` | 剪辑指令（自然语言） |
| `--output <path>` | 输出路径（默认 `./output.mp4`） |
| `--srt <path>` | 已有字幕文件（跳过 ASR） |
| `--fps <n>` | 抽帧 FPS（默认 2） |
| `--character <name>` | 主角名称（用于角色识别） |
| `--parallel` | 并行处理 section + 冲突解决 |
| `--concurrency <n>` | 最大并行数（默认 4） |
| `--review` | 启用质量门控（VLM 审查） |
| `--use-madmom` | 使用 madmom Python 节拍检测 |
| `--snap-beats` | shot plan 时间戳对齐到最近节拍 |
| `--ducking` | 启用对话 ducking（音量闪避） |
| `--stream` | NDJSON 进度事件输出 |
| `--json` | JSON 最终输出 |

### video deconstruct — 解构素材

```bash
chainlesschain video deconstruct --video raw.mp4
chainlesschain video deconstruct --video raw.mp4 --audio bgm.mp3 --use-madmom
chainlesschain video deconstruct --video raw.mp4 --srt sub.srt --fps 4 --stream
```

解构视频素材：抽帧、ASR 语音转文字、beat 分析。结果按内容哈希缓存，重复运行直接复用。

### video plan — 生成剪辑计划

```bash
chainlesschain video plan --asset-dir <dir>
chainlesschain video plan --asset-dir <dir> --instruction "快节奏运动蒙太奇" --character "主角"
chainlesschain video plan --asset-dir <dir> --json
```

基于解构素材和剪辑指令，由 LLM 生成 shot_plan（sections + shots）。`--asset-dir` 为 deconstruct 输出的目录。

### video assemble — 选择时间戳

```bash
chainlesschain video assemble --asset-dir <dir> --plan shot_plan.json
chainlesschain video assemble --asset-dir <dir> --plan shot_plan.json --parallel --concurrency 8
chainlesschain video assemble --asset-dir <dir> --plan shot_plan.json --parallel --review
chainlesschain video assemble --asset-dir <dir> --plan shot_plan.json --stream
```

运行 Editor ReAct 循环，为每个 shot 选择精确时间戳。`--parallel` 启用多 section 并行 + 冲突解决，`--review` 启用 VLM 质量门控。

### video render — 渲染成片

```bash
chainlesschain video render --video raw.mp4 --points shot_point.json
chainlesschain video render --video raw.mp4 --points shot_point.json --audio bgm.mp3 --output final.mp4
chainlesschain video render --video raw.mp4 --points shot_point.json --stream --json
```

使用 ffmpeg 将 shot_point.json 中的时间戳序列渲染为最终视频。

### video assets list — 列出缓存素材

```bash
chainlesschain video assets list
chainlesschain video assets list --json
```

列出所有已解构并缓存的视频素材（哈希、源视频路径、修改时间）。

### video assets show — 查看素材详情

```bash
chainlesschain video assets show --hash <hash>
chainlesschain video assets show --hash abc123 --json
```

查看指定哈希的缓存素材目录中的所有文件。

### video assets prune — 清理旧缓存

```bash
chainlesschain video assets prune
chainlesschain video assets prune --older-than 7
```

删除超过指定天数（默认 30）的缓存素材。

## 系统架构

```
用户命令 → video.js (Commander) → VideoPipeline
                                       │
         ┌─────────────────────────────┼─────────────────────────┐
         ▼                             ▼                         ▼
    deconstruct                      plan                    assemble
  (ffmpeg抽帧)                 (LLM shot_plan)          (Editor ReAct)
  (ASR语音转文)                                        (parallel + conflict)
  (beat分析)                                           (VLM quality gate)
         │                             │                         │
         ▼                             ▼                         ▼
    asset cache                  shot_plan.json            shot_point.json
         │                                                       │
         └───────────────────────► render (ffmpeg) ◄─────────────┘
                                       ▼
                                   output.mp4
```

## 音频增强功能

| 功能 | 标志 | 说明 |
|------|------|------|
| madmom 节拍检测 | `--use-madmom` | 使用 Python madmom 库进行精确 BPM 和节拍位置检测 |
| 节拍对齐 | `--snap-beats` | 将 shot plan 时间戳吸附到最近的节拍点 |
| 对话 ducking | `--ducking` | 在对话段落自动降低背景音乐音量 |

## 关键文件

| 文件 | 职责 |
|------|------|
| `packages/cli/src/commands/video.js` | video 命令主入口 |
| `packages/cli/src/skills/video-editing/pipeline.js` | VideoPipeline 核心管线（deconstruct/plan/assemble/render） |

## 配置参考

| 配置项 | 含义 | 默认 |
| ------ | ---- | ---- |
| `render.encoder` | 视频编码器 | `libx264` |
| `render.crf` | 质量 CRF（越小越清晰） | 20 |
| `render.fps` | 输出帧率 | 30 |
| `audio.sampleRate` | 音频采样率 | 48000 |
| `ducking.threshold` | ducking 触发阈值 (dB) | -20 |
| `beat.useMadmom` | madmom 精确节拍 | false |
| `parallel.workers` | 并行合成 worker 数 | 4 |

依赖 `ffmpeg` 在 `PATH` 中可用；madmom 走 Python venv（见 `video-editing/pipeline.js`）。

## 性能指标

| 操作 | 典型耗时 | 备注 |
| ---- | -------- | ---- |
| `video deconstruct` | 依赖素材时长 | 主要为 ffprobe + 关键帧检测 |
| `video plan` | < 500 ms | shot plan 生成 |
| `video snap-beats` | < 1 s | madmom 模式 ~2–5 s |
| `video assemble` | 依赖素材 | 主要为 ffmpeg 拼接 |
| `video render` | 依赖分辨率/时长 | 依赖外部 ffmpeg |
| 并行 orchestrator 加速比 | ~2–3× | 4-worker，CPU 绑定 |

## 测试覆盖率

```
__tests__/unit/video-editing-tools.test.js        — 22 tests
__tests__/unit/video-editing-pipeline.test.js     — 8 tests
__tests__/unit/video-audio-precision.test.js      — 31 tests
__tests__/unit/video-parallel-orchestrator.test.js — 28 tests
__tests__/unit/video-protocol.test.js             — 15 tests
```

覆盖 deconstruct/plan/assemble/render 全链路、节拍吸附与 ducking、并行编排与失败重试、video 协议消息。

## 安全考虑

1. **外部依赖**：ffmpeg / madmom 为系统级进程；CLI 会校验可执行文件路径，避免 PATH 劫持
2. **输入校验**：素材路径禁止路径遍历（`../`），输出目录限制在 `~/.chainlesschain/video-editing/`
3. **资源控制**：`--parallel` 不应超过 CPU 核数；过载会导致 ffmpeg 内部竞争
4. **元数据脱敏**：`deconstruct` 输出的 probe 结果可能含 GPS / 作者；发布前建议 `ffmpeg -map_metadata -1`
5. **临时文件**：中间产物在任务完成后自动清理，可用 `--keep-temp` 调试

## 缓存位置

| 平台 | 路径 |
|------|------|
| Windows | `%APPDATA%/chainlesschain-desktop-vue/.chainlesschain/video-editing/` |
| macOS/Linux | `~/.chainlesschain/video-editing/` |

## 使用示例

### 场景 1：一键剪辑

```bash
# 最简用法
chainlesschain video edit --video raw.mp4 --audio bgm.mp3 --instruction "动感蒙太奇"

# 全功能
chainlesschain video edit --video raw.mp4 --audio bgm.mp3 \
  --instruction "节奏感强的角色蒙太奇" \
  --character "主角" \
  --parallel --review \
  --use-madmom --snap-beats --ducking \
  --output final.mp4
```

### 场景 2：分步调试

```bash
# 1. 解构素材
chainlesschain video deconstruct --video raw.mp4 --audio bgm.mp3 --use-madmom

# 2. 生成剪辑计划
chainlesschain video plan --asset-dir <dir> --instruction "运动蒙太奇" --json > plan.json

# 3. 选择时间戳
chainlesschain video assemble --asset-dir <dir> --plan plan.json --parallel --review --json > points.json

# 4. 渲染成片
chainlesschain video render --video raw.mp4 --points points.json --audio bgm.mp3 --output final.mp4
```

### 场景 3：缓存管理

```bash
# 查看缓存
chainlesschain video assets list

# 清理 7 天前的缓存
chainlesschain video assets prune --older-than 7
```

## 故障排查

| 症状 | 可能原因 | 解决方案 |
|------|---------|---------|
| "ffmpeg not found" | 未安装 ffmpeg | `brew install ffmpeg` 或下载安装 |
| madmom 检测失败 | Python/madmom 未安装 | `pip install madmom` |
| 渲染输出为空 | shot_point.json 格式不正确 | 用 `--json` 检查 assemble 输出 |
| 素材缓存过大 | 累积解构缓存 | `video assets prune --older-than 7` |

## 相关文档

- [AI 编排](./cli-orchestrate) — 多 AI 代理调度
- [技能系统](./cli-skill) — 内置技能管理
- [流式会话](./cli-stream) — NDJSON 流协议
