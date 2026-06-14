# iOS Phase 5 — AI Chat Skill (Remote LLM 对话 + 流式响应 + 对话管理)

> **状态**：Phase 5.1-5.6 落地（2026-05-16）+ Phase 5.7 收口（2026-05-18：4 真实 bug 静态审计找到并修，单测从 41 → **45**，新增集成测试 4 条覆盖 fan-out / cancel 顺序 / offline drain / 多对话 stream 隔离）。真机 E2E（Phase 5.8）待 Mac+iPhone+真桌面。本 Phase 不创建新框架，**接通 Phase 3 RemoteCommandClient + Phase 4 events fan-out 模式（fan-out 加第 3 子流 buffer 512）+ 既有 iOS LLM 模型协议**。memory `ios_remote_ai_chat_phase5.md` 6 实施 trap。
>
> **依赖**：iOS Phase 3.1-3.6 已落 (`759a1e907`) — RemoteCommandClient framework 全套；Phase 4.1-4.6 已落 (`45b485fdd` → `5877b5d84`) — events fan-out task + Notification skill 落地范式可复用；iOS app target 既有 chat UI 组件 (AudioEngine 等) 可参考 SwiftUI bubble 风格
>
> **对齐版本**：Android `AICommands.kt` (1501 LOC, 53 method) — Phase 5 v0.1 选其中 chat-related **8 method subset**；其余 45 method (controlAgent / RAG / generateImage / embedding / model 管理等) 留 Phase 6+ 按需 unlock
>
> **关联文档**：`iOS_Phase_4_Notification_Skill.md`（events fan-out + dispatcher 模式参考）、`iOS_Phase_3_Remote_Operate_Framework.md`（framework）；memory `ios_remote_notification_phase4.md`（Phase 4 8 trap 复用）

---

## 1. 背景

### 1.1 Phase 5 = 第一个 streaming-heavy + 对话状态机的 skill

Phase 1-4 的所有 skill 都是 **request/response 一次性** + Notification 是 fire-and-forget event push。Phase 5 加入两个新维度：

- **流式响应**（server-push event chain）— LLM 输出长 token by token，需要边接收边渲染（用户体验关键）；与 Phase 4 单次 push event 不同的是 N-chunk + 完整状态机 (start → delta × N → end / error / cancel)
- **对话状态机** — 多轮对话上下文（conversationId）+ 历史消息列表 + 重命名/删除/归档操作；不是单次 ask-then-forget

iOS Phase 5 把 "iPhone 直接 ask 桌面 LLM" 从地铁里指挥的低频场景升级为高频日常工作流。

### 1.2 iOS 已就位 vs 需新建

✅ **已就位**：
- `RemoteCommandClient.invoke(method:, params:)` — Phase 3 通用 RPC actor
- `RemoteCommandClient.events: AsyncStream<String>` + Phase 4.4 落地的 RemoteDeps fan-out task — 复用直接加 `aiChatEventsStream` 第 3 子流
- `OfflineCommandQueue` — DC 不通时 mutating 调用 (createConversation/deleteConversation/renameConversation) 入队 + drainer 自动恢复
- `RemoteOperateView` horizontal scroll picker — Phase 4.5 已扩展, 加第 7 tab "AI" 一行 enum case
- `LRUSet` (Phase 2) — chat stream chunk dedup 复用

❌ **缺**：
- `AIChatCommands` actor — 8 method typed wrapper (chat / chatStream / getStreamChunk / cancelStream / getConversations / getConversation / createConversation / deleteConversation / getMessages 选 8) + Codable 模型
- `AIChatEventDispatcher` @MainActor class — 订 commandClient.events + filter `ai.chat.delta` / `ai.chat.end` / `ai.chat.error` + 累积 stream chunks → @Published streamingMessage + 对每个 streamId 独立 buffer
- `RemoteAIChatViewModel` — conversations list + 当前对话 messages + send + stream lifecycle + cancel + offline gate (mutating 调用)
- `AIChatView` UI + `ConversationListView` sidebar/sheet — 镜像 Android `AIChatScreen.kt` (chat bubbles + stream indicator + send box)
- `RemoteOperateView` 第 7 tab "AI" wire-up + SkillTab enum 加 `.aiChat` case
- `RemoteDependencies` 加 `aiChat: AIChatCommands` + `aiChatDispatcher: AIChatEventDispatcher` + fan-out task 多 yield 第 3 子流

## 2. 目标 & 非目标

### 2.1 目标 (Phase 5 in scope)

| # | 项 | 验收 |
|---|---|---|
| G1 | `AIChatCommands` 8 method 全 wire | 单测 ≥ 8 (每 method 1 happy + 1 错误)，envelope shape match Android |
| G2 | `ai.chat.delta` push event 累积渲染 stream message | 单测：mock events 喂 5 chunks → ViewModel 累积值正确；真机：发问 → iPhone 边输出边显 token |
| G3 | 对话列表显示 + tap 进对话 | 单测：mock getConversations → list 渲染；真机：进 AI tab 看到桌面端历史对话 |
| G4 | 当前对话 messages 拉 + 渲染 | 单测：mock getMessages → bubble 列表 |
| G5 | 用户输入 + send → stream 实时渲染 | 真机：iPhone 输入问题 → DC 发 chatStream → 桌面 LLM 流出 → iPhone 边接边渲 |
| G6 | cancel 中途取消 stream | 真机：发问 → 流式中点 stop → 桌面 LLM 中断 + iPhone UI 收尾 |
| G7 | 创建/删除对话双向同步 | 真机：iPhone 新建对话 → 桌面端列表出现；iPhone 删除 → 桌面消失 |
| G8 | RemoteOperateView 第 7 tab "AI" 接通 + horizontal scroll picker 视觉无 regression | UI 验证：6 → 7 tab 横向滚动顺滑 + AI 入口 icon `brain.head.profile` |

### 2.2 非目标 (defer 到 Phase 6+)

