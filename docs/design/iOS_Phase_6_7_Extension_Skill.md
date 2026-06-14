# iOS Phase 6.7 — Extension Skill (Chrome 扩展浏览器控制)

> **状态**：v0.1 草案（2026-05-18 创建）。需 OQ 1-5 用户拍板后开 sub-phase 6.7.1。
>
> **依赖**：Phase 6.1B1 RemoteCommandClient framework；Phase 6.1B1 UserBrowserCommands (CDP 直连 Chrome) — 区分边界详 §1.4；Phase 6 模板（memory `ios_phase_6_skill_template.md`）。
>
> **对齐版本**：Android `app/src/main/java/.../remote/commands/ExtensionCommands.kt`（**95 unique invoke**）；桌面 `desktop-app-vue/src/main/remote/browser-extension-server.js`（**490 case** in `ExtensionBrowserHandler.handle()` switch — Chrome 扩展功能 superset）。
>
> **关联文档**：`iOS_对标_Android_Phase_6_Plan.md` §5.7 + §7 Trap T4 (本文档解决 — 与 Phase 6.6 doc 解决 Trap T2 类比) / `Desktop_Mobile_Bridge_Namespace_Coverage.md` (extension 97% 数据) / `iOS_Phase_6_6_Desktop_Skill.md` (架构审计模式参考)。

---

## 1. 背景 & 架构审计

### 1.1 Phase 6 Plan §7 Trap T4 是错的

Plan §7 Trap T4 警告：
> "extension skill 独立 WS gateway 在 iOS LAN 不可达 — 桌面端 extension WS 通常 bind 127.0.0.1 only (Chrome 扩展走 localhost)。iOS 需 LAN/relay 接入，桌面端需 bind 0.0.0.0 + auth token 控制。"

**审计结果**：Trap T4 误判。iOS **不需要**直连 extension WS server。架构如下：

```
┌──────────┐  ① DC RPC: extension.<X>   ┌─────────────────────────┐
│   iOS    │ ────────────────────────►  │ desktop remote-gateway  │
│  mobile  │  ◄────────────────────────  │   (现行 RemoteCommandClient)│
└──────────┘    DC RPC response          └────────────┬────────────┘
                                                       │ ② server.sendCommand
                                                       ▼
                                          ┌───────────────────────────┐
                                          │  ExtensionBrowserHandler  │
                                          │     (proxies to)          │
                                          └────────────┬──────────────┘
                                                       │ ③ WS  (127.0.0.1:18790)
                                                       ▼
                                          ┌────────────────────────┐
                                          │ browser-extension-server│
                                          │   (本地 WS server)     │
                                          └────────────┬───────────┘
                                                       │ ④ WS push
                                                       ▼
                                          ┌────────────────────────┐
                                          │  Chrome 扩展 background │
                                          │  + content scripts     │
                                          └────────────────────────┘
```

- ① **iOS 通过现行 DC RPC 调 `extension.<method>`** — 与 input/clipboard/notification 等 Phase 6 skill 完全同模式
- ② 桌面 `remote-gateway.js` 调 `commandRouter.registerHandler("extension", handlers.extension)` 把 namespace 路由到 ExtensionBrowserHandler (line 410-413)
- ③ ExtensionBrowserHandler 是**单纯的 proxy**：495 case 全部走 `this.server.sendCommand(clientId, "<chrome.api>", params)`
- ④ browser-extension-server.js 维护本地 WS server (port 18790, bind 127.0.0.1) — Chrome 扩展 background script 连这里

**iOS 完全不接触 ④ 那个 WS。** Trap T4 的"iOS LAN 不可达"问题不存在。Phase 6.7 wire 协议与 Phase 6.1B1 input/Phase 6.6 desktop 等完全一致。

### 1.2 真实复杂度在 method 数量

| 项 | 数 |
|---|---:|
| 桌面 ExtensionBrowserHandler.handle() switch case | **490** |
| Android `ExtensionCommands.kt` invoke method | **95** |
| 严格名称匹配 (Coverage doc) | **93 (97%)** |
| iOS Phase 6.7 v0.1 wrap scope | **~30** (核心 navigation/tabs/cookie/screenshot/script — 详 §2) |
| iOS Phase 6.7 v0.2+ wrap scope | 剩 65 (niche/debugging/emulation/accessibility) |
| **iOS 不实现** (桌面 superset) | **395 method** — 桌面端 Chrome 扩展深度功能，Android 端从未暴露，mobile 用户场景 |

