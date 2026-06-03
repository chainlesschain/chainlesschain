# Personal Data Hub — Phase 14.3 双端流式同步进度 + 审计回查 详细设计

> **状态**：v0.1 设计稿（2026-05-21）。Phase 14.3 在 [`Personal_Data_Hub_Phase_14_Mobile_Native_Entry.md`](./Personal_Data_Hub_Phase_14_Mobile_Native_Entry.md) §6 已列入 sub-phase（14.3.1/14.3.2/14.3.3 共 1d），§5.4 给出端到端流。本稿专门给 Phase 14.3 实施者提供 **wire schema + dispatcher 模板 + UI 模式** 三块可直接落地的内容。
>
> **关联**：父 14 主稿 §5.4 + §6.3；姐妹 [`iOS_Phase_4_Notification_Skill.md`](./iOS_Phase_4_Notification_Skill.md)（`NotificationEventDispatcher` 模式祖本）+ [`iOS_Phase_5_AI_Chat_Skill.md`](./iOS_Phase_5_AI_Chat_Skill.md)（`AIChatEventDispatcher` 用 stream 累积、复合 key LRU 模式祖本）。
>
> **为什么独立成稿**：父 Phase 14 doc 已 700+ 行，再加 14.3 的 dispatcher 模板 + 4 子流细节会让索引爆。本稿独立 + 父稿 §5.4 引用即可。

---

## 1. 目标 & 非目标

### 1.1 目标 (in scope)

- 定义 `personal-data-hub.sync.progress` event 的 **wire schema**（统一 Android / iOS 解析模型）
- 给出 Android `HubSyncEventDispatcher.kt` 模板（mirror Phase 4 `NotificationEventDispatcher`）
- 给出 iOS `HubSyncEventDispatcher.swift` 模板（mirror Phase 5 `AIChatEventDispatcher`）
- 4 子流 fan-out task：Phase 5 已加 3 个（terminal / notification / aichat），本期加第 4 个 buffer 256
- 双端 sync 进度 UI 模式：4 状态机（connecting / fetching / normalizing / done）+ error 状态
- 审计回查（`recent-audit` typed RPC + UI 列表）—— **非流式**，本期一并设计

### 1.2 非目标 (defer)

- audit 实时推送：v1 仅 pull-to-refresh；v2 再考虑 `personal-data-hub.audit.appended` event 流（涌入高 → 价值低，先 defer）
- 多 adapter 并行 sync 进度合并：v1 同时只允一个 sync-stream（UI lock 别 adapter button）；v2 多线渐进
- 桌面端 progress UI：桌面 SPA 已有进度条（用 `Phase 5.7 流式同步` 通道），本稿不动桌面

---

## 2. Wire schema — `personal-data-hub.sync.progress`

桌面 `personal-data-hub-protocol.js` 已 emit 此 event（v5.0.3.72 Phase 5.7 落地）。本节确认 4+1 状态机 + 字段。

### 2.1 状态机

```
[start invoke sync-adapter-stream]
        ↓
   ┌─ connecting    ── (adapter health check, IMAP / API handshake)
   │      ↓
   ├─ fetching      ── (一次或多次 push, partition × cursor 维度)
   │      ↓
   ├─ normalizing   ── (一次或多次 push)
   │      ↓
   └─ done          ── (单次, 最终 SyncReport)
        OR
        error      ── (任何阶段失败终止)
```

**约束**：
- `done` 与 `error` 互斥，且永远是 stream 终态
- `fetching` / `normalizing` 可重复（per partition）
- 单 sync 一定从 `connecting` 开始（即使空 watermark）

### 2.2 Event payload

```jsonc
// WS 推流（cc ui / web-shell / mobile-bridge 同模式）
{
  "type": "personal-data-hub.sync.progress",
  "syncId": "sync-2026-05-21T10-23-15-XXX",  // 单次 sync invoke 标识，UI dispatcher dedupe + filter 用
  "kind": "connecting" | "fetching" | "normalizing" | "done" | "error",
  "adapter": "email-imap",                   // adapter name (sync-adapter 入参)
  "partition": "INBOX",                       // optional: 分区 (IMAP folder / Alipay CSV 段 / WeChat 表)
  "ts": 1737537795000,                        // server ms
  "detail": {                                 // kind-specific (见 §2.3)
    /* ... */
  }
}
```

### 2.3 per-kind detail

