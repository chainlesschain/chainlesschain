# 视频剪辑 Agent (CutClaw-inspired)

> **版本: v1.0 Phase 1-4 (2026-04-16) | 状态: ✅ 生产就绪 | 5 子命令 | 4 阶段流水线 | 87 测试通过**
>
> 视频剪辑 Agent 借鉴 CutClaw 架构，实现"长视频 + 音乐 → 精剪蒙太奇"的全自动流水线。支持单命令一键剪辑、分步调试、并行编辑、质量门控、音频精度控制（beat-snap + ducking）。

## 概述

Video Editing Agent 解决的核心问题：从一段长视频素材（如拍摄原片）+ 一段背景音乐，自动生成节奏匹配、叙事连贯的精剪蒙太奇视频。传统流程需要人工分析素材、手动卡点、逐帧调整；Video Editing Agent 通过四阶段自动化流水线（解构 → 计划 → 编辑 → 渲染），将人工时间从数小时压缩到数分钟。

## 核心特性

- 🎬 **四阶段流水线**: deconstruct（抽帧+ASR+beat）→ plan（shot_plan）→ assemble（ReAct 选时间戳）→ render（FFmpeg）
- ⚡ **一键剪辑**: `cc video edit` 串联四阶段，单命令完成
- 🔧 **分步执行**: 每个阶段可独立运行，便于调试和 Web 进度展示
- 🔀 **并行编辑**: `--parallel` 多段并行 + `detectConflictPairs` 冲突检测/解决
- ✅ **质量门控**: `--review` VLM 审核 + QualityGate 评分（protagonist + duration checker）
- 🎵 **Beat 卡点**: `--use-madmom` Python madmom beat 检测 + `--snap-beats` 时间戳对齐
- 🔊 **对白压低**: `--ducking` 有对白片段自动压低背景音乐
- 💾 **素材缓存**: 解构结果按内容哈希缓存，重复编辑跳过解构
- 📡 **NDJSON 流式**: `--stream` 输出结构化进度事件
- 🤖 **Editor ReAct**: Assemble 阶段使用 LLM ReAct 循环选择精确时间戳
- 🎭 **主角检测**: 自动识别主角镜头占比，纳入质量评分
- 📊 **多种输出**: 普通日志 / NDJSON 流式 / JSON 最终结果

## 四阶段流水线

### 流水线架构

```
┌─────────────────────────────────────────────────────────┐
│                   cc video edit                          │
│                                                          │
│  Phase 1        Phase 2        Phase 3        Phase 4   │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐ │
│  │Deconstruct│→│   Plan   │→│ Assemble │→│ Render │ │
│  │           │  │          │  │          │  │        │ │
│  │ 抽帧 2fps│  │ LLM 生成 │  │ ReAct    │  │ FFmpeg │ │
│  │ ASR 字幕 │  │shot_plan │  │ 选时间戳 │  │ 拼接   │ │
│  │ Beat 分析│  │ .json    │  │ shot_point│  │ 混音   │ │
│  │ 内容哈希 │  │          │  │ .json    │  │ 输出   │ │
│  └──────────┘  └──────────┘  └──────────┘  └────────┘ │
│       │                            │                     │
│       │ --use-madmom               │ --parallel          │
│       │ madmom beat                │ 并行编辑            │
│       │                            │ --review            │
│       │                            │ QualityGate         │
│       │                            │                     │
│       └────── 结果按哈希缓存 ──────┘                     │
└─────────────────────────────────────────────────────────┘
```

### Phase 1: Deconstruct（解构素材）

从原始视频中提取帧、字幕、音频节拍。结果按内容哈希缓存。

| 提取项 | 工具 | 输出 |
|--------|------|------|
| 视频帧 | FFmpeg | `frames/*.jpg` (2fps) |
| 字幕 (ASR) | LLM ASR 或已有 .srt | `subtitles.json` |
| 节拍 | FFmpeg 或 madmom | `beats.json` |
| 内容哈希 | SHA-256 | 缓存键 |

### Phase 2: Plan（生成剪辑计划）

LLM 根据解构素材 + 用户剪辑指令生成 `shot_plan.json`，包含：

- 叙事结构（开头/发展/高潮/结尾）
- 每段 section 的主题和预期时长
- 推荐的镜头类型和转场方式