### 1.3 方法分布（Android 95 method 按功能桶）

| 桶 | 估计数 | 范围 |
|---|---:|---|
| Tabs & navigation | ~15 | listTabs / getTab / createTab / closeTab / focusTab / navigate / reload / goBack / goForward / canNavigateBack / canNavigateForward 等 |
| Cookies | ~8 | getCookies / getCookie / setCookie / removeCookie / clearCookies / 等 |
| Storage (localStorage / IndexedDB / Cache) | ~12 | clearLocalStorage / clearSessionStorage / clearIndexedDBStore / addCacheEntry / deleteCache / 等 |
| Screenshot & DOM capture | ~6 | captureScreenshot / captureFullPageScreenshot / captureElementScreenshot 等 |
| Script execution | ~5 | executeScript / executeIsolatedScript / 等 |
| Bookmarks | ~3 | getBookmarks / searchBookmarks / createBookmark |
| History / Downloads | ~4 | history / clearBrowsingData / download / cancelDownload |
| Window management | ~5 | createWindow / closeWindow / createTabGroup 等 |
| Emulation (mobile/touch/device) | ~10 | emulateDevice / emulateTouchEmulation / emulatePinch / emulateSwipe 等 |
| Debugging (network / console / WebSocket) | ~8 | enableNetworkInterception / enableConsoleCapture / enableWebSocketDebugging 等 |
| Accessibility checks | ~5 | checkAltTexts / checkColorContrast / checkFormLabels 等 |
| Web platform APIs (USB / MIDI / WebRTC / Geolocation / Speech / Vibration) | ~12 | claimUSBInterface / closeMIDIAccess / closeWebRTCConnection / clearGeolocationOverride / cancelSpeech / cancelVibration 等 |
| 其它（broadcast / animation / sensors / etc.）| ~2 | 边缘 |
| **总** | **~95** | |

### 1.4 extension vs userBrowser 区分

iOS 已有 `UserBrowserCommands` (Phase 6.1B1, 18 method) — 也是浏览器控制。区别：

| 维度 | extension (本 Phase 6.7) | userBrowser (Phase 6.1B1) |
|---|---|---|
| 控制方式 | **Chrome 扩展注入** content script | **CDP (Chrome DevTools Protocol)** 直连 |
| 桌面 wire | DC RPC → ExtensionBrowserHandler → 本地 WS → Chrome 扩展 | DC RPC → user-browser-handler → CDP HTTP/WS to Chrome :9222 |
| 用户前置 | 必须安装 ChainlessChain Chrome 扩展 | Chrome 启动时加 `--remote-debugging-port=9222` |
| 覆盖范围 | 490 cases (Chrome extension API 全) | 18 method (基本 tab + script) |
| 适用浏览器 | 仅 ChainlessChain 扩展 (Chrome/Edge/Brave) | Chrome / Edge / Brave / Chromium 通用 |
| 第 1 次启用难度 | 中（需用户装扩展）| 高（需用户改 Chrome 启动参数）|
| 功能深度 | 极深（DOM mutation / WebRTC / USB 等）| 浅（基本浏览器控制）|

**iOS UI 决策**：v0.1 把 extension 也归在 SystemToolsView 的"浏览器"子 tab？还是独立第 14 主屏 tab？详 OQ-5。

---

## 2. 目标 & 非目标

### 2.1 目标（Phase 6.7 v0.1 in scope）

