# AI 视频生成 (Volcengine Seedance)

## 概述

桌面端支持通过火山方舟 Seedance 文生视频能力，直接从提示词生成真实 AI 视频。集成基于 Volcengine 方舟平台（`ark.cn-beijing.volces.com`），支持文本驱动和首帧图驱动两种生成模式，覆盖 lite、pro、pixeldance 三档模型，并通过轮询 Task ID 机制实现异步进度跟踪，生成完成后自动下载落盘到本地指定路径。

---

## 核心特性

- 🎬 **文本生成视频** — 输入中英文提示词即可生成 4–10 秒短视频
- 🖼️ **首帧图驱动** — 传入 `imageUrl` 后以图片内容为起点做延伸生成
- 📡 **实时进度推送** — 渲染进程通过 IPC 事件订阅 `task-created / status-update / downloading / complete` 四阶段进度
- 🤖 **多模型支持** — `doubao-seedance-1.0-lite` / `doubao-seedance-1.5-pro` / `doubao-seedance-pixeldance`
- 📐 **灵活分辨率** — 支持 `480p / 720p / 1080p`，比例支持 `16:9 / 9:16 / 1:1`
- 💾 **自动落盘** — 生成完成后自动下载 MP4 到 `outputPath`，返回文件大小和 taskId
- 🔒 **内容安全** — 服务端内置 SensitiveContent 过滤，客户端捕获并提示友好错误
- 💡 **成本感知** — 按输出时长计费（¥0.15–0.3/s），文档和 mock 机制帮助避免意外扣费

---

## 系统架构

```
Renderer Process
      │
      │  window.api.video.generate(params)
      │  window.api.video.onGenerateProgress(cb)
      ▼
  Preload Bridge (IPC)
      │
      │  invoke("video:generate", params)
      │  on("video:generate-progress", cb)
      ▼
  Main Process — VolcengineVideoService
      │
      ├─ validateConfig()         ← 检查 apiKey / baseURL / videoModel
      ├─ createTask()             ← POST /v3/video/generations
      │      └─ returns taskId
      ├─ pollTask(taskId)         ← GET  /v3/video/generations/{taskId}
      │      └─ interval 5s, timeout 600s
      │      └─ emits progress events via ipcMain.emit
      └─ downloadVideo(url, outputPath)
             └─ streams MP4 to local disk

External
      └─ Volcengine Ark API
             https://ark.cn-beijing.volces.com/api/v3
```

---

## 配置参考

在「桌面端 → AI 设置 → 火山方舟」中填写以下字段，或在 `.chainlesschain/config.json` 中配置：

```js
// .chainlesschain/config.json (节选)
{
  "volcengine": {
    "apiKey": "your-ark-api-key",
    "baseURL": "https://ark.cn-beijing.volces.com/api/v3",
    "videoModel": "doubao-seedance-1.0-lite"
  }
}
```

**完整参数说明：**

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `apiKey` | `string` | — | 方舟控制台的 API Key（必填） |
| `baseURL` | `string` | `https://ark.cn-beijing.volces.com/api/v3` | 方舟 API 基础地址 |
| `videoModel` | `string` | `doubao-seedance-1.0-lite` | 默认视频模型 |

**生成请求参数：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `prompt` | `string` | 文本描述（必填） |
| `outputPath` | `string` | 本地落盘路径（必填） |
| `ratio` | `string` | 画面比例：`16:9` / `9:16` / `1:1` |
| `duration` | `number` | 视频秒数，Seedance 建议 4–10 |
| `resolution` | `string` | `480p` / `720p` / `1080p`（取决于模型） |
| `imageUrl` | `string` | 首帧图 URL，提供则按首帧驱动生成 |
| `model` | `string` | 覆盖默认 `videoModel` |
| `provider` | `string` | 预留，目前仅 `volcengine` |

---

## 性能指标