| kind | detail 必有 | detail 可选 | UI 展示建议 |
|---|---|---|---|
| `connecting` | — | `serverHost` (IMAP host etc) | "正在连接 email-imap…" + spinner |
| `fetching` | `uidsScanned` or `pagesScanned` 或 `rowsRead` (数字) | `cursor` / `partitionProgress` (0-1) | "已拉取 250 条" + 进度条 (有 partitionProgress 时) |
| `normalizing` | `eventsBuilt` (数字) | `invalidQueueSize` | "已归一化 30 条事件 (3 条入校验失败队列)" |
| `done` | `report: SyncReport` | — | Snackbar "Email 已同步 30 条事件，3 条进 review" + 关 dialog |
| `error` | `error: { code, message }` | `partial: { ingested, kgTriples }` | 红 banner "EmailAdapter 同步失败：authentication failed" + 不关 dialog + 提示用户检查 authCode |

**SyncReport** shape (typed wrapper 已在 Android `HubModels.kt` 落地)：

```ts
type SyncReport = {
  ingested: number;
  kgTriples: number;
  ragDocs: number;
  durationMs: number;
  invalidCount?: number;
  watermark?: { partition, value };
};
```

### 2.4 schema invariants

- `syncId` 必填且全局唯一（桌面 `crypto.randomUUID()` 或 `${ts}-${rand5}`）—— Phase 5 复合 key LRU 模式同样适用于这里
- `ts` 单调（但**不**严格递增 —— `fetching` × N 可同 ms）
- 跨 stream `ts` 比较无意义（每 sync 独立）

---

## 3. Fan-out task — 加第 4 子流

### 3.1 桌面端（已存在）

`packages/cli/src/gateways/ws/personal-data-hub-protocol.js`:

```js
"personal-data-hub.sync-adapter-stream": async (msg, sender) => {
  const syncId = "sync-" + crypto.randomUUID();
  for await (const evt of hub.registry.syncAdapterStream(msg.name, msg.options)) {
    sender.send({
      type: "personal-data-hub.sync.progress",
      syncId,
      kind: evt.kind,
      adapter: evt.adapter,
      partition: evt.partition,
      ts: Date.now(),
      detail: evt.detail || evt.report || evt.error,
    });
  }
}
```

无需改动。

### 3.2 Android 端（Phase 14.3.1）

Android 既有 `RemoteCommandClient.events` 流（Phase 3 引入），Phase 4/5 各加 1 子流 dispatcher：
- Phase 3 — TerminalEventDispatcher（subscribes filter `terminal.output` / `terminal.exit`）
- Phase 4 — NotificationEventDispatcher（filter `notification.received`）
- Phase 5 — AIChatEventDispatcher（filter `ai.chat.delta` / `ai.chat.done` / `ai.chat.error`）

Phase 14.3.1 加第 4 个 — `HubSyncEventDispatcher`（filter `personal-data-hub.sync.progress`）。