| # | 项 | 验收 |
|---|---|---|
| G1 | `ExtensionCommands` actor + Models — wrap **30 核心 method** (§3 OQ-1 决定具体 30) | 单测 ≥ 30 (每 method 1 happy)；envelope shape 与 Android `ExtensionCommands.kt` 二进制兼容 |
| G2 | iOS UI — 至少一个入口让 30 method 中 5-10 个核心 (navigation/screenshot/storage/cookie) 可点 | 用户能从 iPhone 操作 Chrome 扩展 |
| G3 | clientId 管理 — 多 Chrome 实例时由用户 picker；单实例时 `getFirstClientId` 兜底 | 单实例下 0 配置工作；多实例下 picker UI |
| G4 | "Chrome 扩展未连接" 错误 UI — 引导用户安装 + 重试 | 错误 banner 含安装说明链接 |
| G5 | Phase 6 Plan §7 Trap T4 文档修正 | Plan + Coverage doc 标记 Trap T4 "实际 false alarm，iOS 走 DC RPC 同 Phase 6.1B1 模式" |

### 2.2 非目标（defer 到 Phase 7+）

- **wrap 全 95 Android method** — v0.1 30 是 80/20 原则；剩 65 niche 按用户需求触发
- **wrap 全 490 桌面 method** — Android 自己都没全 wrap (95/490 = 19%)，iOS 跟 Android 即可
- **Chrome 扩展 install flow** — iOS 不能装 Chrome 扩展（iOS 没 Chrome 桌面浏览器），只能引导用户在桌面装
- **WebRTC / USB / MIDI 高级 API** — 留 v0.2 / Phase 8+
- **emulation / debugging features** — 开发者工具场景，普通 mobile 用户不用
- **accessibility checks** — 开发者工具场景
- **Chrome 扩展 ChainlessChain 自身的 install** — iOS 不分发 Chrome 扩展 (那是桌面端 ChainlessChain installer 包的事)

---

## 3. Open Questions

### OQ-1：v0.1 wrap 哪 30 method？

候选高频 method（按用户场景排序）：

**核心导航 (10)**：listTabs / getTab / createTab / closeTab / focusTab / navigate / reload / goBack / goForward / canNavigateBack

**屏幕 / DOM (5)**：captureScreenshot / captureFullPageScreenshot / executeScript / getPageContent (若有) / scrollToElement (若有)

**Cookies (5)**：getCookies / getCookie / setCookie / removeCookie / clearCookies

**Storage (5)**：clearLocalStorage / clearSessionStorage / clearCache / clearBrowsingData / getStorageQuota (若有)

**Bookmarks + History (5)**：getBookmarks / searchBookmarks / createBookmark / getHistory / clearHistory (若有)

**推荐 v0.1 = 上述 30**。理由：覆盖"远程检查 Chrome 状态 / 清理隐私 / 注入 JS 做事"3 大用户场景。Niche emulation / debugging 等留 v0.2。

### OQ-2：clientId 管理 — auto vs picker

桌面 ExtensionBrowserHandler.handle() 行为：`params.clientId || this.server.getFirstClientId()`。即 mobile **不传** clientId 时自动用第一个连接的 Chrome 扩展。

**A**：iOS 默认不传 clientId — 单实例下自动工作（绝大多数用户场景）。多实例下 UI 加 picker，用户选择后所有调用都带 clientId
**B**：iOS 启动后立即拉 `extension.listClients`（如果有此 method）让用户选择
**C**：复杂多实例管理用 Chrome window 概念关联

**推荐 A**。理由：单实例（一台桌面装一个 Chrome）是 99% 用户场景；getFirstClientId 兜底简单可用。多实例发现后再加 picker（v0.2）。

### OQ-3：错误 UI — "Chrome 扩展未连接"

桌面端 throw `No browser extension connected. Please install and connect the ChainlessChain Browser Extension.`。iOS 收到这个 error 后：

**A**：错误 banner 显原始 message + "查看安装说明"链接 (跳 Safari 打开 docs URL)
**B**：自定义 SwiftUI 引导页：图文教程 + 链接
**C**：仅 toast，不引导（用户自己解决）

**推荐 A**。理由：(1) 错误已经描述完整；(2) 不在 iOS 端维护安装教程文案（桌面 docs 才是 source of truth）；(3) Safari 跳转零额外 UI 开发。

### OQ-4：UI 入口

**A**：独立第 14 主屏 tab "扩展"（与桌面/浏览器/userBrowser 并列）— RemoteOperateView 14 tab
**B**：进 SystemToolsView 子 tab "扩展"（与 userBrowser/system shell 等并列）
**C**：合并到既有"浏览器" SystemTools sub-tab (Phase 6.1B1 userBrowser tab) — 同子 tab 内 segmented 切换 CDP vs Extension

