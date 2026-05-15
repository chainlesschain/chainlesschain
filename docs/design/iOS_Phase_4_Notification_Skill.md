# iOS Phase 4 — Notification Skill (Remote 通知同步 + 系统级 push)

> **状态**：Phase 4.1-4.5 全部 落地（4.6 commit 标记，2026-05-15）— Models + NotificationCommands + EventDispatcher + ViewModel + NotificationsView UI + RemoteOperateView 第 6 tab + horizontal scroll picker + 未读 badge 全套；events fan-out task 修 Phase 4 实施暴露的新 trap (设计 §7 未覆盖的多 events 订阅冲突)；DI wiring 在 4.4 一并前移完成。**41 新 unit tests across 4 test suites**（NotificationModels via NotificationCommands 18 + EventDispatcher 10 + ViewModel 13）。**iOS 单测累计 ~313**。**未跑**：Phase 4.7 真机 E2E (Mac+iPhone+真桌面 在场再做，8 场景：拉历史 / 桌面 push 弹 banner / LRU dedup / markAsRead 双轨 / 离线 enqueue / quiet hours silenced / authorization denied / 后台 1min)。
>
> **依赖**：iOS Phase 3.1-3.6 已落 (`759a1e907`) — RemoteCommandClient + RemoteSkillRegistry + OfflineCommandQueue 全套；PushNotificationManager.swift 已就位（authorization/scheduleNotification/quiet hours/badge/categories 全有）；Phase 3.7 真机 E2E 不阻 Phase 4 设计（独立）
>
> **对齐版本**：Android `NotificationCommands.kt` (343 LOC, 11 method) + `NotificationReceivedEvent` push 事件协议；iOS `PushNotificationManager.swift` (531 LOC, 全套 UN center 调用) 已就位
>
> **关联文档**：`iOS_Phase_3_Remote_Operate_Framework.md`（framework）、`iOS_Phase_2_Remote_Terminal.md`（events stream pattern）、Android `NotificationCommands.kt`（wire 协议源）；memory `ios_remote_operate_phase3.md`（Phase 3 9 trap 复用）

---

## 1. 背景

### 1.1 Phase 4 = 第一个真正"被动通知"skill

Phase 1-3 的所有 skill 都是 **iOS 主动调桌面**（pull / get / set）：
- Phase 1：iPhone 主动扫桌面 QR
- Phase 2：iPhone 主动 stdin 发到桌面 PTY
- Phase 3.3-3.5：iPhone 主动调 clipboard.get / file.list / screen.capture / system.info

**Phase 4 反向**：桌面主动 push 通知到 iPhone。这是 iOS 端首次接到桌面**事件流**——之前 stdout/exit 是 terminal session 内部，现在 `notification.received` 是跨 session、跨应用、可能后台（iOS 限制内）触发系统通知。

### 1.2 iOS 已就位 vs 需新建

✅ **已就位**：
- `RemoteCommandClient.invoke(method:, params:, mobileDid:)` — Phase 3 通用 RPC actor，11 个 notification method 直接 wire 上（与 clipboard.get / file.list 同一池）
- `RemoteCommandClient.events: AsyncStream<String>` — 服务端 push event 入口（Phase 2 起就 yield 全 inbound non-response envelope；Phase 3 TerminalRpcClient 已订过，filter `terminal.stdout/exit`；Phase 4 类似 filter `notification.received`）
- `OfflineCommandQueue` — DC 不通时 `notification.markAsRead` / `delete` 等 mutating 调用入队，恢复后 drain
- `RemoteOperateView` 5-tab segmented shell — 加第 6 tab "通知" 一致 UX
- `PushNotificationManager.swift`（531 LOC）— authorization / scheduleSystemNotification / NotificationSettings (含 quiet hours) / clearBadge/setBadge / categories / removePendingNotifications 全有
- `NotificationSettingsView.swift`（304 LOC）— 既有 iOS 端 settings UI，本 Phase 复用 + 加桌面同步

❌ **缺**：
- `NotificationCommands` actor — 11 个 method typed wrapper（镜像 Android `NotificationCommands.kt`）
- `RemoteNotificationModels.swift` — Codable 模型（Priority enum / HistoryItem / Settings / 6 个 Response 类型 / ReceivedEvent）
- `NotificationEventDispatcher` — 订阅 commandClient.events 流 + filter `notification.received` envelope + 调用 `PushNotificationManager.scheduleSystemNotification` + 维护 unread badge count
- `RemoteNotificationsViewModel` — @MainActor ObservableObject 包 NotificationCommands + history list state + settings state
- `NotificationsView` — RemoteOperateView 第 6 tab；history 列表 + 未读筛选 + 设置 sheet
- `RemoteOperateView` 改 — segmented control 加 "通知" 项（badge 显未读数）
- `RemoteDependencies` 改 — wire NotificationCommands + EventDispatcher + ViewModel
- 5 SeedRegistry entries 中 `notification` skill 已 enabled flag = true（已 Phase 3 land，无需改）

