# 移动端 iOS（Phase 1+2+3 框架完整移植，待真机 E2E）

> **版本: Phase 1+2+3 (productVersion `v5.0.3.54+`, 2026-05-15) | 状态: 框架完整 / 待真机 E2E | ~264 单测 across 20+ suites | 4 typed skill**
>
> ChainlessChain iOS 客户端 — SwiftUI + Swift Concurrency + Google WebRTC SDK 原生应用。镜像 Android v1.0 GA 已 Xiaomi 真机 E2E 验证版的 三层定位 + 桌面配对 + 远程终端 + 远程操控。**信息架构 / 流程 / 字段顺序 1:1 对齐 Android Compose Screen**，HIG 偏离仅限 6 项白名单。

::: warning 实现状态
- **Phase 1 配对** + **Phase 2 远程终端** + **Phase 3 远程操控 framework + 4 typed skill** 框架级落地（commit `c30b415a8` + `7613ea710` + `759a1e907`）
- **真机 E2E 待跑**（需 Mac+iPhone+真桌面）：Phase 1.7 三流配对 + Phase 2.7 4 终端场景 + Phase 3.7 4 skill 各跑一次
- iOS 暂未上 App Store；Phase 4+ 增量解锁剩余 19 个 Android REMOTE command（AI/Browser/Knowledge 等）按需启动
:::

## 概述

iOS 端 ≠ Android 端的 1:1 重写，而是**二级镜像**：在 Android v1.0 GA 已用 Xiaomi 24115RA8EC × Win desktop 真机 E2E 跑通的版本基础上，把同一信息架构 / 同一字段顺序 / 同一流程移到 SwiftUI。已被验证的 layout 不再二次设计。

| 层 | 名称 | 干什么 | iOS 实现 |
|---|---|---|---|
| **L1** | 配对 + 已配对桌面 | 桌面 ↔ iPhone 三流配对 + 持久化 + live publisher | `Modules/CoreP2P/Pairing/` 9 swift + `Features/Pairing/` 8 swift |
| **L2** | 远程桌面终端 | xterm.js WKWebView + WebRTC DataChannel 直连 + softkey toolbar | `Modules/CoreP2P/RemoteTerminal/` 13 swift + `Features/RemoteTerminal/` 6 swift + 4 xterm.js bundle resources |
| **L3** | 远程操控 framework + 4 skill | 5-tab segmented shell + Clipboard / File / Screenshot / SystemInfo | `Modules/CoreP2P/RemoteSkills/` 16 swift + `Features/RemoteOperate/` 6 swift |

## 用户体验闭环

```
打开 iOS app → 设置 → 桌面配对
  ├─ 扫描桌面 QR (Flow B, 最常用 — 主流应用通用 UX)
  ├─ 显示我的 QR (Flow A — 桌面 webcam 扫，Signal e2ee 高级路径)
  └─ 手动输入 6 位 code (兜底 — pairing-code:<code> signaling 别名)
       ↓
  已配对桌面列表 (live publisher + swipe 删除)
       ↓ 单击桌面行
  RemoteOperateView 5-tab segmented shell (Phase 3.6)
       ├─ 终端 Tab：xterm.js WKWebView + DC 直连 (Phase 2)
       │   - 拉/写 PTY stdin/stdout 双向流
       │   - softkey toolbar: Esc / Tab / 方向键 / Ctrl+C
       │   - 多 session 列表 + history 补帧
       ├─ 剪贴板 Tab：双向读写 (Phase 3.3)
       │   - 拉桌面剪贴板 → iPhone UIPasteboard
       │   - iPhone 输入 → 写桌面剪贴板
       ├─ 文件 Tab：浏览桌面文件系统 (Phase 3.4)
       │   - 面包屑导航 + List 文件项
       │   - 24 文件 icon (txt/md/json/png/...) by extension
       │   - tap text 文件看内容 (sheet)
       ├─ 截屏 Tab：触发桌面截屏 (Phase 3.5)
       │   - capture button → DC 触发桌面截屏
       │   - iOS 显图 + 显式 PHPhotoLibrary 保存按钮 (HIG 第一次 prompt)
       └─ 系统 Tab：CPU/Mem/Disk/Net 实时 (Phase 3.5)
           - 4 cards 真数字 + 5s polling
           - onAppear 立即拉一次 + 起 polling
           - onDisappear 严格 cancel polling
```