**推荐 B**。理由：(1) extension skill 是低频功能（需装扩展 + niche 开发者用例）；(2) 已 13 tab 主屏，再加压力大；(3) 合并 (C) 与 userBrowser 不同浏览器实例可能混淆。

### OQ-5：Phase 6.10 in-app update 类似的"扩展可用性"启动检测？

iOS 进 extension tab 时先 ping `extension.listTabs` (或任何无副作用 method)，若返"No browser extension connected" → 直接显引导页，不让用户尝试其它操作。

**A**：进入 view 时 .task 启动检测
**B**：每次操作时 catch error 再显引导（被动）
**C**：A + B 双重

**推荐 A**。理由：早发现早引导，避免用户点了 createTab 才知道扩展没装。

---

## 4. 协议设计

### 4.1 wire 协议（v0.1 — 与 Android 100% 兼容）

复用 Phase 6.1B1 模板 — 95 method 全部 `extension.<methodName>`，params 含 optional `clientId`（不传走 getFirstClientId）。

```json
// 例: extension.listTabs
{"type": "chainlesschain:command:request",
 "payload": {"id": "<reqId>", "method": "extension.listTabs",
             "params": {}}}              // 不传 clientId
// Response
{"type": "chainlesschain:command:response",
 "payload": {"id": "<reqId>", "result": {
   "success": true,
   "tabs": [{"id": 123, "url": "https://...", "title": "..."}, ...]
 }}}
// Error (扩展未连)
{"type": "chainlesschain:command:response",
 "payload": {"id": "<reqId>",
             "error": "No browser extension connected. Please install..."}}
```

### 4.2 iOS-side framework 设计

```swift
// Modules/CoreP2P/Sources/RemoteSkills/Extension/
├─ ExtensionModels.swift     // ChromeTab / Cookie / Bookmark / 30+ 响应 struct
└─ ExtensionCommands.swift   // actor — 30 method (v0.1 scope)

// 共享 SystemToolsView 子 tab (推荐 OQ-4 B):
//  → SystemToolsView.swift 加 SubTab.extension case
//  → 子 view ExtensionToolView (300-400 LOC, action grid + screenshot sheet)
```

### 4.3 错误处理（OQ-3 A 实现）

```swift
// ExtensionCommands actor 内 decode helper 透传 RemoteSkillError.remoteError
// UI 端 catch 这个错误，检测特征 message 后显引导 banner：
let extensionNotConnectedHint = "No browser extension connected"

if case RemoteSkillError.remoteError(_, let msg) = error,
   msg.contains(extensionNotConnectedHint) {
    showInstallGuide = true  // 显安装引导 banner
}
```

---

## 5. 子阶段 (Sub-phases)

### Phase 6.7.1 — ExtensionCommands actor (30 method)

**时间**：2 天

- ExtensionModels.swift: 30 method 对应 response struct + ChromeTab / Cookie / Bookmark / HistoryEntry 等基础类型
- ExtensionCommands.swift: actor + 30 typed wrapper + 共享 decode helper
- DI wire: RemoteDependencies +1 prop / +1 init
- 单测 ≥ 30 (每 method 1 happy envelope + decode test, error path 由 actor decode 通用 helper 覆盖) + 2-3 error path 专项

### Phase 6.7.2 — SystemToolsView 子 tab "扩展" UI

**时间**：1-1.5 天

- SystemToolsView.swift: SubTab enum 加 `.extension` case + view dispatch
- ExtensionToolView.swift: ScrollView + ActionRow grid 暴露 5-10 个核心 method (navigate / listTabs / screenshot / clearCookies / 等) + 安装引导 banner (OQ-3 A) + 启动检测 (OQ-5 A)

### Phase 6.7.3 — Coverage doc + Plan §7 Trap T4 文档修正

**时间**：0.5 天

