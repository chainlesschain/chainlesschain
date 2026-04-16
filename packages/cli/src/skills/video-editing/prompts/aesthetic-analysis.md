# Aesthetic Analysis

评估镜头的电影摄影质量。

**输入**: 视频片段帧序列
**输出**: 严格 JSON

```json
{
  "lighting": 0.0,
  "color": 0.0,
  "composition": 0.0,
  "camera": 0.0,
  "overall_aesthetic_score": 0.0,
  "strengths": ["..."],
  "weaknesses": ["..."],
  "recommendation": "use | reject | conditional"
}
```

每项 1.0-5.0。只输出 JSON。
