# 更新日志

所有重要的项目变更都会记录在此文件中。  
格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，版本号遵循语义化版本。

## [v5.0.3.64] - 2026-05-18 — iOS 版本号 4 段制 + AppConstants stale 硬编码清零 + 全套测试覆盖

> v5.0.3.63 release 后用户反馈:(1) iOS Settings 「版本」只显示 3 段制 `5.0.3` 或 stale `0.32.0`（实际几个月没更过硬编码常量）;(2) PIN 闪退问题仍报告(待 crash log)。本版做三件事:**A** 修 `AppConstants.App.version` / `buildNumber` / `bundleId` 三个 stale 硬编码改为从 `Bundle.main` 动态读;**B** 加 iOS 17 API 二次审计(全仓 596 个 `.swift` × 29 个 pattern 扫描,0 处新增违规);**C** 加单元测试 + 集成测试 + UITest 三层覆盖。

**已完成**:
- 修 stale 硬编码 — `AppConstants.App.version` (`0.32.0` → `Bundle.appShortVersion`) / `buildNumber` (`32` → `Bundle.appBuildNumber`) / `bundleId` (`com.chainlesschain.ios` → `Bundle.main.bundleIdentifier`)
- 修 `AIDashboardView.swift:95` 硬编码 `v0.16.0` + `PluginManager.swift:118` 硬编码 fallback `1.7.0`
- 加 `Bundle` extension (`Modules/CoreCommon`):`appShortVersion` / `appBuildNumber` / `appFullVersion`(4 段制 `5.0.3.64`) / `appFullVersionTag`(`v5.0.3.64`) / `appDisplayName`
- `SettingsView` 关于栏:显示 `v5.0.3.64`(`a11y id = settings.app.version`), 加「Bundle ID」一栏让用户能确认装的是真版本
- `SystemTools.appInfo` 加 `fullVersion` 字段(技能侧获 4 段制版本号)
- 11 BundleVersionTests + 7 AppStateNotificationTests + 2 XCUITest(`testSettingsVersionDisplaysFourSegmentTag` / `testPINUnlockDoesNotCrashOnFirstLaunch`) 三层覆盖
- 全仓 596 个 `.swift` 二次审计 29 个 iOS 17-only API pattern, 0 新增违规, `AppState.swift` v5.0.3.63 修已就位
- AppIcon 18 + LaunchIcon 3 张资产复审:全 RGB 无 alpha 通道, App Store 合规
- 5 version surface 全 sync (productVersion / desktop alpha / ios short+build / android name+code)

**待用户反馈**:v5.0.3.63 PIN 闪退根因未在代码层复现, 装 v5.0.3.64 仍崩请附 crash log (Xcode → Devices and Simulators → View Device Logs)。Settings 新「Bundle ID」字段可帮确认安装版本。

## [Unreleased] — iOS Phase 5 AI Chat 收口（4 真实 bug + 4 集成测试）

> Phase 5.1-5.6 已随前期 commit 落地；Phase 5.7 收口走静态审计路径找出并修 4 真实 bug，每条 1 个回归单测。同时补 4 个集成测试覆盖 events fan-out / cancel 顺序 / offline drain / 多对话 stream 隔离的端到端链路。

**Bug 修复**：
- `RemoteAIChatViewModel.finalizeStreamingPlaceholder` 空字符串 messageId 击穿 SwiftUI ForEach 身份 — 改用显式 isEmpty guard 而非 nil-coalesce。
- `RemoteAIChatViewModel.deleteConversation` 失败时半回滚 — 仅恢复 conversations 列表，currentConversation/messages 留空。新增 `rollbackDelete` 私有方法，全量原子回滚。
- `RemoteAIChatViewModel.sendMessage` 缺 stream-in-flight 防御 — UI 隐藏 send button 但 VM 不能假设，加 `guard currentStreamId == nil`。
- `RemoteAIChatViewModel.selectConversation` 保留 stale `currentStreamId` — 切对话后 prev stream 的 delta 在 edge case 下污染新 conv 末条。改为显式清。

**测试覆盖**：
- 单测从 41 → **45**（每个 bug 1 条回归单测）；总 iOS 单测 **~358**。
- 新集成测试 `Phase5AIChatIntegrationTests.swift`（4 条）：真 fan-out 端到端 / cancel 顺序保证 / offline drain / 多对话 stream 隔离。
- 集成测试从 6 → **10**。

**真机 E2E（Phase 5.8）** 仍待 Mac+iPhone+真桌面在场，design `iOS_Phase_5_AI_Chat_Skill.md` §8.4 已就绪 8 场景 reproducer 详步骤。

## [v5.0.3.63] - 2026-05-17 — iOS 16 PIN 闪退修复 + AppIcon 全幅 + Sub-phase 5-6 移动远程终端体验

> v5.0.3.62 部署 iOS 16 后真机暴露两类问题：(1) iOS 16 上 PIN 设置 / 解锁均闪退，根因 `AppState.swift` 用了 iOS 17 only `MainActor.assumeIsolated`；(2) AppIcon 缩成小图四周大片白边。同时 Android 端 Sub-phase 5-6 LOCAL 项目首次远程终端体验：放宽 v2 fallback gate + 弹框补填 PC 端工作目录避免 PtyManager 落 Electron cwd。

**已完成**：
- iOS PIN 闪退（iOS 16）— `AppState.swift` `MainActor.assumeIsolated` → `Task { @MainActor in ... }`；518 个 `.swift` 复审 0 处其它裸调 iOS 17 API
- iOS AppIcon — `desktop-app-vue/assets/icon.png`（1282×1282 全幅）sharp 重生成 18 张 AppIcon + 3 张 LaunchIcon，扁平化白底
- Android Sub-phase 5-6 LOCAL 项目终端入口 — `RemoteContextViewModel.kt`（新）：`pairedDesktops` StateFlow 兜替 `sourcePeerId` 判 Terminal icon 可见 / `findPcProjectPathByName()` 自动预填同名项目路径 / `pushPcRootPathToDesktop()` 双向同步
- `ProjectDetailScreenV2.kt` v2 fallback + `AlertDialog` lookup 进度条 + 预填
- `mobile-bridge-sync.js` 新 `project.updatePath` topic 兼容 `root_path` 旧 row
- 5 个 version surface 全 sync 验证通过
- iOS 16 真机 PIN 首次设置 + 重新登录解锁两条路径通过
- Android Xiaomi 24115RA8EC：LOCAL 项目首次点终端 → 弹框预填 → 写回桌面 `pc_root_path` → PtyManager 落正确工作目录

## [v5.0.3.62] - 2026-05-17 — iOS deployment target 降到 iOS 16

> v5.0.3.61 .ipa 出包后审计发现 iOS 17 baseline 偏高；app 实际只用 1 处 iOS 17-only API（SystemInfoView 的 `.symbolEffect` pulse 动画）。降到 iOS 16 后覆盖 2017 年以来所有 iPhone 机型（iPhone 8+），可测试 / 试用人群约扩大 30%。

**已完成**：
- `ChainlessChain.xcodeproj` Debug + Release config `IPHONEOS_DEPLOYMENT_TARGET = 16.0`
- `Package.swift` platforms `.iOS(.v16)`，SPM 模块跟随
- `SystemInfoView` pulse 动画 `if #available(iOS 17, *)` 包装，iOS 16 fallback 为静态图标
- 5 个 version surface (productVersion / desktop / ios.short / ios.build / android.name/code) 全 sync 验证通过

**审计结果**：app 无 `@Observable` macro / `ContentUnavailableView` / 显式 `@available(iOS 17, *)` 标注，迁移成本极低。

## [v5.0.3.61] - 2026-05-17 — iOS CI 真签名 .ipa 出包

> v5.0.3.56 揭示 iOS app target 412 编译错后，build-ios 临时回退 SPM-only 不产 .ipa。app target 0 错 (`a8dc88b13`) 后，本版本恢复 xcodebuild archive + ExportArchive 路径，配 Hua Zhang Apple 账号 ad-hoc 证书（Team `2GMR44F922`），每次发版自动产签名 `.ipa`（7.4MB）随 GitHub Release。

**已完成**：
- 配 4 个 GitHub Secret (`IOS_CERTIFICATE_BASE64` / `IOS_CERTIFICATE_PASSWORD` / `IOS_PROVISIONING_PROFILE_BASE64` / `IOS_TEAM_ID`)，Hua Zhang Team `2GMR44F922` 的 `iPhone Distribution` 证书 + `adhoc` ad-hoc profile
- `release.yml` build-ios 从 SPM-only 回到 xcodebuild archive 路径（revert `faa8e267f`）
- 4 iter 修通签名链路：(1) 加 `PROVISIONING_PROFILE_SPECIFIER` 暴露需求 → (2) 删 xcpretty 让 raw 错误显形 → (3) 看到 SPM target 全局污染真因 → (4) 把 signing setting 从 CLI 搬到 `ChainlessChain.xcodeproj` per-target，CLI 只留 `DEVELOPMENT_TEAM`
- ExportOptions.plist 加 `signingStyle=manual` + `provisioningProfiles` map
- 加 `Upload xcodebuild logs (diagnostics, always)` step 让失败可秒拉 raw 日志
- Android 跨模块 runtime 35 fail 一晚收口（与 iOS 工作并行）

**已验证**：测试 run 25987829449 产 `ChainlessChain.ipa` 7,720,753 bytes，embedded.mobileprovision 匹配 adhoc profile，挂载 GitHub Release 同 17 个 desktop / Android asset 一起。整 release.yml 11 job 全绿。

**已知限制**：
- .ipa 仅可装 Hua Zhang 测试 iPhone (UDID `b9a7376832...`)。加新设备需 Apple Developer Portal 加 UDID + 重签 profile + 更新 secret
- App Store distribution 不在本版本范围（需要 App Store method profile）

## [v5.0.3.57] - 2026-05-17 — Android FileTransferScreen 本机下载浏览面板

> Plan C Android↔PC 文件传输 (`3463e059a`) 落地后的 UX 补强：Android 端新增「本机下载文件夹」面板，用户可以直接在 app 内浏览公共 Downloads 目录里下载到的文件，点击调系统应用打开，免去跳 Files app 翻找。

**已完成**：
- `FileTransferScreen` TopBar 增加 `PhoneAndroid` 图标按钮，切换显示 `LocalDownloadsPanel`
- `queryLocalDownloads()` 通过 `MediaStore.Downloads.EXTERNAL_CONTENT_URI` 查询（API 29+ 公共 Downloads 目录），按 `DATE_ADDED DESC` 排序，每行展示文件名 / 大小 / 时间 + 「打开」按钮
- 面板内置刷新 / 关闭 / loading 态 / 空态提示，最大高度 360dp + LazyColumn

**背景**：Plan C 落地后用户反馈，下载完文件只看到 Toast「已保存到 Downloads」，但不知道具体哪里、也无法直接打开。这次面板就在 FileTransferScreen 内集成，UX 闭环。

## [v5.0.3.56] - 2026-05-16 — iOS CI 真编译收口 (Phase 1-5 SPM 绿) + release.yml 防 mask

> 2026-05-15/16 一晚 20 iter 推进 iOS GitHub Actions 真编译。Phase 1-5 时代所有 iOS CI 显示 success 实际从未真编译——双层 mask 让失败假绿。本次收口让 Phase 1-5 SPM 模块（CoreP2P 起 263 unit tests 基底）真编绿，揭示 app target 412 个老代码 compile error。

**已完成**：
- `.github/workflows/ios-build.yml` 全 mask 拔除 + native `swift build --target CoreP2P` 路径稳定，Phase 1-5 真编验证（run 25923999179）
- `.xcodeproj` 程序化接 SPM wiring（`ios-app/scripts/wire_spm_packages.rb` + manual-dispatch workflow `ios-wire-spm.yml`）
- 补缺失类型（DIDIdentity / Ed25519 / Ed25519KeyPair / Base58 / Data.bytes ext / SecKey force-cast）
- 修 Phase 1-5 真 Swift 编译 bug（covariant Self / pcPeerId unwrap / data redeclaration）
- `.gitignore models/` → `/models/` anchor，解屏蔽 7 个 iOS Swift 文件
- `release.yml` build-ios 删 stale `create_xcode_project.rb`、删全 mask、临时 SPM-only 路径不阻塞 release

**已知限制**：iOS app target 412 编译错（pre-Phase-1-5 老 scaffold），本版本暂不产 .ipa/.app 安装包。修复路径详见 memory `ios_app_target_compile_state.md`，4 级工作量评估（极轻 30min → 极重 1-2 周）。

## [v5.0.3.55] - 2026-05-15 — Android GA 后续 #21 P1 主体 5/5 + iOS Phase 1+2+3+4 完整移植

> 桌面 Android v1.0 GA (`v5.0.3.53`) 上架后，issue #21 P1 主体 5 项一日内全部 land — A.1+A.2+B.1+B.5+C.1 闭环，~270 单测 + 5 设计文档 + Linux 用户配对指南。P2 候选 4 项 (B.3/B.4/C.2/C.3) 等 GA Play Store + 真用户反馈复评。

**A.1 桌面 Linux native 配对**（PR1+PR2+PR3，57 单测）：

- `cc pair preflight` — 5 项 LAN 诊断（平台 / 网卡 / multicast / port 5353 holders / firewall hint），exit 0/1/2 分级
- `cc pair token generate/list/show/revoke` — one-active-DID 不变量 + atomic file write
- `dist-tools/systemd/chainlesschain.service` — hardening 全套 systemd 模板（NoNewPrivileges / ProtectSystem=strict / ReadWritePaths whitelist）
- `docs/linux/PAIRING.md` — 9 段用户指南（3 场景 / 5 blocker 修复 / 诊断包收集）
- **Audit 反驳**："Linux 需补 mDNS systemd 单元"是误解 — `@libp2p/mdns` + `bonjour-service` 纯 JS 不依赖 avahi-daemon

**A.2 三端 UI consistency 设计文档** v0.1 baseline — 4 项 *必须一致*（语义色 / 高风险红 / DID 短显 / m-of-n 进度展示）+ 4 项 *必须不同*（手表大按钮 ≥48dp / 桌面侧栏 / 车载 voice-only / 手机 thumb zone）

**B.1 web-shell 私钥签字 UI**（PR1+2a+2b+3，113 单测）：

- `MultisigSigner` + `buildUkeyManagerSigner` adapter + `multisig.sign` WS topic（in-process，绕开 cc subprocess 6-10s 冷启）
- `signWithExternal` async API（core-multisig 新增）
- `SignProposalModal.vue`（Pinia store + member dropdown + dev-only hex source）
- `unified-key-manager` DID-based signer routing — 同 DID 跨 driver 自动路由

**B.5 跨链桥 outbound × m-of-n 多签**（Layer 1+2，8 PRs）：

- Layer 1：CLI `bridge --require-multisig` + `bridge-consume` + web-shell `crosschain.bridge.consume` 直接 topic + Multisig.vue 执行按钮
- Layer 2：`cc_bridges` m-of-n provenance 列 + crosschain-mtc `attachMultisigProvenance` / `stripMultisigSigsForCanonical` helpers + `buildMultiHopBridgeEnvelope` 3rd arg + `verifyMultiHopBridgeEnvelope` auto-runs provenance check + `bridge-consume --mtc` carries multisig provenance into staging
- Layer 3（external-blocked Q-COMP-3）：真 testnet 锚定 + contract audit + KYC + bridge counterparty 选型 — 不计入本 scope

**C.1 watch face → VoiceMode shortcut**（PR1+PR2+PR3，33 单测）：

- Phone-side `VoiceLaunchActions` + `VoiceTriggerSource`（AUTO_BUTTON / PHONE_SHORTCUT / WEAR_FORWARD / VOICE_TRIGGER 4 enum）
- `CcPhoneVoiceListener` Data Layer service — `/cc/voice/start` MessageClient path
- Wear-app `VoiceSender` / `VoiceShortcutTileService` / `VoiceComplicationService`
- **安全**：`trigger_source` 字段 wear 侧仅信息用途，phone 侧锁 `WEAR_FORWARD` 防伪
- **Audit reframe**：设计文档说"需先抽 generic `cc.voice.start` IPC"不准 — Auto Phase 1 实际是 in-process VM event，没有公开 IPC；wear 走 Wearable Data Layer MessageClient 直 forward 更直

**bug 修**（最终 sweep）：

- C.1 PR1+PR2 两个 Robolectric 测试漏标 `@Config(sdk = [33])`，Robolectric DefaultSdkPicker 拒收 compileSdk=35（maxSdkVersion=34）；统一与 `:app` 其它 Robolectric 测试一致 — `f1d283833`

**剩余 follow-ups**（gated）：

- A.1 full headless WS signaling listener + IPv6 multicast + WSL2 helper（gated on GA reflection）
- B.5 Layer 3 真链上锚定（external-blocked，Q-COMP-3 待 testnet 资金 + contract audit + KYC 决策）
- B.1 F1-F4：encrypted software secret store / CLI --keystore flag / SignProposalModal 'unified' radio / UnifiedKeyManager IPC bind-did
- C.1 真机 instrumented E2E + 预览 drawables + phone shortcut tile

