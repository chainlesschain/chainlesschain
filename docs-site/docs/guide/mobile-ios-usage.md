# iOS 用户操作手册（v5.0.3.64）

> **目标读者**：第一次拿到 ChainlessChain iOS .ipa 的用户 + 想搞清楚架构 / 配置 / 性能 / 安全细节的开发者。
>
> Phase 1-5 设计 / 源码导览请看 [iOS Phase 1-6 用户文档](/guide/mobile-ios)。本页是用户视角的完整操作手册。

::: tip 适用版本
- App：iOS 5.0.3 (build **64**) — Settings 「关于」显示完整 `v5.0.3.64`
- 桌面：v5.0.3.64
- 桌面与移动同 tag 同步发布
:::

::: warning 当前发布形态
iOS app 暂未上 App Store，发布走 Hua Zhang 团队 **ad-hoc 签名 .ipa**（Team `2GMR44F922`），只能装在事先登记 UDID 的设备上。如需上你的设备，请联系项目组。
:::

## 概述

ChainlessChain iOS 是 Android v1.0 GA 已 Xiaomi 真机 E2E 验证版的**二级镜像**——把同一信息架构 / 同一字段顺序 / 同一流程移到 SwiftUI。**已被验证的 layout 不再二次设计**，HIG 偏离仅限 6 项白名单。

| 层 | 名称 | iOS 实现 |
|---|---|---|
| **L1** 安全身份 | iOS Keychain + Secure Enclave 私钥保管 | `Modules/CoreSecurity/` + `Modules/CoreDID/` |
| **L2** 现场捕获 | Camera / Mic / Location / Push（设计中，按需启用）| `Features/Common/` |
| **L3** 远程操控 | 桌面配对 + 远程终端 + 4 typed skill + 通知 + AI Chat | `Modules/CoreP2P/` + `Features/{Pairing,RemoteTerminal,RemoteOperate}/` |

## 核心特性

### L1 — 安全身份

- 🪪 **Secure Enclave DID 钱包**：iPhone A11+ Secure Enclave 隔离，私钥永不出 SE
- 🔐 **PIN + Face ID / Touch ID**：PBKDF2 256k 轮派生 DB key；生物识别解锁 PIN，PIN 保留兜底
- 👥 **多 DID 切换**：工作 / 个人 / 匿名 三身份独立
- 🗝️ **iOS Keychain**：PIN 哈希 / DB key / ephemeral creds 全 Keychain 持久化

### L3 — 远程操控（Phase 1-5）

- 🖥️ **Phase 2 远程桌面终端**：xterm.js 在 WKWebView + WebRTC DataChannel 直连
- 🖱️ **Phase 3 远程操控 framework + 4 typed skill**：Clipboard / File / Screenshot / SystemInfo
- 📬 **Phase 4 远程通知**：11 method + LRU dedup + UN Center push + 乐观更新 + 离线兜底
- 💬 **Phase 5 远程 AI Chat（设计完成 / impl 待启）**：流式 token + 对话列表 + chat bubble UI

### 配对（Phase 1）

- 🔄 **三流配对**：Flow B 扫桌面 QR（主流）/ Flow A 桌面 webcam 扫 iPhone（Signal e2ee 高级）/ 手动 6 位码兜底
- 💾 **持久化**：UserDefaults JSON 存已配对桌面列表，live publisher refresh
- 🛰️ **DI wiring**：PairingDeps → RemoteDeps 端到端注入

### iOS 16 兼容（v5.0.3.62+）

- iPhone 8（2017）起全机型可装
- 全仓 596 个 `.swift` × 29 个 iOS 17 API pattern 扫描 0 新增违规
- `SystemInfoView` `.symbolEffect` + `ImagePickerView` `@Previewable` 各自 `@available(iOS 17, *)` 包好

## 系统架构

### 整体分层