### Phase 3: Assemble（Editor ReAct 选时间戳）

LLM Editor 使用 ReAct 循环，根据 shot_plan 在解构素材中选择精确时间戳。

**并行模式** (`--parallel`)：

- 将 shot_plan 按 section 拆分
- 每个 section 分配独立 Editor Agent
- `--concurrency` 控制最大并行度（默认 4）
- `detectConflictPairs` 检测时间轴重叠冲突
- `pickWinnersAndLosers` 基于质量评分裁决

**质量门控** (`--review`)：

- 注册 `protagonistChecker`（主角占比 ≥ minRatio）
- 注册 `durationChecker`（时长偏差 ≤ tolerance）
- 未通过的 section 自动重新编辑

### Phase 4: Render（FFmpeg 渲染）

FFmpeg 根据 `shot_point.json` 裁剪、拼接、混音，输出最终视频。

**音频精度** (`--ducking`)：

- 检测有对白的片段
- 自动压低对应位置的背景音乐
- 保持对白清晰度

## 命令参考

### cc video edit — 一键完整流程

```bash
chainlesschain video edit \
  --video raw.mp4 \
  --audio bgm.mp3 \
  --instruction "节奏感强的角色蒙太奇" \
  --output final.mp4 \
  --parallel \
  --review \
  --use-madmom \
  --snap-beats \
  --ducking
```

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `--video <path>` | 输入视频文件（必填） | - |
| `--audio <path>` | 背景音乐文件 | - |
| `--instruction <text>` | 剪辑指令 | `""` |
| `--output <path>` | 输出路径 | `./output.mp4` |
| `--srt <path>` | 已有字幕文件（跳过 ASR） | - |
| `--fps <n>` | 抽帧 FPS | `2` |
| `--character <name>` | 主角名称 | - |
| `--parallel` | 多段并行 + 冲突解决 | `false` |
| `--concurrency <n>` | 最大并行段数 | `4` |
| `--review` | 启用 VLM 质量门控 | `false` |
| `--use-madmom` | 使用 madmom Python beat 检测 | `false` |
| `--snap-beats` | 剪辑点卡节拍 | `false` |
| `--ducking` | 对白段音乐自动压低 | `false` |
| `--stream` | NDJSON 进度事件输出 | `false` |
| `--json` | JSON 最终输出 | `false` |

### cc video deconstruct — 解构素材

```bash
chainlesschain video deconstruct --video raw.mp4 --audio bgm.mp3
chainlesschain video deconstruct --video raw.mp4 --audio bgm.mp3 --use-madmom
```

### cc video plan — 生成剪辑计划

```bash
chainlesschain video plan --asset-dir <dir> --instruction "节奏感强的角色蒙太奇"
```

### cc video assemble — 选时间戳

```bash
chainlesschain video assemble --asset-dir <dir> --plan shot_plan.json
chainlesschain video assemble --asset-dir <dir> --plan shot_plan.json --parallel --review
```

### cc video render — FFmpeg 渲染

```bash
chainlesschain video render --video raw.mp4 --points shot_point.json --output final.mp4
```

### cc video assets — 素材缓存管理

```bash
chainlesschain video assets list                    # 列出已解构素材
chainlesschain video assets show --hash <hash>      # 查看素材详情
chainlesschain video assets prune --older-than 30   # 清理 30 天前的缓存
```

## NDJSON 事件协议

`--stream` 模式下每行输出一个 JSON 事件：

| type | 字段 | 说明 |
|------|------|------|
| `phase.start` | `phase` | 阶段开始（deconstruct/plan/assemble/render） |
| `phase.progress` | `phase`, `pct`, `message` | 进度更新（0-1 百分比） |
| `phase.end` | `phase` | 阶段完成 |
| `error` | `phase`, `error` | 阶段错误 |
| `review.result` | `section`, `pass`, `score` | 质量门控检查结果 |

示例：

```json
{"type":"phase.start","phase":"deconstruct","ts":1712000000000}
{"type":"phase.progress","phase":"deconstruct","pct":0.5,"message":"ASR processing","ts":1712000001000}
{"type":"phase.end","phase":"deconstruct","ts":1712000010000}
```

## 系统架构

