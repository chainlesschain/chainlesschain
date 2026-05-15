# iOS Phase 1 — Mobile↔Desktop Pairing (Flow B 主, Flow A + 手输 code 同期落地)

> 状态：草案 / 等评审
> 对齐版本：Android v1.1 W3.7 (commit `c47cbc649`，2026-05-12 真机 E2E 通过)
> 桌面版本：v5.0.3.54+
> 关联文档：`docs/design/Android_W3_Pairing_E2E.md`、memory `desktop_qr_pairing_flow_b.md` / `desktop_qr_pairing_flow_a.md`

---

## 1. 背景

iOS 端目前**完全没有**桌面配对能力。现状核实（387 swift 文件 grep）：
- 无 `DesktopPairing*` / `PairedDesktops*` / `PairingSignalingGate` / `RemoteTerminal*` 任何一个 Android 类的对位
- `Modules/` 只有 5 个：CoreCommon / CoreDID / CoreDatabase / CoreE2EE / CoreSecurity（**无 CoreP2P**，仅孤儿 `Tests/CoreP2PTests/`）
- `WalletConnectService.swift` + `QRScannerView.swift` 是钱包配对，与桌面配对无关
- `Features/Social/Services/WebRTCManager.swift` 已集成 Google WebRTC SDK（RTCPeerConnectionFactory），但仅服务于聊天，没接信令配对

桌面端 + Android 端的配对协议已稳定（W3.7 Flow B 真机 E2E 收口、Plan A.1 远程终端在此基础上跑通），iOS 现在追平窗口风险最小。

## 2. 目标 & 非目标

### 目标（Phase 1 in scope）

| # | 项 | 验收 |
|---|---|---|
| G1 | Flow B（桌面显 QR / iPhone 扫）端到端跑通 | iPhone 扫桌面 QR → 桌面看到「已配对」+ iOS 本地写 PairedDesktopsStore + Settings 列表显示 |
| G2 | Flow A（iPhone 显 QR / 桌面 webcam 扫）端到端跑通 | iPhone 显 QR → 桌面 webcam 扫 → iOS 收信令 `pairing:confirmation` → UI Completed |
| G3 | 手输 6 位 code 通路 | iOS 输入 6 位 code → 走 cc CLI 等价接口（见 §6.5）→ 桌面记录配对 |
| G4 | 真机 E2E（iPhone + Win/Mac 桌面）三流各跑一次 | adb tether 等价路径用 USB tether 或 Personal Hotspot；公网路径用 `wss://signaling.chainlesschain.com` |
| G5 | LAN signaling URL → 中继 fallback 自动切换 | LAN 不通时 `sendAck` 失败 → 自动切到 relayUrl 重试一次 |
| G6 | ICE servers + 24h 凭证持久化 | 扫码时拿到的 `iceServers` JSON 字符串原样存 PairedDesktopsStore，未来 WebRTC 连接直接读 |

### 非目标（defer 到 Phase 2+）

- **远程桌面终端 (Plan A.1 移植)** — 单独 Phase 2 设计文档，依赖本 Phase 的 PairedDesktopsStore + WebRTC infra
- **远程操控 framework**（RemoteSkillRegistry / OfflineCommandQueue / commands envelope）— Phase 3
- 双向同步、剪贴板、OCR、voice 等增量 — Phase 4+
- **SSE / push 实时化** — Android W3.8 范畴；Phase 1 接受 Vue panel 的 1.5s polling
- WatchOS 扩展（对应 Android wear-app）— 不在 mobile 路线图

## 3. 三流共存架构

完全对齐 Android 现有产品形态（Settings → 三 tab）：

| Flow | 方向 | 入口 | iOS 实现 |
|------|------|------|---------|
| **B（默认）** | desktop QR → iPhone 扫 | Settings → "扫描桌面 QR" | `ScanDesktopPairingView` + `ScanDesktopPairingViewModel` + 复用 `QRScannerView`（重构为通用） |
| A（高级） | iPhone QR → desktop webcam 扫 | Settings → "显示我的 QR" | `DesktopPairingView` + `DesktopPairingViewModel` + `QrCodeImage`（CoreImage CIQRCodeGenerator） |
| 手输 code | 6 位数字手敲 | Settings → "手动输入配对码" | `ManualPairingView` + `ManualPairingViewModel`，调用桌面 `mobile-pair-handlers.js` 的 HTTP 等价端点（见 §6.5） |

未来加同类 pairing 默认走 Flow B（与 Android 决策一致：iPhone 摄像头扫大尺寸 desktop 屏 QR 比 desktop webcam 扫小手机屏 QR 可靠）。