- **Agent 控制** (controlAgent / listAgents) — 留 Phase 6
- **RAG knowledge base operations** (ragSearch / ragAddDocument / ragListCollections 等 8 method) — 留 Phase 7+ 单独 Knowledge skill
- **多模态生成** (generateImage / imageVariation / generateEmbedding) — 留 Phase 8+
- **Embedding / similarity** API — 留 Phase 8+
- **模型管理** (getModels select active model) — Phase 5 v0.1 用桌面端默认 model；v0.2 加 model picker
- **regenerate / edit message** — Phase 5 v0.1 不实现重新生成；v0.2 加
- **archive / export 对话** — v0.2
- **RAG 自动注入对话上下文** — 桌面端 chat 自带 RAG (chat method 内部 RAG)，iOS 端透明继承；iOS 不主动调 RAG
- **多设备同时编辑同一对话冲突解决** — v0.2 (与桌面端同步通常通过 conversation 操作的 single-writer 假设解决)
- **stream chunk 持久化到本地（断网恢复 stream）** — v0.2；v0.1 stream 断 = stream 失效，重 chat 触发新 stream
- **system prompt / temperature 用户可调** — v0.1 用桌面 conversation default；v0.2 加 chat settings sheet

## 3. Open Questions

### OQ-1：AIChatView 入口位置

**A**：RemoteOperateView 加第 7 segmented tab "AI"（与现有 6 tab 同位，一致 UX；Phase 4.5 horizontal picker 天然支持扩 N tab）
**B**：单独 NavigationLink 入口在 PairedDevicesListView 旁，"已配对桌面" + "AI 对话" 两 row
**C**：替代 iOS app 既有 chat UI 入口，远程 chat 当作 default chat（含 P2P fallback）

**推荐 A**。理由：(1) Phase 4.5 已把 picker 改为 horizontal scroll + button row，第 7 tab 视觉 0 改造；(2) 用户思维模型 "AI 对话是远程操控的一种" 与现有 6 tab 同层；(3) 替代既有 iOS chat UI (C 选项) 引入太多迁移工作 (既有 chat 走 P2P/Signal Protocol，远程 chat 走 RemoteCommandClient，两者 wire 协议不同)；(4) 单独入口 (B) 视觉上把 AI 跟其它远程操控 skill 割裂，降低发现率。

### OQ-2：流式响应实现 — server-push event vs polling getStreamChunk vs 双轨

**A**：纯 server-push event — 桌面端 `chatStream` 调用启动后 push `ai.chat.delta` 系列 event 到 iOS；iOS dispatcher 订阅 + 累积；不调 getStreamChunk
**B**：纯 polling — iOS 调 chatStream 拿 streamId，定时 (200ms 间隔) 调 getStreamChunk 拉 buffered chunks 直到 isComplete=true；不订阅 event
**C**：双轨 — 优先 server-push event，3 秒无 chunk fallback polling getStreamChunk 兜底（DC 抖动场景）

**推荐 A**。理由：(1) Phase 4 events fan-out 已就位，加第 3 子流 zero 架构成本 (2) server-push 比 polling 延迟低 (LLM 输出 token 间隔通常 50-200ms, polling 200ms 浪费一半 token 体验) (3) DC 失败时 RemoteCommandClient 已自动 fallback signaling，event 走 signaling 转发不丢 (4) C 双轨复杂度高 (chunk 去重 + 同 streamId 两 source 合并状态机)，Phase 5 v0.1 不引入；getStreamChunk method 仍 wire 进 AIChatCommands 给 v0.2 polling fallback 留接口。

### OQ-3：对话历史持久化策略

**A**：iOS 端 UserDefaults 全持久化（与 Phase 3 OfflineCommandQueue 同模式）
**B**：iOS 端不持久化，进 AI tab 时拉桌面 getConversations + getMessages；离开释放（桌面是 source of truth）
**C**：iOS UserDefaults 仅缓存最新 5 个对话 + 桌面 SoT；进 tab 显缓存 + 后台 refresh

**推荐 B**。理由：(1) 与 Phase 4 OQ-2 一致 (lean, 桌面 source of truth, 不冗余持久化) (2) AI 对话数据敏感（含用户 prompts），iOS 本地缓存增加泄漏面 (3) 进 tab 拉一次 round-trip 是可接受 latency (~300ms LAN, ~600ms TURN)；可加 skeleton loader 缓和 (4) v0.2 性能监控暴露 latency 真痛后再升 C (UserDefaults 缓存 5 个 + 后台 refresh)。

### OQ-4：与既有 iOS app chat UI 关系

**A**：完全独立 — 既有 iOS chat (P2P/Signal Protocol 走 friend chat) 与远程 AI chat 两路 view + 两套 model；用户进哪个 tab 就用哪个
**B**：UI 共用、底层切换 — 一份 ChatView，根据当前 tab 决定 view model 用哪个 backend (P2P friend chat ViewModel vs Remote AI chat ViewModel)
**C**：远程 AI chat 替代既有 iOS chat 入口，仅保留 friend chat 走旧路径

**推荐 A**。理由：(1) 既有 iOS chat 已稳定 + 走 Signal Protocol e2ee + tightly-coupled 到 friends list (2) 远程 AI chat 是 "iPhone ↔ 桌面 LLM" 单 peer 性质，无 friends 概念；强行 UI 共用导致 ViewModel diff 大 (3) Phase 5 v0.1 lean，用户从 RemoteOperateView 第 7 tab 进的 AI chat 与从 friends 进的 chat 视觉略相似但功能集不同（无好友选 + 无群组等），mental model 清晰 (4) Phase 6+ 若桌面端把 friend chat 也 expose 成 ai.chat.* method，再考虑 B/C 收口。

### OQ-5：v0.1 仅文本对话 vs 立即上多模态/工具

**A**：v0.1 仅纯文本（chat method message + response 都 string）；附件 / 图片 / 文件 留 v0.2
**B**：v0.1 含图片附件（iPhone 拍照 / 选图 → upload to chat）
**C**：v0.1 含工具调用 (ai.tool.call event 显示 LLM 调用了什么 tool)

**推荐 A**。理由：(1) v0.1 lean (2) 桌面端 chat 已支持 attachment + tool call 但 wire 协议尚未稳定 (Android v0.1 也仅文本)；iOS 跟着 Android 步调走 (3) 多模态 v0.2 加 NotificationsView Sheet 同模式 (sheet 选图 + base64 / 文件) (4) 工具调用显示 v0.2 加 ai.tool.call event 路由到 ChatView 加 system message。

