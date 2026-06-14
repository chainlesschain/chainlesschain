# iOS Phase 6.6 — Desktop Skill (远程桌面流式画面 + 输入控制)

> **状态**：v0.1 草案（2026-05-18 创建）。Phase 6.6 是 Phase 6 最复杂 skill；本文档为实施前 design，需 OQ 1-7 用户拍板后再开 sub-phase 6.6.1。
>
> **依赖**：Phase 6.1B1 RemoteCommandClient framework 全套（commandClient.invoke + events stream + LRUSet）；Phase 6.1B1 InputCommands 触控板 UI 模式可参考；Phase 5 AIChatEventDispatcher fan-out 模式（如果走 frame push 协议）。
>
> **对齐版本**：Android `app/src/main/java/.../remote/commands/DesktopCommands.kt`（568 LOC，**51 unique invoke**）；桌面 `desktop-app-vue/src/main/remote/handlers/remote-desktop-handler.js`（**7 outer case + sendInput 5 sub-type**）。
>
> **关联文档**：`iOS_对标_Android_Phase_6_Plan.md` §5.6 / `Desktop_Mobile_Bridge_Namespace_Coverage.md` §3.1 (Trap T2 deferred 问题本文档解决) / `iOS_Phase_2_Remote_Terminal.md`（终端 stdout 流式参考）；memory `ios_phase_6_skill_template.md`（Phase 6.1B1/B3 模板）/ `ios_remote_ai_chat_phase5.md`（流式 dispatcher 模式）

---

## 1. 背景 & 现状审计

### 1.1 Phase 6.6 与 Phase 2 关系

Phase 2 已 land **远程终端**（shell stdin/stdout 文本流，WebRTC DC + signaling 双路径）。Phase 6.6 **不是** Phase 2 的扩展 —— 远程桌面是另一套独立 skill：
- Phase 2 = 文本流（kB/s 带宽，bash/zsh shell session）
- Phase 6.6 = 屏幕画面流（**MB/s** 带宽，30 FPS JPEG frames）+ 鼠键输入流（kB/s 高频小消息）

两者复用同一 RemoteCommandClient + DC，但帧率/带宽规模差 1000x，**协议 trade-off 完全不同**。

### 1.2 关键审计发现（解决 Coverage doc §3.1 deferred 问题）

Coverage doc §1.4 表写 `desktop A=51 D=12 ✓=7 (13%)`，§3.1 注 "桌面 12 case 但部分走 sendInput 内层 sub-dispatch — 实际覆盖待 §3 深入"。本节给出深入结论：

**桌面 `remote-desktop-handler.js` 真实结构**（gist：line 80-108 + line 425-443）：

| 层 | Case 数 | 内容 |
|---|---:|---|
| 外层 `handle(action, ...)` switch | **7** | `startSession` / `stopSession` / `getFrame` / `sendInput` / `getDisplays` / `switchDisplay` / `getStats` |
| 内层 `sendInput.type` sub-switch | **5** | `mouse_move` / `mouse_click` / `mouse_scroll` / `key_press` / `key_type` |
| 私有 `async handleX(data)` | 5 | 上述 5 sub-type 的实现，**不是入口** — Coverage grep 误把它们计入 "case branches" |

实际可被 mobile 调用的 wire method 总数 = **7 + 5 sub-type 通过 sendInput 路由 = 12**，与 Coverage doc 数字一致；但语义结构完全不同。

**Android 已用这套 sub-dispatch**：`DesktopCommands.kt` 中 5 个鼠键 method（`sendKeyPress` / `sendMouseMove` / `sendMouseClick` / `sendMouseScroll` / `sendKeyType`）**全部** 走 `client.invoke("desktop.sendInput", params={sessionId, type, data})`。Android 没有调用 `desktop.mouseMove`、`desktop.keyPress` 等顶层伪 method。

✅ **Trap T2 解决**：iOS 跟 Android 同 sub-dispatch 路径，**不**走顶层伪 method（如 `desktop.mouseMove`），否则 desktop handler 7-case switch 直接 throw "Unknown action"。

### 1.3 Android 51 invoke 的真相

Coverage doc 数到的 51 unique invokes：

| 桌面 supported 7 (映射 OK) | Android only 44 (桌面缺) |
|---|---|
| startSession / stopSession / getFrame / sendInput / getDisplays / switchDisplay / getStats | adjustQuality / pauseSession / resumeSession / getSessionInfo / listSessions / captureRegion / captureWindow / screenshot / listWindows / getWindowInfo / closeWindow / focusWindow / minimizeWindow / maximizeWindow / moveWindow / resizeWindow / restoreWindow / getClipboard / setClipboard / clearClipboard / watchClipboard / drawAnnotation / clearAnnotations / undoAnnotation / lockScreen / sleep / shutdown / cancelShutdown / restart / getPowerStatus / setVolume / getVolume / setMute / listAudioDevices / setAudioStream / startRecording / stopRecording / pauseRecording / resumeRecording / getRecordingStatus / listRecordings / sendNotification / ocrImage / ocrRegion |

44 个 Android-only method 都会在桌面端返 `Unknown action: <X>`。**iOS Phase 6.6 v0.1 不 impl 这 44 个**（与 6.1B3 strategy A 一致：iOS 只 impl 桌面已支持 method）。这 44 method 留 Phase 7+ 桌面 debt backlog，相当一部分实际能用其它 namespace 替代：
- 窗口控制 → `display.getWindowList` (Phase 6.1B1 ✅)
- 剪贴板 → `clipboard.*` (Phase 3.3 ✅)
- 音量 → `media.*` (Phase 6.2 ✅)
- 截屏 → `display.screenshot` (Phase 6.1B1 ✅)
- 通知 → `notification.send` (Phase 4 ✅)
- 电源 → `power.*` (Phase 6.1B3 ✅)
- 录屏 / OCR / annotation → 桌面端需新增 handler 才能用