- `Desktop_Mobile_Bridge_Namespace_Coverage.md` extension 行加注释 "Phase 6.7 doc §1.1 解决 Trap T4：iOS 走 DC RPC 同模式，不连本地 WS"
- `iOS_对标_Android_Phase_6_Plan.md` §7 Trap T4 标 ✅ 已解决 (Phase 6.7 doc §1.1)
- memory `ios_remote_extension_phase6_7.md` 写实施 trap

**总工期**：3.5-4 天（vs Plan §8.1 estimate 7d — 因 Trap T4 解决后协议比想象简单）

---

## 6. 测试

| Sub-phase | 单测数（估）|
|---|---:|
| 6.7.1 ExtensionCommands | 30+ (每 method 至少 envelope + decode) |
| 6.7.2 UI | 0 (SwiftUI view 不易测，与既有一致) |
| **总计** | **~30 unit + 3 集成 (clientId/error path/启动检测)** |

真机 E2E 留 Phase 6.0 一并跑：装 Chrome 扩展 → iPhone 拉 tabs → navigate → screenshot → clearCookies。

---

## 7. 风险 & trap 预备

### 7.1 已知 trap (Phase 6 模板复用)

参考 memory `ios_phase_6_skill_template.md` (12 trap) + `ios_remote_desktop_phase6_6.md` (14 trap，其中 P1 streaming/P2 UIViewRep/P3 closure capture 三个模式)。

### 7.2 Phase 6.7 新预期 trap

#### Trap E1 — clientId 多实例混淆
用户开 2 个 Chrome 实例都装了 ChainlessChain 扩展 → `getFirstClientId` 返第一个，可能不是用户想控制的那个。**v0.1 mitigation**：UI 加"刷新连接"按钮 + 显示当前 clientId（如果可拉）。完整 fix 留 v0.2 加 client picker。

#### Trap E2 — 错误 message 字符串依赖
OQ-3 实现依赖检测 `"No browser extension connected"` 字符串 — 桌面端改文案就 break。**预防**：抽常量到 `ExtensionErrorMessages.notConnected` + 桌面端 + iOS 端双向引用同字符串（理想：让桌面端返 error code 而非字符串，留 v0.2 协议升级）。

#### Trap E3 — 95 method 中部分桌面没 case
Coverage doc 写 93/95 = 2 个 Android method 桌面没匹配 case — 这 2 个具体是哪个未确定。**预防**：实施 6.7.1 时 grep `extension.<X>` 名字逐个 vs `browser-extension-server.js` 的 490 case 列表，发现 mismatch 早决策（要 iOS skip 还是桌面端加 case）。

#### Trap E4 — Chrome 扩展未装的错误 message 内容可能含路径
桌面 error 含 "Please install and connect the ChainlessChain Browser Extension." — 中文用户看到英文文案体验差。**预防**：i18n 留 v0.2；iOS UI 端 banner 加中文说明覆盖。

#### Trap E5 — extension.<X> 返 raw Chrome API JSON 字段未对齐 iOS Codable
Chrome extension API 返 JSON 字段名是 Chrome 内部约定（如 `id` 是 int 而非 String，`url` 是必填等）— iOS struct 字段类型一旦写错某 method 就 silent decode 失败。**预防**：每 method 单测 mock 真实 Chrome API response shape（不是简化的 `{success: true}`）。

---

## 8. 时间线

| Sub-phase | 工期 | 累计 |
|---|---:|---:|
| 6.7.1 ExtensionCommands + 30 method + tests | 2 天 | 2 |
| 6.7.2 UI 子 tab + 引导 banner | 1.5 天 | 3.5 |
| 6.7.3 doc 修正 + memory | 0.5 天 | 4 |
| buffer (clientId 实战调试 + niche edge) | 1 天 | **5 天** |

vs Plan §8.1 estimate 7d：**节省 2d**（Trap T4 解决后 wire 简单）。

---

## 9. 决策记录

| 日期 | OQ | 决策 | 决策人 | 备注 |
|---|---|---|---|---|
| 2026-05-18 | OQ-1 | 待定（推荐 30 method 5 桶分布）| — | 80/20 高频场景 |
| 2026-05-18 | OQ-2 | 待定（推荐 A 默认 getFirstClientId）| — | 99% 单实例 |
| 2026-05-18 | OQ-3 | 待定（推荐 A banner + 跳 Safari）| — | 桌面 docs 是 source of truth |
| 2026-05-18 | OQ-4 | 待定（推荐 B SystemTools 子 tab）| — | 低频功能不主屏 |
| 2026-05-18 | OQ-5 | 待定（推荐 A onAppear .task 检测）| — | 早发现早引导 |