## 4. 数据契约（与桌面 + Android 严格对齐，禁止改字段名）

### 4.1 桌面 → iOS（Flow B：iOS 解析）

```json
{
  "type": "desktop-pairing",
  "code": "<6 位数字 ^\\d{6}$>",
  "pcPeerId": "<desktop mobileBridge.peerId>",
  "deviceInfo": {
    "name": "<hostname>",
    "platform": "win32 | darwin | linux",
    "version": "..."
  },
  "timestamp": <epoch-ms>,
  "signalingUrl": "ws://192.168.x.x:9001",         // LAN 直连，可空
  "relayUrl": "wss://signaling.chainlesschain.com", // 公网中继 fallback
  "iceServers": [{"urls": "...", "username": "...", "credential": "..."}],
  "iceExpiry": <epoch-seconds, +24h>
}
```

**iOS 校验顺序**（与 Android `ScanDesktopPairingViewModel` 100% 一致）：
1. `type == "desktop-pairing"`
2. `code` 匹配 `^\d{6}$`
3. `pcPeerId` 非空
4. `(now - timestamp) <= 5 min`（与桌面 `pairingTimeout` 对齐）
5. 本地有活跃 DID（`DIDManager.currentIdentity != nil`）

校验失败 → `ScanDesktopPairingState.failed(reason)`，UI 显示具体原因 + 重试按钮。

### 4.2 iOS → 桌面（Flow B：iOS 经信令发 ack）

```json
{
  "type": "pair-ack",
  "pairingCode": "<6 位>",
  "mobileDid": "did:cc:...",
  "deviceInfo": {
    "deviceId": "<UIDevice.identifierForVendor>",
    "name": "<UIDevice.name>",
    "platform": "ios"
  },
  "timestamp": <epoch-ms>
}
```

经信令服务器路由：`{type:"message", to: pcPeerId, payload: <ack>}`。

### 4.3 iOS → 桌面（Flow A：iOS 显 QR 给桌面扫）

```json
{
  "type": "device-pairing",
  "code": "<6 位数字>",
  "did": "did:cc:...",
  "deviceInfo": { "deviceId", "name", "platform": "ios" },
  "timestamp": <epoch-ms>
}
```

桌面扫码后经信令发回 `pairing:confirmation`，iOS 通过 `PairingMessageBus` 异步接收 → 状态 → `Completed`。

### 4.4 桌面 → iOS（Flow A：confirmation）

```json
{
  "type": "pairing:confirmation",
  "pairingCode": "<6 位>",
  "pcPeerId": "<desktop peer-id>",
  "deviceInfo": {...},
  "timestamp": <epoch-ms>
}
```

经信令服务器路由到 `to: <iOS DID>`（iOS 侧 register peer-id 必须用 DID，否则 server 找不到目标 drop）。

## 4.5 UI 布局对齐策略（2026-05-15 用户决策）

**强约束**：iOS 每个 Pairing view 的布局**优先参考已真机验证的 Android Kt screen**，不要凭空设计。Android 端已经过 Xiaomi 24115RA8EC 真机 E2E 验证（W3.7 `c47cbc649`），含修过的踩坑。详见 memory `feedback_ios_ui_mirrors_validated_android.md`（HIG 偏离白名单 6 项）。

| iOS view | 必读的 Android Kt counterpart | 验证状态 |
|----------|-------------------------------|--------|
| `PairingHomeView` | `packages/web-panel/src/views/MobileBridge.vue`（3-tab 容器布局） + Android Settings 入口 | 桌面 + Android 双端真机 |
| `ScanDesktopPairingView` (Flow B) | `android-app/feature-p2p/.../ui/ScanDesktopPairingScreen.kt` + `viewmodel/ScanDesktopPairingViewModel.kt` | 真机 E2E `c47cbc649` |
| `DesktopPairingView` (Flow A) | `android-app/feature-p2p/.../ui/DesktopPairingScreen.kt` + `viewmodel/DesktopPairingViewModel.kt` | 真机 E2E (W3.2-W3.6) |
| `ManualPairingView` | **无 Android 对位**（Android 用 `cc p2p pair-from-qr` CLI 通路） | iOS 自行设计，约束见占位 docstring |
| `PairedDevicesListView` | `android-app/app/src/main/java/.../presentation/screens/peers/PairedDevicesScreen.kt` + `PairedDevicesViewModel.kt`（v1.3+ 持久化层 issue #21） | 真机验证 |

**对齐项**（必须照抄）：状态机 case 名 + 转移图 / 屏内 section 顺序 / 错误文案模板（变量插值位置） / 倒计时 + spinner 视觉锚点 / platform icon 选择映射。

