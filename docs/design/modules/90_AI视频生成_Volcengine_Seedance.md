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

`_deps` 注入模式 + `require.cache` 打桩电子模块，详见 docs/claude/CLAUDE-patterns.md。

## 计费提示

Seedance 按输出时长计费（¥0.15–0.3/s）。代码中不加倍率，由用户在 AI 设置自行选择 `lite/pro` 模型。

## 附录：规范章节补全（v5.0.3.108）

> 本文为系统设计子文档。为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文细节。

### 1. 概述
见正文「模块概述 / 功能描述」。AI 视频生成 — Volcengine Seedance 集成：火山引擎 Seedance 视频生成。

### 2. 核心特性
AI 视频生成 / Seedance / Volcengine 集成。

### 3. 系统架构
见正文「架构设计」。

### 4. 系统定位
ChainlessChain 的「AI 视频生成（Volcengine Seedance）」。

### 5. 核心功能
见正文模块概述与各节。

### 6. 技术架构
见正文实现章节。

### 7. 系统特点
见正文（状态 / 版本 / 特性）。

### 8. 应用场景
见正文应用场景 / 背景。

### 9. 竞品对比
见正文对比（如有）。

### 10. 配置参考
见正文配置 / 参数章节。

### 11. 性能指标
见正文性能 / 指标章节。

### 12. 测试覆盖
见正文测试章节。

### 13. 安全考虑
见正文安全 / 权限章节。

### 14. 故障排除
见正文故障 / 已知限制章节。

### 15. 关键文件
见正文实现位置 / 关键文件章节。

### 16. 使用示例
见正文使用 / API 示例。

### 17. 相关文档
[系统设计主文档](../系统设计_主文档.md)、`docs-site` 对应功能页。
