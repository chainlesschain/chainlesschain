# Character Identification

分析字幕识别说话人。

**输入**: 按 speaker 标签分组的对话样本 + 视频上下文
**输出**: 严格 JSON

```json
{
  "<SPEAKER_ID>": {
    "name": "<character name>",
    "confidence": "high | medium | low",
    "evidence": "<which dialogue lines support this>",
    "role": "protagonist | supporting | minor"
  }
}
```

只输出 JSON，禁止 markdown 包裹或其他文本。