**HIG 偏离白名单**（允许的 iOS-native 替换）：Compose `Scaffold` → SwiftUI `Form`/`Section`、Material `BottomSheet` → `.sheet`、Material `Card` (elevation) → 默认 `List` row（不手画 shadow）、`TextButton` → `Button(.bordered)`、Material `CircularProgressIndicator` → `ProgressView()`、`LazyColumn` → `List` 或 `ScrollView { LazyVStack }`。

## 5. 模块拆分

### 5.1 新建 `Modules/CoreP2P/`（SwiftPM target）

对应 Android `core-p2p`。**只放 protocol + 数据模型 + 通用 store**，不依赖 UIKit/SwiftUI/AVFoundation。

```
Modules/CoreP2P/
└── Sources/CoreP2P/
    ├── Pairing/
    │   ├── PairingSignalingGate.swift     // protocol，对应 Kt interface
    │   ├── PairedDesktopsStore.swift      // UserDefaults JSON 持久化
    │   ├── PairedDesktop.swift            // Codable 数据模型
    │   ├── PairingMessageBus.swift        // protocol + AsyncStream impl
    │   ├── PairingConfirmation.swift      // 数据模型
    │   └── PairingClock.swift             // protocol + System impl（测试可注入）
    ├── Signaling/
    │   ├── SignalClient.swift             // protocol
    │   ├── WebSocketSignalClient.swift    // URLSessionWebSocketTask impl
    │   └── SignalingConfig.swift          // 当前 signalingUrl + relayUrl 持久化
    └── DeviceInfo/
        └── PairingDeviceInfoProvider.swift // protocol + iOS impl
```

**Why protocol 入 CoreP2P 而非 Features/Pairing**：
- 未来 Phase 2 远程终端要复用同一 `PairingSignalingGate` + `PairedDesktopsStore`
- Features 之间不互依赖（Features/RemoteTerminal 不能反向 import Features/Pairing）

**Hilt 替代物**：iOS 无 Hilt。两条路：
- (A) 简单方案：每个 protocol 配 `static let shared` 单例（与现有 `WebRTCManager.shared` 一致）
- (B) 显式注入：Features/Pairing 顶层创建一个 `PairingDependencies` struct 持有所有 protocol 实例，传给 ViewModel
- **推荐 (B)**：测试时 fake 注入更干净；ViewModel 不依赖全局单例

### 5.2 新建 `ChainlessChain/Features/Pairing/`

对应 Android `feature-p2p`。

```
Features/Pairing/
├── Views/
│   ├── PairingHomeView.swift              // 三 tab 容器（对应 Android Settings 入口）
│   ├── ScanDesktopPairingView.swift       // Flow B 主屏
│   ├── DesktopPairingView.swift           // Flow A 主屏（显 QR）
│   ├── ManualPairingView.swift            // 手输 code
│   ├── PairedDevicesListView.swift        // 已配对桌面列表
│   └── QrCodeImage.swift                  // CoreImage QR 生成 SwiftUI 包装
├── ViewModels/
│   ├── ScanDesktopPairingViewModel.swift  // Flow B（@MainActor + @Published）
│   ├── DesktopPairingViewModel.swift      // Flow A
│   ├── ManualPairingViewModel.swift
│   └── PairedDevicesListViewModel.swift
└── Services/
    ├── DefaultPairingSignalingGate.swift  // PairingSignalingGate 默认 impl，包 SignalClient
    └── DefaultPairingMessageBus.swift     // AsyncStream impl
```

### 5.3 复用 / 重构现有

| 现有 | 操作 | 备注 |
|------|------|------|
| `Features/Blockchain/Views/QRScannerView.swift` | 重构为通用 | 当前 hardcoded "WalletConnect QR 码"文案 + WalletConnect 校验耦合（实际只在 onScan callback 里）。抽出 `GenericQRScannerView` 放 `Features/Common/`，原 `QRScannerView` 改为 thin wrapper |
| `Modules/CoreDID/Sources/CoreDID/Manager/DIDManager.swift` | 直接注入 | 已有 `currentIdentity` Publisher，Flow A/B 都用 |
| `Features/Social/Services/WebRTCManager.swift` | 不动 | Phase 1 不接触 WebRTC negotiation；Phase 2 远程终端再扩展 ICE servers 注入 |

## 6. 关键组件设计

### 6.1 `PairingSignalingGate` (CoreP2P)

```swift
public protocol PairingSignalingGate: AnyObject {
    /// 确保 WS 已连 + register self peer-id（idempotent）
    func ensureRegistered(localPeerId: String) async throws

    /// Flow B：扫码后经信令发 pair-ack 到桌面 pcPeerId
    /// 内部先 ensureRegistered 再 sendForwardedMessage
    func sendAck(toPeerId: String, ackPayload: [String: Any]) async throws

    /// 切 URL 前必调，清缓存的 registeredPeerId（否则下次 ensureRegistered 短路不重连）
    func reset() async
}
```