## 2. 目标 & 非目标

### 2.1 目标 (Phase 4 in scope)

| # | 项 | 验收 |
|---|---|---|
| G1 | `NotificationCommands` 11 method 全 wire | 单测 ≥ 11（每 method 至少 1 success + 1 错误路径），envelope shape match Android |
| G2 | `notification.received` push event 触发 iOS 系统通知 | 单测：mock `commandClient.events` 喂事件 → 验 PushNotificationManager.scheduleSystemNotification 被调；真机：桌面发通知 → iPhone 锁屏弹 banner |
| G3 | NotificationsView 历史列表显示 | 单测：mock NotificationCommands.getHistory → list 渲染；真机：进 tab 看到 ≥1 历史项 |
| G4 | 未读 badge 显示在 segmented "通知" tab + iOS app icon | 单测：unread count 改 → @Published 响应；真机：桌面 push 3 条未读 → tab badge "3" + app icon "3" |
| G5 | iOS 端 settings 与桌面 settings 双向同步 | iOS 改 quiet hours → 调 updateSettings → 桌面值更新；桌面改 → iOS getSettings 拉到 |
| G6 | OfflineQueue 兼容 — DC 断时 markAsRead/delete 入队，连上 drain | 集成测试 (Phase 3 既有 `Phase3IntegrationTests.swift` 加 1 个 case) |
| G7 | RemoteSkillRegistry 中 notification 项 risk badge 正确（Mutating） | UI test：notification tab 入口显示 risk chip |

### 2.2 非目标 (defer 到 Phase 5+)

- **APNs 真远程 push**（app 在后台 / 杀死时收）— 需服务器 + 证书；Phase 4 仅 foreground (app 在前台 / 锁屏 banner) + DC active 时；后台 keep-alive 留 Phase 5
- **iOS 端→桌面 sendToMobile reverse**（iPhone 主动给其它 mobile 设备发）— Android v1.x 已支持但 iOS Phase 4 不实现；用户场景几乎为零
- **broadcast 多设备分发**——v0.2；v0.1 仅 iPhone 1 对 1 收桌面 push
- **rich notification**（含 image / action button / 自定义 view）— UNNotificationContentExtension 整套 v0.2；v0.1 仅 title + body + priority
- **通知分组 thread-id**——iOS UN center 支持 threadIdentifier 但 Phase 4 留 v0.2
- **NotificationServiceExtension 加密内容解密**——Phase 4 假设 envelope 已是明文（DC e2ee 已经 application 层透明）
- **桌面端 quiet hours 同步**——v0.2；v0.1 iOS 端 quiet hours 只影响 iOS 本地 UN center，不上传桌面
- **历史搜索 / 排序 / 复杂筛选**——v0.2；v0.1 仅 unreadOnly toggle + 时间倒序

## 3. Open Questions

### OQ-1：NotificationsView 入口位置

**A**：RemoteOperateView 加第 6 segmented tab "通知"（与现有 5 tab 同位，一致 UX）
**B**：单独 NavigationLink 入口在 PairedDevicesListView 旁，"已配对桌面" + "桌面通知" 两 row
**C**：双入口（A + B），unread 时 PairedDevicesListView 行右侧 badge 提示

**推荐 A**。理由：(1) iOS Tab Bar 5 项是 HIG 软上限（segmented control 不像 TabBar 物理限制）；6 tab 加未读 badge 在 segmented 视觉负担可接受 (2) 用户思维模型 "通知是远程操控的一种" 与现有 5 tab 同层，与 Plan 区分清晰 (3) Phase 5+ 加更多 tab 时统一 segmented，再考虑切 TabBar 或 More 二级。

### OQ-2：通知历史持久化策略

**A**：iOS 端 UserDefaults JSON 全持久化（同 OfflineCommandQueue 模式，每次写盘）
**B**：iOS 端不持久化，进 tab 时拉桌面 getHistory；离开释放（桌面是 source of truth）
**C**：UserDefaults 仅缓存最新 50 条 + 桌面 SoT；进 tab 显缓存 + 后台 refresh

**推荐 B**。理由：(1) 桌面已是 source of truth，iOS 端再持久化只是冗余；(2) UN center 自身已存 delivered notification（getDeliveredNotifications 可拉），iOS 系统已经替我们记 (3) 离线时已读 / 删除操作走 OfflineCommandQueue 兜底——OfflineQueue 持久化已有，不需要二次重 (4) 容量焦虑小：桌面通知数量级远低于 chat 消息，不需要本地索引；(5) 进 tab 需 1 round-trip 拉 history 是可接受 latency（300ms 内，与 Phase 3 systeminfo 等同），可加 skeleton loader 缓和。

### OQ-3：notification.received event → 触发 UN center 的 dedup 策略

**A**：直接调 `PushNotificationManager.scheduleSystemNotification`，每收必 push
**B**：用 LRU dedup（按 notificationId，size 256，30s TTL）防同一 envelope 经 DC + signaling 双路重复
**C**：服务端 source-of-truth dedup，iOS 信任不重复