```kotlin
// android-app/app/src/main/java/com/chainlesschain/android/remote/dispatcher/HubSyncEventDispatcher.kt
@Singleton
class HubSyncEventDispatcher @Inject constructor(
    private val client: RemoteCommandClient,
    private val scope: CoroutineScope,    // injected ApplicationCoroutineScope
) {
    // Per-syncId state holder（与 AIChat 的 streamId 一致 LRU 复合 key 模式）
    private val _activeSyncs = MutableStateFlow<Map<String, HubSyncState>>(emptyMap())
    val activeSyncs: StateFlow<Map<String, HubSyncState>> = _activeSyncs.asStateFlow()

    // 防 active 数无限膨胀 (long-running session 跨多 sync) — LRU max 32
    private val syncIdLru = LinkedHashSet<String>()

    init {
        scope.launch {
            client.events
                .filter { it.type == "personal-data-hub.sync.progress" }
                .collect { handleEvent(it) }
        }
    }

    private fun handleEvent(envelope: ServerEnvelope) {
        val payload = envelope.payload as? Map<*, *> ?: return
        val syncId = payload["syncId"] as? String ?: return
        val kind = payload["kind"] as? String ?: return
        val adapter = payload["adapter"] as? String ?: return

        val state = _activeSyncs.value[syncId] ?: HubSyncState(syncId, adapter)
        val updated = when (kind) {
            "connecting" -> state.copy(stage = SyncStage.CONNECTING)
            "fetching" -> state.copy(
                stage = SyncStage.FETCHING,
                fetchedCount = (payload["detail"] as? Map<*, *>)?.let {
                    (it["uidsScanned"] as? Number)?.toInt()
                        ?: (it["pagesScanned"] as? Number)?.toInt()
                        ?: (it["rowsRead"] as? Number)?.toInt()
                } ?: state.fetchedCount,
            )
            "normalizing" -> state.copy(
                stage = SyncStage.NORMALIZING,
                normalizedCount = ((payload["detail"] as? Map<*, *>)?.get("eventsBuilt") as? Number)?.toInt()
                    ?: state.normalizedCount,
            )
            "done" -> state.copy(
                stage = SyncStage.DONE,
                report = parseSyncReport(payload["detail"]),
            )
            "error" -> state.copy(
                stage = SyncStage.ERROR,
                error = (payload["detail"] as? Map<*, *>)?.let {
                    HubSyncError(
                        code = it["error"]?.let { e -> (e as? Map<*, *>)?.get("code") as? String } ?: "UNKNOWN",
                        message = it["error"]?.let { e -> (e as? Map<*, *>)?.get("message") as? String } ?: "",
                    )
                },
            )
            else -> state
        }
        _activeSyncs.value = _activeSyncs.value + (syncId to updated)

        // LRU trim
        syncIdLru.remove(syncId); syncIdLru.add(syncId)
        if (syncIdLru.size > 32) {
            val oldest = syncIdLru.first()
            syncIdLru.remove(oldest)
            _activeSyncs.value = _activeSyncs.value - oldest
        }
    }
}

data class HubSyncState(
    val syncId: String,
    val adapter: String,
    val stage: SyncStage = SyncStage.CONNECTING,
    val fetchedCount: Int = 0,
    val normalizedCount: Int = 0,
    val report: SyncReport? = null,
    val error: HubSyncError? = null,
)

enum class SyncStage { CONNECTING, FETCHING, NORMALIZING, DONE, ERROR }
data class HubSyncError(val code: String, val message: String)
```

### 3.3 iOS 端（Phase 14.3.2）

Mirror Phase 5 `AIChatEventDispatcher` + Phase 4 fan-out 子流 buffer 模式：

```swift
// Modules/CoreP2P/Sources/RemoteSkills/PersonalDataHub/HubSyncEventDispatcher.swift
@MainActor
final class HubSyncEventDispatcher: ObservableObject {
    @Published var activeSyncs: [String: HubSyncState] = [:]
    @Published var lastError: HubSyncError? = nil

    private let commandClient: RemoteCommandClient
    private var stream: Task<Void, Never>? = nil
    private var syncIdLru = LRUSet<String>(capacity: 32)

    init(commandClient: RemoteCommandClient) {
        self.commandClient = commandClient
        start()
    }

    private func start() {
        stream = Task { [weak self] in
            guard let self else { return }
            // commandClient.events fan-out 加第 4 子流 buffer 256 (Phase 14.3.2)
            for await event in commandClient.subscribeEvents(
                bufferSize: 256,
                filter: { $0.type == "personal-data-hub.sync.progress" }
            ) {
                await MainActor.run {
                    self.handle(event)
                }
            }
        }
    }

    private func handle(_ envelope: ServerEnvelope) {
        guard
            let payload = envelope.payload as? [String: Any],
            let syncId = payload["syncId"] as? String,
            let kind = payload["kind"] as? String,
            let adapter = payload["adapter"] as? String
        else { return }

        var state = activeSyncs[syncId] ?? HubSyncState(syncId: syncId, adapter: adapter)
        let detail = payload["detail"] as? [String: Any]

        switch kind {
        case "connecting": state.stage = .connecting
        case "fetching":
            state.stage = .fetching
            if let n = (detail?["uidsScanned"] ?? detail?["pagesScanned"] ?? detail?["rowsRead"]) as? Int {
                state.fetchedCount = n
            }
        case "normalizing":
            state.stage = .normalizing
            if let n = detail?["eventsBuilt"] as? Int { state.normalizedCount = n }
        case "done":
            state.stage = .done
            state.report = parseSyncReport(detail)
        case "error":
            state.stage = .error
            state.error = parseError(detail)
            lastError = state.error
        default: break
        }

        activeSyncs[syncId] = state
        syncIdLru.insert(syncId)
        if let evicted = syncIdLru.evictedLast() { activeSyncs.removeValue(forKey: evicted) }
    }
}

struct HubSyncState {
    let syncId: String
    let adapter: String
    var stage: SyncStage = .connecting
    var fetchedCount: Int = 0
    var normalizedCount: Int = 0
    var report: SyncReport? = nil
    var error: HubSyncError? = nil
}

enum SyncStage { case connecting, fetching, normalizing, done, error }
```