**Why `async throws` 而非 `Result`**：Swift Concurrency 习惯，try/catch 比 Result 链式更直观；与 Kotlin Coroutines 的 `suspend fun ... : Result<T>` 行为等价。

### 6.2 `WebSocketSignalClient` (CoreP2P/Signaling)

`URLSessionWebSocketTask` 实现，**必须自己处理**以下 OkHttp 在 Android 端默认提供、iOS 端不提供的能力：

| 能力 | OkHttp（Android） | URLSessionWebSocketTask（iOS） |
|------|------|------|
| 自动重连 | 是 | **否** — 需自实现：失败时延迟 backoff（500ms / 1s / 2s / 5s）+ 断线后自动 register 重发 |
| Ping/keepalive | 是 | **否** — 需 `sendPing(pongReceiveHandler:)` + 30s 间隔 timer |
| 收消息 | 长循环 | **递归** — `receive(completionHandler:)` 每次只收一条，必须再次调用才能收下一条 |

参考 Android `WebSocketSignalClient` 的 `onOpen` 自动重发上次 register（见 Android W3.6 PairingSignalingGate `ensureRegistered` 注释 line 39-46）。

**关键 trap：`currentPeerId = self`，不是 target**。Plan A.1 实战找到的 echo-loop bug（memory `feedback_currentpeerid_target_vs_self_trap.md`）：`sendOffer/sendAnswer/sendCandidate` 不能 `currentPeerId = peerId`，否则 WS 重连时 auto-register 用 target peerId 注册成对方身份 → 消息路由回自己。**iOS 移植必须在 grep `currentPeerId\s*=` 时只命中 `register()` 方法**。

### 6.3 `PairedDesktopsStore` (CoreP2P)

```swift
public actor PairedDesktopsStore {
    public init(userDefaults: UserDefaults = .standard)

    public func devices() async -> [PairedDesktop]
    public func devicesPublisher() -> AnyPublisher<[PairedDesktop], Never>  // 给 SwiftUI

    public func upsert(_ desktop: PairedDesktop) async   // by pcPeerId 去重
    public func remove(pcPeerId: String) async
    public func clear() async
}

public struct PairedDesktop: Codable, Identifiable {
    public let pcPeerId: String  // = id
    public let deviceName: String
    public let platform: String
    public let lanSignalingUrl: String?
    public let relayUrl: String?
    public let iceServersJson: String?      // 原样存（与 Android 对齐，避免 schema 漂移）
    public let iceExpiry: Int64             // unix-ts seconds
    public let pairedAt: Int64              // epoch-ms
    public let lastSeenAt: Int64

    public var id: String { pcPeerId }
}
```

**Why `actor`**：天然串行化 upsert/remove，避免 SwiftUI 多线程 race（Android 用 SharedFlow + `_devices.value =` 隐式 atomic）。

**Why UserDefaults**：与 Android SharedPreferences 1:1 对应；数据量小（一个用户预期 < 10 台桌面），不值得引入 SQLite。

**Why iceServersJson 存 String 不存 `[IceServer]`**：见 §1 用户决策——保持与 Android schema 一致，未来 Android 改字段时一处对齐。Phase 2 真接 WebRTC 时再写 `WebRTCClient.iceServersFromJson(_:)` 解析器。

### 6.4 `PairingMessageBus` (CoreP2P)

```swift
public protocol PairingMessageBus: Sendable {
    var confirmations: AsyncStream<PairingConfirmation> { get }
    func emit(_ confirmation: PairingConfirmation)
}
```

**iOS 选 `AsyncStream` 而非 Combine `PassthroughSubject`** 因为：
- 与 Kotlin `SharedFlow` 语义最近（事件流，无 latest value）
- ViewModel `init` 里 `Task { for await c in bus.confirmations { ... } }` 自然取消
- Combine 的 cancellables bag 在 ViewModel 生命周期管理上更繁琐

`replay = 0` + 缓冲 8 条对齐 Android `extraBufferCapacity = 8`。

### 6.5 手输 code 路径 — 信令复用方案 (Phase 1.6 实施时修订)

**初版 (设计阶段)** 计划走桌面端新加 `POST /api/pair/manual` HTTP 端点。**Phase 1.6 实施时发现致命问题**：iOS 不知道桌面 IP / 端口（QR 流自带 `signalingUrl`，手输流没这个），HTTP 路径需要额外发现机制（mDNS / 用户手敲 IP），UX 极差。