**推荐 B**。理由：(1) Phase 2 TerminalRpcClient stdout 同模式已用 LRU `(sessionId|seq)`，Phase 4 复用 LRUSet 类（已 13 LOC，零成本）；(2) 桌面 mobile-bridge 在 v5.0.3.53 也加了 128-LRU dedup（commit `fc3752360`），但 iOS 信任客户端兜底更稳；(3) iOS UN center identifier 必须唯一，重复 schedule 会显两条 banner —— LRU 是必需而非 nice-to-have；(4) C 不可信：DC 失败 fallback signaling 时桌面会双发，第二条 1-2s 内必到。

### OQ-4：iOS 端 quiet hours 与桌面 quiet hours 关系

**A**：iOS 端 quiet hours 只影响 iOS 本地 UN center（已 PushNotificationManager 内 `isInQuietHours()`）；桌面 settings 仅显示 + sync from 桌面端
**B**：iOS 改 quiet hours → 调 updateSettings 同步桌面（双向真同步）
**C**：iOS 端无 quiet hours（直接用桌面），全部 UN trigger 都按桌面 settings 走

**推荐 A**。理由：(1) Phase 4 v0.1 lean 优先；双向 sync 加 conflict resolution 复杂（user 改 iOS 端的同时改桌面端，谁 win？）(2) iOS 端 quiet hours 已 work（PushNotificationManager.isInQuietHours），改最小（3) Phase 5+ 加 settings.updateSettings 的桌面方向 sync (B) 时可平滑升级；当前 NotificationSettingsView 给 iOS 端 disable "改桌面 settings" 控件 + 加 readonly hint "桌面 settings 由桌面端管理"（与 Phase 3.4 文件 readonly UX 一致）。

### OQ-5：app 在后台时如何处理 notification.received

**A**：严格 foreground only — app 进后台 DC 自然 close，桌面端 server-push 失败，桌面端无感丢失
**B**：iOS BGProcessingTask + DC keep-alive — app 后台 5-10 min 仍能收（iOS 严格 BG limit）
**C**：APNs silent push — 完整后台投递（需服务器 + token + 证书）

**推荐 A**。理由：(1) lean Phase 4 不引服务器依赖；(2) Apple BGProcessingTask 实测 < 30s 后 OS 强 kill，复杂度高收益低 (3) 桌面端可记录"未投递队列"，用户 next 进 app 时拉 getHistory 看到（"漏看的通知" 一致体验）(4) Phase 5+ 加 APNs 真远程 push 时再加 token registration 流；当前 Phase 4 iOS app 必须前台 + DC active 才收 push 是符合 mobile mental model 的（用户期望"挂着才收"）。

## 4. 架构

### 4.1 Module / 文件 placement

```
ios-app/
├── Modules/CoreP2P/Sources/RemoteSkills/
│   └── Notification/                              # NEW
│       ├── NotificationModels.swift               # Codable: Priority/HistoryItem/Settings/6 Response
│       ├── NotificationCommands.swift             # actor, 11 method wrapper → commandClient.invoke
│       └── NotificationEventDispatcher.swift      # subscribe commandClient.events + filter notification.received + LRU dedup + UN center trigger
├── Modules/CoreP2P/Sources/RemoteSkills/ViewModels/
│   └── RemoteNotificationsViewModel.swift         # NEW @MainActor
└── ChainlessChain/Features/RemoteOperate/Views/
    ├── RemoteOperateView.swift                    # MODIFIED: 加第 6 tab "通知"
    └── NotificationsView.swift                    # NEW (history list + filter + settings sheet)
```

**复用既有**：
- `Modules/CoreP2P/Sources/RemoteTerminal/RemoteCommandClient.swift` — invoke 池 / events 流（Phase 3 已落，零改动）
- `Modules/CoreP2P/Sources/RemoteTerminal/LRUSet.swift` — Phase 2 已落 13 LOC actor，Phase 4 dedup 直接用
- `ChainlessChain/Features/Common/Services/PushNotificationManager.swift` — 531 LOC 既有 UN center 全套，零改动；NotificationEventDispatcher 注入 instance 调 `scheduleSystemNotification`
- `ChainlessChain/Features/Settings/Views/NotificationSettingsView.swift` — 既有；Phase 4 加 "桌面端 settings" readonly section（OQ-4 决策）

### 4.2 数据流

#### 4.2.1 iOS → 桌面 (pull / mutating，11 method)

```
NotificationsView (UI tap)
  → RemoteNotificationsViewModel.getHistory()
    → NotificationCommands.getHistory(limit:50, offset:0, unreadOnly:false)
      → commandClient.invoke("notification.getHistory", params)
        → DC fast path or signaling fallback (Phase 2/3 既有)
          → 桌面 NotificationCommands.kt handler 处理
            → 返响应 {notifications: [...], total, unreadCount}
        ← .success(reqJson)
      ← Decoded NotificationHistoryResponse
    ← RemoteNotificationsViewModel.history = [...]
  ← UI 渲染
```