issue：[#21](https://github.com/chainlesschain/chainlesschain/issues/21) · 设计文档：[Android 重新定位 §10 GA 后续 scope](./design/Android_重新定位_设计文档.md)

---

## [v5.0.3.55] - 2026-05-15 (cont) — iOS Phase 1+2+3+4 完整移植 + 2 P0 修

> Android v1.0 GA 验证后启动 iOS 镜像移植，一日内三 Phase 框架级落地：133 文件 / ~264 单测 / 3 设计文档 / 3 trap memory。

**iOS 端用户闭环**（仅框架，待真机 E2E）：

- 桌面配对三流（Flow B 摄像头扫桌面 QR / Flow A 桌面扫手机 QR Signal e2ee / 手输 6 位 code）
- 已配对桌面列表 → 单击桌面 → `RemoteOperateView` 5-tab segmented shell：
  - **终端 Tab**（Phase 2）：xterm.js WKWebView + WebRTC DataChannel 直连 + softkey toolbar
  - **剪贴板 Tab**（Phase 3.3）：双向读写 + iOS UIPasteboard 集成
  - **文件 Tab**（Phase 3.4）：浏览 home dir + 面包屑 + 看文本 + 24 文件 icon
  - **截屏 Tab**（Phase 3.5）：触发桌面截屏 + iOS 显图 + PHPhotoLibrary 显式保存
  - **系统 Tab**（Phase 3.5）：CPU/Mem/Disk/Net 4 cards + 5s polling

**架构 highlight**：

- `RemoteCommandClient` 通用 RPC actor (Phase 2 `TerminalRpcClient.invoke` 抽出 sibling) — 4+N skill 共享同一 invoke 池 + DC/signaling 双路径 + LRU dedup + pending pool
- `RemoteSkillRegistry` 23 SeedRegistry 1:1 mirror Android (795 method)
- `OfflineCommandQueue` UserDefaults JSON crash recovery (sending → pending) + `OfflineQueueDrainer` `dataChannelReady` false→true edge detection
- 镜像 Android 已 Xiaomi 真机 E2E 验证版的 layout（HIG 偏离仅白名单 6 项）

**bug 修 (P0)**（code review 后期）：

- `RemoteCommandClient.invoke` continuation 泄漏 — `withThrowingTaskGroup` timeout 路径不会 auto-resume 池中 continuation；修法 `do/catch` 显式清池
- `RemoteWebRTCClient.waitForAnswer` 同模式不清 `pendingAnswer`；修同上
- 2 regression test + 1 集成 test 验池清

**剩余真机 E2E**（需 Mac+iPhone+真桌面，移交用户）：Phase 1.7 三流配对 + Phase 2.7 4 终端场景 + Phase 3.7 4 skill 各跑一次 + Phase 4.7 8 通知场景。

**iOS Phase 4 — Notification skill 追加**（design `cf7a7be78` + 6 sub-phase impl `45b485fdd` → `5877b5d84`）：

- **NotificationCommands actor** (11 method, 1:1 mirror Android `NotificationCommands.kt`) + 18 unit tests
- **NotificationEventDispatcher** @MainActor class — 订 commandClient.events + LRU dedup 256 + 触发 PushNotificationManager.scheduleSystemNotification + 10 unit tests
- **RemoteNotificationsViewModel** — 6 user actions + 乐观更新 + offline gate 三分支 + 13 unit tests
- **NotificationsView** UI — 镜像 Android NotificationCenterScreen + filter / List + swipe / detail sheet / settings sheet
- **RemoteOperateView 第 6 tab "通知"** + SkillTabPickerView REWRITE 为 horizontal scroll + button row + Capsule unread badge (per design §7.9 备选 B; HIG 5-tab segmented 软上限解决方案)
- **既有 PushNotificationManager (531 LOC) 0 改动** — 仅加 1 行 `extension PushNotificationManager: RemoteNotificationPushTarget {}` 显式 conformance
- **新发现 trap (设计 §7 未覆盖)**：events fan-out — cmdClient.events 单消费者，多 skill 订阅必须 RemoteDeps 内 fan-out task 拆成多子流；Phase 3 仅 1 订阅 OK，Phase 4 加 dispatcher 后必现冲突。修法落地在 RemoteDependencies init。
- **41 新 unit tests across 3 files**；iOS 单测累计 ~313

设计文档：[iOS Phase 1 配对](./design/iOS_Phase_1_Pairing_Flow_B.md) · [iOS Phase 2 终端](./design/iOS_Phase_2_Remote_Terminal.md) · [iOS Phase 3 操控 framework](./design/iOS_Phase_3_Remote_Operate_Framework.md) · [iOS Phase 4 通知 skill](./design/iOS_Phase_4_Notification_Skill.md)

## [v5.0.3.54] - 2026-05-14 — Plan A.1 真机 E2E 收口（8 bugs：UI 黑屏 + cc/claude 可用）

> v5.0.3.53 发版后真机 E2E 暴露 8 个独立 bug，从"打不开 / 黑屏 / 无法输入 / cc/claude 不可用"到端到端完整可用。`f54a6fcd0` 收口（Xiaomi 24115RA8EC ↔ Windows git-bash longfa 验证）。

**核心修复**（详细 entry 见根 `CHANGELOG.md`）：

- **fix1-5** WebRTC echo loop + iceServers 自动 refresh + 中继 `msg.from` 注入 + TerminalRpc dedup gate
- **fix7** `TerminalListViewModel` closure shadow + List 屏自动 navigate 到新 session
- **fix11** `TerminalWebView LayoutParams MATCH_PARENT` — Compose AndroidView WRAP_CONTENT + HTML body `height:100%` 死锁让 WebView 永远 0 高（"全黑"真因）
- **fix12** `PtyManager` login shell + git-bash probe — `cc` / `claude` / `npm` 等用户全局 CLI 在 Android 远程终端可用（之前 PATH 解析到 WSL bash root 用户没 PATH）

记忆复盘：`feedback_currentpeerid_target_vs_self_trap.md` + `android_webview_xterm_resize_observer.md`

---

## [v5.0.3.53] - 2026-05-14 — Plan A.1 远程终端 Android↔桌面 WebRTC DataChannel 直连

> Plan A v5.0.3.52 真机 e2e 暴露 5 个 reliability bug，其中 1 个是**架构性**：signaling 4 跳链路（手机 → 路由器 → 中继 → 桌面 RelayClient）任一跳被 NAT idle / 蜂窝运营商间歇杀 TCP 即整体失败。Plan A.1 治本：稳态命令 + stdout/exit 推送从 4 跳 signaling 切到 1 跳 WebRTC DataChannel 直连，绕开中继 + NAT idle，p50 RTT 200-500ms → 30-80ms。失败 silent fallback signaling，保留兜底。

**核心改动**（详细 entry 见根 `CHANGELOG.md`）：

- **Phase 1** Trap 1 修复 + `dataChannelReady` derived StateFlow（治三方互覆盖 `setOnForwardedMessageReceived` 单 callback 的 latent bug，让 ice:config 拦截不再被偷走）
- **Phase 2** `SignalingRpcClient.invoke` DC fast path + 双 listener pending pool；DC 抛异常或未 ready 自动 fallback signaling LAN+relay 双发既有路径
- **Phase 3** TerminalListScreen 进入时触发 WebRTC handshake + UI chip 实时显示 "P2P 直连 / 中继路径"
- **Phase 4** TerminalRpc 双订 `forwardedMessages + webRTCClient.messages` + (sessionId, seq) 反向 LRU 去重；桌面 `mobile-bridge.bridgeToLibp2p` 加 reqId LRU dedup 防 PtyManager 双执行
- **Phase 5** 零新代码：DC 失效 fallback + 自动重建是 Phase 2 + P2PClient 既有 `scheduleReconnect` 的免费副产品

**Plan A 真机 e2e 临门 sweep 的 4 个 bug**（53 一起带版）：APK 中文 GBK 乱码 / 每次 invoke 新 peerId 让 server cleanup 误杀 / OkHttp pingInterval 太短 / WS reconnect 不自动 re-register。

**真机 e2e §5.3 矩阵移交用户**：Xiaomi 24115RA8EC × 桌面 Windows dev — 5 场景（LAN / 蜂窝 / 双 NAT / DC 失效 / DC 恢复）。

详细设计：`docs/design/Android_Remote_Terminal_Plan_A1.md` v1.0（一日 7 commit 完成 Phase 1-5）。

---

## [v5.0.3.52] - 2026-05-14 — Plan A 远程终端：Android↔桌面 PTY 全链路

> 用户痛点："PC 上开了很多终端，能不能在 Android 上看到这些终端的输出并远程输入指令？"  
> 硬约束：Windows 上已经在跑的外部终端不能被另一进程 attach（OS 句柄私有）。  
> 落地：方案 A — ChainlessChain 桌面端用 `node-pty` 托管新开终端，复用 #21 Remote Operate signaling-relay 通道把 stdin/stdout 流到 Android。

### Added — Plan A Phase 1 – 4 全部落地

- **桌面主进程** — `PtyManager`（lazy node-pty + 256KB ring buffer + 24h idle kill + shell 白名单 `pwsh/cmd/bash/wsl` + 8 session 上限）+ `RingBuffer`（byte-aware FIFO）+ `terminal-handlers.js`（8 个 WS topics：create/list/stdin/resize/close/history + server-push stdout/exit）+ `terminal-ipc.js`（V6 native IPC bridge）+ `confirmation-dialog.js`（高危关键字 systray 弹窗 + 永久信任）。`startWebShell` 接 `ptyManager` + `terminalRequireConfirmation`；`handleMobileCommand` 加 `terminal.*` namespace + mobile-bridge stdout/exit fanout（per-peer subscription map）。
- **共享 helper** — `packages/cli/src/gateways/ws/topic-handler-attachment.js` 抽出 `ws-cli-loader` 的 dispatcher 包装为 ESM helper；cc ui 的 `agent-runtime.startUiServer` 调一遍 → cc ui 也能 `/terminal`。
- **Web Panel** — `useTerminal` composable（singleton fan-out via module-level sub map，base64↔UTF-8 编解码）+ `Terminal.vue` route `/terminal`（xterm.js lazy import + 多 session 标签 + history 补帧 + ResizeObserver + 高危关键字拦截 toast）+ 侧栏菜单 + i18n。
- **V6 plugin widget** — `plugins-builtin/terminal/plugin.json` + `shell/widgets/TerminalWidget.vue` + `shell/TerminalPanel.vue`（xterm.js 嵌入 + IPC bridge `electronAPI.terminal.*`）+ slash 命令 `/terminal`。
- **Android** — `TerminalRpcClient.kt`（复用 `SignalingRpcClient` envelope pattern + observeStdout/observeExit SharedFlow）+ `TerminalWebView.kt`（WebView ↔ Kotlin JS bridge）+ `xterm-shell.html` + xterm.js / addon-fit / xterm.css vendored 入 `assets/terminal/` + `TerminalListScreen` / `TerminalSessionScreen` Compose + softkey toolbar（Ctrl/Tab/Esc/方向/Ctrl+C/D）+ NavGraph 2 路由 + `RemoteOperateScreen` 加 "打开远程终端" 按钮。
- **设计文档** + 用户文档 — `docs/design/Android_Remote_Terminal_Plan_A.md` + `docs-site/docs/guide/remote-terminal.md`（双站同步）。

### Tests — 162 新增，全绿

- Desktop main process: 61 测（RingBuffer 7 + PtyManager 15 + terminal-handlers 15 + terminal-ipc 12 + confirmation-dialog 5 + ws-smoke integration 6 + **real PTY spawn cmd.exe integration 1**）
- CLI cc ui: 21 测（PtyManager 10 + handlers 8 + ws-mirror-smoke 3）
- Web Panel: 17 测 useTerminal composable + **3 e2e**（real `cc ui` subprocess + real WebSocket + real shell stdin/stdout round-trip）
- Android: 10 测 `TerminalRpcClientTest`（happy / list / stdin / resize / close / history / stdout fan-out / exit fan-out / idempotent start / non-terminal events）

### Fixed — pre-existing test drift swept by full suite run

- `docs-site/scripts/sync-design-docs.js` + `docs-site-design/scripts/sync-docs.js` ROOT_FILE_MAP 各加 `Android_Remote_Terminal_Plan_A.md` 映射，双站同步 149 文件
- `desktop-app-vue` `widget-registry.test.ts` 期望 5 个 widget id，PREVIEW_WIDGETS 已扩到 7（`bridge-mtc` + `federation-governance` 此前漏更新）
- `web-panel` `dashboard-store.test.js` 没 mock `mcp.list_tools` 的 sendRaw 回应（commit `d9cc41432` 后漂移）
- `web-panel` `views-mount-smoke.test.js` 5 个尾部视图（Projects/VideoEditing/P2P/Memory/Git）在 50+ 文件并行套件下撞 `Notification + Pinia` 跨测试状态污染：Projects 修 i18n title + 其余 4 个拆 `views-mount-smoke-tail.test.js` 独立 worker
- `web-panel` `Projects-folder-picker.test.js` 测试 commit `bfdde637d` 已重构掉的 UI，删除过时测试

---

## [Unreleased] - 2026-05-13 (later) — Android 社交功能产线化（demo → production）

> 14 屏 + 9 ViewModel + 4 Repository 的社交骨架 (~10K LOC) 建好已久，但 NavGraph 只接通 MyQRCode / QRCodeScanner 两路由，其它 7 路由是 `registerPlaceholder("temporarily simplified")`；`SocialScreen` Friends / Timeline 两 tab 显示固定字串；`PostRepository.reportPost` 构造完 entity 不入库；`FriendRepository.searchUserByDid` 非本地 DID 返回 null。本次一次性收口，**不 bump version**。

### Added

- **NavGraph 7 占位换实屏 + 2 新路由** —— `PublishPost / PostDetail / FriendDetail / UserProfile / AddFriend / CommentDetail / EditPost` 全部接 Composable；新增 `NotificationCenter` / `BlockedUsers` 两路由（前者作为 deep-link target，后者由 `FriendListScreen` 新加 dropdown 入口可达）。DID 文档加载期渲染 `CircularProgressIndicator` 占位。
- **`SocialScreen.kt` 三 tab 升级** —— Friends → `FriendListScreen`（保留 P2P chat 入口 CTA）；Timeline → `TimelineScreen`，myDid 走 `DIDViewModel.didDocument`；Notifications → `NotificationCenterScreen`（带筛选 / 批量已读 / 清理菜单）。
- **`PostReportDao` 落地** —— entity 早在 schema v23 在册，但 DAO 一直缺。新建 DAO（去重 + status 流转 + 7 个查询/更新方法）+ 注册到数据库 + Hilt `@Provides`。`PostRepository.reportPost()` 改走 DAO 入库 + `(postId, reporterDid)` idempotent；`getUserReports()` 走 DAO 查询不再 hardcode 空。
- **PROFILE_QUERY / RESPONSE 协议** —— 2 新 `MessageType` + `SelfProfileProvider` 接口 + `SelfProfileSnapshot` data class。`RealtimeEventManager.queryProfile(targetDid, 5s timeout)` 用 `onSubscription` 解 SharedFlow replay=0 订阅竞态。`DefaultSelfProfileProvider`（DID 末 8 位占位昵称，与现 `MyQRCodeViewModel` 同规则）在 `ChainlessChainApplication.delayedInit` 注入。`FriendRepository.searchUserByDid()` 本地未命中即 fallback。
- **`BlockedUsersScreen` 接 ViewModel** —— `FriendViewModel` 注入 `DIDManager`、加 `loadBlockedUsers()` + `unblockFriend` 走完整 `unblockUser(myDid, did)` 路径（清 `BlockedUserEntity` 行）。

### Tests — 39 new, all green

- Unit (core-p2p) `RealtimeEventManagerProfileQueryTest` 6
- Unit (feature-p2p) `Post/Friend/FriendViewModel/DefaultSelfProfile` 14
- Integration (core-database) `PostReportDaoTest` Robolectric + in-memory Room 8
- Regression (app) `SocialRouteRegressionTest / SocialScreenTabRegressionTest` 11

**学习——race-fix**：`queryProfile resolves` 测试用 `runTest` 跑挂——manager 内部 scope 用 `Dispatchers.IO` 与 virtual-time TestDispatcher 不在同图，2s timeout 在 virtual 时间瞬时跳完，IO 协程没来得及处理就 fail。改 `runBlocking + withTimeout(10_000)` 后过。

[详细设计文档 →](/design/Android_Social_Wiring_2026-05)

---

## [Unreleased] - 2026-05-13 — v1.2 GA 反馈整合：P0 前置 + project workflow + 11 daily templates + 6 bug fix ([#21](https://github.com/chainlesschain/chainlesschain/issues/21))

> 本批分两阶段。**阶段 1** (v1.2 GA 上架前)：A.3 ADR review / B.6 PQC 严格模式 verifier / B.2 削 web-shell `/multisig` cc subprocess 冷启三项 GA-independent + AI-3 forward-compat seam + 2 相关 bug fix。**阶段 2** (v1.2 GA 反馈到位)：5+3 反馈整合 #2 (删除 bug) / #3 (模板改日常 11 个) / #4-#7 (桌面↔手机项目工作流: CLI + REMOTE handler + 双向 sync walker) / #8 (web-shell 项目菜单 + 双端一致 view) 落地 P1+P2+P3 Part A。**version 不 bump** —— v1.2 GA 反馈仍在收集中, 与未来 P1 主体一起 release。

### Added — v1.2 GA 反馈整合 5+3 项 ([#21](https://github.com/chainlesschain/chainlesschain/issues/21) #2/#3/#4/#5/#7/#8)

- **#2 项目无法删除 fix** (commit `fc24f9856`) —— `ProjectScreen.kt::EnhancedProjectCard` 完全没有 delete UI（feature-project/.../ProjectListScreen.kt delete 代码是死代码未连入 NavGraph）。加 3-dot 菜单 + AlertDialog 确认 → DAO softDelete → Room Flow 自动从列表移除。
- **#3 项目模板改日常 11 个** (commit `99d38bf69`) —— 砍掉 11 IDE 模板 (Android/React/Spring/Flutter 等)，整个 `ProjectTemplates` 重写为日常生活模板：购物清单 / 旅行计划 / 读书笔记 / 灵感收集 / 健身计划 / 食谱记录 / 学习计划 / 家庭账本 / 工作日志 / 会议记录 / 空白。`TemplateCategory` 加 5 个新类目 (DAILY/TRAVEL/STUDY/HEALTH/FINANCE)。
- **#4/#7 桌面 CLI + REMOTE handler P1** (commit `32ccabdb5`) —— `cc project init/list/show/delete` 4 subcommands 直写 desktop chainlesschain.db (WAL 并发安全)。`project-management-handler.js` 暴露 6 actions 给 Android L3 REMOTE 调用，复用 desktop DatabaseManager。CLI 7 + handler 21 unit tests。
- **#4 Android→Desktop 反向 sync P2** (commit `2646bbb4e`) —— 修补 audit 发现的反向同步缺口 (SocialSyncWalker 不含 projects 表)。新增 `ProjectSyncWalker` (feature-project) + `CompositeSyncRepositoryWalker` (`:app` 聚合 Social + Project) + `SyncWalkerModule` (Hilt 绑定)。CREATE/UPDATE/DELETE op mapping 完整。
- **#5/#8 web-shell Projects view + in-process WS P3 Part A** (commit `bfdde637d`) —— 6 in-process WS topics 包装 P1 ProjectManagementHandler (DRY: 同一 handler 同时服务 web-shell + mobile L3 REMOTE)。新 `Projects.vue` 项目管理列表 (stats + filter + Detail drawer + Create modal)，`useShellMode().isEmbedded` 分发 in-process vs subprocess。原 Projects.vue 内容保留为 `ProjectInit.vue` (`/project-init`)。

### Fixed

- **wear test imports** (commit `c0d061328`) —— `CcPhoneDecisionListenerTest.kt` 缺 4 `kotlinx.coroutines` imports block 整个 `:app:compileDebugUnitTestKotlin`，加 imports 解锁。
- **B.6 strict mode disk-load gate** (P0 sweep) —— `LandmarkCache.loadFromDisk()` bypass strict-mode gate；per-snapshot 严格检查移到 `_validateAndStoreSnapshot()` 头部，+2 disk-load integration tests 锁回归。
- **feature-project pre-existing kotlin.test imports** (P2 sweep) —— 5 文件用 `kotlin.test.*` 但 deps 无；改 `org.junit.Assert.*` 解锁 `:feature-project:compileDebugUnitTestKotlin`。

### Tests

阶段 1 (P0)：
- `landmark-cache-strict-pq-mode.test.js` 11/11
- `multisig-handlers.test.js` 23/23
- `ManifestSignatureVerifierTest.kt` 10/10 + regression `SkillMetadataTest` 9/9 + `RemoteSkillRegistryTest` 38/38

阶段 2 (project workflow)：
- `project-management-handler.test.js` 21/21 (P1 desktop handler)
- `project-cli.test.js` 7/7 (P1 CLI integration via sql.js WASM)
- `ProjectSyncWalkerTest.kt` 12 tests (P2 — pending CI, 本地 feature-project pre-existing test failures 不相关)
- `CompositeSyncRepositoryWalkerTest.kt` 7/7 (P2 :app aggregate)
- `project-handlers.test.js` 7/7 (P3A web-shell wrapper)
- Android `:app:testDebugUnitTest` regression **80/80**
- Desktop combined **51/51**

## [Unreleased-Phase1-Legacy] - 2026-05-13 — Android v1.3+ P0 前置三项 GA-independent + AI-3 forward-compat + 2 bug fix（已并入上方 Unreleased 主条目）

### Added — [#21](https://github.com/chainlesschain/chainlesschain/issues/21) P0 前置三项

- **A.3 ADR Review v2.0**（commit `348896382`）—— 新增 [`Android_ADR_重评估_v2.0.md`](./design/android-adr-review-v2.md) v1.0；8 ADR audit 结论 **5 keep / 2 amend / 1 revise**：ADR-2 (M2 DID wallet 走软件 Ed25519，blocks B.3 DID rotate) 待 v1.2 GA Play Console API level 数据决策选项 A/B/C；ADR-7 / ADR-8 文本 amend 落 §4 对齐真实（cc-mobile.json 从未创建，registry 实际 disk-first + push-based 非 pull）。同 commit §10 v1.3+ scope triage 分层（12 子项 P0/P1/P2 + 5 依赖链）。
- **B.6 PQC 严格模式 verifier gate**（commit `e24386d00`）—— `packages/core-mtc/lib/landmark-cache.js` 加 `strictPqMode` opt-in flag + 两层 gate (`_assertStrictPqMode` landmark-level / `_assertStrictPqModeForSnapshot` per-snap) + `STRICT_PQ_MODE_VIOLATION` error code + `CLASSICAL_ALGS` 常量 + `isClassicalAlg` helper。Reading A 语义：拒收任何 `alg === "Ed25519"` 的 partial sig + publisher_signature；与现 heterogeneous federation 数据格式兼容，0 schema 改动；生产者侧 0 改动。
- **B.2 in-process multisig.* + marketplace.consume topics**（commit `b1c7cfd95` + label fix `c21ba9346`）—— `desktop-app-vue/src/main/web-shell/handlers/multisig-handlers.js` 新增 7 个 in-process WS topics 镜像 CLI `--json` 输出 shape：`multisig.list / show / policy.show / cancel / finalize / sweep` + `marketplace.consume`。Topics 调 `openMultisigManager()` from CLI `multisig-runtime.js`（per-call open SQLite WAL ~20ms），dynamic-import 跨 CJS/ESM 边界。`Multisig.vue` 加 `callMultisigTopic()` helper 用 `useShellMode().isEmbedded` 分发；7 处 `ws.executeJson` 全切；非 embedded（cc serve）保留原 subprocess fallback。**性能：asar:true 子进程冷启 6-10s → in-process ~20ms (SQLite open) + 查询，60-100× 提升**。UX 0 改动。
- **A.3 AI-3 SkillMetadata.signature forward-compat**（commit `45a88270e`）—— Android Kotlin。新增 `ManifestSignatureVerifier.kt`：`interface` + sealed `VerificationResult.{Accepted | Rejected(reason)}` + `object NoOpManifestVerifier` always-accept stub。`SkillMetadata.kt` 加 `signature: String? = null` field + init invariant。`RemoteSkillRegistry.kt` 加 `@Volatile manifestVerifier` + `setManifestVerifier(v)` swap seam + `updateFromRemote()` per-skill 验签 partial-acceptance + empty-result 短路。Marketplace M0 (#21 AI-5) 上线时注入真 Ed25519/SLH-DSA hybrid verifier 即可，调用方 0 改动。

### Fixed

- **wear test imports**（commit `c0d061328`）—— `CcPhoneDecisionListenerTest.kt` 自 `cc08da0b0` (v1.2 #20 P0.2) 起用 `kotlinx.coroutines.GlobalScope.launch { delay() }` 写 smoke 测试，但 imports 缺 `launch`/`delay`/`GlobalScope`/`DelicateCoroutinesApi`。block 了整个 `:app:compileDebugUnitTestKotlin`，加 4 imports 解锁。
- **B.6 strict mode disk-load gate**（test-driven 发现于本次 QA sweep）—— `LandmarkCache.loadFromDisk()` 直接调 `_validateAndStoreSnapshot()` bypassing ingest's strict-mode gate；strict mode OFF 写入磁盘的 Ed25519 landmark，下次 strict mode ON 加载时仍接受（silent invariant 违反）。修：per-snapshot 严格检查移到 `_validateAndStoreSnapshot()` 头部统一处理，+2 新 disk-load integration tests 锁回归。

### Tests

- **`landmark-cache-strict-pq-mode.test.js`** 11/11 pass（9 原 + 2 disk-load integration）
- **`multisig-handlers.test.js`** 23/23 pass（B.2 unit tests via `runtimeFactory` 注入 seam）
- **`ManifestSignatureVerifierTest.kt`** 10/10 + `SkillMetadataTest` 9/9 + `RemoteSkillRegistryTest` 38/38 regression 全过（本地 NDK install 修复后 `./gradlew :app:testDebugUnitTest` 2m21s 全绿）
- **web-shell** 379 regression 全过（25 test files）

## [5.0.3.49 / CLI 0.161.9 / Android 1.0.0 GA] - 2026-05-12 (M-of-N multisig Phase 1d + Phase 2a marketplace mediator + Phase 2b web-panel multisig view + Flow B QR pairing 收口 + 测试补丁)

> 本版四条主线：(1) **`@chainlesschain/core-multisig` package + `cc multisig` CLI 落地**（commit `3c890dcac`，v1.2 m-of-n Phase 1d）—— Phase 1 完整 5-lib：policy / store / proposals / signing / governance-log；CLI 8 subcommands propose / sign / cancel / finalize / list / show / sweep / policy；75 lib 单测 + 10 CLI integration 测试全过。(2) **Phase 2a marketplace.purchase mediator**（commit `2755093d0`）—— 设计文档 §6.1 落地：`cc marketplace purchase` 大额（≥¥1000）自动走 M-of-N 多签 propose，小额走 direct execute；`cc marketplace consume` 在 threshold 达成后 finalize + 执行业务操作；抽 `multisig-runtime.js` 共享 SQLite cascade（-130 行 dedup，Phase 1 10/10 零行为变更）；8 新 E2E 测试全过。marketplace.purchase / did.rotate / 跨链 bridge 三大典型 domain 由此解锁，marketplace.purchase 是第一个真实接通业务侧的 mediator。(3) **Phase 2b web-panel Multisig 视图落地**（commit `c758492d9`）—— 设计文档 §8.1 落地：web-shell（默认桌面入口）加 M-of-N 多签查看 / 操作面板，Phase 1 CLI 的 `cc multisig list/show/cancel` + `cc marketplace consume` 通过 `ws.executeJson(...)` 走 CLI 子进程；同份 SPA 在 desktop web-shell + cc ui 两边都自动可用（per memory `feedback_cross_shell_feature_pattern`）。(4) **Android v1.1 W3.7 Flow B QR pairing 落地**（commit `c47cbc649`）—— desktop 显 QR / phone 扫的主流应用通用 UX，Xiaomi 24115RA8EC 真机 E2E verified。同时把 Flow B 漏掉的 2 个测试文件补齐：ScanDesktopPairingViewModelTest 10 项 + desktop-pair-handlers.test.js 19 项。

### Added — M-of-N multisig core（v1.2 #20 P0.3 Phase 1d）

- **`@chainlesschain/core-multisig` package**（commit `3c890dcac`）—— 新建 npm workspace package：
  - `lib/policy.js` —— 域级 policy `{m, n, members[], requirePqc, defaultExpiryMs}` validate + normalize
  - `lib/store.js` —— SQLite schema (proposals / signatures / policies 3 表) + 5 操作 helper
  - `lib/proposals.js` —— 状态机 propose / sign / cancel / finalize / expireStale；`pending → reached → consumed` + `cancelled` / `expired` terminal
  - `lib/signing.js` —— JCS canonicalize + DOMAIN_PREFIX `"MULTISIG:"` 防回放 + Ed25519 / SLH-DSA dispatcher + verifyThreshold strip-all-sigs
  - `lib/governance-log.js` —— append-only JSON Lines 审计 log，每态转捕 proposed / signed / reached / consumed / cancelled / expired / expired_sweep
  - 75 单测（policy 14 + signing 21 + proposals 20 + store 12 + governance-log 8）全过
- **`cc multisig` CLI 8 subcommands**（commit `3c890dcac`）—— `propose <domain> --payload-file --initiator --key` / `sign <id> --signer --key` / `cancel <id> --reason` / `finalize <id>` / `list [--state --domain --limit]` / `show <id>` / `sweep` / `policy {set, show}`；全 `--json` 输出。
- **SQLite driver cascade native → WASM**（per memory `feedback_sqlite_wasm_fallback`）—— `better-sqlite3-multiple-ciphers` / `better-sqlite3` 失败时自动降级 `sql.js` (WASM)，CLI 跨平台开箱即用。
- **跨包 dep 注入** —— `cli/package.json` 加 `@chainlesschain/core-multisig: 0.1.0`；`cli/src/index.js` 注册 `registerMultisigCommand(program)`。
- **测试基础修复 3 项**：
  - `core-multisig vitest.config.js` 设 `globals: true`，避免 vitest 4 拒绝 CJS `require("vitest")`（memory `cli_ci_sharding_lessons`）
  - 5 个 test 文件改 ESM `import { describe, ... } from "vitest"` 头
  - `multisig-cli.test.js` import 路径修：`@chainlesschain/core-mtc/signers/ed25519.js` → 去 `.js` 后缀（core-mtc exports key 是 `./signers/ed25519` 无后缀）
- 10/10 CLI integration tests pass（包括 help / policy roundtrip / propose / sign / cancel / finalize / list / show / sweep / 错误路径）。

### Added — Phase 2a marketplace.purchase mediator（v1.2 #20 P0.3 Phase 2）

- **共享运行时抽取** `packages/cli/src/lib/multisig-runtime.js`（commit `2755093d0`，新文件）—— Phase 1 commands/multisig.js 内联的 SQLite cascade（better-sqlite3-multiple-ciphers → better-sqlite3 → sql.js）+ manager loader 抽出公共模块，让 commands/marketplace.js 复用同一份；`readSecretKey` / `readJsonArg` helpers 同。
- **commands/multisig.js refactor**（commit `2755093d0`）—— 用 `multisig-runtime.js` 替代内联 `_openManager` / `_openDatabase` / `_adaptSqlJs` / `_readKey` / `_readJsonArg`，−130 行 deduplication。Phase 1 10/10 integration test 全 green，零行为变更。
- **`cc marketplace purchase <itemId>` 新 subcommand**（commit `2755093d0`）—— `--amount-fen N --buyer <did> --key <hex> [--threshold-fen N] [--item-name <name>]`：amount < threshold（default `LARGE_PURCHASE_THRESHOLD_FEN = 100_000` fen = ¥1000）走 direct path（CLI stub 打印 "purchased"，无真支付处理器）；amount ≥ threshold 必须有 `marketplace.purchase` 域 policy，否则 exit 2 `no_policy`；有 policy 调 `mgr.propose` 返 proposalId 让其他签名方加签。
- **`cc marketplace consume <proposalId>` 新 subcommand**（commit `2755093d0`）—— 校验 `domain == "marketplace.purchase"` + `state == "reached"` 才执行；finalize 后打印订单 payload + governance log 写 `consumed` 事件。错域 / 错态都 exit 2。
- **`LARGE_PURCHASE_THRESHOLD_FEN` export**（100,000 fen = ¥1000）—— 业务侧 + CLI 共享门槛常量。
- **8 新 E2E test 全 green**（`packages/cli/__tests__/integration/marketplace-multisig-e2e.test.js`）：(1) 大额 ¥1500 2-of-2 全 walkthrough：policy set → purchase 创 proposal → 2 个签名方各 sign → reached → consume → finalize → governance.log 4 类事件 (`proposed` / `signed×2` / `reached` / `consumed`)；(2) 小额 ¥500 走 direct path 不创 proposal；(3) `--threshold-fen` override 覆盖默认；(4) 大额无 policy → exit 2 blocked；(5) consume pending proposal → exit 2 `proposal_state_pending`；(6) consume 错域 proposal → exit 2 `wrong_domain`；(7) `--help` 文本验证。
- 总 18 multisig integration test 全 green（Phase 1 10 + Phase 2 8）。

### Added — Phase 2b web-panel Multisig 视图（v1.2 #20 P0.3 Phase 2b）

- **`packages/web-panel/src/views/Multisig.vue`**（commit `c758492d9`，新文件 468 行）—— 设计文档 §8.1 落地：
  - 6-card 顶部 stats —— 总提案 / 待签 (pending) / 已达阈值 (reached) / 已执行 (consumed) / 已取消 (cancelled) / 已过期 (expired)，各带 Ant icon + 色彩 token
  - 两个 tab —— **提案列表**：表格 columns（ID / Domain / State / Sigs / Created / Expires / Actions）+ state 过滤器（pending / reached / consumed / cancelled / expired）+ domain 过滤；行 actions：详情 / 取消 / 执行购买（marketplace.purchase reached only）。**域策略**：列已知 domain（marketplace.purchase / did.rotate / crosschain.outbound）的 policy 详情 + 成员展开
  - Detail drawer (640px) —— Descriptions 显 domain / state / threshold / sigs / initiator / timestamps / payload (JSON pretty) + 签名列表（signer DID + alg + 时间）+ 操作按钮：取消（pending|reached）/ 执行购买（marketplace.purchase reached）/ finalize（其他 reached）
  - info Alert 提示 "web shell 不持私钥，sign 操作走 CLI"
  - 顶部操作栏：刷新 + 扫过期（调 `cc multisig sweep`）
- **`packages/web-panel/src/router/index.js`**（commit `c758492d9`）—— 加 `{ path: 'multisig', name: 'Multisig', component: () => import('@/views/Multisig.vue') }` 路由。
- **`packages/web-panel/src/components/AppLayout.vue`**（commit `c758492d9`）—— security/audit 组加 multisig menu item（TeamOutlined icon）；折叠模式（右侧）同步加 multisig 入口；i18n fallback "M-of-N 多签" — `appLayout.items.multisig` 未配时显示中文。
- **WS 通信走 CLI 子进程** —— `ws.executeJson('multisig list --json')` 等通过 CLI WS server `_executeCommand` 路径。第一次冷启动 6-10s（asar:true 开销，per `mtc-status-handlers.js` comment）— Phase 2 可接受；Phase 3 follow-up 可加 in-process WS handlers (`multisig.list` / `multisig.show` / ...) 削延迟。
- **Phase 3 留 follow-up**：私钥签名 UI（需 Unified KeyStore 接通）、in-process WS handlers（现走 cc subprocess）、实时推送（现 onMounted 拉取一次无 WS 订阅）、Marketplace.vue 集成入口（purchase modal 直接进 multisig 流程）。

### Added — Android v1.1 W3.7 Flow B QR pairing（issue #19）

- **Mobile 端扫描桌面 QR 完整链路**（commit `c47cbc649`）—— Phone 摄像头扫桌面屏幕 QR 比反向（desktop webcam 扫小手机屏）识别率高得多，主流应用（微信、支付宝、Discord、WhatsApp Web）通用 UX 模式。9 项实战坑（memory `desktop_qr_pairing_flow_b.md` 全记）：`<a-qrcode>` 必须显式 async-register / `parseJsonOutput` log-prefix vs JSON-array regex / `mobileBridge.peerId` 必须 `this.` / social `QRCodeScannerViewModel` 校验 reject 非好友 QR / pair-ack 拦截在 bridgeToLibp2p 前 / in-memory ack vs CLI 写 DB 双轨 / 跨模块 DI / adb reverse 无域名 E2E / Flow B QR 字段含 `pcPeerId`。
- **跨模块 DI**：`PairingSignalingGate.sendAck` interface 落 `:core-p2p` 避免 `:feature-p2p` 反依赖 `:app`；`WebSocketPairingSignalingGate.sendAck` 实现在 `:app` 内 `ensureRegistered + Mutex` 串行化。`WebRTCClient.SignalClient.sendForwardedMessage(toPeerId, payload)` 桥接 mobile 端的 signaling forward。
- **Mobile 端 UI** `ScanDesktopPairingScreen` + `ScanDesktopPairingViewModel`：用非-social `QRCodeScannerScreen`（ZXing 透传，social variant 校验 reject 我们的 desktop-pairing JSON）；NavGraph + SettingsScreen 加"扫描桌面 QR"入口（推荐路径）。
- **Desktop 端 WS topics 三件套** `desktop-pair-handlers.js`：`desktop.pair.generate-qr`（生成 6 位 code + payload + pcPeerId 三段 fallback：mobileBridge.peerId → deviceManager.getCurrentDevice → "desktop-unknown"）/ `desktop.pair.poll-ack`（idle / waiting / acked / expired 四态）/ `desktop.pair.reset`；`mobile-bridge.js` 加 `this.peerId` 持久化 + 拦截 `type=pair-ack` 经 `recordPairAck` 匹配 + 写 SQLite paired_devices。
- **Vue UI** `MobileBridge.vue` Flow B tab（默认）+ Flow A + 手输 3-tab；`antd.js` 注册 `AQrcode`（ant-design-vue qrcode 异步加载）。
- **真机 E2E verified**：Xiaomi 24115RA8EC desktop QR → ML Kit 扫 → signaling pair-ack → desktop mobileBridge 拦截 → recordPairAck 匹配 → CLI `pair-from-qr` 写 SQLite → Vue 列表刷新。

### Added — 单元测试补丁

- **`ScanDesktopPairingViewModelTest.kt`** (新增，10 测试)：初始 Scanning 态 / 合法 QR → Sending → Success + ack payload 字段验证 / type 错 → Failed / code 非 6 位 → Failed / pcPeerId blank → Failed / timestamp > 5min → Failed / 无 DID → Failed / signaling gate 失败 → Failed + 错误信息透传 / retry 重置态 / 重复扫描 idempotent / malformed JSON → Failed。MockK + StandardTestDispatcher + FakeGate 捕获 sendAckCallCount 验。
- **`desktop-pair-handlers.test.js`** (新增，19 测试)：`generate-qr` 6 case（bridge 缺/null throw、peerId happy path、deviceManager fallback、desktop-unknown fallback、regenerate 覆盖前 session）/ `poll-ack` 4 case（idle / waiting / acked / expired with `vi.useFakeTimers`）/ `reset` 1 case / `recordPairAck` 4 case（无 session drop、code mismatch drop、缺 pairingCode drop、match + receivedAt timestamp）。
- **Android `:feature-p2p:testDebugUnitTest` 41s 全绿** 含新 `ScanDesktopPairingViewModelTest` + existing `DesktopPairingViewModelTest`（commit 时同步改 sendAck signature）+ MessageQueueViewModelTest + P2PChatViewModelTest + P2PDeviceViewModelTest。
- **Desktop 3 文件 / 45 测试全绿** 含新 `desktop-pair-handlers.test.js` + `mobile-pair-handlers.test.js` + `web-shell-bootstrap.test.js`。

### Distribution

- 桌面 binary：v5.0.3.48 → v5.0.3.49 重打（含 Flow B + multisig 新代码；auto-updater 比对 `5.0.3-alpha.49 > 5.0.3-alpha.48`）
- `chainlesschain` npm 0.161.8 → 0.161.9（cli 加 multisig command + dep `@chainlesschain/core-multisig`）
- Android：versionCode/Name 不变（1.0.0 GA 维持），Flow B 走桌面端首发；后续 Android v1.1 minor release 一并 ship 完整移动客户端
- 三大文档站本次同步刷新：docs-site / docs-site-design / docs-website-v2 tagline 升 v5.0.3.49 + 加本节 changelog；CHANGELOG.md + README.md / README_EN.md 同步

## [5.0.3.48 / CLI 0.161.8 / Android 1.0.0 GA] - 2026-05-12 (Android M3 capture suite 5/5 code + M4 RemoteSkillRegistry method-level + ApprovalUI 4-category + ProgressViewer + alias 兼容窗口 + **Android M7 GA flip versionCode 37 → 100 / versionName 0.37.0 → 1.0.0**)

> Android v1.0 RFC M3 + M4 收尾批次（7 commit / 187 新单测）+ **Android M7 GA flip 一并落地（commit `ffe722162`，versionCode 37 → 100，versionName 0.37.0 → 1.0.0）**。把设计文档 §5.3 L2 捕获五件套补齐到代码层（VoiceMode / CameraOCR / LocationTagger / SharePayloadFlusher / PushNotifier）+ §6 M4 D1 RemoteSkillRegistry method-level 元数据 + §5.4 ApprovalUI 4-category 适配 + ProgressViewer 长时任务面板 + §8.3 alias 兼容窗口。Android 总单测 196+ → 383+。无桌面 / CLI 源码改动，CLI npm 0.161.7 → 0.161.8（force publish 走 release.yml 同步轨道）。Android v1.0 GA 仍待用户出场（4 项）：M3 真机 E2E / M4 D2 真机 / FCM 凭证 / M6 性能实测。

### Added — Android M3 capture suite (5/5 code)

- **VoiceMode 连续语音串联**（commit `47bebed80`）—— ASR → REMOTE chat → TTS pipeline 在 home 入口串通。
- **CameraOCR 拍照入 KB 流水线**（commit `a69269ced`）—— `ai.ocrImage` + `knowledge.createNote` 走完，自动写 OCR 元数据。
- **LocationTagger Play Services FusedLocationProvider + Foreground Service**（commit `3f5ac8647`）—— GPS 数据进 `createNote.metadata`，前台服务保证后台采集合规。
- **SharePayloadFlusher 接 SyncCoordinator → knowledge.createNote**（commit `3d1a6e3a8`）—— 5 种 SharePayload（Text / Url / SingleImage / MultiImage / GenericFile）转 note 字段；SyncCoordinator 30s push 循环末尾 `drain` SharedInboxRepository，失败 re-enqueue。19 新单测。
- **PushNotifier 本地通道 + FCM 骨架**（commit `c0d990c91`）—— 4 NotificationChannel（Cowork DEFAULT / Marketplace HIGH / SystemAlert DEFAULT / ShareInbox LOW）+ 协议中立 `CcPushNotificationService` 入口；google-services.json 真接入按 `android-app/docs/M3_FCM_SETUP.md` 5 步（用户出场）。36 新单测。

### Added — Android M4 收尾

- **RemoteSkillRegistry method-level 元数据补全**（commit `6e49270fd`）—— `MethodMetadata`（name / paramCount / riskOverride / requiresApprovalOverride）+ `listMethods` / `getMethod` / `requiresApprovalForMethod` / `riskForMethod` accessor；`knowledge.*` + `ai.*` 各 10 methods seeded（8 riskOverride 演示）；其他 21 namespace pending 桌面 `mobile-skill-whitelist` 下发。16 新单测。
- **ApprovalUI 4 category 适配**（commit `f4f83cc67`）—— `ApprovalCategory` enum {Sign / Cowork / Marketplace / SystemCritical} + `fromMethod` 推断；`AndroidApprovalGate` 4-arg overload 透传 category（旧 3-arg 自动 forward）；Dialog 按 category 切 icon / tint / title / footer。9 新单测。
- **ProgressViewer 长时任务面板**（commit `f4f83cc67`）—— `LongTaskRegistry` `@Singleton` `MutableStateFlow<List<LongRunningTask>>`（Pending / Running / Completed / Failed / Cancelled，MAX_TASKS=100 滑窗）+ `TaskProgressCommandRouter` 接 `task.*` reverse-RPC（update / complete / fail / cancel / remove）+ Compose `ProgressViewerScreen`（StatusChip + Linear / indeterminate Circular + dismiss / clear-terminal）。34 新单测（15 + 19）。
- **§8.3 RemoteSkillRegistry alias 兼容窗口**（commit `0bc8e2797`）—— `SkillMetadata.aliases: List<String>` + 内部 `aliasIndex` 反查；`get` / `listMethods` / `requiresApproval` / `risk*` 全部经 `resolveAlias` 路径自动解析；新增 `resolveAlias` public API。7 新单测。
- **§8.1 README + v1.0 GA 检查清单**（commits `0bc8e2797` `3da484e9c`）—— `android-app/README.md` M3 (2/5) → (5/5 code)、M4 补 method-level + ApprovalUI + ProgressViewer；新增 `ANDROID_v1_GA_CHECKLIST.md` 列 v1.0 GA 仍待用户出场 5 项。

### Tests

- Android 新增 **187 单测全绿** 跨 14 测试文件。回归覆盖 capture / push / registry / task / approval-category / composite-router 全部新模块。
- Android 总单测 196+ → 383+（M1 0 + M2 68 + M3 130 + M4 152 + M5 33）。
- Desktop store 回归 26 文件 / 773 测 ✓；CLI lib 169 文件 / 7185 测 ✓（确认 Android 工作未污染 desktop / CLI 路径）。

### Distribution

- 桌面 binary：v5.0.3.47 → v5.0.3.48 重打（无桌面源码改动；auto-updater 比对 `5.0.3-alpha.48 > 5.0.3-alpha.47`）
- `chainlesschain` npm 0.161.7 → 0.161.8（CLI 自身 0 源码改动；force publish 走 release.yml 同步轨道）
- **Android：versionCode 37 → 100, versionName 0.37.0 → 1.0.0 GA**（commit `ffe722162`）—— M7 GA flip 与本批 M3/M4 工作一并落地；android-app/CHANGELOG.md 加 [1.0.0] - 2026-05-12 GA entry 汇总 9 commit + 4 项已知限制（FCM 国内 / 单 peer / 离线队列 / QRPairing scaffold）；android-app/README.md 标题切 "🎉 v1.0.0 — GA"。下一步 tag `v1.0.0` 在 commit `ffe722162` 推 gitee+github
- 三大文档站本次同步刷新：tagline 升 v5.0.3.48 + 加本节 changelog

## [5.0.3.47 / CLI 0.161.7 / Android 0.37.0] - 2026-05-11 (Verification release：build-android keystore fix VERIFIED + density splits 14→4 用户侧首落 + outstanding `../` 全扫净)

> 验证型发版。无桌面 / CLI / Android 源码改动，只把 v5.0.3.46 后陆续落的 3 个 release-pipeline 修复在 CI 实跑一遍证明 green。release.yml run #25632845952 全 11 个 job ✓（含 build-android、create-release、publish-cli、finalize-release），4 个 Android assets 入 GitHub Release v5.0.3.47。

### Verified

- **build-android keystore path mismatch（commit `f9a7ba716`）** —— 历史：`49f1440ca` (2026-05-09) 把 `android-app/app/build.gradle.kts:79` 从 `file(...)` 切到 `rootProject.file(...)`，让 `release.storeFile` 路径解析基准从 `:app` 模块改成 rootProject (`android-app/`)。`.github/workflows/release.yml` 的 `release.storeFile=../debug-ci.keystore` 在新基准下错位到 repo root，gradle 在 `<repo-root>/debug-ci.keystore` 找不到 keystore，v5.0.3.46 build-android 因此挂在 `:app:validateSigningRelease`。修法：去掉 workflow 里 `keystore.properties` 内容的 `../` 前缀。v5.0.3.47 build-android job 真绿 verified，4 Android assets 正确入 Release。
- **Density APK splits 用户侧首落（commit `9865c5c08`）** —— v5.0.3.46 已合，但因 build-android 挂没产出，本轮首次用户可见：density × ABI splits 在 Android 5.0+ runtime resource selection 下作用不大，移除后 release asset count 14 → 4（3 APK + 1 AAB），AAB 走 `bundle{}` 块的 density delivery 上 Play Store。
- **剩余 `../` 三处扫净（commit `5a06421cd`）** —— `keystore.properties.template` / `docs/guides/KEYSTORE_SETUP.md` / orphan `android-app/.github/workflows/android-release.yml` 同病一并扫。约定全 repo 统一：`release.storeFile=keystore/<name>.keystore`（无 `../`），物理 keystore 落 `android-app/keystore/<name>.keystore`。

### Distribution

- 桌面 binary 重打 v5.0.3.46 → v5.0.3.47（二进制内容与 v5.0.3.46 等价；auto-updater 比对 `5.0.3-alpha.47 > 5.0.3-alpha.46`，v5.0.3.46 用户重启拿到新 build）
- `chainlesschain` npm 维持 0.161.7（无 CLI 改动，release.yml `cli-tests` job correctly skipped）
- Android：versionCode 37 / versionName 0.37.0 不变（无源码改动），APK 因 density splits 关闭从 14 → 4 个产物
- 三大文档站本次同步刷新：tagline 升 v5.0.3.47 + 加本节 changelog + deploy-all.py tar 路径同步

## [5.0.3.46 / CLI 0.161.7 / Android 0.37.0] - 2026-05-10 (Phase 3d 桌面 ↔ Android 双向同步全套 + Android 七件套 + e2e CI 静默回归洞收口)

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

## [5.0.3.45 / CLI 0.161.7] - 2026-05-09 (cc ui llm.chat parity + 意图理解 opt-in 开关 + 真流式 + Vue Proxy reactivity 修复)

> `cc ui` 终于跟桌面 web-shell 在 LLM 路径上对齐；项目/文件模式聊天默认不再走"理解中…"占位 LLM 调用；`chatStream` 改为真正的 token-by-token 流式；意图卡片 Vue Proxy 引用 bug 修复让占位卡正确翻面。

### Added

- **`cc ui` `llm.chat` WS topic（commit `f41c4b4e2`）** —— 桌面 web-shell 自 `4eaf90137`（Phase 2）就有这个 topic，但 `cc ui`（CLI 的 ws-server）从未注册过。结果：QuickAsk 页面在 `cc ui` 模式下永远卡 60 秒后报 `Stream idle timeout`。新增 `packages/cli/src/gateways/ws/llm-chat-protocol.js`，handler 复用 `chat-core` 的 `streamOllama` / `streamOpenAI` / `streamAnthropic`，按 `<topic>.chunk` + `<topic>.result` 的 frame 协议跟桌面 `llm-handlers.js` 完全对齐。
- **共享 cred 解析（commit `f41c4b4e2`）** —— 新增 `packages/cli/src/gateways/ws/llm-creds.js`：explicit `options` → WS session creds → provider 环境变量（`VOLCENGINE_API_KEY` / `OPENAI_API_KEY` 等）；任何源没拿到都立即返回 `ok:false` 帧，不再 60 秒挂死。`chat-intent-protocol` 同步切到这个 helper，顺手修一个 latent bug：原代码 `session.baseUrl || "http://localhost:11434"` 在 session 没设 baseUrl 时硬编码到 ollama 地址，所有云 provider 在用户本地没起 ollama 时都会跑死。
- **意图理解可见开关（commit `f41c4b4e2`）** —— Chat / Agent 项目/文件模式 header 加 `<a-switch>`，**默认关闭**。原行为：v5.0.3.43 起每条消息先调 LLM 提炼意图（`chat.intent.understand-stream`），再走真发送 —— LLM 慢/无 cred 时占位卡 90 秒；现在默认直发，需要意图卡片的用户手动打开开关（持久化到 `localStorage cc.web-panel.chat.intentEnabled`）。`submitUserInput` 第一行短路：`if (mode === 'global' || !intentEnabled.value) { sendMessage; return }`。桌面壳同享这个 SPA bundle，所以桌面也跟 `cc ui` 行为一致。

### Fixed

- **`chatStream` 真正的 token 流式（commit `35f6e60ea`）** —— `packages/cli/src/lib/chat-core.js` 的 `chatStream` 原本是 buffer 全部 token 后再循环 yield 的伪流式 —— 消费者要等到 LLM 整个回完才看到第一帧。改为 token queue + Promise waiter 模式：onToken push 后立刻 wake generator yield。Chat / Agent / QuickAsk / 意图理解 全部受益。
- **意图占位卡片 Vue Proxy reactivity 修复（commit `a76e451e2`）** —— `submitUserInput` 创建 placeholder 后 push 进 reactive `messages[sessionId]` 会被 wrap 成 Proxy，但本地变量 ref 仍指向 unwrap 之前的 target；后续 `placeholder.metadata.X` 直接改原对象绕过 Proxy `set` trap → 数据更新但不触发重渲染。修法：`card = msgs[msgs.length - 1]` push 后重新取 Proxy 引用，所有后续 mutation 走 `card.metadata.X`。

### Tests

- CLI ws gateway 16/16 绿（chat-intent 6 + 新 llm-chat 9 + 新增"无 cred 不调 LLM"环境清理 1）
- web-panel chat-intent-flow 27/27 绿

### NPM

- `chainlesschain` 0.161.5 → 0.161.6 → **0.161.7**（0.161.6 已先于 productVersion 单独 publish 修复 QuickAsk + Chat 项目模式 hang；0.161.7 带 chatStream 真流式 + 意图卡片 Vue Proxy 修复）

---

## [5.0.3.44 / CLI 0.161.5] - 2026-05-08 (LLM OCR + audit-ipc 覆盖 + chat-intent 90s 兜底)

> 一条 user-visible feature（截图 LLM OCR）+ 三条质量收口。无破坏性变化，所有 v5.0.3.43 用户可直接 upgrade。

### Added

- **截图 OCR 新增 LLM 引擎（commit `39b16e29f`）** —— Tesseract.js 中文识别准确度差，新增 `engine` 参数 `auto`/`llm`/`tesseract` 三态：
  - `auto`（默认）：火山引擎已配置走 doubao 视觉 OCR，否则回落 Tesseract；LLM 出错带 `fallbackFrom` / `fallbackReason` 标签自动降级
  - `llm`：强制视觉 LLM（当前 volcengine doubao-1.5-vision-pro，`userBudget=medium`），无 llmManager / 非 vision provider 时显式报错
  - `tesseract`：强制本地 Tesseract.js
  - V5 / V6 共享 dialog + web-panel dialog 各加一个 `<a-select>` engine 选择 + 蓝/灰/橙三色 tag 显示已用引擎。Engine guards 放在 `recognizeDispatch` 便于测试 stub 替换 impl 不重复验证逻辑；Provider 白名单 `Set(["volcengine"])`，扩展到 gemini / openai / anthropic 只需各自 LLMManager 暴露 `chatWithImage*` 后加一个集合项

### Fixed

- **chat intent understand 90s wall-clock 兜底（commit `6cbd04c50`）** —— `sendStream` 自带的 60s idle timer 在每个 chunk 上 rearm，慢 LLM 一直 dribble token 但永远不出 `final` frame 时"理解中…"占位卡会无限转。包一层 `AbortController + setTimeout(90s)` 把 signal 传进 stream 调用，超时后清理 placeholder 并给可读错误。
- **compliance-ipc 死 handler 清理（commit `29006decf`）** —— `compliance-ipc.js` 之前注册了两个 typo 前缀 channel `compliance-classify:generate-report` / `compliance-classify:get-policies` 无人调用；renderer 真正调用的 `compliance:generate-report` / `compliance:get-policies` 由 `audit-ipc.js` 拥有，背后是 `ComplianceManager`。两边背后还接的是不同 service（`soc2Compliance.generateReport` vs `auditManager.complianceManager.generateReport`），保留死路径只会让后续改真路径时漏改 → 直接删 + 同步删 `IPC_CHANNELS` 中两个 typo 项。
- **macOS 临时目录路径断言修复（commit `bb2c16656`）** —— `build-win-with-deref.test.js`（虽然测的是 Windows 构建符号链接，macOS Unit Tests 矩阵也跑）3 个断言炸 `expected '/private/var/folders/...' to be '/var/folders/...'`：macOS 的 `/var → /private/var` symlink，`os.tmpdir()` 返回 `/var/...` 但 `realpath` 路径不一样。`canonical = fs.realpathSync(os.tmpdir())` 把测试临时目录都规范化掉，linux / win 上 realpath 恒等无 regression。

### Tests

- **`audit-ipc.js` 首次单测覆盖（commit `b092673be`）** —— 之前零覆盖的盲点，被 `29006decf` typo 死 handler bug 拽出来。`audit-ipc.js` 拥有 18 个 channel 含 renderer-facing 的 `compliance:get-policies` / `compliance:generate-report`，没有单测就让 `compliance-ipc.js` 里的 typo duplicate 静悄悄活了几个月。源码 DI 改造（与 `credit-ipc` 模式一致）：accept `ipcMain` via `deps` with `electron` fallback，lazy-required 让 injection 可以抢先；新增 23 个 case 覆盖 18 channel 路由 + happy-path payload + AuditManager 异常路径。

| 套 | 通过 |
|---|---|
| desktop 单测 | 1477 / 1477 |
| CLI unit | 17,455 / 17,455 |

### Notes

- CLI npm 包同步发布 `chainlesschain@0.161.5`（v5.0.3.43 末已 bump 0.161.4 → 0.161.5）。
- 桌面 binary 重新打过；auto-updater 比对 `5.0.3-alpha.44 > 5.0.3-alpha.43`，所有 v5.0.3.43 桌面用户重启会真发现新版。

---

## [5.0.3.43 / CLI 0.161.4] - 2026-05-07 (MTC publisher_signature M-of-N 修正 + 安全硬化级联)

### Fixed

- **MTC `landmark.publisher_signature` strip-all-sigs 对称化（commit `c23e98cca` + 文档 `038e6d710`）** —— Producer 与 verifier 必须对称地把 `_stripSigsForPublisher(landmark)`（清零 `publisher_signature.sig` + 每个 snapshot 的 `signature.sig` + `signatures[*].sig`）喂给 JCS 后再签 / 验，而不是只清零 `publisher_signature.sig`。否则只要篡改 M-of-N 联邦中**任何一个**成员的 per-member sig，publisher_signature 就会被打断，**直接绕过 M-of-N 阈值的存在意义**。Helper 抽到 `packages/core-mtc/lib/publisher-signing.js`，导出为 `@chainlesschain/core-mtc/publisher-signing` 子路径。三处调用点：`batch.js`（单签 + 联邦）、`landmark-cache.js` 验证侧、桌面 `governance-multisig.js`（lazy-require 绕 @noble/curves hoisting trap）。规范文档 §8.2 同步更新。Canary：`mtc-federation-publish-cli.test.js` "2-of-3 threshold accepts when one member's sig is tampered" — 任何修改 publisher-sig 路径都必须跑全部 `mtc-federation*` 集成。
- **LandmarkCache `landmark.publisher_signature` 验证启用（commit `c40d927da` + `72c3619ee`）** —— `LandmarkCache` 默认 opt-in `verifyPublisherSignature: true` 对 cache 命中前增加发布者签名校验（不再无脑相信 cache）；real-verifier callers（CLI `cc mtc verify` + 桌面 audit pipeline + cross-chain bridge 校验侧）全线启用。常量 `BAD_PUBLISHER_SIG` 重命名为 `BAD_LANDMARK_SIG`（`36fcd8f4f`）以匹配规范 §11；spec §8.5 文档跟进 `LANDMARK_SIG_PREFIX` 定义（`8e459cfd5`）。

### Security

- **HIGH 44 → 0 / MOD 4 → 0 / LOW 45 → 0 安全硬化级联（多 commit）** —— 一周内分 8 次清空全部 npm audit 警报：
  - `f6c937fa8` override transitive `serialize-javascript` + `tar`（HIGH 44 → 10）
  - `8a56978b5` 干掉无人维护的 `speedtest-net`，改用 native fetch 实现网速测试（HIGH 10 → 7）
  - `9c7ce00e7` override `semver` 到 `^7.7.4`（清掉 imap 链 HIGH 7 → 4）
  - `922b64822` override `undici` 到 `^6.21.2`（清掉 hardhat 5.x 链 HIGH 4 → 3）
  - `4fae47dd4` deprecate `werift`（清空残余 HIGH 3 → 0）
  - `cc7b0b40a` override `ip-address` + `dompurify`（MOD 4 → 0）
  - `1f86594a2` override `tmp` 到 `^0.2.5`（LOW 45 → 40）
  - `64047283a` override `make-fetch-happen` 到 `^13`（LOW 40 → 14）
  - `d19bcb8cb` 拆 `hardhat-stack` 到独立 `contracts/` workspace + drop 不再依赖的 `hdkey`（LOW 14 → 0）
- **`channel-manager` DDL 加固 + drop 未用的 jspdf（commit `d558b66b1`，1 critical）** —— 修一处 DDL 注入面 + 删未用依赖减少攻击面。
- **`wrtc-compat` `ip.isPublic` 补丁 CVE-2024-29415（commit `7312cf035`）** —— `ip` package SSRF 漏洞绕过补丁。

### Added

- **Updater 渲染端进度通知（commit `4c1a5ac18` + `e27592bb5`）** —— `notifier-only` flow，关闭重复的 native dialog，渲染端实时显示下载进度。

### Fixed (post-release follow-ups, 2026-05-08)

源码级 follow-ups，源自 `551ef28b3` "fix(ipc): correct ipcGuard API" 那次 sweep 不彻底，留下两类互补 bug。两个 commit 都是源码 / 测试同步问题，**不影响 v5.0.3.43 桌面 binary 的业务功能**（handlers 仍正常注册），下次发版自动滚入。

| Commit | Bug | 为什么之前没炸 | 测试 |
|---|---|---|---|
| **`af92e0162` fix(test): align nostr-bridge-ipc stub** | 源码用 `ipcGuard.markModuleRegistered(name)` 直调（real guard 有此 fn），但 test stub 仍 mock 不存在的 `registerModule(name, channels)` 二参 → stub 调时 `TypeError: ipcGuard.markModuleRegistered is not a function`，23 / 389 social 用例炸 | CI "Unit Tests" stable-fallback 排除 `**/*-ipc.test.js`；"Full Test Suite" 用 `continue-on-error: true` | 23 / 23 ✅ |
| **`11247a957` fix(ipc): align 8 ai-engine IPC modules** | 8 个 IPC 模块（autonomous-developer / collaboration-governance / tech-learning / federation-hardening / reputation-optimizer / sla / stress-test / inference）反过来 —— 源码 `if (ipcGuard.registerModule) { ipcGuard.registerModule(name, CHANNELS); }`，real guard 没 `registerModule` → `if` 永远 falsy → guard 内部 `registeredModules` Set 漏跟踪这 8 个模块。Handlers 走 `ipcMain.handle` 仍真正注册，业务功能正常，只是 guard tracker 漏 8 个模块 | 测试 stub 自己 mock 了 `registerModule` → 测试假绿 | 邻近 29 文件 577/577 ✅ |

修法：stub `registerModule` → `markModuleRegistered` + 断言去 channels 参（test 侧）；`if (ipcGuard.registerModule) { ipcGuard.registerModule(name, CHANNELS); }` → `ipcGuard.markModuleRegistered(name)`，同时去掉同样无意义的 `if (ipcGuard.unregisterModule)` wrap（源码侧）。CI 漏检的两类（fallback 排除 `*-ipc.test.js` + Full Suite `continue-on-error: true`）作为单独 follow-up，不在本 commit 范围。

### Maintenance (post-release follow-ups, 2026-05-08 evening)

当晚晚些时候继续清理。其中 `cf77aea8d` 直接关掉上一段 explicit 留的"CI 漏检两类"follow-up；其余三条是顺手清出的 V5 opt-out 死代码 + 必走的 CLI 版本 bump + 一个 web-panel 404 bundle 修。这一批同样**不影响 v5.0.3.43 桌面 binary 的业务功能**，下次发版自动滚入。

| Commit | 内容 |
|---|---|
| **`1cb6576b9` chore(web-panel): refresh built asset hashes** | committed 的 `index.html` 引用 `index-Cf0pZvjB.js`，但该 bundle 已被新 build 覆盖；workspace 实际用 `index-Cs70ksHC.js` —— main 上 web-panel 在加载 404 bundle。同步两处 dist (`packages/web-panel/dist/` + `packages/cli/src/assets/web-panel/`) |
| **`cf77aea8d` fix(ci): close test.yml two coverage holes** | (1) Unit Tests stable-fallback 删掉 `**/*-ipc.test.js` catch-all（40 个 IPC 文件本地 39 pass + 1 skip / 1476 用例）；(2) Full Test Suite "Run all unit tests" 删掉 `continue-on-error: true`（coverage step 保留）。drive-by：`compliance-ipc.test.js` 3 个 fail align 到源里实际注册的 `compliance-classify:*` typo 前缀（dead handler 独立 bug 后续 commit 再处理） |
| **`539463b85` refactor(ui): drop dead chat-panel state + stale V5 page references** | `5066a778d` 删了 V5 ChatPanel 容器，但 `app.ts` `chatPanelVisible` field、`AppHeader` 聊天 toggle、`VoiceCommandHandler` 打开/关闭聊天 + 未识别语音 fall-through 派发到聊天的分支全成 cosmetic no-op。同时清 4 个 plugin.json description + `communityQuick.ts` header 引用已删 V5 页面的 stale 字符串。−50 行净瘦身 |
| **`a9b85f5ba` test(ui): drop chatPanelVisible default-state assertion in app.test.js** | `539463b85` 漏改第二个 store 测试 `tests/unit/stores/app.test.js`（之前 .ts 镜像 `src/renderer/stores/__tests__/app.test.ts` 改了，.js 这个 broke）。pre-commit prettier 顺手 reformat 整文件单引号→双引号 |
| **`c61de71eb` chore(cli): bump 0.161.4 → 0.161.5** | `af92e0162` + `11247a957` 改了 CLI 源但没 bump 版本号 → 下次发版 cli-tests 会被 `SHOULD_TEST=false` 跳过（rule: `github_release_pipeline_constraints.md` #5）。drive-by：`package-lock.json` 之前 v5.0.3.42 release 时 .161.3 → .161.4 漂移没修，一并对齐到 .161.5 |

### Notes

- 测试结果：desktop 单测 1454 / 1454 ✅，CLI mtc-federation 集成 41 / 41 ✅，core-mtc 单测全绿。
- 本版本同时是大幅安全 / 加密路径硬化版本，不含新增 P2P / chat-panel feature；用户可放心 upgrade。

---

## [5.0.3.42 / CLI 0.161.4] - 2026-05-07 (CLI 0.161.3 → 0.161.4 chat-intent 同步)

### Changed

- **CLI 包 `chainlesschain` 0.161.3 → 0.161.4 atomic bump（commit `a555b6760`）** —— v5.0.3.41 ship 了 chat-panel-v5 三壳对齐里的 chat-intent 路由代码，但 CLI `package.json.version` 没动，cli-tests 在 release 流程的 precheck 阶段判 `SHOULD_TEST=false`（`chainlesschain@0.161.3` 已在 npm registry → 跳过测试），导致后续 v5.0.3.43 publisher_signature 修补的真实回归差点没被拦住。本版本明示 atomic bump CLI 0.161.4 + 安装包同步发布，触发 cli-tests 强制运行，未来如果发现 CLI source 改动但 release pipeline 跳测 cli-tests，请优先检查 `git diff <prev-tag>..HEAD -- packages/cli/src/` 是否非空 + 同步 bump CLI version。

### Notes

- 本版本无功能变化，仅修 release pipeline 测试覆盖问题。

---

## [5.0.3.41 / CLI 0.161.3] - 2026-05-07 (chat-panel-v5 双壳对齐 + B4 social 滚动收口)

### Added

- **chat-panel-v5 V6 AIChatPanel 对齐**（commit `b33527d31`，Phase E）—— 把 V5 ChatPanel 的 4 个核心特性反向对齐到 V6 默认壳的 AIChatPanel：流式响应 + 历史会话切换 + 上下文记忆引用 + 工具调用面板。从此 V5 / V6 / web-shell 三壳的聊天体验严格对等，没有"V6 缺特性所以回退 V5"的回退路径。
- **chat-panel-v5 web-shell 端口 v1+v1.1**（commit `72b13388a`）—— V5 ChatPanel 的全部 router 协议、autoSendMessage 信号、virtual list 与 5 intent / 6 IPC 在 web-shell 默认壳走 WS topic 接通。配合上一条，**默认壳 web-panel 用户不再看不见任何聊天能力**。

### Fixed

- **web-panel 单测 `views-mount-smoke.test.js` 在 63 文件并行套件下 first-import 撞 30s timeout**（本版）—— Pipeline.vue + Chat.vue 在 4-fork 池 + 全量 SFC transform 竞争下，首个加载它们的 fork 会撞默认 testTimeout。fix：file-level `vi.setConfig({ testTimeout: 60_000 })`，全局 timeout 不动（已验证全局升 60s 反让 worker pool 调度恶化导致更多 file 超时）。同 cli_ci_sharding_lessons 记录的 vitest 4 严格 timeout 模式。

### Notes

- 本版本同时 ship 了之前 4 个 "5.0.3.40 续" 滚动条目里全部内容：B4-cred-persist + B4-auto-archive（XVII / XVIII），B4-mofn-sign v2 + B4-webpanel v1，B4-merkle channel envelope finality，社区/频道跨机同步 Phase A + B4 + Web Shell Phase 3c.7。productVersion 这次正式 .40 → .41，安装包/auto-updater 会发现新版本。
- 测试结果：desktop 单测 1454 / 1454 (4 skipped) ✅，CLI mtc-federation 集成 41 / 41 ✅，web-panel 单测 1853 / 1853 ✅，web-panel e2e 63 / 63 ✅。

---

## [5.0.3.40 续 / CLI 0.161.3] - 2026-05-07 (B4 social audit-grade closure: cred-persist + auto-archive)

### Added

- **B4-cred-persist v1 — WebDAV 凭据走 secure-config + 修一个潜伏 ~1 个月的字段名 bug**（commit `8e8e5a1b9`）—— §2.2.21 (XIV) 接好 Archive Tab 后让用户每次推归档都手输 baseUrl/username/password 走 wire（凭据原则违反 + 真去用 WebDAV archive 立刻撞 "url 必填"——构造器读 `url`/`remotePath` 但工厂从 §2.2.16 起一直传 `baseUrl`/`remoteRoot`，**字段名根本对不上**）。本节同时解决两个问题：(1) 抽 archive-provider-factory 到独立模块（`src/main/mtc/archive-provider-factory.js` +90，DI 注入可单测），加 `useStoredCredentials:true` 模式——main 从 Phase 3c 已落的 sync-credentials secure-config.enc（safeStorage / AES-256-GCM）解密构造 WebDAVClient；(2) 字段名 `baseUrl/remoteRoot` → `url/remotePath` 修正，加测试锁定 (`expect(captured).not.toHaveProperty('baseUrl')`)。新 1 IPC + 1 WS topic `*.has-stored-webdav-credentials`（只回 boolean，凭据永不外泄）+ MtcAudit.vue Archive Tab 重做：toggle 默认 ON 时不显示输入框，vault 空时 disable + 引导去 Settings → 同步 → WebDAV。**安全不变量**：useStoredCredentials=true 时 inline url/username/password 完全忽略（vault wins，防 spec-injection）；响应 schema 单元锁死 `expect(Object.keys(r).sort()).toEqual(['hasCredentials','success'])`。**测试**：desktop +10（archive-provider-factory 12 新文件 + community-mtc-handlers +4），web-panel +4 useMtcArchive。

- **B4-auto-archive v1 — 主进程定时归档 cron + MtcAudit 第 5 个 Tab**（commit `edfe4ade5`）—— XVII 修了凭据持久化让推送不再需要每次输密码，本节继续把 cron 跑起来：主进程 `setInterval` 周期触发 `ChannelEnvelopeArchiver.push`，配置写到 `app-config.json` 的 `mtc.autoArchive` namespace（enabled / intervalMs / providerSpec / communityIds + lastRunAt/Status/Error/Summary），enabled=true 的旧配置在主进程 boot 后**自动接续**。新模块 `src/main/mtc/auto-archive-scheduler.js` (+250) 是纯 Node（无 Electron API，timers DI 可单测）。3 个 IPC + 3 个 WS topic：`auto-archive:{config-get,config-set,run-now}` 和 `mtc.auto-archive.{config-get,config-set,run-now}`。MtcAudit.vue 第 5 个 Tab："启用定时归档" Switch + intervalHours InputNumber（最小 0.083h = 5min）+ provider 切换 + 复用 §XVII useStoredCredentials toggle + community 白名单 Textarea + 立即归档 + 持久化配置 + lastRun 状态卡。**鲁棒性不变量**：intervalMs ≥ 5min（防误配 ms-DoS）/ enabled=true 强制要求 providerSpec（拒绝保存）/ runOnce 内置 `_running` 守卫（多 fire 不重入返回 `{skipped:true}`）/ per-community try/catch（单点失败仅记 `lastRunStatus='partial'`，不阻断后续 community）/ providerSpec.useStoredCredentials 走 §2.2.23 vault 路径（cron 配置不写明文密码）。**测试**：desktop +24（auto-archive-scheduler 19 新文件 + community-mtc-handlers +5），web-panel +9 useAutoArchive。

### Notes

- §2.2.10 → §2.2.24 这 15 节涵盖 P2P 社交从"消息可信 + 自动联网" → "envelope 跨机" → "trust 校验" → "UI 可见" → "外部归档（活的）" → "M-of-N 多签" → "跨联邦信任" → "默认壳全套" → "凭据加密复用" → "周期自动归档" 的**完整 audit-grade 闭环**。私钥 / 密码均不过线，UI 默认壳全套可见。
- 设计文档 `docs/design/modules/02_去中心化社交模块.md` 在前序 commit 已加 §2.2.22（B4-mofn-sign v2）+ §2.2.23（B4-cred-persist）+ §2.2.24（B4-auto-archive），三大文档站本次同步刷新。

---

## [5.0.3.40 续 / CLI 0.161.3] - 2026-05-07 (B4-mofn-sign v2 + B4-webpanel UI)

### Added

- **B4-mofn-sign v2 — sign-as-self（私钥永不离 main）+ 顺手修一个潜伏 ~1 个月的 IPC bag bug**（commit `5c0374e88`）—— B4-webpanel UI 落地后想点"代我签名"按钮时撞墙：v1 协议要求渲染端把 64 字节 secretKey base64 后塞进 wire；web-panel 显式不持私钥（这是安全决策）所以按钮不可实现。本节把签名搬进主进程：渲染端只发 `(communityId, proposalId)`，main 通过 `DIDManager.getCurrentIdentity()` 取本人当前身份代签——**私钥永不离开主进程**。新 IPC `governance-mofn:sign-as-self` + WS topic `mtc.governance-mofn.sign-as-self`。顺手修了 `registerAllIPC` 的依赖包从 §2.2.10 Phase A 起就**漏传 12 个 manager**（communityManager / channelManager / gossipProtocol / governanceEngine / contentModerator / mtcFederationManager + B4 全套），phase-3-4-social 拿到的全是 `null`，桌面 V5/V6 的社区 IPC 全程返回空数组或 "not initialized"——Phase 1.6 hard-flip 默认壳走 web-shell，没人发现。本次结构性补齐。**安全模型对比**：v1 渲染端持密码 / 走 wire vs v2 都不持 / 不走 wire。**测试**：desktop +6（community-mtc-handlers）+ web-panel +4 useGovernanceMofn。

- **B4-webpanel v1 — web-panel UI 接全套 13 个 WS topic**（commit `4bc9d5651`）—— §2.2.20 (B4-webshell) 已把 IPC → WS 桥接铺好，但 web-panel 没 UI 入口。本节加 4 个 composable（useMtcEnvelope / useMtcArchive / useGovernanceMofn / useCrossFedTrust）+ 1 个 4-tab 页面 `MtcAudit.vue`：envelope 查询 / archive 推恢列 / governance M-of-N 提案 / cross-fed-trust 跨联邦信任锚——全部接到默认壳的 sidebar 上，桌面 V5/V6 用户和默认壳用户看到的功能严格对等。

---

## [5.0.3.40 续 / CLI 0.161.3] - 2026-05-07 (B4-merkle channel envelope finality)

### Added

- **B4-merkle v1 channel 事件 Merkle 批 envelope finality**（在 B4 DID 签名 + auto peer bridging 之后）—— 本机发出的每条 channel 消息进**离线可验**的 Merkle 批 envelope，组合 B4a 签名得"任何第三方都能验证我在 X 时间向 Y 频道发了 Z"。新模块 `desktop-app-vue/src/main/mtc/channel-event-batch.js` (+390)：累积到 `<userData>/channel-mtc/<communityId>/staging/<message-id>.json` → 按 threshold(默认 100) 或 timer(默认 1h) 触发 `closeBatch` → 写 `batches/<batch-id>/{manifest,landmark,envelope-*}.json` (atomic rename + crash rollback)。`social-initializer` 注册 `channelEventBatcher` initializer（autoTimer 启 1h closer），`community-ipc.channel:send-message` 在三件双发后 enqueue，新 IPC `channel:get-message-envelope(communityId, messageId)` 返回 inclusion proof + landmark 给 renderer / 外部 verifier。tweetnacl-based MTC signer + 自家 `_assembleBatchLocal` 用 core-mtc subpath primitives (`/hash` `/jcs` `/merkle` `/constants`) 绕开 `@noble/curves@^1` vs `@2.2.0` subpath 删除导致 core-mtc index 加载失败的 hoisting trap。输出 landmark/envelope wire-compatible，对端可用 `cc mtc verify` 验证。**总测试**：891 → 969（27 文件全绿），新增 31 用例（channel-event-batch 23 unit + community-ipc-merkle-enqueue 8 integration）。**`out/build/ChainlessChain-Setup-5.0.3-alpha.40.exe` 含全套已 rebuild**（426 MB，exit 0）。

### Notes

- B4-merkle v1 是 **local-only**：本机发出去的 envelope 落本机盘；远端没你的 batch dir 就查不到。Cross-machine envelope 分发是 follow-up sub-phase（federation channel publish landmark + on-demand pull envelopes）。
- 设计文档新增 §2.2.13（数据流 + 文件布局 + tweetnacl signer 解释 + `@noble/curves` 跨版本 subpath 陷阱实战）。
- 这是当前 v5.0.3.40 滚动周期的第二批：第一批是社区跨机同步 Phase A + B v1 + B4 + Phase 3c.7。

---

## [5.0.3.40 续 / CLI 0.161.3] - 2026-05-07 (社区/频道跨机同步 Phase A + B4 + Web Shell Phase 3c.7)

### Added

- **社区/频道**：跨机器同步真正打通（commits `50b8ddb05` + `3741a8e7e`）—— v5.0.3.40 之前社区 UI 完整可用但**只在单机生效**：A 在频道发的消息到不了 B 的本地数据库。Phase A 系统性修了 7 个底层 bug：libp2p 3.x stream API（`stream.write` → `stream.send` / `stream.source` → `for await of stream`）、`registerMessageHandler` 在 `P2PManager.initialize` 漏调、收包后没按 type 派发（新增 `decodeWireMessage` + `dispatchTypedMessage`）、`gossipProtocol.message:received` 一直没人订阅（新 `gossipReceiver` 在 social-initializer 接到 `channelManager.handleMessageReceived`）。Phase B v1 在 Phase A 直发 gossip 之上叠 MTC federation gossipsub 作为"审计级"双轨，`channel:send-message` / `community:join` 双发布双订阅、`INSERT OR IGNORE` 幂等。**B4 DID 签名补完**：每条 channel_message 现在带 `sender_pubkey + Ed25519 detached signature`；接收侧三重校验（DID ↔ pubkey、签名验真、shape 合法），关闭 sender_did free-text 冒名缝隙；`signature` / `pubkey` 通过 PRAGMA-based ALTER 加列，向后兼容。**B4 自动 peer 桥接**：libp2p `peer:connected` 双向广播 `mtc:advertise` envelope，对端按收到的 multiaddrs 顺序 `mtcFedMgr.connectPeer` 直至首发命中；非阻塞，Phase A 直发通道始终优先。**总测试**：149 → 891（22 个 p2p+social+mtc 文件全绿），新增 47 个 B4 用例（did-signer 22 + p2p-manager-dispatch +2 + channel-manager-signing 8 + mtc-auto-bridge 15）。
- **Web Shell Phase 3c.7**：截图识别 + 通知设置 + 托盘路由收口（commit `200078947`）—— Phase 3c.6 已落 NotificationBell + ClipboardImportDialog + SyncSettings + Search.vue，但 web-panel `App.vue` 的 `routeTrayAction` 还写死 "暂未接入 / 即将推出 / 暂无对应页面" toast，从托盘点进来全是死提示。本次：
  - `screenshot-handlers.js` 新增 3 个 WS topic（`capture` / `ocr` / `cleanup`）封装 `_internal.isInsideTmpDir` gate（防 path-traversal）；`useScreenshot` composable + `ScreenshotImportDialog.vue` port V5；pure-browser 模式自动 `unsupported:true`。
  - `notification-settings-handlers.js` 新增 2 个 WS topic（`get` / `update`）桥接 `appConfig.notifications.{enabled,sound,badge,desktop}` 子树；`useNotificationSettings` + `NotificationSettings.vue` 与 V5 SystemSettings 第 277-305 行同形。
  - 托盘 5 个 quick-action（global-search / clipboard-import / show-notifications / screenshot-ocr / open-settings#notifications）全部接到真路由；`Notes.vue` 监听 `?clipboardImport=` / `?screenshotOcr=` query 自动开 dialog；`NotificationBell.vue` mount/unmount `cc:open-notification-drawer` window event。
  - 测试 26 cases：截图 15（capture/ocr/cleanup envelope + path-traversal reject）+ 通知设置 11（DEFAULTS fallback / patch coercion / 拒绝 null settings）。
- **Plugin Marketplace 部署脚本骨架**（commit `a62fd8b81`）—— `docker-compose.yml` 加 marketplace services（postgres/redis 复用 db=2、独立 MinIO、db-init 一次性、Spring 容器）；`deploy/init-marketplace-db.sh` 幂等 `CREATE DATABASE` + schema bootstrap；`deploy/PLUGIN_MARKETPLACE_DEPLOY.md` end-to-end BT Panel SSL 部署指南；`deploy/nginx/chainlesschain.conf` 加 `plugins.chainlesschain.com` vhost；`deploy/fix-bt-nginx-marketplace.sh` BT Panel nginx 修复脚本。生产实际是 standalone 部署到 47.111.5.128（该机无 chainlesschain repo），这些是未来 from-repo 部署的参考。

### Fixed

- **Dashboard bundled-skill 发现 + JSON-based stat 解析**（commit `3881b9603`）—— skill 数 / 桌面统计在仪表盘上的展示口径修正，bundled-skill 列表能正确发现，stats 走 JSON 解析不再走 fragile string parse。

### Notes

- 本次 5 个 commit 互不依赖、互不冲突，**仍属 v5.0.3.40 滚动更新**（productVersion 未升）：B4 social 签名 + 自动 MTC 桥接是 Phase B 的真功能补完，社区跨机同步在 .40 之前 UI 已可见但实际不通；Phase 3c.7 是 Web Shell 默认壳路径上托盘 → 页面联动的真接线（之前 5 处死提示）。三大文档站本次同步刷新即对齐。
- 设计文档 `docs/design/modules/02_去中心化社交模块.md` 新增 §2.2.10（Phase A 跨机同步实战架构 + 7 个底层 bug 列表 + 端到端数据流图）和 §2.2.11（B4 DID 签名 + auto MTC peer bridging），用户文档 `docs-site/docs/chainlesschain/social.md` 在「社区/频道功能」段加 tip 提示，官网 `docs-website-v2/src/pages/index.astro` 三大场景 bullet 加上「社区 / 频道 gossip 跨机同步（v5.0.3.40+）」。

---

## [5.0.3.40 / CLI 0.161.3] - 2026-05-07 (MTC 视图 in-process 提速 + CI 三发解锁)

### Fixed

- **MTC 视图 onMounted 三发并发必爆 timeout**（asar 冷启动级联）—— v5.0.3.39 切到 `asar:true` 后 `cc` 子进程冷启动从 dev 的 ~2.5s 涨到打包后 6-10s（asar header 走查 + Node module resolve 多一层虚拟 fs），`Mtc.vue` 的 `loadStatus` + `loadBridgeStatus` + `loadBridgeSla` 三发并发必撞 8s/6s 上限（用户截图 "状态加载失败: Request timeout" + "加载桥 MTC 状态失败: Request timeout"）。修法：新增 3 个 in-process WS topic（`mtc.audit-status` / `mtc.bridge-status` / `mtc.bridge-sla`）直查 `audit-mtc` / `cross-chain-mtc` lib（纯文件读，无 SQLite，无 spawn，零 asar 开销）；`Mtc.vue` 通过 `useShellMode().isEmbedded` 双路径分叉，embedded 走新 topic，浏览器 / `cc serve` 仍走旧 `ws.execute`。同时把保底 timeout 从 8000/6000 提到 30000 ms（与 `executeJson` 默认对齐）。顺手修了 standalone 路径一个 pre-existing shape mismatch（lib 返回扁平字段，SPA 期望 `obj.config.*` 包装）—— 仅 embedded 路径生效，standalone 维持原状（独立 follow-up）。配 7 + 1 新单测。
- **macOS unit fallback 上 7 个 build-win-with-deref 测试**（commit `25d834958`）—— `desktop-app-vue/scripts/build-win-with-deref.js` 的 `isSymlink` 之前用 `realpathSync` 比较，但 macOS `os.tmpdir()` 路径含 `/var → /private/var` 的隐式 symlink，所有 tmp 子目录都被误判为 symlink → 7 测试 fail。改成 platform split：Win 仍用 realpath（junction 需要），POSIX 用 `lstat.isSymbolicLink()`（POSIX 没有 junction 概念，lstat 可靠）。
- **rules-validator SQL_INJECTION 在测试 fixture 上误报**（同 commit）—— `desktop-app-vue/src/main/sync/__tests__/sync-external-store.test.js:32` 是 `TestDbManager.exec(sql)` 的 sql.js 测试 fixture passthrough，被规则验证器 v2 当成 `db.exec()` 高危调用报红。`getAllFiles` 现在跳过 `__tests__/` / `__mocks__/` 目录 + `.test.js` / `.spec.js` / `.d.ts` 文件。生产代码扫描不变；75 条警告仍属 advisory。
- **CLI subprocess cold-start ETIMEDOUT on Windows**（同 commit）—— `packages/cli/__tests__/unit/skill.test.js`（12 处 @ 15s）+ `agent-repl.test.js`（3 处 @ 10s）调 `node bin/chainlesschain.js …`。ESM module-graph cold-start 在繁忙 Windows 主机真的需要 >10s（vitest 的 60s testTimeout 包不住，per-call execSync timeout 才是真天花板）。所有 CLI subprocess 调用 timeout 统一升到 60s（与项目 testTimeout 对齐）；passes 仍 1.7-2.5s 完成，只有真 fail 才会跑满。

### Tests

| 套 | 通过 | 文件 | Duration |
|---|---|---|---|
| Desktop unit + stores | 10482 / 10482 (689 skipped) | 320 | 1022s |
| MTC handler in-process 新增 | 7 / 7 | 1 | 3.4s |
| web-panel mtc-parser 新增 | 14 / 14 | 1 | 1.1s |
| CLI unit | 17392 / 17392 (7 skipped) | 412 | 458s |
| CLI integration | 821 / 821 | 56 | 198s |
| CLI e2e | TBD | TBD | TBD |
| **小计** | **28716 + e2e** | **790+** | **~28 min** |

### Notes

- 桌面**有**运行时改动：`web-shell-bootstrap.js` 注册 3 个新 in-process WS handler，`packages/web-panel` SPA bundle 重打。auto-updater 比对 `5.0.3-alpha.40 > 5.0.3-alpha.39`，所有 v5.0.3.39 桌面用户重启时会发现新版并自动获取 MTC 提速 + CI 修复。
- v5.0.3.39 release-sizes / 安装时间真机 benchmark 仍是 issue #8 待跟进项；本版桌面 binary 重新打过（含 SPA 新 bundle），但 ASAR surgery / native deps / 文件量级与 .39 一致，install 时间应等价。
- standalone `cc serve` 模式下 `loadBridgeStatus` 仍受 lib-vs-SPA shape mismatch 影响（pre-existing bug），桥状态显示 defaults——只在浏览器直连场景出现，桌面 v5.0.3.40 默认壳不受影响。
- 四个 fix 互不相关、互不依赖、互不冲突；任一单独应用都比 .39 现状好，捆绑发布只是节省一次 release 仪式。

## [5.0.3.39 / CLI 0.161.2] - 2026-05-07 (B4 post-pack ASAR surgery — Win 安装 20m → ~5m, issue #8)

### Fixed

- **Windows 安装时间从 ~20 分钟回到 ~5 分钟**（commit `e11b46913`）—— v5.0.3.4-13 因 electron-builder prod-dep walker 漏掉 `call-bind-apply-helpers` / `side-channel-{list,map,weakmap}` 4 个 transitive deps 改成 `asar: false` 兜底，代价是 NSIS 内 ~110k loose files × ~10ms 文件级 LZMA dict reset + NTFS transaction + Defender scan = ~20 分钟安装地板。本版本（B4 plan）走第三条路：`asar: true` + post-pack ASAR surgery。

### Added

- **`scripts/asar-surgery.js`** —— 在 electron-builder afterPack 钩子里跑 surgery：从原 asar `extractAll` 到 staging → 把 walker dropped 的 4 个包从 `desktop-app-vue/node_modules/` 注入到 staging 的 top-level `node_modules/` → 用 `@electron/asar.createPackageWithOptions` 重打包，并保留 electron-builder 原始 unpackDir 决策（扫物理 `app.asar.unpacked/` 父目录构造 brace-expanded glob）→ build-time verification gate 检查 4 个包确实落在 top-level（缺一即抛错，避免静默发出坏包）。
- **`scripts/build-win-with-deref.js`** —— Win 包装 `electron-builder --win`：临时把 `@chainlesschain/{core-mtc,session-core}` 的 workspace symlinks 替换成 verbatim 拷贝（asar packer 拒绝跨 app-root 符号链接），electron-builder 完成后在 finally 用 `'junction'` 还原（Windows 非 admin 不能创建 `'dir'` symlink，必须 `junction`）。surgery 本身在 afterPack 里跑（在 NSIS 生成安装包之前），不在这里跑——否则 Setup.exe 已经从 surgery 前的 win-unpacked 打好了。
- **`scripts/probe-asar.js`** —— 调试 CLI：`node scripts/probe-asar.js <path/to/app.asar>` 打印 4 个 walker-dropped 包是否落在 asar header top-level。
- **`tests/unit/scripts/asar-surgery.test.js`** + **`build-win-with-deref.test.js`** —— 23 个单元 + 集成测试（真 fs + 真 `@electron/asar` 跑 fixture），覆盖 no-asar 跳过 / 4 包注入 / source 缺包抛错 / dst 已存在覆写 / unpacked 内容保留 / verification 失败抛错 / stage 清理 / symlink 检测 / dereference / detach / restore-with-junction。期间发现并修掉 1 个真 bug：

### Changed

- **`electron-builder.yml`** —— `asar: false` → `asar: true`，移除 7 条 force-include extraResources（`app.asar.unpacked/{call-bind-apply-helpers,dunder-proto,get-proto,math-intrinsics,side-channel-{list,map,weakmap}}`），`afterPack` hook 在 asar:true 路径下调 `runSurgery`。
- **`scripts/electron-after-pack.js`** —— afterPack hook 双分支：asar:false（已有 nuclear-replace 路径，保留给 mac/linux 临时兼容）/ asar:true（新增 `runSurgery({appOutDir, sourceNm})` 调用）。Mac/Linux/Win 三平台共用一条 surgery 路径。
- **`desktop-app-vue/package.json`** —— `@electron/asar ^3.4.1` 提为显式 devDep（之前是 electron-forge / electron-builder / electron-winstaller 的 transitive，任一升级丢掉就坏）；`make:win:builder` 脚本改走 `node scripts/build-win-with-deref.js`。

### Notes

- 测试期间发现的真 bug：`@electron/asar` 有 module-level `filesystemCache` keyed by archive path，`extractAll` 后必须 `asar.uncache(asarPath)` 才能让后续 `listPackage` 读到 fresh header（否则 verification gate 永远抛 stale）。无 vitest fixture 的话生产环境也会同样抛——单纯依赖人工 Win VM 烟测发现需要再走一遍 30-45min build cycle。
- Refuted 路径（不要再走）：asarUnpack glob（issue #6 经验证）、extraResources to `app.asar.unpacked/`（v5.0.3.12）、4 包提为直接 dep（v5.0.3.6）。
- ASAR 完整性：Electron `EnableEmbeddedAsarIntegrityValidation` fuse 目前只在 macOS 强制（[Electron 文档](https://www.electronjs.org/docs/latest/tutorial/fuses)）。Windows 上 fuse no-op，post-surgery hash mismatch 不会让启动崩。当 macOS 加入支持（或 Windows 启用）后续 Phase 2：要么 `@electron/fuses` post-build patch 关闭 integrity，要么 surgery 后重算 hash 写回 electron.exe。

---

## [5.0.3.38 / CLI 0.161.2] - 2026-05-06 (refit Android APKs missed by v5.0.3.37 immutable-release)

详见 git log `608d235dd`。

---

## [5.0.3.37 / CLI 0.161.2] - 2026-05-06 (桌面版同步 productVersion + 托盘内存使用周期更新)

### Changed

- **`desktop-app-vue/package.json` version 同步 productVersion**（commit `c73c3530c`）—— `1.1.2-alpha` → `5.0.3-alpha.37`，semver 合法（`-alpha.N` prerelease），数字部分跟 productVersion `vX.Y.Z.N` 一一对应。规则文档化在 `CLAUDE.md` Version hierarchy 段：每发一版（`productVersion → vX.Y.Z.N`）desktop 版同步到 `X.Y.Z-alpha.N`。下一次发版（productVersion → v5.0.3.38）desktop 版变 `5.0.3-alpha.38`，比 v5.0.3.37 用户当前的 `5.0.3-alpha.37` 高一档，auto-updater 会真发现并提示新版本。Setup.exe 文件名也变为 `ChainlessChain-Setup-5.0.3-alpha.37.exe`，与 GitHub release tag `v5.0.3.37` 视觉对应。**v5.0.3.36 用户重启时会首次收到原生"发现新版本 5.0.3-alpha.37"对话框**——跨 v5.0.3.31-36 六个 release 因桌面版字段一直是 1.1.2-alpha 没动过，auto-updater 比对永远相等而误报"已是最新"，本版彻底解开。

### Added

- **托盘 → 性能监控 → 内存使用 周期更新**（commit `c73c3530c`）—— `EnhancedTrayManager` 早就提供了 `updateMemoryUsage(usage)` 方法但 main 进程从未调用，跨 v5.0.3.30+ 一直显示"加载中..."。`index.js` 在 tray 创建后挂一个 10s `setInterval`：用 `app.getAppMetrics()` 累计所有 electron 进程（main + renderer + GPU + utility 子进程）的 `workingSetSize` (RSS)，格式化"X MB"或"X.X GB"传给 `updateMemoryUsage`。failure-tolerant：`getAppMetrics` 抛错只 `logger.warn` 不影响 tray 主流程。`onWillQuit` 中 `clearInterval` 提早停掉防止 quit 链路 timer 火 stale 回调。

---

## [5.0.3.36 / CLI 0.161.2] - 2026-05-06 (手动检查更新加 native dialog feedback)

### Changed

- **手动检查更新加 native dialog feedback**（commit `734f87cc6`）：v5.0.3.35 修了 electron-log 缺失致 auto-updater 整模块 load 不进来的 bug 之后，从 electron-log 真实日志（`%APPDATA%\chainlesschain-desktop-vue\logs\main.log`）看 auto-updater 在用户点托盘"检查更新"时确实运行了：`手动检查更新 → Checking for update → Update for version 1.1.2-alpha is not available → 当前是最新版本`。但跨 v5.0.3.30-5.0.3.35 六个版本用户一直反映"点了无反应"——根因 `auto-updater.js` 的 `update-not-available` / `error` 事件只调 `webContents.send("update-status",...)` IPC，但 V5/V6 App.vue 和 web-shell 加载的 web-panel SPA 都没监听这个 channel，无论哪种 renderer UI 都看不到任何反馈。修法：`auto-updater.js` 加 `_manualCheckPending` 标志；`checkForUpdates(manual=true)` 设置；`update-not-available` 事件回调在 manual 时弹 native "当前已是最新版本"dialog（带当前版本号）；`error` 事件在 manual 时弹 native"检查更新失败"dialog（带错误信息）；`update-available` 已有 `showUpdateAvailableDialog`，仅清 manual 标志避免重复弹窗。后台 3s 启动自检 + 每 4h 周期检查路径不传 manual=true，**全程静默不弹任何 UI**（电源管理 / 锁屏唤醒等场景下大量自动 dialog 很骚扰）。`enhanced-tray-manager.js triggerCheckForUpdates` 调用处加 `true`。

### Notes

- 之前 v5.0.3.31/32/33/34/35 五版的"检查更新点了无反应"用户体验问题彻底闭环。绕开了 renderer IPC channel 的"无人监听"问题，跟 showAboutDialog 同套路走主进程原生 dialog——简单可靠，不依赖 V5/V6 / web-shell 模式。

---

## [5.0.3.35 / CLI 0.161.2] - 2026-05-06 (auto-updater 缺 electron-log 模块导致从未 load)

### Fixed

- **packaged 安装版 `require("electron-log")` 抛 ENOENT 致 auto-updater 模块无法 load**（commit `7b9194cd9`）：v5.0.3.34 给"检查更新"fallback dialog 加诊断字段后，用户截图反馈 `autoUpdater loaded: NO`、`require error: Cannot find module 'electron-log'`、`app.isPackaged: true`。诊断把根因暴露得很彻底——v5.0.3.31 加 auto-updater init 时就坏，但 require 抛错被 logger.warn 静默吞掉，包括启动 3s 自检 + 4h 周期检查 + 托盘"检查更新"在内的整条自动更新链路其实从未真正生效，跨 v5.0.3.31/32/33/34 四个版本（v5.0.3.32 加的 `app.isPackaged` gate 是有效的，autoUpdater 是 undefined 就走不到那一步）。`electron-log` 既不是 desktop-app-vue 的直接依赖，`electron-updater@6.6.2` 也不再带它作 transitive dep（v6 起 logger 由调用方注入）。修法是双保险：(1) `auto-updater.js` 把 `require("electron-log")` 包 try/catch，缺失时 fallback console-based `{info,warn,error}`，内部 `log.info(...)` 站点全部不变；fallback 分支不设置 `autoUpdater.logger`，让 electron-updater 用自带默认。(2) `desktop-app-vue/package.json` 加 `electron-log: ^5.4.3` 直接依赖，正常情况走 file logger，fallback 只是兜底。

### Notes

- 已知不在本版本修：托盘 → 性能监控 → "内存使用 / 加载中..." 永远显示"加载中..."。`tray-manager` 有 `updateMemoryUsage(usage)` 方法但 main 进程从未周期调用它来填充实时数据。单独 issue 跟。
- web-panel 的"全局搜索 / 截图识别 / 剪贴板导入 / 同步 / 通知中心"等 tray 项点了弹"功能即将推出"toast 是设计预期——web-panel 暂无对应面板。要让它们真工作得在 web-panel 加面板，是更大的功能开发。

---

## [5.0.3.34 / CLI 0.161.2] - 2026-05-06 (Web-shell 托盘菜单 bridge + 检查更新诊断)

### Fixed

- **Web-shell 模式下托盘菜单事件被丢弃**（commit `91914eb14`）：用户在 v5.0.3.33 packaged install 反馈托盘"新建笔记 / 设置 / 检查更新"等点了不跳转。根因 Phase 1.6 hard-flip 之后默认走 web-shell 模式（`caaddf530`），加载的渲染器是 `web-panel` SPA 而非 `desktop-app-vue` 的 V5/V6 Vue 渲染器；v5.0.3.31/32 修的都是 `desktop-app-vue/src/renderer/App.vue` 的 IPC `tray:action` listener，但这文件在 web-shell 模式下根本没被加载，preload 也是空的（per strategy memo），主进程 `webContents.send("tray:action",…)` 发的事件无人接。修复给主进程加一条"绕开 IPC 走 ws-server"桥接：`ws-cli-loader.js` 暴露公共 `broadcast(frame)`（委托现成的 `ChainlessChainWSServer._broadcast`），`web-shell-bootstrap.js` 透传到 startWebShell handle，`index.js` 用 `getWebShellHandle()` 懒 getter 注入 EnhancedTrayManager，`dispatchTrayAction` 在原 IPC send 之外 additionally `broadcast({type:"tray:action",payload:{type,payload}})`；`web-panel/src/App.vue` 在 `wsStore.onMessage` 上挂全局监听并路由到 web-panel 自己的 `/notes`/`/chat`/`/dashboard`/`/project-settings` 等页面，无对应面板的（通知中心 / 全局搜索 / 同步）回 toast"功能即将推出"。

### Changed

- **"检查更新"开发模式 fallback dialog 加诊断信息** —— v5.0.3.32 已经把 gate 从 `process.env.NODE_ENV === "production"` 改成 `(NODE_ENV === "production" || app.isPackaged)`，但用户在 v5.0.3.33 packaged install 上仍报告看到这个 dialog。把 `NODE_ENV` / `app.isPackaged` / `autoUpdater loaded` / `checkForUpdates fn` 四个字段直接打到 dialog detail 里，下次用户截图就能直接判断是哪条 fail（require 抛了？isPackaged 出乎意料 false？module 缺导出？），避免再让用户挖 log 文件。

### Tests

- `enhanced-tray-manager.test.js` 6 → 10 测试（新增 4 个 web-shell broadcast path：handle 存在时双发、handle 为 null 时仅 IPC、未传 option 时向后兼容、broadcast 抛错时不波及主进程）。
- `src/main/web-shell/` 全 13 文件 196/196 绿。

---

## [5.0.3.33 / CLI 0.161.2] - 2026-05-06 (托盘"关于"产品版本 "—" 修复)

### Fixed

- **托盘"关于"对话框产品版本永远显示 "—"**（commit `461edf060`）：用户在 v5.0.3.32 安装版反馈托盘 → 关于显示 `产品版本：—`，应显示 `v5.0.3.32`。根因 `enhanced-tray-manager.js:317` 用 `require("../../../../package.json")` 读 monorepo 根的 `productVersion`，但 packaged install 里 `enhanced-tray-manager.js` 位于 `app.asar/dist/main/system/`，相对路径 `../../../..` 走出 `app.asar` 抵达 `<install>/resources/`，那里没有 package.json → require 必失败 → 永远 catch 走 `"—"`。dev 模式路径在 repo 内有效所以本机看不出来，是 v5.0.3.31 / v5.0.3.32 共有的历史遗留 packaging 路径问题。修复：build 时把 `productVersion` + `appVersion` 烧进 `dist/main/build-info.json`（`scripts/build-main.js` 在 `copyDir` 完成后写入），`showAboutDialog` 优先读这个常量文件，老相对路径保留作为直接 import src 跑测试时的 fallback。

### Why

v5.0.3.32 修完两处托盘主链路 bug 后用户复测发现"关于"还有这个边角小问题。它和托盘菜单链路、自动更新链路均无关，但同样属于"只在 packaged install 才暴露、dev 模式看不出来"那类。顺手收口。

---

## [5.0.3.32 / CLI 0.161.2] - 2026-05-06 (托盘修复 v5.0.3.31 残留两处)

### Fixed

- **托盘"检查更新"在打包版误报开发模式**（commit `7e6605006`）：v5.0.3.31 用户反馈 GitHub 下载的安装版点托盘"检查更新"仍弹"当前模式：development"对话框。根因 `enhanced-tray-manager.js:365` 守的是 `process.env.NODE_ENV === "production"`，但 Electron 打包后 `NODE_ENV` 默认 undefined（不是 "production"），所以 packaged install 也走 fallback 分支并因此从未真正调用过 `autoUpdater.checkForUpdates()`。改判 `(process.env.NODE_ENV === "production" || app.isPackaged)`，对齐 `backend-service-manager.js:17` 既有双判断。后台静默自动更新链路本身不受影响，因为 `auto-updater.js:32` 守的是 `!process.env.NODE_ENV || === "production"`，对 undefined 容错。
- **首次启动未设密码状态下托盘菜单事件被丢弃**（commit `2532774f5`）：`App.vue` `onMounted` 在 `initial-setup:get-status` 返回 `{ completed: false }` 时 early-return，跳过下方 `tray:action` / `show-global-settings` / `database-switched` 三个 IPC listener 注册。结果首次启动用户点托盘菜单，主进程 `dispatchTrayAction` 把窗口 show + focus 后通过 IPC `send("tray:action")`，但 renderer 没人接，路由不跳——表现为"托盘只把窗口拉出来不进对应界面"。修复：把这三个 listener 整体提到早返之前（连同已经在那里的 `deep-link:invitation`），它们和数据库加密 / 设置流程无依赖。

### Notes

- 已知小问题（不在本版本修）：preload `removeListener` 直接传 `func`，但 `on` 注册时包了 arrow wrapper，匹配不到——`onUnmounted` 的 cleanup 实质未生效（轻微监听器累积），不影响功能。

### Why

v5.0.3.31 已经修了"托盘菜单大部分项哑响"的主链路（`tray:action` 统一通道 + renderer listener），但两处残留——`NODE_ENV === "production"` 误判和 setup-未完成早返——只在用户实际跑 packaged install 才暴露，本机 dev 模式正好走另一条分支看不见。这两个 bug 是 v5.0.3.31 修复闭环外漏掉的边角。

---

## [5.0.3.31 / CLI 0.161.2] - 2026-05-05 (vitest 4 bump + 自动更新 + 托盘菜单 IPC 修复)

### Fixed

- **桌面自动更新 + 托盘菜单全量修复**（commit `bc2e476bf`）：v5.0.3.30 用户反馈三个 packaged-install 问题同源——(1) 自动更新功能不工作、(2) 托盘"检查更新"点击无反应、(3) 托盘菜单大部分项点击无反应（除"显示主窗口"）。`auto-updater.js` 模块存在但 `index.js` 从未调用 `init()`，packaged 版本无启动自检也无 4h 周期检查；托盘菜单各项发送的 per-item IPC channel（`quick-action` / `sync` / `show-notifications` / `show-performance` / `open-settings` / `show-about` / `check-update`）在 renderer 0 监听器。修复：所有菜单项重新走 `dispatchTrayAction` 统一入口；窗口隐藏时先 `show()+focus()` 给反馈（之前 silent-on-hidden 是"无响应"感知的助燃因素）；"检查更新"生产模式直调 `auto-updater.checkForUpdates()`、dev 模式 fallback dialog；"关于"主进程 native `dialog.showMessageBox`，无需 renderer 往返。`App.vue` 监听 `tray:action` 按 type 派发到 Vue Router、GlobalSearch、window CustomEvents；未映射的 `screenshot-ocr` / `clipboard-import` / `sync` 显式 toast "功能即将推出"——比哑响好。
- **afterPack 预清悬挂 symlink**（commit `411a99af5`）：CI Linux build 在 after-pack 报 `ENOENT: no such file or directory, stat .bin/cc`。根因 CI "Merge hoisted modules into nested" 步创建 `.bin/cc` 软链指向 `@chainlesschain/cli`，但 cli 包本身只装在 `packages/cli/node_modules/` 下，nothing 镜像到 `desktop-app-vue/node_modules/@chainlesschain/`——symlink dangling。`fs.cpSync(..., { dereference: true })` 在 filter 回调前先 `getStats()`（跟随 symlink），filter 返 false 拦不住。修复：`cpSync` 前 walk `sourceNm`，`unlink` 任何 target 解析失败的 symlink；廉价（仅 `.bin/*` 通常是 symlink）、有日志、best-effort。
- **vitest 3→4 误升级回滚**（commit `18caa371a`）：`bc2e476bf` 暂存 `desktop-app-vue/package.json` 1.1.1-alpha → 1.1.2-alpha 时，`git add` 同时拣进了 `chore/vitest-v4-dry-run` 分支遗留在工作目录的 vitest dep 改动（sticky checkout 没清干净），导致 vitest 3→4 没带 lockfile 一起升级，CI `npm ci` 报 8 个 `lock file's @vitest/expect@3.2.4 does not satisfy 4.1.5`。三平台 build 全挂。回滚 vitest / `@vitest/coverage-v8` / `@vitest/ui` 回 ^3.0.0 重新对齐 lockfile，v4 迁移按计划走单独分支（见下面 v4 bump 段落）。

### Added

- **vitest 3.x → 4.1.5 全量升级 + 后量子级 CI 稳定性**（7 commits `57bb519fe..8ad5fb7e9`）：v3 时代两个工件性 workaround 同时退役——issue #5 的 Windows Unit Tests `continue-on-error` + issue #4 的 `mtc-federation-governance-cli` `poolMatchGlobs → threads:singleThread` 路由。vitest 4 上游修了 birpc 60s `onTaskUpdate` 心跳硬编码（`vitest-dev/vitest#8297`），现在尊重用户配置的 `testTimeout` / `hookTimeout`，`--reporter=basic` 也由 `default + silent=passed-only` 替代。受影响包：cli、web-panel、core-mtc、session-core、shared-logger、core-{db,env,infra,config}、desktop-app-vue（含 `@vitest/coverage-v8` / `@vitest/ui`）。同批 bump `@vitejs/plugin-vue 5.x → 6.0.6`（vitest 4 的 vite peer 是 `^6 || ^7 || ^8`，plugin-vue 5 顶到 vite ^6 conflict 在 web-panel install 时 ERESOLVE 撞墙）。落地配套：`vi.fn(() => obj)` 用作 constructor 的 ~30 文件改 `function () { return obj }`（v4 拒绝 arrow 作 ctor）；CLI `testTimeout: 30000 → 60000` 给 subprocess-heavy 联邦治理 + 审计 e2e 场景留余量；`tests/setup.ts` window 访问加 typeof guard（v4 严守 per-file `@vitest-environment node`）；`OrganizationRolesPage.test.js` 补 `MoreOutlined` 等 12 个 antd icon mock（v4 mock module strict mode）；`ProgressMonitor.test.ts` 把 `(global as any).window = {...}` 改成 mutate `window.electronAPI`（避免覆盖整个 jsdom window 丢 `getComputedStyle`）。最终 5/5 CI workflow 全绿；issue #5 自动闭环。

### Changed

- **删除冗余 android-release.yml**（commit `36d9307f6`）：standalone workflow 与 `release.yml` `build-android` job 同 tag pattern + 同 APK/AAB 输出 + 同 GitHub Release 创建，实测前者 v5.0.3.30 在 45m15s 超时取消、后者 ~2 分钟跑完发了 14 APK + AAB，标准 release 唯一作用是给每个发布加个红叉。同步刷新 `android-app/docs/ci-cd/CI_CD_GUIDE.md` 手动触发指引指向 `release.yml`，`desktop-app-vue/.cowork/cicd-analysis.md` 删行；`FIREBASE_CRASHLYTICS_SETUP.md` 通用示例 yaml 不动（说明性，非真实引用）。

### Docs

- **issue #6 文档 fact-check**（commit `4b134e9f4`）：issue #6 body 提的 `asar:true` + `asarUnpack` glob 把 Win install 砍到 5min 的方案在 2026-05-05 实证（issue 关闭注释里）证伪——`asarUnpack` 只能给 walker manifest 里已选的文件加 unpack 标，无法补 walker drop 到 nested-only 的 4 个包（`call-bind-apply-helpers`、`side-channel-{list,map,weakmap}`）。同步刷外部文档对齐：`CHANGELOG.md` 删 "重启用 asarUnpack 砍到 5 分钟" false promise 改 "前期方案证伪 + 剩余路径 = post-pack asar surgery + 暂无 active tracker"；`docs-site/docs/guide/installation.md` 用户面安装指南口径同步。

### Why

5.0.3.31 主题是"修真问题 + 顺手清技术债"：用户反馈的自动更新和托盘菜单是真功能 bug 不能拖；CI Linux build 的 dangling symlink 是阻塞 release 的 P0；vitest 4 升级一直在 backlog 里，issue #5 直到 v4 拿掉硬编码心跳才有体面解，正好这次连同 issue #4 的 `poolMatchGlobs` workaround 一并退役。

---

## [5.0.3.30 / CLI 0.161.2] - 2026-05-05 (桌面图标 + 系统托盘 + 安装恢复力)

### Fixed

- **桌面应用图标视觉占用率不足**（commit `f2c8fc22f`）：`assets/icon.png` master 圆形 logo 在 2451x2451 画布占比 ~52%（重透明边距），任务栏 + 桌面快捷方式 + 托盘渲染都比微信 / Office 等方块邻居小一圈。`tools/regen-app-icon.js`（sharp + png-to-ico）自动 trim 透明边、squarify bbox、重建 7 层 .ico；新 master 1282x1282，水平占比 100% / 垂直 89%。圆形 logo 固有的 π/4 比与方形 icon 视觉对比仍有差距（已写进 Known Limitations）。同批接线：`BrowserWindow` 加 `icon: resolveAppIconPath()`（dev → `assets/icon.ico`、packaged → `process.resourcesPath/icon.ico`），`setupApp()` 调 `app.setAppUserModelId("com.chainlesschain.desktop")`（不调 dev 退回 Electron 默认图标 + packaged 升级有图标关联丢失风险）；`enhanced-tray-manager.js` `getIconPath()` 候选路径之前只指向项目里压根不存在的 `resources/`，nativeImage 静默空、Windows 退回 fallback——补 `assets/icon.ico` + `process.resourcesPath` 进表头；`electron-builder.yml` `extraResources` 把 `assets/icon.{ico,png}` 拷到 `process.resourcesPath`，确保 packaged install 运行时 tray 找得到。
- **桌面 npm install 后 electron 二进制偶失**（commit `f2c8fc22f` 同批）：`desktop-app-vue/package.json` 加 postinstall fallback `node node_modules/electron/install.js || true`。npm workspaces hoist 偶尔会让 desktop 的 `electron/dist/electron.exe` 缺，没这个 fallback 全新 clone `npm run dev` 撞 "Electron failed to install correctly" 需手动 recover。
- **eslint tools/ + scripts/ 范围溢出**（commit `f2c8fc22f` 同批）：`eslint.config.js` 加 `tools/` + `scripts/` override（CommonJS、`no-undef` off、`no-require-imports` off），未来 Node helper script 不再撞 renderer-style TS 规则。
- **桌面主窗口最小化到系统托盘**（commit `d57759dc9`，bundled into v5.0.3.30）：关闭按钮触发 `hide()` 而非 `quit()`，托盘图标常驻；右键菜单 Show / Quit。
- **桌面 installer 瘦身 357 MB / 14k 文件**（commit `b2e1ff27d`，bundled）：electron-builder afterPack hook 过滤掉打不进生产的 devDep / 测试目录 / `.bak` 等无用文件。Setup.exe 装机时间天花板（文件数 × ~10ms）相应下降。
- **CLI prod deps 标准化注入 packaged**（commit `33d40fbad`，bundled）：本地 `make:*:builder` 链路也走 prod-deps standalone install + bundle，与 CI 路径对齐。

### Why

5.0.3.30 是 5.0.3.29 之后桌面端体验线的小幅 patch，主题是 "图标视觉对齐 + workspace 残余坑收口"。功能层无变化，主要改善 packaged install 后第一印象（任务栏 / 托盘可见度）和 fresh-clone 体验。捆绑发布的 `b2e1ff27d` / `33d40fbad` / `d57759dc9` 是前序未发版的 desktop work，赶 5.0.3.30 一起落 GA。

---

## [5.0.3.29 / CLI 0.161.2] - 2026-05-05 (CI/test 稳定性收口 + 双语整站 + 桌面端体验优化)

### Added

- **官网整站双语**（commit `036bfa33e`）：`docs-website-v2` 8 页 zh + 8 页 en 镜像（`/`、`/cli`、`/web`、`/desktop`、`/security`、`/enterprise`、`/about`、`/404`），`SiteHeader`/`SiteFooter` 检测 `/en/` 前缀自动切换 nav + dictionary，"EN ↔ 中文" 双向切换。同批落地：首页"三大核心能力"屏 / Cowork 5 阶段流程图 / 6 平台 + 6 路测试细分 strip / SLA + 5 类伙伴 + 6 合作方式区块；`/security` 补 Trinity Trust Root v3.2 三脚（U盾 / SIMKey / TEE）+ PQC（ML-KEM/ML-DSA）+ 零知识（Groth16 + zk-STARK）+ FIPS 140-3；`/about` 补里程碑 + 资质双块。CLI 版本号统一引用 `packages/cli/package.json`，三处硬编码漂移修掉。
- **桌面主窗口最小化到系统托盘**（commit `d57759dc9`）：关闭按钮触发 hide() 而非 quit()，托盘图标常驻；右键菜单 Show / Quit。

### Fixed

- **MTC federation governance CLI 测试拆分**（commit `0114aec48`）：`mtc-federation-governance-cli.test.js` 单文件 41 测试 110-200s wall-time 触发 vitest hardcoded 60s `onTaskUpdate` RPC 心跳超时。拆为多文件 + `poolMatchGlobs` 路由到 threads pool（forks pool birpc 在 subprocess 负载下崩溃，threads 用 postMessage 不会）。issue #4 关闭。
- **桌面 installer 瘦身 357 MB / 14k 文件**（commit `b2e1ff27d`）：electron-builder afterPack hook 过滤掉打不进生产的 devDep / 测试目录 / `.bak` 等无用文件。Setup.exe 装机时间天花板（文件数 × ~10ms）相应下降。
- **Node 23 native-dep prebuild 缺口排除**（commit `7724ff541` + `9138aa3fa`）：`better-sqlite3-multiple-ciphers` 只 ship ABI v115/v127/v137（无 v131），Node 23 上 `npm install` 级联失败 vue-tsc / ant-design-vue 等。`engines.node` 声明 `>=22.12.0 <23.0.0 || >=24.0.0`，`package-lock.json` engines 字段同步对齐。
- **桌面单元测试 RPC 饱和修复**（commits `9abf81452` / `502551390`）：`vitest --reporter=basic --silent=true` 抑制 per-test stdout RPC 流量；heartbeat-killer 干掉 hung 子进程；`skill-handlers.test.js` timeout 上调。
- **CI 测试稳定性双修**（commit `2753ebf44`）：stable-suite fallback 暴露的两个 unit-test 失败修掉。
- **官网下载链接 size 显示修复**（commit `57df48852`）：桌面下载卡读真 GitHub release asset size 而非占位符。
- **CLI prod deps 标准化注入 packaged**（commit `33d40fbad`）：本地 `make:*:builder` 链路也走 prod-deps standalone install + bundle，与 CI 路径对齐。
- **`update-changelog` job 安装 desktop deps**（commit `0e34609e9`）：post-workspace-refactor 后 changelog 生成需要 desktop-app-vue 的 deps。

### Changed

- **Windows Unit Tests 标 continue-on-error**（commit `e0dbcb140`）：等 vitest v4 升级再去掉。

### Why

v5.0.3.22 → v5.0.3.29 是发布工程线最后一段稳定性收口，主题是 "把所有 CI/test/installer 路径对齐到 workspace refactor 后的新架构"。同期顺手做完官网整站双语 + 桌面端系统托盘体验优化。productVersion 跨度大但每步都是小幅 patch，无功能性变化，主要给下一次 GA 发布铺路。

---

## [5.0.3.22 / CLI 0.161.2] - 2026-05-04 (Workspace 结构性重构 + ASAR 终结 + V5 dead-page 清理)

### Changed

- **Workspace 重构：移除 desktop-app-vue from root workspaces**（commit `ad3e7d403`）：根本性修复 npm workspaces hoisting 陷阱 — 此前每次发版都因 `call-bind-apply-helpers` 等 transitive deps hoist 到根 `node_modules/` 而触发 ASAR 缺包问题（v5.0.3.7 走的是补丁性方案）。这次直接把 desktop-app-vue 从 workspace 拆出，让它有独立 `node_modules/`，根治第二天发版翻车的可能性。`ad3e7d403` 之后所有 CI/release path 都按 "non-workspace" 重新接线。
- **CLI 测试 sharding 替代 glob 批处理**（commits `1c9db161b` / `21a60f714` / `b52c2f427` / `a0abf544e`）：vitest `--shard=k/n` matrix 替代易翻车的 `[a-m]/[n-z]` glob 批处理；9 个 push/PR workflows 加 `concurrency: cancel-in-progress`；integration shard 矩阵从 4 升 8 让 macos shard 4/4 上的 MTC 重型文件 hash 走他处；vitest config 内固化 `silent + basic reporter`。
- **Vite 7 + Rollup 4 strict mode 适配**（commits `a9418b58a` / `39ebb116e` / `2c1c7887c`）：禁用 `modulePreload polyfill`、splash CSS 抽到 public/ 文件、rollup 锁 4.59.0（4.60+ source phase strict 报错）。
- **删除 6 个 V5 死页面**（commit `5066a718d`）：V6 Chat-First Shell 全量 port 完毕后清理 V5 残留；`-8283 lines / +10 lines`，路由表减 5 个 entries。

### Fixed

- **call-bind-apply-helpers ASAR drop 终战**（commits `496d21708` / `f92505fb4` / `1c8d0994d` / `99eb6b730` / `6152056e2` / `41df786f1` / `1533fc116` / `d1de6b8f7` / `be428a3fe` / `328343642` / `4d9c21b79` / `611757f7e` / `020b74f7e` / `aed3fcc7c` / `32d23864f`）：v5.0.3.7 之前已经发现，但补丁未根治。本批走完所有备选方案：禁用 ASAR、afterPack 重构、nuclear 把 dev tree verbatim 替换、`extraResources` 路线、最终 standalone prod-deps install + bundle。**这条路线在 `ad3e7d403` workspace 重构后才彻底安静下来**。
- **Windows 冷启动 flaky 测试预热**（commit `2d29bc615`）：`diagnostics.test.js` 首次 `collectDoctorReport` >60s + `coding-agent-envelope-roundtrip.test.js` 首次 WS round-trip >5s。`beforeAll` 预热 + 首次请求 30s timeout。
- **CI release 多个角落修补**（commits `c4c4f0d8a` / `a86e05ab6` / `4aee8af0c` / `f5246aa5c` / `8ace3d14a` / `afb974f0f` / `fefe86953` / `4ef147d53` / `016df8a0d`）：`saveConfig` mkdir before write（fresh runner ENOENT）+ `core-mtc` 7 个缺失的 libp2p deps 显式声明 + `web-panel npm install before build` + post-workspace-refactor 各处 `cd && npm ci` + macOS dmg-license 安装 + AppImage embedded blockmap 验证 + create-release permissions 拓宽 + MTC governance test 已知限制文档化。
- **`npm run dev` 修**（commit `a84284eb6`）：hoisted bin shims 残留导致 dev 启动失败，prune 掉破损的 hoisted bin shims。
- **桌面 backend data 路径**（commit `22c0ec43d`）：production 用 `userData` 而非 Program Files（read-only）。
- **桌面 webshell splash window**（commit `fcbf4195d`）：long boot 期间显示 splash 窗给用户反馈。

### Added

- **`docs(claude)` 版本号 source-of-truth 化**（commit `99b5a03ac`）：CLAUDE.md 把 productVersion / CLI version 等版本字段直接指向源文件（`package.json` 的 productVersion / `packages/cli/package.json` 的 version），不再在多处复制粘贴。配合本仓库三站 tagline 同步策略。

### Why

v5.0.3.7 → v5.0.3.21 期间 ASAR call-bind-apply-helpers drop 反复发作，每次发版都得加新补丁。`ad3e7d403` 直接拆 workspace 是结构性根治 —— 自此 nested `node_modules/` 物理上就有这些包，electron-builder walker 不可能再选错。同期把 V5 dead pages 删掉、CI sharding 升级、Vite 7 适配三件事打包做完，避免下次发版再被翻出。productVersion 从 `.7` 跳到 `.21 → .22` 跨度大但中间多个版本只是 release attempt 失败重试，没有功能性新增。

---

## [5.0.3.7 / CLI 0.161.2] - 2026-05-03 (发布工程硬化：Express@5 ASAR hoist 修 + dev/CI 收口)

### Fixed

- **Express@5 ASAR hoist 陷阱修复**（commits `496d21708` / `f92505fb4` / `1c8d0994d`）：npm workspaces 把 Express@5 拆出的 transitive deps（`call-bind-apply-helpers` 等）hoist 到根 `node_modules/`，electron-builder `files: node_modules/**/*` 只看 `desktop-app-vue/node_modules/`，结果 ASAR 缺包导致打出来的 .exe 启动报 `Cannot find module 'call-bind-apply-helpers'`。修复方案三层兜底：（1）`496d21708` 让 ASAR 物理上一定带上 Express@5 transitive 细包；（2）`f92505fb4` 把 `package-lock.json` 同步到 nested `node_modules/` 真实状态 + `productVersion v5.0.3.6 → v5.0.3.7`；（3）`1c8d0994d` ci-release hard-fail 校验 split deps 是否落进 nested `node_modules/`，缺包直接挂 CI。
- **`npm run dev` 修复**（commit `a84284eb6`）：hoisted bin shims 残留导致 dev 启动失败，prune 掉损坏的 hoisted bin shims。
- **electron-builder release 链路收口**（commits `cf29f2ef1` / `8c0dc5e8f` / `b050abafd` / `73415b67e` / `5f1dac021` / `da8ed9d91` / `8d5890bfd`）：electron-builder.yml 资源路径修复 + Linux .deb maintainer/vendor 元数据补齐 + icon.ico 256x256 + drop missing afterSign hook + `npmRebuild: false` 让原生依赖走预编译 + `--publish never` + `gh release upload` 拆分（不再依赖 `GH_TOKEN`）+ Linux AppImage blockmap 缺失降级为 warning。

### Added

- **CI release 测试链路 escape hatch**（commit `8d2defd90` / `24427e4c8`）：`feat(ci): add skip_tests input to Publish to npm workflow`，手动发布时可跳过 CLI 集成测试。
- **CLI publish IPC 饱和修复**（commits `5d3a3dc49` / `c2746e41b` / `b68fff118` / `4e50d9691`）：`--no-file-parallelism` + 静默 vitest + 分批跑集成测试避开 `onTaskUpdate timeout`。

### Why

v5.0.3.6 → v5.0.3.7 是发布工程线的硬化批次，无新功能。Express@5 ASAR hoist 陷阱在 v5.0.3.5 之前发布的 Windows 安装包中潜伏（dev 跑得通因为 hoist 到根 `node_modules/` 仍可解析；release 装出来的 .exe 跑不通），由 `496d21708` / `f92505fb4` / `1c8d0994d` 三连击根治。同期把 electron-builder 在 macOS DMG / Linux .deb / icon / 签名 / 发布流程上的零碎 fix 一次性收口，避免下一次发布再碰同类问题。产品功能面延续 v5.0.3.5 时的 MTC v0.11 + Web Panel i18n M3，本次部署主要是把发布工程稳定性传导到下游。

---

## [5.0.3.5 / CLI 0.161.2] - 2026-05-03 (MTC v0.6→v0.11 doc roll-up + 跨链桥 + 治理自动同步 + 链上锚定)

### Added

- **MTC v0.11 — 跨联邦互信 + 离线审计 + 链上 governance-anchor + 监控仪表盘**（commit `b312563f0`）：`cross-trust-create / cross-trust-validate` 实现联邦间显式背书（multi-hop 信任链可达）；`auditGovernanceLog` 纯函数离线复盘整条治理日志；`computeGovernanceSnapshotHash + buildGovernanceAnchorRecord + verifyGovernanceAnchor` 把治理快照锚定到链（Q-COMP-3 已解锁，提供 `InMemoryChainAnchorClient` / `FilesystemChainAnchorClient` 抽象）；监控仪表盘聚合 sync stats / SLA / gas-aware 路径选择。
- **MTC v0.10 multi-proposal CRDT picker + governance ops 测试**（commits `66ddc1566` / `aedee372d` / `6e90faa9d`）：单成员视角同时存在多个 propose-revoke / propose-threshold 时，UI 用 CRDT picker 排序展示；live sync stats + libp2p smoke 强化；桌面 V6 widget surfaces governance-sync-stats（v0.10.1）。
- **MTC v0.9 治理 GUI（桌面 V6 + Web Panel）**（commits `a8fff1f52` / `9ad09446f`）：操作型治理 tab 在桌面 V6 widget 与 Web Panel `Mtc.vue` 落地；签名密钥仍 CLI-only。
- **MTC v0.8 跨成员 governance.log 同步**（commit `bb88756d6`）：filesystem drop-zone + libp2p gossipsub 双路径；service supervisor 模板（`governance-sync-serve` 长跑守护进程）；dedup by `event_id` + 时序回放最终一致。
- **MTC v0.7 联邦治理 CLI + 桥接 MTCA 守护**（commit `1c1e4096d`）：`cc mtc federation {invite,vote,propose-revoke,confirm-revoke,rotate-key,propose-threshold,confirm-threshold,fork,merge}` 共 11 个治理子命令；bridge MTCA 守护进程；V6 widget 接入。
- **MTC v0.6 跨链桥集成**（commits `0123fd168` / `5a9898028`）：`cc crosschain mtc-batch / mtc-status` 把 MTC 树头作为跨链证明随消息上链；bridge MTC opt-in flag + e2e 覆盖。
- **CLI 0.161.2**：上述 30+ 子命令端到端集成测试（114 个），`cc audit mtc enable/disable/config/...` 双轨脚手架（off-by-default 等 Q-COMP-1/2 出函）。

### Changed

- **`docs-site/docs/chainlesschain/mtc.md` 全文重写** — 从 v0.3 (Phase 1+1.5, 154 测试, 6 子命令) 升级到 v0.11 (Phase 0–4 全量, 476 测试 / 6 层, 30+ 子命令)。新增章节涵盖 SLH-DSA-128F 双轨签名、联邦 M-of-N 多签、链下治理日志 + 11 事件类型、跨成员同步守护、quorum 门控、跨联邦互信锚（multi-hop）、离线审计器、链上 governance-anchor、Marketplace publisher daemon、cross-chain bridge 集成、audit MTC 双轨等。
- **三站 hero / changelog 同步** — `docs-site` package.json `5.0.3.4 → 5.0.3.5`；`docs-site-design` hero 更新 `v5.0.3.5 | CLI 0.161.2 | MTC v0.11`；`docs-website-v2` 已在 commit `31cb1c8a0` 完成。
- **electron-builder release path 修复**（commits `2cc8a6200` / `8c0dc5e8f` / `b050abafd` / `73415b67e`）：differential-update sidecars + ENOENT chainlesschain symlink + Windows distutils + 禁用 npmRebuild 让原生依赖走预编译路径。
- **桌面系统设置稳定性**（commit `b19f05966`）：BOM 容忍 + IPC export 修复 + schema gaps 补齐。
- **桌面回归测试加固**（commit `488ca8b11`）：`ensureOpsPlaybookDescription` 迁移路径 + `verify-release-artifacts` 测试覆盖。

### Why

v0.6→v0.11 是 MTC 从「Phase 3 联邦机制层完成」走向「Phase 4 治理 + 跨链 + 链上 + 监控完整运营层」的批次落地。`b312563f0` 标志着 MTC 不再是孤立的签名压缩工具，而是具备**联邦自治 + 跨联邦互信 + 链上不可篡改锚定 + 离线审计可复盘**的完整证书系统。本次发布把 v0.6 起的所有功能一次性 roll-up 进文档站，让用户文档与设计文档对齐到 v0.11 现状；MTC 用户文档的全文重写则是把"用户视角的 MTC"从 v0.3 快照刷新到 v0.11 完整能力面。

---

## [5.0.3.4 / CLI 0.160.1] - 2026-05-02 (Web Panel i18n M3 全覆盖 + V6 LanguageSwitcher + web-shell opt-out + projects folder picker)

### Added

- **Web Panel i18n M3 — ~25 视图国际化大批量收口**（commits `b69ed7cef` / `fac49c07d` / `1c9c8a9a1` / `431714a8b` / `0306474a8` / `f357289e9` / `c089ce07d` / `18524d971` / `5f45b6379` / `443d3eceb` / `91563a092` / `28b46d4bf` / `587534ef3` / `93d41459c` / `32ff8e36c` / `cb46f7755` / `fd61758a1` / `92792a52b` / `332ff60f6` / `89ba2cb5c` / `7eadd0565` 等）：把 web-panel 主要视图全部改用 vue-i18n 字典，覆盖 SpeechSettings / Analytics / Cron / Security / Templates / Search / Audit / McpTools / Backup / Tokens / Mtc / WebAuthn / Community / Wallet / Inference / Organization / Recommend / Federation / Reputation / AIOps / Projects 等 ~25 视图。中英双语贯通，硬编码字符串清零。
- **V6 Preview LanguageSwitcher**（commit `645b19f30`）：V6 preview 壳顶栏接入语言切换器，与 web-panel i18n 字典共享。
- **web-shell `--no-web-shell` dev opt-out + settings-authoritative precedence**（commit `9119bdec1`）：默认 ON 后给开发者保留快速回桌面 V6 壳的开关；setting 中显式选择优先于命令行。
- **`cc init --cwd` + projects folder picker**（commit `c935a95d4`）：projects 视图增加"打开已有文件夹"流，走 `cc init --cwd <dir>` 把任意目录初始化为 ChainlessChain 工作区。

### Changed

- 仓库根 `productVersion v5.0.3.1 → v5.0.3.3 → v5.0.3.4`（commit `8c68970cf` 起）；CLI npm 包 `0.158.0 → 0.160.0 → 0.160.1`（含 web-panel dist 重打包 commit `edaf61d2b`）。
- 三站 tagline / hero chip / 模块清单同步刷新到 v5.0.3.4 / CLI 0.160.1 / 112 命令。

### Why

i18n M3 是「web-panel V5→Web 全量化收官（Phase A+B+C+D = 23 ports）」之后的国际化补丁层，把所有迁移过来的 V2/V3/Phase 视图统一接入 vue-i18n。结合 V6 preview LanguageSwitcher，让 ChainlessChain 浏览器端 + 桌面端预览壳一次性获得中英双语能力。`--no-web-shell` 是 web-shell 默认 ON 后的运维出口；folder picker + `cc init --cwd` 则补齐了 projects "打开已有文件夹" 这条 V5 时代缺失的流程。

---

## [5.0.3.3 / CLI 0.160.0] - 2026-05-01 (MTC v0.5 — Phase 3 federation 全套 + libp2p auto-discovery)

### Added

- **MTC Phase 3.1 多签 landmark + `cc mtc federation {join,leave,status}`**：本地 registry（atomic write、`wx` race-safe），M-of-N 多签 landmark 生成。
- **MTC Phase 3.2 多签发布**：`cc mtc batch* / publish-skills --federation <id> --threshold <M>`，把已有 batch / skill 发布命令对接到联邦多签路径。
- **MTC Phase 3.3 `--transport filesystem` 跨进程发现**：drop-zone 跨进程发现（NFS / Syncthing / SMB / USB），自签 announce schema `mtc-federation-announce/v1` + TTL-evicting 名册。
- **MTC Phase 3.4 `--transport libp2p` 真 P2P auto-discovery**（commit `d75abe6e8`）：libp2p gossipsub topic `mtc-federation/v1/<id>` 自动发现，`Libp2pTransport` 加 `publishRaw / subscribeRaw` 通用 pubsub API（与 landmark 通道隔离）。
- **Backend Q-ENG-2 OperationLogService 桥接**：`cc audit mtc emit` 捕获 `event_id` 写回 `audit_mtc_event_id` 字段（V013 migration），web-panel `Audit.vue` 加 4 态 MTC 列徽章（— / 已签未查 / 待关批 / 已关批 #N）。
- **异构联邦支持**：同一联邦内 Ed25519 + SLH-DSA 节点共存，多签门限按签名抽象层验证。

### Fixed

- MTC v0.5 sweep（commit `f7e333a41`）：drawer 错调 `electronAPI.fs.readFile` → 改 `file.readContent`；libp2p 节点 init 异常路径 cleanup；filesystem discover daemon scan 重入锁；federation join `wx` 独占创建。

### 测试

- **476 MTC 测试全绿**：core-mtc 182 + CLI 89 + desktop 33 + web-panel 153 + backend 19，跨 6 层覆盖（unit / integration / e2e / desktop-renderer / web-panel-renderer / backend-spring）。

---

## [5.0.3.2 / CLI 0.159.0] - 2026-04-30 (MTC v0.4 + Phase 1.6 SLH-DSA + Phase 4 V6 widget)

### Added

- **`cc mtc publish-skills` marketplace publisher 守护进程**：JCS-canonicalize → SHA-256 fingerprint 差量检测 + 自动 seq 递增 + 状态文件原子写（temp + rename，崩溃不污染）。
- **`cc audit mtc {enable, disable, config, set-interval, emit, reconcile, reconcile-check, status}` 双轨脚手架**：每事件实时 Ed25519 落盘 + 关批 Merkle 树 inclusion proof，幂等关批 + atomic rename 崩溃恢复，schema/filename 三路验签拒伪事件。60s/3600s 双合规路径预留。
- **Phase 1.6 SLH-DSA real signing**（FIPS 205 后量子签名 hard-flip）：`--alg slh-dsa-128f` opt-in，原 Ed25519 路径仍默认。
- **Phase 4 V6 status widget**：`/v6-preview` 壳新增 MTC 状态 widget，跑流水显示 batch / federation / audit 三段。

### Changed

- `assembleBatch` 抽到 `core-mtc/lib/batch.js` 公用，CLI mtc / audit / 未来发布路径同一条装配代码。
- 设计文档 v0.3 → v0.4，docs-site 用户指南 + 设计站均同步。

### Note

> Audit 产线启用仍待 Q-COMP-1（等保三级最终性窗口）+ Q-COMP-2（T/ZGCMCA 023—2025 条款）法务出函；脚手架已就位，出函后单一 `cc audit mtc enable --interval <60|3600>` 即上线。

### 测试

- **222 测试全绿**：core-mtc 147 + CLI 64 + desktop V6 widget 11，四层覆盖 unit / integration / e2e / desktop-renderer。

---

## [5.0.3.1 / CLI 0.157.9] - 2026-04-27 (web-panel V5→Web 全量收官 — Phase B/C/D 一日连发)

### Added

- **Phase B 收官 — 普惠与去中心化 10/10**（commits `367132348` / `c304b9d8b` / `10f3451a6` / `864873047` / `bfeb8091f`，CLI 升 `0.157.7`）：
  - B6 `/privacy` — FL 联邦学习 + MPC 多方计算 + DP 差分隐私 + HE 同态加密（`cc privacy`）
  - B7 `/inference` — 节点注册 + 任务调度 + 隐私模式（`cc inference`）
  - B8 `/nlprog` — 意图分类 + 实体抽取 + 翻译 + 编码约定（`cc nlprog`）
  - B9 `/tenant` — 4 档计划 + 用量计量 + 配额检查 + MRR（`cc tenant`）
  - B10 `/pipeline` — 7 阶段流水线 + 部署策略 + 模板（`cc pipeline`）
- **Phase C 治理与可观测 5/5**（commits `f25896cd2` / `bc52ad5ec` / `3b0f17292` / `02fb827c4` / `c80cd2292`，CLI 升 `0.157.8`）：
  - C1 `/governance` — 提案 + 加权投票 + 影响分析 + 预测置信度（`cc governance`）
  - C2 `/audit` — 审计日志检索 / 过滤 / 导出 + 合规留存（`cc audit`）
  - C3 `/reputation` — exp/linear/step 衰减 + z_score/iqr 异常 + 模拟贝叶斯（`cc reputation`）
  - C4 `/recommend` — 兴趣画像 + 主题评分 + 时间衰减 + 反馈回路（`cc recommend`）
  - C5 `/sla` — 分级目录 + 方向感知偏离 + p95 + 补偿封顶（`cc sla`）
- **Phase D 收尾 5/5**（commits `fa8479d49` / `da852045d` / `6e1941beb` / `6b7ac0985` / `a7909b8a6`，CLI 升 `0.157.9`）：
  - D1 `/codegen` — 生成跟踪 + 5 规则安全审查 + 脚手架目录（`cc codegen`）
  - D2 `/search` — 多维搜索 / 日志查看（`cc search`）
  - D3 `/tokens` — Token 账本 + 7 类贡献奖励 + 排行榜（`cc incentive`）
  - D4 `/trust` — 信任根 + PQC 互操作 + 卫星 + HSM（`cc trust`）
  - D5 `/federation` — 熔断器 FSM + 健康检查 + 连接池 + 节点健康聚合（`cc federation`）

### Changed

- **web-panel 路由数 28 → 50（+22）**：cumulative Phase A (3) + B (10) + C (5) + D (5) = 23 V5→Web 端口完成。从此 `cc ui` 浏览器端与桌面 Electron 端功能对等覆盖去中心化身份 / 知识图谱 / 跨链 / 隐私计算 / 推理网络 / NL Programming / 多租户 / Pipeline / 治理 / 审计 / 信誉 / 推荐 / SLA / 代码生成 / 信任根 / 联邦熔断 全部子系统。
- **web-panel 单元测试 27 → 1489 全绿**（含全部 Phase A/B/C/D parser）。
- 仓库根 `productVersion v5.0.2.55 → v5.0.3.1`（V6 hard-flip 后的 minor bump，跳过 `.3.0` CI hotfix 占位）。
- 三站 tagline / hero chip / 模块清单同步刷新到 v5.0.3.1 / CLI 0.157.9 / 50 routes。

### Why

继 2026-04-26 web-panel Phase A + B (1–5) 落地之后，今日（2026-04-27）一天内连续完成 B6–B10 + Phase C + Phase D 共 15 个新视图，**完成 V5→Web 全量化迁移**。所有视图遵循机械模板 = `<feature>-parser.js`（含 `stripCliNoise`） + `<Feature>.vue` + router/sidebar 接线 + parser 单测 + 路由计数 +1 + 路径断言。CLI 三次 bundle release（0.157.7 / 0.157.8 / 0.157.9）每次随 web-panel `dist/` 资产 hash 同步刷新（commits `de3da1fd7` / `dc44c91b8` / `589a7acd8` / `1faa9e11f`）。

### 测试

- web-panel 单元：`1489/1489`（27 → 1489，覆盖率 ×55 增长）
- vite build 全绿，所有 chunk gzip 后均 ≤ 30 kB

---

## [Unreleased] - 2026-04-26 (V6 shell 硬翻 + top-10 parity 10/10 + web-panel Phase A)

### Added

- **V6 widget probe 6 颗**：每颗按 5-7 文件模板（plugin.json + Widget + Panel + 可选 thin store + AppShell wiring + 集成测试），贡献 `/<route>` slash + Home 页 widget + Phase 3.3 modal panel
  - `did-management` → `/did` (commit `35f4e278b`，thin store 包 `did:get-all/get-current/set-default`)
  - `projects` → `/projects` (commit `a097596f5`，thin store 包 `project:get-all` recent-5)
  - `p2p-messaging` → `/p2p` (commit `3883a72ec`，thin store 包 node-info/peers/nat-info graceful)
  - `community` → `/community` (commit `5b5e6fe1d`，thin store 包 `community:get-list`)
  - `ai-chat` → `/chat` (commit `396d6e7b1`，gating route，thin store 包 `llm:check-status` + `llm:get-config`)
  - `settings` → `/settings` (commit `ccbc312fd`，pure-info panel 列出 7 个 SystemSettings sub-pane)
- **web-panel `/did` + `/knowledge` + `/project-settings` 三路由**（commits `f37aa44d0` / `c0e96c9e0` / `d1f22ce2d`）
  - `/knowledge` 4-tab：力导向图（ECharts）/ 实体表 / 关系表 / 类型分布；CRUD + 多跳 BFS reasoning，全部走 `cc kg --json`
  - `/did` 复用 `cc did *`；助记词/DHT 按钮 disabled + tooltip "桌面专属"
  - `/project-settings` 4 字段，走 `cc config get/set project.*`，`diffProjectConfig` 只对改动字段发 set
- **新依赖**：`echarts ^6` + `vue-echarts ^7`（web-panel）
- **预约 remote agent**：`trig_013pjiuMPAUkNyoE4QxVdee8` 在 2026-05-10 09:00 Asia/Shanghai 自动巡检 V6 硬翻部署后 14 天的 git/issue/test/notes 状态

### Changed

- **V6 shell 默认开关硬翻**（commit `caaddf530`）：
  - `router/v6-shell-default.ts` 初始 `useV6ShellByDefault` `false → true`
  - `main.ts` `setV6ShellDefault(raw === true) → setV6ShellDefault(raw !== false)` — 配置未设值默认 V6，仅显式 `false` 才回 V5
  - `SystemSettings.vue` 表单 initializer 与描述文字同步
  - opt-out 通道与 `resolveHomeRedirect()` 纯函数都没动（"no other code needs to move"）

### Fixed

- **SystemSettings "立即试用" link 漂移**（commit `72b826bdf`）：之前 `router.push("/v2")` 但 router 守卫 redirect 是 `/v6-preview`，两处统一到 `/v6-preview`

### Why

继 2026-04-21 Phase 3.4 软开关之后，top-10 V5 routes 还差 6 个没 V6 widget。这次一口气补齐 (settings/projects/chat/did/p2p/community)，凑出 V6 hard-flip parity 条件。硬翻保留 opt-out 开关，老用户出问题可一键回 V5；同时预约 14 天后的自动巡检 agent 监控回归信号。

### 测试

- 19/19 plugin-extension-points integration · 8/8 slash-dispatch · 9/9 v6-shell-default · 621/621 web-panel unit · 509/512 desktop integration（3 失败 pre-existing 网络依赖，非今日引入）

---

## [Unreleased] - 2026-04-26 (默克尔树证书 MTC Phase 1 + 1.5 全部落地)

### Added

- **`@chainlesschain/core-mtc` 新包**：完整 MTC 协议实现，137 测试全绿
  - RFC 6962 Merkle 树（`MerkleTree` 类，O(log n) 取证 + 子树根 memo）
  - Verifier 纯函数（按数据格式 §11 错误码）+ LandmarkCache 含 split-view 防御
  - LandmarkCache 持久化（`persistDir` + `loadFromDisk`，篡改检测）
  - Ed25519 真实签名（`lib/signers/ed25519.js`，stopgap，待 SLH-DSA `@noble/post-quantum`）
  - 4 种传输：InMemoryTransport / FilesystemTransport（drop-zone）/ Libp2pTransport direct（TCP+Noise+Yamux）/ Libp2pTransport gossipsub（@chainsafe/libp2p-gossipsub@14）
- **`cc mtc` CLI 6 子命令**（17 集成测试全绿）：
  - `cc mtc batch <input>` — 通用批次构造
  - `cc mtc batch-dids` — 从本地 DID DB 读身份构造批次
  - `cc mtc batch-skills` — 从本地 CLI 技能构造批次（Marketplace 路径）
  - `cc mtc verify <envelope> --landmark <landmark>` — 验证 inclusion proof
  - `cc mtc landmark inspect` — 查看 landmark 元信息
  - `cc mtc serve` — verifier 守护进程（订阅 + 持久化 + 自动验证）
- **设计文档**：`docs/design/默克尔树证书_MTC_落地方案.md` v0.3、`MTC_数据格式_v1.md` v0.1、`默克尔树证书_MTC_v0.2_评审清单.md`

### Why

为 ChainlessChain 切换到后量子签名（SLH-DSA-128f）做准备。直接套 PQC 会让 DID 文档单签从 64 B 暴涨到 17 KB，DHT 周流量从 5 GB 涨到 170 GB（不可接受）。MTC 通过批量签发 + Merkle inclusion proof 把单证书携带物压回 ~700 B，**节省约 97%**。

借鉴 IETF PLANTS WG 的 [Merkle Tree Certificates](https://datatracker.ietf.org/doc/draft-ietf-plants-merkle-tree-certs/) 协议（draft-ietf-plants-merkle-tree-certs-02），与 Cloudflare + Google Chrome 联合推进的 HTTPS 后量子证书方案同源。

---

## [5.0.2.54 / CLI 0.156.7] - 2026-04-26 (技能数对齐 141 · ws-server CI 解锁 · release-tag 链路修复)

### Fixed

- **release-tag 工作流**: v5.0.2.53 的 `create-release` 步因走旧路径执行了 `--cleanup-tag`（先删后建），命中 GitHub "tag was used by an immutable release" 锁定窗口，HTTP 403。改成 `gh release edit`（存在则就地编辑，否则 create），避开 delete+recreate 循环，新 tag 正常落地。
- **CI ws-server 集成测试解锁**: `wss.close()` 增加 2s 硬上限超时熔断，CI 上不再因 socket 残留挂死整个测试套件。

### Changed

- **桌面技能数全面对齐 141**: 文件系统真实数 144（其中 3 个为模板/示例 skills 不计入用户面），跨 9 个文件 16 处「139 内置技能」统一刷新到 141。覆盖 README header、`docs-website-v2`（web/desktop/cli/BaseLayout/Terminal/index 共 5 文件）、`docs-site/overview.md`（3 处）、`packages/cli/README.md`（2 处）、`AnalyticsDashboardPanel.vue` 与 CLAUDE.md。
- 仓库根 `productVersion` `v5.0.2.53 → v5.0.2.54`（commit `d343fe50b`），CLI npm 版本保持 `0.156.7`。
- 桌面端持续 SFC 拆分推进：`AdditionalToolsStats.vue` 抽出 chart-image 导出 helpers，`MainLayout.vue` 抽出 `getMenuIcon`，`ChatPanel.vue` 再抽 5 个 helper，`MCPSettings.vue` 拆出 `MCPToolTestModal` + `mcpToolUtils`，`ProjectsPage.vue` / `PreviewPanel.vue` 抽纯函数，新增 `useProjectGit` composable。

---

## [5.0.2.53 / CLI 0.156.7] - 2026-04-25 (docs-gen 链路收口 · pack 错误信息增强 · CI E2E 拆批)

### Fixed

- **docs-gen 链路稳定化**:
  - `validate-docs` 在 artifact 缺失时降级为 warning 而非 fail（修自动 release tag 链路偶发抖动）。
  - 自动触发的 docs-gen 跳过 changelog 重生，避免 per-push 反复 churn；只在 release tag 上重生 CHANGELOG。
  - `releaseNotes` 死配置移除；release-tag 工作流改为 edit-in-place 而非 delete+recreate，避开 immutable-tag lock 报错。
- **`cc pack` 安装上下文感知**: 当 `@yao-pkg/pkg` 缺失时，输出按当前是 npm 全局/项目本地/源码仓库三种安装方式分别给出对应 `npm i -D / npm i -g` 提示，避免用户拿到通用一句话而无所适从。
- **CI 稳定性**: CLI E2E 套件按 vitest pool 拆 2 批，避免 RPC timeout（>60s 整批挂掉）。

### Changed

- 仓库根 `productVersion` `v5.0.2.52 → v5.0.2.53`（commit `3c97894f9`），CLI npm 版本保持 `0.156.7`。

---

## [5.0.2.52 / CLI 0.156.7] - 2026-04-25 (AIChatPage 工具外提 · 死测试清理 · CI 稳定性)

### Added

- **AIChatPage.vue 纯工具外提** — 从渲染器最大组件抽出 `aiChatPageUtils.js`，把无 reactive 依赖的 helper（path/filename 处理、IPC 数据清洗等）下沉到 sibling 文件，为后续按区域拆 SFC 做准备。

### Fixed

- **CI 稳定性**:
  - `ws-server-workflow` 整 describe 在 CI 环境 skip（本地仍跑），消除 60s+ 超时挂死。
  - 4 个 ws-integration 测试在 CI skip（>60s hang）。
  - `pipeline integration` 在 Linux host 改用 foreign target，避免 host-arch 检测路径差异。
  - `ws-server-workflow` 单测 timeout 提到 60s。

### Changed

- **死代码清理**:
  - 移除 10 个 skip-only 测试 shell（−5856 行），它们只剩 `describe.skip`/`it.skip` 没有实际断言，留着只增加 noise。
  - `ws-server-workflow` 内层 `skipOnCI`/`itCI` 哨兵移除（外层 describe.skip 已覆盖）。
- 仓库根 `productVersion` `v5.0.2.51 → v5.0.2.52`（commit `ed7d9bb64`）。

---

## [5.0.2.51 / CLI 0.156.7] - 2026-04-24 (precheck 跨平台修复 · pack --project 侧边栏)

### Fixed

- **`cc pack` precheck**: POSIX 下 `cliRoot` 解析与 `runtime-factory` 的 `uiMode` 推断口径对齐，修部分 Linux/macOS 环境下 precheck 误报"非 CLI 工作区"。
- **docs-gen 头部稳定**: 自动生成的文档头去掉 volatile ISO 时间戳，避免每次 push 都产生纯时间戳 diff。
- **CI 矩阵**: cli-ci 矩阵改 `fail-fast: false`，让一个矩阵格失败不再连带杀掉其他平台/Node 版本。

### Added

- **设计文档站侧边栏**: `cc pack --project 项目模式` 设计文档入口加入设计站侧边栏 `/cc-pack-project-mode-design`。

### Changed

- 仓库根 `productVersion` `v5.0.2.50 → v5.0.2.51`（commit `2b0c5027e`）。

---

## [5.0.2.50 / CLI 0.156.7] - 2026-04-24 (cc pack 项目打包 · OTA 三段 · Linux x64 流水线)

### Added

- **`cc pack` 命令首发（Phase 0+1）** — 把当前 ChainlessChain CLI 工作区 + node_modules 打成单文件可执行程序（基于 `@yao-pkg/pkg`）。最小入口：`cc pack` → `dist/chainlesschain-portable-<target>.exe`。配套首版 design doc。
- **`cc pack --project` 项目模式（Phase 2a-3b 全量落地）**:
  - **Phase 2a · BAKED 字段** — 项目根的 `.chainlesschain/` 内容（config / skills / rules / persona）被烤进产物，配合 `sanitizeProjectName` + `CC_PROJECT_ROOT` 环境变量串起项目身份。
  - **Phase 2b · `GET /api/skills` 实接线** — `web-ui-server.js` 暴露 `{schema:1, skills:[…]}` 端点（SPA + minimal 双路径），由 `CLISkillLoader.loadAll()` 驱动；smoke-runner 从 pre-wired 升级为真实断言（保留 v0.3 的 404 容忍分支作前向兼容）。
  - **Phase 3a · 子命令白名单** — Commander `allowedCommands` 收敛产物可用子命令面（项目模式默认只暴露与该 persona 相关的命令）。
  - **Phase 3b · 自动 persona + manifest sidecar** — 产物启动时自动激活项目 persona（`CC_PACK_AUTO_PERSONA`），同时输出 `<artifact>.pack-manifest.json` 描述 bundledSkills / persona / 构建时戳。
  - 配套 design doc 升级到 v0.4，单元 + 集成 + e2e stub 测试齐全。
- **OTA 自更新三段（Phase 5a-5c）**:
  - **5a `cc pack check-update`** — 探测远端 OTA manifest，比对本地 artifact 与远端最新版本。
  - **5b 制品下载 + SHA-256 校验** — 流式下载 + 校验失败回滚。
  - **5c `--apply` 自替换** — POSIX 走 atomic rename，Windows 走 sidecar 脚本（绕开 Windows 文件锁）。
- **Phase 4a · Linux x64 打包流水线** — CI 加 Linux x64 矩阵格 + 守卫，保证 Linux 产物随每次 release 一并打出。
- **`@chainlesschain/core-db` sql.js WASM 兼容层** — `loadSQLiteDriver` 增加 ABI probe，better-sqlite3 不可用时优雅降级到 sql.js（首屏不再因 native 缺失硬挂）。
- **桌面端 HarnessTaskDrawer 拆分** — 从 ChatPanel 抽出独立 SFC，浏览器扩展相关 IPC handler 同步拆出。

### Fixed

- **桌面端 6 个页面 `$router` 替换为 `useRouter()`** — 修 setup script 中误用 options-API 全局 `$router` 导致 hot-reload 边界偶发 undefined。
- **`desktop-app-vue` electron forge 打包路径疏通**。

### Changed

- **CLI npm**: `chainlesschain@0.156.6 → 0.156.7`。
- **仓库根**: `productVersion v5.0.2.49 → v5.0.2.50`（commit `cd98f4dc9`）。
- 三站 tagline 与 deploy 脚本同步刷到 v5.0.2.50 / CLI 0.156.7。

---

## [5.0.2.49 / CLI 0.156.6] - 2026-04-22 (V6 Preview 工具/任务 widget · ClaudeBox 工具卡 · XSS 防护收口 · IPC 契约锁定)

### Added

- **V6 Preview Shell 工具/任务 Widget** — `/v6-preview` 新增工具调用与任务进度两个 Widget；web-panel ClaudeBox 风格工具卡同步在 Chat View 上线（Phase 75 路由子页计数刷新到 27）。
- **跨平台 postinstall** — `chainlesschain` npm postinstall 改写为 Node 脚本（不再依赖 bash），修 Windows 全局安装时 `bash: not found` 失败。
- **IPC 契约测试锁定**:
  - `agents` / `autonomous` / `ai-engine` IPC channel 契约测试。
  - `code-agent-ipc` handler 覆盖。
  - `a2a` + `collaboration-governance` + `tech-learning` handler 覆盖。

### Fixed

- **XSS 防护双补丁**:
  - 所有 `v-html` 路径强制走 sanitizer，对应 lint rule 从 warn 翻成 error。
  - `renderMarkdown` 通过 DOMPurify 串接，GlobalSearch 高亮路径同步修复。
- **CI**: 桌面 unit-test matrix 加入 macOS 平台。

### Changed

- **CLI 治理 v2 共享 helpers 抽取** — 把分散在多个 V2 governance surface 的样板代码抽进 `governance-v2` 共享模块，并附迁移指南；后续 V2 surface 添加复杂度下降。
- **CLI npm**: `chainlesschain@0.156.5 → 0.156.6`。
- **仓库根**: `productVersion v5.0.2.43 → v5.0.2.49`（commit `fdc9df624`，跳过 .44–.48 未发布的中间号）。
- **文档**:
  - Signal Protocol 依赖风险与迁移选项设计文档落地。
  - God Component 拆分路线图（AIChatPage.vue + background.js）入设计文档。

---

## [5.0.2.43 / CLI 0.156.6] - 2026-04-22 (MainLayout + DIDManagement SFC 拆分 · Shell 接入真实 LLM · 启动流程拆 Critical/Deferred · 重型组件懒加载 · CLI postinstall 跨平台)

### Fixed

- **CLI `postinstall` 跨平台** — `chainlesschain@0.156.5` 把 postinstall 脚本改写成跨平台 Node 实现，修复 Windows 全局安装时 `bash: not found` 导致失败的问题；`0.156.6` 为随后的打包补丁。

### Added

- **MainLayout.vue 六级拆分** — 把原 3203 行桌面壳按功能切成 6 个独立 SFC，累计 **3203 → 1943 行（−39%）**：
  - `FavoriteManagerModal.vue`（151 行） — "管理快捷访问" 弹窗，Favorites / Recents Tab。
  - `HeaderBreadcrumbs.vue`（170 行） — 135 行 `breadcrumbs` computed（7 路由前缀分支），router.push 点击处理。
  - `SyncStatusButton.vue`（97 行） — 全局同步状态按钮，自管 `isSyncing` / `syncStatus` / `syncError` + 3 个事件监听。
  - `VoiceCommandHandler.vue`（584 行） — `VoiceFeedbackWidget` + 75 条语音命令模式表 + 7 个语音识别/转发 handler。
  - `SidebarContextMenu.vue`（97 行） — 侧边栏右键菜单，`show(event, item)` 命令式暴露，14 个调用点不变。
  - `AppHeader.vue`（210 行） — `<a-layout-header>` 整块（侧栏切换 / 面包屑 / Ctrl+K / 同步 / AI / 语言 / 通知 / 用户菜单）。
- **DIDManagement.vue 三级拆分** — 把原 1390 行组件切成 3 个子组件，累计 **1390 → 543 行（−61%）**：
  - `AutoRepublishSettingsPane.vue`（148 行） — 自动重发布设置弹窗 + 状态轮询。
  - `MnemonicModals.vue`（308 行） — 助记词展示 + 导出两个弹窗合一，`defineExpose({showDisplay, triggerExport})` 命令式 API。
  - `IdentityDetailsModal.vue`（约 421 行） — 身份详情 / DID Document / QR 三个弹窗合一 + DHT publish/unpublish。
- **Shell 接入真实 LLM** — V6 预览壳 ShellComposer 真正可发消息：
  - `handleSend()` 接入 `llm-preview-bridge`：优先 `sendChatStream` (prompt-only) 走 `queryStream` 流式；失败回退 `sendChat` (带 history) 非流式。
  - ConversationStream 新增 typing indicator（3 点波浪），无 DID chip 视觉噪音。
  - 开发基于现有 `useConversationPreviewStore`：`beginStreamingAssistant` / `updateAssistantContent` / `finalizeStreamingAssistant` / `removeMessage`。
- **主进程启动拆 Critical / Deferred** — `bootstrap` 按阶段分两段，`main/index.js` 改走 fast-start：
  - `bootstrapCritical()` 仅跑阶段 0-5（Hooks / 核心 / 文件 / LLM / 会话 / RAG+Git），splash 5-55%。
  - `bootstrapDeferred()` 跑阶段 6+，splash 55-90%。
  - IPC 注册拆 `registerCriticalIPC()` + `registerDeferredIPC()`，setupIPC 在 `createWindow` 内仅调用一次（避免 `llm:chat` / `conversation:*` 二次注册与 ipc-guard 竞态）。
  - `CHAINLESSCHAIN_LEGACY_BOOT=1` 保留旧单阶段启动回退开关。
- **重型渲染器组件懒加载** — 5 个重型编辑器改 `defineAsyncComponent`：
  - `FileEditor.vue` → Monaco（~5MB）。
  - `KnowledgeDetailPage.vue` → Milkdown MarkdownEditor（~1.5MB）。
  - `DesignEditorPage.vue` → Fabric.js DesignCanvas（~1MB）。
  - `ProjectDetailPage.vue` → CodeEditor / MarkdownEditor / WebDevEditor 一次三件（共 ~5MB）。
  - 实测 monaco 独立 chunk 3.7MB / gzip 938KB，首屏不再强拉。
- **后端服务并行轮询** — `BackendServiceManager`：
  - 4 个服务改并行轮询（原串行 4×30s），单服务最多 10s，新增 `servicesReady` Promise 供调用方 await。
  - `startServices()` 不再阻塞启动，触发后即返回。

### Changed

- **Phase 3.4 软开关重定向目标：`/v2` → `/v6-preview`** — `router/v6-shell-default.ts::resolveHomeRedirect` 的 opt-in 目标由 `/v2` 改为 `/v6-preview`（Claude-Desktop 风格预览壳），让默认开启场景直接进入真实可用的新壳；同步 9/9 单测 + JSDoc 注释已对齐。
- `SyncStatusButton` 取消 prettier 多行格式，紧跟项目样式规范。
- `components.d.ts` 自动生成文件分号风格对齐。

### Verified

- Store 测试 **600/600** 绿（23 文件，35s）。
- Shell + router + bootstrap 定向测试 **76/76** 绿（5 文件）。
- Skill-handlers + ipc-guard + bootstrap **285/285** 绿。
- Vue 组件测试 **124/125（1 skip）**。
- AI + core + multi-agent 单元测试 **411/413（2 skip）**。
- Database + enterprise + did + knowledge 单元测试 **1456/1464（8 skip）**（3 stderr 错误是预存在的测试脚手架 `no such table: skills` / `pubsub.addEventListener`，非本次引入）。
- shell-preview 组件/服务/widgets **51/51** 绿。
- 集成测试（mcp / canonical-tool / canonical-workflow / code-execution / file-ops / plugin-ext / coding-agent-hosted-tools / planning-ipc / lifecycle）**98/104（6 skip）**。
- Smoke：`vite build` + `build:main` 均成功；`eslint` 0 errors。
- E2E：playwright 1017 测试 / 163 文件全部可枚举；环境健康检查 80%。

---

## [5.0.2.43 / CLI 0.156.4] - 2026-04-21（下午）(SystemSettings / ChatPanel SFC 拆分 + CI/Release 修复)

### Added

- **SystemSettings.vue 六级 Pane 拆分** — 把原 3444 行单文件按功能切成 6 个独立 SFC：
  - `P2PNetworkPane.vue`（830 行） — 流量层 / WebRTC / NAT / Circuit Relay / 网络诊断
  - `SpeechRecognitionPane.vue`（421 行） — Web Speech / Whisper API / Whisper Local / 音频处理
  - `LLMPane.vue`（622 行） — 7 个 Provider 表单 + 对话/嵌入连通性测试
  - `DatabasePane.vue`（约 280 行，自包含） — db 位置 / 迁移 / 备份管理
  - `ProjectPane.vue`（74 行） — 项目根路径设置
  - `PerformancePane.vue`（62 行） — 硬件加速 / GPU / 内存 / 缓存滑块
  - 统一采用 `defineModel('config')` + `v-model:config` 模式，子组件可直接改嵌套 `config.*.*` 路径；最终 SystemSettings.vue **3444 → 1070 行（−69%）**。
- **ChatPanel.vue 两级外提** — 从 4057 行组件抽出两个可复用模块：
  - `chatPanelUtils.js` — 7 个纯工具（`sanitizeJSONString` / `sanitizeFileName` / `getDirectoryPath` / `joinPath` / `resolveProjectOutput` / `cleanForIPC` + `WINDOWS_RESERVED_FILE_NAMES`）。
  - `composables/useMemoryLeakGuard.js` — 封装 `activeTimers` / `activeListeners` + `safeSetTimeout` / `safeRegisterListener` + 自动 `onUnmounted` 清理；对任何跟踪 `electronAPI.*.on` 监听器的组件都可复用。
  - ChatPanel.vue **4057 → 3788 行（−269）**。
- **CLI 0.156.2 → 0.156.4** — 0.156.3 已被 npm 占用，跳到 0.156.4 再发布。

### Changed

- 三站 CLI 版本号统一刷新：用户文档 tagline / 官网首页 chip / 设计站 tagline 全部 `0.156.2` → `0.156.4`。
- 设计站 tagline 修正历史遗留 `v5.0.2.34 / CLI 0.156.0` 为 `v5.0.2.43 / CLI 0.156.4`。

### Fixed

- **CI/Release 打包链** — 多个 commit 修 release 产物：
  - `rsync --ignore-existing` 替代 `cp -Rn` 做 node_modules 合并。
  - 跨 workspace 安装平台专属 rollup 原生 binary（E2E workflow）。
  - 重写 `@chainlesschain/*` workspace symlink 为绝对路径，避免打包后链接指空。
  - `xcopy` 永远把 hoisted `node_modules` 拷进发布包。
  - CLI publish 在 npm 已有同版本时跳过（避免 409）。

---

## [5.0.2.43 / CLI 0.156.2] - 2026-04-21（上午）(发布前测试回归闭环 + 533 自动文档刷新)

### Added

- **发布前测试回归闭环** — 92 单元测试 + 5 集成测试 + `vue-tsc --noEmit` + `vite build` + `describe.skip` E2E **五关全绿**，无 bug 溢出。
- **533 份自动文档刷新** — `desktop-app-vue/docs/api/generated/*.md` prettier list/heading 规范刷新，`ARCHITECTURE_OVERVIEW.md` + `COMPONENT_REFERENCE.md` 格式同步。
- **CLI 0.156.1 → 0.156.2** — patch 补丁（无源码改动，用于 v5.0.2.43 npm 发布）。

### Changed

- 三站版本号统一刷新：`docs-website-v2` 官网 footer + `/desktop` chip + `index.astro` 首页 hero chip 全部 `v5.0.2.34` → `v5.0.2.43`，CLI chip `v0.156.0` → `v0.156.2`。

---

## [5.0.2.42 / CLI 0.156.1] - 2026-04-20 晚 (V6 Shell 回归闭环 + 用户文档)

### Added

- **V6 Shell + `/v6-preview` 用户文档** — `desktop-v6-shell.md` 新增 §18 "P7–P9b 预览壳" 全套 + §18.7 测试回归表；`desktop-ui-refactor-user-guide.md` 新建 355 行用户指南；6 份核心指南追加 17 章规范附录。
- **设计文档** — `docs/design/桌面版UI重构_设计文档.md` 458 行，含 10 章 + 附录 A/B。

### Changed

- `sync-docs.js` / `sync-design-docs.js` 加入新中文 → ASCII 映射；两站 VitePress sidebar 加入新条目。

---

## [5.0.2.34 / CLI 0.140-0.142] - 2026-04-19 (V2 第十批 · 16 个编排/自治/经济/进化 lib 级治理表面)

### Added — 16 个 V2 lib 级治理表面（严格增量 · 内存 governance · 与运行态 / 传输层 / 协议层完全独立）

- **`orchestrator` V2**（`cc orchgov`）— 编排 profile 4-state（retired 终态、paused→active 恢复）+ task 5-state（3 终态），per-owner active cap 6、per-profile pending cap 12，`autoPauseIdle` + `autoFailStuck`；45 V2 单测（gov-stats-v2 独立，避开已有 `cc orchestrate router *-v2`）。
- **`perf-tuning` V2**（追加到现有 `cc perf`）— tuning profile 4-state（decommissioned 终态、stale→active 恢复）+ bench 5-state（3 终态），per-owner 6、per-profile 10，`autoStaleIdle` + `autoFailStuck`；45 V2 单测（Phase 22 SQLite 不动）。
- **`topic-classifier` V2**（`cc topiccls`）— classifier profile 4-state（archived 终态、stale→active 恢复）+ job 5-state（3 终态），per-owner 8、per-profile 20，`autoStaleIdle` + `autoFailStuck`；45 V2 单测。
- **`iteration-budget` V2**（`cc itbudget`）— budget profile 4-state（exhausted 终态、paused→active 恢复）+ run 5-state（3 终态），per-owner 4、per-profile 8，`autoPauseIdle` + `autoFailStuck`；45 V2 单测。
- **`git-integration` V2**（`cc git`）— repo profile 4-state（decommissioned 终态、archived→active 恢复）+ commit 5-state（3 终态），per-owner 10、per-profile 20，`autoArchiveIdle` + `autoFailStuck`；45 V2 单测。
- **`cowork-task-runner` V2**（`cc cowork runner-*-v2`）— runner profile 4-state（retired 终态、paused→active 恢复）+ exec 5-state（3 终态），per-owner 8、per-profile 15，`autoPauseIdle` + `autoFailStuck`；45 V2 单测（`runner-*` 前缀避开 Agent Coordinator V2 冲突）。
- **`inference-network` V2**（`cc inference`）— node profile 4-state（decommissioned 终态、degraded→active 恢复）+ job 5-state（3 终态），per-owner 12、per-profile 25，`autoDegradeIdle` + `autoFailStuck`；45 V2 单测（与已有 task-scheduling V2 共存于同文件）。
- **`content-recommender` V2**（`cc recommend cr-*-v2`）— recommender profile 4-state（archived 终态、stale→active 恢复）+ job 5-state（3 终态），per-owner 8、per-profile 10，`autoStaleIdle` + `autoFailStuck`；45 V2 单测（`cr-*` 前缀避开 content-recommendation.js V2）。
- **`app-builder` V2**（`cc lowcode`）— app profile 4-state（archived 终态、paused→active 恢复）+ build 5-state（3 终态），per-owner 10、per-profile 20，`autoPauseIdle` + `autoFailStuck`；45 V2 单测。
- **`siem-exporter` V2**（`cc siem`）— SIEM target 4-state（retired 终态、degraded→active 恢复）+ export 5-state（3 终态），per-owner 8、per-profile 50，`autoDegradeIdle` + `autoFailStuck`；45 V2 单测。
- **`autonomous-agent` V2**（`cc autoagent`）— autonomous agent profile 4-state（archived 终态、paused→active 恢复）+ run 5-state（3 终态），per-owner 5、per-profile 10，`autoPauseIdle` + `autoFailStuck`；45 V2 单测（与交互式 `cc agent` 分离）。
- **`compliance-framework-reporter` V2**（`cc compliance fwrep-*-v2`）— framework profile 4-state（archived 终态、deprecated→active 恢复）+ report 5-state（3 终态），per-owner 8、per-profile 15，`autoDeprecateIdle` + `autoFailStuck`；45 V2 单测（`fwrep-*` 前缀避开已有 compliance V2）。
- **`agent-economy` V2**（`cc economy`）— account profile 4-state（closed 终态、frozen→active 恢复）+ tx 5-state（3 终态），per-owner 20、per-profile 30，`autoFreezeIdle` + `autoFailStuck`；41 V2 单测（默认 currency=CLC）。
- **`pipeline-orchestrator` V2**（`cc pipeline`）— pipeline profile 4-state（archived 终态、paused→active 恢复）+ run 5-state（3 终态），per-owner 10、per-profile 20，`autoPauseIdle` + `autoFailStuck`；41 V2 单测。
- **`evolution-system` V2**（`cc evolution`）— evo goal profile 4-state（archived 终态、paused→active 恢复）+ cycle 5-state（3 终态），per-owner 6、per-profile 12，`autoPauseIdle` + `autoFailStuck`；41 V2 单测。
- **`hierarchical-memory` V2**（`cc hmemory`）— tier profile 4-state（retired 终态、dormant→active 恢复）+ promotion 5-state（3 终态），per-owner 12、per-profile 30，`autoDormantIdle` + `autoFailStuck`；41 V2 单测（默认 level=short-term）。

### Changed

- **CLI 包版本**：`chainlesschain@0.137.0 → 0.142.0`（V2 第十批分多次推进，每次落 2 ~ 4 个 lib 级 surface）
- **design doc 96**：新增"第十批（编排 / 自治 / 经济 / 进化治理层 · 16 个）"章节，版本演进累计更新为 92+ V2 表面

### Tests

本批相较 0.139.0 累计新增 **704 个 V2 单元测试**（12 × 45 + 4 × 41），零回归。

| 层级 | 文件 | 测试 | 状态 |
| --- | --- | --- | --- |
| CLI 单元 | 274 | **11718 / 11718** | 全通过（125s）|
| CLI 集成 | 40 | **696 / 696** | 全通过（40s）|
| CLI E2E | 38 | **565 / 565** | 全通过（360s）|
| **合计** | **352** | **12979 / 12979** | **零回归** |

---

## [5.0.2.34 / CLI 0.137-0.139] - 2026-04-19 (V2 第九批 · 14 个 session/context/permission/social lib 级治理表面)

### Added — 14 个 V2 lib 级治理表面（严格增量 · 内存 governance · 与 session.db / 角色表 / DI 容器 / 社交边零耦合）

- **`slot-filler` V2**（`cc slotfill`）— template profile 4-state（archived 终态、stale→active 恢复）+ fill 5-state（3 终态），per-owner 10、per-profile 20，`autoStaleIdle` + `autoFailStuck`；37 V2 单测。
- **`web-fetch` V2**（`cc webfetch`）— target profile 4-state（retired 终态、degraded→active 恢复）+ job 5-state（3 终态），per-owner 12、per-profile 30，`autoDegradeIdle`（7d）+ `autoFailStuck`（60s）；37 V2 单测。
- **`memory-injection` V2**（`cc meminj`）— rule profile 4-state（archived 终态、paused→active 恢复）+ injection 5-state（3 终态），per-owner 10、per-profile 25，`autoPauseIdle` + `autoFailStuck`；37 V2 单测。
- **`session-search` V2**（`cc seshsearch`）— search profile 4-state（archived 终态、stale→active 恢复）+ query 5-state（3 终态），per-owner 8、per-profile 20，`autoStaleIdle` + `autoFailStuck`；37 V2 单测。
- **`session-tail` V2**（`cc seshtail`）— tail subscription 4-state（closed 终态、paused→active 恢复）+ event 5-state（3 终态），per-owner 10、per-sub 30，`autoPauseIdle`（24h）+ `autoFailStuck`（60s）；37 V2 单测。
- **`session-usage` V2**（`cc seshu`）— usage budget 4-state（archived 终态、exhausted→active 恢复）+ record 5-state（recorded/rejected/cancelled 3 终态），per-owner 5、per-budget 50，`autoExhaustIdle` + `autoRejectStuck`；37 V2 单测。
- **`session-hooks` V2**（`cc seshhook`，避开 SQLite 支持的 `cc hook`）— hook profile 4-state（retired 终态、disabled→active 恢复）+ invocation 5-state（3 终态），per-owner 12、per-profile 25，`autoDisableIdle` + `autoFailStuck`；37 V2 单测。
- **`mcp-scaffold` V2**（`cc mcpscaf`，避开 `cc mcp`）— scaffold profile 4-state（archived 终态、stale→active 恢复）+ generation 5-state（failed 仅从 generating，queued 不可失败；3 终态），per-owner 6、per-profile 15，`autoStaleIdle` + `autoFailStuck`（60s）；37 V2 单测。
- **`plan-mode` V2**（`cc planmode`）— plan profile 4-state（archived 终态、paused→active 恢复）+ step 5-state（3 终态），per-owner 6、per-profile 15，`autoPauseIdle` + `autoFailStuck`；39 V2 单测。
- **`permission-engine` V2**（`cc perm`）— perm rule 4-state（retired 终态、disabled→active 恢复）+ check 5-state（allowed/denied/cancelled），per-owner 10、per-rule 30，`autoDisableIdle` + `autoDenyStuck`；38 V2 单测。
- **`user-profile` V2**（`cc uprof`）— user profile 4-state（archived 终态、dormant→active 恢复）+ pref 5-state（proposed/applied/rejected/superseded/cancelled，applied 非终态），per-owner 5、per-profile 20，`autoDormantIdle` + `autoCancelStale`；37 V2 单测。
- **`social-graph` V2**（`cc social sg-*-v2`，`sg-*` 前缀避开 social-manager V2）— sg node 4-state（removed 终态、inactive→active 恢复）+ edge 5-state（proposed/established/severed/expired/cancelled，established 非终态），per-owner 50、per-node 100，`sg-autoDeactivateIdle` + `sg-autoExpireStale`；37 V2 单测。
- **`service-container` V2**（`cc svccont`）— svc container 4-state（decommissioned 终态、degraded→active 恢复）+ resolution 5-state（3 终态），per-owner 8、per-profile 25，`autoDegradeIdle` + `autoFailStuck`；37 V2 单测。
- **`task-model-selector` V2**（`cc tms`）— selector profile 4-state（decommissioned 终态、stale→active 恢复）+ selection 5-state（3 终态），per-owner 8、per-profile 16，`autoStaleIdle` + `autoFailStuck`；37 V2 单测。

### Changed

- **CLI 包版本**：`chainlesschain@0.131.0 → 0.137.0 → 0.139.0`（V2 第九批分批推进）
- **命令层**：14 个全新 top-level 分派，避免与已有 top-level（`cc session`、`cc mcp`、`cc hook`、`cc social`）冲突

### Tests

本批相较 0.136.0 累计新增 **521 个 V2 单元测试**（10×37 + 39 + 38 + 2×37），零回归。

---

## [5.0.2.34 / CLI 0.131-0.136] - 2026-04-18 晚 (V2 第八批 · 12 个 lib 级治理表面)

### Added — 12 个 V2 lib 级治理表面（严格增量 · 内存 governance · 与 SQLite / 传输层 / 协议层完全独立）

- **`a2a-protocol` V2** — `A2A_AGENT_MATURITY_V2` 4-state（retired 终态）+ `A2A_MESSAGE_LIFECYCLE_V2` 5-state（3 终态），per-owner active-agent cap（pending→active 仅）、per-agent pending-message cap（queued+dispatching）在 `createA2aMessageV2` 强制，`autoRetireIdleA2aAgentsV2` + `autoFailStuckA2aMessagesV2`；40 V2 单测，独立于 Phase 81 A2A schema / typed subscription 实现。
- **`activitypub-bridge` V2** — `AP_ACTOR_MATURITY_V2` 4-state + `AP_ACTIVITY_LIFECYCLE_V2` 5-state（3 终态），per-owner active-actor cap、per-actor pending-activity cap 在 `createApActivityV2` 强制，`autoRetireIdleApActorsV2` + `autoFailStuckApActivitiesV2`；39 V2 单测，独立于现有 ActivityPub outbox 语义。
- **`bi-engine` V2** — `BI_DATASET_MATURITY_V2` 4-state + `BI_QUERY_LIFECYCLE_V2` 5-state（3 终态），per-owner active-dataset cap、per-dataset pending-query cap 在 `createBiQueryV2` 强制，`autoArchiveIdleBiDatasetsV2` + `autoFailStuckBiQueriesV2`；39 V2 单测，独立于 Phase 95 NL→SQL / IQR 异常 / 线性预测。
- **`browser-automation` V2** — `BROWSE_SESSION_MATURITY_V2` 4-state + `BROWSE_STEP_LIFECYCLE_V2` 5-state（3 终态），per-owner active-session cap、per-session pending-step cap 在 `createBrowseStepV2` 强制，`autoArchiveIdleBrowseSessionsV2` + `autoFailStuckBrowseStepsV2`；37 V2 单测，独立于现有 Playwright / MCP computer-use 集成。
- **`cross-chain` V2** — `CC_BRIDGE_MATURITY_V2` 4-state + `CC_TRANSFER_LIFECYCLE_V2` 5-state（3 终态），per-owner active-bridge cap、per-bridge pending-transfer cap 在 `createCrossChainTransferV2` 强制，`autoDegradeIdleCcBridgesV2` + `autoFailStuckCcTransfersV2`；40 V2 单测，独立于 Phase 89 bridge/swap/message HTLC 流。
- **`dao-governance` V2** — `DAO_REALM_MATURITY_V2` 4-state + `DAO_PROPOSAL_LIFECYCLE_V2` 5-state（3 终态），per-owner active-realm cap、per-realm open-proposal cap 在 `createDaoProposalV2` 强制，`autoArchiveIdleDaoRealmsV2` + `autoFailStuckDaoProposalsV2`；41 V2 单测，独立于 Phase 92 二次方投票 / 循环安全委托。
- **`dlp-engine` V2** — `DLP_POLICY_MATURITY_V2` 4-state + `DLP_INCIDENT_LIFECYCLE_V2` 5-state（3 终态），per-owner active-policy cap、per-policy open-incident cap 在 `createDlpIncidentV2` 强制，`autoDeprecateIdleDlpPoliciesV2` + `autoCloseStaleDlpIncidentsV2`；40 V2 单测，独立于 Phase 50 channel-scoped 策略 / UTF-8 byte-gate。
- **`evomap-manager` V2** — `EVOMAP_HUB_MATURITY_V2` 4-state + `EVOMAP_SUBMISSION_LIFECYCLE_V2` 5-state（3 终态），per-owner active-hub cap、per-hub pending-submission cap 在 `createEvoSubmissionV2` 强制，`autoArchiveIdleEvoHubsV2` + `autoFailStuckEvoSubmissionsV2`；39 V2 单测，独立于 Phase 42 federation / 加权投票实现。
- **`matrix-bridge` V2** — `MX_ROOM_MATURITY_V2` 4-state + `MX_EVENT_LIFECYCLE_V2` 5-state（3 终态），per-owner active-room cap、per-room pending-event cap 在 `createMxEventV2` 强制，`autoArchiveIdleMxRoomsV2` + `autoFailStuckMxEventsV2`；37 V2 单测。
- **`nostr-bridge` V2** — `NOSTR_RELAY_MATURITY_V2` 4-state + `NOSTR_EVENT_LIFECYCLE_V2` 5-state（3 终态），per-owner active-relay cap、per-relay pending-event cap 在 `createNostrEventV2` 强制，`autoDegradeIdleNostrRelaysV2` + `autoFailStuckNostrEventsV2`；39 V2 单测。
- **`session-consolidator` V2** — `CONSOL_PROFILE_MATURITY_V2` 4-state + `CONSOL_JOB_LIFECYCLE_V2` 5-state（3 终态），per-owner active-profile cap、per-profile pending-job cap 在 `createConsolJobV2` 强制，`autoArchiveIdleConsolProfilesV2` + `autoFailStuckConsolJobsV2`；38 V2 单测，独立于现有 session-consolidator 聚合流。
- **`zkp-engine` V2** — `ZKP_CIRCUIT_MATURITY_V2` 4-state + `ZKP_PROOF_LIFECYCLE_V2` 5-state（3 终态），per-owner active-circuit cap、per-circuit pending-proof cap 在 `createZkpProofV2` 强制，`autoArchiveIdleZkpCircuitsV2` + `autoFailStuckZkpProofsV2`；41 V2 单测，独立于 Phase 88 scheme-parametric（Groth16/PLONK/Bulletproofs）实现。

### Changed

- **CLI 包版本**：`chainlesschain@0.131.0 → 0.136.0`（V2 第八批分多次推进，每次落 2 ~ 3 个 lib 级 surface）
- **docs-site**：首页 hero tagline 同步到 v5.0.2.34 · CLI 0.136.0 · V2 规范层第八批 · 11700+ 测试

### Tests

本批相较 0.130.0 累计新增 **470 个 V2 单元测试**（40+39+39+37+40+41+40+39+37+39+38+41），零回归。

| 层级 | 文件 | 测试 | 状态 |
| --- | --- | --- | --- |
| CLI 单元 | 244 | **10493 / 10493** | 全通过 |
| CLI 集成 | 40 | **696 / 696** | 全通过 |
| CLI E2E | 38 | **565 / 565** | 全通过 |
| **合计** | **322** | **11754 / 11754** | **零回归** |

---

## [5.0.2.34 / CLI 0.124-0.130] - 2026-04-18 (V2 第七批 · 9 个治理表面)

### Added — 9 个 V2 治理表面（严格增量，纯内存 governance，与 SQLite / 传输层独立）

- **`cc sso` V2** (CLI 0.124.0) — Provider 4-state 成熟度（`pending/active/deprecated/retired`，`deprecated→active` 恢复）+ 5-state 登录生命周期（`initiated/authenticating/completed/failed/cancelled`，3 终态），per-owner active-provider cap（`pending→active` 仅）、per-provider pending-login cap（`initiated+authenticating`）在 `createLoginV2` 时强制，`autoDeprecateIdleProvidersV2` + `autoFailStuckLoginsV2`；35 V2 单测，基于现有 SSO SQLite 表。
- **`cc workflow` V2** (CLI 0.125.0) — Workflow 4-state 成熟度（`draft/active/paused/retired`，`paused→active` 恢复）+ 5-state Run 生命周期（`queued/running/succeeded/failed/cancelled`，3 终态），per-owner active-workflow cap（`draft→active` 仅）、per-workflow pending-run cap（`queued+running`）在 `createRunV2` 时强制，`autoPauseIdleWorkflowsV2` + `autoFailStuckRunsV2`；44 V2 单测，独立于旧 DAG 执行器。
- **`cc router` V2** (CLI 0.127.0) — Router Profile 4-state 成熟度 + 5-state dispatch 生命周期（3 终态），per-owner active-profile cap（`pending→active` 仅）、per-profile pending-dispatch cap（`queued+dispatching`）在 `createDispatchV2` 时强制，`autoDegradeIdleProfilesV2` + `autoFailStuckDispatchesV2`；37 V2 单测（共 43），新顶层 `router` 命令，独立于旧 AgentRouter 类。
- **`cc hook` V2** (CLI 0.128.0) — Hook Profile 4-state 成熟度（`retired` 终态、`disabled→active` 恢复）+ 5-state exec 生命周期（3 终态），per-owner active-hook cap（`pending→active` 仅）、per-hook pending-exec cap（`queued+running`）在 `createHookExecV2` 时强制，`autoDisableIdleHooksV2` + `autoFailStuckExecsV2`；42 V2 单测（共 76），独立于 SQLite `registerHook` / `executeHooks` 路径。
- **`cc mcp` V2** (CLI 0.129.0) — MCP Server Profile 4-state 成熟度（`retired` 终态、`degraded→active` 恢复）+ 5-state invocation 生命周期（3 终态），per-owner active-server cap（`pending→active` 仅）、per-server pending-invocation cap（`queued+dispatching`）在 `createInvocationV2` 时强制，`autoDegradeIdleServersV2` + `autoFailStuckInvocationsV2`；33 V2 单测（共 65），独立于 MCPClient 传输层。
- **`cc cowork coord-*-v2`** (CLI 0.130.0) — Coord Agent 4-state 成熟度（`retired` 终态、`idle→active` 恢复）+ 5-state assignment 生命周期（3 终态），per-owner active-agent cap（`pending→active` 仅）、per-agent pending-assignment cap（`queued+dispatched`）在 `createAssignmentV2` 时强制，`autoIdleCoordAgentsV2` + `autoFailStuckAssignmentsV2`；32 V2 单测（共 74），函数名以 `Coord` 中缀避免与旧 team/template/result 流冲突。
- **`cc subagent` V2** — Sub-Agent Profile 4-state 成熟度（`retired` 终态、`paused→active` 恢复）+ 5-state task 生命周期（3 终态），per-owner active cap、per-profile pending cap，`autoPauseIdle` + `autoFailStuck`；37 V2 单测（共 43），独立于旧 RingBuffer-backed 单例注册中心。新顶层 `subagent` 命令。
- **`cc execbe` V2** — Execution Backend Profile 4-state 成熟度（`retired` 终态、`degraded→active` 恢复）+ 5-state exec-job 生命周期（`succeeded` 终态 + 3 终态），per-owner active cap、per-backend pending cap，`autoDegradeIdle` + `autoFailStuck`；46 V2 单测（共 68），独立于 Local/Docker/SSH Backend 实现。新顶层 `execbe` 命令。
- **`cc todo` V2** — Todo List 4-state 成熟度（`archived` 终态、`paused→active` 恢复）+ 5-state item 生命周期（`in_progress` 中间态 + 3 终态），per-owner active cap、per-list pending cap，`autoPauseIdle` + `autoFailStuck`；39 V2 单测（共 41），独立于 per-session `writeTodos`/`getTodos` API。新顶层 `todo` 命令。

### Changed

- **CLI 包版本**：`chainlesschain@0.123.0 → 0.124.0 → 0.125.0 → 0.127.0 → 0.128.0 → 0.129.0 → 0.130.0`（V2 第七批分多次推进 + 0.126.0 修复 bump；subagent/execbe/todo 三个表面为本批后续增量）
- **docs-site**：首页 hero tagline 同步到 v5.0.2.34 · CLI 0.130.0 · 109 命令
- **docs-site-design**：首页 badges 同步到 v5.0.2.34 · 95+ 模块 · 139 技能 · 7600+ 总测试
- **docs-website-v2**：`index.astro` evolution 条目增加 9 张 v5.0.2.34 卡片（ember 高亮），架构演进计数 49 → 58；CLI 数 76 → 109、测试数 5517+ → 7600+；`cli.astro` 标题与正文从 90 命令升至 109 命令

### Tests

本批相较 0.123.0 累计新增 **345 个 V2 单元测试**（35 + 44 + 37 + 42 + 33 + 32 + 37 + 46 + 39），零回归。所有 V2 表面均以 `-v2` 后缀分派，preAction bypass 自动识别。

- CLI 单元：新增 6 文件 / **+223 pass**
- CLI 集成：无新增，既有 40 文件 / 696 pass 绿
- CLI E2E：无新增，既有 38 文件 / 565 pass 绿

---

## [5.0.2.10 / CLI 0.130.0] - 2026-04-18 晚 (V2 第六批 · 13 个运行时管家)

### Added — 13 个 V2 规范表面（严格增量，全部基于内存 governance 层，与遗留 SQLite/ 文件态独立）

- **`cc automation` V2** — `AUTOMATION_MATURITY_V2` draft/active/paused/archived + `EXECUTION_LIFECYCLE_V2` queued/running/succeeded/failed/cancelled，per-owner active-automation cap = 20、per-flow pending-execution cap = 30，`autoPauseIdle*` + `autoCancelStuck*`。
- **`cc instinct` V2** — `PROFILE_MATURITY_V2` pending/active/dormant/archived + `OBSERVATION_LIFECYCLE_V2` captured/reviewed/reinforced/discarded/promoted，per-user 5、per-profile 100，`autoDormantIdleProfilesV2` + `autoDiscardStaleObservationsV2`。
- **`cc memory` V2** — `ENTRY_MATURITY_V2` draft/active/stale/archived + `CONSOLIDATION_LIFECYCLE_V2` pending/running/merged/rejected/superseded，per-owner 200、per-owner 20，`autoStaleEntries*` + `autoSupersedeStuck*`。
- **`cc note` V2** — `NOTE_MATURITY_V2` draft/active/stale/archived + `REVISION_LIFECYCLE_V2` pending/applied/rolled_back/conflicting/discarded，per-author 100、per-note 50，`autoStaleNotesV2` + `autoDiscardStaleRevisionsV2`。
- **`cc org` V2** — `ORG_MATURITY_V2` provisional/active/suspended/archived + `MEMBER_LIFECYCLE_V2` invited/active/suspended/removed/expired，per-owner 10、per-org 500，`autoSuspendIdleOrgsV2` + `autoExpireStaleMembersV2`。
- **`cc permmem` V2**（新命令组）— `PIN_MATURITY_V2` pending/active/dormant/archived + `RETENTION_JOB_LIFECYCLE_V2` queued/running/succeeded/failed/cancelled，per-owner 100、per-pin 10，`autoDormantIdlePinsV2` + `autoCancelStuckJobsV2`。
- **`cc rcache` V2**（新命令组）— `PROFILE_MATURITY_V2` pending/active/suspended/archived + `REFRESH_JOB_LIFECYCLE_V2` queued/running/completed/failed/cancelled，per-owner active-profile 25、per-profile pending-job 4，`autoSuspendIdleProfilesV2` + `autoFailStuckRefreshJobsV2`。与 legacy LRU `cc tokens cache` 并存不冲突。
- **`cc scim` V2** — `IDENTITY_LIFECYCLE_V2` pending/provisioned/suspended/deprovisioned + `SYNC_JOB_V2` queued/running/succeeded/failed/cancelled，per-tenant 5000、per-idp 50，`autoSuspendIdleIdentitiesV2` + `autoFailStuckSyncJobsV2`。
- **`cc session` V2** — `CONVERSATION_MATURITY_V2` active/idle/closed/archived + `TURN_LIFECYCLE_V2` queued/running/completed/failed/cancelled，per-user 20、per-session 100，`autoIdleConversationsV2` + `autoFailStuckTurnsV2`。
- **`cc social` V2** — `RELATIONSHIP_MATURITY_V2` pending/active/muted/blocked + `THREAD_LIFECYCLE_V2` draft/posted/archived/flagged/removed，per-user 1000、per-user 500，`autoMuteStaleRelationshipsV2` + `autoArchiveStaleThreadsV2`。
- **`cc sync` V2** — `RESOURCE_MATURITY_V2` pending/active/paused/archived + `SYNC_RUN_V2` queued/running/succeeded/failed/cancelled，per-owner 50、per-resource 20，`autoPauseIdleResourcesV2` + `autoFailStuckRunsV2`。
- **`cc tokens` V2** — `BUDGET_MATURITY_V2` pending/active/warning/exhausted + `USAGE_RECORD_LIFECYCLE_V2` pending/committed/refunded/rejected/disputed，per-owner 10、per-budget 10000，`autoExhaustBudgetsV2` + `autoCommitStaleRecordsV2`。
- **`cc wallet` V2** — `WALLET_MATURITY_V2` provisioned/active/frozen/retired + `TX_LIFECYCLE_V2` pending/submitted/confirmed/failed/cancelled，per-user 10、per-wallet 100，`autoFreezeIdleWalletsV2` + `autoCancelStuckTxsV2`。

### Changed

- **CLI 包版本**：`chainlesschain@0.106.0 → 0.130.0`（V2 第六批一次性推进 13 个管家 + 小版本收口）
- **README**：中/英双语在最新版本区前插入 V2 第六批条目，替换安装命令到 `chainlesschain@0.130.0`

### Tests

| 模块 | 单元测试（新/总） | 状态 |
| --- | --- | --- |
| `automation-engine.test.js` | +46 / 114 | 全通过 |
| `instinct-manager.test.js` | +48 / 73 | 全通过 |
| `memory-manager.test.js` | +47 / 101 | 全通过 |
| `note-versioning.test.js` | +49 / 71 | 全通过 |
| `org-manager.test.js` | +43 / 75 | 全通过 |
| `permanent-memory.test.js` | +46 / 71 | 全通过 |
| `response-cache.test.js` | +46 / 66 | 全通过 |
| `scim-manager.test.js` | +39 / 62 | 全通过 |
| `session-manager.test.js` | +33 / 77 | 全通过 |
| `social-manager.test.js` | +34 / 75 | 全通过 |
| `sync-manager.test.js` | +39 / 65 | 全通过 |
| `token-tracker.test.js` | +49 / 88 | 全通过 |
| `wallet-manager.test.js` | +41 / 70 | 全通过 |

本批相较 0.106.0 累计新增 **560 个 V2 单元测试**，零回归。

- CLI 单元：232 文件 / **9219/9229**（10 skipped）
- CLI 集成：40 文件 / **696/696**
- CLI E2E：38 文件 / **565/565**
- Desktop core+database / renderer stores / ai-engine sample 全部绿（15+16+3 files / 1587 pass）

---

## [5.0.2.10 / CLI 0.106.0] - 2026-04-18 (V2 第五批 · 协作治理 + UEBA + 威胁情报)

### Added — 3 个 V2 规范表面（严格增量）

- **`cc collab` V2** (CLI 0.105.0)：4-state Agent 成熟度 (`provisional/active/suspended/retired`，`suspended→active` 恢复) + 5-state 提案生命周期 (`draft/voting/approved/rejected/withdrawn`，3 终态)，per-realm active-agent cap = 10、per-proposer voting-proposal cap = 3，`autoRetireIdleAgentsCgV2` + `autoWithdrawStuckProposalsV2` 批量 auto-flip。
- **`cc compliance ueba` V2** (CLI 0.105.0)：4-state baseline 成熟度 (`draft/active/stale/archived`，`stale→active` 恢复) + 5-state investigation 生命周期 (`open/investigating/closed/dismissed/escalated`，3 终态)，per-owner active-baseline cap = 20、per-analyst open-investigation cap = 10（在 `openInvestigationV2` 创建时强制，因 open 即起始态），`autoMarkStaleBaselinesV2` + `autoEscalateStuckInvestigationsV2`。
- **`cc compliance threat-intel` V2** (CLI 0.106.0)：4-state Feed 成熟度 (`pending/trusted/deprecated/retired`，`deprecated→trusted` 恢复) + 5-state Indicator 生命周期 (`pending/active/expired/revoked/superseded`，3 终态)，per-owner active-feed cap、per-feed active-indicator cap、`autoDeprecateIdleFeedsV2` + `autoExpireStaleIndicatorsV2`。SQLite IoC 目录之上叠加纯内存 V2 层。

### Changed

- **CLI 包版本**：`chainlesschain@0.104.0 → 0.105.0 → 0.106.0`（V2 第五批分两次推进）
- **docs-site**：`cli-collab.md` / `cli-compliance.md` 追加 V2 规范表面段（共 4 个枚举 + 3 状态机 + 6 个 auto-flip + 18 配额配置）
- **docs-website-v2**：`index.astro` 升级到 48 条 evolution 条目（v5.0.2.10 新增 39 项，第五批 V2 列入）；CLI chip 从 `v0.104.0` 升至 `v0.106.0`
- **docs/cli/platform.md**：吸收 Collaboration Governance V2 / Compliance UEBA V2 段（项目根反向同步）

### Tests

| 模块 | 单元测试 | V2 新增 | 状态 |
| --- | --- | --- | --- |
| `collaboration-governance.test.js` | 98 | 37 | 全通过 |
| `ueba.test.js` | 59 | 29 | 全通过 |
| `threat-intel.test.js` | 69 | 41 | 全通过 |

本批相较 0.104.0 累计新增 **107 个 V2 单元测试**，零回归。

---

## [5.0.2.34] - 2026-04-17 (npm 0.66.0 · 7 个新命令组 + 8 个 V2 强化)

### Added — 7 个新 CLI 命令组

- **`cc agent-network`** — 去中心化 Agent 网络：Ed25519 DID + W3C VC + Kademlia k-bucket 模拟 + 4 维加权声誉任务路由 (Phase 24)
- **`cc automation` / `cc auto`** — 工作流自动化引擎：12 个 SaaS 连接器 (Gmail/Slack/GitHub/Jira/Notion/Trello/Discord/Teams/Airtable/Figma/Linear/Confluence) + 5 种触发器 + DAG 流 (Phase 96)
- **`cc didv2`** — W3C DID v2.0：did:key/web/chain + Ed25519 VC/VP + k-of-n 守护人社交恢复 + 身份漫游 (Phase 55)
- **`cc perf`** — 性能自动调优：OS 真采样 + 5 规则带滞回 + 冷却，CLI 只汇报不自动应用 (Phase 22)
- **`cc pipeline`** — 开发流水线编排：7 阶段 AI 开发流水线 (req→arch→code→test→review→deploy→monitor) + 4 模板 + 6 部署策略 (Phase 26)
- **`cc ecosystem` / `cc eco`** — 智能插件生态 2.0：注册 + DFS 依赖求解器 + 沙箱日志 + 发布状态机 + 70/30 收益分账 (Phase 64)
- **`cc sso`** — 企业身份认证：SAML/OAuth2/OIDC 配置 CRUD + PKCE S256 + AES-256-GCM Token 加密 + DID↔SSO 身份桥 (Phase 14)

### Added — 8 个现有命令 V2 强化（严格增量，向后兼容）

- **`cc social graph`** — 图分析：度/紧密度/中介中心性 + 影响力 + 社区发现 + BFS 最短路径 (Phase 42)
- **`cc dao`** — 4 阶段生命周期 + 二次投票 (cost=n²) + 防环委托 + 时锁 + 多数+法定人数门槛 (Phase 92)
- **`cc economy`** — 支付类型 + 双边状态通道 + NFT 铸造/列表/购买/销毁 + 任务贡献加权分账 (Phase 85)
- **`cc evolution`** — 6 维能力评估 + 4 级严重度诊断 + 4 种修复策略 + 成长里程碑自动记录 (Phase 100)
- **`cc hmemory`** — 4 层内存 + 3 类型 + 3 权限共享 + 巩固状态机 + 概念重叠语义搜索 (Phase 83)
- **`cc sandbox`** — 沙箱状态机 + 5 类权限 + 5 级风险评分 + 5 类配额 + 自动隔离 + 审计过滤 (Phase 87)
- **`cc workflow`** — 5 类标准模板 + 检查点快照 + 回滚到检查点 + 条件断点（正则安全） + JSON 导入/导出 (Phase 82)
- **`cc zkp`** — 3 种证明方案 (Groth16/PLONK/Bulletproofs) + 方案参数化证明形状 + 凭证注册表 + 选择性披露 (Phase 88)

### Changed

- **CLI 包版本**：`chainlesschain@0.51.0 → 0.66.0`（单次 npm publish，包含 2026-04-17 下午全部新增）
- **docs-site 新增 12 个命令参考页**：`cli-agent-network` / `cli-automation` / `cli-did-v2` / `cli-perf` / `cli-pipeline` / `cli-ecosystem` / `cli-sso` 等，VitePress 侧栏同步更新
- **docs/cli 子文件**：`blockchain-enterprise.md` / `core-phases.md` / `platform.md` 吸收新命令项

### Tests

| 层 | 文件数 | 用例数 | 耗时 |
| --- | --- | --- | --- |
| CLI 单元 | 232 | **7618/7618** | 129s |
| CLI 集成 | 40 | **696/696** | 46s |
| CLI E2E | 38 | **565/565** | 427s |

本批相较 0.51.0 新增 **536 个单元测试**（7082 → 7618），覆盖 15 个新 / 强化命令，全部通过；集成 / E2E 零回归。

### npm

| Tag | 版本 | 发布时间 |
| --- | --- | --- |
| v5.0.2.34 | 0.66.0 | 2026-04-17 晚 |

`npm i -g chainlesschain@0.66.0`（别名 `cc` / `clc` / `clchain`）

---

## [5.0.2.33] - 2026-04-17 (npm 发布批次 · CLI 0.51.0)

### Added

- **Phase 17 IPFS 去中心化存储 CLI**：`cc ipfs node-start/add/get/pin/gc/set-quota/attach-knowledge`，确定性 bafy CID + AES-256-GCM + 配额/GC + 知识库附件，64 tests
- **Phase 20 模型量化 CLI**：`cc quantize`，GGUF 14 级 + GPTQ 目录 + 作业生命周期 (pending→running→completed/failed/cancelled) + 进度追踪，48 tests
- **Phase 27 多模态协作 CLI**：`cc mm session/stream/track/snapshot`，CRDT 风格会话状态 + 5 模态/7 文档格式/6 输出格式参考目录，68 tests
- **Phase 28 自然语言编程 CLI**：`cc nlprog classify/extract/detect-stack/translate/refine/convention-add/conventions/stats`，启发式双语意图/实体/技术栈识别 + 翻译/惯例 CRUD，62 tests
- **Phase 63 统一应用运行时 CLI**：`cc runtime`，OS/容器/云环境能力检测 + 自适应资源分配策略 + 运行时统计，60 tests
- **5 个新 docs-site 页面**：`cli-ipfs.md` · `cli-quantize.md` · `cli-mm.md` · `cli-nlprog.md` · `cli-runtime.md`（由并行会话 commit `27267ed9f` 落地）
- **VitePress 侧栏**：新增 2 个命令分组，去除过期 NEW 标记

### Changed

- **CLAUDE.md 计数更新**：90 → 102 CLI commands，7200+ → 7400+ tests
- **CLI 包版本**：`chainlesschain@0.47.9 → 0.49.0 → 0.51.0`（v5.0.2.32 / v5.0.2.33 两次 npm 发布）
- **docs-website-v2**：`index.astro` 升级到 36 条 evolution 条目，`cli.astro` 新增 3 个命令类别

### npm

| Tag | 版本 | 包含 Phase |
| --- | --- | --- |
| v5.0.2.31 | 0.48.0 | 2026-04-17 文档重构基线（本地 tag） |
| v5.0.2.32 | 0.49.0 | + Phase 63 Universal Runtime |
| v5.0.2.33 | 0.51.0 | + Phase 17 IPFS + Phase 27 Multimodal |

发布渠道：`npm i -g chainlesschain@0.51.0`（别名 `cc` / `clc` / `clchain`）

### Tests

| 层 | 文件数 | 用例数 | 耗时 |
| --- | --- | --- | --- |
| CLI 单元 | 232 | **7082/7082** | 210s |
| CLI 集成 | 40 | **696/696** | 76s |
| CLI E2E | 38 | **565/565** | 459s |

本批新增 Phase 17/20/27/28/63 共 **302 个 CLI 单元测试**（64 + 48 + 68 + 62 + 60），全部通过。E2E 首次运行时 vitest-worker 出现一次 `Timeout calling "onTaskUpdate"` RPC 告警（已知长跑套件抖动），重跑全绿。

---

## [5.0.2.10-cli-wrap] - 2026-04-17

### Added

- **Phase 58 联邦硬化 CLI**：`cc federation register/breaker/failure/success/half-open/check/node-health/pool-* /stats`，熔断器三态 (closed/open/half_open) + 健康检查最差态聚合 + 连接池模拟
- **Phase 84 多模态感知 CLI**：`cc perception record/results/voice-start/voice-status/index-add/query/context/stats`，四模态 (screen/voice/document/video) + 语音会话状态机 + 跨模态索引搜索
- **Phase 80 数据库演进 CLI**：`cc dbevo register/up/down/status/history/query-log/query-stats/analyze/suggestions/apply/stats`，迁移 CRUD + 慢查询分析 + 索引建议追踪
- **Phase 25 AIOps CLI**：`cc ops detect/incidents/baselines/playbooks/postmortem/stats`，Z-Score/IQR 异常检测 + 事件四阶段生命周期 + playbook + 事后复盘
- **Phase 86 代码生成 Agent 2.0 CLI**：`cc codegen generate/show/list/review/review-show/reviews/scaffold/scaffolds/stats`，生成追踪 + 5 条启发式安全规则 + 脚手架记录
- **新增 docs-site 页面**：`cli-federation.md` (Phase 58 CLI 参考) · `cli-perception.md` (Phase 84 CLI 参考)，VitePress 侧栏新增"v5.0.2.10 联邦与多模态感知"分组

### Changed

- **`docs/CLI_COMMANDS_REFERENCE.md` 精简重构**：54.8k → 4.4k 精简索引；完整命令清单拆到 `docs/cli/` 6 个子文件 (core-phases / managed-agents / blockchain-enterprise / observability / platform / video)
- **命令注释全量中文化**：~371 条 `#` 注释由英文翻译为中文，技术术语 (DID/P2P/MCP/PQC/...) 保留原文
- **CLAUDE.md 计数更新**：65 → 90 CLI commands，5960+ → 7200+ tests

### Tests

| 层 | 文件数 | 用例数 | 耗时 |
| --- | --- | --- | --- |
| CLI 单元 | 219 | **6010/6010** | 114s |
| CLI 集成 | 40 | **696/696** | 36s |
| CLI E2E | 38 | **565/565** | 495s |

本轮新增 Phase 25/58/80/84/86 共 **239 个 CLI 单元测试**（48 + 59 + 47 + 47 + 38），全部通过。E2E 运行过程中 vitest-worker 抛出一次 `Timeout calling "onTaskUpdate"` RPC 超时告警（长跑套件已知问题），不影响任何断言结果。

### Fixed

- `docs-site/docs/chainlesschain/ai-video-generation.md` 最后一个参考链接由已删除的锚点修正为 `cli/video.md`

---

## [5.0.2.9-polish] - 2026-04-15

### Added

- **会话钩子第四事件 `AssistantResponse`**：在 `agentLoop()` 返回后 fire-and-forget 触发，钩子可读到 `{sessionId, response, messageCount, provider, model}`
- **`UserPromptSubmit` 钩子支持 rewrite / abort**：钩子 stdout 返回 `{"rewrittenPrompt": "..."}` 即可改写本轮 prompt；返回 `{"abort": true, "reason": "..."}` 直接跳过 LLM
- **Skill-Embedded MCP 上下文过滤**：`buildOptimizedPrompt({ activeMcpServers })` 只把白名单内的 MCP 服务器工具暴露给 LLM，避免 130+ 技能场景下的工具爆炸
- **`UnifiedToolRegistry.initialize({ deferSkills: true })`**：fast init 立即返回，技能解析延迟到第一次读 API 或 `setImmediate` 后台执行；生产 wiring 已切换
- **`MCPClientManager.disconnect(name)`**：单服务器断开别名，配合 Skill-Embedded MCP 的 mount/unmount 流程
- **Category Routing 扩展 `EMBEDDING` / `AUDIO`**：embedding 默认 `ollama` 优先（本地、免费）；audio 默认 `openai` 优先（whisper/tts 质量最高）

### Tests

- 新增 145 测试覆盖本轮（unit 131 + integration 11 + e2e 3），全绿
- 新增 `tests/integration/skill-mcp-context-filter.integration.test.js`、`tests/integration/unified-tool-registry-deferred.integration.test.js`、`__tests__/integration/session-hooks-lifecycle.test.js`、`__tests__/e2e/session-hooks-smoke.test.js`

### Performance

- 6 个核心包 `vitest.config.js` 统一加 `pool: "forks", maxForks: 2` 防御并行 OOM
- UnifiedToolRegistry 冷启动从 ~数百 ms 降到接近 0（138 技能解析延迟到首次读）

### Compatibility

- 全部改动**向后兼容**：未传新参数时行为与之前完全一致

## [5.0.2.10] - 2026-04-06

### Changed

- 文档站版本同步到 `v5.0.2.10`
- CLI Agent Runtime 重构文档已对齐到当前实现
- Web Panel 文档已补齐 runtime event、session record、后台任务、Worktree、压缩遥测相关说明
- 设计文档模块 78 已接入固定路由，不再生成 `78-unmapped.md`
- 根 README、设计文档索引、文档站首页已重新补回推荐阅读与当前架构主线
- 设计模块 69 / 73 / 75 / 77 / 78 已统一补成当前实现对应的长版文档

### Added

- `session-created`、`session-resumed`、`session-list-result` 的 `record` 字段文档
- `tasks-detail`、`tasks-history`、`task:notification` 的用户文档
- `worktree-diff`、`worktree-merge` 的用户文档
- `compression-stats` 的筛选参数文档
- `cli-ui` 增补项目模式、全局模式、会话流转、联调要点说明
- `agent-optimization` 增补五个核心优化模块与已完成增强集成说明
- `minimal-coding-agent-plan` 文档同步代码实际进度：Phase 0–6 全部落地、9 个测试文件 85/85 通过
- 新增 `coding-agent-bridge.test.js` 单元测试（12 用例），通过 `_deps` 注入覆盖桥接层并发场景
- 新增 `coding-agent-lifecycle.integration.test.js`（10 用例）覆盖 19 个 IPC channel、plan-mode、high-risk gating、worktree 全流程
- 新增 `coding-agent-bridge-real-cli.test.js`（2 用例）真实子进程启动 `chainlesschain serve` 端到端验证

### Fixed

- `coding-agent-bridge.js`：`request()` 在 `_send` 抛错时未清理 `pending`，导致内存泄漏；现 try/catch 中先 `pending.delete(id)` 再 throw
- `coding-agent-bridge.js`：WebSocket `close` 时未拒绝在途 pending 请求，调用方永久挂起；现 `_attachSocket()` 的 close 处理器调用 `_rejectAllPending(...)`
- 修复 `docs-site` 首页、Agent 架构页、UI / Serve 文档页的中文乱码
- 修复设计文档首页与运行时重构计划页的内容不同步问题
- 修复模块 78 在文档站同步时未映射到稳定路由的问题
- 修复模块 69 / 73 / 75 / 77 文本被压缩成提纲页的问题
- 同步修正首页、Agent 架构页、UI 页中过期的验证结果数字
- 文档站新增 `Minimal Coding Agent 实施计划`，与设计模块 78 一并入口化
- 设计文档站补齐模块 77 / 78 的稳定路由与侧边栏入口

### Tests

- CLI `ws-runtime-events`：`2/2`
- CLI `tools-registry`：`6/6`
- CLI `agent-core`：`66/66`
- CLI `ws-session-workflow`：`16/16`
- CLI 本轮定向合计：`90/90`
- Web Panel 定向单元：`27/27`
- Web Panel 构建：通过
- Docs Site 构建：通过

## [5.0.2.8] - 2026-03-31

### Added

- Web 管理面板扩展为 10 个模块、4 套主题
- 新增 Services、Logs、Notes、McpTools、Memory、Cron 页面
- 新增主题切换 store 与全局主题变量覆盖
- 新增多组纯函数解析器用于 Web Panel 输出解析

### Fixed

- 修复技能列表始终显示 0 的问题，`stdout` / `output` 字段兼容恢复
- 修复多个页面的中文字符损坏
- 修复浅色主题下组件样式未完整适配的问题
- 修复 DeepSeek 图标损坏

### Tests

- 新增 29 个 Web Panel 单元测试
- Web Panel 测试总量提升到 150+ 级别

## [5.0.2.7] - 2026-03-25

### Added

- Skill Creator v1.2.0
- 新增 `optimize-description`
- 新增 eval 样本自动生成、训练集 / 测试集划分
- 支持 LLM 驱动的技能描述迭代优化

### Tests

- 新增 76 个测试

## [5.0.2.6] - 2026-03-24

### Added

- Vue3 Web 管理面板 npm 打包接入发布流程
- `prepublishOnly` 自动构建 Web Panel
- `findWebPanelDist()` 支持多路径查找

### Fixed

- 修复 `$&`、`$'`、`$$` 等特殊字符注入导致的配置损坏
- 修复文档中部分字符被 U+FFFD 覆盖的问题

### Tests

- 新增 `$` 特殊字符相关回归测试

## [5.0.2.3] - 2026-03-20

### Fixed

- 修复 Web UI 与 WS 服务器之间 5 处协议不匹配：
  - 消息缺少 `id`
  - `auth-ok` / `auth-result` 不一致
  - `msg.session.id` / `msg.sessionId` 不一致
  - `session-list` / `session-list-result` 不一致
  - `stream-data` / `response-token` 语义不一致

### Added

- 新增 21 个协议单元回归测试
- 新增 6 个协议集成测试
- 设计文档模块 73 补充 v1 -> v2 协议对照说明

## [5.0.2.2] - 2026-03-18

### Added

- 新增 `chainlesschain ui`
- 支持项目模式与全局模式
- 支持会话列表、Markdown 流式渲染、自动重连
- 支持 HTTP + WebSocket 一体化启动
- 支持浏览器自动打开、token 注入和基础安全响应头

### Fixed

- 修复 UI 关闭流程与 `server.listen` 错误处理问题
- 修复带 query 参数时的 URL 路由匹配问题

## [5.0.2.1] - 2026-03-17

### Added

- 新增 `doc-edit` 技能
- 支持 md/txt/html/docx/xlsx/pptx 文档编辑
- 支持 `edit` / `append` / `rewrite-section`
- 输出总是写入 `_edited` 新文件

### Added Docs

- 新增 ai-doc-creator 与 ai-media-creator 用户文档
- 文档站开始按用户文档与设计文档分层导航

## [5.0.2.0] - 2026-03-17

### Added

- 新增 AI 文档创作模板 `ai-doc-creator`
- 新增 AI 音视频创作模板 `ai-media-creator`
- 新增 `doc-generate`、`libre-convert`、ComfyUI / TTS 技能
- 文档站升级到 `v5.0.2.0`

## [5.0.1.9] - 2026-03-17

### Added

- 新增 CLI 指令技能包系统
- 将 60+ CLI 指令自动封装为 9 组技能包
- 引入 `sync-cli`
- 支持 direct / agent / hybrid / llm-query 四种执行模式

## [5.0.1.8] - 2026-03-16

### Added

- 子代理隔离系统 v2
- `SubAgentContext`
- `SubAgentRegistry`
- 命名空间记忆与作用域上下文
- Agent 智能增强 v2

## [5.0.1.7] - 2026-03-15

### Added

- 子代理隔离系统初版
- `spawn_sub_agent`
- 三级摘要策略
- 作用域上下文引擎

## [5.0.1.6] - 2026-03-15

### Added

- Agent 智能增强
- `run_code` 工具的 auto pip-install
- 脚本持久化
- 错误分类
- 环境检测
- `agent-core` 从 REPL 中提取

## [5.0.1.5] - 2026-03-15

### Added

- SlotFiller 集成到 Agent 主循环
- `serve` 自动接入 `WSSessionManager`
- `session:create` / `session:close` 事件日志

### Fixed

- 修复 `session-resume` 后无法继续发送消息的问题

## [5.0.1.4] - 2026-03-15

### Added

- WebSocket 有状态会话
- `session-create`
- `session-resume`
- `session-message`
- `session-list`
- `session-close`
- `slash-command`
- `session-answer`

### Notes

- 这是后续 Runtime / Gateway / Event 统一演进的重要基础版本
