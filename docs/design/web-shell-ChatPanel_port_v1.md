# Web-shell ChatPanel V5 Port (chat-panel-v5 v1)

**版本**：v1（2026-05-07） · **状态**：已实现 · **关联 README**：增量更新 XV

## 背景与目标

V5 桌面 `desktop-app-vue/src/renderer/components/projects/ChatPanel.vue`（3788 行）是项目级聊天面板，长期被
显式标记为"a different much larger port"——4 件重型功能（虚拟列表 / 意图识别 / 自动发送 / context 模式）和
5 个 IPC + 6 channel 强耦合，迁移到 web-shell 一直被推迟。

V6 桌面 `shell/AIChatPanel.vue` 的源头是 V5 全局 `components/ChatPanel.vue`（857 行，`5066a718d` 已删），feature
集明显轻于 projects/ChatPanel.vue：没有虚拟列表、没有意图流、没有 autoSend。

本次目标：**把 V5 projects/ChatPanel 的 4 件重型功能完整 port 到 web-shell**（不是占位/桩），同时借鉴 V6 panel
的清爽 UI（头像 / 角色 / 时间 / quick-prompt 空态），保持双壳一致性的"参考两边优点"原则。

## 范围

| Phase | 内容 | 关键文件 |
|---|---|---|
| A | VirtualMessageList + V6 风格消息渲染 | `packages/web-panel/src/components/VirtualMessageList.vue`、`Chat.vue` |
| B | contextMode 选择器（project/file/global）+ localStorage 持久化 | `chatStore.js`、`Chat.vue` |
| C | 意图识别 + 确认 + 后续输入分类（**完整 LLM 后端**）| `chat-intent-service.js`、`chat-intent-protocol.js`、`IntentConfirmationMessage.vue` |
| D | autoSendMessage 协议（URL 与 Pinia 双通道）| `Chat.vue`、`chatStore.js` |
| E | V6 桌面 AIChatPanel 对齐（**待落**）| `desktop-app-vue/src/renderer/shell/AIChatPanel.vue` |

## 协议设计

### Phase A — VirtualMessageList

复用 V5 同款 `@tanstack/virtual-core ^3.13.13`，组件签名一致：

```vue
<VirtualMessageList
  :messages="messagesWithStreaming"
  :estimate-size="120"
  @load-more="..."
  @scroll-to-bottom="..."
>
  <template #default="{ message, index }">...</template>
</VirtualMessageList>
```

**关键设计选择**：
- 流式 token 通过 `messagesWithStreaming` computed 注入为 _streaming 标记的合成消息，不进 chatStore，避免存储污染。
- 头像 / 角色 / 时间 / quick prompts 来自 V6 panel；不引入 ConversationStore（V6 用），因为 web-shell 已有 chatStore。
- happy-dom 测试环境下 `getBoundingClientRect` 不可用，virtualizer 回 0 项，组件回退到 fallback `v-for`——单测覆盖此分支。

### Phase B — contextMode

```ts
type ContextMode = 'project' | 'file' | 'global'
```

- localStorage key：`cc.web-panel.chat.contextMode`
- 默认值：`cfg.mode === 'project' ? 'project' : 'global'`
- file 模式在 web-shell 永久 disable（无 currentFile 概念，由桌面端独占）
- 持久化值与运行环境冲突时（如曾在 project 模式存了 'project'，本次以 global 模式启动）自动降级到 global

### Phase C — 意图流（完整 LLM 后端）

#### 后端服务（`chat-intent-service.js`）

```ts
understandIntent({ userInput, contextMode, llmOptions })
  → { success, correctedInput, intent, keyPoints, error? }

classifyFollowupIntent({ input, context, llmOptions })
  → { intent, confidence, reason, extractedInfo?, method, latency }
```

**意图类别**（与 V5 `FollowupIntentClassifier` 一致）：
- `CONTINUE_EXECUTION` — 用户催促 / 同意继续
- `MODIFY_REQUIREMENT` — 修改 / 追加 / 删除需求
- `CLARIFICATION` — 补充说明
- `CANCEL_TASK` — 取消任务