## 4. 架构

### 4.1 Module / 文件 placement

```
ios-app/
├── Modules/CoreP2P/Sources/RemoteSkills/
│   └── AIChat/                                    # NEW
│       ├── AIChatModels.swift                     # Codable: ChatMessage / ChatResponse / ConversationsResponse / StreamStartResponse / StreamChunkResponse / 其它
│       ├── AIChatCommands.swift                   # actor, 8 method wrapper → commandClient.invoke
│       └── AIChatEventDispatcher.swift            # subscribe commandClient.events + filter ai.chat.delta/end/error + LRU dedup + 按 streamId 累积 buffer
├── Modules/CoreP2P/Sources/RemoteSkills/ViewModels/
│   └── RemoteAIChatViewModel.swift                # NEW @MainActor
└── ChainlessChain/Features/RemoteOperate/Views/
    ├── RemoteOperateView.swift                    # MODIFIED: 加第 7 tab .aiChat + body switch
    ├── SkillTabPickerView.swift                   # NO CHANGE (horizontal scroll 自动支持新 tab)
    ├── AIChatView.swift                           # NEW (含 chat bubbles + send box + stream indicator)
    └── ConversationListView.swift                 # NEW (sidebar / sheet 列对话历史)
```

**复用既有**：
- `Modules/CoreP2P/Sources/RemoteTerminal/RemoteCommandClient.swift` — invoke 池 (Phase 3)
- `Modules/CoreP2P/Sources/RemoteTerminal/LRUSet.swift` — chunk dedup by (streamId, chunkIdx)
- Phase 4 events fan-out task in RemoteDependencies — 加第 3 子流 (aiChatEventsStream)

### 4.2 数据流

#### 4.2.1 iOS → 桌面 (request/response，8 method)

与 Phase 4 同模式：
```
AIChatView (UI tap "send")
  → RemoteAIChatViewModel.sendMessage(...)
    → AIChatCommands.chatStream(message:, conversationId:, ...)
      → commandClient.invoke("ai.chatStream", params)
        → DC fast path or signaling fallback
          → 桌面 ChatHandler 启 stream + 返 streamId
        ← .success({ streamId: "abc" })
      ← Decoded StreamStartResponse
    ← VM.currentStreamId = "abc"; UI 显 typing indicator
```

#### 4.2.2 桌面 → iOS (server-push stream chunks)

```
桌面 LLM 输出 token → ChatHandler 累积 chunk → 经 DC 或 signaling-relay 发:
  {type:"chainlesschain:event", payload:{event:"ai.chat.delta", streamId, content, chunkIdx, ...}}
  → iOS RemoteWebRTCClient.inboundMessages
    → RemoteCommandClient.handleInbound → events stream yield
      → RemoteDeps fan-out task → aiChatEventsStream yield
        → AIChatEventDispatcher subscribed task
          → parse envelope, filter event in {ai.chat.delta, ai.chat.end, ai.chat.error}
            → LRU dedup by (streamId, chunkIdx)
              → ai.chat.delta: 累积 streamBuffers[streamId] += content; @Published streamingMessages 通知
              → ai.chat.end: streamBuffers[streamId].isComplete = true; trigger VM finalize 写入 messages list
              → ai.chat.error: streamBuffers[streamId].error = msg; VM 显 error
```

### 4.3 DI wiring (RemoteDependencies)

```swift
// Phase 5.6 新增 (与 Phase 4 同模式)
public let aiChat: AIChatCommands
public let aiChatDispatcher: AIChatEventDispatcher

// fan-out task 加第 3 子流
var chatLocal: AsyncStream<String>.Continuation!
let aiChatEventsStream = AsyncStream<String>(bufferingPolicy: .bufferingNewest(512)) { c in chatLocal = c }
let aiChatEventsContinuation = chatLocal!

self.aiChat = AIChatCommands(client: cmdClient)
self.aiChatDispatcher = AIChatEventDispatcher(eventStream: aiChatEventsStream)

// fan-out task 多 yield 一行
self.eventFanOutTask = Task {
    for await raw in cmdClient.events {
        terminalEventsContinuation.yield(raw)
        notificationEventsContinuation.yield(raw)
        aiChatEventsContinuation.yield(raw)  // NEW
    }
}

Task {
    await cmdClient.start()
    await self.terminalRpc.start()
    self.offlineDrainer.start()
    _ = await self.skillRegistry.initialize()
    await MainActor.run {
        notificationDispatcher.attach(pushTarget: PushNotificationManager.shared)
        notificationDispatcher.start()
        aiChatDispatcher.start()  // NEW
    }
}
```

注意 `bufferingNewest(512)` 比 Phase 4 的 256 大 — chat stream 可能短时间内涌 N chunks，更大 buffer 减少丢 chunk 概率 (LRU 在 dispatcher 兜底重复)。

### 4.4 Wire 协议（与 Android 完全一致）

| Method / Event | 方向 | 关键 params/payload |
|----------------|------|---------------------|
| `ai.chat` (request) | iOS→桌面 | `{message, conversationId?, model?, systemPrompt?, temperature?}` → `{response, conversationId, messageId}` |
| `ai.chatStream` (request) | iOS→桌面 | 同 ai.chat → `{streamId}` |
| `ai.chat.delta` (event push) | 桌面→iOS | `{streamId, content, chunkIdx, totalChunks?}` |
| `ai.chat.end` (event push) | 桌面→iOS | `{streamId, finishReason: "stop"\|"length"\|"cancelled", finalText, messageId}` |
| `ai.chat.error` (event push) | 桌面→iOS | `{streamId, error: string}` |
| `ai.cancelStream` | iOS→桌面 | `{streamId}` → `{cancelled: bool}` |
| `ai.getStreamChunk` (polling fallback) | iOS→桌面 | `{streamId, sinceChunk}` → `{chunks[], isComplete}` |
| `ai.getConversations` | iOS→桌面 | `{limit, offset, keyword?}` → `{conversations[], total}` |
| `ai.getConversation` | iOS→桌面 | `{conversationId}` → `{conversation}` |
| `ai.getMessages` | iOS→桌面 | `{conversationId, limit, offset}` → `{messages[]}` |
| `ai.createConversation` | iOS→桌面 | `{title?, model?, systemPrompt?}` → `{conversationId, conversation}` |
| `ai.deleteConversation` | iOS→桌面 | `{conversationId}` → `{success}` |