### 1.4 修正 Phase 6 Plan §1.3 表

Plan §1.3 desktop 行写 "桌面 debt 待 §3.1 验" — 本文档结论：

| 项 | 修正后 |
|---|---|
| Android invoke method | 51 |
| 桌面真实可用 method | **7 outer + 5 sub-type = 12** |
| Android-only method (桌面 Unknown action) | **44** |
| 桌面 debt | **不需要为 Phase 6.6 v0.1 补任何 method** — 桌面已支持 7 + 5 足够；44 缺失 method 多数已在其它 namespace 替代覆盖 |

**重大修正**：Phase 6 Plan §7 Trap T10 把 desktop 列为"待 §3.1 验"的桌面 debt 大头 — 实际**桌面 debt = 0**（按 v0.1 scope）。Phase 6 Plan §8 时间线 desktop 14 天主要消耗在 **frame streaming protocol + 触摸板/键盘 UI**，不是桌面端协作。

---

## 2. 目标 & 非目标

### 2.1 目标（Phase 6.6 in scope）

| # | 项 | 验收 |
|---|---|---|
| G1 | `DesktopCommands` 7 method (startSession/stopSession/getFrame/sendInput/getDisplays/switchDisplay/getStats) + 5 sendInput typed wrapper | 单测 ≥ 25；envelope shape 与 Android `DesktopCommands.kt` 二进制兼容 |
| G2 | `DesktopFrameStreamer` actor — pull-based getFrame 调用 + 节流 + 帧 buffer 管理 + 重叠请求避免 | 单测 ≥ 12；mock 1Hz/10Hz/30Hz pacing 行为正确 |
| G3 | `RemoteDesktopView` SwiftUI — 全屏画面 + 触控板叠加层 + 工具栏（显示器切换 / 暂停 / 质量调整） | 真机：iPhone 看到桌面画面 + 触摸控鼠标 + 30 FPS 平滑度（蜂窝 5-10 FPS 可接受降级） |
| G4 | DI wire + RemoteOperateView 第 13 tab "桌面"（icon `display.2`） | UI 验证：tab picker 横向滚动加 1 项无视觉破坏 |
| G5 | Coverage doc §3.1 / Phase 6 Plan §1.3 / §7 修正回写 | doc commit；§7 Trap T2 标完全解决（沿用本文档结论）|
| G6 | Frame buffer 内存安全 — 高分辨率 / 网络拥塞下不爆 RAM | 集成测试：模拟 10MB frame backlog 不 crash |

### 2.2 非目标（defer 到 Phase 7+）

- **44 个 Android-only method**（adjustQuality / 窗口 CRUD / annotations / OCR / recordings 等）— 桌面端未 wire，多数已在其它 namespace 覆盖
- **WebRTC video track** — 用浏览器原生 VideoCodec 编码而不是 JPEG/PNG 帧。性能跨数量级提升但协议改造极大（需桌面端起 webrtc track + iOS 端接收 RTP），留 Phase 8+
- **差分编码 / 帧间压缩**（`enableDifferentialEncoding` 在桌面 DEFAULT_CONFIG 是预留 false）— 节省带宽 5-10x 但实现复杂，桌面端目前未启用
- **硬件解码加速**（VideoToolbox）— 30 FPS JPEG 软解 in SwiftUI Image 已够 iPhone 14 性能，留 Phase 7+
- **多 session 并发**（一个 iOS 同时控 2 桌面）— v0.1 单 active session
- **session 断线自动恢复**（DC 中断 → 自动 retry startSession）— v0.1 用户手动重启
- **录屏** / **annotation 标注** / **OCR 截屏** — 桌面端 RemoteDesktopHandler 未支持
- **clipboard 集成**（`watchClipboard` 推送）— 已在 Phase 3.3 ClipboardCommands 覆盖
- **触摸手势映射**（pinch zoom → 滚轮 / 双指扫 → 中键 等）— v0.1 单指 = mouseMove + tap = click + 双击 = doubleClick + 长按 = right click；多指留 v0.2
- **键盘特殊键**（Cmd+Tab / function keys / F-row）— v0.1 复用 Phase 6.1B1 RemoteInputView 扩展键盘 sheet 路径，desktop skill 仅触发 modifier 组合
- **画面缩放 / pan**（iOS 端视口 transform）— v0.1 fit-to-screen；pinch zoom 留 v0.2

---

## 3. Open Questions

### OQ-1：Frame 协议 — pull-based polling vs push-based event 子流

**A**：**Pull-based polling (Android 现行模式)** — iOS 端 30 FPS loop 调 `getFrame`，每次 DC RPC roundtrip
- 优点：协议简单，与 Android 100% 兼容，无需桌面端改动
- 缺点：每帧多 1 个 RPC reqId/response envelope (~120 字节 overhead) + DC RTT 浪费；30 FPS × 100ms RTT = 不可能实现真 30 FPS（实际限制 5-10 FPS in 蜂窝）