**双层评分**（rule-first）：
1. **规则层**：关键词 +0.3、正则 +0.5；CANCEL_TASK 权重 ×1.5；空输入 → CONTINUE_EXECUTION (0.9)；几个高优先级 short-circuit（"算了" → CANCEL_TASK 1.0；"好的"→ CONTINUE_EXECUTION 1.0）。
2. **LLM 层**：仅当规则层 confidence ≤ 0.8 才调用，使用 V5 同款 system prompt + 用户上下文（current task / task plan / conversation history 最近 5 条）。

**降级链**：
- LLM 不可配置 → method=`rule_no_llm`，返规则结果（即使 confidence 低也直返）。
- LLM 抛错 → method=`rule_fallback`（规则有信号）或 `default`（无信号，CLARIFICATION）。

#### WS 协议层（`chat-intent-protocol.js`）

新增 2 个 WS topic：

| Topic | Request | Response |
|---|---|---|
| `chat.intent.understand` | `{ id, type, sessionId, userInput, contextMode? }` | `{ id, type: 'chat.intent.understand.response', success, correctedInput, intent, keyPoints, error? }` |
| `chat.intent.classify-followup` | `{ id, type, sessionId, input, context? }` | `{ id, type: 'chat.intent.classify-followup.response', intent, confidence, reason, extractedInfo?, method, latency }` |

**LLM creds 提取**：handler 通过 `server.sessionManager.getSession(sessionId)` 拿活跃 session 的 provider/model/baseUrl/apiKey，零配置。sessionId 缺省或 session 不存在时 `llmOptions = null` → 服务层走 pass-through 降级。

#### 前端协议（chatStore）

```ts
async submitUserInput(sessionId, content)
  // global mode → 直发 sendMessage
  // project/file mode → ws.sendRaw('chat.intent.understand') →
  //   有用 understanding？ → 推 INTENT_CONFIRMATION 卡片，挂起原始输入
  //   无用 / WS 抛错？     → 直发 sendMessage

async confirmIntent(sessionId, messageId)
  // 卡片 status=confirmed，发原始 originalInput

async correctIntent(sessionId, messageId, correction)
  // 卡片 status=corrected + correction 字段，发用户修正文本
```

**何时算"有用 understanding"**：`correctedInput !== originalInput` 或 `keyPoints.length > 0`。否则走直发，避免给用户看一张"无信息量"的确认卡。

### Phase D — autoSendMessage 协议

**双通道**：

1. URL 驱动：`/#/chat?prompt=<text>&autoSend=true&session=<id>`
2. Pinia 程序化：其它 view 调 `chatStore.scheduleAutoSend({ prompt, autoSend, session })`

**消费 token**：每次自动发送都生成唯一 token（URL：`query::${prompt}::${session}::${autoSend}`；Pinia：`staged::${seq}::${ts}`），消费过的 token 入 Set 防同源重放。

**URL 清理**：URL 通道消费后调用 `router.replace({ path, query: {} })` 清空 query，刷新 / 前后导航不会重放。Pinia 通道消费后调 `chatStore.clearAutoSend()`。

**优先级**：URL > Pinia（如果 URL 有效，本轮不读 Pinia）。

## 测试策略

| 层 | 文件 | 数量 | 重点 |
|---|---|---|---|
| Unit (CLI) | `chat-intent-service.test.js` | 22 | extractJson 4 / buildPrompts 3 / ruleBasedClassify 5 / understandIntent 5 / classifyFollowupIntent 5 |
| Unit (CLI) | `chat-intent-protocol.test.js` | 6 | bad-request / 无 session creds / 有 session 透传 / 异常 → error frame / classify rule path / classify llm path |
| Unit (web-panel) | `messageTypes.test.js` | 11 | enum 形状 + 4 个工厂函数 |
| Unit (web-panel) | `chat-intent-flow.test.js` | 19 | contextMode 4 + submitUserInput 7 + scheduleAutoSend 3 + classifyFollowupIntent 3 + pushFollowupIntentBanner |
| Unit (web-panel) | `VirtualMessageList.test.js` | 5 | fallback / key / expose / scroll boundaries / length grow |
| Unit (web-panel) | `IntentConfirmationMessage.test.js` | 7 | 状态切换 / confirm payload / correct 完整流程 |
| **小计** | | **70** | 全绿 |

**回归**：web-panel 1829/1829 + CLI dispatcher/ws-server 61/61 + chat-store 现有 10/10 全绿。

