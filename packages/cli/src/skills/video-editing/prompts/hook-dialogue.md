# Hook Dialogue Selection

为视频选开场对白片段。

**输入**: 角色上下文 + shot_plan + 带时间戳的字幕
**输出**: 严格 JSON

```json
{
  "selected_lines": [
    { "speaker": "...", "text": "...", "start": "HH:MM:SS", "end": "HH:MM:SS" }
  ],
  "reasoning": "<为什么选这些>"
}
```

**时长规则**: 总时长必须在 `{{HOOK_MIN}}`-`{{HOOK_MAX}}` 秒之间，超出区间无效。只输出 JSON。