---

## 10. 关联文档 & memory

### 10.1 必读 design docs
- `iOS_对标_Android_Phase_6_Plan.md` §5.7 + §7 Trap T4（本文档解决）
- `Desktop_Mobile_Bridge_Namespace_Coverage.md`（extension 97% 数据 + 表格）
- `iOS_Phase_6_6_Desktop_Skill.md`（架构审计模式参考；Trap T2 解决套路）
- `iOS_Phase_3_Remote_Operate_Framework.md`（framework）

### 10.2 必读 memory
- `ios_phase_6_skill_template.md`（Phase 6 模板 + 12 trap）
- `ios_remote_desktop_phase6_6.md`（架构审计 + actor 模板）

### 10.3 Android 对照
- `android-app/app/src/main/java/com/chainlesschain/android/remote/commands/ExtensionCommands.kt`（95 invoke）
- `desktop-app-vue/src/main/remote/browser-extension-server.js`（490 case in ExtensionBrowserHandler.handle()）

### 10.4 Phase 6.7 输出预期（实施后）
- `memory/ios_remote_extension_phase6_7.md`（5-8 真实战 trap）
- Coverage doc + Plan §7 Trap T4 ✅ 修正 commit
- `Modules/CoreP2P/Sources/RemoteSkills/Extension/` 2 swift (Models + Commands)
- `Features/RemoteOperate/Views/SystemToolsView.swift` 加 ExtensionToolView 子 view
- `Tests/CoreP2PTests/ExtensionCommandsTests.swift`

## 附录：规范章节补全（v5.0.3.108）

> 本文为设计文档（草案，需 OQ 拍板）。为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文细节。

### 1. 概述

见正文「1. 背景 & 架构审计」。iOS Phase 6.7 Extension Skill：经远程操控 Chrome 扩展控制浏览器；v0.1 草案，需 OQ 1–5 拍板后开 sub-phase 6.7.1。

### 2. 核心特性

Chrome 扩展浏览器控制；Extension typed commands；SystemToolsView 加 ExtensionToolView。

### 3. 系统架构

见正文「4. 协议设计」；ExtensionCommands ↔ 桌面 Chrome 扩展 bridge。

### 4. 系统定位

iOS 端**Chrome 扩展浏览器控制 skill**（Phase 6.7）。

### 5. 核心功能

见正文「5. 子阶段」：Extension Models + Commands + ExtensionToolView。

### 6. 技术架构

`Modules/CoreP2P/Sources/RemoteSkills/Extension/`（Models + Commands）；`SystemToolsView.swift` 加 ExtensionToolView 子 view。

### 7. 系统特点

需 OQ 1–5 拍板；复用 browser-extension 子系统（桌面侧）。

### 8. 应用场景

iPhone 远程控制桌面 Chrome 扩展（浏览器自动化）。

### 9. 竞品对比

对标 Android REMOTE 浏览器控制（见 `iOS_对标_Android_Phase_6_Plan.md`）。

### 10. 配置参考

Extension command 协议（OQ 决策）；桌面 Chrome 扩展前置。

### 11. 性能指标

命令往返时延（浏览器控制）。

### 12. 测试覆盖

见正文「6. 测试」：`ExtensionCommandsTests.swift`。

### 13. 安全考虑

浏览器控制高风险；走配对信任；命令白名单。

### 14. 故障排除

扩展未连 / 命令失败 → 见实施后 memory `ios_remote_extension_phase6_7.md`。

### 15. 关键文件

`RemoteSkills/Extension/`（Models + Commands）；`SystemToolsView.swift`（ExtensionToolView）。

### 16. 使用示例

见正文「4. 协议设计」。

### 17. 相关文档

`iOS_Phase_6_6_Desktop_Skill.md`、`iOS_对标_Android_Phase_6_Plan.md`、`iOS_Phase_6_0_RealDevice_E2E_Plan.md`。