### 3.4 RemoteDependencies 注入（双端）

**Android (Hilt)** — 已在 PDH commands module 注入 RemoteCommandClient；Phase 14.3.1 加：

```kotlin
@Module
@InstallIn(SingletonComponent::class)
object PersonalDataHubDispatcherModule {
    @Provides
    @Singleton
    fun provideHubSyncEventDispatcher(
        client: RemoteCommandClient,
        @ApplicationCoroutineScope scope: CoroutineScope,
    ): HubSyncEventDispatcher = HubSyncEventDispatcher(client, scope)
}
```

**iOS (RemoteDependencies)** — `Features/PersonalDataHub/RemoteDependencies+Hub.swift` 加：

```swift
extension RemoteDependencies {
    var hubSyncDispatcher: HubSyncEventDispatcher {
        // Phase 14.3.2: init closure 捕获 commandClient (per memory ios_remote_desktop_phase6_6 P3)
        // 注意：MainActor.run init 模式（per Phase 4 RemoteDependencies pattern）
        ...
    }
}
```

---

## 4. UI 模式

### 4.1 进度对话（双端通用）

```
┌─ Email 同步进行中 ────────────────┐
│                                  │
│  [spinner] 正在连接 IMAP…        │   ← stage: connecting
│                                  │
│  [icon]    已拉取 250 封         │   ← stage: fetching
│  [icon]    已归一化 30 条事件    │   ← stage: normalizing
│                                  │
│             [取消]               │
└──────────────────────────────────┘

完成后自动收 + Snackbar：
┌──────────────────────────────────────────┐
│ ✓ Email 已同步 30 条事件（3 进 review）│
└──────────────────────────────────────────┘

失败后保留 dialog + 红 banner：
┌─ Email 同步失败 ──────────────────┐
│ × IMAP authentication failed      │
│   建议：检查 authCode 是否更新    │
│            [重试] [关闭]          │
└──────────────────────────────────┘
```

### 4.2 状态机 → UI 映射

| stage | Android Composable | iOS SwiftUI |
|---|---|---|
| `CONNECTING` | `Row { CircularProgressIndicator(); Text("正在连接 \$adapter…") }` | `HStack { ProgressView(); Text("正在连接 \(adapter)…") }` |
| `FETCHING` | `LinearProgressIndicator(progress)` if partitionProgress else indeterminate；Text(`已拉取 \$fetchedCount`) | `ProgressView(value: progress).progressViewStyle(.linear)`；`Text("已拉取 \(fetchedCount)")` |
| `NORMALIZING` | Text(`已归一化 \$normalizedCount 条`) + 微动画 | `Text("已归一化 \(normalizedCount) 条")` + animation |
| `DONE` | Snackbar 显示 `report.ingested` + auto-dismiss dialog | Toast / dismissable sheet |
| `ERROR` | 红色 banner + 错误 message + 重试按钮 | 红色 banner + 错误 message |

### 4.3 取消行为

用户点 [取消] → invoke `personal-data-hub.cancel-sync` (新 method, Phase 14.3 加入但 v0.1 仅 stub)：
- v0.1：dialog 关掉但桌面 sync 继续完成（vault 一致性保证；UI 假装"取消"）—— 与 §7 T3 一致
- v1：真 cancel — 桌面侧 `registry.cancelSyncStream(syncId)`，watermark 不前推；本 Phase **不**做

---

## 5. 审计回查 UI（非流式）

### 5.1 数据流

```
[HubAuditScreen] mount
    ↓
[ViewModel.refresh()] → invoke "personal-data-hub.recent-audit" { since, action, limit: 50 }
    ↓
[桌面 ipc handler] vault.queryAudit(filter) → AuditRow[]
    ↓
[ViewModel] state.entries = list；isLoading=false
    ↓
[LazyColumn / List] 渲染 + 下拉刷新 + filter chip 切 action
```

### 5.2 AuditRow 形态