**改为 (Phase 1.6 实际方案 — signaling 复用)**：

```
┌─ Desktop (MobileBridge.vue Flow B 激活时) ─────────────────┐
│  既有：signaling.register(peerId: <mobileBridge.peerId>)   │
│  新加：signaling.register(peerId: "pairing-code:<6digit>")  │ ← 同 code 同生命周期
└────────────────────────────────────────────────────────────┘
            ▲
            │ {type:"message", to:"pairing-code:123456",
            │  payload: {type:"pair-ack", pairingCode, mobileDid, deviceInfo, timestamp}}
            │
┌─ iOS Manual ──────────────────────────────────────────────┐
│  user 输入 6 位 code (与桌面 QR 旁那个 code 一致)         │
│  → ensureRegistered(localPeerId: DID)                     │
│  → sendAck(toPeerId: "pairing-code:<code>", envelope)     │
│  → state = .waitingForConfirm                             │
│  → 订阅 PairingMessageBus.confirmations 等桌面 confirm    │
└────────────────────────────────────────────────────────────┘
```

**优点**：
- iOS 端代码 Phase 1.6 一次写完 forward-compat：desktop 没接 → signaling-server 返 `peer-offline` → iOS 友好失败「桌面未启用此通道，建议改用扫描」；desktop 接通 → 直接 work
- 桌面 follow-up = ~30 LOC in `desktop-app-vue/src/main/p2p/mobile-bridge.js` init：Flow B QR 生成时多调一次 `signalClient.register("pairing-code:" + code, ...)`，QR expire 时反注册
- 完全复用 `recordPairAck` + 5min 超时 + signaling 路由 — 0 新协议
- 桌面 code 验证天然有：`recordPairAck` 已校验 `pairingCode` 与 active session 匹配

**缺点 vs HTTP**：
- 多一次 signaling round-trip（vs 直 HTTP）— 微秒级，UX 不可感知

**桌面端 follow-up 工单**（建议交付）：
- 文件：`desktop-app-vue/src/main/p2p/mobile-bridge.js`
- 改 `startPairing()` / Flow B QR generation：拿到 6-digit code 后多注册一次 `signalClient.register("pairing-code:" + code, {role: "manual-pair-listener"})`
- 改 `cancelPairing()` / QR expire：反注册 `pairing-code:` 别名
- 收到 `pairing-code:` peer-id 路由的 pair-ack 走与 QR 路径**完全一样**的 `recordPairAck` — 不区分来源
- iOS 已就位，桌面接通即可 ship Phase 1.6 collectively

## 7. 状态机（与 Android 1:1 对齐）

### 7.1 Flow B (`ScanDesktopPairingState`)
```
.scanning → .sending(desktopName) → .success(desktopName) | .failed(reason)
```

### 7.2 Flow A (`DesktopPairingState`)
```
.idle → .displaying(payload, payloadJson, expiresAt) → .completed | .expired | .failed(reason)
```

### 7.3 手输 code (`ManualPairingState`)
```
.entering → .submitting(code) → .success(desktopName) | .failed(reason)
```

Swift impl：`enum` + associated values（与 Kotlin `sealed class` 等价）。

## 8. Phase 1 落地节奏

| Sub-phase | 范围 | 验收 | 估时 |
|-----------|------|------|------|
| **1.1** scaffold | 新建 `Modules/CoreP2P` SwiftPM target；空 protocol + Features/Pairing 三个 placeholder Screen + Settings 入口；NavigationLink 跑通 | `pod install` / SPM resolve 通过；Settings 出现 3 个新 tab，点进去显占位文字 | 0.5 day |
| **1.2** signaling | `WebSocketSignalClient`（URLSession）+ `DefaultPairingSignalingGate` + `SignalingConfig`；XCTest 用 `URLProtocolMock` 覆盖 connect/register/sendForwardedMessage | 单测 ≥ 15 个；可手动连接 `wss://signaling.chainlesschain.com` register 一个临时 peer-id 看到 server 回 ack | 1 day |
| **1.3** Flow B | `ScanDesktopPairingViewModel` + parse + ack send + LAN→relay fallback；复用 `GenericQRScannerView` | iPhone 真机扫桌面 QR → 桌面 web-panel 看到 acked status；ViewModel 单测 ≥ 12 个（含每个失败分支） | 1 day |
| **1.4** PairedDesktopsStore | `actor` impl + UserDefaults 持久化 + Combine publisher；`PairedDevicesListView` 显示已配对列表 | 杀 app 重启后已配对桌面仍在；列表支持解除配对 | 0.5 day |
| **1.5** Flow A | `DesktopPairingViewModel` + `QrCodeImage`（CIQRCodeGenerator）+ `PairingMessageBus` + signaling 监听 confirmation | iPhone 显示 QR → 桌面 webcam 扫 → iOS UI 自动跳 Completed；5min 倒计时 expire 正确 | 1 day |
| **1.6** 手输 code | iOS `ManualPairingView` + 桌面 follow-up issue：新增 `POST /api/pair/manual` HTTP 端点 | 6 位 code 输入 → 提交 → 桌面写库 → iOS 收 success | 0.5 day（iOS 部分）+ 桌面端 0.5 day |
| **1.7** 真机 E2E | 三流各跑一次：iPhone（USB tether 或 Personal Hotspot）+ Win/Mac 桌面；LAN 不通时验 fallback 到 `wss://signaling.chainlesschain.com` | 三流都成功；fallback 路径日志清晰 | 0.5 day |
| **1.8** 收口 | 修真机 E2E 暴露的 bug；docstring + memory（新建 `ios_qr_pairing_three_flows.md`）；Phase 1 close issue | CI 全绿；issue 关闭 | 0.5 day |

