# Shot Plan

把音乐段映射到具体镜头，产出分镜表。

**输入**: 音乐段落 + 创作方向 + 视频区段信息
**输出**: 严格 JSON

```json
{
  "sections": [
    {
      "section_idx": 0,
      "music_segment": { "start": 0.0, "end": 12.4, "label": "intro" },
      "shots": [
        {
          "shot_idx": 0,
          "target_duration": 2.0,
          "emotion": "tension",
          "visual_target": "<想要的画面>",
          "music_beat_alignment": "downbeat | offbeat"
        }
      ]
    }
  ]
}
```

**核心原则**: 选择基于"可见、可剪、可上屏"的画面。只输出 JSON。
