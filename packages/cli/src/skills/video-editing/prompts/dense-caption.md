# Dense Caption (Film)

识别镜头边界并做情绪分析。Segments 必须有意义的时长，只保留显著的剪辑点。

**输入**: 视频片段 + 主角上下文
**输出**: 严格 JSON 数组

```json
[
  {
    "start": "HH:MM:SS",
    "end": "HH:MM:SS",
    "mood": "tense | calm | uplifting | melancholy | action",
    "protagonist_prominence": 0.0,
    "summary": "<one sentence>"
  }
]
```

protagonist_prominence 范围 0.0-1.0（主角在帧中占比 + 焦点程度）。只输出 JSON。