## Phase 1 — 桌面配对三流

### Flow B（默认 / 最常用）— iPhone 摄像头扫桌面 QR

桌面端在 V6 settings 显 280×280 px QR（`<a-qrcode async-register>`）+ 6 位 manual code。

iPhone 操作步骤：
1. 设置 → 桌面配对 → "扫描桌面 QR"
2. 摄像头权限首次会 prompt（HIG 第一次必弹）
3. 对准桌面屏 QR → 自动解析 + sendForwardedMessage(`pairing:request`) → 桌面端 V6 toast "iPhone xxx 请求配对" → click 确认 → 桌面发 `pairing:confirmation` (Ed25519 签) → iPhone 验签 + persist 到 PairedDesktopsStore (UserDefaults JSON)

镜像 Android `ScanDesktopPairingScreen.kt`（已 Xiaomi 24115RA8EC 真机 E2E 验证）。

### Flow A（高级路径 / Signal e2ee）— 桌面摄像头扫 iPhone 显的 QR

iPhone 显自己的 QR（含 mobile peer-id + ephemeral pubkey），桌面 webcam 扫。Signal Protocol e2ee 加密信道 + Ed25519 双向 mutual signing。

镜像 Android `DesktopPairingScreen.kt`（dead-code 警告：W3.7 后 Flow B 默认 UX，此路径保留作 reference）。

### 手输 6 位 code（兜底）— 摄像头不可用 / 扫码失败

桌面 V6 显 6 位 code（5 分钟 TTL）。iPhone 输入 6 位 → signaling alias `pairing-code:<6digit>` → 桌面 `manual-pair-listener.js` (220 LOC, 2026-05-15 落地) 监听 LAN + 中继双连接 → ack 回包 → 持久化。

设计修订：原 design doc §6.5 originally 走 HTTP，pivot 到 signaling alias 因 iPhone 无桌面 LAN IP discovery 渠道。

## Phase 2 — 远程桌面终端（Plan A.1 移植）

镜像 Android Plan A.1 (`Android_Remote_Terminal_Plan_A1.md`，已 Xiaomi 真机 E2E + 8 bug 修过)。

### 5 步 WebRTC handshake

`RemoteWebRTCClient` actor（Modules/CoreP2P/RemoteTerminal/）：
1. signaling connect + register (peer-id + role)
2. 拉 ICE servers from PairedDesktopsStore + setupPeerConnection (Google WebRTC SDK)
3. createOffer + sendForwardedMessage(`offer`) → 桌面
4. waitForAnswer (race continuation vs 30s timeout)
5. setRemoteDescription + ICE trickle 双向交换 → DC OPEN → state `.ready`

ICE candidates trickle 经 signaling forward 双向交换；DC 双方都 OPEN 后才允许 `sendMessage`。

### Terminal RPC

6 个 method wrapper（create / list / stdin / resize / close / history），全部 delegate 到 `commandClient.invoke`：
- DC 优先 (preferDataChannel + isDataChannelReady)，失败 fallback signaling
- LRU dedup：stdout 按 (sessionId, seq) 256 / exit 按 sessionId 64
- pendingResponses pool with continuation 超时清理（2026-05-15 P0 修：do/catch 包 TaskGroup 显式 resume + 清池）

### xterm.js WKWebView

`TerminalWebView` 用 WKWebView 加载 `Bundle/xterm-shell.html`（vendored xterm.js v5.5.0 + addon-fit）。Kotlin↔JS bridge → WKScriptMessageHandler `cc` namespace。三件套消息：`onReady` (cols/rows) / `onResize` / `onUserInput`（data string）。

dismantleUIView 必 `removeScriptMessageHandler(forName: "cc")` 防 retain cycle。

### 软键盘工具栏

`ToolbarItemGroup(placement: .keyboard)` (iOS 15+ 原生)：Esc / Tab / 方向键 / Ctrl+C —— 镜像 Android `BottomAppBar` softkey。

## Phase 3 — 远程操控 framework + 4 typed skill

### RemoteCommandClient — 通用 RPC actor

从 Phase 2 `TerminalRpcClient.invoke` 抽出 sibling actor。让 4+N 个 skill commands 共享同一个：
- invoke 池 (pendingResponses dict)
- DC/signaling 双路径 routing
- LRU dedup
- continuation timeout 清理（P0 fix 2026-05-15）