**总计 ~6 day**（不含桌面端 follow-up）。

## 9. 9 实战坑 — iOS 特化对照

来自 memory `desktop_qr_pairing_flow_b.md`，逐条核对 iOS 是否中招：

| # | Android 原坑 | iOS 是否中招 | iOS 修法 |
|---|---|---|---|
| 1 | `<a-qrcode>` 必须 async-register 进 web-panel | **N/A** — iOS 用 `CIQRCodeGenerator` (CoreImage)，无 Vue 组件注册问题 | — |
| 2 | `parseJsonOutput` log-prefix vs JSON 混淆 | **N/A**（本 Phase 无 cc subprocess）；§6.5 手输 code 走 HTTP 后也无此风险 | 若 Phase 2 引入 subprocess，复用同 regex `^[\[\{](\s*$\|[\s"'\d\[\{\-])` |
| 3 | `mobileBridge.peerId` 必须是 class 属性，不是局部变量 | **同样会中** — Swift 也会把 `let peerId = ...` 局部化 | `WebSocketSignalClient` 上必须 `private(set) var registeredPeerId: String?`，**禁止 register 内 `let`** |
| 4 | social `QRCodeScannerViewModel` 内置 ChainlessChain-only 校验 reject 非社交 QR | **同样会中** — 现有 `QRScannerView` 只是 callback 透传，**但**未来若加任何 QR 校验 wrapper 务必让 desktop-pairing JSON 透传 | 重构 `QRScannerView` → `GenericQRScannerView`（无校验）；Pairing 三流都用 generic |
| 5 | `pair-ack` 必须在 bridge to libp2p **前**拦截 | **N/A** — iOS 端不充当 desktop bridge，只发 ack 不接收。**桌面侧已有这个拦截**，iOS 不需要重复 | — |
| 6 | WS handler in-memory ack 与 SQLite 写双轨 | **N/A** — iOS 不充当桌面端，只发 ack；§6.5 手输 code 走桌面 HTTP 端点，写库由桌面负责 | — |
| 7 | 跨模块 DI（interface 在 core-p2p，impl 在 :app） | **同样会中** — Swift package 循环依赖也会 crash | protocol 入 `Modules/CoreP2P`，impl 入 `Features/Pairing/Services/`；Features 不被 CoreP2P 反向 import |
| 8 | 真机 E2E 没域名 → adb reverse | **iOS 无 adb** — 用替代 | 三选一：(a) USB tether + Mac 桌面，本机 IP 直连；(b) iPhone Personal Hotspot 给桌面，桌面在同一子网；(c) 全公网走 `wss://signaling.chainlesschain.com`（最简单，推荐 1.7 默认） |
| 9 | QR payload 字段契约（type / code / pcPeerId / deviceInfo / timestamp / signalingUrl / relayUrl / iceServers / iceExpiry） | **必须严格对齐** — 改字段名直接 break 桌面 + Android | §4 已锁定；XCTest 覆盖每个字段缺失 / 类型错误的 reject |

**额外 iOS 特有坑**（Phase 1 必看）：

