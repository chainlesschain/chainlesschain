# iOS Phase 2 — 远程桌面终端 (Plan A.1 移植)

> **状态**：Phase 2.1-2.5 落地（Phase 2.6 commit 标记，2026-05-15）— RemoteWebRTCClient + TerminalRpcClient + xterm.js WKWebView + TerminalListView/SessionView 全套 + DI wiring；**163 unit tests across 12 suites**。**未跑**：Phase 2.7 真机 E2E (Mac+iPhone 在场再做，§8.3 含 4 场景 reproducer)。
>
> **依赖**：iOS Phase 1.1-1.6 已落 (`c30b415a8` + `92cee3406` + `a411b1887`，含桌面端 follow-up)；PairedDesktopsStore 已持久化 ICE servers + pcPeerId
> **对齐版本**：Android Plan A.1 全套 (commits `aee5f1d8f` / `d22b7ac8a` / `bb759bc78` / `a01eeac47` / `91e77e489` / `dd9b1227e` / `fc3752360`，2026-05-14 一日落地，已 Xiaomi 24115RA8EC 真机 E2E 验证)
> **关联文档**：`docs/design/Android_Remote_Terminal_Plan_A1.md`、`docs/design/iOS_Phase_1_Pairing_Flow_B.md`、memory `android_webview_xterm_resize_observer.md` / `ios_qr_pairing_three_flows.md` / `ios_remote_terminal_phase2.md`（Phase 2 实施 9 trap）

---

## 1. 背景

iOS 端 Phase 1 把桌面配对三流落齐了；Phase 2 在配对建立的基础上加 **远程桌面终端**：iPhone 用 xterm.js 终端 UI 直接控制桌面 shell，命令输入 + stdout 输出走 WebRTC DataChannel 直连（绕开 4 跳信令链路）。

Android 端 Plan A.1 已经把这条链跑通（DC-first + signaling fallback + Trap 1 修 + LRU dedup），**真机 E2E 锁定**。iOS 现在追平，是一个**纯协议移植**任务——wire format、状态机、UI 布局、降级策略全部沿用 Android 已验证的版本。

### 1.1 为什么是 DataChannel 不是信令

Android Plan A 真机 E2E 暴露 1 个**架构性**问题（详见 Android Plan A.1 §1.1）：信令路径 = `手机 → 路由器 NAT → 中继 → 桌面 RelayClient → mobile-bridge`，4 跳链路，任一跳都可能：
- NAT idle timeout 杀 TCP（蜂窝运营商常 30s-2min）
- 中继 nginx proxy_read_timeout
- TURN 过载排队

stdout 流式输出（如 `watch -n 0.5 date`）30 分钟内必断。Plan A.1 用 WebRTC DataChannel 直连：**1 跳，0 中间节点**。

**性能预期**（Android 实测，iOS 应一致）：

| 指标 | 信令路径 | DC 直连 |
|---|---|---|
| 端到端 RTT p50 | 200-500ms | 30-80ms (LAN) / 50-200ms (TURN relay) |
| RTT p99 | 1500-30000ms (timeout 频发) | 200-800ms |
| 持续连接 | 20s-2min 间歇断 | 数小时持续 |
| stdout 吞吐 | ~100KB/s | ~1MB/s |

### 1.2 iOS 已就位 vs 需新建

✅ **已就位**（Phase 1 落地）：
- `Modules/CoreP2P/Sources/Signaling/` — `WebSocketSignalClient`、`SignalingConfig`、`PairingSignalingGate`（提供 `sendForwardedMessage` 兜底路径）
- `Modules/CoreP2P/Sources/Pairing/PairedDesktopsStore` — 含 `pcPeerId` + `iceServersJson`（24h TURN 凭证）+ `iceExpiry`
- `Features/Social/Services/WebRTCManager.swift` — Google WebRTC SDK 已 wired，但仅服务 P2P 聊天，**Phase 2 新建独立 client 不复用**（用户决策 Q2）
- `Package.swift` 已声明 `WebRTC` (stasel/WebRTC 120.0.0)
- `Tests/CoreP2PTests/` 71 tests（含 SignalClient + actor + Codable round-trip 模板）

❌ **缺**：
- WebRTC `RTCPeerConnection` + `RTCDataChannel` lifecycle management 包装（terminal-specific）
- DC handshake 触发（Offer/Answer/ICE 交换走 Phase 1 signaling）
- `TerminalRpcClient` — JSON envelope RPC over DC + signaling fallback
- xterm.js WebView 终端 UI（WKWebView + bundled HTML/JS）
- `TerminalListView/SessionView` SwiftUI 屏 + ViewModel
- DC vs signaling 双路监听 + LRU dedup
- iOS 端 `Plan A1 feature flags`（preferDataChannel / dcSendTimeout / fallbackOnDcFailure）

## 2. 目标 & 非目标

### 目标 (Phase 2 in scope)