**单消费者 fix**：`webRTCClient.inboundMessages: AsyncStream` 单消费者 — 收口 commandClient 为唯一订阅者；TerminalRpcClient 改订 `commandClient.events` 流（Phase 3.6 refactor 提前到 3.3，避 Clipboard skill timeout 真因）。

### 4 typed skill commands

| Skill | 文件 | wire 协议 |
|-------|------|----------|
| **Clipboard** | `Modules/CoreP2P/RemoteSkills/Clipboard/` | `clipboard.get` / `clipboard.set`（v0.1 仅 text） |
| **File** | `Modules/CoreP2P/RemoteSkills/File/` | `file.list` / `file.read`（含 PathUtility 跨平台 Win `\\` vs Unix `/`） |
| **Screenshot** | `Modules/CoreP2P/RemoteSkills/Screenshot/` | `screenshot.capture` → base64 PNG（含 estimatedDecodedBytes，autoreleasepool 防内存 spike） |
| **SystemInfo** | `Modules/CoreP2P/RemoteSkills/SystemInfo/` | `system.info` → CPU / Memory / Disk / Network 4 sub-blocks + uptime |

### RemoteSkillRegistry — 23 SeedRegistry 1:1 mirror Android

`Modules/CoreP2P/RemoteSkills/Registry/SeedRegistry.swift`（393 LOC）— 23 hardcoded SkillMetadata 1:1 镜像 Android `SeedRegistry.kt`，total methodCount **795**。文件 + 方法双粒度白名单 + risk tag {Safe / Mutating / Privileged}。

`ManifestSignatureVerifier` protocol + `NoOpManifestVerifier` 默认 wired —— Marketplace M0 forward-compat seam，未来 swap 真验签实现。

### Offline command queue + drainer

`OfflineCommandQueue` actor（UserDefaults JSON, capacity 100, maxRetries 3）：
- 网络断时 skill 调 `enqueue` 落 pending
- 崩溃恢复：sending → pending（中断的 drain 重试）
- 容量满时 evict 最老 pending（failed 不丢，等用户清）

`OfflineQueueDrainer` Sendable class：
- 监听 `RemoteWebRTCClient.dataChannelReady: AsyncStream<Bool>`
- false→true edge detection（lastReady + lock）触发一次 `queue.drain(client:, pcPeerId:)`
- WeakBox helper 防 watch task 强引用 self

## 单元测试 + 集成测试

| Phase | unit tests | suites |
|-------|-----------|--------|
| Phase 1 | 71 | 7 |
| Phase 2 | 163（累计 234） | 12 |
| Phase 3 | ~30 新增（累计 ~264） | 8+ |
| **集成（跨 Phase）** | **6** | **`Phase3IntegrationTests.swift`** |

集成测试覆盖：
1. ClipboardCommands DC 端到端（envelope shape + 解码）
2. TerminalRpcClient 通过 `commandClient.events` demux stdout
3. `OfflineQueueDrainer` false→true edge 触发 drain + 重复 false 不重 drain + true→true 不重 drain
4. Offline enqueue → 网络恢复 → drain 全成功 + 队列清空
5. 3 concurrent invoke 共享 client pool + reqId distinct
6. timeout 后立即新 invoke 必须成功（regression for P0 continuation 泄漏）

## Bug 修（P0 — 2026-05-15 code review 后）

| Bug | 文件 | 修法 |
|-----|------|------|
| `RemoteCommandClient.invoke` continuation 泄漏 | `RemoteCommandClient.swift:108-126` | `do/catch` 包 TaskGroup，catch 显式 `pendingResponses.removeValue(forKey:)?.resume(throwing:)` |
| `RemoteWebRTCClient.waitForAnswer` 同模式 | `RemoteWebRTCClient.swift:178-205` | 同上 + 加 `hasPendingAnswer()` 诊断 accessor |

加 `pendingCount()` / `hasPendingAnswer()` 两 internal accessor 供单测 verify 池清干净（也能日后 prod diagnostics 用）。

## iOS UI 镜像 Android 已验证布局

用户拍板："iOS 页面布局参考安卓端 安卓端有检测过"。Compose Screen 信息架构 / 流程 / 字段顺序照抄到 SwiftUI；HIG 偏离限白名单 6 项：

