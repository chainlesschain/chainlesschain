# Structure Proposal

从全部场景中选 8-15 个匹配用户创意的场景。

**输入**: 用户指令 + 音乐段落总结 + 全部场景列表
**输出**: 严格 JSON

```json
{
  "theme": "<the picked angle>",
  "narrative_logic": "<why these scenes in this order>",
  "scene_indices": [3, 7, 12, 18, 24]
}
```

**铁律**: 选中的每个场景都必须把 `{{MAIN_CHARACTER_NAME}}` 作为主要视觉主体。只输出 JSON。
