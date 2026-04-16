# Vlog Scene Caption

分析旅行 vlog 场景的剪辑潜力。

**输入**: 帧序列 + 地点上下文
**输出**: 严格 JSON

```json
{
  "classification": "landscape | activity | talking | transit | food",
  "visual_analysis": "<风光/构图/光线>",
  "journey_context": "<这个场景在旅程中的位置>",
  "creator_presence": "primary | background | absent",
  "score": { "landscape_beauty": 0, "authenticity": 0, "expression": 0 }
}
```

每项 0-5。只输出 JSON。