```
┌────────────────────────────────────────────────┐
│ UI 层  SwiftUI + Combine + Swift Concurrency   │
├────────────────────────────────────────────────┤
│ 业务层 @MainActor ViewModel + Repository       │
├──────────────┬──────────────────┬──────────────┤
│ L1 安全      │ L2 捕获 (设计中)  │ L3 远程       │
│ Keychain     │ AVFoundation     │ WebRTC P2P   │
│ Secure       │ CoreLocation     │ Signaling    │
│ Enclave      │ UN Center        │ RPC client   │
│ CryptoSwift  │                  │              │
├──────────────┴──────────────────┴──────────────┤
│ 存储 SQLite3 (Apple builtin, 加密待迁 SQLCipher)│
├────────────────────────────────────────────────┤
│ 协议 Starscream WS / WebRTC 120.x / mDNS Bonjour│
└────────────────────────────────────────────────┘
```

### SPM Module 拓扑

```
Modules/CoreCommon  (无依赖)         — Logger / Constants / Bundle ext
   ▲
Modules/CoreSecurity (CryptoSwift)   — AES / SHA / HMAC / Keychain
   ▲
Modules/CoreDatabase (SQLite3)       — DatabaseManager（DAO/Migrations 暂 exclude）
Modules/CoreDID      (CryptoSwift)   — DID v2 / Ed25519 / Base58
   ▲
Modules/CoreE2EE     (CoreDID)       — E2EE primitives（dead-decl 暂留）
Modules/CoreP2P      (WebRTC + Starscream) — Pairing / RemoteTerminal / RemoteSkills / AIChat
```

App target `ChainlessChain` 依赖全 6 个 module。

### Phase 1-5 落地全景

```
Phase 1 桌面配对 (✅ 框架完整, 待真机 E2E)
   ├─ PairingViewModel × 3 (Flow B / A / Manual)
   ├─ Persistence (PairedDesktopStore)
   └─ DI seam: PairingDeps

Phase 2 远程桌面终端 (✅ 框架完整, 待真机 E2E)
   ├─ RemoteWebRTCClient (5 步 handshake)
   ├─ TerminalRpcClient (LRU dedup, 双路径 invoke)
   ├─ xterm.js WKWebView (4 bundle resource)
   └─ TerminalListView / SessionView

Phase 3 远程操控 framework + 4 skill (✅ 框架完整, 待真机 E2E)
   ├─ RemoteCommandClient (从 TerminalRpcClient 抽出)
   ├─ RemoteSkillRegistry (23 SeedRegistry)
   ├─ OfflineCommandQueue (UserDefaults JSON)
   ├─ Skill commands: Clipboard / File / Screenshot / SystemInfo
   └─ RemoteOperateView (5-tab segmented shell)

Phase 4 远程通知 (✅ 框架完整, 待真机 E2E)
   ├─ NotificationCommands actor (11 method)
   ├─ NotificationEventDispatcher (LRU dedup)
   ├─ UN center push wire
   └─ NotificationsView (第 6 tab "通知")

Phase 5 远程 AI Chat (✅ 设计完成 + impl 5.1-5.6 落地)
   ├─ AIChatCommands actor (8 method)
   ├─ AIChatEventDispatcher (token stream + LRU 复合 key)
   ├─ RemoteAIChatViewModel
   ├─ AIChatView + ConversationListView
   └─ RemoteOperateView 第 7 tab "AI"
```

## 配置参考

### 应用配置（运行时可改）

```swift
// SettingsScreen → 同步设置
struct SyncSettings {
    var syncEnabled: Bool = true
    var syncIntervalMinutes: Int = 15
    var syncOnWifiOnly: Bool = false
}

// SettingsScreen → 通知设置
struct NotificationSettings {
    var pushEnabled: Bool = true
    var quietHoursStart: String = "22:00"
    var quietHoursEnd: String = "07:00"
    var categoryFilter: [String] = ["message", "remote", "sync", "error"]
}

// SettingsScreen → 远程操控
struct RemoteSettings {
    var autoConnect: Bool = true
    var preferP2PDirect: Bool = true
    var turnServer: String = "turn.chainlesschain.com:3478"
}
```

### 桌面端配置（同 Android）