#### 4.2.2 桌面 → iOS (push event)

```
桌面 NotificationCommands.send() 触发
  → 桌面 mobile-bridge 经 DC 或 signaling-relay 发 envelope:
    {type:"chainlesschain:event", payload:{event:"notification.received", notificationId, title, body, priority, source, timestamp}}
  → iOS RemoteWebRTCClient.inboundMessages
    → RemoteCommandClient.handleInbound → events stream yield
      → NotificationEventDispatcher.subscribed task
        → parse envelope, filter event=="notification.received"
          → LRUSet.shouldAdmit(notificationId) — dedup
            → admit:
              → PushNotificationManager.scheduleSystemNotification(...)
                → iOS UN center 弹 banner / 锁屏 push / 进 NotificationCenter
              → @Published unreadCount += 1
              → @Published latestPush = ReceivedNotification(...)
            → reject (duplicate): silent drop
```

### 4.3 DI wiring (RemoteDependencies)

```swift
@MainActor
public final class RemoteDependencies: ObservableObject {
    // ... Phase 3 existing
    let commandClient: RemoteCommandClient
    let skillRegistry: RemoteSkillRegistry
    let offlineQueue: OfflineCommandQueue
    let offlineDrainer: OfflineQueueDrainer
    let clipboard: ClipboardCommands
    let file: FileCommands
    let screenshot: ScreenshotCommands
    let systemInfo: SystemInfoCommands
    
    // Phase 4 NEW
    let notification: NotificationCommands           // typed RPC wrapper
    let notificationDispatcher: NotificationEventDispatcher  // event subscriber + UN center trigger
    
    init(pairing: PairingDependencies) {
        // ... Phase 3 existing wiring
        
        // Phase 4 wiring
        self.notification = NotificationCommands(client: commandClient)
        self.notificationDispatcher = NotificationEventDispatcher(
            commandClient: commandClient,
            pushManager: PushNotificationManager.shared,
            uuidGen: { UUID().uuidString }
        )
        
        Task {
            await notificationDispatcher.start()
        }
    }
}
```

`PushNotificationManager.shared` 已是 singleton（既有），不需改 lifecycle。

## 5. 数据模型

### 5.1 Wire 协议（与 Android 完全一致）

镜像 Android `NotificationCommands.kt` Codable 类型，仅改 Swift naming convention：

```swift
public enum NotificationPriority: String, Codable, Sendable {
    case low, normal, high, urgent
}

public struct NotificationHistoryItem: Codable, Sendable, Identifiable, Equatable {
    public let id: String
    public let title: String
    public let body: String
    public let priority: NotificationPriority   // 默认 normal
    public let read: Bool                       // 默认 false
    public let source: String                   // "pc" or "mobile"
    public let createdAt: Int64                 // ms epoch
    public let readAt: Int64?
    public let data: [String: String]?
}

public struct NotificationSettings: Codable, Sendable, Equatable {
    public let enabled: Bool
    public let quietHoursEnabled: Bool
    public let quietHoursStart: String?         // "HH:mm"
    public let quietHoursEnd: String?
    public let soundEnabled: Bool
    public let vibrationEnabled: Bool
    public let showPreview: Bool
}

public struct NotificationSendResponse: Codable, Sendable {
    public let success: Bool
    public let notificationId: String?
    public let silenced: Bool                    // 安静时间内被静音
    public let error: String?
    public let timestamp: Int64
}

public struct NotificationHistoryResponse: Codable, Sendable {
    public let success: Bool
    public let notifications: [NotificationHistoryItem]
    public let total: Int
    public let unreadCount: Int
}

// + NotificationPushResponse / BroadcastResponse / MarkResponse / DeleteResponse / ClearResponse / UnreadCountResponse / SettingsUpdateResponse
//   全部按 Android 1:1 mirror（每个 ~5-7 字段，static codable）
```

### 5.2 iOS 端独有：ReceivedNotification

这是 NotificationEventDispatcher 内部的 SwiftUI-friendly 包装：

```swift
public struct ReceivedNotification: Identifiable, Sendable, Equatable {
    public let id: String                        // notificationId
    public let title: String
    public let body: String
    public let priority: NotificationPriority
    public let source: String                    // "pc" / "mobile"
    public let receivedAt: Date
    public let data: [String: String]?
}
```

`@Published var latestPush: ReceivedNotification?` 让 `RemoteOperateView` 能反应最新 push 显示 banner（视觉确认 push 已收到，避免 user 怀疑 silent drop）。

### 5.3 LRU dedup key

```swift
// In NotificationEventDispatcher
private let seenNotificationIds = LRUSet<String>(capacity: 256)
```

key = notificationId（Android 端服务器生成 UUID），相同 id 30s 内重复（DC + signaling 双发）silent drop。

## 6. Sub-phase 分解

按 Phase 3 6-sub-phase pattern。每 sub-phase 含 (1) impl scope (2) 单测 target (3) 验收 standard。

