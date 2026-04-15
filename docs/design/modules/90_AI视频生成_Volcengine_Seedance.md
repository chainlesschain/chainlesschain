# 90. AI 视频生成 — Volcengine Seedance 集成

> 版本：v5.0.2.10（2026-04-15）
> 状态：已落地，单元 + 集成 + 全链路测试全绿（15 tests）

## 背景

此前 `video:generate` IPC 仅用 FFmpeg 生成 `color=blue + drawtext` 占位 mp4（约 45KB，无 AI 内容）。本模块接入火山方舟 Seedance 文生视频 API，提供真实 AI 视频生成能力。

## 架构

```
Renderer                 Preload              Main (ipcMain)             Provider           Volcengine Ark
─────────                ───────              ──────────────             ────────           ──────────────
window.api.video         contextBridge  ─►   video:generate handler ─►  video-generator ─► POST /tasks     ┐
  .generate(params)                          (video-ipc.js)              (router)           GET  /tasks/id  │ 轮询
                                                                                            GET  video_url  │ 下载
  .onGenerateProgress  ◄── webContents.send("video:generate:progress", {stage,...})  ◄──    provider        ┘
```

### 关键模块

| 文件 | 职责 |
|------|------|
| `src/main/video/providers/volcengine-video.js` | Seedance HTTP 客户端：createTask / pollTask / downloadVideo；`_deps.{fetch,sleep,now}` 可注入 |
| `src/main/video/video-generator.js` | 路由层：按 `provider` 字段分发，默认 volcengine；从 `llm-config` 懒加载 apiKey/baseURL/videoModel |
| `src/main/video/video-ipc.js` | 注册 `video:generate` IPC handler，透传进度事件到 `video:generate:progress` |
| `src/main/llm/llm-config.js` | `volcengine.videoModel: "doubao-seedance-1.0-lite"` 默认配置 |
| `src/preload/index.js` | 暴露 `api.video.generate(params)` + `api.video.onGenerateProgress(cb)` |

## Seedance 调用约定

**请求体结构**：

```jsonc
{
  "model": "doubao-seedance-1.0-lite",
  "content": [
    { "type": "text", "text": "mountain lake timelapse --ratio 16:9 --duration 5" },
    // 可选：首帧图驱动
    { "type": "image_url", "image_url": { "url": "https://..." }, "role": "first_frame" }
  ]
}
```

- `--ratio` / `--duration` / `--resolution` 通过 prompt 末尾的参数标记传给 Seedance
- 首帧图模式需将图片 URL 放在 `content[1]`，角色 `first_frame`

**轮询**：`pollIntervalMs=5000`，`pollTimeoutMs=600000`（10 分钟）。`status ∈ {queued, running, succeeded, failed}`。

**进度事件**：`task-created` → `status-update`（每次 poll）→ `downloading` → `complete`。

## 配置

用户在 AI 设置面板填写：

```json
{
  "volcengine": {
    "apiKey": "ak-...",
    "baseURL": "https://ark.cn-beijing.volces.com/api/v3",
    "videoModel": "doubao-seedance-1.0-lite"
  }
}
```

apiKey 缺失时，`video-generator.js` 抛 `Volcengine apiKey not configured — set it in AI settings`。

## 测试策略

遵循记忆条目 `feedback_video_api_testing.md`：**首次真实 API 验证通过后禁止再调真实接口**。

| 层 | 文件 | Tests | Mock 点 |
|----|------|-------|---------|
| Unit | `tests/unit/video/volcengine-video.test.js` | 9 | `provider._deps.fetch` |
| Integration | `tests/integration/video-generate-ipc.test.js` | 4 | `require.cache["electron"]` + `_deps.fetch` |
| Full-chain | `tests/integration/video-generate-full-chain.test.js` | 2 | 模拟 `ipcRenderer.invoke` + `webContents.send` 全链路 |

`_deps` 注入模式 + `require.cache` 打桩电子模块，详见 CLAUDE-patterns.md。

## 计费提示

Seedance 按输出时长计费（¥0.15–0.3/s）。代码中不加倍率，由用户在 AI 设置自行选择 `lite/pro` 模型。