```ts
type AuditRow = {
  id: string;
  at: number;            // ms
  action: "ingest" | "ask" | "register" | "unregister" | "sync" | "destroy" | ...;
  adapter?: string;      // ingest / sync
  eventId?: string;      // ingest 时关联 event
  actor: "user" | "system";
  context?: { question?: string; ... };
};
```

### 5.3 filter chip 行为

`["全部", "提问", "同步", "注册", "销毁"]` 单选 chip + 时间范围（"近 1 天" / "近 7 天" / "全部"）。

**注意 (per T9)**：filter 不缩 `limit`；客户端拿 50 条做内存 filter；超时再加 query-side filter。

### 5.4 deep-link 到事件详情

若 `audit.eventId` 存在，点行 → invoke `personal-data-hub.event-detail` → 同 Phase 5 citation chip 路径打开 bottom sheet。

---

## 6. Phase 14.3 sub-phase 拆分（细化父稿 §6）

| Sub | 内容 | Win dev 可做？ | 工期 | 单测目标 |
|---|---|---|---|---|
| 14.3.1.a | wire schema lock + 桌面 emit code review（已 land 仅 confirm） | ✅ | 0.25d | 0 (existing) |
| 14.3.1.b | Android `HubSyncEventDispatcher.kt` + Hilt module + state model | ✅ | 0.5d | ≥ 5 |
| 14.3.1.c | Android `HubAdaptersViewModel` 集成 dispatcher + 触发 sync 流 | ✅ | 0.25d | ≥ 3 |
| 14.3.1.d | Android sync progress Composable (`HubSyncProgressDialog`) | ✅ | 0.25d | ≥ 2 + UI preview |
| 14.3.2.a | iOS `HubSyncEventDispatcher.swift` + RemoteDependencies wiring | ✅ (Win) | 0.5d | ≥ 5 |
| 14.3.2.b | iOS `HubAdaptersView` 集成 dispatcher + sheet | ✅ (Win) | 0.25d | ≥ 3 |
| 14.3.2.c | iOS `HubSyncProgressView` SwiftUI | ✅ (Win) | 0.25d | ≥ 2 |
| 14.3.3.a | 双端 `HubAuditScreen` / `HubAuditView` + filter chip + 时间范围 | ✅ | 0.5d (双端) | ≥ 4 |
| 14.3.3.b | 双端 deep-link `audit.eventId` → eventDetail sheet | ✅ | 0.25d | ≥ 2 |

**合计**：~3d (双端并行可压到 1.5d)。Win dev box **全可做** —— Android 用 Android Studio，iOS 写代码 + 推 CI 编译验证（per memory `ios_ci_only_verify_path_on_win.md`）。

---

## 7. Traps & 风险（新增）

| # | Trap | 修法 |
|---|---|---|
| T1 | dispatcher state 跨 sync 累 → 内存膨胀 | LRU 32 (与 Phase 5 一致)；每次新 sync 触发就 dedupe |
| T2 | 桌面 sync 完了 done event 漏推（DC 抖动） → UI 永远 "fetching" | 30s 客户端 timeout：dispatcher 内 `lastEventAt > 30s + 无 done` → 手动 state.stage = ERROR + 提示用户重试 |
| T3 | 用户点 [取消] 期待真停 | v0.1 文案明示"已请求停止，桌面正在收尾"；v1 加 cancel method |
| T4 | 多 sync 并发显示一个 dialog | UI lock：触发 sync 后所有 adapter list 行 sync 按钮 disable，直到 done/error |
| T5 | LRU 把仍在 stream 中的 syncId evict 掉 | 32 容量充裕（用户实际不可能并行 32 sync）；可观察 `_activeSyncs.size > 16` 时打 warn log |
| T6 | dispatcher start 失败（fan-out collect 拒接） | init log "subscribe failed"；fallback 走 poll mode（每 5s invoke 桌面 `sync-status` —— 但桌面无此 method，所以**只**log + UI 显示 "sync 状态未知"，操作仍允） |
| T7 | sync 触发后用户切 tab 离开 | dispatcher state 是 Singleton，回 tab 后仍能 resume；UI 渲染从 ViewModel 拉当前 active |
| T8 | sync `report.invalidCount > 0` 用户不知道在哪看 | Snackbar 文案 "30 条已 ingest，3 条进 review"（review queue 在 Audit tab `action=ingest` filter 下显示带 invalid flag） |
| T9 | audit `limit=50` 不够看 | UI 触底加载更多 (下次再 invoke `recent-audit` with `since=<oldest seen at>-1`) — 标准 page-cursor 模式 |
| T10 | audit row 含 question → 用户隐私文字泄漏在审计页 | audit detail 默认隐藏 `context.question`，长按行 → "查看详情" 再显示 |
| T11 | Android 14+ `ApplicationCoroutineScope` lifecycle 重启 → dispatcher state 清零 | Singleton + 重新 collect events；UI 拉 cached state from local `SharedPreferences` 重建（v1 实现） |
| T12 | iOS Background mode → events stream 暂停 → 前台后未自动 resume | `commandClient.subscribeEvents` 已有 Phase 5 background→foreground resume 模式 reuse |

