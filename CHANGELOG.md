# Changelog

All notable changes to ChainlessChain will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] - 2026-05-15 — iOS Phase 1+2+3 完整移植 + 2 P0 修

> Android v1.0 GA 验证后，iOS 端启动镜像移植，一日内三 Phase 框架级落地：133 文件 / ~264 单测 / 3 设计文档 / 3 trap memory。代码 review 后期修两处 continuation 泄漏 P0。

### Added — iOS Phase 1: 桌面配对三流（commit `c30b415a8`）

- `Modules/CoreP2P/Pairing/` (9 swift) + `Features/Pairing/` (8 swift) — Flow B 摄像头扫桌面 QR + Flow A 桌面扫手机 QR (Signal e2ee) + 手输 6 位 code 兜底
- `PairingSignalingGate` 接口 + `DefaultPairingSignalingGate` + `PairingMessageBus` + `PairedDesktopsStore` (UserDefaults JSON 持久化) + 3 ViewModel
- 71 unit tests across 7 suites
- 桌面端 follow-up `desktop-app-vue/src/main/web-shell/handlers/manual-pair-listener.js` (220 LOC) — `pairing-code:<6digit>` signaling 别名监听 + LAN 与中继双连接

### Added — iOS Phase 2: 远程桌面终端 Plan A.1 移植（commit `7613ea710`）

- `Modules/CoreP2P/RemoteTerminal/` (13 swift) — `RemoteWebRTCClient` 5 步 handshake actor + `WebRTCPeerConnectionTransport` Google SDK 抽象 + `TerminalRpcClient` 6 method wrapper + `WebRTCRuntime` actor
- `Features/RemoteTerminal/` (6 swift + 4 xterm.js bundle resources) — `TerminalListView` + `TerminalSessionView` + `TerminalWebView` (WKWebView 嵌 xterm.js)
- `Modules/CoreP2P/Signaling/SignalClient.forwardedMessages: AsyncStream<String>` (Phase 2.4 prereq 回填 Phase 1 设计 gap)
- 163 unit tests across 12 suites（累计 234）
- 镜像 Android Plan A.1 (`docs/design/Android_Remote_Terminal_Plan_A1.md`) 已 Xiaomi 真机 E2E 验证版

### Added — iOS Phase 3: 远程操控 framework + 4 typed skill（commit `759a1e907`）

- `Modules/CoreP2P/RemoteSkills/` (16 swift) — `RemoteCommandClient` 通用 RPC actor (Phase 2 `TerminalRpcClient.invoke` 抽出 sibling) + `RemoteSkillRegistry` 23 SeedRegistry 1:1 mirror Android (795 method) + `OfflineCommandQueue` UserDefaults JSON crash recovery + `OfflineQueueDrainer` false→true edge detection + 4 typed skill (Clipboard / File / Screenshot / SystemInfo) + `ManifestSignatureVerifier` (NoOp 默认，Marketplace M0 forward-compat)
- `Features/RemoteOperate/Views/` (6 swift) — `RemoteOperateView` 5-tab segmented shell (Terminal embeds 既有 TerminalListView，4 新 tab) + ClipboardView / FileBrowserView / ScreenshotView (PHPhotoLibrary 显式保存) / SystemInfoView (5s polling)
- `RemoteCommandClient` 单消费者 fix — 把 `webRTCClient.inboundMessages` 订阅 owner 收口到 commandClient，TerminalRpcClient 改订 `commandClient.events` 流（避 AsyncStream 单消费者切分事件 bug；Phase 3.6 refactor 提前到 3.3）
- ~264 unit tests across 20+ suites（累计）

### Fixed (P0) — Continuation 泄漏（2026-05-15 code review 后修）

- `RemoteCommandClient.invoke` — `withThrowingTaskGroup` timeout 路径不会 auto-resume 池中 continuation，长期运行下 `pendingResponses` 泄漏。修：`do/catch` 包，catch 显式 `pendingResponses.removeValue(forKey: reqId)?.resume(throwing: error)`。
- `RemoteWebRTCClient.waitForAnswer` — 同模式不清 `pendingAnswer`，下次 connect 与残留 continuation 撞。修同上 + 加 `hasPendingAnswer()` 诊断 accessor。
- 2 regression test (`testInvokeTimeoutClearsPendingResponses` / `testAnswerTimeoutClearsPendingAnswer`) + 1 集成 test (`testTimeoutFollowedByImmediateInvokeSucceeds`) 验池清干净。

### Added — iOS 集成测试套件

- `Tests/CoreP2PTests/Integration/Phase3IntegrationTests.swift` 6 跨组件测试：(1) ClipboardCommands DC 端到端 + envelope shape + 解码 / (2) TerminalRpcClient 通过 `commandClient.events` demux stdout / (3) `OfflineQueueDrainer` false→true edge 触发 drain + 重复 false 不重 drain + true→true 不重 drain / (4) Offline enqueue → 网络恢复 → drain 全成功 + 队列清空 / (5) 3 concurrent invoke 共享 client pool + reqId distinct / (6) timeout 后立即新 invoke 必须成功（regression）。

### Added — iOS Phase 4: Notification skill（design `cf7a7be78` + 6 sub-phase impl `45b485fdd` → `5877b5d84`）

- `Modules/CoreP2P/RemoteSkills/Notification/` 3 swift — `NotificationModels` (Codable wire 协议: Priority enum / HistoryItem / Settings / 6 Response / ReceivedEvent.parseFromEnvelope) + `NotificationCommands` actor (11 method 1:1 mirror Android `NotificationCommands.kt`，与 Clipboard/File/Screenshot/SystemInfo 共享 commandClient invoke 池) + `NotificationEventDispatcher` @MainActor class (LRU dedup 256 + 触发 PushNotificationManager.scheduleSystemNotification + @Published latestPush/unreadCount + Combine SwiftUI 集成)
- `Modules/CoreP2P/RemoteSkills/Notification/RemoteNotificationsViewModel.swift` (322 LOC) — @MainActor ObservableObject; 6 user actions (loadHistory/refresh/markAsRead/markAllAsRead/delete/clearAll/loadDesktopSettings/clearError); **乐观更新 + offline gate 三分支模式** (DC ready → server 调，失败 rollback + refresh; DC 不通 → enqueue OfflineQueue + 本地仍乐观)
- `ChainlessChain/Features/RemoteOperate/Views/NotificationsView.swift` (517 LOC) — UI 镜像 Android `NotificationCenterScreen.kt`: filter Picker(.segmented) "全部/未读" + List(.insetGrouped) + ForEach + swipe markAsRead/delete + .refreshable + .toolbar Menu (全部已读/清空/设置) + detail sheet (priority badge/data dict/时间) + settings sheet (iOS 端跳系统设置 + 桌面端 readonly per OQ-4)
- `ChainlessChain/Features/Common/Services/PushNotificationManager+RemoteTarget.swift` (12 LOC) — 1 行 `extension PushNotificationManager: RemoteNotificationPushTarget {}` (既有 PushManager 531 LOC 0 改动 — Phase 4 设计承诺)
- `ChainlessChain/Features/RemoteTerminal/RemoteDependencies.swift` (+52 LOC) — wire NotificationCommands + dispatcher + **events fan-out task** (修 Phase 4 实施暴露的新 trap：cmdClient.events 单消费者 AsyncStream，多 skill 订阅必须分流) + 启动 Task `MainActor.run { dispatcher.attach(PushNotificationManager.shared); dispatcher.start() }`
- `ChainlessChain/Features/RemoteOperate/Views/RemoteOperateView.swift` (+24 LOC) — SkillTab enum 加 .notification + body switch + .onChange 进 tab 时 dispatcher.resetUnreadCount
- `ChainlessChain/Features/RemoteOperate/Views/SkillTabPickerView.swift` (REWRITE 27 → 83 LOC) — 从 Picker(.segmented) 改 ScrollView(.horizontal) + Button row + Capsule unread badge overlay (per design §7.9 备选 B；HIG 5-tab segmented 软上限 + 无原生 badge 接口；Discord/Slack 移动端 channel switcher pattern)
- 41 新 unit tests across 3 files (NotificationCommandsTests 18 + NotificationEventDispatcherTests 10 + RemoteNotificationsViewModelTests 13)；iOS 单测累计 ~313

### Documentation

- `docs/design/iOS_Phase_1_Pairing_Flow_B.md` v1.0 — 含 §6 sub-phase + §6.5 修订（Manual wire 从 HTTP pivot 到 signaling alias）
- `docs/design/iOS_Phase_2_Remote_Terminal.md` v1.0 — 含 §3 OQ 4 项决策 + §6 sub-phase + §7 9 traps + §8.3 真机 E2E 4 场景
- `docs/design/iOS_Phase_3_Remote_Operate_Framework.md` v1.0 — 含 §3 OQ 5 项决策 + §6 sub-phase + §7 9 traps + §8.3 真机 E2E
- `docs/design/iOS_Phase_4_Notification_Skill.md` v1.0 (676 LOC, full doc) — 含 §3 OQ 5 项决策 + §6 sub-phase + §7 9 forward-looking traps + §8.3 真机 E2E 8 场景
- Memory：`ios_qr_pairing_three_flows.md` (6 trap) + `ios_remote_terminal_phase2.md` (9 trap) + `ios_remote_operate_phase3.md` (9 trap) + `ios_remote_notification_phase4.md` (8 trap) + `feedback_ios_ui_mirrors_validated_android.md` (HIG 偏离白名单)

### Pending — 真机 E2E（需 Mac+iPhone+真桌面，移交用户）

- Phase 1.7：桌面配对三流各跑一次（Flow A / B / 手输）+ LAN→relay fallback
- Phase 2.7：远程终端 4 场景（LAN / TURN / DC failover / 30min stdout 持续）+ Xcode 资源 `Features/RemoteTerminal/Bundle/` "Create folder references"
- Phase 3.7：4 skill 各跑一次（Clipboard 双向 / File ~/Documents / Screenshot 保存相册 / SystemInfo 4 cards + 5s polling）
- Phase 4.7：8 通知场景（拉历史 ≤500ms / 桌面 push 弹 banner ≤2s + tab badge + app icon badge / LRU dedup 桌面 DC+signaling 双发不重复 / markAsRead 双轨 / 离线 enqueue → drainer 自动 / quiet hours silenced=true 不弹 banner / authorization denied in-app banner / 后台 1min 回前台 refresh 看到 unread）

## [v5.0.3.54] - 2026-05-14 — Plan A.1 真机 E2E 收口（8 bugs：UI 黑屏 + cc/claude 可用）

> v5.0.3.53 发版后真机 E2E 暴露 8 个独立 bug，从"打不开 / 黑屏 / 无法输入 / cc/claude 不可用"到端到端完整可用。`f54a6fcd0` 收口（Xiaomi 24115RA8EC ↔ Windows git-bash longfa 验证）。

### Fixed — 远程终端真机端到端打通

- **fix1** `P2PClient.handleIncoming` 加 `chainlesschain:*` envelope guard — 避免协议消息被当业务消息触发 spurious peer state 变化
- **fix2** `WebRTCClient.sendOffer` 移除 `currentPeerId = peerId` 误赋值（peerId 是 target ≠ self） — echo loop 真因：WS 重连 auto-re-register 把 mobile 注册成桌面 peerId 后路由回自己
- **fix3** desktop `mobile-bridge` + `desktop-pair-handlers` 加 `maybeRefreshIceForMobile` 12h 节流自动 refresh iceServers — 跨 24h TTL 仍可用
- **fix4** signaling-relay `server.js handleMessage` 注入 `msg.from = ws._peerId` 中继路由 forward 缺 from 字段（中继 deploy `docker compose up -d --build --force-recreate` 47.111.5.128）
- **fix5** `TerminalRpcClient` stdout dedup gate 移除（gate 表达式永远 true 让每条 stdout 被 drop）
- **fix7** `TerminalListViewModel.createSession.onSuccess` closure shadow 真因：`it.copy(lastCreatedId = it.lastCreatedId)` 把 `CreatedSession` 参数名 shadow 成 state，永远不更新；改用 `created.sessionId` + List 屏 `LaunchedEffect(state.lastCreatedId)` 自动 navigate
- **fix11** `TerminalWebView` `LayoutParams MATCH_PARENT × MATCH_PARENT` — Compose AndroidView 默认 WRAP_CONTENT + HTML `body { height: 100% }` 死锁让 WebView 永远 0 高，xterm.fit() 返回 cols=49 rows=1 → 桌面 PTY 被 resize 成 1 行 → 用户看到的"全黑"其实是底色 #1e1e1e（fix9/10 ResizeObserver + DOM size guard 三层定位）
- **fix12** `PtyManager` login shell + git-bash probe — `pty.spawn(cmd, [], ...)` 无 args 让 bash/wsl 不走 login mode → `~/.bashrc` 不加载；`bash.exe` PATH 优先匹配 WSL bash → 进 root 用户无 npm-global PATH。改返回 `{cmd, args}`，bash 走 `-l`，wsl 走 `-- bash -l`，shell=bash 优先 probe `Program Files/Git/bin/bash.exe`。Android 端选 `bash` 后能用 `cc` / `claude` / `npm` 等用户全局 CLI

### Lessons captured

- `feedback_currentpeerid_target_vs_self_trap.md` — sendOffer 不能拿 target peerId 设 currentPeerId（self）
- `android_webview_xterm_resize_observer.md` — Compose AndroidView WRAP_CONTENT × HTML height:100% 死锁三连坑 + 三层修法

## [v5.0.3.53] - 2026-05-14 — Plan A.1 远程终端 Android↔桌面 WebRTC DataChannel 直连

> Plan A v5.0.3.52 把 terminal 命令通道架在 signaling 转发 (Plan C, 4 跳链路) 上，真机 e2e 暴露 5 个 reliability bug：APK 中文 GBK 乱码 / 每次 invoke 新 peerId 让 server cleanup 误杀 / OkHttp pingInterval 太短 / WS reconnect 不自动 re-register / **NAT idle + 蜂窝间歇杀 TCP 让 4 跳链路任一跳断即整体失败 (架构性)**。Plan A.1 治本：稳态命令 + stdout/exit 推送从 4 跳 signaling 切到 1 跳 WebRTC DataChannel 直连，绕开中继 + NAT idle，p50 RTT 200-500ms→30-80ms。失败 silent fallback signaling，保留兜底。

### Added — Phase 1 Trap 1 修复 + DC 状态 helper

- `WebRTCClient.dataChannelReady: StateFlow<Boolean>` derived flow（`connectionState == READY` 才 true，比 `DATA_CHANNEL_OPEN` 字面更精确——后者只是 ICE 通了 DC 未必 open）。
- `SignalClient.forwardedMessages: SharedFlow<String>` 多订阅入口替换单 `setOnForwardedMessageReceived` callback。后者"set 不是 add"的反模式让 WebRTCClient/SignalingRpc/TerminalRpc 三方互覆盖（Trap 1），TerminalRpc.start 第一次 invoke 后 SignalingRpc 会偷走 ice:config 拦截器，iceServers 24h TTL 到期跨 NAT 失效。`WebSocketSignalClient` 同步 emit SharedFlow + invoke callback 向后兼容（ice:config 仍走 callback canonical handler）。

### Added — Phase 2 DC fast path

- `SignalingRpcClient.invoke` 内部 `trySendViaDataChannel` 优先 `webRTCClient.sendMessage(envelope)`，DC 未 ready 或 sendMessage 抛 IllegalStateException 时自动 fallback signaling LAN+relay 既有路径。**所有 RPC 客户端**（terminal + system.* + ai.*）自动受益，pending pool 共享。
- `preferDataChannel: Boolean = true` feature flag（in-memory；后期接 SharedPreferences）允许诊断切回纯 signaling。
- `ensureResponseListener` 双路监听 `SignalClient.forwardedMessages` + `WebRTCClient.messages`，响应从任一路到达都 complete 同一 pending deferred；二次 complete 被 CompletableDeferred 安全忽略，无需显式去重。
- 埋点 `[SignalingRpc.metric] path=dc|signaling → method`，发版 grep logcat 算 fast path 占比（验收 > 80% / 一周内）。

### Added — Phase 3 触发 + UI 标识

- `TerminalListViewModel.init` 检测 `dataChannelReady=false` 时异步调 `RemoteConnectionManager.connect(pcPeerId, "did:peer:$pcPeerId")` 触发 WebRTC 握手（pcDID 占位 — `PairedDesktop` 不存 DID，P2PClient 也只把它当 metadata）。失败 silent，命令仍走 signaling fallback。
- `TerminalListScreen` 顶部 chip 实时显示 "P2P 直连" / "中继路径"，订阅 `webRTCClient.dataChannelReady` 自动切换。

### Added — Phase 4 双路 push + 双向去重

- `TerminalRpcClient.start()` 双订 `SignalClient.forwardedMessages` + `WebRTCClient.messages`。Phase 3 DC handshake landing 后，DC 路径上的 `chainlesschain:event` (terminal.stdout / exit) push 才能被本类拿到 — pre-Phase-4 只订 signaling 路径，用户看 UI 命令回显但收不到输出。
- LRU 反向去重：256-key stdout `"sessionId|seq"` / 64-key exit `sessionId`。同一 (s, seq) 经 DC + signaling 双路到达，UI 只看到一次。`Collections.synchronizedMap(LinkedHashMap accessOrder)` + `removeEldestEntry`。
- 桌面 `mobile-bridge.js bridgeToLibp2p` 入口 LRU dedup `payload.id`（128 容量 / 30s TTL），防 PtyManager 双执行（同 stdin 跑两次 / 双倍 stdout fanout）。`_gcRecentMobileRequests` 惰性 GC 无 timer。

### Phase 5 — DC 失效 fallback + 自动重建（零新代码 / Phase 2 + P2PClient 既有 wiring 副产品）

- DC 抛 IllegalStateException → Phase 2 `trySendViaDataChannel` 返 false → signaling fallback。
- DC 死 → `P2PClient.handleDisconnection` 监听 `webRTCClient.setOnDisconnected` → `scheduleReconnect` 指数退避（base 1s / cap 60s / factor 2.0 / maxAttempts 10）。已存在 piggy-back。
- DC 恢复 → `isDcReady()` 在每次 invoke 重新读 connectionState，下次 invoke 自然走 DC，无显式切换动作。

### Fixed — Plan A 真机 e2e 暴露的 4 bug（v5.0.3.52 临门修，发 53 一起 sweep）

1. APK 中文显示乱码：gradle.properties + compileOptions.encoding 加 `-Dfile.encoding=UTF-8`
2. 每次 invoke 新 `mobile-${ts}` peerId 让 server cleanup 误杀：`WebSocketPairingSignalingGate.sendAck` 复用 register 的 DID
3. OkHttp pingInterval(20s) 太短：拉到 60s 容纳桌面慢命令处理
4. WS reconnect 不自动 re-register：onOpen 加 auto re-register 避免 server peerId=undefined 黑洞

### Tests — Plan A.1 新增 10 个 unit test，所有现有测试保持绿

- `SignalingRpcClientTest`: 4 个新测试（DC ready 走 DC + flag-off 走 signaling + DC 不 ready fallback + DC throws fallback），envelope 共享 pending deferred 验证
- `TerminalRpcClientTest`: 3 个新测试（DC + signaling 重复 dedup stdout / dedup exit / DC 单路投递 stdout）+ Trap 1 回归测试
- `WebRTCClientTest`: pre-existing pairedDesktopsStore 缺参修补（v1.3+ Plan B 留的 stale test）

### Real-device E2E — §5.3 矩阵移交用户

- Xiaomi 24115RA8EC（已有 device）+ 桌面 Windows dev 模式
- 场景：(1) LAN 同 WiFi 期望 DC 秒级握手 (2) 蜂窝 + LAN 桌面 TURN relay (3) 双 NAT 3G symmetric fallback signaling (4) 模拟 DC 失效 fallback ≤3s (5) DC 恢复自动切回

### Design doc

- `docs/design/Android_Remote_Terminal_Plan_A1.md` v0.1 → v1.0（一日 7 commit 完成 Phase 1-5；落地反思：Phase 5 是 Phase 2 + P2PClient.scheduleReconnect 的免费副产物，零新代码）

---

## [v5.0.3.52] - 2026-05-14 — Plan A 远程终端：Android↔桌面 PTY 全链路

> Phase 1 – 4 全部落地：用户从 Android 配对桌面的 RemoteOperateScreen 点 "打开远程终端" → TerminalListScreen → 新建会话 (pwsh/cmd/bash/wsl) → TerminalSessionScreen 嵌 xterm.js WebView 真键入并查看 stdout。桌面端 PtyManager 单例同时被 web-shell WS 网关 + cc ui WS 网关 + V6 native IPC 共享。

### Added