**B**：**Push-based event 子流** — iOS startSession 后桌面端按 maxFps 主动 push `desktop.frame` event（与 Phase 4 notification push / Phase 5 chat chunk 同模式，走 `commandClient.events` fan-out 第 4 子流）
- 优点：去 RPC overhead，桌面端可按真实 capture 速率 push，零 mobile-side 节流逻辑
- 缺点：**桌面端需改造 RemoteDesktopHandler** 加 push 路径 + flow control（mobile 渲染不过来时反压）；与 Android pull-based 模式不兼容 → 桌面端要同时支持两路径，复杂度上升

**C**：**WebRTC video track**（独立 track，非 DC 消息）
- 优点：浏览器/iOS 原生 video 解码 + 硬件加速 + 自适应码率 + RTP 网络控
- 缺点：协议改造极大（桌面端 wrtc 起 video track + iOS WKWebRTC 接 RTP），与 Phase 2 既有 DC framework 完全分离，**Phase 8+ 才合理**

**推荐 A（v0.1）→ B（v0.2 桌面端协作后）→ C（Phase 8+ 长期）**。理由：
- (1) Android 已在生产用 A，iOS v0.1 跟同模式立即可用；
- (2) 真实 mobile 端 30 FPS 是奢望，10-15 FPS 足够远程办公场景，DC RPC overhead 不是 bottleneck（JPEG 编码 + 网络才是）；
- (3) B 选项是 v0.2 优化，需桌面端协调（Phase 7+ desktop debt）；
- (4) iOS-side framework 应**预留** push 路径 — `DesktopFrameStreamer` 设计支持两种 source（pull task + event subscription），切换 by feature flag。

### OQ-2：Frame 节流策略 — 时间窗 vs 信号量 vs in-flight 限制

桌面 `getFrame` server-side 节流 33ms（line 274-282）超 frame rate 则 throw "Frame rate limit exceeded"。iOS 端需配合避免无效请求 + 处理 throw。3 选项：

**A**：**时间窗节流**：iOS 端记录 lastFrameAt，距上次 < 33ms 不发请求
- 简单；可能与 server 时钟不同步导致仍触发 server throw

**B**：**信号量限 1 in-flight**：同时只允许 1 个 getFrame 在飞行，前一个 response 来才发下一个
- 自然限制 = round-trip time，慢网下自动降 FPS
- 与 server 节流和谐共存（server 不会拒，因为 mobile 自动慢）

**C**：**双控制**：A + B 同时启用（时间窗 + 信号量）
- 最保守

**推荐 B**。理由：(1) DC RTT 决定 FPS 上限，B 天然适配；(2) A 在变化网络下要么过度保守要么仍触发 server throw；(3) 后续 OQ-1 推 push 协议时 B 也不浪费（不需要 in-flight 概念）。**catch server 'Frame rate limit exceeded' error 时记忽略 + 退避 50ms**。

### OQ-3：触摸控制语义映射

iOS 触摸手势 → 桌面鼠键事件需要明确映射。OQ：

| iOS 手势 | 桌面动作 | sendInput.type | 备注 |
|---|---|---|---|
| 单指 drag | mouseMove (relative) | `mouse_move` (data: {x, y}) | 桌面 robot.moveMouse 是绝对坐标 — iOS 需累加/转绝对（OQ-4）|
| 单指 tap | mouseClick(.left) | `mouse_click` (data: {button: "left", double: false}) | |
| 单指 double-tap | mouseDoubleClick(.left) | `mouse_click` (data: {button: "left", double: true}) | |
| 单指 long-press | mouseClick(.right) | `mouse_click` (data: {button: "right"}) | |
| 双指 drag | mouseScroll | `mouse_scroll` (data: {dx, dy}) | |
| 双指 tap | mouseClick(.middle) | `mouse_click` (data: {button: "middle"}) | |
| Pinch | (v0.2) | — | |
| 3 指 swipe | (v0.2) | — | |

**OQ**：iOS 端是否做 mouseMove 节流（与 OQ-2 类似但反方向）？60 FPS 触摸事件流 → 桌面 robot.moveMouse 60 Hz 完全没必要（桌面 monitor refresh 也就 60 Hz）。

**推荐**：**iOS 端 16ms throttle mouseMove**（60 FPS 上限），与 Phase 6.1B1 RemoteInputView 同模式。mouseClick / mouseScroll / keyPress 无节流。

### OQ-4：mouseMove 坐标 — 绝对 vs 相对

桌面 robot.moveMouse(x, y) 是 **绝对坐标**（屏幕像素），iOS 触摸 drag delta 是 **相对**。3 转换路径：

**A**：iOS 端转绝对 — iOS 维护"虚拟光标位置"（startSession 时拉 `displayId` 的实际分辨率，touch delta 加到 virtual cursor → 发绝对）
- 桌面端 robot 直接用
- iOS 与桌面分辨率脱节风险（用户换显示器、改分辨率）

**B**：桌面端支持相对坐标 — 改 RemoteDesktopHandler.handleMouseMove 加 `relative: true` 参数，robot.moveMouseSmooth 或自取当前位置 + delta
- 协议升级，桌面端要改
- iOS 端逻辑简单

**C**：iOS 累加 + display.getResolution clamp — iOS 端虚拟光标 + 周期性 sync to 真实 cursor (调 `display.getCursorPosition` 校准)
- 折衷

**推荐 A**。理由：(1) Android 当前也走绝对（Android `sendMouseMove(x, y)` 注释明确 "X 坐标" "Y 坐标"，没说 relative）；(2) iOS startSession 已知 displayId + 分辨率（从 getDisplays 拉），维护 virtual cursor 可行；(3) iOS 端可加"重置光标位置"按钮兜底分辨率漂移。详细 cursor sync 协议见 §4.3。