| 操作 | 目标 | 实际（lite 模型） | 状态 |
|------|------|------------------|------|
| createTask 接口响应 | < 3s | ~1.2s | ✅ |
| 5s 视频生成（lite） | < 90s | ~60–80s | ✅ |
| 5s 视频生成（pro） | < 180s | ~120–150s | ✅ |
| 进度事件推送间隔 | 5s | 5s（固定轮询） | ✅ |
| MP4 下载（720p / 5s） | < 10s | ~3–6s（网络依赖） | ✅ |
| 轮询超时上限 | 600s | 600s | ✅ |
| IPC 事件延迟（main→renderer） | < 50ms | < 10ms | ✅ |

> 实际耗时受方舟队列负载、网络带宽、提示词复杂度影响。高峰期可能增加 50–100%。

---

## 测试覆盖率

```
packages/cli/
  ✅ tests/unit/video/volcengine-video.test.js     — VolcengineVideoService 单元测试（含 mock API）

desktop-app-vue/
  ✅ tests/unit/video/volcengine-video-service.test.js   — main process service 单元测试
  ✅ tests/unit/video/video-ipc-handler.test.js          — IPC 处理器 + 事件推送测试
  ✅ tests/unit/video/video-progress-events.test.js      — 四阶段进度事件顺序验证
```

**测试策略：**
- 所有测试均使用 mock HTTP（`nock` / `vi.fn()`），**严禁**调用真实 Volcengine API（按秒计费）
- 覆盖正常生成流程、轮询重试、超时、401 / SensitiveContent 等错误路径
- 下载阶段通过 stream mock 验证文件落盘逻辑

---

## 安全考虑

### 1. API Key 保护
API Key 仅存储在主进程配置中，不随 IPC 消息传递到渲染进程。渲染进程只能通过预定义的 `window.api.video.generate()` 接口触发生成，无法直接读取 `apiKey`。

### 2. 内容安全过滤
Seedance 服务端内置内容安全策略（SensitiveContent）。客户端捕获到该错误后以友好提示返回给用户，不会崩溃或暴露内部错误栈。

### 3. 本地文件路径校验
`outputPath` 在主进程中进行基础路径合法性检查，防止路径穿越攻击（如 `../../../etc/passwd`）。

### 4. 计费风险控制
- 自动化脚本或测试代码应始终使用 mock，严禁循环调用真实 API
- 建议在方舟控制台为 API Key 设置月度消费上限
- CI 环境通过 `VOLCENGINE_API_KEY` 环境变量注入，本地开发通过 `.chainlesschain/config.json` 注入，两者均已加入 `.gitignore`

### 5. 网络传输安全
所有请求通过 HTTPS 发往 `ark.cn-beijing.volces.com`，视频文件下载同样走 HTTPS，无需额外配置 TLS。

---

## 故障排查

**Q: 报错 `Volcengine apiKey not configured`**

去「桌面端 → AI 设置 → 火山方舟」填写 `apiKey`，保存后重试。或直接编辑 `.chainlesschain/config.json`，添加 `"volcengine": { "apiKey": "..." }`。

---

**Q: 报错 `createTask 401: Unauthorized`**

API Key 无效或该 Key 未开通 Seedance 模型权限。在方舟控制台检查 Key 状态并确认已开通视频生成能力。

---

**Q: 报错 `task failed: SensitiveContent`**

提示词被服务端内容安全策略拦截。修改提示词，避免敏感词汇，改用客观描述性语言重试。

---

**Q: 报错 `poll timeout after 600000ms`**

方舟服务队列拥塞，任务超过 10 分钟未完成。建议：稍等片刻后重试；或切换到 `doubao-seedance-1.0-lite` 模型（生成更快）；高峰期（工作日白天）尽量避免生成长时长视频。

---

**Q: 视频文件已生成但无法播放**

检查 `outputPath` 所在磁盘是否有剩余空间（720p/5s 约 10–30 MB）；确认路径中无特殊字符；用系统默认播放器以外的播放器（如 VLC）验证文件完整性。

---

**Q: 进度事件停止推送但任务未完成**

渲染进程可能已销毁（页面切换/窗口关闭），导致 IPC 监听器失效。重新打开生成页面，任务仍在服务端运行，重新订阅后会继续收到事件。

---

## 关键文件