### 6.1 Phase 4.1 — Models + NotificationCommands actor

**Scope**：
- `NotificationModels.swift` — 全套 Codable struct/enum（~120 LOC）
- `NotificationCommands.swift` actor — 11 method wrapper（~160 LOC，每 method ~12 LOC）

**单测 target**：≥ 11 unit tests（每 method 至少 1 success path）+ ≥ 4 error paths（4xx / timeout / decode fail / DC unavailable）

**验收**：`swift test --filter NotificationCommandsTests` 全过；envelope hex dump 与 Android `NotificationCommandsTest.kt` 字节对齐（method 名 + params keys）。

### 6.2 Phase 4.2 — NotificationEventDispatcher

**Scope**：
- `NotificationEventDispatcher.swift` Sendable class — subscribe `commandClient.events` + parse envelope + filter `notification.received` + LRU dedup + 调用 `PushNotificationManager.scheduleSystemNotification`（~180 LOC）
- inject PushNotificationManager (既有 singleton) + uuidGen 用于 internal logging
- @Published `latestPush: ReceivedNotification?` + `unreadCount: Int`（让 SwiftUI 订阅）

**单测 target**：≥ 8
- happy path: event raw → schedule called once
- LRU dedup: 同 id 第二次 silent drop
- 非 notification.received event: silent drop
- malformed envelope: silent drop（不 crash，不影响其它 dispatcher）
- PushManager 抛错: caught + log，不传播
- start/stop idempotent
- @Published latestPush 改触发 SwiftUI（XCTKVOExpectation）
- unreadCount 增量正确

**验收**：mock commandClient.events 喂 5 条 event（含 1 重复 / 1 malformed / 3 happy）→ verify PushManager 调 3 次 + unreadCount 已加 3 + latestPush 是最新一条。

### 6.3 Phase 4.3 — RemoteNotificationsViewModel + history list

**Scope**：
- `RemoteNotificationsViewModel.swift` @MainActor ObservableObject（~200 LOC）
  - inject NotificationCommands + NotificationEventDispatcher + currentDIDProvider
  - @Published `history: [NotificationHistoryItem]` + `unreadCount: Int` + `lastError: String?` + `isLoading: Bool`
  - methods: `loadHistory(unreadOnly: Bool)` / `markAsRead(id:)` / `markAllAsRead()` / `delete(id:)` / `clearAll()`  / `refresh()`
  - 订阅 dispatcher.unreadCount → mirror 到自己 @Published（让 View 订阅 VM 一处）
- 离线时 markAsRead/delete/clearAll 这些 mutating 调用走 OfflineCommandQueue（dispatch 时检查 dataChannelReady，false 时 enqueue + UI 显示 "已加入离线队列"）

**单测 target**：≥ 8
- loadHistory happy path → history 填充
- loadHistory unreadOnly = true 过滤
- markAsRead 成功 → 本地 history item.read = true（local update + 桌面持久化双轨）
- markAllAsRead → 全部本地更新
- delete → 本地 remove
- DC 不通时 markAsRead 走 enqueue → queue.totalCount 增
- error → lastError 设置
- isLoading 状态机

**验收**：mock NotificationCommands → driver 跑 6 个 user action sequence (load → markRead → markAll → delete → clearAll → refresh)，verify 每步 @Published 状态对齐。

### 6.4 Phase 4.4 — NotificationsView UI

**Scope**：
- `NotificationsView.swift`（~250 LOC）
  - 顶部 segmented "全部 / 未读" filter
  - List(.insetGrouped) of NotificationHistoryItem rows（icon by source + title + body + priority chip + relative time）
  - swipe action: 标已读 / 删除
  - 空状态: "暂无通知 — 桌面 push 会出现在这里"
  - 顶部右 toolbar: "全部已读" + "清空" + "设置"
  - 点击 row → sheet 显完整内容（priority + body wrap + data dict）
  - pull-to-refresh
  - 设置 sheet → 复用既有 `NotificationSettingsView` + 加 "桌面同步" section（readonly per OQ-4）

**镜像 Android**：`NotificationCenterScreen.kt`（v5.0.3.x 社交收口里产线化的那个 14 屏之一），具体布局 1:1。HIG 偏离白名单：(a) Compose ModalBottomSheet → SwiftUI .sheet (b) Compose LazyColumn → SwiftUI List (c) Compose Pull-to-refresh → SwiftUI .refreshable。

**单测 target**：≥ 5
- 空状态渲染
- list 渲染 ≥ 1 item + 全字段 visible
- filter "未读" 切换 → list 过滤
- swipe markAsRead → VM.markAsRead 调
- toolbar "全部已读" → VM.markAllAsRead 调

### 6.5 Phase 4.5 — RemoteOperateView 集成第 6 tab