### OQ-5：单 active session vs N 并发

桌面端 RemoteDesktopHandler.sessions 是 Map，理论支持多 session（同 mobile 同时控 2 桌面 / 多 mobile 控同 1 桌面）。iOS v0.1：

**A**：**单 active session**（与 Phase 2 RemoteTerminal 一致）
- 简单；多 device 切换前必 stopSession
- 已配对桌面只能控 1 个

**B**：**N session 并发**
- iOS 端复杂度上升（多 sessionId 状态管理）

**推荐 A**。理由：用户场景"地铁里看一眼公司电脑屏幕"，多 session 是 nice-to-have，**Phase 6 Plan §1.2 v0.1 单 active 桌面** 已对齐 Phase 2 决策。

### OQ-6：Frame 渲染 — `Image(uiImage:)` vs `Image(data:)` vs `CALayer.contents`

iPhone 端 30 FPS JPEG 解码 + 渲染 3 路径：

**A**：每帧 `UIImage(data:)` → `Image(uiImage:)` 重建 SwiftUI Image
- 简单；但 SwiftUI Image 不是为 30 FPS 重建设计，可能掉帧

**B**：UIViewRepresentable + UIImageView，每帧 `imageView.image = UIImage(data:)`
- 跨 SwiftUI/UIKit 边界；UIImageView 是 GPU-friendly

**C**：UIViewRepresentable + CALayer + contents = CGImage（低层）
- 最快；但调试难，错过 SwiftUI 优化

**推荐 B**。理由：(1) UIImageView 是 iOS 长期优化的图像渲染 view，30 FPS 替换 CGImage 是常见用例；(2) SwiftUI Image 在 30 FPS 重建会触发 layout pass — UIImageView 不会；(3) Phase 7+ 切 WebRTC video track 时整个 view 全换 WKWebRTCViewRepresentable，B 改动局部。

### OQ-7：iOS 端 frame buffer 容量 — drop-old vs drop-new vs unbounded

DC 接收到 frame data 到 UI 渲染之间需 buffer。3 策略：

**A**：**bounded buffer drop-old**（最新帧总在）— 收到新 frame 立刻覆盖未渲染的旧 frame
- 用户体验"最新画面"延迟最低
- 旧帧丢

**B**：**bounded buffer drop-new** — buffer 满拒绝新 frame
- 渲染队列保序但延迟堆积

**C**：**unbounded** — 不限大小，全部 buffer
- RAM 爆炸风险

**推荐 A**。理由：远程桌面"看实时画面"语义 = 最新最重要；旧帧 = 信息已过时；OOM 风险用 drop-old 完全避免。**容量 = 1**（替换式）。

---

## 4. 协议设计

### 4.1 wire 协议（v0.1 — 与 Android 100% 兼容）

复用桌面 `remote-desktop-handler.js` 7 outer + 5 sendInput sub-type 的现行协议，iOS 不引入任何新 wire 协议：

#### startSession
```json
// Request
{"type": "chainlesschain:command:request",
 "payload": {"id": "<reqId>", "method": "desktop.startSession",
             "params": {"displayId": 0, "quality": 80, "maxFps": 30}}}
// Response
{"type": "chainlesschain:command:response",
 "payload": {"id": "<reqId>", "result": {
   "success": true, "sessionId": "desktop-1700000000000-abc123",
   "displayId": 0, "quality": 80, "maxFps": 30,
   "captureInterval": 33, "width": 1920, "height": 1080
 }}}
```

#### getFrame (pull)
```json
// Request (mobile pulls each frame; OQ-2 限 1 in-flight)
{"type": "chainlesschain:command:request",
 "payload": {"id": "<reqId>", "method": "desktop.getFrame",
             "params": {"sessionId": "<sessionId>", "displayId": 0}}}
// Response
{"type": "chainlesschain:command:response",
 "payload": {"id": "<reqId>", "result": {
   "success": true, "data": "<base64 JPEG>",
   "format": "jpeg", "width": 1920, "height": 1080,
   "size": 51234, "captureTime": 15, "encodeTime": 8
 }}}
// Error (server-side rate limit)
{"type": "chainlesschain:command:response",
 "payload": {"id": "<reqId>", "error": "Frame rate limit exceeded. Wait 12ms"}}
```

#### sendInput (sub-dispatch)
```json
// mouseMove (absolute coords per OQ-4)
{"method": "desktop.sendInput",
 "params": {"sessionId": "<id>", "type": "mouse_move", "data": {"x": 800, "y": 600}}}

// mouseClick
{"method": "desktop.sendInput",
 "params": {"sessionId": "<id>", "type": "mouse_click",
            "data": {"button": "left", "double": false}}}

// mouseScroll
{"method": "desktop.sendInput",
 "params": {"sessionId": "<id>", "type": "mouse_scroll", "data": {"dx": 0, "dy": -3}}}

// keyPress (含 modifiers)
{"method": "desktop.sendInput",
 "params": {"sessionId": "<id>", "type": "key_press",
            "data": {"key": "c", "modifiers": ["control"]}}}

// keyType (输入字符串)
{"method": "desktop.sendInput",
 "params": {"sessionId": "<id>", "type": "key_type", "data": {"text": "hello"}}}
```

### 4.2 iOS-side framework 设计