## 5. 数据模型

```swift
public struct ChatMessage: Codable, Sendable, Identifiable, Equatable {
    public let id: String
    public let role: ChatRole              // user / assistant / system
    public let content: String
    public let createdAt: Int64           // ms epoch
    public let modelUsed: String?         // e.g. "gpt-4" / "claude-3-opus"
    public let isStreaming: Bool          // dispatcher 累积时 true，end 时 false (终态)
}

public enum ChatRole: String, Codable, Sendable {
    case user, assistant, system
}

public struct Conversation: Codable, Sendable, Identifiable, Equatable {
    public let id: String
    public let title: String              // 桌面端可能用 first message 自动生成
    public let model: String?
    public let messageCount: Int
    public let lastMessageAt: Int64?
    public let createdAt: Int64
    public let archived: Bool             // v0.1 不操作仅显示
}

public struct ConversationsResponse: Sendable {
    public let success: Bool
    public let conversations: [Conversation]
    public let total: Int
}

public struct ChatResponse: Sendable {
    public let success: Bool
    public let response: String           // assistant 完整响应（非 stream 路径）
    public let conversationId: String
    public let messageId: String
    public let modelUsed: String?
}

public struct StreamStartResponse: Sendable {
    public let success: Bool
    public let streamId: String           // 后续 dispatcher 按 streamId 累积 chunks
    public let conversationId: String
}

public struct ChatStreamDelta: Sendable, Equatable {
    public let streamId: String
    public let content: String            // 增量 token (本 chunk 新加的内容)
    public let chunkIdx: Int
    public let totalChunks: Int?          // 桌面知道总数时填，未知 nil

    public static func parseFromEnvelope(_ raw: String) -> ChatStreamDelta?  // 类似 Phase 4 NotificationReceivedEvent
}

public struct ChatStreamEnd: Sendable, Equatable {
    public let streamId: String
    public let finishReason: String       // "stop" / "length" / "cancelled" / "error"
    public let finalText: String          // 完整累积文本（dispatcher 可校验 vs 自己累积）
    public let messageId: String

    public static func parseFromEnvelope(_ raw: String) -> ChatStreamEnd?
}
```

## 6. Sub-phase 分解

### 6.1 Phase 5.1 — Models + AIChatCommands actor

**Scope** (~250 LOC + ~200 LOC):
- `AIChatModels.swift` — 全套 Codable struct/enum (ChatMessage / ChatRole / Conversation / 6 Response / 3 Event types) + `ChatStreamDelta.parseFromEnvelope` / `ChatStreamEnd.parseFromEnvelope` / `ChatStreamError.parseFromEnvelope`
- `AIChatCommands.swift` actor — 8 method wrapper

**单测 target**：≥ 12 (8 method × 1 happy + 4 error path + 4 envelope parse for Phase 5.2 prep)

**验收**：`swift test --filter AIChatCommandsTests` 全过；envelope shape match Android `AICommandsTest.kt`。

### 6.2 Phase 5.2 — AIChatEventDispatcher (stream 累积核心)

**Scope** (~250 LOC):
- `AIChatEventDispatcher.swift` @MainActor class
  - inject eventStream (RemoteDeps 第 3 子流)
  - 内部 `streamBuffers: [String: StreamBuffer]` (StreamBuffer = {accumulatedText: String, lastChunkIdx: Int, isComplete: Bool, error: String?})
  - 订阅 events stream + parse envelope + filter `ai.chat.delta` / `ai.chat.end` / `ai.chat.error`
  - LRU dedup by `(streamId, chunkIdx)` (256-LRU)
  - `@Published streamingMessages: [String: String]` (streamId → 累积文本) — VM 直接订
  - `@Published completedStreams: [String: ChatStreamEnd]` — end event 时 publish，VM 监听后 finalize
  - `@Published streamErrors: [String: String]` — error event
  - `discardStream(streamId:)` — 流被取消 / 完成后 cleanup buffer

**单测 target**：≥ 10
- 单 stream 多 chunks 累积验
- 多 stream 并发 (2+ concurrent stream) 各自 buffer 隔离
- LRU dedup 重复 chunkIdx silent drop
- 非 ai.chat.* event silent drop (无 notification.received 干扰)
- malformed envelope silent drop
- end event → @Published completedStreams 触发 + isComplete=true
- error event → @Published streamErrors 触发
- discardStream 清 buffer
- start/stop idempotent
- @Published streamingMessages Combine emit

### 6.3 Phase 5.3 — RemoteAIChatViewModel

**Scope** (~350 LOC):
- @MainActor ObservableObject
- @Published `conversations: [Conversation]` / `currentConversation: Conversation?` / `messages: [ChatMessage]` / `isStreamingMessage: Bool` / `currentStreamId: String?` / `isLoading: Bool` / `lastError: String?` / `inputDraft: String`
- 订阅 dispatcher `$streamingMessages` filter currentStreamId → 增量更新 messages 末条
- 订阅 dispatcher `$completedStreams` filter currentStreamId → finalize message + currentStreamId = nil
- 订阅 dispatcher `$streamErrors` filter currentStreamId → lastError + currentStreamId = nil
- methods: `loadConversations()` / `selectConversation(id:)` / `loadMessages()` / `sendMessage()` / `cancelCurrentStream()` / `createConversation()` / `deleteConversation(id:)` / `clearError()`
- offline gate (per Phase 4.3 三分支模式) — DC 不通时 createConversation/deleteConversation 入队 OfflineQueue；chatStream 不能 enqueue (服务端无法异步开始 stream)，DC 不通时报 lastError "需在线发起对话"

**单测 target**：≥ 12
- loadConversations happy path
- selectConversation → loadMessages 触发
- sendMessage happy path → chatStream 调 + currentStreamId 设 + 等 stream
- sendMessage 期间 dispatcher 喂 chunks → messages 末条 content 累积
- end event → message finalized + isStreamingMessage=false
- error event → lastError + currentStreamId=nil
- cancelCurrentStream → cancelStream 调 + dispatcher.discardStream + UI 收尾
- createConversation success
- deleteConversation success → conversations list remove
- DC 不通 chatStream → lastError "需在线"
- DC 不通 createConversation → enqueue OfflineQueue
- isLoading 状态机