| # | 项 | 验收 |
|---|---|---|
| G1 | iPhone 用 xterm.js 终端 UI 创建/输入/输出/关闭 desktop shell session | 真机 E2E：iPhone 进 TerminalSessionView → 桌面 PtyManager 创建 session → 用户敲命令 → 输出 stream 显示 |
| G2 | DC 直连路径优先，命令 RTT < 200ms (LAN) / < 500ms (TURN) | adb tcpdump / iOS Console 抓包确认稳态走 DC（`path=dc` telemetry log）；fast-path 占比 > 80% |
| G3 | DC 不通时自动 fallback signaling，UI 显式标识 | 故意 disable WebRTC UDP → 期望 fallback ≤ 3s + UI chip 转 "中继路径" |
| G4 | DC 恢复后自动切回，UI 同步 | 重新启用 UDP → 下一 invoke 自动 DC + chip 转 "P2P 直连" |
| G5 | xterm.js 终端 ResizeObserver + WKWebView 布局正确（不掉到 0×0 的 Android 经典 trap） | iPhone 横竖屏切换 + 软键盘弹起回收都正确 reflow，stdout 不堵在第一行 |
| G6 | 持续 30 分钟 stdout 流式（`watch -n 0.5 date`）无中断 | 真机定时跑 30min，session log 无断流 |
| G7 | LRU dedup：同 (sessionId, seq) 不双 emit | 双路监听器 mock 测试 + 真机抓重复 stdout 验 0 重 |

### 非目标 (defer 到 Phase 3+)

- **远程操控 framework**（RemoteSkillRegistry / OfflineCommandQueue / commands envelope 通用化）→ Phase 3 单独 design doc
- **远程屏幕（截图/OCR/SendInput）** → Plan B 范畴，未来
- **多 session 并发**：Plan A.1 v0.1 单 session at a time（与 Android 当前一致），多 session 留 v0.2
- **session 持久化**：杀 app → session 释放（与 Android 一致；桌面 PtyManager 自带 30min idle GC）
- **DC 双发**：Android v0.1 单发，iOS 一致，留 v0.2 hardening
- **iOS keyboard 高级 IME 支持**（中文输入候选词）：xterm.js 自带 IME composition 处理足够，不做额外深度集成

## 3. 架构

### 3.1 三层数据流

```
┌──────── iOS App ──────────┐         ┌────────── Desktop ─────────┐
│                            │   DC    │                              │
│  TerminalSessionView       │ ◄────► │  mobile-bridge.js           │
│    └─ WKWebView (xterm.js) │ direct │    └─ handleMobileCommand   │
│                            │  1 hop │       └─ PtyManager         │
│  TerminalSessionViewModel  │         │          (node-pty / conpty)│
│    └─ TerminalRpcClient    │  ─────  │                              │
│         ├─ RemoteWebRTC ───┤  fallb  │  signaling-server (relay)   │
│         │   Client (DC)    │  signal │                              │
│         └─ SignalingGate ──┤  4 hop  │                              │
│             (Phase 1 reuse)│         │                              │
│                            │         │                              │
│  Phase 1 落地的：           │         │                              │
│  - SignalClient            │         │                              │
│  - PairedDesktopsStore     │         │                              │
│    (含 iceServersJson)     │         │                              │
└────────────────────────────┘         └──────────────────────────────┘
```

### 3.2 wire 协议（与 Android 1:1，禁止改）

**命令 envelope**（iOS → Desktop，DC 或 signaling 都用同样 shape）：
```json
{
  "type": "chainlesschain:command:request",
  "payload": {
    "id": "<uuid>",
    "method": "terminal.create | list | stdin | resize | close | history",
    "params": { ... },
    "auth": { "mobileDid": "did:cc:..." }
  }
}
```

**响应 envelope**（Desktop → iOS）：
```json
{
  "type": "chainlesschain:command:response",
  "payload": {
    "id": "<matching uuid>",
    "result": { ... } | "error": "..."
  }
}
```

**Push 事件**（Desktop → iOS，stdout / exit）：
```json
{
  "type": "chainlesschain:event",
  "payload": {
    "event": "terminal.stdout | terminal.exit",
    "sessionId": "<uuid>",
    "data": "<utf-8 string>",   // stdout
    "seq": <monotonic int>,     // stdout
    "exitCode": <int> | null,    // exit
    "signal": "<string>" | null  // exit
  }
}
```

**method 列表**（与桌面 `handleTerminalCommand` 对齐）：
- `terminal.create` `{shell, cwd?, env?}` → `{sessionId, pid, shell, createdAt}`
- `terminal.list` `{}` → `{sessions: [{id, shell, cwd, alive, lastSeq}]}`
- `terminal.stdin` `{sessionId, data}` → `{ok}`
- `terminal.resize` `{sessionId, cols, rows}` → `{ok}`
- `terminal.close` `{sessionId}` → `{ok}`
- `terminal.history` `{sessionId, fromSeq?}` → `{chunks: [{seq, data}], truncated}`

## 4. 模块拆分

### 4.1 新建 `Modules/CoreP2P/Sources/RemoteTerminal/` (CoreP2P 内子目录)

```
Modules/CoreP2P/Sources/
├── RemoteTerminal/
│   ├── RemoteWebRTCClient.swift        // actor，WebRTC DataChannel 包装
│   ├── DataChannelDelegate.swift       // RTCDataChannelDelegate Swift 友好桥接
│   ├── RemoteWebRTCConfig.swift        // ICE servers + 配置
│   ├── TerminalRpcClient.swift         // RPC over DC + signaling fallback
│   ├── TerminalRpcEnvelope.swift       // Codable 协议帧
│   ├── TerminalSessionState.swift      // session/stdout/exit data 模型
│   ├── PlanA1FeatureFlags.swift        // UserDefaults 读取
│   └── DcStateBus.swift                // dataChannelReady AsyncStream/StateFlow 等价
└── (Phase 1 既有 Pairing/ + Signaling/ + DeviceInfo/)
```