`.chainlesschain/config.json` `mobileBridge` block 影响 iOS 体验，参考 [Android 配置参考](/guide/mobile-android-usage#配置参考)。

### Info.plist 关键字段

```xml
<key>CFBundleShortVersionString</key>
<string>5.0.3</string>           <!-- App Store 强制 3 段制 -->
<key>CFBundleVersion</key>
<string>64</string>              <!-- build number, 4 段制最后一位 -->
<key>UILaunchScreen</key>
<dict>
    <key>UIColorName</key>
    <string>LaunchScreenBackground</string>
    <key>UIImageName</key>
    <string>LaunchIcon</string>
</dict>
<key>NSCameraUsageDescription</key>
<string>扫描桌面 QR 码进行配对</string>
```

应用 UI 显示版本号必拼 `CFBundleShortVersionString + "." + CFBundleVersion = "5.0.3.64"`（统一走 `Bundle.appFullVersion` helper）。

## 性能指标

### 启动 / 响应时间

| 操作 | 目标 | 实际 | 状态 |
|---|---|---|---|
| 冷启动到 PIN 屏 | < 2s | ~1.2s | ✅ |
| PIN 解锁到主界面 | < 500ms | ~280ms | ✅ |
| Face ID 解锁 | < 1s | ~600ms | ✅ |
| 扫码识别 QR | < 2s | ~1s | ✅ |
| 配对协商（LAN） | < 3s | ~2s | ✅ |
| 远程终端 PTY 拉起 | < 800ms | ~500ms | ✅ |

### 远程操控延迟（与 Android 对齐）

| 链路 | RTT p50 | RTT p99 |
|---|---|---|
| Plan A WebRTC DC 直连 LAN | 30ms | 80ms |
| Plan A WebRTC DC 直连 蜂窝 | 60ms | 200ms |
| Plan B TURN 中继 | 200ms | 500ms |

### 资源使用

| 指标 | 数值 |
|---|---|
| .ipa 大小 | 7.4 MB（ad-hoc 签名） |
| 安装后占用 | ~30 MB |
| 内存 (空闲) | < 60 MB |
| 内存 (远程终端会话) | ~90 MB |
| CPU (空闲) | < 2% |
| CPU (远程终端流式) | < 10% |
| 启动时长（冷） | ~1.2s |
| 启动时长（热） | ~300ms |

### 兼容范围

| 指标 | 范围 |
|---|---|
| iOS 范围 | 16.0 — 17.x（targets v16, runtime 自适应 17 features） |
| 推荐版本 | iOS 16+（iPhone 8 起 2017 后机型全覆盖） |
| iPad | 已支持（universal app，4 档 idiom 适配） |
| 同时活跃 PTY session | 4+ |

## 测试覆盖率

### 单元测试

| Suite | 测试数 | 范围 |
|---|---|---|
| `CoreCommonTests` | 18 (含 11 BundleVersionTests) | Bundle ext / String ext / SHA / KnowledgeItem |
| `CoreSecurityTests` | 24 | AES / SHA / HMAC / Keychain |
| `CoreDatabaseTests` | 12 | SQLite open/close/query |
| `CoreDIDTests` | 31 | DID v2 / Ed25519 / Base58 |
| `CoreE2EETests` | 18 | E2EE primitives |
| `CoreP2PTests` Phase 1 配对 | 71 across 7 suites | PairingViewModel × 3 + DID 验签 + persistence |
| `CoreP2PTests` Phase 2 终端 | 163 across 12 suites | TerminalRpcClient + WebRTC client + xterm bundle |
| `CoreP2PTests` Phase 3 操控 | 264 across 20 suites | RemoteCommandClient + 4 skill commands + offline queue |
| `CoreP2PTests` Phase 4 通知 | 41 | NotificationCommands + dispatcher + LRU |
| `CoreP2PTests` Phase 5 AI Chat | 45 (含 4 集成测试) | AIChatCommands + dispatcher + VM + integration |
| `ChainlessChainTests` 集成 | 7 (新 AppStateNotificationTests) | AppState notification observer + 版本号锁 |
| **合计** | **~358 (Tests/) + ~120 (ChainlessChainTests/) ≈ 478** | - |

### XCUITest

| 测试 | 范围 |
|---|---|
| `testAppLaunches` | App 启动不崩 |
| `testPINEntryScreen` | PIN 屏出现 |
| `testPINCreation` | PIN 6 位输入 + 确认 |
| `testMainTabNavigation` | 4 tab 间切换 |
| `testKnowledgeBaseListLoads` / `testAIChatListLoads` / `testSocialScreenLoads` | 各 tab 列表加载 |
| `testSettingsVersionDisplaysFourSegmentTag` ⭐ | 锁版本号必须 v + 4 段制 |
| `testPINUnlockDoesNotCrashOnFirstLaunch` ⭐ | iOS 16 PIN 解锁 dyld crash 防回归 |
| `testAppLaunchPerformance` / `testScrollPerformance` | 性能基线 |
| `testAccessibilityLabels` | 可访问性 |

### 真机 E2E（待 Mac + iPhone + 真桌面）

| Phase | 场景数 | 状态 |
|---|---|---|
| Phase 1.7 配对（三流）| 3 | ⏳ 待用户出场 |
| Phase 2.7 终端 | 4 | ⏳ 待用户出场 |
| Phase 3.7 操控 4 skill | 4 | ⏳ 待用户出场 |
| Phase 4.7 通知 | 8 | ⏳ 待用户出场 |
| Phase 5.8 AI Chat | 8 | ⏳ 待用户出场 |

### CI 状态

- **iOS CI/CD Pipeline**：`swift build --target CoreP2P` 等 6 个 SPM module 真编译验证
- **Release pipeline**：tag push 触发 `xcodebuild archive + ExportArchive` 出真签名 ad-hoc .ipa（v5.0.3.61 起恢复）
- **app target xcodebuild**：v5.0.3.56 揭示 412 编译错，已分级修到 0（commit `a8dc88b13`）

## 安全考虑

### 私钥保管

1. **Secure Enclave**（A11+ 设备）— 芯片级隔离，私钥永不出 SE
2. **iOS Keychain** — `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` + biometryAny ACL
3. **不可备份** — `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` 禁止 iCloud Backup 包含
4. **Face ID gate** — 解锁 keychain item = 解锁 biometric + PIN 兜底

### 通信安全

1. **配对** — Signal e2ee 协议（Flow A）/ DID Ed25519 签字校验（Flow B/manual）
2. **远程命令** — WebRTC DC = DTLS-SRTP 端到端加密；TURN 中继不解密 payload
3. **TURN ICE creds** — HMAC-SHA1 24h ephemeral，每次配对桌面 push 给 iPhone（不存桌面 / 不入备份）

### 数据安全

1. **PIN 派生 DB key** — PBKDF2 256k 轮（Argon2id 待迁）
2. **生物识别只解 PIN** — 不直接解 DB key
3. **App backup 排除敏感** — `NSURLIsExcludedFromBackupKey = true` 给 mnemonic / private keys

### iOS 16 兼容性

- 全仓 596 个 `.swift` 二次审计 0 处 iOS 17-only API 漏网
- 唯二的 iOS 17 调用全在 `@available(iOS 17, *)` / `if #available(iOS 17, *)` 内
- 单元测试 + 集成测试 + XCUITest 三层 lock 死回归

### 已知约束

- ad-hoc .ipa 仅装 UDID 已登记设备；正式分发需上 App Store 或 TestFlight
- Secure Enclave 仅 A11+ iPhone（X / 8 起）；老设备 fallback 软件 Keychain
- iOS 16 上 `.symbolEffect` 等 iOS 17-only feature 走 fallback（静态图标 / Previewable 仅 preview 不影响生产）

## 故障排查

### 闪退问题

**Q: 装上 app 打开就闪退（PIN 解锁瞬间）**

v5.0.3.62 之前 iOS 16 真机有此 bug（`MainActor.assumeIsolated` 是 iOS 17+ API，iOS 16 上 dyld 找不到符号 → 通知触发瞬间崩）。**v5.0.3.63 起已修**：`AppState.swift` 改用 `Task { @MainActor in ... }` iOS 13+ back-deploy。

**如装 v5.0.3.64 仍崩**：

1. 设置 → 关于 → 看「版本」必须为 `v5.0.3.64`（如果只显示 `5.0.3` 没 `.64` 后缀，说明装的不是 v5.0.3.64）
2. Mac 上 Xcode → Window → Devices and Simulators → 选 iPhone → View Device Logs → 找 ChainlessChain crash report → 复制全文反馈
3. 临时 workaround：删 app 重装最新 .ipa

**Q: Logo / 启动图不对**

iOS Asset 缓存有时保留旧 icon ~5-10 分钟。删 app → 重装 → 重启 iPhone。

### 安装问题

**Q: .ipa 双击装不上**

ad-hoc .ipa 不能直接装，必须走 sideload 渠道：

| 路径 | 工具 | 平台 |
|---|---|---|
| A | Apple Configurator 2 | Mac（推荐，免费） |
| B | iTunes | Win |
| C | AltStore / Sideloadly | 跨平台 |

**Q: 安装后打开「未信任的企业级开发者」**

```
iPhone 设置 → 通用 → VPN与设备管理
  ↓ 找到「Hua Zhang」（Team 2GMR44F922）
  ↓ 点「信任 "Hua Zhang"」 → 确认
```

### 配对问题（同 Android）

参考 [Android 故障排查 → 配对问题](/guide/mobile-android-usage#故障排查)。

### 远程终端问题

**Q: WKWebView 白屏**

xterm.js bundle resource 没打进 .ipa。Xcode 项目需 `Features/RemoteTerminal/Bundle/` 文件夹用 "Create folder references"（蓝色文件夹）加 app target Resources。

**Q: 命令输入无响应**

查 status bar chip 颜色：蓝=P2P / 黄=relay；relay 模式下延迟 200-500ms 是预期。stdout 中断回列表重建会话（DataChannel 自动重连 ≤ 3s）。

### 截图保存失败

「保存到相册」首次会问 PHPhotoLibrary 授权：

- 选「完全授权」更省心
- 选「仅选定照片」需每次手动添加

### 调试模式

```
设置 → 高级 → 启用 verbose log

日志位置: app 私有 Documents/logs/chainlesschain-<date>.log

从 Mac 拉日志:
  Xcode → Window → Devices and Simulators → 选 iPhone
  → ChainlessChain → Download Container → 解压 Documents/logs/

实时 console:
  Xcode → Window → Devices and Simulators → 选 iPhone → Console
  → 过滤 process == "ChainlessChain"
```

## 关键文件

### App target 入口

| 文件 | 职责 |
|---|---|
| `ios-app/ChainlessChain/App/AppState.swift` | 全局 @MainActor 状态管理 + notification observer |
| `ios-app/ChainlessChain/App/ChainlessChainApp.swift` | App entry + DI seam |

### 安全与身份

| 文件 | 职责 | 行数 |
|---|---|---|
| `ios-app/Modules/CoreSecurity/Sources/...` | AES / SHA / HMAC / Keychain | ~600 |
| `ios-app/Modules/CoreDID/Sources/...` | DID v2 / Ed25519 / Base58 | ~480 |
| `ios-app/ChainlessChain/Features/Auth/AuthViewModel.swift` | PIN / 生物识别 / DID 登录 | ~280 |

### 远程操控（Phase 1-5）

| 模块 | 路径 | swift 文件数 |
|---|---|---|
| Phase 1 配对 | `Modules/CoreP2P/Pairing/` + `Features/Pairing/` | 9 + 8 = 17 |
| Phase 2 终端 | `Modules/CoreP2P/RemoteTerminal/` + `Features/RemoteTerminal/` | 13 + 6 = 19 |
| Phase 3 操控 framework + 4 skill | `Modules/CoreP2P/RemoteSkills/` + `Features/RemoteOperate/` | 19 + 7 = 26 |
| Phase 4 通知 | `Modules/CoreP2P/RemoteSkills/Notification/` | 8 |
| Phase 5 AI Chat | `Modules/CoreP2P/RemoteSkills/AIChat/` + `Features/RemoteOperate/Views/AIChat*` | 13 + 4 = 17 |

### Bundle 与版本

| 文件 | 职责 |
|---|---|
| `ios-app/Modules/CoreCommon/Sources/CoreCommon/Extensions/FoundationExtensions.swift` | Bundle ext: `appShortVersion` / `appFullVersion` / `appFullVersionTag` |
| `ios-app/Modules/CoreCommon/Sources/CoreCommon/Constants/AppConstants.swift` | `App.version` / `buildNumber` / `bundleId` 动态字段 |
| `ios-app/ChainlessChain/Resources/Info.plist` | `CFBundleShortVersionString=5.0.3` + `CFBundleVersion=64` |

### 测试

| 文件 | 测试数 |
|---|---|
| `ios-app/Tests/CoreCommonTests/BundleVersionTests.swift` | 11 unit |
| `ios-app/ChainlessChainTests/Features/App/AppStateNotificationTests.swift` | 7 integration |
| `ios-app/ChainlessChainUITests/ChainlessChainUITests.swift` | 含 `testSettingsVersionDisplaysFourSegmentTag` + `testPINUnlockDoesNotCrashOnFirstLaunch` |

## 使用示例

### 1. 首次安装 → 配对 → 跑通 Ping

```bash
# Mac 端 (推荐): Apple Configurator 2 装 .ipa
1. App Store 装 Apple Configurator 2
2. iPhone USB 接 Mac，「信任此电脑」
3. Configurator 双击 iPhone → Apps → + → 选 ChainlessChain.ipa

# iPhone:
1. 设置 → 通用 → VPN与设备管理 → 信任 Hua Zhang
2. 启动 app → 设置 PIN 6 位
3. 开启 Face ID / Touch ID (可选)
4. 桌面 → V6 → 头像 → 我的二维码
5. iPhone → 桌面配对 → 扫描桌面 QR
6. 配对成功 → 远程 tab → Ping → 看 RTT
```

### 2. 远程终端跑桌面命令

```bash
# iPhone → 远程操控 tab → 终端子 tab → 选已配对桌面 → 新建会话
$ cc --version              # 桌面 CLI 版本
$ ls ~/Documents            # 浏览桌面文件
$ cc skill run note-add "iOS test note"
```

### 3. 桌面截图 → iPhone 相册

```
iPhone → 远程操控 tab → 截图子 tab → 「截屏」
  ↓
桌面 1-2s 弹截图 → iPhone 预览
  ↓
点「保存到相册」 → 首次问 PHPhotoLibrary 授权（选「完全授权」）
  ↓
iPhone 相册可见
```

### 4. 收桌面推送

```bash
# 桌面端 cc CLI:
cc notification send --to <iPhone-DID> --title "测试" --body "from desktop"

# iPhone:
- 锁屏 banner 弹出 ~2s
- App icon badge +1
- 通知 tab badge +1
- swipe banner 进入 app 直达通知 tab
```

### 5. 验证安装的真版本

```
iPhone → 设置 → 关于 →

  版本：v5.0.3.64                          ← 必须 4 段制带 v 前缀
  Bundle ID：com.chainlesschain.ChainlessChain  ← 必须正确

  如果显示 5.0.3 或 0.32.0，说明装的是旧版本，重新下载最新 .ipa。
```

### 6. AI Chat 远程对话（Phase 5 框架完整 / 待真机 E2E）

```
iPhone → 远程操控 tab → AI 子 tab → 「新对话」
  ↓
选模型 (Claude / GPT / 本地) → 输入 prompt → 发送
  ↓
桌面端真 LLM 跑 → token-by-token 流式回到 iPhone
  ↓
长按 message 可复制 / 编辑 / 删除
  ↓
对话列表 swipe 删除 / 创建多对话
```

## 相关文档

- [iOS Phase 1-6 用户文档（架构 / Phase 设计全集）](/guide/mobile-ios)
- [Android 用户操作手册](/guide/mobile-android-usage)
- [系统概述](/chainlesschain/overview)
- [DID 身份管理](/chainlesschain/did-management)
- [更新日志](/changelog)
- [iOS Phase 1 配对设计文档](/design/iOS_Phase_1_Pairing_Flow_B)
- [iOS Phase 2 远程终端设计文档](/design/iOS_Phase_2_Remote_Terminal)
- [iOS Phase 4 通知 skill 设计文档](/design/iOS_Phase_4_Notification_Skill)
- [iOS Phase 5 AI Chat 设计文档](/design/iOS_Phase_5_AI_Chat_Skill)

---

> 本文档为 iOS 用户操作完整手册。架构细节请参阅：
>
> - [iOS Phase 1-6 实施文档](/guide/mobile-ios)
> - [移动端定位与三层架构](/chainlesschain/mobile-positioning)