- **Desktop main process**: `PtyManager` (lazy node-pty + 256KB ring buffer + 24h idle kill + 4-shell whitelist + 8 concurrent limit) + `terminal-handlers.js` (8 WS topics: create/list/stdin/resize/close/history + server-push stdout/exit) + `terminal-ipc.js` (V6 native IPC bridge) + `confirmation-dialog.js` (dangerous-keyword Electron messageBox + permanent trust per-cmd cache). `handleMobileCommand` adds `terminal.*` namespace + per-mobile-peer stdout/exit subscription fanout.
- **CLI workspace mirror**: `attachTopicHandlers` shared helper (extracted from `ws-cli-loader` dispatcher wrap, ESM); `agent-runtime.startUiServer` attaches `terminal.*` handlers — `cc ui` users get the same terminal route as desktop web-shell. `node-pty` added as optionalDependencies (workspace hoist resolves it without breaking install on platforms without prebuilds).
- **Web Panel**: `useTerminal` composable + `Terminal.vue` route `/terminal` (xterm.js lazy import + multi-session tabs + history backfill + ResizeObserver + dangerous-keyword toast) + sidebar entry under "去中心化" group.
- **V6 plugin widget**: `plugins-builtin/terminal/plugin.json` + `shell/widgets/TerminalWidget.vue` + `shell/TerminalPanel.vue` modal (xterm.js + `electronAPI.terminal.*`) + slash command `/terminal`.
- **Android**: `TerminalRpcClient.kt` (reuses `SignalingRpcClient` envelope pattern, observeStdout/observeExit SharedFlow) + `TerminalWebView.kt` (Kotlin↔JS bridge) + `xterm-shell.html` + bundled xterm.js / addon-fit / xterm.css under `assets/terminal/` + `TerminalListScreen` / `TerminalSessionScreen` Compose + softkey toolbar (Ctrl/Tab/Esc/arrows/Ctrl+C/D) + NavGraph routes + RemoteOperateScreen "打开远程终端" entry.
- **Docs**: `docs/design/Android_Remote_Terminal_Plan_A.md` + `docs-site/docs/guide/remote-terminal.md`; both doc sites resynced.

### Tests — 162 new, all green

- Desktop main: 61 (RingBuffer 7 + PtyManager 15 + terminal-handlers 15 + terminal-ipc 12 + confirmation-dialog 5 + ws-smoke 6 + **real-pty smoke 1, spawns cmd.exe and asserts probe in stdout**)
- CLI cc ui: 21 (PtyManager 10 + handlers 8 + ws-mirror-smoke 3)
- Web Panel: 17 useTerminal unit + **3 e2e** (real `cc ui` subprocess + real WebSocket + real shell stdin/stdout round-trip via probe echo)
- Android: 10 `TerminalRpcClientTest` (full happy path + flow event fanout)

### Fixed — pre-existing test drift swept during the full-suite run

- `widget-registry.test.ts` expected 5 ids, PREVIEW_WIDGETS already at 7 (`bridge-mtc` + `federation-governance` drift since commits `a8fff1f52`/`1c1e4096d`).
- `dashboard-store.test.js` missing `mcp.list_tools` sendRaw mock (drift since `d9cc41432`).
- `views-mount-smoke.test.js` 5 tail views: Projects.vue had static title (i18n drift since `bfdde637d`); 4 others (VideoEditing/P2P/Memory/Git) split into `views-mount-smoke-tail.test.js` for fresh worker context.
- `Projects-folder-picker.test.js` deleted — tested UI no longer exists.

---

## [Unreleased] - 2026-05-13 (later) — Android 社交功能产线化（demo → production）

> 14 屏 + 9 ViewModel + 4 Repository 的社交骨架 (~10K LOC) 建好已久，但 NavGraph 只接通 MyQRCode / QRCodeScanner 两路由，其它 7 路由是 `registerPlaceholder("temporarily simplified")`；`SocialScreen` Friends / Timeline 两 tab 显示固定字串；`PostRepository.reportPost` 构造完 entity 不入库；`FriendRepository.searchUserByDid` 非本地 DID 返回 null。本次一次性收口，**不 bump version**，与本日早期 P0 前置一起 release。

### Added

- **NavGraph 7 占位换实屏 + 2 新路由** — `PublishPost / PostDetail / FriendDetail / UserProfile / AddFriend / CommentDetail / EditPost` 全部接 Composable；新增 `NotificationCenter` / `BlockedUsers` 两路由（前者作为 deep-link target，后者由 `FriendListScreen` 新加 dropdown 入口可达）。DID 文档加载期渲染 `CircularProgressIndicator` 占位。
- **`SocialScreen.kt` 三 tab 升级** — Friends → `FriendListScreen`（保留 P2P chat 入口 CTA）；Timeline → `TimelineScreen`，myDid 走 `DIDViewModel.didDocument.collectAsState()`；Notifications → `NotificationCenterScreen`（带筛选 / 批量已读 / 清理菜单），删旧的内联 basic 列表 + 2 个 `R.string.social_*_placeholder` 引用。
- **`PostReportDao` 落地** — `PostReportEntity` 早在 schema v23 在册，但 DAO 一直缺。新建 `core-database/.../dao/social/PostReportDao.kt`（7 个查询/更新方法）+ 注册到 `ChainlessChainDatabase` + `DatabaseModule` `@Provides`。`PostRepository.reportPost()` 改走 `postReportDao.insertReport()` + `hasReporterReportedPost()` 去重让重复举报 idempotent；`getUserReports()` 走 `postReportDao.getReportsByReporter().asResult()` 不再 hardcode 空；新增 `getPostReports() / getPendingReportCount()` 供 moderation 排序信号。
- **PROFILE_QUERY / PROFILE_RESPONSE 协议** — `MessageType` 加 2 项；`core-p2p/.../realtime/SelfProfileProvider.kt` 接口 + `SelfProfileSnapshot` data class；`RealtimeEventManager.queryProfile(targetDid, timeoutMs=5_000L)` 用 `onSubscription { send }` 在订阅完成后才发请求，解 `_profileResponseEvents` (replay=0) 的订阅竞态；`handleProfileQuery` 通过 `AtomicReference<SelfProfileProvider?>` 读取注入的 provider 自动回包，未注入或返回 null 时静默忽略（向后兼容旧节点）。`feature-p2p/.../repository/social/DefaultSelfProfileProvider.kt` 默认实现：DID 末 8 位占位昵称（与 `MyQRCodeViewModel.kt` L100 同规则），在 `ChainlessChainApplication.delayedInit()` 走 `AppEntryPoint` 注入。`FriendRepository.searchUserByDid()` 本地未命中即 fallback 远端查询，超时返回 `Result.Success(null)`（UI 显示"未找到"，不弹错误）。
- **`BlockedUsersScreen` 接 ViewModel** — 之前 `blockedUsers = mutableStateOf(emptyList())` 写死 + TODO 注释。`FriendViewModel` 注入 `DIDManager`、新增 `loadBlockedUsers()` + state field `blockedUsers / isLoadingBlockedUsers`；`unblockFriend(did)` 现在走完整 `friendRepository.unblockUser(myDid, did)` 路径（同时清 `BlockedUserEntity` 行），未登录态 fallback 到 flag-only `unblockFriend(did)`，避免孤儿屏蔽记录。`FriendListScreen` dropdown 加 "屏蔽用户" 入口，通过 `MainContainer → SocialScreen → FriendListScreen → NavGraph.Screen.BlockedUsers.route` 链路打开。

### Tests — 39 new, all green

| 层 | 文件 | 数量 |
|----|------|------|
| Unit (core-p2p) | `RealtimeEventManagerProfileQueryTest` | 6 |
| Unit (feature-p2p) | `PostRepositoryReportTest / FriendRepositoryRemoteLookupTest / FriendViewModelBlockedUsersTest / DefaultSelfProfileProviderTest` | 4+4+4+2 = 14 |
| Integration (core-database) | `PostReportDaoTest` (Robolectric + in-memory Room) | 8 |
| Regression (app) | `SocialRouteRegressionTest / SocialScreenTabRegressionTest` | 6+5 = 11 |

**关键学习——race-fix**：`queryProfile resolves with matching PROFILE_RESPONSE` 这个测试最初用 `runTest` 跑 fail——`RealtimeEventManager` 内部 `scope = CoroutineScope(Dispatchers.IO + SupervisorJob())` 与 `runTest` virtual-time TestDispatcher 不在同一调度图，2s timeout 在 virtual 时间瞬时跳完，IO 协程还没来得及 `handleRealtimeMessage` 就 fail。改 `runBlocking + withTimeout(10_000)` 跑真实并发后通过。

### Files

```
新增 (5):
  android-app/core-database/src/main/java/.../dao/social/PostReportDao.kt
  android-app/core-p2p/src/main/java/.../realtime/SelfProfileProvider.kt
  android-app/feature-p2p/src/main/java/.../repository/social/DefaultSelfProfileProvider.kt
  + 8 测试文件 + 1 设计文档 (docs/design/Android_Social_Wiring_2026-05.md)

修改 (14 Kotlin + 8 文档):
  Application / AppEntryPoint / NavGraph / MainContainer / SocialScreen
  ChainlessChainDatabase / DatabaseModule
  P2PDevice / RealtimeEventManager
  FriendRepository / PostRepository / BlockedUsersScreen / FriendListScreen / FriendViewModel
  README.md / README_EN.md / docs/FEATURES.md
  docs-website-v2/src/pages/{,en/}mobile.astro
  docs-site/docs/design/* (sync) / docs-site-design/docs/* (sync)
```

[详细设计文档 →](docs/design/Android_Social_Wiring_2026-05.md)

---

## [Unreleased] - 2026-05-13 — v1.2 GA 反馈整合：P0 前置 + project workflow + 11 daily templates + 6 bug fix ([#21](https://github.com/chainlesschain/chainlesschain/issues/21))

> 本批分两阶段。**阶段 1** (v1.2 GA 上架前)：A.3 ADR review / B.6 PQC 严格模式 verifier / B.2 削 web-shell `/multisig` cc subprocess 冷启三项 GA-independent + AI-3 forward-compat seam + 2 相关 bug fix。**阶段 2** (v1.2 GA 反馈到位)：5+3 反馈整合 #2 (删除 bug) / #3 (模板改日常) / #4-#7 (桌面↔手机项目工作流: CLI + REMOTE handler + 双向 sync walker) / #8 (web-shell 项目菜单 + 双端一致 view) 落地 P1+P2+P3 Part A。**version 不 bump** — v1.2 GA 反馈仍在收集中, 与未来 P1 主体一起 release。

### Added — [#21](https://github.com/chainlesschain/chainlesschain/issues/21) P0 前置三项 GA-independent

- **A.3 ADR Review v2.0**（commit `348896382`）—— 新增 [`docs/design/Android_ADR_重评估_v2.0.md`](docs/design/Android_ADR_重评估_v2.0.md) v1.0；8 ADR 全 audit 结论 **5 keep / 2 amend / 1 revise**：ADR-2 (M2 DID wallet 走软件 Ed25519，blocks B.3 DID rotate) 待 v1.2 GA Play Console API level 数据决策选项 A/B/C；ADR-7 (cc-mobile.json 从未创建，实际走 user_settings 表 + `mobile.*` scope) + ADR-8 (实际 disk-first + push-based，非 pull) 文本 amend 落 §4 对齐真实。同 commit §10 v1.3+ scope triage 分层（12 子项 P0/P1/P2 + 5 依赖链）。
- **B.6 PQC 严格模式 verifier gate**（commit `e24386d00`）—— `packages/core-mtc/lib/landmark-cache.js` 加 `strictPqMode` opt-in flag + `_assertStrictPqMode()` + `_assertStrictPqModeForSnapshot()` 两层 gate + `STRICT_PQ_MODE_VIOLATION` error code + `CLASSICAL_ALGS` 常量 + `isClassicalAlg` helper。Reading A 语义：拒收任何 `alg === "Ed25519"` 的 partial sig + publisher_signature；与现 heterogeneous federation 数据格式兼容，0 schema 改动；生产者侧 0 改动（用户已可配 SLH-DSA signers）。
- **B.2 in-process multisig.* + marketplace.consume topics**（commit `b1c7cfd95` + label fix `c21ba9346`）—— `desktop-app-vue/src/main/web-shell/handlers/multisig-handlers.js` 新增 7 个 WS topics 镜像 CLI `--json` 输出 shape：`multisig.list / show / policy.show / cancel / finalize / sweep` + `marketplace.consume`。Topics 调 `openMultisigManager()` from CLI `multisig-runtime.js`（per-call open SQLite WAL ~20ms），dynamic-import 跨 CJS/ESM 边界。`Multisig.vue` 加 `callMultisigTopic(topic, msg, fallbackCmd)` helper 用 `useShellMode().isEmbedded` 分发；7 处 `ws.executeJson` 全切；非 embedded（cc serve 无 asar 开销）保留原 subprocess fallback。**性能：asar:true 子进程冷启 6-10s → in-process ~20ms (SQLite open) + 查询，60-100× 提升**。UX 0 改动。
- **A.3 AI-3 SkillMetadata.signature forward-compat**（commit `45a88270e`）—— Android-side Kotlin。新增 `ManifestSignatureVerifier.kt`：`interface` + sealed `VerificationResult.{Accepted | Rejected(reason)}` + `object NoOpManifestVerifier` always-accept stub（默认 wired）。`SkillMetadata.kt` 加 `signature: String? = null` field + init invariant（null = unsigned legacy，blank reject）。`RemoteSkillRegistry.kt` 加 `@Volatile manifestVerifier = NoOpManifestVerifier` + `setManifestVerifier(v)` swap seam + `updateFromRemote()` 跑 verifier per-skill（Accepted 合并，Rejected `Timber.w` warn-log + 跳过，accepted.isEmpty() 短路）。Marketplace M0（#21 AI-5）上线时注入真 Ed25519/SLH-DSA hybrid verifier 即可，调用方 0 改动。

### Fixed