```swift
// Modules/CoreP2P/Sources/RemoteSkills/Desktop/
├─ DesktopModels.swift       // SessionInfo / FrameData / InputEvent enums
├─ DesktopCommands.swift     // actor — 7 typed wrapper + 5 sendInput-routed helper
└─ DesktopFrameStreamer.swift // actor — pull loop + in-flight semaphore + buffer

// Features/RemoteOperate/
├─ RemoteDesktopView.swift   // 全屏画面 + 触控板叠加 + 工具栏
└─ DesktopFrameView.swift    // UIViewRepresentable + UIImageView (OQ-6)
```

### 4.3 mouseMove 坐标转换（OQ-4 A 选项细化）

```swift
public actor DesktopVirtualCursor {
    private var x: Int = 0
    private var y: Int = 0
    private var screenWidth: Int = 1920
    private var screenHeight: Int = 1080

    public func reset(toX: Int, toY: Int) { x = toX; y = toY }
    public func setScreen(width: Int, height: Int) {
        screenWidth = width; screenHeight = height
        x = min(x, width - 1); y = min(y, height - 1)
    }
    public func applyDelta(dx: Int, dy: Int) -> (x: Int, y: Int) {
        x = max(0, min(screenWidth - 1, x + dx))
        y = max(0, min(screenHeight - 1, y + dy))
        return (x, y)
    }
}
```

在 startSession 时拉 displays + 用 displayId 对应分辨率 init screen size + 调 `display.getCursorPosition` 拉初始位置；以后每个 touch delta 走 `applyDelta` → 发绝对坐标 mouseMove。用户可"重置"按钮强制 `display.getCursorPosition` 校准。

### 4.4 DesktopFrameStreamer 状态机

```
[Idle] --startSession--> [Connecting] --sessionId received--> [Streaming]
[Streaming] --pullLoop--> getFrame (in-flight=1) --frame--> buffer.replace --> UI render
[Streaming] --stopSession--> [Closing] --ack--> [Idle]
[Streaming] --DC drop--> [Reconnecting] (v0.2; v0.1 直接 → Idle + UI error)
[Streaming] --pause--> [Paused] (停 pullLoop; 不 stopSession; v0.1 暂不实现)
```

### 4.5 fan-out 子流（OQ-1 B 选项预留 — Phase 6.6 v0.2 接通）

Phase 4/5 events fan-out 已有 terminalEvents / notificationEvents / aiChatEvents 三子流。Phase 6.6 v0.2 push 协议加第 4 子流 `desktopFrameEventsStream`：

```swift
// RemoteDependencies.swift v0.2
var desktopLocal: AsyncStream<String>.Continuation!
let desktopFrameEventsStream = AsyncStream<String>(
    bufferingPolicy: .bufferingNewest(2)   // OQ-7 drop-old; 容量 1-2 帧
) { c in desktopLocal = c }

// fan-out task 加第 4 yield
self.eventFanOutTask = Task {
    for await raw in cmdClient.events {
        terminalEventsContinuation.yield(raw)
        notificationEventsContinuation.yield(raw)
        aiChatEventsContinuation.yield(raw)
        desktopLocal.yield(raw)  // ← v0.2 新增
    }
    // finish all 4 streams
}
```

v0.1 不 wire — `DesktopFrameStreamer` 走 pull-based。但 Models / Commands 接口设计预留 push path, 切换时只改 streamer impl。

---

## 5. 子阶段 (Sub-phases)

### Phase 6.6.1 — DesktopModels + DesktopCommands actor（基础协议层）

**时间**：1-2 天

- `DesktopModels.swift`: SessionInfo / FrameData / InputEvent enum (with mouseButton, scrollDelta, key, modifiers) / DisplayInfo (复用 Phase 6.1B1 `DisplayInfo` 还是 desktop session-specific?)
- `DesktopCommands.swift`: actor with 7 method (startSession / stopSession / getFrame / sendInput / getDisplays / switchDisplay / getStats) + 5 typed helpers (mouseMove / mouseClick / mouseScroll / keyPress / keyType) 全部 route to sendInput
- 单测 ≥ 25 (每 method 1 envelope + 1 happy decode + 1 error path)

### Phase 6.6.2 — DesktopVirtualCursor (OQ-4 A 实现)

**时间**：0.5 天

- actor with applyDelta / reset / setScreen
- 单测 ≥ 6 (clamp 边界 / 多 delta 累加 / reset / setScreen 缩小后 clamp)

### Phase 6.6.3 — DesktopFrameStreamer actor

**时间**：2-3 天

- pull loop: while session active, getFrame with in-flight=1 semaphore (OQ-2 B)
- bounded buffer cap=1 (OQ-7 A drop-old)
- 错误处理：catch server 'Frame rate limit exceeded' → 退避 50ms 重试；DC drop → cancel loop + emit error
- 单测 ≥ 12 (pacing / drop-old / 错误退避 / cancel / pause-resume v0.1 stub)

### Phase 6.6.4 — RemoteDesktopView + DesktopFrameView

**时间**：3-4 天

- DesktopFrameView (UIViewRepresentable + UIImageView per OQ-6 B): @Binding latestFrame Data → frame data 变化 → 主线程 imageView.image 更新
- RemoteDesktopView 顶层结构:
  - 顶部 toolbar: 显示器 picker (getDisplays) + 暂停/恢复 + 质量 picker + 退出 (stopSession)
  - 中段: DesktopFrameView (zoomable scrollview 包装；v0.1 fit-to-screen, v0.2 加 pinch zoom)
  - 底部 / 全屏叠加: 触控板手势识别 (OQ-3) — DragGesture 累 → applyDelta → sendInput(mouse_move)
  - 虚拟键盘 toggle (复用 Phase 6.1B1 RemoteInputView 扩展键盘 sheet — 但触发 desktop.sendInput(key_press) 而非 input.sendKeyPress)