---

## 8. 验收

### 8.1 单测

| 端 | 文件 | 测试数 |
|---|---|---|
| Android | `HubSyncEventDispatcherTest.kt` | ≥ 5（connecting → fetching → normalizing → done 全路径 / error 路径 / LRU evict / 多 sync 隔离 / 30s timeout） |
| Android | `HubAdaptersViewModelTest.kt` (delta) | ≥ 3 (triggerSync 触发 invoke + ViewModel 监听 dispatcher) |
| Android | `HubAuditViewModelTest.kt` | ≥ 4 (refresh / filter / 时间范围 / deep-link to event detail) |
| iOS | `HubSyncEventDispatcherTests.swift` | ≥ 5 (同 Android) |
| iOS | `HubAdaptersViewModelTests.swift` (delta) | ≥ 3 |
| iOS | `HubAuditViewModelTests.swift` | ≥ 4 |

**合计：≥ 24 新单测**。

### 8.2 集成测试

- Android `HubSyncIntegrationTest.kt` ≥ 2（mock event 序列注入 dispatcher → ViewModel state 校验 + audit fetch）
- iOS `HubSyncIntegrationTests.swift` ≥ 2

### 8.3 真机 E2E（落入 Phase 14.4，本稿不含）

参见父稿 §8.3 场景 5（sync 触发）+ 场景 6（审计回查）。

---

## 9. 与 Phase 5 AI Chat dispatcher 的相似与不同

| 维度 | Phase 5 AIChatEventDispatcher | Phase 14.3 HubSyncEventDispatcher |
|---|---|---|
| 数据载体 | 流式 token (chunk) | 状态变迁 (stage transition) |
| 内部 buffer | pendingChunks 乱序排序 | 单一 stage —— 无需 buffer |
| key 维度 | `(streamId, chunkIdx)` 复合 LRU | 仅 `syncId` LRU |
| 终态 | `done` / `error` / `cancel` | `done` / `error` |
| 内存窗口 | 1024 复合 key | 32 syncId（远小，长 sync 不像 chat 流速密） |
| Cancel | 桌面真 cancel `cancel-stream` | v0.1 仅 UI dismiss；v1 加 cancel-sync method |

**核心相似**：基类相同（fan-out task + filter + state holder + LRU）；**不同**：sync 是"状态机"，chat 是"流式累积"。

---

## 10. 实施 reference

| 现有文件 | 用途 |
|---|---|
| `packages/cli/src/gateways/ws/personal-data-hub-protocol.js:278+` | 桌面 emit 端（已存在） |
| `desktop-app-vue/src/main/ipc/personal-data-hub-ipc.js:403+` | Electron IPC 镜像（已存在） |
| `packages/personal-data-hub/lib/registry.js:syncAdapterStream` | hub 内部生成器 |
| `android-app/.../remote/commands/PersonalDataHubCommands.kt:106` | Android `syncAdapterStream` wrapper（已存在但缺 dispatcher 订流） |
| `android-app/.../remote/dispatcher/NotificationEventDispatcher.kt` | Phase 4 dispatcher 模板 |
| `android-app/.../remote/dispatcher/AIChatEventDispatcher.kt` | Phase 5 dispatcher 模板（含 LRU + state） |
| iOS `Modules/CoreP2P/Sources/RemoteSkills/AIChat/AIChatEventDispatcher.swift` | iOS dispatcher 模板 |

> Phase 14.3 实施者应**先**读 Phase 5 dispatcher（Android + iOS 两侧），再读本稿 §3.2 + §3.3 模板 —— 几乎是 copy + 改 filter + 改 state model 的工作量。