10. **`URLSessionWebSocketTask.receive` 是单次** — 收到一条后不再调用就永远收不到下一条。必须 `receive { result in self?.handleAndContinue(result) }` 递归式 chain。
11. **`Codable` 默认严格** — JSON 多了字段会 reject。所有 incoming JSON 解码必须 `decoder.keyDecodingStrategy = .useDefaultKeys` + 用 `[String: Any]` 或 `JSONDecoder` + 显式忽略未知字段（`init(from:)` 手写）。对应 Android `Json { ignoreUnknownKeys = true }`。
12. **`UIDevice.identifierForVendor` 在 app 卸载重装后会变** — 与 Android `Settings.Secure.ANDROID_ID` 不同语义。`PairingDeviceInfoProvider.deviceId()` 必须配合 Keychain 持久化一个自生成 UUID，重装不变（否则桌面侧把同一台 iPhone 当成两台不同设备）。
13. **iOS 后台 WS 会被系统断** — 30s 后系统挂起 socket。Phase 1 不解决（用户主动操作期间足够），加 TODO 让 Phase 2 用 PushKit / silent push 唤醒。
14. **`@MainActor` 与 `actor` 桥接** — `PairedDesktopsStore` 是 `actor`，SwiftUI 视图必须 `await` 才能读。给 ViewModel 加 `@Published var devices: [PairedDesktop] = []` + `Task { for await list in store.devicesPublisher().values { devices = list } }` 桥接。

## 10. 测试策略

### 10.1 单测（XCTest，目标 ≥ 50 tests for Phase 1）

| 文件 | 测试数 | 重点 |
|------|--------|------|
| `WebSocketSignalClientTests.swift` | ≥ 15 | URLProtocol mock，覆盖 connect / register / sendForwardedMessage / 重连 / ping |
| `PairingSignalingGateTests.swift` | ≥ 8 | idempotent ensureRegistered / sendAck 失败传递 / reset 后真重连 |
| `PairedDesktopsStoreTests.swift` | ≥ 6 | upsert idempotent / remove / 持久化 round-trip / Codable schema |
| `ScanDesktopPairingViewModelTests.swift` | ≥ 12 | 每个失败分支（type 错 / code 格式 / 缺 pcPeerId / 过期 / 无 DID）+ LAN 失败 fallback 中继 + ICE servers 持久化 |
| `DesktopPairingViewModelTests.swift` | ≥ 8 | 状态机 happy path + expired + confirmation 不匹配静默丢弃 |
| `ManualPairingViewModelTests.swift` | ≥ 4 | code 格式 / HTTP 失败 / 成功 |
| `PairingMessageBusTests.swift` | ≥ 3 | emit / 多订阅者 / 缓冲溢出 |

### 10.2 UI 测试（XCUITest）

- Flow B happy path：launch → Settings → 扫描桌面 QR → mock scanner output → success 屏出现
- Flow A happy path：Settings → 显示我的 QR → mock signaling confirmation → completed 屏出现
- 三 tab 切换不丢状态

### 10.3 真机 E2E (Phase 1.7)

| 设备 | 路径 | 验收 |
|------|------|------|
| iPhone + Mac (USB tether) | LAN signaling | 三流各 1 次成功 |
| iPhone + Win 11 (同 WiFi) | LAN signaling | 三流各 1 次成功 |
| iPhone (4G) + 桌面 (家里 WiFi) | 公网 `wss://signaling.chainlesschain.com` | Flow B 至少 1 次成功；ICE servers 凭证 24h 过期前可用 |

## 11. iOS 特有风险 & open questions

| 风险 | 影响 | 应对 |
|------|------|------|
| URLSessionWebSocketTask 在 iOS 14 下 ping 接口有 bug | 低 — Pairing 是用户主动操作，30s 内完成 | minimum target 锁 iOS 15+；查 deployment target |
| 用户在 Pairing 中按 Home → 30s 后 socket 被系统挂起 | 中 — 用户回来时 ack 可能已超时 | UI 显示倒计时 + 后台进入时主动 reset()，回到前台时 retry |
| WebRTC SDK (`WebRTC` SPM) 在 Mac Catalyst / iOS Simulator 上 link 行为不同 | 低（Phase 1 不直接用 WebRTC SDK，只在 Phase 2 暴露） | Phase 1 仅 import `WebRTC` 在 `Features/Social/Services/WebRTCManager.swift`，不扩散 |
| `iceServers` 凭证 24h 过期后无 refresh 路径 | 中 | Phase 1 接受这个，UI 显示「需重新配对」；Phase 3 加自动 refresh |
| iOS minimum target | 决定能否用 `async/await`（13+）/ `actor`（13+）/ `URLSessionWebSocketTask`（13+） | **需用户确认**（见下） |

### 决策记录（2026-05-15 锁定）