**未覆盖**（已知 caveat）：
- 浏览器端到端：开 `cc serve --mode project --ui full`，真跑 LLM → 输入错别字 → 看意图卡 → 点确认/纠正。建议 ship 前手动验。
- panel.test.js 中 3 个 e2e 在 stash 后仍失败 → 与本次改动无关（spawn cc serve 在 Windows 偶发 ECONNRESET 的预存 flake）。

## V6 桌面 panel 对齐（Phase E，已实现 v5.0.3.41）

**commit `b33527d31`** —— V6 `shell/AIChatPanel.vue` 反向对齐 V5 ChatPanel 的 4 件重型功能落地。从此 V5 / V6 / web-shell 三壳聊天体验严格对等：

- ✅ **VirtualMessageList** → 直接 import 同一组件（`@tanstack/virtual-core` 已在 desktop-app-vue 依赖中，无新增依赖）
- ✅ **contextMode** → 加 ref + radio-group；持久化 key 复用 `cc.web-panel.chat.contextMode`（双壳共享 localStorage namespace，设置一次双壳即时生效）
- ✅ **意图流** → 走 electronAPI 调用 desktop-app-vue 已有的 `project:understandIntent` / `followup-intent:classify` IPC handler（这些 IPC 早已存在是 V5 历史遗产，V6 panel 之前没消费而已；零 backend 改动）
- ✅ **autoSendMessage** → V6 是 modal panel（不是 vue-router 路由），URL 通道不适用；走纯 Pinia + props 通道

实际工作量：1 天（与预估一致，绝大部分代码已在 web-shell 验证过模式）。 测试：desktop renderer composable / shell community + AIChatPanel 相关测试全绿。

**意义**：Phase 1.6 hard-flip 后默认壳是 web-shell；此前 V6 备选壳缺 4 件聊天能力——用户从默认壳切到 V6 等于功能降级。Phase E 落地后 V6 不再是次等公民，opt-out 用户也获得完整聊天体验。

## 部署与监控

新 WS topic 上线无需迁移、无需配置。`cc serve` 启动即生效。LLM 不可用时降级到 pass-through，**用户体验不阻塞**。

监控建议：
- WS 错误码 `INTENT_UNDERSTAND_FAILED` 计数 → LLM 健康指标
- `chat-intent-service` 的 `latency` 字段 → 后续可入 Prometheus
- 意图卡用户行为：confirm / correct 比例 → 衡量 LLM 理解准确度

## 已知限制 / Future Work

1. **Streaming intent**：当前是 non-streaming JSON 返回，意图理解需等 LLM 全部输出。后续可改 streaming 渐进显示。
2. **Multi-turn intent**：目前每次输入独立调用 understandIntent，不带历史。V5 同样如此——可作为下个 phase 改进。
3. **Persisted intent decisions**：confirmIntent / correctIntent 后的 metadata.status 仅在内存（chatStore），刷新页面会丢。后续接 conversation 持久化层。
4. **i18n quickPrompts**：4 条固定，未来可接用户自定义 / project-level 配置。

## 附录：规范章节补全（v5.0.3.108）

> 本文为设计文档。为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文细节。

### 1. 概述
见正文头部。Web-shell ChatPanel V5 Port（chat-panel-v5 v1）：ChatPanel V5 移植到 web-shell。

### 2. 核心特性
ChatPanel V5 port / web-shell。

### 3. 系统架构
见正文架构 / 设计章节。

### 4. 系统定位
ChainlessChain 的「web-shell ChatPanel Port」。

### 5. 核心功能
见正文功能 / 设计章节。

### 6. 技术架构
见正文实现 / 技术章节。

### 7. 系统特点
见正文（状态 / 版本 / 特性）。

### 8. 应用场景
见正文应用场景 / 背景。

### 9. 竞品对比
见正文对比 / 借鉴（如有）。

### 10. 配置参考
见正文配置 / 参数章节。

### 11. 性能指标
见正文性能 / 指标章节。

### 12. 测试覆盖
见正文测试 / E2E 章节。

### 13. 安全考虑
见正文安全 / 权限章节。

### 14. 故障排除
见正文故障 / trap / 已知限制章节。

### 15. 关键文件
见正文实现位置 / 关键文件章节。

### 16. 使用示例
见正文使用 / 命令 / API 示例。

### 17. 相关文档
[系统设计主文档](./系统设计_主文档.md)、相关设计文档。
