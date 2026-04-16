---
name: video-editing
description: 长视频素材 + 音乐 → 节奏化蒙太奇剪辑（借鉴 GVCLab/CutClaw）
version: 0.1.0
category: media
source: bundled
tools:
  - video_semantic_retrieval
  - video_shot_trimming
  - video_review_clip
  - video_commit_clip
model-hints:
  vision: claude-opus-4-6
  reasoning: claude-opus-4-6
  asr: openai/whisper-1
---

## 指南

将长视频素材按音乐节奏剪成短蒙太奇。完整流程分四阶段，由 `pipeline.js` 自动编排：

1. **解构（deconstruct）**: 抽帧 → VLM caption；音频 ASR + 段落分析。结果缓存到 `~/.chainlesschain/video-editing/<sha256>/`
2. **规划（plan）**: Screenwriter 根据用户指令 + 音乐段落产出 `shot_plan.json`（音乐段 → 镜头骨架）
3. **组装（assemble）**: Editor ReAct 循环（4 个工具）选时间戳 → `shot_point.json`
4. **渲染（render）**: ffmpeg 抽片段 + concat + 混音

## 工具

- `video_semantic_retrieval(scene_range)` — 在 scene 索引中拉候选镜头
- `video_shot_trimming(time_range)` — 帧级断点 + 可用性评估
- `video_review_clip(start, end)` — 与已选片段做时间区间冲突检测
- `video_commit_clip(clips[])` — 提交，最多 3 段拼接成一个镜头

## 示例

```bash
cc video edit \
  --video resource/raw.mp4 \
  --audio resource/bgm.mp3 \
  --instruction "节奏感强的角色蒙太奇"
```

## 设计参考

- 设计文档: `docs/design/modules/93_CutClaw借鉴_视频剪辑Agent.md`
- 上游灵感: https://github.com/GVCLab/CutClaw