**Scope**：
- `RemoteOperateView.swift` modify — segmented control 加 "通知" 项（icon: bell.badge）
- 第 6 tab body 包 NavigationView { NotificationsView() }
- segmented control item 显未读 badge：`Text("\(unread)")` overlay 红色（`.badge(unread)` iOS 15+）— 注意 segmented control 本身无原生 badge，需自定义 overlay 或换为 horizontal scroll TabView
- iOS app icon badge 同步：`PushNotificationManager.shared.setBadge(unread)` 在 dispatcher unreadCount 改时调

**单测 target**：≥ 3 UI test
- 6 tab segmented 全 visible
- tap "通知" tab → NotificationsView appear
- unreadCount > 0 时 badge visible

### 6.6 Phase 4.6 — DI wiring + memory + commit + status banner

**Scope**：
- `RemoteDependencies.swift` modify — wire NotificationCommands + Dispatcher（如 §4.3）
- `PairingDependencies.swift` no change（既有）
- 既有 `NotificationSettingsView.swift` 加 "桌面端 settings" 只读 section（拉桌面 getSettings 显示）
- memory `~/.claude/.../memory/ios_remote_notification_phase4.md` — 4-5 trap 实施时记录（forward-looking 在 §7）
- design doc Status banner 改 "Phase 4.1-4.5 落地（Phase 4.6 commit 标记）"
- CLAUDE.local.md Recently Completed 加 Phase 4 entry
- commit `feat(mobile): iOS Phase 4 — Notification skill (11 method + UN center push 触发)`

**验收**：double-remote push 一次过；CLAUDE.local.md 增加 Phase 4 entry + Pending 加 Phase 4.7 真机 E2E。

## 7. 实施 Traps（forward-looking）

实施前梳理 9 个潜在坑（按 §7 pattern 与 Phase 3）：

### 7.1 PushNotificationManager.scheduleSystemNotification 没有 `notification.received` 用法

**Why**：既有 PushManager 的 schedule 方法（scheduleMessageNotification / scheduleConnectionRequestNotification / scheduleSystemNotification）都是为 chat / pairing / system 而设计的，**没有专门给 Remote notification 用的 schedule API**。

**Risk**：直接调 scheduleSystemNotification 可能与既有 categoryIdentifier / threadIdentifier 冲突。

**Fix**：Phase 4.2 实施时在 PushManager 加一个 method `scheduleRemoteNotification(notificationId: String, title: String, body: String, priority: NotificationPriority)`（~30 LOC），用独立的 categoryIdentifier `REMOTE_NOTIFICATION` 避免与既有冲突，threadIdentifier = "remote.<source>"（pc 通知统一一组）。

### 7.2 quiet hours 双重判断

**Why**：iOS 端 PushManager.isInQuietHours() 已存在；桌面端 NotificationCommands.send 也有 respectQuietHours 参数 + 桌面 silenced flag。

**Risk**：双方都判一次，可能导致 (a) iOS 已 silence 但桌面还 schedule (b) 桌面已 silence 但 iOS 又判一遍 (c) 两边时区不同 quietHoursStart 解析不一致

**Fix**：iOS dispatcher 收 envelope 时 **trust 桌面 silenced flag**——桌面已判过 quiet hours，iOS 不再判；唯一例外：iOS 端用户改了 settings.enabled = false，本地 disable，dispatcher 收 envelope 仍 silent drop（不调 PushManager）。这个判断在 dispatcher 内做，不进 PushManager（保持 PushManager 不改 internal logic）。

### 7.3 LRU dedup key 选 notificationId 还是 (notificationId, timestamp)

**Why**：Android 端用 notificationId 作 key（服务器 UUID 唯一）。但若 iOS 收到同 id 30s 后才被重发（极端慢的网络），第二次会被 LRU drop —— 用户可能预期看到一个新 banner 提醒。

**Risk**：边缘情况误 drop 第 2 次重发的"提醒类"通知。

**Fix**：用 notificationId only。30s TTL 已是合理上限：(a) DC + signaling 双发的间隔通常 < 2s，30s 足够 cover (b) 真"30s 后桌面再次 push 同 id" 是桌面端 bug 不是网络问题（合法的"提醒"应该用新 id）(c) 与 Android 完全一致简化 cross-platform debug。

### 7.4 settings 双向同步的 race

**Why**：OQ-4 推荐 A — iOS 端 settings 只影响 iOS 本地；但 NotificationSettingsView 既有 UI 已支持改全部 settings 并保存到 PushNotificationManager.saveSettings()。

**Risk**：iOS 用户改 settings 期望"桌面也同步"，结果只改了 iOS 端；混乱。

**Fix**：NotificationSettingsView 加 disclosure：
- Section "iOS 端通知"（既有控件，仅影响 iOS UN center）
- Section "桌面端通知"（新加，readonly，"由桌面端管理 - 在桌面 V6 设置同步" + button "刷新桌面 settings"）
- 同时 dispatcher 启动时自动调一次 getSettings 缓存桌面 settings 到 RemoteNotificationsViewModel

### 7.5 iOS app 后台时 commandClient 状态

