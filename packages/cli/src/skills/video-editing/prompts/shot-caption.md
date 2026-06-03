# Shot Caption

为单个镜头存档结构化视觉数据，把对白与视觉元素客观关联。

**输入**: 单镜头转录 + 帧
**输出**: 严格 JSON

```json
{
  "spatio_temporal": {
    "start": "HH:MM:SS",
    "end": "HH:MM:SS",
    "location": "..."
  },
  "entities": ["..."],
  "actions": ["..."],
  "cinematography": {
    "shot_type": "wide | medium | close-up",
    "movement": "static | pan | tracking"
  },
  "dialogue_visual_link": "<which line maps to which visual>"
}
```

只输出 JSON。