**Why `RemoteTerminal/` 在 CoreP2P 而非新模块**：
- 复用 Phase 1 `SignalClient`、`SignalingConfig`、`PairedDesktopsStore` 无 import 跨模块
- 测试可走 SwiftPM `Tests/CoreP2PTests/`
- 与 Pairing 共享 `PairingSignalingGate` 抽象（terminal RPC fallback 走信令时复用 `sendForwardedMessage`）

### 4.2 新建 `ChainlessChain/Features/RemoteTerminal/`

```
Features/RemoteTerminal/
├── Views/
│   ├── TerminalListView.swift          // 已有 sessions 列表 + 创建按钮
│   ├── TerminalSessionView.swift       // 单 session 屏，WKWebView 主舞台
│   ├── TerminalWebView.swift           // UIViewRepresentable 包 WKWebView
│   ├── DcStatusChipView.swift          // 顶部 "P2P 直连 / 中继" 标识
│   └── EmptyTerminalListView.swift     // 占位空态
├── ViewModels/
│   ├── TerminalListViewModel.swift     // (实际放 CoreP2P 见 §4.4)
│   └── TerminalSessionViewModel.swift  // (实际放 CoreP2P)
├── Bundle/                              // 静态资源
│   ├── xterm-shell.html                // 主 HTML（与 Android assets/terminal/ 同源）
│   ├── xterm.js                        // xterm v5 main bundle
│   ├── xterm-addon-fit.js              // FitAddon
│   └── xterm.css
└── JSBridge/
    ├── TerminalBridge.swift            // WKScriptMessageHandler，JS↔Swift 桥
    └── TerminalBridgeMessage.swift     // Codable 桥消息类型
```

### 4.3 RemoteTerminal Module 入口扩展 `PairingDependencies` → `RemoteDependencies`

Phase 1 的 `PairingDependencies` 只含 pairing 相关字段。Phase 2 新建 `RemoteDependencies`：

```swift
public final class RemoteDependencies: ObservableObject {
    public let webRTCClient: RemoteWebRTCClient
    public let terminalRpc: TerminalRpcClient
    public let pairingDeps: PairingDependencies  // 注入引用
    public let featureFlags: PlanA1FeatureFlags

    public init(pairingDeps: PairingDependencies) {
        self.pairingDeps = pairingDeps
        self.featureFlags = PlanA1FeatureFlags()
        self.webRTCClient = RemoteWebRTCClient(
            signalingGate: pairingDeps.signalingGate,
            messageBus: pairingDeps.messageBus,
            iceServersProvider: { [weak pairingDeps] pcPeerId in
                await pairingDeps?.pairedDesktopsStore.devices()
                    .first(where: { $0.pcPeerId == pcPeerId })?.iceServersJson
            }
        )
        self.terminalRpc = TerminalRpcClient(
            webRTCClient: self.webRTCClient,
            signalingGate: pairingDeps.signalingGate,
            featureFlags: self.featureFlags
        )
    }
}
```

`ChainlessChainApp` 顶层加一个 `@StateObject var remoteDeps = RemoteDependencies(pairingDeps: pairingDeps)`，与 `pairingDeps` 一起 environmentObject 透传。

### 4.4 ViewModel 落点（沿用 Phase 1 的 SwiftPM testability 约束）