**Why**：iOS app 进后台后，DC 会 timeout close（依赖系统 BG limits）。dispatcher 后台仍订阅 events 但 stream 实际无新数据。app 回前台时 dispatcher 自动收新事件吗？

**Risk**：后台→前台切换时 dispatcher 状态错乱：(a) old subscription task 还在但 stream stale (b) 新建 commandClient 重订需要 dispatcher 重新 wire

**Fix**：dispatcher.start() 是 idempotent；DI container 初始化时调一次 start，不再 stop（除非 logout）。RemoteCommandClient 在 DC 重建时**复用同一 events stream**（events 是 actor 内部的 nonisolated let，DC 重建不影响 stream lifetime）。即"新 inbound 来时自然 yield，无 new 时 task 继续 await，前后台切换无副作用"。Phase 4.2 单测加 1 个 case 验：`stream` continuation 跨 DC 重建仍 alive。

### 7.6 历史 list pagination

**Why**：Android getHistory 支持 limit + offset。iOS 端默认 limit = 50；用户向下滑想看更多，需 pagination 或 "加载更多" 按钮。

**Risk**：设计不清 → user 看不到 50 条之外的；UX 模糊。

**Fix**：v0.1 仅 limit = 50 + 不分页，列表底显 "显示前 50 条"（与桌面 history 不同步显示无奈接受）。pagination 留 v0.2。

### 7.7 删除时本地 + 桌面双删的 atomicity

**Why**：用户 swipe delete → VM 调 NotificationCommands.delete → 桌面端确认成功 → VM 本地 history.remove。中间桌面端失败时本地不能删。

**Risk**：桌面 delete 成功但响应丢失 → 本地仍显示已删除 item（用户下次进 tab 看到"诡异恢复"）。

**Fix**：delete 失败 → 不本地 remove + 显示 toast "删除失败，桌面端可能已删除，下次刷新"。next refresh 时 getHistory 拉到正确状态。**接受 eventual consistency**——v0.2 加 retry queue。

### 7.8 PushNotificationManager.requestAuthorization 时机

**Why**：iOS HIG 要求"在 user 真正用到通知之前才弹 authorization prompt"。用户首次打开 app 不弹（避免 dismissed forever）。

**Risk**：dispatcher 收第一条 event 时如果还没 authorization，scheduleSystemNotification 静默失败（无 UN banner）。

**Fix**：(a) iOS 进 NotificationsView 第一次时 onAppear 调 PushManager.requestAuthorization（按 HIG 在 context 内 prompt）(b) dispatcher start 时同步调 checkAuthorizationStatus 缓存到 @Published authorizationStatus（PushManager 已有这个 method）(c) RemoteOperateView 第 6 tab 入口若 authorizationStatus == .denied 显示"通知权限被拒，请到设置开启"小 banner（不阻塞功能，降级为 in-app banner only）

### 7.9 segmented control 第 6 tab 视觉拥挤 + badge 实现

**Why**：iOS HIG SegmentedPicker 5 个 segment 已是上限（视觉舒适度），6 个会变窄不易点；segmented control 没有原生 badge（与 TabBar 不同）。

**Risk**：第 6 tab 太窄难点 + 未读 badge 无处放。

**Fix**：考虑两个备选：
- 备选 A：保持 segmented，"通知" tab 用 icon-only `bell.badge`（iOS SF Symbol 自带 badge dot 视觉），unreadCount > 0 时切到 `bell.badge.fill`；具体未读数显示在 NotificationsView 内顶部
- 备选 B：换为 horizontal ScrollView + button row，每个 button 独立宽度 + 自定义 badge overlay；保留弹性增加 tab
- 推荐 B（与 Plan A.1 Discord/Slack 移动端类似 pattern）；实施 4.5 时 prototype 两版给用户看

## 8. 测试策略

### 8.1 单元测试目标 ≥ 35

| 文件 | tests | 覆盖 |
|------|-------|------|
| `NotificationCommandsTests.swift` | 11 | 11 method × 1 happy + 4 error path |
| `NotificationEventDispatcherTests.swift` | 8 | LRU dedup / malformed envelope / PushManager 抛错 / start-stop idempotent / @Published / unreadCount 增量 / 跨 DC 重建 stream alive / authorization denied |
| `RemoteNotificationsViewModelTests.swift` | 8 | history load / unreadOnly filter / markAsRead / markAllAsRead / delete / DC 离线 enqueue / error / isLoading |
| `NotificationsViewTests.swift` | 5 | UI test (空 / list / filter / swipe / toolbar action) |
| `NotificationModelsTests.swift` | 4 | Codable round-trip × 4 主要 type |

iOS Phase 4 单测累计 ≥ 36 → 总 iOS 单测 ~272 + 36 = ~308

### 8.2 集成测试 ≥ 2（在既有 Phase3IntegrationTests.swift 加）

