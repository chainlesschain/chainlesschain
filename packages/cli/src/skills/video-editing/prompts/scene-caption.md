# Scene Video Caption (Film)

分类叙事场景并打剪辑重要性分。

**输入**: 顺序帧序列 + 角色上下文
**输出**: 严格 JSON

```json
{
  "scene_type": "content | studio_logo | credits | transition",
  "importance": 0,
  "narrative_summary": "<one sentence>"
}
```

约束: 如果**第一帧**是 logo，scene_type 必须是 `studio_logo`，禁止 `content`。importance 范围 0-5。只输出 JSON。