- **wear test imports**（commit `c0d061328`）—— `CcPhoneDecisionListenerTest.kt` 自 `cc08da0b0` (v1.2 #20 P0.2 wear Phase 2) 起用 `kotlinx.coroutines.GlobalScope.launch { ... delay() }` 写 smoke 测试，但 imports 缺 `launch`/`delay`/`GlobalScope`/`DelicateCoroutinesApi` —— `launch` 是 extension function，fully-qualified `GlobalScope.launch` 也必须 import 才能 resolve。block 了整个 `:app:compileDebugUnitTestKotlin`。加 4 imports 解锁。CI 此前未报可能因 wear test 未纳入 `:app` 测试目标或 continue-on-error 沉默。
- **B.6 strict mode disk-load gate**（test-driven 发现于本次 QA sweep）—— `LandmarkCache.loadFromDisk()` 直接调 `_validateAndStoreSnapshot()`，bypassing `ingest()` 里的 `_assertStrictPqMode()` 调用。结果：strict mode OFF 时写入磁盘的 Ed25519 landmark，下次 strict mode ON 加载时**仍接受**（silent strict invariant 违反）。修：把 per-snapshot 严格检查移到 `_validateAndStoreSnapshot()` 头部，让 ingest + loadFromDisk 两条路径都有 gate；`_assertStrictPqMode(landmark)` 简化为只查 publisher_signature。+2 新 disk-load integration tests 锁回归。

### Added — v1.2 GA 反馈整合 5+3 项 ([#21](https://github.com/chainlesschain/chainlesschain/issues/21) #2/#3/#4/#5/#7/#8)

- **#2 项目无法删除 fix** (commit `fc24f9856`) —— `ProjectScreen.kt::EnhancedProjectCard` 完全没有 delete UI（feature-project/.../ProjectListScreen.kt 的 delete 代码是死代码未连入 NavGraph）。加 3-dot 菜单 + AlertDialog 确认 + `onDeleteClick` → `viewModel.deleteProject` → DAO softDelete (status='deleted') → Room Flow 自动从列表移除。
- **#3 项目模板改日常** (commit `99d38bf69`) —— L1+L2+L3 mobile 定位下用户不是程序员，原 11 IDE 模板 (Android/React/Spring/Flutter 等) 跟使用场景不符。整个 `ProjectTemplates` 重写为 11 日常生活模板：购物清单 / 旅行计划 / 读书笔记 / 灵感收集 / 健身计划 / 食谱记录 / 学习计划 / 家庭账本 / 工作日志 / 会议记录 / 空白。`TemplateCategory` 加 5 个日常类目 (DAILY/TRAVEL/STUDY/HEALTH/FINANCE)。`TemplateLibrary` `getCategoryIcon`/`getCategoryType` when 表达式补 5 个新分支防 compilation error。strings.xml 加 5 新 string (zh-rCN + en)。
- **#4/#7 桌面 CLI + REMOTE handler P1** (commit `32ccabdb5`) —— `packages/cli/src/lib/project-runtime.js` (SQLite cascade + Electron userData path resolution Win/macOS/Linux) + `packages/cli/src/commands/project.js` (`cc project init/list/show/delete` 4 subcommands 直写 desktop chainlesschain.db, WAL mode 并发安全)。`desktop-app-vue/src/main/remote/handlers/project-management-handler.js` (6 actions: list/get/init/delete/listFiles/getFile) 暴露给 Android L3 REMOTE 调用, 复用 desktop DatabaseManager。CLI 7 integration tests + handler 21 unit tests 全过。
- **#4 Android→Desktop 反向 sync P2** (commit `2646bbb4e`) —— audit 发现：桌面→手机 sync 通 (mobile-bridge-sync `_fetchProjects` walker + Android `ProjectSyncApplierImpl`), 反向手机→桌面断 (`SocialSyncWalker` 不含 projects 表)。新增 `ProjectDao.getProjectsSinceCursor` (无 status 过滤让 status='deleted' 也 emit) + `ProjectSyncWalker.kt` (feature-project, ~120 LOC, op mapping CREATE/UPDATE/DELETE, snake_case JSON 对齐 desktop) + `CompositeSyncRepositoryWalker.kt` (`:app`/sync 聚合 SocialSyncWalker + ProjectSyncWalker) + `SyncWalkerModule.kt` (Hilt `@Binds → Composite` replaces feature-p2p single-walker binding)。P2PModule.kt 注释旧 binding。ProjectSyncWalker 12 tests + CompositeSyncRepositoryWalker 7 tests。顺手修 5 个 pre-existing feature-project 测试 `kotlin.test.*` → `org.junit.Assert.*` imports unblock `:feature-project:compileDebugUnitTestKotlin`。
- **#5/#8 web-shell Projects view + in-process WS topics P3 Part A** (commit `bfdde637d`) —— `desktop-app-vue/src/main/web-shell/handlers/project-handlers.js` 6 in-process WS topics 包装 P1 ProjectManagementHandler (DRY: 同一 handler 同时服务 web-shell + mobile L3 REMOTE, 避免 ws.execute('cc project …') asar:true 6-10s 子进程冷启)。新 `packages/web-panel/src/views/Projects.vue` 项目管理列表 (4 stats + filter + table + Detail drawer 含文件列表 + Create modal 10 types)，`useShellMode().isEmbedded` 分发 in-process vs `ws.executeJson` 兜底。原 Projects.vue "项目 init/setup/templates" 内容移到新 `views/ProjectInit.vue` (路由 `/project-init`) 保留 backward 访问。project-handlers 7 unit tests。

### Fixed

- **wear test imports**（commit `c0d061328`）—— `CcPhoneDecisionListenerTest.kt` 自 `cc08da0b0` (v1.2 #20 P0.2 wear Phase 2) 起用 `kotlinx.coroutines.GlobalScope.launch { ... delay() }` 写 smoke 测试，但 imports 缺 `launch`/`delay`/`GlobalScope`/`DelicateCoroutinesApi`。block 了整个 `:app:compileDebugUnitTestKotlin`。加 4 imports 解锁。
- **B.6 strict mode disk-load gate**（test-driven 发现于 P0 QA sweep）—— `LandmarkCache.loadFromDisk()` 直接调 `_validateAndStoreSnapshot()`，bypassing `ingest()` 里的 `_assertStrictPqMode()` 调用。修：把 per-snapshot 严格检查移到 `_validateAndStoreSnapshot()` 头部，让 ingest + loadFromDisk 两条路径都有 gate；`_assertStrictPqMode(landmark)` 简化为只查 publisher_signature。+2 disk-load integration tests 锁回归。
- **feature-project pre-existing kotlin.test imports** (P2 sweep) —— `CodeCompletionTest` / `CodeFoldingTest` / `EditorTabManagerTest` / `Phase6IntegrationTest` / `Phase9IntegrationTest` 5 文件用 `kotlin.test.assertEquals/assertTrue` 但 deps 无 `kotlin.test`，block `:feature-project:compileDebugUnitTestKotlin`。改成 `org.junit.Assert.*` 解锁。

### Tests

阶段 1 (P0):
- **`landmark-cache-strict-pq-mode.test.js`** 11/11 pass（原 9 + 2 disk-load integration tests for strict mode persistence）
- **`multisig-handlers.test.js`** 23/23 pass（B.2 via `runtimeFactory` 注入 seam）
- **`ManifestSignatureVerifierTest.kt`** 10/10 + `SkillMetadataTest` 9/9 + `RemoteSkillRegistryTest` 38/38 regression 全过

阶段 2 (project workflow):
- **`project-management-handler.test.js`** 21/21 pass（P1 desktop handler）
- **`project-cli.test.js`** 7/7 pass（P1 `cc project` CLI integration via sql.js WASM temp DB）
- **`ProjectSyncWalkerTest.kt`** 12 tests (P2 Android walker — pending CI run，本地 feature-project test 套有 pre-existing 不相关 failures)
- **`CompositeSyncRepositoryWalkerTest.kt`** 7/7 pass（P2 :app 聚合，2026-05-13 Phase 4 加）
- **`project-handlers.test.js`** 7/7 pass（P3A web-shell wrapper）
- Android `:app:testDebugUnitTest` regression: **80/80 pass** (ManifestSignatureVerifier 10 + RemoteSkillRegistry 38 + SkillMetadata 9 + SeedRegistry 10 + RegistryStore 6 + CompositeSyncRepositoryWalker 7)
- Desktop combined: **51/51 pass** (project-handlers 7 + multisig-handlers 23 + project-management-handler 21)

## [v5.0.3.49] - 2026-05-12 — M-of-N multisig Phase 1d + Phase 2a marketplace mediator + Phase 2b web-panel Multisig view + Flow B QR pairing 收口 + 测试补丁

> 本版四条主线：(1) **`@chainlesschain/core-multisig` package + `cc multisig` CLI 落地**（commit `3c890dcac`，v1.2 m-of-n Phase 1d）—— Phase 1 完整 5-lib（policy / store / proposals / signing / governance-log），CLI 8 subcommands（propose / sign / cancel / finalize / list / show / sweep / policy），75 lib 单测 + 10 CLI integration 测试全过。(2) **Phase 2a marketplace.purchase mediator**（commit `2755093d0`）—— 设计文档 §6.1 落地：`cc marketplace purchase` 大额（≥¥1000）自动走 M-of-N 多签 propose，小额走 direct；`cc marketplace consume` 在 threshold 达成后 finalize + 执行业务；抽 `multisig-runtime.js` 共享 SQLite cascade（-130 行 dedup，Phase 1 10/10 零行为变更）；8 新 E2E 测试全过。marketplace.purchase 是第一个真实接通业务侧的 mediator。(3) **Phase 2b web-panel Multisig 视图落地**（commit `c758492d9`）—— 设计文档 §8.1 落地：web-shell（默认桌面入口）加 M-of-N 多签查看 / 操作面板，Phase 1 CLI 的 `cc multisig list/show/cancel` + `cc marketplace consume` 通过 `ws.executeJson(...)` 走 CLI 子进程；同份 SPA 在 desktop web-shell + cc ui 两边都自动可用。(4) **Android v1.1 W3.7 Flow B QR pairing 落地**（commit `c47cbc649`）—— desktop 显 QR / phone 扫的主流应用通用 UX（微信/支付宝同模式），Xiaomi 24115RA8EC 真机 E2E verified。同步补齐 Flow B 漏掉的 2 个测试文件：`ScanDesktopPairingViewModelTest` 10 项 + `desktop-pair-handlers.test.js` 19 项。

### Added — M-of-N multisig core（v1.2 #20 P0.3 Phase 1d）

- **`@chainlesschain/core-multisig` npm workspace package**（commit `3c890dcac`）—— 5 个 lib 文件：
  - `policy.js` 域级 policy `{m, n, members[], requirePqc, defaultExpiryMs}` validate + normalize
  - `store.js` SQLite schema 3 表（proposals / signatures / policies）+ 5 操作 helper
  - `proposals.js` 状态机 propose / sign / cancel / finalize / expireStale；`pending → reached → consumed` + `cancelled` / `expired` terminal
  - `signing.js` JCS canonicalize + DOMAIN_PREFIX `"MULTISIG:"` 防回放 + Ed25519 / SLH-DSA dispatcher + verifyThreshold strip-all-sigs
  - `governance-log.js` append-only JSON Lines 审计 log（proposed / signed / reached / consumed / cancelled / expired / expired_sweep）
  - 75 单测全过（policy 14 + signing 21 + proposals 20 + store 12 + governance-log 8）
- **`cc multisig` CLI 8 subcommands**（commit `3c890dcac`）—— propose / sign / cancel / finalize / list / show / sweep / policy {set, show}；全 `--json` 输出。
- **SQLite driver cascade native → WASM**（per memory `feedback_sqlite_wasm_fallback`）—— `better-sqlite3-multiple-ciphers` / `better-sqlite3` 加载失败时自动降级 `sql.js` (WASM)，CLI 跨平台开箱即用，无须每平台预装 native prebuild。
- **测试基础修复 3 项**：core-multisig `vitest.config.js` 设 `globals: true`（vitest 4 不接 CJS `require("vitest")`，memory `cli_ci_sharding_lessons`）；5 个 test 文件改 ESM `import` 头；`multisig-cli.test.js` import 路径修 `@chainlesschain/core-mtc/signers/ed25519.js` → 去 `.js` 后缀（core-mtc exports key 无后缀）。
- 10/10 CLI integration tests pass。

### Added — Phase 2a marketplace.purchase mediator（v1.2 #20 P0.3 Phase 2）

- **共享运行时抽取** `packages/cli/src/lib/multisig-runtime.js`（commit `2755093d0`，新文件）—— Phase 1 commands/multisig.js 内联的 SQLite cascade（better-sqlite3-multiple-ciphers → better-sqlite3 → sql.js）+ manager loader 抽出公共模块，让 commands/marketplace.js 复用同一份。
- **commands/multisig.js refactor**（commit `2755093d0`）—— 用 `multisig-runtime.js` 替代内联 `_openManager` / `_openDatabase` / `_adaptSqlJs` / `_readKey` / `_readJsonArg`，−130 行 dedup。Phase 1 10/10 integration test 全 green，零行为变更。
- **`cc marketplace purchase <itemId>` 新 subcommand** —— `--amount-fen N --buyer <did> --key <hex> [--threshold-fen N] [--item-name <name>]`：amount < threshold (default `LARGE_PURCHASE_THRESHOLD_FEN = 100_000` fen = ¥1000) 走 direct path（CLI stub 打印 "purchased"）；amount ≥ threshold 必须有 `marketplace.purchase` 域 policy，否则 exit 2 `no_policy`；有 policy 调 `mgr.propose` 返 proposalId 让其他签名方加签。
- **`cc marketplace consume <proposalId>` 新 subcommand** —— 校验 `domain == "marketplace.purchase"` + `state == "reached"` 才执行；finalize 后打印订单 payload + governance log 写 `consumed`。错域 / 错态都 exit 2。
- **8 新 E2E test 全 green**（`packages/cli/__tests__/integration/marketplace-multisig-e2e.test.js`）：大额 ¥1500 2-of-2 walkthrough（policy → purchase → sign×2 → consume → governance.log 4 类事件 `proposed`/`signed`×2/`reached`/`consumed`）/ 小额 ¥500 direct path / `--threshold-fen` override / 大额无 policy → exit 2 / consume pending → exit 2 / consume 错域 → exit 2 / `--help` 文本。
- 总 **18 multisig integration test 全 green**（Phase 1 10 + Phase 2 8）。

### Added — Phase 2b web-panel Multisig 视图（v1.2 #20 P0.3 Phase 2b）

- **`packages/web-panel/src/views/Multisig.vue`**（commit `c758492d9`，新文件 468 行）—— 6-card 顶部 stats（总数 / pending / reached / consumed / cancelled / expired）+ 两个 tab：**提案列表**（columns ID / Domain / State / Sigs / Created / Expires / Actions + state 过滤 + domain 过滤 + 行 actions 详情 / 取消 / 执行购买）/ **域策略**（列 marketplace.purchase / did.rotate / crosschain.outbound 已知 domain policy + 成员展开）+ 640px Detail drawer（Descriptions 显 domain / state / threshold / sigs / initiator / timestamps / payload JSON + 签名列表 + 操作按钮 取消 / 执行购买 / finalize）+ info Alert "web shell 不持私钥 sign 走 CLI"。
- **router/index.js + AppLayout.vue**（commit `c758492d9`）—— 加 `/multisig` 路由 + sidebar security/audit 组 multisig menu item（TeamOutlined icon）+ 折叠模式同步 + i18n fallback "M-of-N 多签"。
- **WS 通信走 CLI 子进程** —— `ws.executeJson('multisig list --json')` 等通过 CLI WS server `_executeCommand` 路径；冷启动 6-10s（asar:true 开销）Phase 2 可接受；Phase 3 可加 in-process WS handlers 削延迟。
- **同份 SPA 复用** —— desktop web-shell + cc ui 两边自动可用（per memory `feedback_cross_shell_feature_pattern`）。
- **Phase 3 follow-up**：私钥签名 UI（需 Unified KeyStore 接通）、in-process WS handlers、实时推送（现 onMounted 拉一次）、Marketplace.vue purchase modal 集成。

### Added — Android v1.1 W3.7 Flow B QR pairing（issue #19）

- **Mobile 端扫描桌面 QR 完整链路**（commit `c47cbc649`）—— Phone 摄像头扫桌面屏幕 QR 比反向（desktop webcam 扫小手机屏）识别率高得多，是主流应用通用 UX 模式。9 项实战坑全排清（memory `desktop_qr_pairing_flow_b.md`）：`<a-qrcode>` 必须显式 async-register / `parseJsonOutput` log-prefix vs JSON-array regex / `mobileBridge.peerId` 必须 `this.` / social `QRCodeScannerViewModel` 校验 reject 非好友 QR / pair-ack 拦截在 bridgeToLibp2p 前 / in-memory ack vs CLI 写 DB 双轨 / 跨模块 DI / adb reverse 无域名 E2E / Flow B QR 字段含 `pcPeerId`。
- **跨模块 DI 拆解**：`PairingSignalingGate.sendAck` interface 落 `:core-p2p` 避免 `:feature-p2p` 反依赖 `:app`；`WebSocketPairingSignalingGate.sendAck` 实现在 `:app` 内 `ensureRegistered + Mutex` 串行化；`WebRTCClient.SignalClient.sendForwardedMessage(toPeerId, payload)` 桥接 mobile 端的 signaling forward。
- **Desktop 端 WS topics 三件套** `desktop-pair-handlers.js`：`desktop.pair.generate-qr`（生成 6 位 code + payload + pcPeerId 三段 fallback：`mobileBridge.peerId` → `deviceManager.getCurrentDevice` → `"desktop-unknown"`）/ `desktop.pair.poll-ack`（idle / waiting / acked / expired 四态）/ `desktop.pair.reset`；`mobile-bridge.js` 加 `this.peerId` 持久化 + 拦截 `type=pair-ack` 经 `recordPairAck` 匹配 + 写 SQLite paired_devices。
- **Vue UI** `MobileBridge.vue` Flow B tab（默认）+ Flow A + 手输 3-tab；`antd.js` 注册 `AQrcode`。
- **真机 E2E verified**：Xiaomi 24115RA8EC desktop QR → ML Kit 扫 → signaling pair-ack → desktop mobileBridge 拦截 → recordPairAck 匹配 → CLI `pair-from-qr` 写 SQLite → Vue 列表刷新。

### Added — 单元测试补丁

- **`ScanDesktopPairingViewModelTest.kt`**（新增 10 测试）—— 覆盖 ScanDesktopPairingViewModel `onQrScanned` 全部 validation 分支 + happy path + retry + idempotent + malformed JSON。MockK + StandardTestDispatcher + FakeGate（捕获 sendAckCallCount）。
- **`desktop-pair-handlers.test.js`**（新增 19 测试）—— 覆盖 3 个 handler factory + `recordPairAck`：generate-qr 6 case / poll-ack 4 case（用 `vi.useFakeTimers` 验 expired 态）/ reset 1 case / recordPairAck 4 case。
- **Android `:feature-p2p:testDebugUnitTest` 41s 全绿**（138 actionable tasks）；Desktop 3 文件 / 45 测试全绿。

### Distribution

- 桌面 binary：v5.0.3.48 → v5.0.3.49 重打（含 Flow B + multisig 新代码；auto-updater 比对 `5.0.3-alpha.49 > 5.0.3-alpha.48`）
- `chainlesschain` npm 0.161.8 → 0.161.9（cli 加 multisig command + dep `@chainlesschain/core-multisig`）
- Android：versionCode/Name 不变（v1.0.0 GA 维持），Flow B 走桌面端首发；后续 Android v1.1 minor release 一并 ship 完整移动客户端
- 三大文档站同步刷新：docs-site / docs-site-design / docs-website-v2 tagline 升 v5.0.3.49 + 加本节 changelog；CHANGELOG.md + README.md / README_EN.md 同步

## [v5.0.3.48] - 2026-05-12 — Android M3 capture suite (5/5 code) + M4 RemoteSkillRegistry method-level + ApprovalUI 4-category + ProgressViewer + alias 兼容窗口

> Android v1.0 RFC M3 + M4 收尾批次（7 commit / 187 新单测）+ **Android M7 GA flip 一并落地（commit `ffe722162`，versionCode 37 → 100，versionName 0.37.0 → 1.0.0）**。把设计文档 §5.3 L2 捕获五件套补齐到代码层（VoiceMode / CameraOCR / LocationTagger / SharePayloadFlusher / PushNotifier）+ §6 M4 D1 RemoteSkillRegistry method-level 元数据 + §5.4 ApprovalUI 4-category 适配 + ProgressViewer 长时任务面板 + §8.3 alias 兼容窗口。Android 总单测 196+ → 383+。无桌面 / CLI 源码改动，CLI npm 0.161.7 → 0.161.8（force publish 走 release.yml 同步轨道）。Android v1.0 GA 仍待用户出场（4 项）：M3 真机 E2E / M4 D2 真机 / FCM 凭证 / M6 性能实测。

### Added — Android M3 capture suite (5/5 code)

- **VoiceMode 连续语音串联**（commit `47bebed80`）—— ASR → REMOTE chat → TTS pipeline 在 home 入口串通。
- **CameraOCR 拍照入 KB 流水线**（commit `a69269ced`）—— `ai.ocrImage` + `knowledge.createNote` 走完，自动写 OCR 元数据。
- **LocationTagger Play Services FusedLocationProvider + Foreground Service**（commit `3f5ac8647`）—— GPS 数据进 `createNote.metadata`，前台服务保证后台采集合规。
- **SharePayloadFlusher 接 SyncCoordinator → knowledge.createNote**（commit `3d1a6e3a8`）—— 5 种 SharePayload（Text / Url / SingleImage / MultiImage / GenericFile）转 note 字段；SyncCoordinator 30s push 循环末尾 `drain` SharedInboxRepository，失败 re-enqueue。19 新单测。
- **PushNotifier 本地通道 + FCM 骨架**（commit `c0d990c91`）—— 4 NotificationChannel（Cowork DEFAULT / Marketplace HIGH / SystemAlert DEFAULT / ShareInbox LOW）+ 协议中立 `CcPushNotificationService` 入口；google-services.json 真接入按 `android-app/docs/M3_FCM_SETUP.md` 5 步（用户出场）。36 新单测。

### Added — Android M4 收尾

- **RemoteSkillRegistry method-level 元数据补全**（commit `6e49270fd`）—— `MethodMetadata`（name / paramCount / riskOverride / requiresApprovalOverride）+ `listMethods` / `getMethod` / `requiresApprovalForMethod` / `riskForMethod` accessor；`knowledge.*` + `ai.*` 各 10 methods seeded（8 riskOverride 演示）；其他 21 namespace pending 桌面 `mobile-skill-whitelist` 下发。16 新单测。
- **ApprovalUI 4 category 适配**（commit `f4f83cc67`）—— `ApprovalCategory` enum {Sign / Cowork / Marketplace / SystemCritical} + `fromMethod` 推断；`AndroidApprovalGate` 4-arg overload 透传 category 透传到 dialog（旧 3-arg 自动 forward）；Dialog 按 category 切 icon / tint / title / footer。9 新单测。
- **ProgressViewer 长时任务面板**（commit `f4f83cc67`）—— `LongTaskRegistry` `@Singleton` `MutableStateFlow<List<LongRunningTask>>`（Pending / Running / Completed / Failed / Cancelled，MAX_TASKS=100 滑窗）+ `TaskProgressCommandRouter` 接 `task.*` reverse-RPC（update / complete / fail / cancel / remove）+ Compose `ProgressViewerScreen`（StatusChip + Linear / indeterminate Circular + dismiss / clear-terminal）。34 新单测（15 + 19）。
- **§8.3 RemoteSkillRegistry alias 兼容窗口**（commit `0bc8e2797`）—— `SkillMetadata.aliases: List<String>` + 内部 `aliasIndex` 反查；`get` / `listMethods` / `requiresApproval` / `risk*` 全部经 `resolveAlias` 路径自动解析；新增 `resolveAlias` public API。未来 namespace 改名时旧调用方 1 版内不 break。7 新单测。
- **§8.1 README versionName 滞后修正 + v1.0 GA 检查清单**（commits `0bc8e2797` `3da484e9c`）—— `android-app/README.md` M3 行 (2/5) → (5/5 code)、M4 行补 method-level + ApprovalUI + ProgressViewer；新增 `ANDROID_v1_GA_CHECKLIST.md`：v1.0 GA 仍待用户出场 5 项。

### Tests

- Android 新增 **187 单测全绿**（`./gradlew :app:testDebugUnitTest --tests "*Test"` 对应 14 个测试文件）。回归覆盖 capture / push / registry / task / approval-category / composite-router 全部新模块。
- Android 总单测 196+ → 383+（M1 0 + M2 68 + M3 130 + M4 152 + M5 33）。
- Desktop store 回归 26 文件 / 773 测 ✓；CLI lib 169 文件 / 7185 测 ✓（确认 Android 工作未污染 desktop / CLI 路径）。

### Distribution

- 桌面 binary：v5.0.3.47 → v5.0.3.48 重打（无桌面源码改动；auto-updater 比对 `5.0.3-alpha.48 > 5.0.3-alpha.47`，v5.0.3.47 用户重启拿到新 build）。
- `chainlesschain` npm 0.161.7 → 0.161.8（CLI 自身 0 源码改动；force publish 走 release.yml 同步轨道）。
- **Android：versionCode 37 → 100, versionName 0.37.0 → 1.0.0 GA**（commit `ffe722162`）—— M7 GA flip 与本批 M3/M4 工作一并落地；android-app/CHANGELOG.md 加 [1.0.0] - 2026-05-12 GA entry 汇总 9 commit + 4 项已知限制（FCM 国内 / 单 peer / 离线队列 / QRPairing scaffold）；android-app/README.md 标题切 "🎉 当前版本 v1.0.0 — GA"。下一步 tag `v1.0.0` 在 commit `ffe722162` 推 gitee+github。
- 三大文档站本次同步刷新：tagline 升 v5.0.3.48 + 加本节 changelog。

---

## [v5.0.3.47] - 2026-05-11 — Verification release：build-android keystore fix VERIFIED + density splits 14→4 落地 + outstanding `../` 全扫净

> 验证型发版。无桌面 / CLI / Android 源码改动，只把 v5.0.3.46 后陆续落的 3 个 release-pipeline 修复在 CI 实跑一遍证明 green。release.yml run #25632845952 全 11 个 job ✓（含 build-android、create-release、publish-cli、finalize-release），4 个 Android assets 入 GitHub Release v5.0.3.47。

### Verified

- **build-android keystore path mismatch（issue #N/A，commit `f9a7ba716`）** —— 历史：`49f1440ca` (2026-05-09) 把 `android-app/app/build.gradle.kts:79` 从 `file(...)` 切到 `rootProject.file(...)`，让 `release.storeFile` 路径解析基准从 `:app` 模块改成 rootProject (`android-app/`)。`.github/workflows/release.yml` 写的 `release.storeFile=../debug-ci.keystore` 在新基准下错位到 repo root（gradle 在 `<repo-root>/debug-ci.keystore` 找不到 keystore），v5.0.3.46 build-android 因此挂在 `:app:validateSigningRelease`。修法：去掉 workflow 里 `keystore.properties` 内容的 `../` 前缀，让 `rootProject.file("debug-ci.keystore")` 直接解到 `android-app/debug-ci.keystore`（正是 keytool 输出位置）。v5.0.3.47 release.yml run #25632845952 build-android 真绿 verified，且 4 Android assets（`app-{arm64-v8a,armeabi-v7a,universal}-release.apk` + `app-release.aab`）正确入 Release。
- **Density APK splits 用户侧首落（commit `9865c5c08`）** —— v5.0.3.46 已合，但因 build-android 挂没产出 release assets，本轮首次以 release 形态用户可见：每 density × ABI splits 在 Android 5.0+ runtime resource selection 加持下意义不大，移除后 release asset count 14 → 4（3 APK + 1 AAB），AAB 上 Play Store 继续走 `bundle{}` 块的 density delivery 不影响用户。
- **剩余 `../` 三处扫净（commit `5a06421cd`）** —— `f9a7ba716` 只修了 workflow；`keystore.properties.template` / `docs/guides/KEYSTORE_SETUP.md` / orphan `android-app/.github/workflows/android-release.yml` 同病的 `../` 这次一并扫掉。约定全 repo 统一：`release.storeFile=keystore/<name>.keystore`（无 `../`），物理 keystore 落 `android-app/keystore/<name>.keystore`。KEYSTORE_SETUP.md 的 CI 例子顺手加 `working-directory: android-app` 保 keystore 落对位置。orphan workflow 加头注释说明 `.github/workflows/` 嵌套层级 GitHub Actions 不会执行。

### Distribution

- 桌面 binary 重打：v5.0.3.46 → v5.0.3.47（二进制内容与 v5.0.3.46 等价，version 字段不同。auto-updater 比对 `5.0.3-alpha.47 > 5.0.3-alpha.46`，v5.0.3.46 用户重启会拿到新 build）
- `chainlesschain` npm 维持 0.161.7（无 CLI 改动，release.yml `cli-tests` job correctly skipped）
- Android：versionCode 37 / versionName 0.37.0 不变（无 Android 源码改动），但 APK 因 density splits 关闭从 14 个产物精简为 4 个 (`app-arm64-v8a`、`app-armeabi-v7a`、`app-universal` + `app-release.aab`)
- 三大文档站本次同步刷新：tagline 升 v5.0.3.47 + 加本节 changelog + deploy-all.py tar 路径同步

## [v5.0.3.46] - 2026-05-10 — Phase 3d 桌面 ↔ Android 双向同步全套 + Android 0.37.0 七件套 + e2e CI 静默回归洞收口

> 真正打通桌面 ↔ Android 的双向社交数据同步（Phase 3d M2 → v1.2 共 12 个 commit，gate 1-4 全部 Ed25519 真签真验），Android 端一次落 7 件用户可见功能（Volcengine 语音 / APK 自更新 / Splash 重做 / Claude coral 主题 / i18n 三地区 / 生物识别 / DID Key 屏），CI 收掉 e2e-tests `continue-on-error` 这个把 3/3 OS 失败显示 success 的静默回归洞。

### Added — Phase 3d Mobile-Bridge-Sync 桌面 ↔ Android 双向同步

- **M2: 5 ResourceType walker + tombstones + IPC wire-up**（commits `491fb4758` `a052e51c0` `dd2156ec3` `a4fe653f9` `9a8e3635d`）—— 桌面侧 sync engine 落地：scaffold mobile-bridge-sync provider，drop dead `MobileSyncManager`；rewrite 5 ResourceType walker（`note` / `conversation` / `did` / `community` / `channel`）+ apply 路径；tombstone 触发器 + `resource_type` 列；`mobile.ts` 真 provider + IPC wire-up；52 个 mobile sync 测试，过程中找出并修 3 个 prod bug
- **M3 step A→D.5: SocialSyncAdapter wiring + Room cursor + JSON-RPC handlers**（commits `28c85dad5` `647dc8699` `945001502` `510f6d2e0` `1131e35a2`）—— Android 侧：用 `dagger.Lazy` 解 4 处 Hilt 循环依赖；MESSAGE outgoing path；Room 持久化 `SyncRemoteCursor`；`sync.*` JSON-RPC handlers 在 SyncManager 落地；transport wiring + outbound JSON-RPC
- **M4: 设置页 + DeviceManager + 手动配对**（commits `0bf5f00b9` `17ea9b69d`）—— Settings 加 SyncMobile 移动设备同步页面（设备列表 + 同步状态 + 触发 push/pull）；DeviceManager wire-up + 手动 pairing 表单
- **v1.1: SocialSyncWalker for handlePullRpc 实数据 + DID auth 验证 + SyncCoordinator auto-trigger**（commits `2d841dfdc` `692e3e626` `b77e0773b`）—— Android 侧 walker 真填 `handlePullRpc` 不再 stub；`sync.*` topic 加 DID 签名验证；`SyncCoordinator` socket 连上后自动 trigger push/pull，不需要 UI 手动点
- **v1.2: 真 Ed25519 签名 + Android gate 4**（commits `c739d77d0` `4ecb7c8ef`）—— 桌面侧把 placeholder 签名换成真 `@noble/ed25519` 签名；Android gate 4 即对端 Ed25519 验签（前 3 gate 在 v1.1 已开），桌面 ↔ Android 4 个 gate 全部 strict-verify

### Added — Android 0.37.0（commit `1348636ad`，7 件用户可见功能）

- **Volcengine SeedASR 语音识别** —— `WavRecorder`（16kHz mono PCM → WAV）+ `VolcengineAsrClient`（HTTP submit + 800ms poll）+ `HomeStatusViewModel` 状态机 + `AsrSettingsScreen`（x-api-key 入口）+ Recording dialog（pulsing coral mic + breathing ring + mm:ss + 72dp Stop 圆）+ Transcribing dialog（3-dot breathing，跟 splash 一致）
- **APK 自更新（issue #21）** —— `UpdateChecker`（GitHub Releases API，tag prefix `android-v`，arm64-v8a asset 选择）+ `UpdateInstaller`（DownloadManager + FileProvider + ACTION_VIEW）+ `UpdateDialog`（changelog scroll + REQUEST_INSTALL_PACKAGES 权限流）+ Settings "检查更新" 入口带当前 versionName + Application 级 BroadcastReceiver 接 `DownloadManager.ACTION_DOWNLOAD_COMPLETE`
- **Splash + 主题大改** —— SplashScreen 紫色渐变 + 旋转环 + TT logo + 3-dot + progress + stage；`rememberUpdatedState` 修 splash race（之前 `nextAfterSplash` 在 AuthVM load 完之前被 capture 成 stale）；`Theme.kt` 切 Claude coral palette（`#D97757` primary + warm-gray dark + `#FAF9F5` bg）；`Type.kt` 加粗 headlines + 拉宽 body line-height；`dynamicColor=false` 默认保品牌色（Android 12+ 否则会被 Material You 改色）
- **i18n（issue #16）** —— `resourceConfigurations` 用 `zh-rCN` / `zh-rTW` / `zh-rHK` 显式 qualifier（fix：`zh` 作 language-only 在 build 时把 `values-zh-rCN/` 全过滤掉）；`AppCompatDelegate.setApplicationLocales` 在 SettingsScreen 接线；`MainActivity` → `AppCompatActivity` + `Theme.AppCompat.Light.NoActionBar` 父主题；`locales_config.xml` + `AppLocalesMetadataHolderService`（API <33 兼容）
- **Auth + DID** —— `AuthRepository.register` 幂等回退到 `verifyPIN`（fix race：AuthVM 异步 DataStore read vs splash navigate 抢跑）；SettingsScreen 生物识别 toggle 接 AuthVM `enableBiometric` / `disableBiometric`；新增 `KeyManagementScreen`（DID + public key hex + clipboard + trusted devices + reset）
- **Home page UX** —— LLM 未配置 banner 显示在 BrandSection 上方（点击跳 LLM Settings）；Send-from-home prefill 通路：home → NewConversation route 带 prefill；`ConversationViewModel.getDefaultModel()` + 自动建会话（prefill 跳过 picker UI）；BrandSection / AboutScreen logo 切 `R.mipmap.ic_launcher`（TT 品牌）；FunctionEntryCard 12 个硬编码彩色 → 统一 surfaceVariant + 44dp icon chip
- **Launcher icons** —— 替换默认 Android 机器人 `mipmap-{m,h,xh,xxh,xxxh}dpi/ic_launcher{,_round}.png` 为 TT logo（PIL LANCZOS resize）
- **顺手修的 latent bug**：`OpenAIAdapter.{chat,chatWithTools,checkAvailability,streamChat}` 加 `withContext IO` + `flowOn`（之前 block main thread → 12s 主页冻结）；`RemoteConnectionManager.invoke{,WithRetry}` inline reified `<T : Any>`；`ProcessManagerViewModel.cpuUsage` Elvis fallback 改 `Double 0.0`；`SystemMonitorScreen.kt:149` `os?.type/version` null-safe；256 个 `rs_*` string stub 自动生成（remote/ui/* 屏 Phase 3d v1.3 work 平行编译需要）

### Fixed

- **Android `sync.*` DID auth strict-mode flip + release build unblock**（commit `49f1440ca`）—— `sync.*` topic 的 DID 鉴权从可选变强制；release build 之前因 lint baseline 漂移挂的 issue 一并修
- **2 个 mobile-ipc 测试 stale after M4.5**（commit `d34de0ac0`）—— DeviceManager wire-up 改了 IPC shape，把测试同步对齐
- **官网移动端 hamburger 菜单**（commit `0bb62675d`）—— `SiteHeader.astro` 在小屏下 nav 列表撑满整行无折叠，加 `<button>` toggle + tailwind `md:hidden`
- **logo 资产送 docs+design 站 + www 文档跳链 retarget**（commit `61b8cd642`）—— 之前 docs/design 站 hero 引 `/logo.png` 但仓库里没有；www 部分 footer 链接还指着旧 docs 路径
- **E2E preload 真错暴露 + force V5/V6 mode + app-config.json 早写**（commits `076474208` `1f61a18bf` `fc9cacc48`）—— preload 失败时 throw window snapshot 不再 catch+continue 吞信号；E2E 强制 V5/V6 模式让 preload bridge 真加载；测试启动前先 `writeFileSync app-config.json useWebShellExperimental:false`，绕过 Phase 1.6 hard-flip

### CI

- **drop e2e-tests workflow `continue-on-error: true`**（commit `e807d576c`）—— 之前 JOB 级 `continue-on-error` 让 3/3 OS 失败显示 success，"No team IPC interface found" 沉了几周
- **e2e-tests workflow 加 npm cache + Playwright browsers cache**（commit `9460f05da`）—— `actions/cache@v4` 缓存 `~/.npm` 和 `~/Library/Caches/ms-playwright` / `%LOCALAPPDATA%\ms-playwright`，单 OS 跑时间预期从 ~14m 降到 ~6-8m

### Android

- **versionCode 36 → 37, versionName 0.36.0 → 0.37.0** —— minor bump 反映 7 件用户可见功能 + Phase 3d 双向同步落地

### Tests

- 桌面 mobile sync 52 测试全绿（M2 step 8）
- Android Phase 3d v1.1/v1.2 sync 测试全绿（gates 1-4 完整）
- mobile-ipc 12/12 绿（M4.5 wire-up 后）

### NPM

- `chainlesschain` 保持 0.161.7（CLI 自 v5.0.3.45 无源码改动）

### Distribution

- 桌面 binary 重新打过；auto-updater 比对 `5.0.3-alpha.46 > 5.0.3-alpha.45`，所有 v5.0.3.45 桌面用户重启会真发现新版
- Android APK 走新 `android-v0.37.0` tag 发布（用户可在 Settings → 检查更新 看到）
- 三大文档站本次同步刷新：tagline 升 v5.0.3.46 + 新增本节 changelog + 设计文档对齐

---

## [v5.0.3.45] - 2026-05-09 — cc ui llm.chat parity + 意图理解 opt-in 开关 + 真流式 + Vue Proxy reactivity 修复

> `cc ui` 终于跟桌面 web-shell 在 LLM 路径上对齐；项目/文件模式聊天默认不再走"理解中…"占位 LLM 调用；`chatStream` 改为真正的 token-by-token 流式；意图卡片 Vue Proxy 引用 bug 修复让占位卡正确翻面。

### Added

- **`cc ui` `llm.chat` WS topic**（commit `f41c4b4e2`）—— 桌面 web-shell 自 `4eaf90137`（Phase 2）就有这个 topic，但 `cc ui`（CLI 的 ws-server）从未注册过。结果：QuickAsk 页面在 `cc ui` 模式下永远卡 60 秒后报 `Stream idle timeout`（dispatcher 返回的 `UNKNOWN_TYPE` 帧 SPA 不识别为流的终态）。
  - 新增 `packages/cli/src/gateways/ws/llm-chat-protocol.js`，handler 复用 chat-core 的 `streamOllama`/`streamOpenAI`/`streamAnthropic`，按 `<topic>.chunk` + `<topic>.result` 的 frame 协议跟桌面 `desktop-app-vue/src/main/web-shell/handlers/llm-handlers.js` 完全对齐
  - 新增 `packages/cli/src/gateways/ws/llm-creds.js` 共享 cred 解析：explicit `options` → WS session creds → provider 环境变量（顺序：volcengine/openai/anthropic/deepseek/dashscope/gemini/kimi/minimax/mistral）；任何源没拿到都立即返回 ok:false 帧，不再 60 秒挂死
  - chat-intent-protocol 同步切到共享 helper —— 顺手修一个 latent bug：原代码 `session.baseUrl || "http://localhost:11434"` 在 session 没设 baseUrl 时硬编码到 ollama 地址，所有云 provider 在用户本地没起 ollama 时都会跑死
- **意图理解可见开关**（commit `f41c4b4e2`）—— Chat / Agent 项目/文件模式 header 加 `<a-switch>`，**默认关闭**。原行为：v5.0.3.43 起每条消息先调 LLM 提炼意图（`chat.intent.understand-stream`），再走真发送 —— LLM 慢/无 cred 时占位卡 90 秒；现在默认直发，需要意图卡片的用户手动打开开关（持久化到 `localStorage cc.web-panel.chat.intentEnabled`）
  - `submitUserInput` 第一行的短路：`if (mode === 'global' || !intentEnabled.value) { sendMessage; return }`
  - 桌面壳同享这个 SPA bundle，所以桌面也跟 `cc ui` 行为一致

### Fixed

- **`chatStream` 真正的 token 流式**（commit `35f6e60ea`）—— `packages/cli/src/lib/chat-core.js` 的 `chatStream` 原本是 buffer 全部 token 后再循环 yield 的伪流式 —— 消费者要等到 LLM 整个回完才看到第一帧。改为 token queue + Promise waiter 模式：onToken push 后立刻 wake generator yield。`streamPromise.finally` 翻 done flag 兜底空响应。Chat / Agent / QuickAsk / 意图理解 全部受益。
- **意图占位卡片 Vue Proxy reactivity 修复**（commit `a76e451e2`）—— `submitUserInput` 创建 placeholder 后 push 进 reactive `messages[sessionId]` 会被 wrap 成 Proxy，但本地变量 ref 仍指向 unwrap 之前的 target；后续 `placeholder.metadata.X` 直接改原对象绕过 Proxy `set` trap → 数据更新但不触发重渲染。用户可见症状：意图卡片永久卡在"理解中… / 0 tokens / 意图: 未识别"，即使后端已经流完 30+ chunk + final。修法：`card = msgs[msgs.length - 1]` push 后重新取 Proxy 引用，所有后续 mutation 走 `card.metadata.X`。

### Tests

- CLI ws gateway 16/16 绿（chat-intent 6 + 新 llm-chat 9 + 新增"无 cred 不调 LLM"环境清理 1）
- web-panel chat-intent-flow 27/27 绿（包含新 "default off" + "setIntentEnabled persists" + 已存在的 8 条意图流测试改成显式 setIntentEnabled(true) 后的开关用例）

### NPM

- `chainlesschain` 0.161.5 → 0.161.6 → **0.161.7**（0.161.6 已先于 productVersion 单独 publish 修复 QuickAsk + Chat 项目模式 hang；0.161.7 带 chatStream 真流式 + 意图卡片 Vue Proxy 修复）

---

## [v5.0.3.44] - 2026-05-08 — LLM OCR + audit-ipc 覆盖 + V5/V6 chat-intent 90s 兜底

> 一条 user-visible feature（LLM OCR）+ 三条质量收口（chat-intent 90s wall-clock、compliance-ipc 死 handler 清理 + audit-ipc 23 用例首测、macOS 路径断言修复）。无破坏性变化，所有 v5.0.3.43 用户可直接 upgrade。

### Added

- **截图 OCR LLM 引擎**（commit `39b16e29f`）—— Tesseract.js 中文识别准确度差，新增 `engine` 参数 `auto`/`llm`/`tesseract` 三态：
  - `auto`（默认）：火山引擎已配置走 doubao 视觉 OCR，否则回落 Tesseract；LLM 出错带 `fallbackFrom`/`fallbackReason` 标签自动降级
  - `llm`：强制视觉 LLM（当前 `volcengine` doubao-1.5-vision-pro，`userBudget=medium`）；无 llmManager / 非 vision provider 时显式报错
  - `tesseract`：强制本地 Tesseract.js
  - Engine guards 放在 `recognizeDispatch` 而非 `recognizeWithLLM`，便于测试 stub 替换 impl 不重复验证逻辑。Provider 白名单 `Set(["volcengine"])`，扩展到 gemini/openai/anthropic 只需在各自 `LLMManager` 暴露 `chatWithImage*` 后加一个集合项
  - UI：V5/V6 共享 dialog + web-panel dialog 各加一个 `<a-select>` engine 选择 + 蓝/灰/橙三色 tag 显示已用引擎

### Fixed

- **chat intent understand 90s wall-clock 兜底**（commit `6cbd04c50`）—— `sendStream` 自带的 60s idle timer 在每个 chunk 上 rearm，慢 LLM 一直 dribble token 但永远不出 `final` frame 时，"理解中…" 占位卡会无限转。包一层 `AbortController + setTimeout(90s)` 把信号传进 stream 调用，超时后清理 placeholder 并给可读错误。
- **compliance-ipc 死 handler 清理**（commit `29006decf`）—— `compliance-ipc.js` 之前注册的两个 channel 用了 typo 前缀 `compliance-classify:*`：
  - `compliance-classify:generate-report` / `compliance-classify:get-policies`（typo，无人调用）
  - 真正被 renderer（`stores/compliance.ts` + `stores/audit.ts`）调用的 `compliance:generate-report` / `compliance:get-policies` 由 `audit-ipc.js` 拥有，背后是 `ComplianceManager`
  - 死 handler 背后接的是不同 service（`soc2Compliance.generateReport` vs `auditManager.complianceManager.generateReport`），保留只会让以后修真正路径时漏改死路径。直接删 + 同步删 `IPC_CHANNELS` 中两个 typo 项
- **macOS 临时目录路径断言**（commit `bb2c16656`）—— `build-win-with-deref.test.js`（虽然测的是 Windows 构建符号链接，但 macOS Unit Tests 矩阵也跑）3 个断言炸 `expected '/private/var/folders/...' to be '/var/folders/...'`：macOS 的 `/var → /private/var` symlink，`os.tmpdir()` 返回 `/var/...` 但 `realpath` 路径不一样。`canonical = fs.realpathSync(os.tmpdir())` 把测试用临时目录都规范化掉，linux/win 上 `realpath` 是恒等，无 regression。

### Tests

- **`audit-ipc.js` 首次单测覆盖**（commit `b092673be`）—— 之前零覆盖的盲点（被 `29006decf` typo 死 handler bug 拽出来）。`audit-ipc.js` 拥有 18 个 channel 包括 renderer-facing 的 `compliance:get-policies` / `compliance:generate-report`，没有单测就让 `compliance-ipc.js` 里的 typo duplicate 静悄悄活了几个月：
  - 源码 DI 改造（与 `credit-ipc` 模式一致）：accept `ipcMain` via `deps` with `electron` fallback，lazy-required 让 injection 可以抢先
  - 新增 23 个 case 覆盖 18 channel 路由 + happy-path payload + AuditManager 异常路径
  - 全局测试套总数滚到 17,455 / 17,455

| 套 | 通过 |
|---|---|
| desktop 单测 | 1477 / 1477 |
| CLI unit | 17,455 / 17,455 |

### Notes

- CLI npm 包同步发布 `chainlesschain@0.161.5`（v5.0.3.43 末已 bump，本次随 release.yml 一起 publish）。
- 桌面 binary 重新打过；auto-updater 比对 `5.0.3-alpha.44 > 5.0.3-alpha.43`，所有 v5.0.3.43 用户重启会真发现新版。

---

## [v5.0.3.43] - 2026-05-07 — MTC publisher_signature M-of-N 修正 + 安全硬化级联

> 两条主线。**(1) MTC `landmark.publisher_signature` strip-all-sigs 对称化**——修复一个会**绕过 M-of-N 阈值**的真实缺陷：原实现只清零 `publisher_signature.sig` 后做 JCS，但只要篡改 M-of-N 联邦中**任何一个**成员的 per-member sig，publisher_signature 就会被打断 → 直接绕过阈值的存在意义。**(2) 安全硬化级联**——一周内 8 次 sweep 把 `npm audit` 全部清零（HIGH 44 → 0 / MOD 4 → 0 / LOW 45 → 0）。

### Fixed

- **MTC publisher_signature M-of-N strip-all-sigs**（commit `c23e98cca` 代码 + `038e6d710` 规范）—— Producer 与 verifier 必须**对称地**把 `_stripSigsForPublisher(landmark)`（清零 `publisher_signature.sig` + 每个 snapshot 的 `signature.sig` + `signatures[*].sig`）喂给 JCS 后再签 / 验。Helper 抽到 `packages/core-mtc/lib/publisher-signing.js`，导出为 `@chainlesschain/core-mtc/publisher-signing` 子路径。三处调用点：`batch.js`（单签 + 联邦）、`landmark-cache.js` 验证侧、桌面 `governance-multisig.js`（lazy-require 绕 @noble/curves hoisting trap）。规范文档 §8.2 同步更新。Canary：`mtc-federation-publish-cli.test.js` "2-of-3 threshold accepts when one member's sig is tampered" — 任何修改 publisher-sig 路径都必须跑全部 `mtc-federation*` 集成。
- **LandmarkCache `landmark.publisher_signature` 验证启用**（commit `c40d927da` + `72c3619ee`）—— `LandmarkCache` 默认 opt-in `verifyPublisherSignature: true` 对 cache 命中前增加发布者签名校验（不再无脑相信 cache）；real-verifier callers（CLI `cc mtc verify` + 桌面 audit pipeline + cross-chain bridge 校验侧）全线启用。常量 `BAD_PUBLISHER_SIG` → `BAD_LANDMARK_SIG`（`36fcd8f4f`）匹配规范 §11；spec §8.5 跟进 `LANDMARK_SIG_PREFIX` 定义（`8e459cfd5`）。

### Security

- **HIGH 44 → 0 / MOD 4 → 0 / LOW 45 → 0 安全硬化级联（多 commit）**——
  - `f6c937fa8` override transitive `serialize-javascript` + `tar`（HIGH 44 → 10）
  - `8a56978b5` 干掉无人维护的 `speedtest-net`，改用 native fetch 实现网速测试（HIGH 10 → 7）
  - `9c7ce00e7` override `semver` 到 `^7.7.4`（清掉 imap 链 HIGH 7 → 4）
  - `922b64822` override `undici` 到 `^6.21.2`（清掉 hardhat 5.x 链 HIGH 4 → 3）
  - `4fae47dd4` deprecate `werift`（清空残余 HIGH 3 → 0）
  - `cc7b0b40a` override `ip-address` + `dompurify`（MOD 4 → 0）
  - `1f86594a2` override `tmp` 到 `^0.2.5`（LOW 45 → 40）
  - `64047283a` override `make-fetch-happen` 到 `^13`（LOW 40 → 14）
  - `d19bcb8cb` 拆 `hardhat-stack` 到独立 `contracts/` workspace + drop 不再依赖的 `hdkey`（LOW 14 → 0）
- **`channel-manager` DDL 加固 + drop 未用的 jspdf**（commit `d558b66b1`，1 critical）—— 修一处 DDL 注入面 + 删未用依赖减少攻击面。
- **`wrtc-compat` `ip.isPublic` 补丁 CVE-2024-29415**（commit `7312cf035`）—— `ip` package SSRF 漏洞绕过补丁。

### Added

- **Updater 渲染端进度通知**（commit `4c1a5ac18` + `e27592bb5`）—— `notifier-only` flow，关闭重复的 native dialog，渲染端实时显示下载进度。

### Fixed (post-release follow-ups, 2026-05-08)

> 源码级 follow-ups，源自 `551ef28b3` "fix(ipc): correct ipcGuard API" 那次 sweep 不彻底，留下两类互补 bug。两个 commit 都是源码 / 测试同步问题，**不影响 v5.0.3.43 桌面 binary 的业务功能**（handlers 仍正常注册），下次发版自动滚入。

| Commit | Bug | 为什么之前没炸 | 测试 |
|---|---|---|---|
| **`af92e0162` fix(test): align nostr-bridge-ipc stub** | 源码用 `ipcGuard.markModuleRegistered(name)` 直调（real guard 有此 fn），但 test stub 仍 mock 不存在的 `registerModule(name, channels)` 二参 → stub 调时 `TypeError: ipcGuard.markModuleRegistered is not a function`，23 / 389 social 用例炸 | CI "Unit Tests" stable-fallback 排除 `**/*-ipc.test.js`；"Full Test Suite" 用 `continue-on-error: true` | 23 / 23 ✅ |
| **`11247a957` fix(ipc): align 8 ai-engine IPC modules** | 8 个 IPC 模块（autonomous-developer / collaboration-governance / tech-learning / federation-hardening / reputation-optimizer / sla / stress-test / inference）反过来 —— 源码 `if (ipcGuard.registerModule) { ipcGuard.registerModule(name, CHANNELS); }`，real guard 没 `registerModule` → `if` 永远 falsy → guard 内部 `registeredModules` Set 漏跟踪这 8 个模块。Handlers 走 `ipcMain.handle` 仍真正注册，业务功能正常，只是 guard tracker 漏 8 个模块 | 测试 stub 自己 mock 了 `registerModule` → 测试假绿 | 邻近 29 文件 577 / 577 ✅ |

修法：stub `registerModule` → `markModuleRegistered` + 断言去 channels 参（test 侧）；`if (ipcGuard.registerModule) { ipcGuard.registerModule(name, CHANNELS); }` → `ipcGuard.markModuleRegistered(name)`，同时去掉同样无意义的 `if (ipcGuard.unregisterModule)` wrap（源码侧）。CI 漏检的两类（fallback 排除 `*-ipc.test.js` + Full Suite `continue-on-error: true`）作为单独 follow-up，不在本 commit 范围。

### Maintenance (post-release follow-ups, 2026-05-08 evening)

> 当晚晚些时候继续清理。其中 `cf77aea8d` 直接关掉上一段 explicit 留的"CI 漏检两类"follow-up；其余三条是顺手清出的 V5 opt-out 死代码 + 必走的 CLI 版本 bump + 一个 web-panel 404 bundle 修。这一批同样**不影响 v5.0.3.43 桌面 binary 的业务功能**，下次发版自动滚入。

| Commit | 内容 |
|---|---|
| **`1cb6576b9` chore(web-panel): refresh built asset hashes** | committed 的 `index.html` 引用 `index-Cf0pZvjB.js`，但该 bundle 已被新 build 覆盖；workspace 实际用 `index-Cs70ksHC.js` —— main 上 web-panel 在加载 404 bundle。同步两处 dist (`packages/web-panel/dist/` + `packages/cli/src/assets/web-panel/`) |
| **`cf77aea8d` fix(ci): close test.yml two coverage holes** | (1) Unit Tests stable-fallback 删掉 `**/*-ipc.test.js` catch-all（40 个 IPC 文件本地 39 pass + 1 skip / 1476 用例）；(2) Full Test Suite "Run all unit tests" 删掉 `continue-on-error: true`（coverage step 保留）。drive-by：`compliance-ipc.test.js` 3 个 fail align 到源里实际注册的 `compliance-classify:*` typo 前缀（dead handler 独立 bug 后续 commit 再处理） |
| **`539463b85` refactor(ui): drop dead chat-panel state + stale V5 page references** | `5066a778d` 删了 V5 ChatPanel 容器，但 `app.ts` `chatPanelVisible` field、`AppHeader` 聊天 toggle、`VoiceCommandHandler` 打开/关闭聊天 + 未识别语音 fall-through 派发到聊天的分支全成 cosmetic no-op。同时清 4 个 plugin.json description + `communityQuick.ts` header 引用已删 V5 页面的 stale 字符串。−50 行净瘦身 |
| **`a9b85f5ba` test(ui): drop chatPanelVisible default-state assertion in app.test.js** | `539463b85` 漏改第二个 store 测试 `tests/unit/stores/app.test.js`（之前 .ts 镜像 `src/renderer/stores/__tests__/app.test.ts` 改了，.js 这个 broke）。pre-commit prettier 顺手 reformat 整文件单引号→双引号 |
| **`c61de71eb` chore(cli): bump 0.161.4 → 0.161.5** | `af92e0162` + `11247a957` 改了 CLI 源但没 bump 版本号 → 下次发版 cli-tests 会被 `SHOULD_TEST=false` 跳过（rule: `github_release_pipeline_constraints.md` #5）。drive-by：`package-lock.json` 之前 v5.0.3.42 release 时 .161.3 → .161.4 漂移没修，一并对齐到 .161.5 |

### Tests

| 套 | 通过 |
|---|---|
| desktop 单测（含 nostr-bridge-ipc 修） | 1454 / 1454 |
| core-mtc 单测 | 258 / 258 |
| CLI mtc-federation 集成 | 41 / 41 |
| CLI 全量 unit | 17,432 / 17,432 |

### Notes

- 本版本同时是大幅安全 / 加密路径硬化版本，不含新增 P2P / chat-panel feature；用户可放心 upgrade。
- 桌面 binary 重新打过；auto-updater 比对 `5.0.3-alpha.43 > 5.0.3-alpha.41`，所有 v5.0.3.41 桌面用户重启会真发现新版。三大文档站（docs-site / docs-site-design / docs-website-v2）同步刷新（commit `1183075b5` + `0384099f3`）。

---

## [v5.0.3.42] - 2026-05-07 — CLI 0.161.3 → 0.161.4 chat-intent 同步

> 无功能变化，仅修 release pipeline 测试覆盖问题。

### Changed

- **CLI 包 `chainlesschain` 0.161.3 → 0.161.4 atomic bump**（commit `a555b6760`）—— v5.0.3.41 ship 了 chat-panel-v5 三壳对齐里的 chat-intent 路由代码，但 CLI `package.json.version` 没动，cli-tests 在 release 流程的 precheck 阶段判 `SHOULD_TEST=false`（`chainlesschain@0.161.3` 已在 npm registry → 跳过测试），导致后续 v5.0.3.43 publisher_signature 修补的真实回归差点没被拦住。本版本明示 atomic bump CLI 0.161.4 + 安装包同步发布，触发 cli-tests 强制运行。规则文档化在 `MEMORY.md` `github_release_pipeline_constraints.md` 第 5 条：未来如果发现 CLI source 改动但 release pipeline 跳测 cli-tests，请优先检查 `git diff <prev-tag>..HEAD -- packages/cli/src/` 是否非空 + 同步 bump CLI version。

---

## [v5.0.3.41] - 2026-05-07 — chat-panel-v5 三壳对齐 + B4 social 滚动收口

> productVersion **v5.0.3.40 → v5.0.3.41**。本版本正式 ship 自 .40 以来全部滚动条目（XII–XIX：B4 跨机分发 / trust filter / viewer / 外部归档 / M-of-N / 跨联邦信任 / web-shell / web-panel / sign-as-self / cred-persist / auto-archive / chat-panel-v5）。

### Added

- **chat-panel-v5 V6 AIChatPanel 反向对齐**（commit `b33527d31`，Phase E）—— 把 V5 ChatPanel 的 4 个核心特性反向对齐到 V6 默认壳 AIChatPanel：流式响应 + 历史会话切换 + 上下文记忆引用 + 工具调用面板。从此 V5 / V6 / web-shell 三壳的聊天体验严格对等。
- **chat-panel-v5 web-shell 端口 v1+v1.1**（commit `72b13388a`）—— V5 ChatPanel 的全部 router 协议、autoSendMessage 信号、virtual list 与 5 intent / 6 IPC 在 web-shell 默认壳走 WS topic 接通。配合上一条，**Phase 1.6 hard-flip 默认壳用户不再缺任何 V5 聊天能力**。
- **B4 P2P 社交全栈 audit-grade 闭环**（§2.2.10 → §2.2.24 共 15 节，跨多个 .40 滚动 commit）——
  - **§2.2.10 Phase A 跨机同步**（commits `50b8ddb05` + `3741a8e7e`）：系统性修 7 个底层 bug（libp2p 3.x stream API、`registerMessageHandler` 漏调、收包后没按 type 派发、`gossipProtocol.message:received` 一直没人订阅）。社区 / 频道跨机器同步真正打通。
  - **§2.2.11 Phase B v1 + B4 DID 签名 + 自动 peer 桥接**：MTC federation gossipsub 双轨（`channel:send-message` / `community:join` 双发布双订阅 + `INSERT OR IGNORE` 幂等），每条 channel_message 带 `sender_pubkey + Ed25519 detached signature`，三重校验关闭 sender_did free-text 冒名缝隙；libp2p `peer:connected` 双向广播 `mtc:advertise` envelope 自动桥接。
  - **§2.2.12-2.2.13 B4-merkle channel envelope finality**：本机发出每条 channel 消息进离线可验的 Merkle 批 envelope（`channel-event-batch.js` +390）；新 IPC `channel:get-message-envelope` 返 inclusion proof + landmark；输出 wire-compatible，对端可用 `cc mtc verify` 验证。
  - **§2.2.14-2.2.18 B4-cross / cross-trust / ui / archive / mofn**：跨机 envelope gossipsub 分发 + on-demand pull / community-member trust filter / 桌面 viewer 按钮 + modal / 外部归档（filesystem + WebDAV）/ M-of-N 多签治理。
  - **§2.2.19-2.2.20 B4-crossfed + B4-webshell**：跨联邦信任锚 / 13 个 WS topic 桥接 web-shell 默认壳。
  - **§2.2.21-2.2.22 B4-webpanel + B4-mofn-sign v2**：4 个 composable + `MtcAudit.vue` 4-tab 页 / sign-as-self（私钥永不离主进程，渲染端只发 ID），顺手修 `registerAllIPC` 漏传 12 个 manager 的潜伏 ~1 个月 bug。
  - **§2.2.23-2.2.24 B4-cred-persist + B4-auto-archive**：WebDAV 凭据走 secure-config.enc（safeStorage / AES-256-GCM）`useStoredCredentials:true`，凭据永不外泄；主进程 `setInterval` 周期触发归档（5min 最小、per-community try/catch、runOnce 非重入、配置写 `app-config.json` 的 `mtc.autoArchive` namespace、`lastRun*` 自动持久化）。
- **Web Shell Phase 3c.7**（commit `200078947`）—— 截图识别 + 通知设置 + 托盘 5 个 quick-action 路由收口（global-search / clipboard-import / show-notifications / screenshot-ocr / open-settings#notifications）；`Notes.vue` 监听 `?clipboardImport=` / `?screenshotOcr=` query 自动开 dialog；测试 26 cases。
- **Plugin Marketplace 部署脚本骨架**（commit `a62fd8b81`）—— `docker-compose.yml` 加 marketplace services；deploy doc + bt-nginx 修复脚本。生产实际是 standalone 部署到 47.111.5.128；这些是未来 from-repo 部署的参考。

### Fixed

- **web-panel 单测 `views-mount-smoke.test.js` 在 63 文件并行套件下 first-import 撞 30s timeout**（本版）—— Pipeline.vue + Chat.vue 在 4-fork 池 + 全量 SFC transform 竞争下，首个加载它们的 fork 会撞默认 testTimeout。fix：file-level `vi.setConfig({ testTimeout: 60_000 })`，全局 timeout 不动（已验证全局升 60s 反让 worker pool 调度恶化导致更多 file 超时）。同 `cli_ci_sharding_lessons` 记录的 vitest 4 严格 timeout 模式。
- **Dashboard bundled-skill 发现 + JSON-based stat 解析**（commit `3881b9603`）—— skill 数 / 桌面统计在仪表盘上的展示口径修正，bundled-skill 列表能正确发现，stats 走 JSON 解析不再走 fragile string parse。

### Tests

| 套 | 通过 |
|---|---|
| desktop unit（MTC + DID + social + web-shell + p2p + bootstrap + renderer）| 1454 / 1454（4 skipped）|
| core-mtc 单测 | 258 / 258 |
| CLI chat-intent + mtc-federation core/trust/sync 集成 | 69 / 69 |
| CLI 全量 unit | 17,432 / 17,432 |
| web-panel 单元 | 1853 / 1853 |
| web-panel e2e | 63 / 63 |

### Notes

- 桌面 binary 重新打过；auto-updater 比对 `5.0.3-alpha.41 > 5.0.3-alpha.40`，所有 v5.0.3.40 桌面用户重启会真发现新版。三大文档站同步刷新。
- 设计文档 `docs/design/modules/02_去中心化社交模块.md` 累积 §2.2.10–§2.2.24 全 15 节。**私钥 / 密码均不过线**，UI 默认壳全套可见，audit-grade 闭环。

---

## [v5.0.3.40] - 2026-05-07 — MTC 视图 in-process 提速 + CI 解锁三发

### Fixed

- **MTC 视图 onMounted 三发并发必爆 timeout**（asar 冷启动级联）—— v5.0.3.39 切到 `asar:true` 后 `cc` 子进程冷启动从 dev 的 ~2.5s 涨到打包后 6-10s（asar header 走查 + Node module resolve 多一层虚拟 fs），Mtc.vue 的 `loadStatus` + `loadBridgeStatus` + `loadBridgeSla` 三发并发必撞 8s/6s 上限。修法：新增 3 个 in-process WS topic（`mtc.audit-status` / `mtc.bridge-status` / `mtc.bridge-sla`）直查 `audit-mtc` / `cross-chain-mtc` lib（纯文件读，无 SQLite，无 spawn，零 asar 开销）；`Mtc.vue` 通过 `useShellMode().isEmbedded` 分叉，embedded 走新 topic，浏览器 / `cc serve` 仍走旧 `ws.execute`。同时把保底 timeout 从 8000/6000 提到 30000 ms（与 `executeJson` 默认对齐）。顺手修了 standalone 路径一个 pre-existing shape mismatch（lib 返回扁平字段，SPA 期望 `obj.config.*` 包装）—— 仅 embedded 路径生效，standalone 维持原状（独立 follow-up）。配 7 + 1 新单测。
- **macOS unit fallback 上 7 个 build-win-with-deref 测试**（commit `25d834958`）—— `isSymlink` 之前用 `realpathSync` 比较，但 macOS `os.tmpdir()` 路径含 `/var → /private/var` 的隐式 symlink，所有 tmp 路径下的常规目录都被误判为 symlink。改成 platform split：Win 仍用 realpath（junction 需要），POSIX 用 `lstat.isSymbolicLink()`（POSIX 没有 junction 概念，lstat 可靠）。
- **rules-validator SQL_INJECTION 在测试 fixture 上误报**（同 commit）—— `sync-external-store.test.js:32` 的 `TestDbManager.exec(sql)` 是 sql.js 测试适配器的 passthrough。`getAllFiles` 现在跳过 `__tests__/` / `__mocks__/` 目录 + `.test.js` / `.spec.js` / `.d.ts` 文件。生产代码扫描不变；75 条警告仍属 advisory。
- **CLI subprocess cold-start ETIMEDOUT on Windows**（同 commit）—— `skill.test.js`（12 处 @ 15s）+ `agent-repl.test.js`（3 处 @ 10s）调 `node bin/chainlesschain.js …`。ESM module-graph cold-start 在繁忙 Windows 主机真的需要 >10s。所有 CLI subprocess 调用 timeout 统一升到 60s（与项目 testTimeout 对齐）；passes 仍 1.7-2.5s 完成，只有真 fail 才会跑满。

### Tests

| 套 | 通过 | 文件 | Duration |
|---|---|---|---|
| Desktop unit + stores | 10482 / 10482 (689 skipped) | 320 | 1022s |
| MTC handler in-process 新增 | 7 / 7 | 1 | 3.4s |
| web-panel mtc-parser 新增 | 14 / 14 | 1 | 1.1s |
| CLI unit | 17392 / 17392 (7 skipped) | 412 | 458s |
| CLI integration | 821 / 821 | 56 | 198s |
| CLI e2e | TBD | TBD | TBD |
| **小计** | **12224 + e2e** | **790+** | **~28 min** |

### Notes

- 桌面**有**运行时改动：`web-shell-bootstrap.js` 注册 3 个新 in-process WS handler，`packages/web-panel` SPA bundle 重打。auto-updater 比对 `5.0.3-alpha.40 > 5.0.3-alpha.39`，所有 v5.0.3.39 桌面用户重启时会发现新版并自动获取 MTC 提速 + CI 修复。
- v5.0.3.39 install-time benchmark 已跑 + [issue #8](https://github.com/chainlesschain/chainlesschain/issues/8) 已关 (2026-05-07 completed)：dev-box `Setup.exe /S` 实测 **190.9 s**（vs 1201 s baseline = −84% / 6.3×；vs 360 s gate = PASS 47% 余量）。Methodology caveat：本机 Defender OFF + NVMe SSD 跟 #6 baseline 三轴错二，HDD + Defender-on 严格 parity 仍是 nice-to-have follow-up（不是 release blocker）。本版桌面 binary 重新打过（含 SPA 新 bundle），但 ASAR surgery / native deps / 文件量级与 .39 一致，install 时间应等价。
- standalone `cc serve` 模式下 `loadBridgeStatus` 仍受 lib-vs-SPA shape mismatch 影响（pre-existing bug），桥状态显示 defaults——只在浏览器直连场景出现，桌面 v5.0.3.40 默认壳不受影响。

---

## [v5.0.3.39] - 2026-05-07 — B4 post-pack ASAR surgery（Windows 安装 20m → ~5m, issue #8）

### Fixed
- Windows installer time from ~20 min back to ~5 min by re-enabling `asar: true` and running post-pack ASAR surgery in `afterPack` to inject the 4 walker-dropped packages (`call-bind-apply-helpers`, `side-channel-{list,map,weakmap}`) at top-level (commit `e11b46913`).

### Added
- `scripts/asar-surgery.js` — extract → inject → repack with original unpackDir preserved + verification gate.
- `scripts/build-win-with-deref.js` — Win wrapper that detaches workspace symlinks, runs electron-builder, restores in finally with `'junction'`.
- `scripts/probe-asar.js` — debug CLI for inspecting any asar's top-level entries.
- `tests/unit/scripts/asar-surgery.test.js` (8) + `build-win-with-deref.test.js` (15) — 23 unit/integration tests, real fs + real `@electron/asar` against tmp fixtures.

### Changed
- `electron-builder.yml`: `asar: false` → `asar: true`; removed 7 force-include `extraResources` entries that targeted `app.asar.unpacked/`.
- `scripts/electron-after-pack.js`: dual-branch — asar:false nuclear-replace (legacy) / asar:true `runSurgery`. Mac/Linux + Win all funnel through the same hook.
- `desktop-app-vue/package.json`: `@electron/asar ^3.4.1` declared as explicit devDep (was implicit transitive).

### Notes
- Surfaced one bug during testing: `@electron/asar` has a module-level `filesystemCache` keyed by archive path; `extractAll` populates it with the pre-surgery header so `listPackage` returns stale entries after we delete + repack. Fix: `asar.uncache(asarPath)` after `fs.rmSync`. Production builds were also affected — no Win VM smoke needed to find this.
- Refuted approaches (don't re-attempt): asarUnpack glob (issue #6 proven empirical), extraResources to `app.asar.unpacked/` (v5.0.3.12), declaring 4 packages as direct deps (v5.0.3.6).
- ASAR integrity: Electron `EnableEmbeddedAsarIntegrityValidation` fuse currently macOS-only. Windows post-surgery hash mismatch is unenforced. When macOS support lands, either patch electron.exe hash or disable integrity via `@electron/fuses`.

---

## [v5.0.3.38] - 2026-05-06 — 平台补齐：v5.0.3.37 漏掉的 Android APK 重新出全平台

> v5.0.3.37 的 release 因 GitHub immutable-releases 机制（一旦 release 由 finalize-release 翻成 published，**任何 asset 的新增/替换/删除都被 API 拒绝**——不只是 delete，UPLOAD 也 422）漏掉了 build-android 产出的 APK/AAB，桌面三平台 + iOS 共 14 个 asset 已发出且事后无法追加。本版无桌面功能改动，仅重新出全平台一致的 release 把 Android 补回。桌面侧二进制内容与 v5.0.3.37 等价（仅 productVersion / desktop version +1）。

### Fixed

- **CI release 工具链 2 处工程闭环**——
  - `release.yml` create-release 三状态分支（`b6256c972`）—— state 1 (no release) 创建 draft / state 2 (draft exists) edit + clobber upload / state 3 (published exists) 原本计划 add-only，**但本版实测证伪**：immutable-releases 连 UPLOAD 都拒，state 3 路径的 add-only 写法对已 finalized release 永远 422。后续会改成 advisory exit 0 或 revert 该分支，单独 issue 跟进。
  - `package-lock.json` 同步 `b6256c972` 5 个 npm 包版本（`a90e09b57`）—— 上一次 chore commit 改了 5 份 package.json 没跑 `npm install`，导致 v5.0.3.37 redispatch 在所有桌面平台一致挂在 `npm ci` "Install dependencies" 步。

### Notes

- v5.0.3.37 桌面用户重启时 auto-updater 比对 `5.0.3-alpha.38` > `5.0.3-alpha.37`，会真发现新版并提示。Android 用户首次拿到 APK（v5.0.3.37 release 的 14 个 asset 里没有 .apk / .aab）。

## [v5.0.3.37] - 2026-05-06 — 桌面版同步 productVersion + 托盘内存使用周期更新

> 用户在 v5.0.3.36 装上后看托盘 → 关于显示 `产品版本: v5.0.3.36 / 桌面版: 1.1.2-alpha`，质疑 auto-updater 用哪个版本号比对——直觉是对的。`desktop-app-vue/package.json.version`（也就是 electron-updater 真正用来比对的字段）从 v5.0.3.30 起一直停在 `1.1.2-alpha` 没动过，导致即便 productVersion 已 bump 到 v5.0.3.36，auto-updater 比对 GitHub Release `latest.yml` 里的 `1.1.2-alpha` 总是相等，**所有 6 个 release（v5.0.3.31-36）的"已是最新"判断都是误报**——任何一个老版用户重启都收不到自动更新提示。本版同步两件事。

### Changed

- **`desktop-app-vue/package.json` version 同步 productVersion**（commit pending）—— `1.1.2-alpha` → `5.0.3-alpha.37`，semver 合法（`-alpha.N` prerelease），数字部分跟 productVersion `vX.Y.Z.N` 一一对应。规则文档化在 `CLAUDE.md` Version hierarchy 段：每发一版（`productVersion → vX.Y.Z.N`）desktop 版同步到 `X.Y.Z-alpha.N`。下一次发版（productVersion → v5.0.3.38）desktop 版变 `5.0.3-alpha.38`，比 v5.0.3.37 用户当前的 `5.0.3-alpha.37` 高一档，auto-updater 会真发现并提示新版本。Setup.exe 文件名也变为 `ChainlessChain-Setup-5.0.3-alpha.37.exe`，与 GitHub release tag `v5.0.3.37` 视觉对应。

### Added

- **托盘 → 性能监控 → 内存使用 周期更新**（commit pending）—— `EnhancedTrayManager` 早就提供了 `updateMemoryUsage(usage)` 方法但 main 进程从未调用，跨 v5.0.3.30+ 一直显示"加载中..."。`index.js` 在 tray 创建后挂一个 10s `setInterval`：用 `app.getAppMetrics()` 累计所有 electron 进程（main + renderer + GPU + utility 子进程）的 `workingSetSize` (RSS)，格式化"X MB"或"X.X GB"传给 `updateMemoryUsage`。failure-tolerant：`getAppMetrics` 抛错只 `logger.warn` 不影响 tray 主流程。`onWillQuit` 中 `clearInterval` 提早停掉防止 quit 链路 timer 火 stale 回调。

## [v5.0.3.36] - 2026-05-06 — 手动检查更新加 native dialog feedback

> v5.0.3.35 修了 electron-log 缺失致 auto-updater 整模块 load 不进来的 bug 之后，从 electron-log 真实日志看 auto-updater 在用户点托盘"检查更新"时确实运行了：`手动检查更新 → Checking for update → Update for version 1.1.2-alpha is not available → 当前是最新版本`。但用户在 v5.0.3.30 - 5.0.3.35 跨 6 个版本一直反映"点了无反应"——根因是 `update-not-available` / `error` 事件只调 `webContents.send("update-status",...)` IPC，但 V5/V6 App.vue 和 web-shell 模式下加载的 web-panel SPA **都没监听这个 channel**，所以无论哪种 renderer 模式 UI 都看不到任何反馈。

### Changed

- **手动检查更新加 native dialog feedback**（commit pending）—— `auto-updater.js` 加 `_manualCheckPending` 标志：`checkForUpdates(manual=true)` 设置；`update-not-available` 事件回调在 manual 时弹 native "当前已是最新版本" dialog（带当前版本号）；`error` 事件回调在 manual 时弹 native "检查更新失败" dialog（带错误信息）；`update-available` 已有 `showUpdateAvailableDialog`，仅清掉 manual 标志避免重复弹窗。后台 3s 启动自检 + 每 4h 周期检查路径不传 manual=true，**全程静默不弹任何 UI**（电源管理 / 锁屏唤醒等场景下大量自动 dialog 会很骚扰）。`enhanced-tray-manager.js triggerCheckForUpdates` 调用处加 `true` 参数。

### Notes

- 之前 v5.0.3.31 / 32 / 33 / 34 / 35 五版的"检查更新点了无反应"用户体验问题，本版彻底闭环。绕开了 renderer IPC channel 的"无人监听"问题，跟 showAboutDialog 一样走主进程原生 dialog——简单可靠，不依赖 V5/V6 / web-shell 模式。

## [v5.0.3.35] - 2026-05-06 — auto-updater 缺 electron-log 模块导致从未 load

> v5.0.3.34 给"检查更新"fallback dialog 加诊断字段后，用户截图反馈：`autoUpdater loaded: NO`、`require error: Cannot find module 'electron-log'`、`app.isPackaged: true`。诊断把根因暴露得很彻底——v5.0.3.31 加 auto-updater init 时就坏，但因为 require 抛错被 logger.warn 静默吞掉，包括启动 3s 自检 + 4h 周期检查 + 托盘"检查更新"在内的整条自动更新链路其实从未真正生效，跨 v5.0.3.31 / 32 / 33 / 34 四个版本（v5.0.3.32 加的 `app.isPackaged` gate 是有效的，autoUpdater 是 undefined 就走不到那一步）。

### Fixed

- **packaged 安装版 `require("electron-log")` 抛 ENOENT 致 auto-updater 模块无法 load**（commit pending） —— `electron-log` 既不是 desktop-app-vue 的直接依赖，`electron-updater@6.6.2` 也不再带它作 transitive dep（v6 起 logger 由调用方注入）。修法是双保险：
  - **`auto-updater.js` 把 `require("electron-log")` 包 try/catch**：缺失时 fallback 到 console-based `{info,warn,error}` 对象，内部 `log.info(...)` 调用站点全部不变；同时 fallback 分支不设置 `autoUpdater.logger`，让 electron-updater 用自带默认。这样即便未来 electron-log 又出意外 missing，自动更新链路本身仍然可用，不会 cascading fail。
  - **`desktop-app-vue/package.json` 加 `electron-log: ^5.4.3` 直接依赖**：正常情况会走 file logger（写到 ChainlessChain log 目录），fallback 只是兜底。

### Notes

- 已知不在本版本修：托盘 → 性能监控 子菜单的"内存使用 / 加载中..."始终显示"加载中..."。`tray-manager` 有 `updateMemoryUsage(usage)` 方法但 main 进程从未周期性调用它来填充实时数据。和本版本无关，单独 issue 跟。
- web-panel 的"全局搜索 / 截图识别 / 剪切板导入 / 同步 / 通知中心"等 tray 项点了弹"功能即将推出"toast 是设计预期——web-panel 暂无对应面板。要让它们真工作得在 web-panel 加面板，是更大的功能开发。

## [v5.0.3.34] - 2026-05-06 — Web-shell 托盘菜单 bridge + 检查更新诊断信息

> 用户在 v5.0.3.33 安装版上反馈：托盘"检查更新 / 新建笔记 / 设置"等菜单项点了不跳转（除"显示主窗口"和"关于"外）；"检查更新"仍弹"开发模式"对话框。根因：当前默认走 web-shell 模式（Phase 1.6 `caaddf530` hard-flip），加载的渲染器是 `web-panel` SPA 而不是 `desktop-app-vue` 的 V5/V6 Vue 渲染器。v5.0.3.31 / v5.0.3.32 的两处 tray 修复都改的是 `desktop-app-vue/src/renderer/App.vue` 的 IPC listener — 在 web-shell 模式下这文件根本没被加载，preload (`src/preload/web-shell.js`) 也是空的（per strategy memo），所以主进程通过 `webContents.send("tray:action", …)` 发的事件无人接收。

### Fixed

- **Web-shell 模式下托盘菜单事件被丢弃** —— 给主进程加一条"绕开 IPC 走 ws-server"的桥接：
  - `ws-cli-loader.js` 暴露 `broadcast(frame)`，委托底层 `ChainlessChainWSServer._broadcast`（现成的，原本只内部用于 task 完成事件）。
  - `web-shell-bootstrap.js` 把 broadcast 透传到 startWebShell 返回的 handle。
  - `index.js` 在 EnhancedTrayManager 构造时传入 `getWebShellHandle()` 懒 getter（不依赖 web-shell 启动顺序）。
  - `enhanced-tray-manager.js dispatchTrayAction` 在原 IPC `webContents.send` 之外，增加 `webShellHandle.broadcast({ type: "tray:action", payload: { type, payload } })`。`getWebShellHandle()` 返回 null 时（V5/V6 模式）跳过；web-shell 活跃但无 web-panel 客户端连上时 `_broadcast` 自然 no-op。两边都不抛错。
  - `packages/web-panel/src/App.vue` 在 `ws.onMessage` 上挂全局监听器，`type === "tray:action"` 路由到 web-panel 自己的页面 (`/notes`、`/chat`、`/dashboard`、`/project-settings` 等)；web-panel 没对应面板的（通知中心 / 全局搜索 / 同步）回 toast"功能即将推出"。

### Changed

- **"检查更新"开发模式 fallback dialog 加诊断信息** —— v5.0.3.32 已经把 gate 从 `process.env.NODE_ENV === "production"` 改成 `(NODE_ENV === "production" || app.isPackaged)`，但用户在 v5.0.3.33 packaged install 上仍报告看到这个 dialog。把 `NODE_ENV` / `app.isPackaged` / `autoUpdater loaded` / `checkForUpdates fn` 四个字段直接打到 dialog detail 里，下次用户截图就能直接判断是哪条 fail：require 抛了？isPackaged 出乎意料是 false？还是 module 缺导出？避免再让用户挖 log 文件。

### Tests

- `enhanced-tray-manager.test.js` 6 → 10 测试（新增 4 个 web-shell broadcast path：handle 存在时双发、handle 为 null 时仅 IPC、未传 option 时向后兼容、broadcast 抛错时不波及主进程）。
- `src/main/web-shell/` 全 13 文件 196/196 绿。

## [v5.0.3.33] - 2026-05-06 — 托盘"关于"产品版本显示 "—" 修复

> 用户在 v5.0.3.32 安装版上反馈托盘 → 关于对话框 `产品版本：—`（应显示 v5.0.3.32）。根因是历史遗留 packaging 路径问题，v5.0.3.31 / v5.0.3.32 都有；本版顺手修掉。

### Fixed

- **托盘"关于"产品版本永远显示 "—"** —— `enhanced-tray-manager.js:317` 用 `require("../../../../package.json")` 读 monorepo 根 `productVersion`，但 packaged install 里 `enhanced-tray-manager.js` 位于 `app.asar/dist/main/system/`，相对路径 `../../../..` 走出 `app.asar` 抵达 `<install>/resources/`，那里没有 package.json → require 必失败 → 永远 catch 走 "—"。改为 build 时把 `productVersion` + `appVersion` 烧进 `dist/main/build-info.json`，showAboutDialog 优先读这个常量文件，packaged 模式 / dev 模式都能稳定取到；老相对路径保留作为直接 import src 跑测试时的 fallback。`scripts/build-main.js` 在 `dist/main/` 末尾写入 build-info.json。

## [v5.0.3.32] - 2026-05-05 — 修 v5.0.3.31 系统托盘菜单两处残留

> 用户在 v5.0.3.31 安装版上报告：托盘"检查更新"按钮仍弹"当前模式：development"对话框；从托盘菜单点其它项只把主窗口拉出来，但不跳到对应页面。两处不同根因，但一起表现为"v5.0.3.31 的托盘修复在打包版上没生效"。

### Fixed

- **托盘"检查更新"在打包版误报开发模式** —— `enhanced-tray-manager.js:365` 的判断写的是 `process.env.NODE_ENV === "production"`，但 Electron 打包后 `NODE_ENV` 默认是 undefined（不是 "production"），所以即使是 GitHub 下载的安装版也走 fallback 分支显示"当前模式：development"，且因此从未真正调用过 `autoUpdater.checkForUpdates()`。改为 `(process.env.NODE_ENV === "production" || app.isPackaged)`，对齐 `backend-service-manager.js:17` 已有的双判断写法。注意：后台静默自动更新链路本身不受影响，因为 `auto-updater.js:32` 守的是 `!process.env.NODE_ENV || === "production"`，对 undefined 容错。
- **首次启动未设密码状态下托盘菜单事件被丢弃** —— `App.vue` 的 `onMounted` 在 `initial-setup:get-status` 返回 `{ completed: false }` 时 early-return（line ~339），跳过下方的 IPC listener 注册块（`tray:action` / `show-global-settings` / `database-switched` 三个）。结果：首次启动用户点托盘菜单，主进程的 `dispatchTrayAction` 把窗口 show + focus 后通过 IPC `send("tray:action")`，但 renderer 没人接，路由不跳。把这三个 listener（连同已经在早返之前的 `deep-link:invitation`）整体提到早返之前——它们和数据库加密 / 设置流程无依赖关系。

### Notes

- 已知小问题（不在本版本修）：preload `removeListener` 直接传 `func`，但 `on` 注册时包了 arrow wrapper，不匹配。表现为 `onUnmounted` 里的 cleanup 实质未生效（轻微监听器累积），不影响功能。

## [v5.0.3.31] - 2026-05-05 — 系统托盘菜单 + 自动更新接入（修 v5.0.3.30 漏修的三个 bug）

> 用户报告 v5.0.3.30 安装版三个 bug：托盘菜单除了"显示主窗口"全部点了无反应；"检查更新"按钮点了哑响；自动更新功能不工作。三个症状同根：tray-manager 把所有菜单项 send 到 renderer 各自独立的 IPC channel，但 renderer **从未给任何一个 channel 注册 listener**；同时 `auto-updater.js` 模块在 `index.js` **从未被初始化**（grep `autoUpdater` 在 index.js 0 个匹配）。

### Fixed

- **自动更新静默不工作** —— `auto-updater.js` 模块定义了 init / 4-小时定期检查 / 启动 3s 自检，但 `desktop-app-vue/src/main/index.js` 从来没调用过 `init()`，packaged 版本因此既不主动检查也不被动等待。修复：在 tray 创建之后调用 `require("./system/auto-updater.js").init(this.mainWindow)`，模块自身仍守 `NODE_ENV !== "production"` 的 dev no-op。这是发版功能性 bug，影响所有已安装用户的自动更新链路。
- **托盘"检查更新"菜单点击无反应** —— 原实现 `sendToRenderer("check-update")`，renderer 全代码库 0 个 listener 监听该 channel。改为主进程直接调 auto-updater 单例 `checkForUpdates()`（dev 模式下弹一个原生 dialog 提示"开发模式不会触发自动更新"，避免再次哑响）。
- **托盘菜单大部分项点击无反应** —— `quick-action / sync / show-notifications / show-performance / open-settings / show-about` 6 个菜单分别 send 自己的 IPC channel，**renderer 一个都没监听**。统一为单一 `tray:action` 通道，payload 形如 `{ type, payload }`。`enhanced-tray-manager.js` 新增 `dispatchTrayAction(type, payload)` 方法，`src/renderer/App.vue` 注册 listener 按 type 分发到 Vue Router (`/settings/system`, `/performance/dashboard`, `/chat`) / `showGlobalSearch` 状态切换 / window 自定义事件 (`cc:show-notifications`, `cc:new-note`)；当前未接入的能力（screenshot-ocr / clipboard-import / sync）给明确的 `message.info("功能即将推出")` toast，避免再次哑响。
- **托盘菜单触发时主窗口被隐藏** —— 用户从托盘菜单选了菜单项但主窗口在托盘里没拉出来，UI 永远没机会响应。`dispatchTrayAction` 派发前检查 `mainWindow.isVisible()`，隐藏则 `show() + focus()`，保证操作可见。

### Added

- **`enhanced-tray-manager.js` 三个新方法** —— `dispatchTrayAction(type, payload)` 统一通道；`showAboutDialog()` 主进程原生关于对话框（避开 renderer round-trip）；`triggerCheckForUpdates()` 调 auto-updater 单例 + dev 模式 fallback dialog。
- **`src/main/system/__tests__/enhanced-tray-manager.test.js`** —— vitest 单测覆盖 `dispatchTrayAction` 6 个场景（payload 形状 / 空值默认 / 隐藏窗口的 show+focus / mainWindow 缺失兜底）。`showAboutDialog` / `triggerCheckForUpdates` 是 Electron 原语薄包装，受现有全局 `tests/__mocks__/electron.ts` + `tests/setup.ts` mock 干扰难以隔离测试，靠手动验证覆盖。
- **`docs-site/docs/guide/installation.md` 等三处 tagline / 当前版本** 同步更新到 v5.0.3.31。

## [v5.0.3.30] - 2026-05-05 — 桌面版收口（安装链路 + 托盘 + 技能上限 + 图标）

> 覆盖 commits `b2e1ff27d` / `33d40fbad` / `d57759dc9` + 本次 desktop fix batch。

### Fixed

- **内置技能数 100 上限触顶 —— 第 101 个起注册全失败** —— `desktop-app-vue/src/main/ai-engine/cowork/skills/skill-registry.js:23` 的 `maxSkills` 默认 `100`，但运行时 `SkillLoader` 实际加载 **bundled 144 + marketplace 5 + managed 9 = 158** 个。所有 `getSkillRegistry()` 调用均不传 options，从第 101 个开始 `throw 已达到最大技能数限制: 100`。提升默认值到 `1000`（注释说明仅作 sanity 上限防循环注册 OOM，非功能上限），实测 158/158 全注册成功。
- **系统托盘图标在 dev 模式加载为空白** —— `enhanced-tray-manager.js:getIconPath()` 候选路径全部指向 `resources/`（项目里**根本没有这个目录**），`nativeImage.createFromPath()` 返回空 image，Windows 给了 fallback 图标。候选列表头部加 `assets/icon.ico`（dev 模式真实位置），`process.resourcesPath/icon.ico` 排第二（packaged 模式由 `electron-builder.yml extraResources` 拷贝）。tray 现在能正常吃到品牌 icon。
- **本地 `make:win:builder` 漏装 `packages/cli` 生产依赖** —— 之前从本地构建产物启动会在 web-shell 拉起 `ws-server.js` 时崩溃 `Cannot find package 'ws'`。`desktop-app-vue/package.json` 加 `prepare:cli-prod-deps` 前置脚本，`make:{win,mac,linux}:builder` 串起来跑 `cd ../packages/cli && npm install --omit=dev --workspaces=false --legacy-peer-deps`，对齐 CI release path 行为。
- **`afterPack` 在 Windows 非 admin / 非 Developer Mode 下 EPERM symlink** —— `cpSync` `dereference: false` 试图把 `@chainlesschain/{core-mtc,session-core}` 的 workspace junction 复刻到目标目录，Windows 拒绝。改 `dereference: true`——shippable 安装包本来就该 inline workspace 内容，不应保留指回用户源码树的 link。

### Changed

- **关闭按钮 X 默认最小化到系统托盘** —— 之前点窗口 X 直接退出应用导致用户误以为"窗口消失了"。现在 X 会把主窗口隐藏到屏幕右下角系统托盘（`desktop-app-vue/src/main/system/enhanced-tray-manager.js` 接进 `index.js`），后台仍运行；通过托盘菜单"退出"或 `Ctrl+Q` 才彻底关闭。完整说明见 [`/guide/installation`](/guide/installation#三、关闭按钮-x-行为)。
- **本地 Win 安装包体积下降 357 MB / 14k 文件** —— `desktop-app-vue/scripts/electron-after-pack.js` 增加 `cpSync` filter，丢 50 个声明在 `devDependencies` 的顶层包（运行时无引用，4 个例外 `better-sqlite3` / `electron` / `jsdom` / `glob` 通过 lockfile BFS 验证保留）+ 12 个非 win32 平台原生（`@nomicfoundation/edr-{linux,darwin}-*` 等）。Setup.exe 由 ~610 MB 降至 **594 MB**，安装时文件数由 124k 降至 110k。
- **应用图标 master 重生成（fill ratio 52% → 100% 水平）** —— `assets/icon.png` 原 master 是 2451×2451 但圆形 logo 仅占画布 ~52%，托盘 / 任务栏 / 桌面快捷方式视觉上明显比邻居（WeChat / Office）小一圈。新增 `desktop-app-vue/tools/regen-app-icon.js`（sharp + png-to-ico），自动 trim 透明边重生成 master + 7 层 .ico（16/24/32/48/64/128/256，bbox 1282×1143 squared 到 1282×1282，水平 100% / 垂直 89% fill）。后续换 logo 直接 `node tools/regen-app-icon.js` 重跑。
- **Windows 任务栏图标 + AppUserModelId 收口** —— `desktop-app-vue/src/main/index.js` 主 BrowserWindow 加 `icon: resolveAppIconPath()`（dev 走 `assets/icon.ico`，packaged 走 `process.resourcesPath/icon.ico`），`setupApp()` 顶部加 `app.setAppUserModelId("com.chainlesschain.desktop")`。dev 启动不再回落到 Electron 默认图标，packaged 升级时任务栏图标关联也不会丢。

### Added

- **`desktop-app-vue/package.json` postinstall electron 二进制兜底** —— `node node_modules/electron/install.js || true`。npm workspaces hoisting 偶发导致子包 electron postinstall 不触发、`node_modules/electron/dist/electron.exe` 缺失时，`npm install` 自动恢复，避免 `npm run dev` 抛 `Electron failed to install correctly`。
- **`desktop-app-vue/tools/regen-app-icon.js`** —— 应用图标 master + .ico 重生成脚本（详见 Changed 段）。
- **`docs-site/docs/guide/installation.md`** —— 桌面版安装指南，覆盖安装时间预期（15–25 分钟）、首次启动延迟（30–60 秒到主窗口）、托盘行为、卸载、系统要求。回答 "进度条不动是不是卡死了" / "我的窗口怎么消失了" 等高频疑问。
- **`desktop-app-vue/scripts/after-pack-dryrun.js`** —— 不打包的探针，复用 afterPack 过滤逻辑量化收益（kept / skipped / 文件数 / 体积），用于将来调整过滤规则前预演。
- **`desktop-app-vue/scripts/find-renderer-only-deps.js`** —— grep `src/main` + `dist/` 的实际 require/import，跟 `dependencies` 求差集找 renderer-only 候选。当前未接入 afterPack（transitive prod-chain 风险需 lockfile BFS 单独验证），留作后续安装包减肥探针。

### Known Limitations

- **首次安装仍需 15–25 分钟** —— `asar:false` 散文件部署模式下 NSIS + Defender 单文件处理是结构性瓶颈。前期试过 `asar:true` + `asarUnpack` glob 方案（[#6](https://github.com/chainlesschain/chainlesschain/issues/6)，已关），实测被 electron-builder walker 的 nested-only 决策证伪；剩余可行路径 = post-pack asar surgery（直接对 `app.asar` header 注入 walker dropped 的 4 个包 + 重算 integrity hash），暂无 active tracker。
- **图标视觉上仍比 WeChat / 酷狗音乐等方形 app 显小** —— 圆形 logo 物理面积 = 同尺寸方形的 78%（π/4），跟方形邻居同台必然显瘦一圈。本次改进只解决了"源 master 留白过多"的工程问题；要彻底视觉对齐需要设计层加方形底（待评估）。

## [v5.0.3.1] - 2026-04-29 — V6 Preview Shell P9d — 品牌收口 + 空白起步 + 设置入口

### Changed

- **`/v6-preview` 预览壳品牌收口** —— `desktop-app-vue/src/renderer/shell-preview/AppShellPreview.vue` 左上角字符串 "ClaudeBox" 替换为 `import brandLogo from "../assets/logo.png"` + 文字 "ChainlessChain"；composer 标签去掉 "运行中..." 后缀；`createDefaultRuntimeStatus.agentLabel` 默认值 `"Claude Code"` → `"ChainlessChain"`。
- **平台感知 traffic dot** —— macOS 红/黄/绿圆点改 `v-if="isMacPlatform"`；挂载时 `await window.electronAPI.system.getPlatform() === "darwin"` 判定，Windows/Linux 隐藏。
- **底部 runtime chip 收口为单按钮** —— 5 颗 chip（progress/model/skill/tool/terminal）收成单颗 button-chip 显示 `runtimeStatus.modelLabel || "未配置模型"`；与顶部新增的齿轮 `SettingOutlined` 按钮均 `router.push({ path: "/settings/system", query: { tab: "llm" } })`。

### Added

- `desktop-app-vue/src/renderer/shell-preview/AppShellPreview.vue` 引入 `useRouter` + `SettingOutlined` + `import brandLogo from "../assets/logo.png"`；新增 `isMacPlatform` ref 与 `openSettings()` 跳转助手。

### Removed

- `seedConversations()` / `createDemoFiles()` / 旧 `createBlankFiles()` 演示树 —— 不再注入 demo04 / workspace / ClaudeBox 三条欢迎会话；首次启动或 schema/JSON 损坏均落到 `conversations: []` + `activeId: null`，UI 引导用户主动 "+ 新会话"。
- `__testing.seedConversations` 导出（store 单测同步对齐）。

### Migration

- **`stores/conversation-preview.ts` 持久化 schema 从 `version: 2` 升到 `version: 3`** —— `localStorage` 中残留的 v2 数据会因 `SCHEMA_VERSION` 不匹配被 `restore()` 直接判废，落到空白起步状态。无主动迁移代码 —— 损失的只是 demo 数据，用户真实会话首次启动后通过 "+ 新会话" 按需创建。

### Tests

- `conversation-preview.test.ts` 改写"空白起步"语义 —— `it("seeds desktop preview conversations …")` → `it("starts empty when storage is empty and persists the empty state")` 等 4 处用例，扩到 **23 条** 全绿。
- preview shell 系列：`theme-preview.test.ts`（10）+ `widget-registry.test.ts`（5）+ `v6-shell-default.test.ts`（9）+ `conversation-preview.test.ts`（23）= **47/47** 全绿（17.1s）。
- `vue-tsc --noEmit` 0 错误。

### Docs

- `docs-site/docs/guide/desktop-v6-shell.md` §0 —— P9a 描述更新到 schema v3 + 空白起步语义；测试合计 37 → 53；新增 P9d 品牌/平台/设置入口三段。
- `docs-site/docs/design/modules/97-claude-desktop-refactor.md` + `docs-site-design/docs/modules/m97-claude-desktop-refactor.md` —— §交付状态新增 P9d 条目。
- `docs-website-v2/src/pages/index.astro` —— `evolution[]` 顶部新增 2026-04-29 条目。
- `README.md` / `README_EN.md` —— 顶部新增 2026-04-29 增量更新表格。

---

## [CLI 0.156.5] - 2026-04-22 — Windows postinstall 跨平台修复

### Fixed

- **CLI postinstall 在 Windows `cmd.exe` 下失败** — 旧 `postinstall` 脚本用了 Unix-only 的 `2>/dev/null || true`（Windows cmd 把 `/dev/null` 当字面路径，且没有 `true` 命令），导致 `npm install -g chainlesschain` 以 `ELIFECYCLE` 退出，skill-packs 生成失败还会让整个安装红掉。
- 抽出 `packages/cli/scripts/postinstall.mjs` 跨平台包装脚本：`try/catch` 吞错 + `process.exit(0)` 保底，不再依赖 shell 重定向。
- `package.json` `files` 数组补充 `scripts/postinstall.mjs`，确保 npm tarball 里包含它。

### Affected versions

- 已发布的 `0.156.0` / `0.156.1` / `0.156.2` / `0.156.4` 全部受影响。Windows 用户请升级到 `0.156.5`，或在旧版本上加 `--ignore-scripts` 绕过。

---

## [v5.0.2.43] - 2026-04-21 — 发布前测试回归闭环 + 533 自动文档刷新 + CLI 0.156.2

### Added

- **发布前测试回归闭环** — 92 单元测试 + 5 集成测试 + `vue-tsc --noEmit` + `vite build` 五关全绿，E2E 跟随既有 `describe.skip` 约定；本轮回归未触发任何代码修复。结果表已写入 [`docs-site/docs/guide/desktop-v6-shell.md` §18.7](docs-site/docs/guide/desktop-v6-shell.md) 与 [`docs/design/桌面版UI重构_设计文档.md` v0.5](docs/design/桌面版UI重构_设计文档.md)。
- **533 份自动文档刷新** — `desktop-app-vue/docs/api/generated/*.md` prettier list/heading 规范刷新，`ARCHITECTURE_OVERVIEW.md` + `COMPONENT_REFERENCE.md` 格式同步。
- **CLI 0.156.1 → 0.156.2** — patch 补丁用于 v5.0.2.43 npm release（无源码改动）。

### Changed

- `deploy-docs.py` + `deploy-www.py` 重定向到 `v5.0.2.34-20260420-1831` tar 产物（稍后再滚到 `20260421-*`）。

---

## [v5.0.2.42] - 2026-04-20 — V6 Shell 回归闭环 + 用户文档

### Added

- **V6 Shell + `/v6-preview` 用户文档** — `desktop-v6-shell.md` 新增 §18 "P7–P9b 预览壳" 全套（18.1–18.7）+ v0.4 / v0.5 版本行；`desktop-ui-refactor-user-guide.md` 新建 355 行用户指南；`introduction.md` / `architecture.md` / `tech-stack.md` / `getting-started.md` / `compliance-threat-intel.md` / `social-protocols.md` 六份指南追加 17 章规范附录（概述 / 核心特性 / 系统架构 / 系统定位 / 核心功能 / ... / 相关文档）。
- **设计文档落地** — `docs/design/桌面版UI重构_设计文档.md` 458 行新文档（文档信息 + 修订历史 + 现状分析 + 总体设计 + 详细设计 + 企业定制方案 + 安全设计 + 与其他端的关系 + 迁移方案 + 风险与对策 + 待决事项 + 附录 A 目录约定 + 附录 B 相关文档）。
- **CLI 0.156.0 → 0.156.1** — 文档版本号对齐补丁。

### Changed

- `docs-site-design/scripts/sync-docs.js` + `docs-site/scripts/sync-design-docs.js` 加入新中文 → ASCII 映射：`桌面版UI重构_设计文档.md` / `96_V2规范层governance.md` / `97_桌面版UI_ClaudeDesktop重构计划.md`。
- VitePress 两站 sidebar 加入新条目（`desktop-ui-refactor` / `m97-claude-desktop-refactor` / `96-v2-governance`）。
- `docs-website-v2` footer + `desktop.astro` + `index.astro` evolution hero chip 全部 v5.0.2.10 → v5.0.2.34。

---

## [v5.0.2.34] - 2026-04-20 — 桌面版 V6 Chat-First Shell (P0–P6 完成) + P7 预览外观

### Added (P7 · Claude-Desktop 风格外观预览)

- **`/v6-preview` 路由** — 与 `/v2` 并存的新壳，不替换任何现网入口。沿用 P6 `slash-dispatch` 分发器。
- **4 主题体系** — `src/renderer/shell-preview/themes.css` 提供 dark / light / blue / green 四套 `--cc-preview-*` CSS 变量；`src/renderer/stores/theme-preview.ts` 是 Pinia store，`[data-theme-preview]` 属性切换，localStorage 持久化。
- **4 颗去中心化入口** — 左栏底部固化 `TeamOutlined` P2P / `SwapOutlined` Trade / `GlobalOutlined` Social / `SafetyCertificateOutlined` U-Key；分别绑定 `builtin:openP2P` / `openTrade` / `openSocial` / `openUKey` handler（当前为占位 toast，P8 对接业务页）。
- **三区骨架** — 左栏 `ConversationList` 会话历史 + `DecentralEntries` 四入口 + 主题切换；中区留白气泡 + 极简 composer（Ctrl/Cmd+Enter 发送）；右侧 `ArtifactDrawer` 抽屉从右滑入。
- 设计文档：[`docs/design/modules/97_桌面版UI_ClaudeDesktop重构计划.md`](docs/design/modules/97_桌面版UI_ClaudeDesktop重构计划.md)

### Tests (P7)

- `src/renderer/stores/__tests__/theme-preview.test.ts` — 11 例，覆盖初始值 / apply / restore / clear / 无效值保护 / 多 pinia 实例共享 localStorage
- `src/renderer/shell/__tests__/slash-dispatch.test.ts` — 8 例，覆盖注册 / 派发 / 未注册 / 覆盖语义 / 解绑匹配 / 错误捕获 / listRegisteredHandlers / 4 入口共存
- 合计新增 19 例全部通过

### Added (P8 · 4 颗入口接入 drawer preview widget)

- **4 个 preview widget** — `src/renderer/shell-preview/widgets/{P2p,Trade,Social,UKey}PreviewWidget.vue`，每颗 widget 统一 "概览 hero + kv 指标卡 + 2–3 按钮 router.push 进 `/main/*` 完整页" 骨架。
- **widget 注册表** — `shell-preview/widgets/index.ts` 把 4 个 entry id（`p2p` / `trade` / `social` / `ukey`）映射到 component + title。
- **`AppShellPreview.vue` 替换 `message.info()` 占位** — 现在 4 个 `builtin:open*` handler 直接打开 `ArtifactDrawer` 并挂载对应 widget；drawer 的 `toggleArtifact` / `closeDrawer` 同步清理 `activeEntryId` 状态。
- **跳转目标**：P2P 用 `P2PMessaging` + `/main/p2p/device-pairing`；Trade 用 `TradingHub` / `Marketplace` / `Contracts`；Social 用 `Chat` / `/main/social-collab` / `SocialInsights`；U-Key 用 `ThresholdSecurity` / `DatabaseSecurity` / `/main/hsm-adapter`（均已在 `router/index.ts` 存在）。

### Tests (P8)

- `src/renderer/shell-preview/widgets/__tests__/widget-registry.test.ts` — 5 例：4 canonical ids / 字段完整 / 已知 id 查询 / 未知 id undefined（大小写敏感）/ 标题唯一
- 合计 P7+P8 新增 **24 例** 单测全部通过（3.64s）

### Added (P9a · 会话持久化)

- **`useConversationPreviewStore`** — `src/renderer/stores/conversation-preview.ts` Pinia store，把预览壳的会话列表 + 消息 + 活跃 id 持久化到 `localStorage`（key `cc.preview.conversations`，`version: 1` schema）。
- **Schema 安全**：非法 version / 损坏 JSON / 非数组 conversations / `activeId` 指向不存在会话 — 均触发 "重新 seed 欢迎会话"；`restore()` 不抛错
- **actions**：`restore` / `select` / `createBlank` / `appendMessage` / `remove` / `clearAll` — 每次写操作立即 `_persist()` 到 localStorage
- **`AppShellPreview.vue` 重构**：所有会话 / 消息读写改走 store，`ref<Conversation[]>` + 内联种子完全删除，`onMounted` 额外调用 `conversationStore.restore()`

### Tests (P9a)

- `src/renderer/stores/__tests__/conversation-preview.test.ts` — 13 例：seed / hydrate / schema 版本拒绝 / 损坏 JSON 容错 / `createBlank` 活跃切换 / `appendMessage` 更新 preview+title+updatedAt+持久化 / 空串忽略 / `select` 未知 id 拒绝 / `remove` 当前活跃自动切换 / `remove` 非活跃保持 / `clearAll` 清空 / schema version 校验 / 空 store 自动 `createBlank`
- 合计 P7+P8+P9a 新增 **37 例** 单测全绿（~22s，4 个测试文件）

### Added (P9b · composer → 真 LLM)

- **`llm-preview-bridge.ts`** — `src/renderer/shell-preview/services/llm-preview-bridge.ts` 薄桥：`isAvailable()` 查 `window.electronAPI.llm.checkStatus()`；`sendChat(messages)` 调 `window.electronAPI.llm.chat({ messages, enableRAG:false, enableCache:false, enableCompression:false, enableSessionTracking:false, enableManusOptimization:false, enableMultiAgent:false, enableErrorPrecheck:false })`，从 `{ content }` / `{ message: { content } }` / `{ reply }` 三种返回形状中提取文本；`toBridgeMessages(history, nextUser?)` 把 `BubbleMessage[]` 转 `{role,content}[]`；所有失败（electronAPI 未就绪 / checkStatus 拒绝 / chat 抛错 / 返回空）都走 `BridgeResult = { ok: false, reason }` 兜底，不抛。
- **`AppShellPreview.sendDraft()` 重写**：追加用户气泡 → 翻 `isGenerating=true` → 调 bridge → 成功追加 assistant 气泡 / 失败追加 `LLM 调用失败：${reason}` / 不可用追加 `LLM 服务不可用，请检查火山引擎/Ollama 配置` → `finally` 翻 `isGenerating=false`。
- **typing 指示器 + 发送态**：气泡列表在 `isGenerating` 时追加一只三点动画气泡（`data-testid="cc-preview-typing"`）；发送按钮进入 `loading` 并禁用，直到回合结束。
- **`conversation-preview` store 扩展**：新增 `isGenerating: boolean` state、`appendAssistantMessage(content)` / `setGenerating(flag)` actions；`appendMessage` 修正为仅 `role==="user"` 时才在 `新会话` 标题上自动覆盖（之前 assistant 消息也会改标题）。

### Tests (P9b)

- `src/renderer/shell-preview/services/__tests__/llm-preview-bridge.test.ts` — 19 例：`isAvailable` 5 例（无 api / `{available:true}` / 布尔 / `{available:false}` / reject）+ `sendChat` 6 例（`{content}` / `{message.content}` / 空返回 / 抛错 / 无 api / 消息透传 + 关闭高级开关）+ `toBridgeMessages` 3 例（历史 + next / 空 next 跳过 / trim）+ `extractReply` 5 例。
- `conversation-preview.test.ts` 新增 2 例：`appendAssistantMessage` 不改标题 / `setGenerating` 翻转。
- 合计 P7+P8+P9a+P9b 新增 **58 例** 单测全绿（~15s，5 个测试文件）

### Added (P9c · 流式输出)

- **Bridge 扩展**：`llm-preview-bridge.ts` 新增 `streamAvailable()` / `sendChatStream(prompt, onChunk)` — 调 `window.electronAPI.llm.queryStream(prompt)` 并监听 `llm:stream-chunk` 事件。Payload 优先读 `fullText`，退回累加 `chunk`；调用方通过 `onChunk(liveText)` 收到每次累积文本。`queryStream` 返回为空时以累积文本兜底。`finally` 里 `off(STREAM_CHUNK_EVENT, listener)` 清理监听（preload 现有 off 无法真正 removeListener，是已知既有 quirk，影响范围限单监听器）。
- **局限**：`llm:query-stream` 只接收单串 prompt（无 messages 数组），预览壳流式发送时**仅把最新用户输入作为 prompt**，不含会话历史；历史感知的流式需要新建 main-process handler，超出 preview 范围，留给后续。
- **Store 新 actions**：`beginStreamingAssistant()` 种一只空 assistant 气泡并返回其 id；`updateAssistantContent(id, content)` 增量更新（不持久化，只在 finalize 时落盘）；`finalizeStreamingAssistant(id, content)` 写最终值 + `_persist()`；`removeMessage(id)` 删除指定消息（流式失败时把空气泡撤回，再走非流式 fallback）。
- **`AppShellPreview.sendDraft()` 双路径**：先查 `streamAvailable()` → 开 streaming bubble → 每个 chunk `updateAssistantContent` → 成功 `finalize` 返回；失败 `removeMessage` 后回落到非流式 `sendChat`；非流式再失败走友好提示（P9b 原路径）。
- **typing 指示器收敛**：新增 `showTypingIndicator` computed — 仅在"生成中但最后一条不是已开始填充的 assistant 气泡"时显示，避免流式状态下出现"打字指示器 + 实时内容气泡"双显。

### Tests (P9c)

- `llm-preview-bridge.test.ts` 新增 12 例：`streamAvailable` 4 例（无 api / `queryStream` 缺失 / 都齐 / 只有 queryStream 缺 on）+ `sendChatStream` 8 例（electronAPI 缺 / queryStream 缺 / 空 prompt / chunk 累加 + on/off 注册 / fullText 优先 / null 返回用累加兜底 / 空返回空累加报 `空` / 抛错仍清理 listener）。
- `conversation-preview.test.ts` 新增 5 例：`beginStreamingAssistant` 种 id / `updateAssistantContent` 更新 + preview / 未知 id + 非 assistant role 不动 / `finalizeStreamingAssistant` 落盘 / `removeMessage` 按 id 剔除。
- 合计 P7+P8+P9a+P9b+P9c 新增 **75 例** 单测全绿（~14s，5 个测试文件）

### Added

- **桌面版 V6 对话壳 P0–P6 全量落地** — Electron 桌面端 `/v2` 路由提供"对话优先 + 插件化平台"新壳，完整取代旧 dashboard。设计文档见 [`docs/design/桌面版UI重构_设计文档.md`](docs/design/桌面版UI重构_设计文档.md)，用户指南见 [`docs-site/docs/guide/desktop-v6-shell.md`](docs-site/docs/guide/desktop-v6-shell.md)。
  - **三区布局** — 左侧 `ShellSidebar`（空间切换）+ 中间 `ConversationStream` + `ShellComposer`（对话 + `/` 命令 + `@` 引用）+ 右侧 `ArtifactPanel` + 底部 `ShellStatusBar`。
  - **扩展点 7 类** — Spaces / Artifacts / Slash / Mention / StatusBar / Home Cards / Composer Slots，通过 `plugin.json` 的 `contributes.ui.*` 声明，经 `ExtensionPointRegistry` 按 priority 降序选出胜出者。
  - **企业能力 5 类** — LLM / Auth / Storage / Crypto / Audit Providers，通过 `contributes.provider.*` 声明，通过同一优先级机制让企业 Profile 覆盖默认。
  - **P6 分发器 + Widget 注册表**（本版本核心）— `src/renderer/shell/slash-dispatch.ts` + `widget-registry.ts` 把 plugin 声明的 `handler` / `component` 字符串真正接上运行时行为；内置 `builtin:openAdminConsole` + `builtin:AdminShortcut`。
  - **AdminConsole** — `Ctrl+Shift+A` / `/admin` / 状态栏齿轮按钮三路径打开；4 标签页（概览 / UI 扩展点 / 企业能力 / 调试），仅 `admin` 权限账户可见。
  - **企业定制三路径** — 私有 Registry（`trustedPublicKeys` 验签）、`.ccprofile`（ed25519 签名 + 每插件 sha256，一键换肤换能力）、MDM 推送（启动时校验解包到覆盖目录，高 priority 胜出）。
  - **13 个内置 first-party 插件** — `chat-core` / `notes` / `spaces-personal` / `cowork-runner` / `brand-default` / `ai-ollama-default` / `auth-local` / `data-sqlite-default` / `crypto-ukey-default` / `compliance-default` / `admin-console` / `chain-gateway` / `did-core`，跳过 DB / 沙箱 / 权限流程直接从 `src/main/plugins-builtin/` 载入。

### Tests

- 单元：`tests/unit/renderer/shell/slash-dispatch.test.ts`（7）+ `widget-registry.test.ts`（5）+ `AdminShortcut.test.ts`（2）
- 集成：`tests/integration/plugin-extension-points.integration.test.js`（5）— 验证 `.ccprofile` + MDM 覆盖链路，合成 `acme-corporate@100` 胜过 `chainlesschain-default@10`
- 深度集成：`tests/unit/renderer/shell/AppShell.interaction.test.ts`（3）— 全 jsdom 挂载 `AppShell` 验证三路径都能打开 AdminConsole
- E2E：`tests/e2e/v6-shell/admin-console.e2e.test.ts`（3 × `describe.skip`，待登录 helper 支持 admin 权限后启用）
- 合计：22 例单元 + 集成全部通过（13.6s）；渲染器 `npm run build` 4m 52s 绿灯

### Docs

- 新增 `docs-site/docs/guide/desktop-v6-shell.md` 用户指南（VitePress 侧栏已注入）
- 同步 `docs-site/docs/design/desktop-ui-refactor.md`（设计侧栏已注入）
- 设计文档升级到 v0.3（P0–P6 实现完成，附实现文件映射表 + 验证章节）

## [v5.0.2.10] - 2026-04-16 — Managed Agents A–J + Deep Agents Deploy + CutClaw B

### Added

- **Managed Agents Phase A–J** — Full parity with Anthropic Managed Agents architecture via `@chainlesschain/session-core` (0.3.0).
  - Phase A: `SessionHandle`, `TraceStore`, `AgentDefinition` + cache (79 tests)
  - Phase B: `SessionManager` — idle detection + park/unpark persistence (25 tests)
  - Phase C: `IdleParker` — configurable idle threshold + interval polling (14 tests)
  - Phase D: `MemoryStore` — scoped memory (global/session/agent/user) + `MemoryConsolidator` (55 tests)
  - Phase E: `ApprovalGate` (strict/trusted/autopilot) + `BetaFlags` with date-based expiry (46 tests)
  - Phase F: `StreamRouter` — unified `StreamEvent` protocol for all streaming paths (19 tests)
  - Phase G: `AgentGroup` + `SharedTaskList` with rev-based concurrency control (52 tests)
  - Phase H: Desktop IPC consumption — 24 IPC channels, singletons + preload namespace (33 tests)
  - Phase I: Session tail/usage + 14 WS routes + `stream.run` + `sessions.subscribe` + 3-provider token accounting (30 tests)
  - Phase J: Desktop `closeSession` → auto-consolidate + `_executeHostedTool` → ApprovalGate routing (36 tests)

- **Deep Agents Deploy Phase 1–5** — Agent bundle system for portable agent packaging.
  - Phase 1: `agent-bundle-schema` + `agent-bundle-loader` + `agent-bundle-resolver` (40 tests)
  - Phase 2: USER.md memory seeding via `applyUserMemorySeed` + `parseUserMdSeed`
  - Phase 3: `mcp-policy` — hosted/lan/local MCP transport gating (19 tests)
  - Phase 4: `sandbox-policy` — scope-based sandbox lifecycle (26 tests)
  - Phase 5: `service-envelope` + `envelope-sse` — unified wire format for WS/HTTP/SSE (30 tests)
  - CLI: `cc agent --bundle <path>` + `cc serve --bundle <path>` integration (15 tests)
  - Desktop: `bundle:load/info/unload` IPC channels + Pinia store integration

- **CutClaw Path B verification** — Architecture alignment items all verified.
  - B-1: `DebateReview.resolveConflictingVerdicts()` consumes `detectConflictPairs` + `pickWinnersAndLosers` from `sub-runtime-pool.js` (34 debate-review tests)
  - B-2: 4 built-in `QualityGate` checker factories — `createProtagonistChecker`, `createDurationChecker`, `createThresholdChecker`, `createLintPassChecker` (39 quality-gate tests)
  - B-3: 3 media categories (ASR/AUDIO_ANALYSIS/VIDEO_VLM) in `LLM_CATEGORIES` (25 tests)

- **session-core v0.3.0** — 22 library modules, 21 test files, 452 tests total

### Tests

- session-core: 452 tests across 21 test files
- Desktop session-core IPC: 33 tests
- Desktop session-service Phase J: 36 tests
- Desktop debate-review conflict resolution: 34 tests
- CLI agent-bundle integration: 15 tests
- CLI envelope-http-server: 11 tests

## [Unreleased] - 2026-04-09 — CLI Runtime 收口闭环 (Phase 7 Parity Harness)

### Added

- **Phase 7 Parity Harness 全量落地** — CLI Runtime 收口路线图 (`docs/design/modules/82_CLI_Runtime收口路线图.md`) Phase 0–7 全部完成，统一 Coding Agent envelope 协议 v1.0 在 CLI / Desktop / Web UI 三端达成字节级对齐。
  - 8 步 parity 测试矩阵全部通过（91 tests）：envelope 契约、sequence tracker、legacy→unified 双向映射、WS server envelope 透传、JSONL session store、SubAgentContext worktree 隔离、mock LLM provider、desktop bridge envelope parity。
  - 新增 `packages/cli/__tests__/integration/parity-envelope-bridge.test.js`(58 tests)覆盖 `createCodingAgentEvent` / `CodingAgentSequenceTracker` / `wrapLegacyMessage` / `unwrapEnvelope` / 数据驱动 roundtrip / `validateCodingAgentEvent` / `mapLegacyType` 全路径。
  - `src/lib/agent-core.js` / `src/lib/ws-server.js` / `src/lib/ws-agent-handler.js` 降级为 @deprecated shim（26/16/12 行），canonical 实现收归 `src/runtime/` 与 `src/gateways/ws/`。

### Status

- 收口完成定义 5 项准则全部达成 ✅（见 82 路线图 §8）：单一入口、envelope 协议统一、parity harness 全绿、shim 明确标注迁移窗口、文档同步。

### Docs

- 同步更新 `docs-site/docs/chainlesschain/cli-runtime-convergence-roadmap.md` 与 `docs-site/docs/design/modules/82-cli-runtime-convergence.md` 镜像至 canonical。

## [v0.45.55–v0.45.61] - 2026-04-08 — 技术债收官 (M2 + IPC Registry)

### Performance

- **M2 启动期同步 IO 异步化收官** — 把启动关键路径上的同步 IO 全部转为 `fs.promises`，避免阻塞 Electron 主进程事件循环。共改造 11 个模块（unified-config-manager / ai-engine-config / tool-skill-mapper-config / mcp-config-loader / database-config / logger / git-auto-commit / project-config + 3 个 ai-engine-manager 变体）。所有改造均使用 `_deps` 注入模式以保持单元测试可 mock；同步 API 作为运行时快路径保留。
  - v0.45.58: `project-config.js` 新增 `initializeAsync` / `loadConfigAsync` / `saveConfigAsync` + `getProjectConfigAsync()` 工厂；`ai-engine-manager.js` / `ai-engine-manager-p1.js` / `ai-engine-manager-optimized.js` 三个变体的 `initialize()` 改用 `await getProjectConfigAsync()`。

### Refactored

- **IPC Registry 收官** (v0.45.59~60)
  - **v0.45.59** — `ipc-registry.js` 的 Phase 5 / Phase 9-15 deps 构造曾用 `{ mcpClientManager, mcpToolAdapter }` 简写但顶部从未声明这两个标识符。由于 `...dependencies` 已经覆盖了它们，简写引用纯属冗余 + 真实潜在 ReferenceError。删除两处冗余引用。
  - **v0.45.60** — 主文件顶部 30+ 行的 destructure（绝大多数项只解构出来又通过 `...dependencies` 转发）压缩到只剩 5 个本文件直接引用的 manager (`app` / `database` / `mainWindow` / `llmManager` / `aiEngineManager`)，其余通过 `...dependencies` 透传。文件 495 → 446 行。

### Fixed

- **v0.45.61** — `project-export-ipc.js` 的 `project:import-file` 处理器有 v0.45.13 引入的 copy-paste 死代码块，引用了 `projectPath` 和 `normalizedProjectPath` 两个未在该作用域定义的变量；进入该 handler 即抛 `ReferenceError`。彻底删除死块，改用 `getActiveDatabase()` 路径（与 export-file handler 一致）。同步补全 `project-export-ipc.test.js` 中 mockDatabase 的 `getProjectById` / `getProjectFiles` / `db.get` / `db.run` 接口，原本静默失败的 3 个文件操作测试还原为真实断言。
- **v0.45.57** — `git-auto-commit.js` 的 `isGitRepository()` 改用 `fs.promises.stat` + ENOENT/ENOTDIR 容错，消除最后一处启动可达的 `existsSync` 调用。

### Tests

本轮全面回归通过：
- `src/main/ipc/__tests__/`: 89/89 ✅
- `src/main/git/__tests__/` + `tests/unit/git/`: 192/192 ✅
- `tests/unit/project/`: 212/212 ✅（修复了 3 个 pre-existing 失败）
- `tests/unit/ai-engine/`: 1987/1987 ✅
- `packages/cli/__tests__/unit/`: 3053/3053 ✅

### Tasks

- ✅ #2 H2 IPC Registry 拆分（completed）
- ✅ #7 M2 启动期同步 IO 异步化（completed）

12 项 tech-debt 列表全部清零。

## [3.4.0] - 2026-02-28

### Added

**v3.1.0 — Decentralized AI Market (Phase 65-67):**

- Phase 65: Skill-as-a-Service — SkillServiceProtocol, SkillInvoker, 5 IPC handlers
- Phase 66: Token Incentive — TokenLedger, ContributionTracker, 5 IPC handlers
- Phase 67: Inference Network — InferenceNodeRegistry, InferenceScheduler, 6 IPC handlers

**v3.2.0 — Hardware Security Ecosystem (Phase 68-71):**

- Phase 68: Trinity Trust Root — TrustRootManager, attestation chain, 5 IPC handlers
- Phase 69: PQC Full Migration — PQCEcosystemManager, ML-KEM/ML-DSA replacement, 4 IPC handlers
- Phase 70: Satellite Communication — SatelliteComm, DisasterRecovery, 5 IPC handlers
- Phase 71: Open Hardware Standard — HsmAdapterManager, FIPS 140-3, 4 IPC handlers

**v3.3.0 — Global Decentralized Social (Phase 72-75):**

- Phase 72: Protocol Fusion Bridge — ProtocolFusionBridge, cross-protocol conversion, 5 IPC handlers
- Phase 73: AI Social Enhancement — RealtimeTranslator, ContentQualityAssessor, 5 IPC handlers
- Phase 74: Decentralized Storage — FilecoinStorage, ContentDistributor, 5 IPC handlers
- Phase 75: Anti-Censorship — AntiCensorshipManager, MeshNetworkManager, 5 IPC handlers

**v3.4.0 — EvoMap Global Evolution (Phase 76-77):**

- Phase 76: Global Evolution Network — EvoMapFederation, multi-Hub sync, 5 IPC handlers
- Phase 77: IP & Governance DAO — GeneIPManager, EvoMapDAO, 5 IPC handlers

**Infrastructure:**

- 64 new IPC handlers across 13 phases
- 23 new database tables
- 13 new Pinia stores, Vue pages, and routes
- 4 new Context Engineering setters (steps 4.9-4.12)
- 13 new config sections
- Comprehensive unit tests (279 tests passing) and E2E tests

## [0.21.0] - 2026-01-19

### Added

**Desktop Application (v0.20.0 → v0.21.0):**

- GitHub Release automation system with comprehensive workflows
- Multi-platform build improvements and optimizations
- Virtual project creation for AI chat E2E tests
- Test infrastructure improvements with ESLint fixes
- Playwright E2E testing support at root level

**Android Application (v0.1.0 → v0.4.0 → Phase 5):**

- **Phase 3**: Knowledge base feature module with CRUD, FTS5 search, and Paging 3
- **Phase 4**: AI chat integration with LLM adapters (OpenAI, DeepSeek, Ollama), SSE streaming, RAG retrieval
- **Phase 5**: P2P networking (WebRTC, NSD discovery, DataChannel transport) and DID identity system (did:key, Ed25519)

**Mobile Application:**

- Performance testing tools and Lighthouse integration
- Final performance metrics report

### Fixed

- CI workflow: Added Playwright dependency to root package.json
- CI workflow: Corrected package-lock.json path in release workflow
- Test failures: Converted CommonJS to ESM imports in test files
- Test failures: Updated IPC handler counts for LLM and Knowledge Graph
- Test failures: Fixed syntax errors and module path issues
- MCP: Removed unused variables and imports
- MCP: Added missing latency metrics to performance monitor
- PDF engine: Fixed test failures with dependency injection
- Tool manager: Fixed test mocks and upsert logic
- Word engine: Fixed HTML parsing
- Windows: Fixed unit test failures
- MCP: Improved server environment variables and default configs
- Desktop: Ensured main window shows after splash screen

### Changed

- Improved P2P voice/video tests with real manager integration
- Enhanced MCP tool testing UI and permission handling
- Added public validation methods to MCPSecurityPolicy
- Refactored test infrastructure with global mocks
- Organized root directory files
- Reorganized src/main into categorized subdirectories

### Performance

- Lazy loading for blockchain, plugins, and media modules
- Optimized startup time with deferred module loading
- Reduced memory footprint with lazy highlight.js loading

### Security

- Enhanced MCP security with improved config validation
- Better error handling for incomplete server configurations

## [0.20.0] - 2026-01-15

### Added

- MCP (Model Context Protocol) integration POC v0.1.0
  - Filesystem, PostgreSQL, SQLite, Git server support
  - Defense-in-depth security architecture
  - Tool testing UI
- LLM Performance Dashboard with ECharts visualization
- SessionManager v0.22.0 with auto-compression (30-40% token savings)
- ErrorMonitor AI diagnostics with local Ollama LLM
- Manus optimizations (Context Engineering, Tool Masking, Task Tracking)

### Changed

- Updated all design documentation to v0.20.0
- Refactored main process modules into categorized subdirectories
- Enhanced login debug logging

### Fixed

- Git status modal now receives correct project ID
- Added WebRTC compatibility layer for P2P
- Improved monitoring and test stability

## [0.19.0] - 2026-01-10

### Added

- P2P encrypted messaging with Signal Protocol
- Knowledge graph visualization
- Advanced RAG retrieval system
- Multi-agent task execution framework

### Fixed

- Database encryption with SQLCipher
- U-Key hardware integration improvements

## [0.18.0] - 2026-01-05

### Added

- Desktop app Vue 3 migration complete
- Ant Design Vue 4.1 UI components
- Electron 39.2.6 upgrade

### Changed

- Migrated from Vue 2 to Vue 3 with Composition API
- Updated build toolchain to Vite

## [0.16.0] - 2025-12-20

### Added

- Knowledge base management (95% complete)
- RAG-enhanced search
- DID-based identity system
- P2P network foundation

---

## Version History

- **3.4.0** (2026-02-28) - v3.1.0-v3.4.0 Phase 65-77: AI Market, Hardware Security, Global Social, EvoMap
- **0.21.0** (2026-01-19) - Android Phase 5, Release automation, Test improvements
- **0.20.0** (2026-01-15) - MCP integration, Performance dashboard, Manus optimizations
- **0.19.0** (2026-01-10) - P2P messaging, Knowledge graph
- **0.18.0** (2026-01-05) - Vue 3 migration, Electron upgrade
- **0.16.0** (2025-12-20) - Knowledge base MVP

---

## Links

- [Repository](https://github.com/chainlesschain/chainlesschain)
- [Documentation](https://github.com/chainlesschain/chainlesschain/tree/main/docs)
- [Issues](https://github.com/chainlesschain/chainlesschain/issues)
- [Releases](https://github.com/chainlesschain/chainlesschain/releases)