### 6.4 Phase 5.4 — AIChatView UI + ConversationListView

**Scope** (~600 LOC 总):
- `AIChatView.swift` (~400 LOC):
  - 顶部 toolbar: 当前 conversation 标题 + Menu (新对话 / 历史对话列表 / 删除当前 / 复制全文)
  - 中部 ScrollView ScrollViewReader of message bubbles (user 右 蓝 / assistant 左 灰 / system 中)
  - bubble 内容: text + 时间戳 + (若 isStreaming) blinking cursor
  - 底部 send box: TextField + send button + (if streaming) cancel button
  - error banner (顶部, 同 Phase 4 NotificationsView pattern)
  - sheet for ConversationListView
  - .task → loadConversations + loadMessages (current conversation)
- `ConversationListView.swift` (~200 LOC):
  - List(.insetGrouped) of Conversation rows (title + last message preview + 时间 + message count)
  - swipe trailing: delete
  - tap → selectConversation + dismiss sheet
  - "+ 新对话" toolbar button → showCreateSheet
  - 空状态: "暂无对话 — 桌面端创建或从下方 ＋ 开始"

**镜像 Android**: Android 没有专门的 RemoteAIChatScreen (调用方都在 web-shell V6)；iOS Phase 5 直接定 SwiftUI 风格，参考 ChatGPT/Claude iOS app (大量公开界面)。

**HIG 偏离白名单**: 同 Phase 4 (Compose Sheet → SwiftUI .sheet, etc)；新加 chat bubble 自定义 ChatBubble subview。

**单测 target**：≥ 5 (UI smoke 同 Phase 3+4 模式仅 ship 不写 view test;VM 12 测试已覆盖核心状态)

### 6.5 Phase 5.5 — RemoteOperateView 第 7 tab "AI"

**Scope** (~30 LOC modify):
- `RemoteOperateView.swift` SkillTab enum 加 `.aiChat` (label "AI" / icon "brain.head.profile") + body switch case
- `SkillTabPickerView.swift` **零改动** — Phase 4.5 horizontal scroll 已支持任意 N tab
- `.onChange(of: selectedTab)` 加 .aiChat 进入时不需特殊 reset (没有 unreadCount 概念)

**单测 target**：≥ 0 (UI smoke)

### 6.6 Phase 5.6 — DI wiring + memory + status banner + commit

**Scope**：
- `RemoteDependencies.swift` modify — wire AIChatCommands + Dispatcher + fan-out task 加第 3 子流 (~30 LOC)
- memory `~/.claude/.../memory/ios_remote_ai_chat_phase5.md` — 4-5 forward-looking trap
- design doc Status banner 改 "Phase 5.1-5.5 落地（Phase 5.6 commit 标记）"
- CLAUDE.local.md Recently Completed 加 Phase 5 entry
- commit `feat(mobile): iOS Phase 5 — AI Chat skill (8 method + stream dispatcher + 7th tab)`

## 7. 实施 Traps（forward-looking）

### 7.1 stream chunk 排序 + 缺失 chunk 处理