| # | 决策 | 理由 |
|---|------|------|
| **Q1** iOS min target | **iOS 15**（不动现有基线） | 现有 `ChainlessChain.xcodeproj` `IPHONEOS_DEPLOYMENT_TARGET = 15.0` + `Package.swift` `.iOS(.v15)`。`async`/`actor`/`URLSessionWebSocketTask` 都 13+ 就有，本 Phase 不需 16+ 新特性。`Observable` macro 是 17+ 不是 16。 |
| **Q2** DI 模式 | **(B) `PairingDependencies` struct 注入**，禁 `static let shared` | XCTest 注入 fake 干净；现有 `WebRTCManager.shared` 单例模式实战测试难，新模块不重蹈覆辙。 |
| **Q3** 手输 code 桌面端配合 | **同步开 follow-up issue，但 Phase 1 不阻塞** | Sub-phase 1.6 排最后；若桌面端没及时落，1.6 降级为 "功能开发中" stub，不阻塞 1.7 真机 E2E（Flow A + B 就能验收）。 |
| **Q4** `deviceId()` | **Keychain 持久化自生成 UUID**（首次启动写入，永不变） | `identifierForVendor` 重装会变 = 桌面把同一台 iPhone 当两台 = 已配对列表脏数据。 |
| **Q5** UI 风格 | **iOS HIG**（不抄 Material 3） | Settings 用 `Form` + `Section`，扫码屏用 SwiftUI 原生 sheet；QR display 屏复用「方形 + 6 位 code 大字」platform-agnostic 布局。 |

## 12. 不在范围（明确 defer）

- **远程桌面终端 (Plan A.1 移植)** → Phase 2 单独 design doc，依赖 Phase 1 的 `PairedDesktopsStore` + WebRTC infra
- **远程操控 framework**（RemoteSkillRegistry / OfflineCommandQueue / commands envelope）→ Phase 3
- **WatchOS 扩展** — 不在路线图
- **同步 / 剪贴板 / OCR / voice** → Phase 4+
- **SSE push 实时化** → 等桌面 + Android W3.8 落地后 iOS 跟进

---

## 附录 A — 关键文件指针（实施时 reference）

桌面端（已稳定，**禁止改字段名**）：
- WS handler: `desktop-app-vue/src/main/web-shell/handlers/desktop-pair-handlers.js`（`recordPairAck` export）
- bridge intercept: `desktop-app-vue/src/main/p2p/mobile-bridge.js`（`type==="pair-ack"` 分支）
- Vue UI: `packages/web-panel/src/views/MobileBridge.vue`
- 桌面 device-pairing handler（Flow A）: `desktop-app-vue/src/main/p2p/device-pairing-handler.js`

Android 端（移植参考，**逐文件比照**）：
- ScanDesktop ViewModel: `android-app/feature-p2p/.../viewmodel/ScanDesktopPairingViewModel.kt`
- Desktop ViewModel (Flow A): `android-app/feature-p2p/.../viewmodel/DesktopPairingViewModel.kt`
- PairingSignalingGate interface: `android-app/core-p2p/.../pairing/PairingSignalingGate.kt`
- WebSocketPairingSignalingGate impl: `android-app/app/.../remote/webrtc/WebSocketPairingSignalingGate.kt`
- PairedDesktopsStore: `android-app/core-p2p/.../pairing/PairedDesktopsStore.kt`
- PairingMessageBus: `android-app/core-p2p/.../pairing/PairingMessageBus.kt`

memory（强烈建议读完再开工）：
- `desktop_qr_pairing_flow_b.md` — 9 实战坑（必看）
- `desktop_qr_pairing_flow_a.md` — Flow A 架构 + dead code 警告
- `feedback_currentpeerid_target_vs_self_trap.md` — Plan A.1 echo-loop bug，iOS 同样会中
- `feedback_cross_shell_feature_pattern.md` — 桌面三壳 + 双 WS gateway 注册（Phase 2 远程终端会用到）

---

## 附录 B — 文档同步 follow-up

本文件命名是英文。两个 sync 脚本 `ROOT_FILE_MAP` 历史 trap（memory `docs_site_sync_unmapped_fallthrough.md`）针对未映射文件 silent 落到 `unknown-unmapped.md`。

**决策**：Phase 1 提交此文件时**同 commit 补两处映射**，跑一次 sync 验文档站可见：
- `docs-site/scripts/sync-design-docs.js` ROOT_FILE_MAP 加 `'iOS_Phase_1_Pairing_Flow_B.md': 'mobile/ios/phase-1-pairing.md'`
- `docs-site-design/scripts/sync-docs.js` ROOT_FILE_MAP 加同样 entry
- 跑 `node docs-site/scripts/sync-design-docs.js && node docs-site-design/scripts/sync-docs.js`
- 验 `docs-site/docs/design/mobile/ios/phase-1-pairing.md` 与 `docs-site-design/docs/mobile/ios/phase-1-pairing.md` 都有内容、不是 `unknown-unmapped.md`
