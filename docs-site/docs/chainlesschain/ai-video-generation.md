# AI 视频生成 (Volcengine Seedance)

桌面端支持通过火山方舟 Seedance 文生视频能力，直接从提示词生成真实 AI 视频。

## 准备

在「AI 设置 → 火山方舟」中填写：

- `apiKey` — 方舟控制台的 API Key
- `baseURL` — 默认 `https://ark.cn-beijing.volces.com/api/v3`
- `videoModel` — 默认 `doubao-seedance-1.0-lite`（可选 `1.5-pro`、`pixeldance`）

## 在渲染进程调用

```js
const unsubscribe = window.api.video.onGenerateProgress((p) => {
  // p.stage ∈ task-created | status-update | downloading | complete
  console.log(p.stage, p);
});

const result = await window.api.video.generate({
  prompt: "a mountain lake at sunrise, time lapse",
  outputPath: "D:/videos/demo.mp4",
  ratio: "16:9",        // 可选
  duration: 5,           // 秒，可选
  resolution: "720p",    // 可选
  imageUrl: undefined,   // 可选，提供则进入首帧图驱动模式
});

unsubscribe();
// result: { path, size, taskId, model }
```

## 参数说明

| 字段 | 说明 |
|------|------|
| `prompt` | 文本描述（必填） |
| `outputPath` | 本地落盘路径（必填） |
| `ratio` | 画面比例：`16:9` / `9:16` / `1:1` |
| `duration` | 视频秒数，Seedance 建议 4–10 |
| `resolution` | `480p` / `720p` / `1080p`（取决于模型） |
| `imageUrl` | 首帧图 URL，提供则按首帧驱动生成 |
| `model` | 覆盖默认 `videoModel` |
| `provider` | 预留，目前仅 `volcengine` |

## 计费提示

Seedance 按输出时长计费（¥0.15–0.3/s），每次调用都会产生费用。建议：

- 先用 `doubao-seedance-1.0-lite` 做快速迭代，确认提示词后再切到 pro 模型
- 避免在自动化脚本中做循环调用，成本会快速累加
- 测试环境请使用 mock（见 `tests/unit/video/volcengine-video.test.js`），勿调用真实 API

## 失败排查

| 错误 | 处理 |
|------|------|
| `Volcengine apiKey not configured` | 去「AI 设置」填写 apiKey |
| `Volcengine createTask 401: ...` | apiKey 无效或未授权该模型 |
| `task failed: SensitiveContent` | 提示词被内容安全过滤，换个写法 |
| `poll timeout after 600000ms` | 方舟队列拥塞，稍后重试或改用 lite 模型 |

## 架构文档

详见 [`docs/design/modules/90_AI视频生成_Volcengine_Seedance.md`](../design/90_AI视频生成_Volcengine_Seedance.md)。