`TerminalListViewModel` + `TerminalSessionViewModel` 必须放 **Modules/CoreP2P/Sources/RemoteTerminal/ViewModels/** 才能 SwiftPM 单测（同 `feedback_ios_ui_mirrors_validated_android.md` Trap 2 — Phase 1 反复印证）。Features/RemoteTerminal/ViewModels/ 占位/再 export。

## 5. 关键组件设计

### 5.1 `RemoteWebRTCClient` (CoreP2P/RemoteTerminal/)

```swift
public actor RemoteWebRTCClient {
    public enum State: Sendable, Equatable {
        case disconnected
        case signalingConnected
        case registered
        case creatingOffer
        case waitingAnswer
        case iceConnecting
        case dataChannelOpen   // DC 物理 open，ICE/PC 已 connected
        case ready             // DataChannelOpen 且双方握手完，可 send
        case failed(reason: String)
    }

    public var state: AsyncStream<State> { ... }
    public var dataChannelReady: AsyncStream<Bool> { ... }  // state == .ready 派生
    public var inboundMessages: AsyncStream<String> { ... }  // DC 入站 + signaling 入站统一入口

    /// 5 步 handshake：signaling connect → register → createPC + createDC →
    /// createOffer → waitForAnswer。与 Android `WebRTCClient.connect()` 1:1 对齐。
    public func connect(pcPeerId: String, localPeerId: String) async throws

    /// DC.send(envelope) — 非 .ready 时 throw RemoteWebRTCError.dataChannelNotOpen
    public func sendMessage(_ text: String) async throws

    public func disconnect() async
}

public enum RemoteWebRTCError: Error, Sendable {
    case dataChannelNotOpen
    case offerFailed(String)
    case answerTimeout
    case iceFailed
}
```

**关键不变量（继承 Phase 1 Plan A.1 echo-loop 防御）**：
- `localPeerId` 在 `connect()` 入参传入，**不暴露 setter**
- 所有 ICE candidate / offer / answer 经 `signalingGate.sendForwardedMessage` 时 `to: pcPeerId`，**禁止改写 Phase 1 SignalClient 的 currentPeerId**

**Why actor + AsyncStream**：
- DC 状态变更来自 `RTCDataChannelDelegate.dataChannelDidChangeState(_:)` 在任意线程；actor 串行化避免 race
- AsyncStream 单消费者足够（UI 一个 ViewModel 订阅）；多消费者场景用 Combine `CurrentValueSubject` + `.share()`（同 Phase 1 PairedDesktopsStore 模式）

### 5.2 `TerminalRpcClient` (CoreP2P/RemoteTerminal/)

```swift
public actor TerminalRpcClient {
    private let webRTCClient: RemoteWebRTCClient
    private let signalingGate: PairingSignalingGate
    private let featureFlags: PlanA1FeatureFlags

    private var pendingResponses: [String: CheckedContinuation<JSONObject, Error>] = [:]
    private var seenStdoutKeys: LRUSet<String> = LRUSet(capacity: 256)
    private var seenExitKeys: LRUSet<String> = LRUSet(capacity: 64)

    private var inboundTask: Task<Void, Never>?

    public var stdoutEvents: AsyncStream<StdoutEvent> { ... }
    public var exitEvents: AsyncStream<ExitEvent> { ... }

    public func start() async {
        // 双路监听：webRTCClient.inboundMessages（DC + signaling 统一入口）
        inboundTask = Task { [weak self] in
            for await raw in await self?.webRTCClient.inboundMessages ?? AsyncStream { _ in } {
                await self?.handleInbound(raw)
            }
        }
    }

    /// 命令调用 — DC ready 时优先走 DC，失败 fallback signaling。
    public func invoke(pcPeerId: String, method: String, params: [String: Any]) async throws -> JSONObject {
        let envelope = buildEnvelope(method: method, params: params)
        let reqId = envelope["payload"]["id"] as String

        let dcReady = (await webRTCClient.state.last) == .ready
            && featureFlags.preferDataChannel

        if dcReady {
            do {
                return try await sendViaDc(envelope: envelope, reqId: reqId, timeoutMs: featureFlags.dcSendTimeoutMs)
            } catch {
                if !featureFlags.fallbackOnDcFailure { throw error }
                // logged "[TerminalRpc] DC fail, fallback signaling: \(error)"
            }
        }
        // signaling fallback — 复用 Phase 1 sendForwardedMessage
        return try await sendViaSignaling(pcPeerId: pcPeerId, envelope: envelope, reqId: reqId)
    }

    /// Convenience wrappers — 与 Android TerminalRpcClient 1:1。
    public func create(pcPeerId: String, shell: String) async throws -> CreatedSession { ... }
    public func list(pcPeerId: String) async throws -> [SessionRow] { ... }
    public func stdin(pcPeerId: String, sessionId: String, data: String) async throws { ... }
    public func resize(pcPeerId: String, sessionId: String, cols: Int, rows: Int) async throws { ... }
    public func close(pcPeerId: String, sessionId: String) async throws { ... }
    public func history(pcPeerId: String, sessionId: String, fromSeq: Int? = nil) async throws -> HistoryResponse { ... }
}
```

**关键设计**：
- DC 路径和 signaling 路径用**同一 envelope** + **同一 pendingResponses 池**（按 reqId 索引），无论响应从哪条路回都能匹配
- LRU dedup `seenStdoutKeys` 按 `"<sessionId>|<seq>"` 索引；`seenExitKeys` 按 `"<sessionId>|exit"`
- `inboundMessages` 走 `RemoteWebRTCClient` 统一入口（DC 入 + signaling 入都 emit 到这）— **不直接订阅 SignalClient**（避开 Android Trap 1 单 listener 覆盖问题）

### 5.3 `TerminalWebView` + xterm.js bundle

**WKWebView 加载策略**：
1. 资源 bundle 内含 `xterm-shell.html` + `xterm.js` + `xterm-addon-fit.js` + `xterm.css`（与 Android `app/src/main/assets/terminal/` 同源，单文件 sync 维护）
2. WKWebView `loadFileURL(_:allowingReadAccessTo:)` 加载本地 HTML
3. `WKUserContentController.add(_:name:)` 注册 `TerminalBridge` script handler
4. JS 端 `window.webkit.messageHandlers.terminalBridge.postMessage({...})` 上报事件

**布局（关键，避 Android `android_webview_xterm_resize_observer.md` 三连坑）**：

iOS WKWebView 默认行为不同于 Android AndroidView：
- iOS WKWebView **默认 fill superview**（无 wrap_content 概念）
- HTML body height: 100% 在 iOS 一般工作正常（safe area / contentInset 是另一回事）

但 iOS 自有坑：
- `WKWebView.scrollView.contentInsetAdjustmentBehavior = .never`（不然 safe area 自动 inset 让 xterm.fit() 算错）
- `WKWebView.translatesAutoresizingMaskIntoConstraints = false` + 显式 4 边 anchor 到 superview（SwiftUI `UIViewRepresentable` 包 + frame: maxWidth/maxHeight: .infinity）
- 软键盘弹起：iOS 自动 inset WKWebView 内的 textarea 高度 → 触发 ResizeObserver → xterm.fit()，但需保证 `keyboardDisplayRequiresUserAction = false`（否则需点击）

**HTML/JS 端**：直接复用 Android `xterm-shell.html`（已修过三连坑），但适配桥名：
```javascript
// Android 用 TerminalBridge.onReady(...)
// iOS 改 window.webkit.messageHandlers.terminalBridge.postMessage({type:"onReady", cols, rows})
const Bridge = (typeof TerminalBridge !== "undefined") ? TerminalBridge :
  { onReady: (c,r) => window.webkit.messageHandlers.terminalBridge.postMessage({type:"onReady", cols:c, rows:r}),
    onResize: (c,r) => window.webkit.messageHandlers.terminalBridge.postMessage({type:"onResize", cols:c, rows:r}),
    onStdin: (data) => window.webkit.messageHandlers.terminalBridge.postMessage({type:"onStdin", data}) };
```

**Why WKWebView + xterm.js 而非 SwiftUI native（Q3 决策）**：
- 主流 iOS terminal app（Blink / Termius / Prompt 3）都走 WKWebView+xterm.js
- ANSI escape + cursor + 256-color + IME composition 已被 xterm.js v5 完整实现
- 与 Android 同源 HTML/JS 减少维护分叉

### 5.4 `PlanA1FeatureFlags` (UserDefaults)

```swift
public final class PlanA1FeatureFlags {
    private let defaults: UserDefaults

    public var preferDataChannel: Bool {
        get { defaults.object(forKey: "terminal.preferDataChannel") as? Bool ?? true }
        set { defaults.set(newValue, forKey: "terminal.preferDataChannel") }
    }
    public var dcSendTimeoutMs: Int {
        get { defaults.integer(forKey: "terminal.dcSendTimeoutMs") .let { $0 > 0 ? $0 : 5000 } }
        set { defaults.set(newValue, forKey: "terminal.dcSendTimeoutMs") }
    }
    public var fallbackOnDcFailure: Bool {
        get { defaults.object(forKey: "terminal.fallbackOnDcFailure") as? Bool ?? true }
        set { defaults.set(newValue, forKey: "terminal.fallbackOnDcFailure") }
    }
}
```

与 Android 端 SharedPreferences 同 key。Android 已落地，桌面 `.chainlesschain/config.json` 镜像。iOS 独立可配（调试时不强制桌面同步）。

## 6. Phase 2.x 落地节奏

镜像 Android Plan A.1 5-phase 结构。

| Sub-phase | 范围 | 验收 | 估时 |
|-----------|------|------|------|
| **2.1** RemoteWebRTCClient | actor + RTCPeerConnection lifecycle + RTCDataChannel + ICE servers 注入 + 5 步 connect()；statee + dataChannelReady + inboundMessages AsyncStream | 单测 ≥ 12（5 步 happy path 各一个 + 2 个 error 路径 + ICE 解析 + state 流转 + dataChannelReady 派生） | 1.0 day |
| **2.2** TerminalRpcClient + envelope + pending pool | invoke() 双路径 routing + LRU dedup + 6 个 method wrapper + 同一 reqId 池 | 单测 ≥ 14（4 种 transport 组合 + LRU dedup 入站 + 各 method wrapper） | 0.5 day |
| **2.3** xterm.js bundle + WKWebView + TerminalBridge | bundle 资源拷入 + UIViewRepresentable + WKScriptMessageHandler + ResizeObserver wiring + 软键盘 inset | 模拟器手动验：进入 SessionView → xterm 显示 prompt + 敲键看到 stdout（mock terminal 后端） | 1.0 day |
| **2.4** TerminalListViewModel + ListView + handshake 触发 | 进 ListView 时 lazy 触发 webRTCClient.connect()；UI 显示握手中 / DC ready chip；create session → 跳 SessionView | 集成测试：进 ListView 触发 handshake / Session 列表渲染 / 创建 session navigation | 0.5 day |
| **2.5** TerminalSessionViewModel + SessionView + DC fallback wiring | session lifecycle 管理 + xterm.js stdin/onResize event 接 invoke() / WKWebView 接收 stdoutEvents 调 JS .write() | 真机 E2E：iPhone + Win/Mac dev 桌面，三场景跑通（LAN / TURN relay / DC failover） | 1.0 day |
| **2.6** 收口 | bug 修 + memory + commit + close issue | CI 全绿；memory `ios_remote_terminal_phase2.md` 落地 | 0.5 day |

**总计 ~4.5 day** 聚焦工作（与 Android 3.0d 比稍多，原因：iOS 缺 WebRTC client 包装层 + WKWebView+xterm 跨平台调适）。

## 7. iOS 特有 traps（实施时必看）

镜像 Phase 1 §9 风格 + Plan A.1 经验补充。

### 7.1 `RTCPeerConnectionFactory` 必须 process-once 全局初始化

`RTCInitializeSSL()` + `RTCPeerConnectionFactory(encoderFactory:decoderFactory:)` 全 app 生命周期**仅初始化一次**。Features/Social/Services/WebRTCManager.swift 已经做了；Phase 2 RemoteWebRTCClient 不能重复初始化否则 SSL 状态崩。

**修法**：抽 `WebRTCRuntime` actor 单例放 `Modules/CoreP2P/Sources/Signaling/`（首次访问时初始化），Phase 2 + 既有 WebRTCManager 共享。Phase 2.1 第一刀。

### 7.2 `RTCDataChannelDelegate` 回调线程不固定

Google WebRTC SDK 的 delegate 回调可能在任意 worker 线程。Swift Concurrency 下绝对禁止从 delegate 回调里直接 `vm.state = ...` 修改 @MainActor 对象。

**修法**：`RemoteWebRTCClient` 内部用 `Task { await self.handleStateChange(...) }` 跨入 actor isolation。AsyncStream `yield` 是 thread-safe 可任意线程调。

### 7.3 WKWebView ResizeObserver — iOS 无 Android Trap，但有键盘 inset trap

iOS WKWebView **默认 fill superview**（无 Android wrap_content 经典坑），但软键盘弹起时 iOS 系统自动调整 WKWebView 内的可视区，xterm.fit() 必须响应。

具体配置：
- `WKWebView.scrollView.contentInsetAdjustmentBehavior = .never`
- `keyboardDisplayRequiresUserAction = false`（否则 textarea focus 失败）
- HTML 内 textarea `position: absolute; top: -9999px`（xterm 默认；接收 IME 输入但不显示）

复用 Android `xterm-shell.html` 的 ResizeObserver + setInterval 兜底（不变）。

### 7.4 Bundle 资源加载 — `Bundle.main.url(forResource:withExtension:)` 不一定 work

SwiftPM target 资源访问要求 `Package.swift` 显式声明 resources。Phase 2 需要：

```swift
.target(
    name: "CoreP2P",
    dependencies: [...],
    path: "Modules/CoreP2P",
    resources: [.copy("Resources/xterm-shell.html"), .copy("Resources/xterm.js"), ...]
)
```

加载用 `Bundle.module.url(forResource:withExtension:)`（SwiftPM 自动生成 `Bundle.module`）。**iOS app target 加载 SPM resource 一直坑**，Phase 2.3 实施前先 spike 5min 验证可行性，必要时把 bundle 文件放 `Features/RemoteTerminal/Bundle/` 走 app target 资源（更稳）。

### 7.5 `RTCDataBuffer(data: ..., isBinary: false)` JSON envelope size limit

Google WebRTC `RTCDataChannel.sendData(_:)` 默认 SCTP 最大 message 64KB。terminal envelope 通常 < 1KB（命令）/ < 4KB（stdout chunk），不会触顶。但 `terminal.history` 拉取大文件可能超过 — 桌面端已分片（response chunks），iOS 端按 chunk emit 即可。

### 7.6 ICE candidate 序列化 — Android `org.webrtc.IceCandidate` ↔ iOS `RTCIceCandidate`

字段名不同：
- Android: `IceCandidate(sdpMid, sdpMLineIndex, sdp)` constructor
- iOS: `RTCIceCandidate(sdp:sdpMLineIndex:sdpMid:)` constructor

Wire JSON 字段相同（`{candidate, sdpMid, sdpMLineIndex}`）— 两端 parse 时 mapping 别搞反。

### 7.7 Concurrent `pendingResponses` access in TerminalRpcClient — actor 必须保护

actor 隔离够用。**禁止把 `pendingResponses` 暴露成 `@Published` 让 SwiftUI 直接订阅**（actor isolation 下 publishedish 是反模式）。

### 7.8 `LRUSet` 在 actor 内安全；不要尝试 thread-safe wrapper

actor isolation 已天然串行化 — 内部数据结构无需 NSLock。Android 用 `Collections.synchronizedMap` 是因为 Hilt @Singleton 跨线程，Kotlin Coroutines 不强 actor 隔离。Swift actor 模型直接 plain Swift `Dictionary` + 自实现 LRU。

## 8. 测试策略

### 8.1 单元测试（XCTest，目标 ≥ 60 tests）

| 文件 | tests | 重点 |
|------|-------|------|
| `RemoteWebRTCClientTests.swift` | ≥ 12 | 5 步 handshake / state 流转 / dataChannelReady 派生 / ICE candidate 路由 / 错误路径 |
| `TerminalRpcClientTests.swift` | ≥ 14 | invoke 4 种 transport 组合 / 6 个 method wrapper / LRU dedup stdout / LRU dedup exit |
| `TerminalRpcEnvelopeTests.swift` | ≥ 6 | Codable round-trip / wire 字段对齐 Android |
| `PlanA1FeatureFlagsTests.swift` | ≥ 4 | 默认值 / 持久化 / override |
| `WebRTCRuntimeTests.swift` | ≥ 3 | 单例 idempotent init / 共享生命周期 |
| `LRUSetTests.swift` | ≥ 5 | capacity eviction / contains / 同 key 二次入 |
| `TerminalListViewModelTests.swift` | ≥ 8 | 进 list 触发 handshake / sessions 流 / 创建跳转 / DC chip 状态 |
| `TerminalSessionViewModelTests.swift` | ≥ 10 | onStdin 转 invoke / stdoutEvents 转 JS .write / onResize / session lifecycle |

### 8.2 集成测试

`TerminalRpcEndToEndTests.swift` 用 Fake `RemoteWebRTCClient` + Fake `SignalingGate`：
- DC handshake → terminal.create → stdin → 收 stdout → close
- DC fail mid-stream → fallback signaling → 仍能收 stdout
- DC 恢复 → 下一 invoke 走 DC

### 8.3 真机 E2E（Phase 2.5 reproducer）

**前置准备**：
1. Mac 14+ 装 Xcode 16+，iPhone iOS 15.0+（Phase 1 决策锁定 baseline）
2. 桌面端 v5.0.3.54+（Phase 1.6 follow-up `pairing-code:<6digit>` 别名 listener 已 ship）
3. iOS app 已通过 Phase 1.7 真机 E2E（三流配对至少一次成功，PairedDesktopsStore 持久化了 pcPeerId + iceServersJson）
4. **Xcode 资源添加**（Phase 2.3 Bundle/）：drag `ios-app/ChainlessChain/Features/RemoteTerminal/Bundle/` 文件夹到 ChainlessChain target → "Create folder references"（蓝色文件夹），不要选 "Create groups"

**4 个 E2E 场景**：

| # | 场景 | 网络 | 验收（pass/fail 标准） |
|---|------|------|--------|
| 1 | LAN 同 WiFi | iPhone + Mac/Win 桌面同 WiFi | (a) DC 握手 ≤ 2s（chip 从 "握手中" → "P2P 直连" 时间）；(b) `terminal.create` RTT ≤ 200ms；(c) `ls` stdout 显示 ≤ 100ms latency |
| 2 | 蜂窝 → TURN | iPhone 4G/5G + 桌面在家 WiFi | (a) DC 握手 ≤ 5s（TURN relay 路径）；(b) RTT ≤ 500ms；(c) `watch -n 0.5 date` 30min stdout 流式无中断 |
| 3 | DC 失效 → fallback | 场景 1 中途强制 DC 失败 | chip 在 ≤ 3s 内从 "P2P 直连" → "中继路径"；命令仍能发；stdout 仍能收（经 signaling 4 跳路径）|
| 4 | DC 恢复 | 场景 3 后恢复网络 | chip 自动从 "中继路径" → "P2P 直连"；下一笔 invoke 走 DC（iOS Console 看 sentDC vs sentSignaling 计数）|

**如何模拟 DC 失败（场景 3）**：
- iOS 端不能 adb 也不能 disable UDP socket — 三选一：
  - **(a) 桌面端杀 mobile-bridge 进程**：`pkill -f mobile-bridge` 或 macOS Activity Monitor force quit；恢复 = 重启桌面 app
  - **(b) Network Link Conditioner**：iOS 系统 Settings → Developer → Network Link Conditioner → "Very Bad Network" 阻断 UDP；恢复 = "Off"
  - **(c) RemoteWebRTCClient 加 debug method**（v0.1 不上）：`internal func _testSimulateDataChannelFailure() async`

**真机抓证据**（场景 1/2）：
- iOS Console.app 过滤 "[TerminalRpc]" 看 `sentDC` vs `sentSignaling` 计数
- Charles Proxy / Wireshark 在桌面端确认无 signaling-server 流量（DC 直连时桌面 wss 应 idle）

**记录**：每个场景跑完截图 + Console log 贴 memory `ios_remote_terminal_phase2.md`（Phase 2.6 收口创建）。bug 进 §6 风险表。

## 9. 风险 & open questions

| 风险 | 影响 | 缓解 |
|------|------|------|
| `Bundle.module` 在 SwiftPM + Xcode 跨配置不稳 (memory `ios_qr_pairing_three_flows.md` Trap 4 同类) | 中 — Phase 2.3 阻塞 | spike 5min 先验；fallback 把 xterm.js bundle 移到 app target Resources |
| Google WebRTC SDK iOS 14 ICE candidate trickling 偶发 bug (历史 issue) | 低 — Phase 1 锁 iOS 15+ 已规避 | 无需额外动作 |
| WKWebView IME 中文输入候选词在 xterm.js 上 visual artifact | 低 — 主要 Latin 字符使用场景 | 默认接受；用户反馈再调 |
| 软键盘弹起时 xterm 行数突变让桌面 PTY resize 频繁 | 中 — 可能 stdout 渲染抖动 | resize debounce 200ms（Android 已做） |
| DC 持续吞吐 1MB/s 时 iOS RTCDataChannel back-pressure 未知 | 中 — iOS WebRTC SDK 文档不全 | Phase 2.5 真机压测验证；超过阈值警告 |
| 桌面 PtyManager session 泄漏（DC 断 → signaling → DC 重建过程中累积） | 低 — Android 端 30min idle GC 已存在 | 无需 iOS 端动作 |

### 决策记录（2026-05-15 锁定）

| # | 决策 | 理由 |
|---|------|------|
| **OQ-1** xterm.js bundle 落点 | **app target `Bundle.main`** (`Features/RemoteTerminal/Bundle/`) | SPM `Bundle.module` 在 Xcode + SwiftPM 跨配置坑多（memory `ios_qr_pairing_three_flows.md` Trap 4 同类）；app target Resources 是稳定通路。 |
| **OQ-2** 出向 dedup | **不做**（v0.1 信任 DC 单发） | 与 Android v0.1 一致；仅做入向 LRU dedup（按 (sessionId, seq) / (responseId)）。Hardening 留 v0.2 待真机暴露 case。 |
| **OQ-3** `WebRTCRuntime` 单例落点 | **`Modules/CoreP2P/Sources/Signaling/WebRTCRuntime.swift`** | 1 个文件不值得新目录；与 SignalClient 同 Signaling/ 子目录，未来若 WebRTC 文件增多再分。 |
| **OQ-4** xterm.js 版本 | **v5.5.0**（与 Android 同源） | iOS HTML/JS 直接 sync Android `app/src/main/assets/terminal/xterm-shell.html` 同源版本，避免分叉维护。 |

## 10. 不在范围（明确 defer）

- **远程操控 framework**（RemoteSkillRegistry / OfflineCommandQueue / 通用 commands envelope）→ Phase 3 单独 design doc
- **远程屏幕 (截屏 / OCR / SendInput)** → 未来 Plan B
- **多 session 并发管理 UI**（Android v0.1 也是单 session）→ Phase 2 v0.2 hardening
- **session 持久化（杀 app 后恢复）** → 桌面 PtyManager 30min idle 自然 GC，iOS UI Phase 2 不做恢复
- **iOS WatchOS 远程终端入口** → 不在路线图
- **Desktop `pair-code:<code>` 别名扩展（multiple devices via same alias）** → 单设备模式足够；Android 也单设备

---

## 附录 A — 关键文件指针

桌面端（已稳定，**禁止改字段名**）：
- mobile-bridge.js: `desktop-app-vue/src/main/p2p/mobile-bridge.js`（`sendToMobile` DC 优先 + signaling 兜底）
- handleTerminalCommand: `desktop-app-vue/src/main/p2p/desktop-mobile/handlers/terminal-handler.js`（具体方法路由）
- PtyManager: `desktop-app-vue/src/main/terminal/pty-manager.js`（session lifecycle）

Android 端（移植参考，**逐文件比照**）：
- TerminalRpcClient: `android-app/app/src/main/java/.../remote/terminal/TerminalRpcClient.kt`（RPC over DC + signaling 双路）
- WebRTCClient: `android-app/app/src/main/java/.../remote/webrtc/WebRTCClient.kt`（5 步 handshake + DC lifecycle）
- TerminalSessionScreen: `android-app/app/src/main/java/.../remote/terminal/ui/TerminalSessionScreen.kt`（Compose 主屏）
- TerminalWebView: `android-app/app/src/main/java/.../remote/terminal/ui/TerminalWebView.kt`（AndroidView WKWebView 等价）
- xterm-shell.html: `android-app/app/src/main/assets/terminal/xterm-shell.html`（**iOS 直接 sync 复用**）

memory（强烈建议读完再开工）：
- `android_webview_xterm_resize_observer.md` — Android WebView 三连坑（iOS 部分 trap 不适用，但 ResizeObserver wiring 直接照抄）
- `feedback_currentpeerid_target_vs_self_trap.md` — Plan A.1 echo-loop bug，iOS 同样会中
- `ios_qr_pairing_three_flows.md` — Phase 1 实施 6 个 trap（VM 放 CoreP2P / actor+Combine / SwiftPM Bundle 等）
- `feedback_ios_ui_mirrors_validated_android.md` — UI 优先抄 Android 验证版

## 附录 B — 文档同步 follow-up

Phase 1 已建立两个 `ROOT_FILE_MAP` 映射模式：本 doc 是英文名 `iOS_Phase_2_Remote_Terminal.md`，commit 时同步：
- `docs-site/scripts/sync-design-docs.js` ROOT_FILE_MAP 加 `'iOS_Phase_2_Remote_Terminal.md': 'mobile/ios/phase-2-remote-terminal.md'`
- `docs-site-design/scripts/sync-docs.js` 加同样 entry
- 跑 `node docs-site/scripts/sync-design-docs.js && node docs-site-design/scripts/sync-docs.js`
- 验 `docs-site/docs/design/mobile/ios/phase-2-remote-terminal.md` + `docs-site-design/docs/mobile/ios/phase-2-remote-terminal.md` 都有内容，不是 `unknown-unmapped.md`

## 附录 C — 与 Phase 1 / Phase 3 关系

```
Phase 1 (✅ c30b415a8 + a411b1887, 2026-05-15)
  └─ 桌面配对三流 + PairedDesktopsStore (含 iceServersJson)
       │
       ├──→ Phase 2 (本文)
       │      └─ 远程桌面终端 (DC + signaling fallback + xterm.js)
       │           │
       │           └──→ Phase 3 (defer)
       │                  └─ 远程操控 framework
       │                       (RemoteSkillRegistry + commands envelope)
       │
       └──→ 其它后续 phase（同步 / 剪贴板 / OCR / voice）
```

Phase 2 落地后 iOS 端用户体验：扫描配对 → 进 Settings → 桌面配对 → 列表选已配对桌面 → 进远程终端 → 键入命令 → 看输出。完整 mobile↔desktop 控制闭环。