**Why**: server-push event 通过 DC + signaling 双发兜底, chunk 可能乱序到达 (DC chunk #5 比 signaling chunk #4 先到); LRU dedup 防重复但不处理顺序。

**Risk**: dispatcher 累积出来的 streamingMessage 文字乱跳 ("Hello" → "Hello world" → "Hello there world" 错位)。

**Fix**: dispatcher StreamBuffer 内维护 `pendingChunks: [Int: String]` 按 chunkIdx 缓存; 每收一 chunk 检查 lastChunkIdx + 1 是否在 pending → 推入 accumulatedText; 否则等待。30s timeout 兜底（无新 chunk 就 fail）。

### 7.2 LRU dedup key 跨 stream 干扰

**Why**: Phase 4 LRUSet by 单 key (notificationId)；Phase 5 chunk 唯一 key 是 (streamId, chunkIdx) 复合。直接用 String key `"\(streamId)|\(chunkIdx)"` 防干扰。

**Risk**: 不复合 key 的话两个 stream 同 chunkIdx 0 互相误删。

**Fix**: dispatcher 内 LRUSet<String> + key compose helper `chunkKey(streamId:, chunkIdx:) -> "\(streamId)|\(chunkIdx)"`; capacity 增到 1024 (单 stream 通常 <500 chunks, 双 stream <1000 + dedup window 不需太长)。

### 7.3 cancelStream 后 dispatcher 的清理时机

**Why**: 用户点 cancel → VM 调 cancelStream → 桌面端中断 + 返 cancelled response; 但 dispatcher 还可能继续收 in-flight chunks (race window)。

**Risk**: cancel 后 1-2s 内仍有 chunk 累积进 streamingMessage, UI 显示半截 "abandoned" 文字。

**Fix**: VM cancelCurrentStream 顺序: (1) 先调 dispatcher.discardStream(streamId:) 标记不接收 (2) 再调 commands.cancelStream() (3) 设本地 currentStreamId = nil + isStreamingMessage = false. dispatcher.discardStream 内 future delta event for 该 streamId 直接 silent drop。

### 7.4 多 conversation 并发 stream 状态隔离

**Why**: 用户在 conversation A 发问后没等完成切到 conversation B 又发问，两个 stream 并发；VM messages list 是当前 conversation 的；切换 conversation 时 stream 不该 contaminate 新 view。

**Risk**: A stream chunks 错误 append 到 B conversation 的 message list。

**Fix**: VM @Published streamingMessages 字典 (conversationId → currentStreamId)；selectConversation 时检查目标对话有 in-flight stream 则继续渲染，否则展示 messages 静态列表。dispatcher streamBuffers 不依赖 conversation, 仅按 streamId; VM 维护 streamId ↔ conversationId 映射。

### 7.5 chat 一次性 vs chatStream 选择策略

**Why**: AICommands 有两个 method: `chat` (一次性等完整 response) + `chatStream` (流式)。VM 应优先用哪个?

**Risk**: 始终用 chat 失去流式体验; 始终用 chatStream 短消息有不必要 overhead (端到端 ~100ms 长 vs 完整调用 ~50ms 短)。

**Fix**: Phase 5 v0.1 始终用 chatStream (流式 UX 优先, 用户对延迟敏感而非吞吐); 有 cancel 能力。chat method 仍 wire 进 AIChatCommands API 给 v0.2 选择 (例如 system message / settings 这种一句话场景)。

### 7.6 stream 期间用户切到别的 tab/app

**Why**: iOS app 进后台时 DC close + commandClient.events 不再 yield; stream 中断。回前台后该 stream 已 stale。

**Risk**: 用户回来看到 stream 卡在某个 chunk + 永远不完成。

**Fix**: VM 监听 `UIApplication.willResignActiveNotification`; 若有 active stream → 显 banner "stream 因后台中断" + currentStreamId = nil. 用户可 tap "重发" 触发新 chat。Phase 6+ 加后台 keep-alive (BGProcessingTask) 时此 trap 解决。

### 7.7 conversation list 与桌面端实时性

**Why**: 用户在桌面端也用着 chat (新建对话 / 删除对话 / archive); iOS conversation list 不会自动同步 (Phase 5 v0.1 仅 .task 拉一次)。

**Risk**: iOS 显已删的对话 → tap 进入 → 桌面返 "conversation not found" → 错误 UX。

**Fix**: AIChatView .refreshable pull-to-refresh + .onAppear 都触发 loadConversations; 进对话失败 (404) 时 lastError + 自动 reload 列表。Phase 6+ 加 server-push event `ai.conversation.changed` 时此 trap 解决。

### 7.8 chat history 长度限制 + 性能

**Why**: 桌面端 chat 长对话可能含 500+ messages; getMessages 拉全量在 iOS 渲染 SwiftUI List 卡顿。

**Risk**: 进长对话 → loadMessages 拉 500 条 → 长 latency + UI freeze。

**Fix**: Phase 5 v0.1 默认 limit=100 (最近 100 条); pagination 留 v0.2; "查看更早" 按钮在 list 顶部触发 loadMessages(offset+=100)。

### 7.9 PHPasteboard 与 message 长按复制

**Why**: chat bubble 用户希望长按复制文本。SwiftUI Text 长按默认有 menu 但 chat bubble 含格式化时可能失效。

**Risk**: 用户复制不了 LLM 回答里的代码片段。

**Fix**: bubble 加 `.contextMenu { Button("复制") { UIPasteboard.general.string = msg.content } }`; markdown rendering 留 v0.2。

## 8. 测试策略

### 8.1 单元测试 — landed 45 (vs ≥39 目标)

| 文件 | tests | 覆盖 |
|------|-------|------|
| `AIChatCommandsTests.swift` | 12 | 8 method × 1 happy + 4 error |
| `AIChatEventDispatcherTests.swift` | 11 | 单 stream 累积 / 多 stream 并发隔离 / LRU dedup / 非 ai.chat event drop / malformed drop / end event / error event / discard / start-stop / @Published emit |
| `RemoteAIChatViewModelTests.swift` | 13 + **4 Bug-fix 回归** | loadConversations / selectConversation / sendMessage 流式 / chunks 累积 / end finalize / error / cancel / createConversation / deleteConversation / DC 不通 chat 报错 / DC 不通 createConversation 入队 / isLoading / clearError +<br>**Bug #1** 空 messageId 不覆盖本地 id / **Bug #2** delete 失败时全量回滚 / **Bug #3** stream in-flight 时拒绝 sendMessage / **Bug #4** select 切对话清 currentStreamId |
| `AIChatModelsTests.swift` | 5 | Codable + parseFromEnvelope round-trip × 5 主要 type |

iOS Phase 5 单测累计 **45** → 总 iOS 单测 ~313 + 45 = **~358**。

### 8.2 集成测试 — landed 4 in `Tests/CoreP2PTests/Integration/Phase5AIChatIntegrationTests.swift`

| # | 测试 | 覆盖 |
|---|------|------|
| 1 | `testFullChatStreamHappyPathThroughFanout` | inbound → RemoteCommandClient.events → 真 fan-out task → dispatcher 累积 → VM 占位 msg 实时更新 → end event 终态 server msg id 落地 |
| 2 | `testCancelOrderingDiscardBeforeRpc` | 50ms 窗口验证：discardStream 同步 → 本地状态收尾 → cancelStream RPC 出站 → late chunk silent drop（per §7.3）|
| 3 | `testOfflineCreateConversationDrainsOnRecover` | DC down enqueue → DC 恢复 → drainer false→true edge → ai.createConversation 真出站 → 队列清空 |
| 4 | `testCrossConversationStreamIsolation` | conv A 启 stream sA → 切 conv B 立即清 currentStreamId → sA 后续 delta+end 不污染 conv B messages（per §7.4）|

### 8.3 Phase 5.7 收口 — 静态审计找到的 4 真实 bug（已修）

| # | 位置 | 类别 | 修法 |
|---|------|------|------|
| 1 | `RemoteAIChatViewModel.finalizeStreamingPlaceholder` | 空字符串穿透 nil-coalesce | `messageId ?? oldMsg.id` 无法处理 server 空 messageId（decode 默认填 `""`，非 nil），导致 SwiftUI ForEach 身份击穿。改用 `if let mid = messageId, !mid.isEmpty` 显式 guard。|
| 2 | `RemoteAIChatViewModel.deleteConversation` | 回滚不完整 | 删当前对话失败时仅恢复 conversations 列表，currentConversation/messages 留空。新增 `rollbackDelete` 私有方法 + 入口处快照 `originalCurrent`/`originalMessages`，全量原子回滚。|
| 3 | `RemoteAIChatViewModel.sendMessage` | 缺防御性 guard | UI 按钮虽在 stream 中切到 cancel 形态，但 VM 不能假设上层禁掉了入口。新增 `guard currentStreamId == nil else { lastError = ...; return }` 在 DC gate 之前。|
| 4 | `RemoteAIChatViewModel.selectConversation` | stale stream id | 切对话不清 `currentStreamId`，靠 messages.last 的 `isStreaming` guard 兜底，edge case 下不充分（新 conv 末条也是 streaming 占位时会被串改）。改为显式清 `currentStreamId = nil; isStreamingMessage = false`。dispatcher buffer 不动，桌面 LLM 仍跑完落 server side，下次 loadMessages 拉到。|

每个 bug 对应 1 个回归单测（合计 4 个），新单测总数 41 → 45。

### 8.4 真机 E2E (Phase 5.8, Mac+iPhone+真桌面) — reproducer

| # | 场景 | 通过标准 |
|---|------|----------|
| 1 | iPhone 进 AI tab → 拉对话列表 | ≤ 500ms 显示桌面端最近对话 |
| 2 | iPhone 新建对话 → 输入 "Hello" → send | DC 发 chatStream → 桌面 LLM 流出 → iPhone 边接边渲 token-by-token |
| 3 | stream 中点 cancel | 桌面 LLM 中断 ≤ 1s + iPhone bubble 收尾保留部分文本 + 输入框 enable |
| 4 | 切到别的 tab 再回 AI tab | conversations 列表保留 + 当前对话 messages 保留 + 不重新 stream |
| 5 | iPhone 离线 sendMessage | 显示 "需在线发起对话" + 不入 OfflineQueue (chat 不能异步 enqueue) |
| 6 | iPhone 离线 deleteConversation | 入 OfflineQueue + lastError "已加入离线队列" + 网络恢复 drainer 自动 |
| 7 | 长对话 (200+ messages) → loadMessages | ≤ 1s + scroll 末位平滑 + 默认 limit=100 |
| 8 | iPhone 后台 1 min 期间桌面端创建新对话 → 回前台 | pull-to-refresh 看到新对话 |

**Reproducer 操作步骤**（每场景跑一次，按表顺序）：

- **前置**：Mac 装 ChainlessChain 桌面 v5.0.3.63+；iPhone 装 ChainlessChain iOS v5.0.3.63+；同局域网；mobile-bridge.js 已 register `pairing-code:*` alias；已完成 **Flow B** QR 配对（W3.7 `c47cbc649` 默认 UX — 手机扫桌面 QR）。
- **桌面验证路径**：所有"桌面端验证 conversation 状态"通过 **Electron 桌面 GUI 的 AI 对话面板** 完成（侧栏 → AI Chat / 知识库 → 对话历史）—— Phase 5 v0.1 没有 `cc ai *` CLI 命令，不要用 CLI 验。
- **场景 1**：iPhone 主页 → RemoteOperate → 第 7 tab "AI"（icon `brain.head.profile`）。秒表起：进 tab 到列表首屏。验 conversation row 显示桌面端真实 title + messageCount + relative date。
- **场景 2**：iPhone 点右上「更多 → 新对话」（或空状态 + button）→ alert 输入 "Quick test" → 创建。回 chat view 输入 "Hello, who are you?" → send。验 **token-by-token 渲染**（不是 lump-sum，肉眼能看到逐 token 出现；BlinkingCursor 闪烁）。Mac 桌面 GUI 打开 chat panel 验同名 conversation 已出现 + 末条 messages 与 iPhone 一致。
- **场景 3**：再发一条 "请写一首 200 字以上的长诗" → 等至少 5 个 token 渲出 → 点 iPhone 红色 stop button。验：(a) iPhone bubble 立即冻结，文本停在 cancel 时刻（保留 5+ token，非空）；(b) 桌面 LLM 进程 1s 内中断（`Get-Process ollama` PowerShell 看 CPU 掉 / chat-handler 日志看 "cancelled by client" 或类似）；(c) iPhone 输入框马上可点 send（红色 stop → 蓝色 send 切回）。
- **场景 4**：流式中切到 Terminal tab 1s 后切回 AI tab → 当前对话末条 streaming **继续**（VM filter 内存仍在）；另测：切到 Terminal tab 一直等到 stream 自然结束（`ai.chat.end`）→ 切回 AI tab，messages 末条已 finalized 用 finalText、`isStreaming=false`。
- **场景 5**：iPhone 开飞行模式 → AI tab 选已有对话 → 输入 → send。验 lastError banner = **"需在线发起对话（请检查桌面连接）"**（红色 banner），messages **不追加占位 user/assistant**（VM 的 DC gate 在乐观追加前）。
- **场景 6**：iPhone 飞行模式 → swipe delete 任意非当前对话。验 banner = **"已加入离线队列"**（橙色 banner，UI 在 `errorBanner` 内据 "离线" 字符串选色），conversation 从 list 移除（乐观）；关飞行模式 → DC 恢复 → drainer 自动跑（前台等 5-10s）→ 桌面 GUI chat panel 验该对话消失。
- **场景 7**：桌面 GUI chat panel 先选一个 conversation → 手工持续追问 ~200 条短消息撑长对话（约 5 min）→ iPhone 进对话 → 验 loadMessages 桌面端默认 `limit=100` ≤ 1s（应只显示最近 100 条，不是 200）；scroll 顶 / 底之间无 hitch；末位发新 token 时 scroll 跟随平滑（`scrollToLast` `withAnimation easeOut 0.2s`）。
- **场景 8**：iPhone 进 AI tab 看现有对话列表 sheet → 锁屏 1 分钟 → 桌面 GUI chat panel 新建一个 conversation 名 "新对话从桌面" → iPhone 解锁回 sheet → **pull-to-refresh**（`refreshable → vm.refresh → loadConversations`）→ 验新对话出现。**Phase 5 v0.1 无桌面 push event 通知新对话**，依赖手动 pull-to-refresh，不动就看不到（设计 §7.7 已注明）。

**重要 trap**（per §7.6）：场景 3 的 cancel 测试必须等到至少 5 个 token 已渲染再点 stop — 此时本地占位 assistant msg 的 `content` 字段已非空（dispatcher 累积 → `updateStreamingAssistantContent`）。Cancel 路径走 `cancelCurrentStream → finalizeStreamingPlaceholder(finalText: nil)`，`finalText ?? oldMsg.content` 落到 else 分支保留累积；若 cancel 太早 token 还没渲，content="" 也合规但**没法验保留行为**，会与早期 cancel 路径无区分。这是验 cancel 设计正确性的关键步骤，跟 §8.3 4 bug 修无直接关系（cancel 的 content 保留是 Phase 5.3 既有不变量）。

## 9. 工作量 & 时序估算

| Sub-phase | impl 工作量 | 单测 |
|-----------|-----------|------|
| 5.1 Models + Commands | ~3-4h | 12 + 5 (model) |
| 5.2 EventDispatcher | ~4-5h (含 stream 累积逻辑 + 多 stream 隔离 + LRU 复合 key) | 10 |
| 5.3 ViewModel | ~3-4h | 12 |
| 5.4 ChatView UI + ConversationListView | ~4-5h (chat bubble 设计 + sheet + scroll-to-bottom + send box) | 5 (smoke) |
| 5.5 RemoteOperateView 第 7 tab | ~30 min | — |
| 5.6 DI + memory + commit + status banner | ~1h | — |
| **总** | **~16-20h ≈ 2-3 天** | **44** |

**真机 E2E (Phase 5.7)**：~45 min (8 场景 quick run)

## 10. 风险 & 缓解

| 风险 | 概率 | 影响 | 缓解 |
|------|-----|------|------|
| stream chunk 乱序 | 中 | 高 (UI 文字错位) | §7.1 dispatcher pendingChunks 排序缓冲 |
| 多 conversation 并发 stream contamination | 中 | 中 | §7.4 streamId ↔ conversationId 映射 |
| cancel 后仍累积 chunk | 高 | 低 (1-2s 噪音) | §7.3 discardStream first 顺序 |
| chat 一次性 vs stream 选择 | 低 | 低 | §7.5 v0.1 始终 stream |
| 后台中断 stream | 高 | 中 | §7.6 willResignActive banner 提示 |
| conversation list 与桌面非实时 | 中 | 低 | §7.7 pull-to-refresh + onAppear |
| 长对话渲染卡顿 | 中 | 中 | §7.8 default limit=100 + pagination v0.2 |
| Phase 1.7/2.7/3.7/4.7 真机 E2E 暴露 base bug | 低 | 高 | 实施 GO/NO-GO 等真机过 |

## 11. 决定 / 锁结论 (待用户)

实施前用户需要 lock 5 OQs (§3)。当前推荐：A / A / B / A / A。

实施 GO/NO-GO 条件：
- ✅ Phase 4 已 land + events fan-out 模式可复用
- ⚠️ Phase 1.7/2.7/3.7/4.7 真机 E2E 未跑 — **建议全部完成后再启 Phase 5.1 sub-phase impl**；本设计 doc 可独立 land。

## 12. 后续 Phase 6+ 候选

Phase 6 候选 (按用户价值排):

1. **AI agent / model management subset** — controlAgent + listAgents + getModels (Phase 5 defer 的 AI subset 第 2 批) ~1 天
2. **Knowledge skill** — search + read + list ~10 method ~1 天 (Phase 4 设计 §12 第 2 候选)
3. **AI multimodal** — generateImage + 图片 attachment + tool call event 显示 ~2 天
4. **Chat history pagination** — Phase 5 v0.2 加分页 + 长对话懒加载
5. **Background-safe chat (BGProcessingTask)** — Phase 5 v0.2 后台 keep-alive ~1 天
6. **APNs 真后台 push** — Phase 4 v0.2

具体 Phase 6 选哪个，等 Phase 5 落地后再 ask。

## 附录：规范章节补全（v5.0.3.108）

> 本文为设计文档。为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文细节。

### 1. 概述

见正文「1. 背景」。iOS Phase 5 AI Chat Skill：远程 LLM 对话 + 流式响应 + 对话管理，不创建新框架——接通 Phase 3 RemoteCommandClient + Phase 4 events fan-out（加第 3 子流 buffer 512）+ 既有 iOS LLM 模型协议，45 unit tests。

### 2. 核心特性

远程 LLM 对话；token 流式响应；多对话管理 + stream 隔离；cancel 顺序保障；offline drain。

### 3. 系统架构

见正文「4. 架构」；接通 Phase 3 RemoteCommandClient + Phase 4 events fan-out（第 3 子流）。

### 4. 系统定位

iOS 端**远程 AI 对话 skill**（Phase 5），桌面 LLM 经 RPC 回 iPhone。

### 5. 核心功能

见正文「5. 数据模型」：chat.send/list/history/cancel；流式累积（LRU 复合 key）。

### 6. 技术架构

复用 Phase 3 invoke 池 + Phase 4 fan-out（buffer 512）；既有 iOS LLM 模型协议；stream 累积模式。

### 7. 系统特点

Phase 5.7 静态审计修 4 真实 bug（fan-out / cancel 顺序 / offline drain / 多对话 stream 隔离）；本模式被 PDH Phase 14.5 复用为祖本。

### 8. 应用场景

iPhone 经桌面 LLM 做 AI 对话（流式）。

### 9. 竞品对比

复用 Phase 3/4 框架零新范式；多对话 stream 隔离。

### 10. 配置参考

LLM provider / model（既有 iOS 模型协议）；fan-out buffer 512。

### 11. 性能指标

首 token 时延 + token 速率（远程 LLM）。

### 12. 测试覆盖

45 unit tests（41→45）+ 4 集成测试（fan-out / cancel 顺序 / offline drain / 多对话隔离）；真机 E2E Phase 5.8 待跑。

### 13. 安全考虑

对话含个人内容；走配对信任信道；offline enqueue 本地。

### 14. 故障排除

多对话 stream 串流 / cancel 后仍收 token → 见 memory `ios_remote_ai_chat_phase5.md` 6 trap。

### 15. 关键文件

`Modules/CoreP2P/.../RemoteSkills/AIChat/`（含 AIChatEventDispatcher.swift，PDH 14.5 祖本）。

### 16. 使用示例

见正文数据模型与 chat.send 流式调用。

### 17. 相关文档

`iOS_Phase_3_Remote_Operate_Framework.md`、`iOS_Phase_4_Notification_Skill.md`、`Personal_Data_Hub_Phase_14_5_Streaming_Ask.md`（复用本模式）、memory `ios_remote_ai_chat_phase5.md`。