- 状态：connecting / streaming / paused / error

### Phase 6.6.5 — DI wire + RemoteOperateView 第 13 tab

**时间**：0.5 天

- `RemoteDependencies.swift`: 加 `desktop: DesktopCommands` + `desktopStreamer: DesktopFrameStreamer` + `desktopVirtualCursor: DesktopVirtualCursor`
- `RemoteOperateView.swift`: tab enum 加 `case desktop` (icon `display.2`, label "桌面")
- 单测：1 集成测试 RemoteDeps wire 正确

### Phase 6.6.6 — 收口 + doc 回写

**时间**：1 天

- 修正 `Desktop_Mobile_Bridge_Namespace_Coverage.md` §3.1 (Trap T2) 标完全解决，链回本文档
- 修正 `iOS_对标_Android_Phase_6_Plan.md` §1.3 desktop 行 + §7 Trap T10 desktop debt 行
- 写 memory `ios_remote_desktop_phase6_6.md` (8-10 实施 trap 预期)
- 累计单测 ≥ 50；iOS 测试总数 ~566 → ~620

**Exit criteria 总**：
- 7 desktop method + 5 sub-dispatch 全 wire；单测 50+
- 真机 E2E：iPhone 看到桌面画面 (LAN 15-30 FPS 流畅；蜂窝 5-10 FPS 可接受)
- 触摸控鼠标延迟 ≤ 200ms (LAN) / ≤ 500ms (蜂窝)
- 10MB JPEG backlog 不 OOM
- 退出 session 后 1s 内 desktop handler 释放资源

---

## 6. 测试 (Test Plan)

### 6.1 单测分布

| 子阶段 | 单测数（估）|
|---|---:|
| 6.6.1 DesktopCommands | 25 (7 method × 3 + 5 sendInput sub-type × 1) |
| 6.6.2 DesktopVirtualCursor | 6 |
| 6.6.3 DesktopFrameStreamer | 12 |
| 6.6.4 RemoteDesktopView (SwiftUI; 不易测) | 0 |
| 6.6.5 DI wire | 1 集成 |
| **总计** | **~44 unit + 1 integration** |

### 6.2 集成测试

- DC fake transport：mock startSession → getFrame N 次 → stopSession 全链路
- 错误退避：server 持续返 "Frame rate limit exceeded" → 退避 + 重试 → 50ms 间隔验证
- 多并发触摸：100 个 sendInput(mouse_move) 排队 — 验证 16ms throttle 工作

### 6.3 真机 E2E（Mac + iPhone + 真桌面）

| # | 场景 | 验收 |
|---|---|---|
| E1 | LAN 同 WiFi 进 桌面 tab → 看到桌面画面 | ≤ 2s 内首帧；之后 15-30 FPS 平滑 |
| E2 | 蜂窝网（关 WiFi 走 4G）→ 看到桌面画面 | ≤ 5s 内首帧；之后 5-10 FPS 可接受 |
| E3 | 触摸 drag → 桌面鼠标移动 | 延迟 ≤ 200ms (LAN) / ≤ 500ms (蜂窝) |
| E4 | 触摸 tap → 左键单击 | 桌面端真触发；浏览器/Finder 可见 |
| E5 | 双指 drag → 滚动 | 桌面端滚轮事件触发 |
| E6 | 长按 → 右键 | 桌面端右键菜单弹出 |
| E7 | 虚拟键盘 Cmd+Tab → 桌面切换应用 | 真切换 |
| E8 | 切换显示器 (getDisplays 返 2 屏 → switchDisplay) | 第 2 屏画面出现 |
| E9 | stopSession → 退出 tab → 桌面端 desktop 资源释放（session map 减 1）| getStats 验证 |
| E10 | 高分辨率 4K 桌面 → 自动 resize 到 1920 (桌面 DEFAULT_CONFIG.width) | 不 OOM；画面比例正确 |

---

## 7. 风险 & 实施 trap 预备

### 7.1 已知 trap（Phase 6.1B1-6.5 累积，本 Phase 沿用）

参考 memory `ios_phase_6_skill_template.md`（12 trap）+ Phase 1-5 累积 trap memory。

### 7.2 Phase 6.6 新预期 trap

#### Trap D1 — 30 FPS 软解 JPEG 在低端 iPhone 卡顿
iPhone XS / 11 等老机器 30 FPS 1920×1080 JPEG 解码 可能 CPU 100% 掉帧。**预防**：动态降低 maxFps 请求（startSession 时根据 `UIDevice.current.userInterfaceIdiom` + 启发式拉低到 15 FPS for older devices）。E2 蜂窝场景天然 cap 10 FPS 也减压。

#### Trap D2 — UIImageView 主线程 update 与 SwiftUI re-render 不同步
SwiftUI 状态变化触发整个 view tree rebuild，UIImageView.image = ... 在 makeUIView 或 updateUIView 哪个里调？应在 `updateUIView` 里，并且**只在 binding 变化时**，否则每帧 SwiftUI re-render 都触发 makeUIView 重建 UIImageView = 性能灾难。