- **Phase 4 NotificationCommands + offline queue + drainer**：DC false → markAsRead 入队 → DC true → drainer 自动 drain → mock 桌面端响应 → queue 清空
- **NotificationEventDispatcher + PushManager 集成**：mock commandClient.events 喂 3 envelopes（1 重复 + 1 malformed + 1 valid）→ verify PushManager.scheduleSystemNotification 调 1 次 + unreadCount = 1

### 8.3 真机 E2E (Phase 4.7，Mac+iPhone+真桌面)

| # | 场景 | 通过标准 |
|---|------|----------|
| 1 | iPhone 进通知 tab → 拉历史 | ≤ 500ms 显示历史；空时显空状态 |
| 2 | 桌面发本地通知（cc cli "echo via notification.send"） | iPhone 锁屏弹 banner ≤ 2s + tab badge "+1" + app icon badge |
| 3 | iPhone 在前台时桌面 push 3 条 | 都收到 + 顺序对 + LRU dedup（桌面端 DC 双发模拟时不重复 banner） |
| 4 | iPhone swipe markAsRead → 桌面 history 真已读 | 桌面端 cc 查 verify markedCount = 1 |
| 5 | iPhone 离线 swipe markAsRead → 网络恢复 → 桌面真已读 | OfflineQueue.totalCount=1 → 恢复 → drain → 桌面 verify |
| 6 | quiet hours 内桌面 push（`silenced: true`） | iPhone 收 envelope 但**不**弹 banner（仅入历史） |
| 7 | iPhone authorization denied → 桌面 push | 不崩；in-app banner 显示 "通知权限被拒"；历史 tab 仍正常显示 |
| 8 | iPhone app 后台 → 桌面 push 3 条 → 1 min 后回前台 | 回前台后历史 refresh 看到 3 条（全 unread）；不弹 banner（已过时机） |

## 9. 工作量 & 时序估算

| Sub-phase | impl 工作量 | 单测 |
|-----------|-----------|------|
| 4.1 Models + Commands | ~2-3h（11 method 1:1 mirror） | 11 |
| 4.2 EventDispatcher | ~3-4h（含 LRU + PushManager wire + dedup） | 8 |
| 4.3 ViewModel | ~2-3h | 8 |
| 4.4 NotificationsView UI | ~3-4h（mirror Android NotificationCenter + sheet + settings sheet） | 5 + 4 (model) |
| 4.5 RemoteOperateView 集成 + segmented 改造 | ~1-2h | 3 |
| 4.6 DI + commit + memory + status banner | ~1h | — |
| **总** | **~12-17h ≈ 1.5-2 天** | **39** |

**真机 E2E (Phase 4.7)**：~30 min（8 场景 quick run）

## 10. 风险 & 缓解

| 风险 | 概率 | 影响 | 缓解 |
|------|-----|------|------|
| PushNotificationManager 既有 schedule API 与 Remote notification 类目冲突 | 中 | 中 | §7.1 加新 schedule method 独立 categoryIdentifier |
| LRU dedup 误 drop 合法重发 | 低 | 低 | §7.3 接受；与 Android 一致 |
| segmented control 6 tab 视觉拥挤 | 高 | 低 | §7.9 备选 B horizontal scroll + custom badge |
| iOS quiet hours 与桌面冲突 | 中 | 低 | §7.2 信任桌面 silenced flag + iOS 端单独 enabled |
| DC 后台 close → events 流 stale | 高 | 低 | §7.5 dispatcher idempotent + events stream 复用 |
| 用户 dismissed authorization prompt | 中 | 中 | §7.8 在 NotificationsView onAppear context-prompt |
| 历史超 50 条无 pagination | 低 | 低 | §6.6 Phase 4 v0.1 接受；v0.2 加 |

## 11. 决定 / 锁结论 (待用户)

实施前用户需要 lock 5 OQs（§3）。当前推荐：A / B / B / A / A。

实施 GO/NO-GO 条件：
- ✅ Phase 3 框架已 land (`759a1e907`)
- ✅ PushNotificationManager 已存在（531 LOC，零改动只加 1 method）
- ⚠️ Phase 3 真机 E2E 未跑——独立于 Phase 4 design 但若 Phase 3 暴露 framework bug（如 RemoteCommandClient pool 异常）会回锅改 base，Phase 4 设计需返工。**建议 Phase 3.7 完成后再起 Phase 4.1 sub-phase impl**；本设计 doc 可不依赖完成。

## 12. 后续 Phase 5+ 候选

Phase 5 候选（按用户价值 / scope 排）：

1. **AI subset (chat 仅)** — 6-8 method（chat.send/list/history/cancel）~1 天 — 最高用户价值
2. **Knowledge subset (search/list/read 仅)** — ~10 method ~1 天 — RAG 笔记查询
3. **APNs 真远程 push** — Phase 4 v0.2 — 需服务器 + 证书；用户后台收通知
4. **Settings 双向 sync** — Phase 4 v0.2 — iOS 改 settings 同步桌面
5. **Notification rich content** — UNNotificationContentExtension + image/action — Phase 4 v0.2

具体 Phase 5 选哪个，等 Phase 4 落地后再 ask。