```
┌───────────────────────────────────────────────────────┐
│                 cc video edit                          │
│                 video.js (Commander)                   │
└──────────────────────┬────────────────────────────────┘
                       │
┌──────────────────────▼────────────────────────────────┐
│              VideoPipeline (pipeline.js)               │
│  EventEmitter — 发射 phase.start/progress/end 事件     │
│  run() / runWithReview()                               │
└──────┬────────┬────────┬────────┬─────────────────────┘
       │        │        │        │
       ▼        ▼        ▼        ▼
┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐
│Extract │ │ Plan   │ │Assemble│ │Render  │
│        │ │        │ │        │ │        │
│video-  │ │ LLM    │ │ ReAct  │ │ffmpeg- │
│extractor│ │shot_plan│ │Editor  │ │concat  │
│audio-  │ │        │ │        │ │audio-  │
│extractor│ │        │ │parallel│ │mix     │
│subtitle│ │        │ │-orch.  │ │        │
└────────┘ └────────┘ └────┬───┘ └────────┘
                            │
                   ┌────────▼────────┐
                   │ QualityGate     │
                   │ (--review)      │
                   │ protagonist +   │
                   │ duration checker│
                   └─────────────────┘
```

### LLM 类别路由

视频编辑使用三个媒体类别进行 LLM 路由：

| 类别 | 用途 | Provider 优先级 |
|------|------|------------------|
| `asr` | 语音转文字 | openai → gemini → volcengine |
| `audio-analysis` | 节拍检测/音频特征 | ollama → gemini → openai |
| `video-vlm` | 视频理解 VLM | gemini → openai → anthropic |

## 配置参考

### VideoPipeline 构造参数

```javascript
{
  videoPath: "./raw.mp4",              // 必填：输入视频
  audioPath: "./bgm.mp3",             // 可选：背景音乐
  instruction: "节奏感强的角色蒙太奇",  // 可选：剪辑指令
  outputPath: "./output.mp4",         // 输出路径
  existingSrt: null,                   // 已有字幕文件
  fps: 2,                             // 抽帧 FPS
  mainCharacter: null,                 // 主角名称
  useMadmom: false,                   // 使用 madmom beat 检测
  snapBeats: false,                    // 卡点对齐
  ducking: false,                      // 对白压低
}
```

### run() 选项

```javascript
{
  parallel: false,                     // 是否并行编辑
  maxConcurrency: 4,                   // 最大并行段数
}
```

### QualityGate 配置（--review 自动注册）

```javascript
{
  threshold: 0.6,
  checkers: [
    createProtagonistChecker({ minRatio: 0.3 }),
    createDurationChecker({ tolerance: 0.15 }),
  ],
}
```

## 性能指标

### 响应时间

| 操作 | 视频时长 | 预估耗时 | 说明 |
|------|----------|----------|------|
| Deconstruct (2fps) | 1h | 3-5 min | 含 ASR |
| Deconstruct (madmom) | 1h | 4-6 min | Python sidecar |
| Plan 生成 | - | 10-30s | 取决于 LLM |
| Assemble (串行) | - | 1-3 min | 取决于 section 数 |
| Assemble (并行 4x) | - | 30s-1 min | 4 路并行 |
| Render | 5 min 输出 | 30-60s | FFmpeg H.264 |

### 缓存效果

| 指标 | 数值 |
|------|------|
| 首次解构 | 完整运行 |
| 重复解构（同哈希） | 跳过（&lt; 100ms） |
| 缓存存储位置 | `.chainlesschain/video-assets/` |

### 资源使用

| 指标 | 数值 |
|------|------|
| 内存占用 (单管线) | &lt; 200MB |
| FFmpeg CPU (渲染) | ~100% 单核 |
| 缓存磁盘 (1h 视频) | ~500MB |

## 测试覆盖率

### 单元测试

```
✅ video-editing-pipeline.test.js      - 流水线核心 (四阶段串联/run/runWithReview)
✅ video-editing-tools.test.js         - 工具 (shot-trimming/review-clip/semantic-retrieval/commit)
✅ video-parallel-orchestrator.test.js - 并行编排 (section拆分/冲突检测/合并)
✅ video-audio-precision.test.js       - 音频精度 (beat-snap/ducking/madmom集成)
✅ video-protocol.test.js              - WS协议 (NDJSON事件/路由)
```