| 文件 | 说明 |
|------|------|
| `desktop-app-vue/src/main/video/volcengine-video-service.js` | 核心服务：createTask / pollTask / downloadVideo |
| `desktop-app-vue/src/main/video/video-ipc-handler.js` | IPC 通道注册，桥接 main ↔ renderer |
| `desktop-app-vue/src/renderer/composables/useVideoGenerate.ts` | 渲染进程 Composable，封装 generate + progress 订阅 |
| `desktop-app-vue/src/renderer/views/VideoGeneratePage.vue` | 视频生成 UI 页面 |
| `desktop-app-vue/src/main/config/unified-config-manager.js` | 统一配置读取（apiKey / baseURL / videoModel） |
| `desktop-app-vue/tests/unit/video/volcengine-video-service.test.js` | 主进程服务单元测试 |
| `packages/cli/tests/unit/video/volcengine-video.test.js` | CLI 侧视频测试（mock API） |
| `docs/design/modules/90_AI视频生成_Volcengine_Seedance.md` | 架构设计文档 |

---

## 使用示例

### 渲染进程调用（基础）

```js
// 订阅进度事件
const unsubscribe = window.api.video.onGenerateProgress((p) => {
  // p.stage ∈ task-created | status-update | downloading | complete
  console.log(p.stage, p);
});

// 触发生成
const result = await window.api.video.generate({
  prompt: "a mountain lake at sunrise, time lapse",
  outputPath: "D:/videos/demo.mp4",
  ratio: "16:9",        // 可选，默认 16:9
  duration: 5,           // 秒，可选，建议 4–10
  resolution: "720p",    // 可选，默认 720p
  imageUrl: undefined,   // 可选，提供则进入首帧图驱动模式
});

unsubscribe();
// result: { path, size, taskId, model }
```

### 首帧图驱动模式

```js
const result = await window.api.video.generate({
  prompt: "camera slowly pulls back to reveal the full scene",
  outputPath: "D:/videos/from-image.mp4",
  imageUrl: "https://example.com/starting-frame.jpg",
  duration: 6,
  resolution: "720p",
});
```

### CLI 侧调用（开发调试）

```bash
# 通过 cc video 命令触发生成（需配置 apiKey）
cc video edit --video raw.mp4 --audio bgm.mp3 --instruction "生成一段山湖日出延时摄影视频"

# 查看已缓存的视频资产
cc video assets list

# 清理 30 天前的旧缓存
cc video assets prune --older-than 30
```

### Vue 组件集成示例

```vue
<script setup>
import { ref } from 'vue'

const progress = ref(null)
const result = ref(null)

async function generate() {
  const unsub = window.api.video.onGenerateProgress((p) => {
    progress.value = p
  })

  try {
    result.value = await window.api.video.generate({
      prompt: '赛博朋克城市夜景，霓虹灯雨中反光',
      outputPath: 'D:/videos/cyberpunk.mp4',
      ratio: '16:9',
      duration: 5,
      resolution: '720p',
    })
  } finally {
    unsub()
  }
}
</script>

<template>
  <button @click="generate">生成视频</button>
  <div v-if="progress">阶段: {{ progress.stage }}</div>
  <div v-if="result">保存至: {{ result.path }}（{{ result.size }} bytes）</div>
</template>
```

---

## 相关文档

- [架构设计：AI 视频生成 Volcengine Seedance](../design/90_AI视频生成_Volcengine_Seedance.md)
- [LLM 类别路由（媒体扩展）](../patterns/llm-category-routing.md) — `asr` / `audio-analysis` / `video-vlm` 三个媒体类别
- [视频剪辑 Agent (CutClaw)](./video-editing-agent.md) — 完整剪辑管线：deconstruct → plan → assemble → render
- [AI 设置配置](./ai-settings.md) — 火山方舟 apiKey 配置入口
- [统一配置管理](./unified-config.md) — `.chainlesschain/config.json` 结构说明
- [CLI 视频命令参考](../../CLI_COMMANDS_REFERENCE.md#video-editing-agent-cutclaw-inspired) — `cc video` 命令完整列表
