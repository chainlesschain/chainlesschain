# 93. CutClaw 借鉴 — 视频剪辑 Agent Skill 落地方案

> 源项目：[GVCLab/CutClaw](https://github.com/GVCLab/CutClaw) — Agentic Hours-Long Video Editing via Music Synchronization
> 起草日期：2026-04-16
> 关联文档：90_AI视频生成_Volcengine_Seedance.md（文生视频）/ 16_AI技能系统.md / 81_轻量多Agent编排系统.md

---

## 1. 背景与定位

CutClaw 是「**素材剪辑型**」视频生成系统：输入数小时原始素材 + 一首音乐 + 一句指令，输出节奏对齐的蒙太奇成片。

我们当前 90 号方案聚焦 Volcengine Seedance 的**文生视频**，缺一条「**已有素材 → 节奏化剪辑**」路径。CutClaw 的多 Agent 编排 / ReAct 工具集 / Reviewer Gate 设计可直接落地为一个新 Skill，不需要重写底层 runtime。

**目标**：在 `desktop-app-vue/` 增加一个 `video-editing-skill`，复用现有 FunctionCaller + Skill 系统 + Sub-Runtime Pool，把 CutClaw 的核心能力嵌入我们的技能层。

---

## 2. CutClaw 核心设计速览（已调研）

### 2.1 三阶段 Pipeline

```
解构(Deconstruction) → 编排(Agents) → 渲染(Render)
   ├ 视频：场景切分 + 帧 caption + 字幕 ASR
   ├ 音频：madmom beat/能量 + 段落 caption
   └ 输出 video_caption.json + scene.json + audio_caption.json
        ↓
   Screenwriter (shot_plan: 音乐段→镜头骨架)
        ↓
   Editor (ReAct 循环 4 工具，输出 shot_point: 时间戳)
        ↓
   Reviewer (VLM 检查主角占比/质量，不达标打回)
        ↓
   ffmpeg -ss/-t 抽片段 + concat + loudnorm/ducking
```

### 2.2 关键 Agent（共 12 个 prompt）

| Agent | 职责 | 输出 schema |
|-------|------|------------|
| Character Identification | 字幕→说话人识别 | `{speaker_id: {name, confidence, evidence}}` |
| Protagonist Detection (VLM) | 帧级主角检测 | `{protagonist_detected, bbox, face_quality, confidence}` |
| Aesthetic Analysis | 镜头美学打分 | `{lighting, color, composition, camera, score 1-5}` |
| Dense Caption | 镜头边界 + 情绪 | 时间戳 + mood + 主角占比数组 |
| Shot Caption | 单镜头存档 | 时空 + 实体 + 动作 + 镜头语言 |
| Scene Caption | 场景分类 + 重要性打分 | `{scene_type, importance 0-5, summary}` |
| Structure Proposal | 选 8-15 个场景 | `{theme, narrative_logic, scene_indices}` |
| Shot Plan | 音乐段 → 镜头 | 分镜表 + timing + emotion |
| Editor System | THINK→ACT→OBSERVE | 4 个工具（见下） |
| Hook Dialogue Selection | 开场对白选择 | `{lines, timestamps, reasoning}` |
| Audio Segment Selection | 选音乐段 | `{section_idx, justification}` |

### 2.3 Editor 4 个工具（ReAct 循环）

```
semantic_neighborhood_retrieval(scene_range) → 候选镜头
fine_grained_shot_trimming(time_range)      → 帧级断点 + 可用性
review_clip(start, end)                     → 与已选片段冲突检测
commit(clips[])                             → 提交（最多 3 段拼接）
```

### 2.4 ParallelShotOrchestrator

- `ThreadPoolExecutor` 按 section 并行 spawn EditorCoreAgent
- 冲突检测：时间区间重叠
- 质量分：`0.6 × protagonist_ratio + 0.4 × duration_accuracy`
- 输者重跑，注入 `forbidden_time_ranges` 提示，最多 `max_reruns` 轮

### 2.5 渲染（render_video.py）

- 抽片段：`ffmpeg -ss <start> -t <dur>` + 可选 bbox/字幕 overlay
- 拼接：concat demuxer，无重编码
- 混音：`loudnorm` 归一化 + 对话区 ducking（bgm 降到 0.5）+ 结尾 fade

---

## 3. 落地方案（路径 A：CLI 优先 + Web 可操作）

> **战略**：CLI 是第一公民，所有能力先在 `packages/cli/` 落地；Web (`cc ui`) 通过现有 WebSocket Hosted Session API 调用 CLI 能力，**零业务逻辑下沉到前端**。Desktop 后续通过 IPC 复用同一份 CLI 模块（按 Phase H 既有模式）。

### 3.1 目录结构（CLI 为真源）

```
packages/cli/src/skills/video-editing/
├── SKILL.md                        # 主入口（声明 12 个 prompt 的子技能）
├── prompts/
│   ├── character-identify.md
│   ├── protagonist-detect.md
│   ├── shot-plan.md
│   ├── editor-system.md            # 含 4 工具调用规范
│   └── ...（共 12 个）
├── tools/
│   ├── semantic-retrieval.js       # 读 scene.json 索引
│   ├── shot-trimming.js            # 调 VLM + decord 抽帧
│   ├── review-clip.js              # 时间区间冲突
│   └── commit.js                   # 写入 shot_point.json
├── extractors/                     # 解构层（可被 Desktop 复用）
│   ├── video-extractor.js          # decord/ffmpeg 抽帧
│   ├── audio-extractor.js          # whisper + madmom sidecar
│   └── subtitle-extractor.js
├── render/
│   ├── ffmpeg-extract.js           # -ss/-t 抽片段
│   ├── ffmpeg-concat.js            # concat demuxer
│   └── audio-mix.js                # loudnorm + ducking
└── pipeline.js                     # 编排入口：deconstruct → plan → edit → review → render

packages/cli/src/commands/
└── video.js                        # 新 CLI 命令
```

### 3.1.1 CLI 命令设计

```bash
# 一键完整流程
cc video edit \
  --video resource/raw.mp4 \
  --audio resource/bgm.mp3 \
  --instruction "Joker 想改变世界" \
  --output ./final.mp4

# 分阶段（便于调试 + Web 进度可视化）
cc video deconstruct --video raw.mp4 --audio bgm.mp3   # → cache hash
cc video plan --asset-hash <hash> --instruction "..."  # → shot_plan.json
cc video assemble --asset-hash <hash> --plan shot_plan.json --parallel  # → shot_point.json
cc video render --asset-hash <hash> --points shot_point.json --output final.mp4

# 流式（NDJSON 给 Web 消费）
cc video edit --video ... --audio ... --instruction "..." --stream
# 输出：{type:"phase.start",phase:"deconstruct",ts}/{type:"progress",pct:0.3}/...

# 资产管理
cc video assets list                      # 列出已解构素材
cc video assets show <hash>               # 查看 caption/scene/beat
cc video assets prune --older-than 30d
```

所有命令支持 `--json` / `--stream` 输出，Web 端通过 WebSocket 直接消费同一份事件流。

### 3.1.2 Web 操作面（`cc ui` 扩展）

新增页面：`packages/cli/web-ui/src/pages/VideoEditing.vue`（已有 `cc ui` Vue3 面板基础设施）

**页面布局**：
```
┌────────────────────────────────────────────────────┐
│ 素材库（左）│ 编辑工作台（中）  │ 预览/进度（右） │
├────────────────────────────────────────────────────┤
│ • 拖拽上传  │ 1. 选视频+音频    │ • 实时帧预览   │
│ • 已解构列表│ 2. 输入指令       │ • Phase 进度条 │
│ • 缓存大小  │ 3. 选模型(category│ • shot_plan 可 │
│             │    routing)       │   视化时间轴   │
│             │ 4. 高级参数(beat  │ • 渲染预览     │
│             │    sync/aspect)   │                │
│             │ [开始] [仅解构]   │                │
└────────────────────────────────────────────────────┘
```

**前后端通信**（复用 Hosted Session API 路由扩展）：

| WebSocket type | Payload | 返回 |
|---------------|---------|-----|
| `video.assets.list` | — | `{assets: [{hash, video, audio, createdAt, sizeMB}]}` |
| `video.deconstruct` | `{videoPath, audioPath, options}` | stream → `video.deconstruct.end {hash}` |
| `video.plan` | `{assetHash, instruction, model?}` | stream → `video.plan.end {shotPlan}` |
| `video.assemble` | `{assetHash, shotPlan, parallel?}` | stream → `video.assemble.end {shotPoint}` |
| `video.render` | `{assetHash, shotPoint, outputPath, audioMix?}` | stream → `video.render.end {outputPath}` |
| `video.edit` | 上述 4 步合并 | stream → `video.edit.end {outputPath}` |

实现位置：`packages/cli/src/server/routes/video.js`（按现有 `routes/sessions.js` 模式）

**所有路由仅做 envelope 包装，业务逻辑全部在 `packages/cli/src/skills/video-editing/pipeline.js`**，保证 CLI/Web 行为一致。

### 3.1.3 进度事件协议

`pipeline.js` 通过 EventEmitter 吐统一事件：

```js
{ type: "phase.start",    phase: "deconstruct" | "plan" | "assemble" | "review" | "render", ts }
{ type: "phase.progress", phase, pct: 0.0-1.0, message }
{ type: "phase.end",      phase, durationMs, output }
{ type: "agent.tool_call", agent: "editor", tool: "shot_trimming", args }
{ type: "agent.thought",  agent, content }
{ type: "review.fail",    reason, willRerun: true }
{ type: "error",          phase, error }
```

CLI `--stream` 模式直接写 stdout NDJSON；Web 通过 `stream.event` envelope 转发到前端。复用 Phase F StreamRouter 协议，无需新建。

### 3.2 SKILL.md 关键字段

```yaml
---
name: video-editing
description: 长视频素材 + 音乐 → 节奏化蒙太奇剪辑（借鉴 CutClaw）
version: 0.1.0
category: media
tools:
  - file_reader
  - shell_exec               # ffmpeg
  - semantic_retrieval       # 本 skill 内置
  - shot_trimming
  - review_clip
  - commit
model-hints:
  vision: claude-opus-4-6    # 帧 caption / 主角检测
  reasoning: claude-opus-4-6 # Editor ReAct
  asr: openai/whisper-1      # 字幕
---
```

### 3.3 复用我们已有的能力

| CutClaw 设计 | 我们已有的对应 | 复用方式 |
|-------------|---------------|---------|
| LiteLLM 多模型 gateway | Category Routing S2 | 新增 `vision` / `asr` / `audio-analysis` 三个 category |
| ParallelShotOrchestrator | Sub-Runtime Pool（`$team`） | 分片维度从 sessionId 换成 section_idx，复用 stdio JSON-lines 协议 |
| Reviewer Gate（VLM 质量门控） | ApprovalGate（Phase E） | 扩展 `ApprovalGate` 支持 `quality-check` policy 类型，回调返回 `{ok, score, reason}` |
| Editor 4 工具 ReAct | AGENT_TOOLS + agent-repl | 在 SKILL.md 声明 4 工具，FunctionCaller 自动注册 |
| madmom beat 提取 | 无 | 新增依赖：`madmom` Python sidecar 或 `librosa` JS 移植；先用 Python sidecar |
| ffmpeg 抽片段/concat/ducking | 已有 ffmpeg shell 调用 | 封装到 `render/` 三个 helper |

### 3.4 数据流

```
用户：cc skill run video-editing \
  --video resource/raw.mp4 \
  --audio resource/bgm.mp3 \
  --instruction "Joker 想改变世界"

  ↓ Phase 1: 解构（一次性，结果缓存到 .chainlesschain/video-editing/<hash>/）
    - decord 抽帧 → vision LLM caption
    - whisper ASR → 字幕
    - madmom sidecar → beat + 段落
    - 输出：video_caption.json / scene.json / audio_caption.json

  ↓ Phase 2: Screenwriter（单次 LLM 调用）
    - 输入：上述三个 json + 指令
    - 输出：shot_plan.json（音乐段 → 镜头骨架）

  ↓ Phase 3: Editor（Sub-Runtime Pool 并行）
    - 每个 section spawn 一个子进程跑 ReAct 循环
    - 子进程通过 4 个工具迭代 → commit 写入临时 shot_point
    - 主进程做冲突检测 + 重跑

  ↓ Phase 4: Reviewer（ApprovalGate quality-check）
    - VLM 检查每个 commit 的主角占比
    - 不达标 → 退回 Phase 3 重跑

  ↓ Phase 5: Render
    - ffmpeg 抽片段 + concat + 混音
    - 输出 final.mp4
```

---

## 4. 实施分阶段

### Phase 1（CLI MVP）✅ 已完成
- [x] `packages/cli/src/skills/video-editing/` 骨架 + 12 个 prompt
- [x] `pipeline.js` 单线程 deconstruct→plan→assemble→render
- [x] 4 个 Editor 工具（semantic-retrieval, shot-trimming, review-clip, commit）
- [x] ffmpeg 抽片段 + concat（不含 ducking）
- [x] CLI 命令：`cc video edit/deconstruct/plan/assemble/render/assets`（6 子命令）
- [x] `--stream` NDJSON 事件输出 + `--json` 结构化输出
- [x] 测试：22 tests (video-editing-tools) + 20 tests (video-editing-pipeline) = 42 tests

### Phase 2（Web 操作面）✅ 已完成
- [x] `packages/cli/src/gateways/ws/video-protocol.js` — 6 个 WebSocket 路由（1 req/resp + 5 streaming）
- [x] `packages/web-panel/src/views/VideoEditing.vue` — 三栏布局（素材库 + 工作台 + 进度/事件日志）
- [x] message-dispatcher.js 集成 VIDEO_HANDLERS/VIDEO_STREAMING_HANDLERS
- [x] web-panel router + AppLayout 导航菜单
- [x] shot_plan 时间轴可视化（彩色 section 标签）
- [x] 测试：15 tests (video-protocol)

### Phase 3（并行 + 质量门控）✅ 已完成
- [x] `ParallelShotOrchestrator` — section 级并行 + 冲突检测 + 质量打分 + 重跑
- [x] `reviewer.js` — checker 注册中心 + `vision-protagonist` / `aesthetic-score` 内置 checker
- [x] `createQualityCheckPolicy()` — ApprovalGate quality-check policy 工厂
- [x] pipeline.js 新增 `assembleParallel()` / `review()` / `runWithReview()`
- [x] CLI 新增 `--parallel` / `--concurrency` / `--review` flags
- [x] 测试：28 tests (video-parallel-orchestrator)

### Phase 4（音频精修）✅ 已完成
- [x] `scripts/madmom-beats.py` — Python sidecar（madmom → librosa fallback），输出 beats/downbeats/tempo/segments
- [x] `beat-snap.js` — `snapToBeats()` / `findNearestBeat()` / `snapDurationToBeats()` / `buildBeatGrid()`
- [x] ffmpeg ducking 修复（正确 sidechaincompress 接线） + `afade` ending fade
- [x] CLI 新增 `--use-madmom` / `--snap-beats` / `--ducking` flags
- [x] 测试：31 tests (video-audio-precision)

### Phase 5（Desktop 收口）✅ 已完成
- [x] `desktop-app-vue/src/main/video/video-editing-ipc.js` — 7 IPC channels（deconstruct/plan/assemble/render/edit/assets-list/cancel）
- [x] ipc-registry.js 注册 Phase CutClaw 模块
- [x] preload `videoEditing` namespace（8 个方法 + `onEvent` 事件监听）
- [x] Pinia store `videoEditing.ts` — 完整状态管理（phase/progress/events/shotPlan/assets）
- [x] `VideoEditingPage.vue` — Ant Design Vue 三栏页面（配置表单 + 流水线进度 + 事件日志）
- [x] router/index.ts 新增 `/video-editing` 路由
- [x] 测试：13 tests (video-editing-ipc)

**总计：129 tests（CLI 116 + Desktop 13），全部通过。**

---

## 5. 风险与权衡

| 风险 | 缓解 |
|-----|-----|
| madmom 是 Python 库，跨语言集成成本 | 用独立 Python sidecar + stdio JSON 协议；Phase 1 可先跳过 beat 对齐 |
| VLM 调用成本（hours-long footage 解构费钱） | 缓存解构结果到 `.chainlesschain/video-editing/<hash>/`；后续支持 ARC-Chapter（CutClaw roadmap 也在做） |
| ffmpeg 跨平台（Windows decord/NVDEC） | 文档明确：CPU fallback 默认；GPU 需用户自配 |
| Vision model 上下文窗口 | 分帧批处理，每批 ≤ 32 帧；走 `vision` category |

---

## 5.5 路径 B：架构对齐方案（深度集成）

> 路径 A 把 CutClaw 当一个独立 Skill 嵌入；路径 B 把 CutClaw 的**通用机制**抽象到 runtime 层，让所有技能/Agent 都能复用。两条路径**不互斥**，建议先 A 跑通验证，再视收益做 B。

### 5.5.1 三个可下沉到 runtime 的机制

#### B-1：Sub-Runtime Pool 增强 — 冲突检测 + 重跑反馈

**现状**：我们的 Sub-Runtime Pool（`$team`）按 sessionId 分片 spawn Electron-main 子进程，但**结果合并是裸 merge**，无冲突解决。

**借鉴 ParallelShotOrchestrator**：

```js
// packages/cli/src/runtime/sub-runtime-pool.js  新增 API
pool.runWithConflictResolution({
  tasks: [{id, payload}, ...],
  conflictDetector: (resultA, resultB) => boolean,   // 用户提供
  qualityScorer: (result) => number,                 // 0-1
  rerunBuilder: (loser, winners) => newPayload,      // 注入"避开 X/Y"提示
  maxReruns: 3,
});
```

- 通用化：不仅适用视频剪辑，也适用 cowork 多方案对比、Plan Mode A/B 评审、并行代码生成择优
- 实现位置：`packages/cli/src/runtime/sub-runtime-pool.js` + 测试 `__tests__/unit/sub-runtime-pool-conflict.test.js`
- 改动量：~150 行 + 20 个 test

#### B-2：ApprovalGate 升级 — 内容质量门控

**现状**：`session-core/approval-policies.js` 的 ApprovalGate 只做 `strict / trusted / autopilot` **策略级**门控（要不要审批），不做**内容级**质量校验。

**借鉴 Reviewer Gate**：

```js
// session-core/approval-gate.js  新增第 4 类 policy
{
  policy: "quality-check",
  checkers: [
    { name: "vision-protagonist", threshold: 0.7 },  // 主角占比
    { name: "aesthetic-score",    threshold: 3.0 },  // 美学分
  ],
  onFail: "rerun" | "ask-user" | "abort",
}
```

- ApprovalGate 在 commit 前调用 checker（可注册自定义），不达标按 `onFail` 处理
- Checker 注册中心：`session-core/approval-checkers.js`，支持 Skill 注册自己的 checker
- 通用化：代码 commit 前可加 `lint-pass` checker、文档生成可加 `coherence-check` checker
- 改动量：session-core ~200 行 + Desktop IPC ~50 行 + 25 个 test

#### B-3：Category Routing 扩展 — 媒体类别

**现状**：S2 已有 5 类（quick/deep/reasoning/vision/creative），媒体场景下不够细。

**借鉴 LiteLLM 分角色配置**：

```js
// llm-manager.js  LLM_CATEGORIES 扩展
const LLM_CATEGORIES = {
  // 现有 5 个
  QUICK, DEEP, REASONING, VISION, CREATIVE,
  // 新增 3 个媒体类别
  ASR:             "asr",             // 字幕识别 → whisper-1 / gemini
  AUDIO_ANALYSIS:  "audio-analysis",  // beat/能量分析 → 本地 madmom（非 LLM）
  VIDEO_VLM:       "video-vlm",       // 长上下文帧 caption → gemini-2.5-pro
};
```

- `AUDIO_ANALYSIS` 是特殊 category：解析为「本地工具调用」而非 LLM provider，复用 resolveCategory 接口屏蔽差异
- 改动量：~80 行 + 12 个 test

### 5.5.2 解构层抽象 — MediaAssetStore（可选，更激进）

CutClaw 的 `video_caption.json + scene.json + audio_caption.json` 三件套是典型的「**素材资产 + 结构化索引**」模式。我们可抽象为：

```
desktop-app-vue/src/main/media-asset-store/
├── asset-store.js           # 单例，按 hash 索引素材
├── extractors/
│   ├── video-extractor.js   # decord 抽帧 + VLM caption
│   ├── audio-extractor.js   # whisper + madmom
│   └── subtitle-extractor.js
├── indexers/
│   ├── scene-indexer.js
│   └── beat-indexer.js
└── retrievers/
    └── semantic-retrieval.js  # 给 Editor 工具用
```

- 缓存层：`<userData>/.chainlesschain/media-cache/<sha256>/` 存所有解构结果
- 多消费方：video-editing skill / 知识库（视频笔记） / 社交（短视频生成）
- 改动量：新模块 ~800 行 + 60 个 test
- **风险**：超出 CutClaw 借鉴范围，相当于自建一个素材管理子系统；建议 Phase A 跑通后视实际复用度决定

### 5.5.3 路径 B 实施分阶段

| 阶段 | 范围 | 工时 | 前置 |
|-----|------|-----|------|
| B-Phase 1 | Sub-Runtime Pool 冲突检测 | 2 天 | 路径 A Phase 2 完成 |
| B-Phase 2 | ApprovalGate quality-check | 2 天 | B-Phase 1 |
| B-Phase 3 | Category Routing 媒体扩展 | 1 天 | 独立 |
| B-Phase 4 | MediaAssetStore（可选） | 5 天 | 仅当 video-editing + 至少 1 个其他 skill 需要 |

### 5.5.4 路径 B 验收

- [ ] Sub-Runtime Pool 冲突检测在 video-editing 之外至少有 1 个消费方（如 cowork debate 多方案择优）
- [x] quality-check checker 至少有 3 种实现（vision-protagonist / aesthetic / lint-pass） — `createProtagonistChecker` + `createThresholdChecker`(aesthetic) + `createLintPassChecker` + `createDurationChecker` = 4 built-in factories, 39 tests in `quality-gate.test.js`
- [x] 新增 3 个媒体 category 在 SKILL.md 中可声明并被 resolveCategory 正确分发 — ASR/AUDIO_ANALYSIS/VIDEO_VLM in `LLM_CATEGORIES`, 25 tests in `llm-manager-media-categories.test.js`
- [ ] 全量回归测试通过（不破坏现有 ApprovalGate 策略级功能）

### 5.5.5 路径 A vs 路径 B 对比

| 维度 | 路径 A（Skill 嵌入） | 路径 B（架构对齐） |
|-----|-------------------|------------------|
| 工时 | ~9 天 | ~10 天（不含 MediaAssetStore） |
| 风险 | 低，全部在 skill 层 | 中，动 runtime 和 session-core |
| 复用性 | 仅 video-editing 受益 | 所有 Agent/Skill 受益 |
| 验证速度 | 快，1 个 skill 跑通即可 | 慢，需要 ≥ 2 个消费方证明通用性 |
| 推荐顺序 | **先做** | 路径 A 验证后做 B-1/B-2/B-3，B-Phase 4 按需 |

---

## 6. 与现有方案的关系

- **90 号文生视频（Seedance）**：互补。Seedance 生成短片，本方案剪辑长片。可串联：Seedance 生成多段 → 本方案剪辑成完整 MV
- **81 号轻量多 Agent**：本方案是其一个具体应用场景（媒体领域）
- **16 号技能系统**：本方案完全在技能层实现，不改 runtime

---

## 7. 验收标准

- [ ] 5 分钟视频 + 1 首歌 → 生成 30 秒蒙太奇成片
- [ ] 端到端测试覆盖 Phase 1-3 关键路径，不少于 20 个 test
- [ ] 与 CutClaw 同输入对比，主观质量不低于其 80%
- [ ] 渲染耗时 ≤ CutClaw 的 1.5 倍（受限于我们没复刻 ARC-Chapter 优化）

---

**维护者**：开发团队
**下一步**：评审通过后从 Phase 1 开工