**总覆盖率**: 87 测试，100% 通过

### Desktop 测试

```
✅ video-editing-ipc.test.js           - Desktop IPC 通道
✅ volcengine-video.test.js            - Volcengine 视频生成
```

## 安全考虑

### 文件系统安全

1. **路径验证** — 输入视频/音频路径验证存在性，防止路径遍历
2. **输出目录** — 输出文件写入用户指定目录，不覆盖系统文件
3. **缓存隔离** — 素材缓存存储在 `.chainlesschain/video-assets/`，按哈希隔离

### FFmpeg 安全

1. **参数转义** — FFmpeg 命令参数通过 spawn 数组传递，不使用 shell 字符串拼接
2. **超时控制** — FFmpeg 进程有超时限制，防止无限挂起
3. **资源限制** — 缓存自动清理（`prune --older-than`），防止磁盘耗尽

### LLM 安全

1. **API Key 隔离** — 使用 LLM Category Routing，不在命令行暴露 API Key
2. **提示注入防护** — 用户 instruction 作为用户消息传入，不与系统提示混合
3. **成本控制** — Token 用量追踪，可通过 `session usage` 查看

## 故障排查

### 常见问题

**Q: Deconstruct 报 "FFmpeg not found"?**

检查以下几点:

1. FFmpeg 是否已安装 — `ffmpeg -version`
2. FFmpeg 是否在 PATH 中 — `which ffmpeg`
3. Windows 用户确保安装了完整版（含 libx264）

**Q: ASR 字幕为空?**

可能原因:

1. 视频无音轨 — 使用 `ffprobe` 检查
2. LLM ASR provider 未配置 — 检查 `llm providers` 和 API Key
3. 使用 `--srt` 提供已有字幕文件跳过 ASR

**Q: madmom 安装失败?**

解决方案:

1. 安装 Python 3.8+ 和 pip
2. `pip install madmom` 或 `pip install madmom --user`
3. 如果编译失败，先安装 `pip install numpy cython`
4. 回退到默认 FFmpeg beat 检测（不使用 `--use-madmom`）

**Q: 并行编辑后视频有跳帧?**

检查:

1. 冲突检测是否生效 — 查看输出中的 conflict resolution 信息
2. `--concurrency` 是否太高 — 减少并行数
3. 使用 `--review` 启用质量门控，自动重做低质量段

**Q: 渲染输出无音频?**

检查:

1. `--audio` 是否指定了正确的音频文件
2. 音频编解码器是否支持 — 使用 `ffprobe` 检查
3. `--ducking` 模式下检查 audio-mix.js 日志

### 调试模式

```bash
# 分步执行，逐阶段检查中间产物
chainlesschain video deconstruct --video raw.mp4 --audio bgm.mp3 --json
# 检查 asset-dir 下的 frames/, subtitles.json, beats.json

chainlesschain video plan --asset-dir <dir> --instruction "..." --json
# 检查 shot_plan.json

chainlesschain video assemble --asset-dir <dir> --plan shot_plan.json --json
# 检查 shot_point.json

# 使用 --stream 查看实时进度
chainlesschain video edit --video raw.mp4 --audio bgm.mp3 \
  --instruction "..." --stream 2>&1 | jq .
```

## 关键文件

### CLI 视频编辑核心

| 文件 | 职责 | 说明 |
|------|------|------|
| `packages/cli/src/commands/video.js` | 5 子命令注册 | Commander 入口 |
| `packages/cli/src/skills/video-editing/pipeline.js` | 四阶段编排 | EventEmitter |
| `packages/cli/src/skills/video-editing/parallel-orchestrator.js` | 多段并行 + 冲突解决 | Phase 3 |
| `packages/cli/src/skills/video-editing/reviewer.js` | VLM 审核 + QualityGate | Phase 3 |
| `packages/cli/src/skills/video-editing/beat-snap.js` | Beat snap 卡点对齐 | Phase 4 |

### 素材提取器

| 文件 | 职责 |
|------|------|
| `packages/cli/src/skills/video-editing/extractors/video-extractor.js` | 抽帧 (FFmpeg) |
| `packages/cli/src/skills/video-editing/extractors/audio-extractor.js` | ASR + beat 分析 |
| `packages/cli/src/skills/video-editing/extractors/subtitle-extractor.js` | SRT 解析 |