1. Compose `Column + Box(weight=1f)` → SwiftUI `VStack + Spacer/.frame(maxHeight: .infinity)`
2. Compose `BottomAppBar` softkey → SwiftUI `ToolbarItemGroup(placement: .keyboard)` (iOS 15+ 原生)
3. Compose `LazyColumn` → SwiftUI `List(.insetGrouped)`
4. Compose `ModalBottomSheet` → SwiftUI `.sheet(isPresented:)`
5. Compose `AlertDialog` → SwiftUI `.alert(isPresented:)`
6. Compose `Tab + ViewPager` → SwiftUI `Picker(.segmented)` + 子 view 切换

## 设计文档

- [iOS Phase 1 Pairing Flow B](../design/iOS_Phase_1_Pairing_Flow_B.md) — 含 §6 sub-phase + §6.5 Manual wire 修订（HTTP → signaling alias）
- [iOS Phase 2 Remote Terminal](../design/iOS_Phase_2_Remote_Terminal.md) — 含 §3 OQ 4 项决策 + §6 sub-phase + §7 9 traps + §8.3 真机 E2E 4 场景
- [iOS Phase 3 Remote Operate Framework](../design/iOS_Phase_3_Remote_Operate_Framework.md) — 含 §3 OQ 5 项决策 + §6 sub-phase + §7 9 traps + §8.3 真机 E2E

## 真机 E2E（待用户 Mac+iPhone+真桌面）

### Phase 1.7：桌面配对三流

| 场景 | 步骤 | 通过标准 |
|------|------|---------|
| Flow B | iPhone 设置 → 桌面配对 → 扫桌面 QR | ≤ 5s 完成；持久化在 PairedDesktopsStore |
| Flow A | iPhone 显 QR → 桌面 webcam 扫 | Signal e2ee 双向 mutual sign 成功 |
| 手输 code | iPhone 输 6 位 → 桌面 ack | LAN→relay fallback ≤ 3s |

### Phase 2.7：远程终端 4 场景

| 场景 | 通过标准 |
|------|---------|
| LAN 同 WiFi | DC 握手 ≤ 2s + RTT ≤ 200ms |
| 蜂窝 → TURN relay | RTT ≤ 500ms + 30min stdout 不断 |
| 故意杀桌面 mobile-bridge | fallback 中继 ≤ 3s + chip 切色 |
| 恢复 | 自动切回 P2P 直连 |

**Xcode 一次性配置**：drag `ios-app/ChainlessChain/Features/RemoteTerminal/Bundle/` 文件夹到 ChainlessChain target → "Create folder references"（蓝色文件夹），不要选 "Create groups" 否则 xterm.js 资源不打包。

### Phase 3.7：4 skill 各跑一次

1. **Clipboard 双向**：iPhone ↔ macOS Clipboard 文字
2. **File**：浏览 `~/Documents` 列表 + tap `.txt`/`.md` 看内容
3. **Screenshot**：触发桌面截屏 → iPhone 显图 → 保存相册（PHPhotoLibrary 第一次 prompt）
4. **SystemInfo**：4 cards CPU/Mem/Disk/Net 真数字 + 5s polling 自动刷新

## 故障排查

| 症状 | 可能原因 | 修法 |
|------|---------|------|
| 摄像头扫 QR 后无反应 | iOS 摄像头权限被拒 | 设置 → 隐私 → 摄像头 → ChainlessChain |
| 扫码后桌面无 toast | signaling 未注册 | 检查 iOS app log "WebSocketSignalClient register success" |
| 终端打开但永远黑屏 | xterm.js bundle 资源未打包 | Xcode "Create folder references" not "Create groups" |
| 截屏保存失败 | PHPhotoLibrary 权限被拒 | 设置 → 隐私 → 照片 → ChainlessChain → "添加照片" |
| 系统 Tab 数字不刷新 | View 已 disappear 但 polling 仍在 | onDisappear 已严格 cancel；如复现 → bug report |
| 连续 invoke timeout 后池泄漏 | P0 fix 2026-05-15 之前的版本 | 升级到 commit `759a1e907` 之后版本 |

## 后续路线

| Phase | 内容 | 时机 |
|-------|------|------|
| 1.7 / 2.7 / 3.7 | 真机 E2E（用户做） | Mac+iPhone+真桌面在场 |
| 4+ | 增量解锁剩余 19 Android REMOTE command | 按需触发，单 skill mini design doc per phase |
| App Store | TestFlight beta | 真机 E2E 全过 + 文档完善后 |
