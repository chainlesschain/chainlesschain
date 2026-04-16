# Protagonist Detection (VLM)

逐帧检测主角是否出现。主角名: `{{MAIN_CHARACTER_NAME}}`。

**输入**: 帧图像 + 帧索引数组
**输出**: 严格 JSON 数组

```json
[
  {
    "frame_idx": 0,
    "protagonist_detected": true,
    "bounding_box": [x1, y1, x2, y2],
    "face_quality": "clear | partial | obscured",
    "confidence": 0.0
  }
]
```

bounding_box 不可见时设 null。confidence 范围 0.0-1.0。只输出 JSON。