### 渲染工具

| 文件 | 职责 |
|------|------|
| `packages/cli/src/skills/video-editing/render/ffmpeg-extract.js` | FFmpeg 封装 |
| `packages/cli/src/skills/video-editing/render/ffmpeg-concat.js` | 片段拼接 |
| `packages/cli/src/skills/video-editing/render/audio-mix.js` | ducking 混音 |

### 编辑工具

| 文件 | 职责 |
|------|------|
| `packages/cli/src/skills/video-editing/tools/shot-trimming.js` | 片段裁剪 |
| `packages/cli/src/skills/video-editing/tools/review-clip.js` | VLM 审核片段 |
| `packages/cli/src/skills/video-editing/tools/semantic-retrieval.js` | 语义检索素材 |
| `packages/cli/src/skills/video-editing/tools/commit.js` | 提交编辑结果 |

### AI 提示词

| 文件 | 用途 |
|------|------|
| `packages/cli/src/skills/video-editing/prompts/editor-system.md` | Editor 系统提示 |
| `packages/cli/src/skills/video-editing/prompts/shot-plan.md` | Plan 生成提示 |
| `packages/cli/src/skills/video-editing/prompts/protagonist-detect.md` | 主角检测 |
| `packages/cli/src/skills/video-editing/prompts/aesthetic-analysis.md` | 美学分析 |
| `packages/cli/src/skills/video-editing/prompts/dense-caption.md` | 密集字幕 |

### 协议与技能

| 文件 | 职责 |
|------|------|
| `packages/cli/src/gateways/ws/video-protocol.js` | WebSocket 视频路由 |
| `packages/cli/src/skills/video-editing/SKILL.md` | 技能定义文件 |

## 使用示例

### 最简用法

```bash
# 一键剪辑：视频 + 音乐 + 指令 → 输出
chainlesschain video edit --video raw.mp4 --audio bgm.mp3 \
  --instruction "紧凑的产品展示视频"
```

### 全功能剪辑

```bash
# 并行 + 质量门控 + beat卡点 + 对白压低
chainlesschain video edit \
  --video raw.mp4 \
  --audio bgm.mp3 \
  --instruction "节奏感强的角色蒙太奇" \
  --parallel --concurrency 8 \
  --review \
  --use-madmom --snap-beats \
  --ducking \
  --output montage.mp4
```

### Web 集成（NDJSON 流式）

```bash
# 实时进度事件，适合前端进度条
chainlesschain video edit \
  --video raw.mp4 \
  --audio bgm.mp3 \
  --instruction "..." \
  --stream | while read line; do
    echo "$line" | jq -r '.type + ": " + (.message // .phase // "")'
  done
```

### 分步调试

```bash
# 1. 解构（结果缓存，可反复跑 plan/assemble）
chainlesschain video deconstruct --video raw.mp4 --audio bgm.mp3 --use-madmom

# 2. 生成计划（可编辑 shot_plan.json 后再 assemble）
chainlesschain video plan --asset-dir ./assets/abc123 --instruction "节奏感强"

# 3. 编辑（并行 + 质量检查）
chainlesschain video assemble --asset-dir ./assets/abc123 --plan shot_plan.json \
  --parallel --review

# 4. 渲染
chainlesschain video render --video raw.mp4 --points shot_point.json --output final.mp4
```

### 素材管理

```bash
# 查看缓存
chainlesschain video assets list

# 清理旧缓存
chainlesschain video assets prune --older-than 30
```

## 相关文档

- [QualityGate 通用质量门控 →](/chainlesschain/quality-gate)
- [Session-Core 会话运行时 →](/chainlesschain/session-core)
- [AI 音视频创作模板 →](/chainlesschain/ai-media-creator)
- [多智能体协作 (Cowork) →](/chainlesschain/cowork)
- [代理模式 (agent) →](/chainlesschain/cli-agent)
- [WebSocket 服务器 (serve) →](/chainlesschain/cli-serve)

---

> 本文档为视频剪辑 Agent 完整参考。设计文档详见：
>
> - [93. CutClaw 借鉴 — 视频剪辑 Agent](/design/modules/93-cutclaw-video-editing-agent)
> - [90. AI 视频生成 Volcengine Seedance](/design/modules/90-ai-video-generation-seedance)