#### Trap D3 — virtual cursor 与桌面 cursor 漂移
iOS 维护的 virtual cursor (OQ-4 A) 与桌面真实 cursor 可能脱节（用户在桌面侧物理动鼠标 / 切换显示器 / 改分辨率）。**预防**：每 5s 调 `display.getCursorPosition` 校准；iOS toolbar 加"重置光标"按钮。

#### Trap D4 — session 资源泄漏
iOS app crash / 强制退出未调 stopSession → 桌面端 session 永远 active 占资源。**预防**：startSession 时 server-side 加 idle timeout (60s 无 getFrame 自动 stop)；iOS 端 onDisappear / scenePhase=.background 也调 stopSession。

#### Trap D5 — `desktop.mouseMove` 顶层伪 method 误用
**Coverage doc §3.1 已警告**：iOS 不能直调 `desktop.mouseMove` / `desktop.keyPress` 等顶层伪 method，必须走 `desktop.sendInput` + type sub-dispatch。**预防**：DesktopCommands actor 不暴露 `mouseMove(...)` async throws → desktop.mouseMove 路径；改为 `mouseMove(...)` → internal helper 调 `sendInput(type: "mouse_move", ...)`。

#### Trap D6 — Frame 退避无限循环
桌面端真停止响应 getFrame（如 robotjs 异常） → 持续 throw "Frame rate limit exceeded" 或其它错 → iOS 退避 50ms 重试无限循环。**预防**：DesktopFrameStreamer 加 consecutive-error counter，> 5 次 → emit fatal error + 切到 Error 状态，要求用户手动重启。

#### Trap D7 — modifier key 跨平台映射
macOS Cmd / Windows Ctrl / Linux Super 在 desktop robot.keyTap modifier 列表里名字不同 (macOS "command" / Windows "control") vs iOS UX 用 `⌘` 符号。**预防**：iOS 端 input event modifier 用 abstract 名（"meta" / "ctrl" / "alt" / "shift"），desktop 端按 process.platform 转 robot.keyTap 参数（桌面 handleKeyPress 已部分处理）。

#### Trap D8 — DC backpressure 引发 frame buffer 永久占用
DC 慢导致 frame 到 iOS 速度跟不上 capture 速度，pull loop 会持续待 response 不发新 getFrame — 但如果走 OQ-1 B push 模式，server 持续 push frame 到 DC buffer → iOS 端 buffer cap=1 drop-old 不解决传输层堆积。**预防 v0.1**：B 模式延后，A 模式天然无问题。**预防 v0.2 B 模式**：DC send buffer 监控，> 阈值时桌面端跳帧而非排队。

#### Trap D9 — base64 JPEG 反复编解码内存爆
iOS 收到 base64 string → JSONDeserialize 拷贝 → Data(base64Encoded:) 解码拷贝 → UIImage(data:) 解码拷贝 = 同一 frame 3 份内存。30 FPS × 200KB × 3 拷贝 = 18MB/s memory churn。**预防**：DC response 解析 path 直接走 Data，不走 String 中转（要改 RemoteCommandClient response decode path — 现行全 String-based，**改动较大**, v0.1 接受 churn，autoreleasepool 包 frame loop 减峰值；v0.2 优化）。

#### Trap D10 — 多分辨率 displays 切换 cursor 状态漂移
switchDisplay 切到第 2 屏 → screen size 变化 → virtual cursor 之前在 (1000, 1000) 但新屏只有 (1280, 720) → cursor 应在 (1280, 720) 边界。**预防**：switchDisplay 完成后 + getDisplays 重新拉 → virtualCursor.setScreen(new width, height) + reset to (new_width/2, new_height/2) 中心。

---

## 8. 时间线 & 资源

### 8.1 串行估算

| Sub-phase | 工期 | 累计 |
|---|---:|---:|
| 6.6.1 Models + Commands | 1.5 天 | 1.5 |
| 6.6.2 VirtualCursor | 0.5 天 | 2.0 |
| 6.6.3 FrameStreamer | 2.5 天 | 4.5 |
| 6.6.4 RemoteDesktopView + DesktopFrameView | 3.5 天 | 8.0 |
| 6.6.5 DI wire + tab | 0.5 天 | 8.5 |
| 6.6.6 收口 + doc 回写 + memory | 1 天 | 9.5 |
| **小计** | | **~10 天** |
| buffer (Trap 实战 + UI 微调) | 4 天 | **14 天** |

修正：Phase 6 Plan §8.1 desktop 14 天估算正确，但**不是因桌面端协作**（桌面 debt = 0）— 而是 UI + streamer 复杂度。

### 8.2 关键里程碑

- **M1** (Day 5)：DesktopCommands + VirtualCursor + FrameStreamer 全单测过，可在 fake DC 上跑 mock streaming
- **M2** (Day 8)：RemoteDesktopView + DesktopFrameView 在 SwiftUI Preview 里渲染静态 JPEG
- **M3** (Day 10)：DI wire + 第 13 tab；模拟器 + 真桌面 (LAN) E1+E3 通
- **M4** (Day 14)：E1-E10 全通；memory + doc 回写完成

---

## 9. 决策记录

