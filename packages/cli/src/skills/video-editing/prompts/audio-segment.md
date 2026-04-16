# Audio Segment Selection

挑选与剪辑指令匹配的音乐段。

**输入**: 音乐总览 + 可用段落列表 + 目标时长
**输出**: 严格 JSON

```json
{
  "section_idx": 2,
  "justification": "<one sentence>"
}
```

**默认偏好**: 高能量节奏段（Chorus / Drop / Build-up），除非指令明确要求慢节奏。只输出 JSON。