| 日期 | OQ | 决策 | 决策人 | 备注 |
|---|---|---|---|---|
| 2026-05-18 | OQ-1 | 待定（推荐 A v0.1 pull-based）| — | v0.2 切 B push-based 需桌面端协作 |
| 2026-05-18 | OQ-2 | 待定（推荐 B 信号量限 1 in-flight）| — | 天然适配可变 RTT |
| 2026-05-18 | OQ-3 | 待定（推荐基础 6 手势映射表 §3 OQ-3）| — | pinch/3 指留 v0.2 |
| 2026-05-18 | OQ-4 | 待定（推荐 A iOS 端 virtual cursor 转绝对）| — | 与 Android 现行 absolute mode 一致 |
| 2026-05-18 | OQ-5 | 待定（推荐 A 单 active session）| — | 与 Phase 2 RemoteTerminal 一致 |
| 2026-05-18 | OQ-6 | 待定（推荐 B UIViewRepresentable + UIImageView）| — | 30 FPS replace image |
| 2026-05-18 | OQ-7 | 待定（推荐 A bounded drop-old cap=1）| — | 远程桌面"最新画面优先"语义 |

---

## 10. 关联文档 & memory

### 10.1 必读 design docs
- `docs/design/iOS_对标_Android_Phase_6_Plan.md`（Phase 6 整体计划）
- `docs/design/Desktop_Mobile_Bridge_Namespace_Coverage.md` §3.1（Trap T2 desktop sub-dispatch — 本文档解决）
- `docs/design/iOS_Phase_2_Remote_Terminal.md`（Phase 2 文本流参考；frame 流大体量但同 RemoteCommandClient framework）
- `docs/design/iOS_Phase_4_Notification_Skill.md` / `iOS_Phase_5_AI_Chat_Skill.md`（fan-out + dispatcher 模式参考，OQ-1 B 选项 v0.2 复用）

### 10.2 必读 memory
- `ios_phase_6_skill_template.md`（Phase 6 模板 + 12 trap）
- `ios_remote_operate_phase3.md`（framework + 实施 trap）
- `ios_remote_terminal_phase2.md`（DC streaming 实战 trap）
- `ios_remote_ai_chat_phase5.md`（streaming dispatcher 模式参考）

### 10.3 Android 对照
- `android-app/app/src/main/java/com/chainlesschain/android/remote/commands/DesktopCommands.kt`（568 LOC, 51 unique invoke 但仅 7 真 wire to desktop）
- `desktop-app-vue/src/main/remote/handlers/remote-desktop-handler.js`（7 outer case + 5 sendInput sub-type）

### 10.4 Phase 6.6 输出预期（实施后）
- `memory/ios_remote_desktop_phase6_6.md`（8-10 真实战 trap）
- Coverage doc §3.1 + Phase 6 Plan §1.3/§7 修正 commit
- `Modules/CoreP2P/Sources/RemoteSkills/Desktop/` 3 swift (Models / Commands / FrameStreamer + VirtualCursor)
- `Features/RemoteOperate/Views/RemoteDesktopView.swift` + `DesktopFrameView.swift`
- `Tests/CoreP2PTests/DesktopCommandsTests.swift` + `DesktopFrameStreamerTests.swift` + `DesktopVirtualCursorTests.swift`

## 附录：规范章节补全（v5.0.3.108）

> 本文为设计文档（草案，需 OQ 拍板）。为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文细节。

### 1. 概述

见正文「1. 背景 & 现状审计」。iOS Phase 6.6 Desktop Skill：远程桌面流式画面 + 输入控制，是 Phase 6 最复杂 skill；v0.1 草案，需 OQ 1–7 拍板后开 sub-phase 6.6.1。

### 2. 核心特性

桌面画面流式（FrameStreamer）；虚拟光标输入控制（VirtualCursor）；远程桌面 view。

### 3. 系统架构

见正文「4. 协议设计」；DesktopCommands + DesktopFrameStreamer + DesktopVirtualCursor。

### 4. 系统定位

iOS 端**远程桌面画面 + 输入控制 skill**（Phase 6.6，最复杂）。

### 5. 核心功能

见正文「5. 子阶段」：帧流 + 光标控制 + 远程桌面 view。

### 6. 技术架构

`Modules/CoreP2P/Sources/RemoteSkills/Desktop/`（Models / Commands / FrameStreamer + VirtualCursor）；`RemoteDesktopView.swift` + `DesktopFrameView.swift`。

### 7. 系统特点

最复杂 skill；需 OQ 1–7 拍板；frame 编码 / 延迟是关键挑战。

### 8. 应用场景

iPhone 看 + 控桌面画面（流式投屏 + 输入）。

### 9. 竞品对比

对标 Android 远程桌面（见 `iOS_对标_Android_Phase_6_Plan.md`）。

### 10. 配置参考

帧率 / 编码 / 光标灵敏度（OQ 决策）。

### 11. 性能指标

帧流延迟 + 带宽（最复杂 skill 的核心指标）。

### 12. 测试覆盖

见正文「6. Test Plan」：`DesktopCommandsTests` + `DesktopFrameStreamerTests` + `DesktopVirtualCursorTests`。

### 13. 安全考虑

桌面画面高敏感；走配对信任 + DC 加密；输入控制需谨慎授权。

### 14. 故障排除

帧流卡顿 / 光标偏移 → 见 OQ 与实施后 memory `ios_remote_desktop_phase6_6.md`。

### 15. 关键文件

`RemoteSkills/Desktop/`（Models/Commands/FrameStreamer/VirtualCursor）；`RemoteDesktopView.swift` / `DesktopFrameView.swift`。

### 16. 使用示例

见正文「4. 协议设计」与子阶段。

### 17. 相关文档

`iOS_对标_Android_Phase_6_Plan.md`、`iOS_Phase_6_7_Extension_Skill.md`、`iOS_Phase_6_0_RealDevice_E2E_Plan.md`。
