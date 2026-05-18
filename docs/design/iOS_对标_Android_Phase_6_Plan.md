# iOS 对标 Android Phase 6 — Gap Closure Plan

> **状态**：草案 v0.1（2026-05-18 创建）。Phase 5.7 真机 E2E 仍 pending；本 Plan 覆盖 Phase 5 后续所有 iOS 工作直至与 Android 功能对齐。
>
> **依赖**：iOS Phase 1.1–5.6 全 impl 落地（2026-05-15 → 2026-05-16）；iOS app target 0 错（`a8dc88b13`, 2026-05-17）；iOS signing 基础设施齐（memory `ios_signing_infra_state.md`）；release.yml `build-ios` 当前回退 SPM-only（`faa8e267f`）。
>
> **对齐版本**：Android `app/src/main/java/com/chainlesschain/android/remote/{commands,registry}/` — 24 Commands.kt + 23 SeedRegistry entries（total methodCount = 795，per `SeedRegistry.kt` 头注释）；Android `feature-local-terminal` Phase 0.5（mksh R59c + toybox 0.8.11 cross-build，W^X 已修，`8c30ef8ac` 至 `eb69e9a1a`）；Android `wear-app` 模块（Wear OS 伴侣）；Android `release.yml` Android 路径 4 assets 出 .apk + .aab。
>
> **关联文档**：`iOS_Phase_1_Pairing_Flow_B.md` / `iOS_Phase_2_Remote_Terminal.md` / `iOS_Phase_3_Remote_Operate_Framework.md` / `iOS_Phase_4_Notification_Skill.md` / `iOS_Phase_5_AI_Chat_Skill.md`（5 个前置 phase 设计 + 实施 trap memory 全套）；memory `ios_app_target_compile_state.md` / `ios_signing_infra_state.md` / `feedback_ios_swift_spm_ci_traps.md`。

---

## 1. 背景

### 1.1 现状摘要（2026-05-18）

iOS 端从 2026-05-15 起 5 天连续 land 5 个 Phase（pairing → remote terminal → remote operate framework → notification → AI chat），iOS app target 编译 412 错 → 0 错完成收口。当前 SPM 6 module 全过、xcodebuild app target 0 错、签名基础设施齐备。**但**：

1. 5 个 Phase 的真机 E2E（1.7 / 2.7 / 3.7 / 4.7 / 5.7）全部 pending — 需 Mac + iPhone + 真桌面在场，Win dev box 不可验。
2. Android 23 个 remote skill 中 iOS 只 impl 了 6 个（Clipboard / File / Screenshot / SystemInfo / Notification / AIChat），剩 **17 个 skill 待 impl**。
3. release.yml `build-ios` 临时回退 SPM-only path（`faa8e267f`）— **.ipa 当前不出**，恢复 archive + export 需重 wire xcodebuild + 验 4 个 signing secrets。
4. Android `feature-local-terminal` 2026-05-18 刚 land Phase 0.5（mksh + toybox cross-build + W^X 修复）— **iOS 端无任何 local terminal scaffold**，且 iOS 沙盒限制 fork/exec，技术可行性需先 spike。
5. Android `wear-app` 模块（Wear OS data layer + 表盘 widget）— **iOS 无 watchOS target**。

### 1.2 Phase 6 = 收口 + 17 skill + .ipa + 可选 watchOS

Phase 5 之前所有 iOS 工作都是"先 framework 后 skill"模式（Phase 3 framework → Phase 4/5 第 1/2 个 skill）。Phase 6 是 **gap closure + scale-out** —
framework 已就位 (`RemoteCommandClient` + `OfflineCommandQueue` + `LRUSet` + events fan-out)，剩下的 17 skill 全部走 Phase 4/5 的 6-sub-phase 模板复用，**无需新机制**（除非某个 skill 引入新协议特性，如 desktop 鼠键的 30 FPS 输入流可能需要类似 stream chunk 的分片机制）。

### 1.3 Android ↔ Desktop 真实覆盖率（2026-05-18 实测）

> **更新源**：`Desktop_Mobile_Bridge_Namespace_Coverage.md`（Phase 6.0 Trap T2 输出）。本表为审计结论，不是 SeedRegistry 注释估计。
>
> **A = Android `client.invoke("<ns>.<method>")` 唯一 method 数 / D = Desktop handler `case "<method>"` 唯一 method 数 / ✓ = 严格名称匹配 / % = ✓/A**
>
> **重大修正**：原 SeedRegistry display 字段写的 `application` / `system.info` 与 runtime invoke 用的 `app` / `sysinfo` 不一致——SeedRegistry 自己有 naming drift，**实际桌面 ↔ Android namespace 完全对齐，0 mismatch**。Phase 6.0 Action: 修 SeedRegistry display 字段对齐 invoke 名。

| Namespace | A | D | ✓ | % | 档 | iOS 状态 | 桌面 debt |
|---|---:|---:|---:|---:|---|---|---|
| **input** | 10 | 10 | 10 | **100%** | 🟢 | ❌ 待 6.1B1 | 0 |
| **display** | 11 | 11 | 11 | **100%** | 🟢 | ❌ 待 6.1B1 | 0 |
| **userBrowser** | 18 | 18 | 18 | **100%** | 🟢 | ❌ 待 6.1B1 | 0 |
| **security** | 8 | 8 | 8 | **100%** | 🟢 | ❌ 待 6.1B1 | 0 |
| **app** | 8 | 8 | 8 | **100%** | 🟢 | ❌ 待 6.1B1 | 0 |
| **extension** | 95 | 490 | 93 | **97%** | 🟢 | ❌ 待 6.7（独立 WS）| 2 method |
| **clipboard** | 7 | 10 | 6 | 85%（语义 100% sub-dispatch）| 🟢 | ✅ Phase 3 | 0 |
| **workflow** | 13 | 10 | 10 | **76%** | 🟡 | ❌ 待 6.5 | 3 method |
| **notification** | 11 | 7 | 6 | **54%** | 🟡 | ✅ Phase 4 但桌面缺 5 method | **5 method**（broadcast/clearAll/delete/getUnreadCount/markAllAsRead）|
| **history** | 7 | 8 | 3 | **42%** | 🟡 | ❌ 待 6.5 | 名称分化大 |
| **browser** | 33 | 12 | 12 | **36%** | 🟡 | ❌ 待 6.2 | 21 method |
| **device** | 12 | 16 | 4 | 33%（桌面更多）| 🔴 | ❌ 待 6.1 后台 | 名称分化 |
| **power** | 34 | 10 | 10 | 29%（D ⊂ A）| 🔴 | ❌ 待 6.1 后台 | 24 method |
| **file** | 44 | 17 | 11 | **25%** | 🔴 | ✅ Phase 3 部分 | 33 method + §3.2 双 handler 决策 |
| **sysinfo** | 42 | 10 | 10 | 23%（D ⊂ A）| 🔴 | ✅ Phase 3 | 32 method |
| **process** | 30 | 6 | 6 | 20%（D ⊂ A）| 🔴 | ❌ 待 6.1 后台 | 24 method |
| **network** | 53 | 11 | 11 | 20%（D ⊂ A）| 🔴 | ❌ 待 6.1 后台 | 42 method |
| **media** | 55 | 10 | 10 | 18%（D ⊂ A）| 🔴 | ❌ 待 6.2 | 45 method |
| **desktop** | 51 | 12 | 7 | 13% (含 sub-dispatch；详见 Phase 6.6 doc §1) | 🟡 | ❌ 待 6.6 | **0** ✅（桌面 7 outer + 5 sub-type 已支持，44 Android-only 多数在其它 ns 覆盖；Phase 6.6 v0.1 桌面 debt = 0）|
| **system** | 49 | 5 | 5 | 10%（D ⊂ A）| 🔴 | ❌ 待 6.5 | **44 method**（最大单 namespace debt）|
| **knowledge** | 55 | 9 | 4 | **7%** | 🔴 | ❌ 待 6.3 | **46 method + 名称分化**（getNote vs getNoteById, listTags vs getTags 等）|
| **ai** | 52 | 10 | 4 | **7%** | 🔴 | ⚠️ Phase 5 chat 8 method | **42 method**（chatStream / RAG add / model 管理 / multimodal / embedding）|
| **总计** | **696** | 1186 | **310** | **45%** | | 6 已 impl / 17 待 + 部分桌面 debt | **~280 method 桌面端待补** |

### 1.4 影响摘要

- ✅ 23/23 namespace 在桌面 `remote-gateway.js` 全部 registerHandler — 0 完全缺失
- 🟢 **5 个 100% wired skill** 可立即 impl 无需桌面协调 = Phase 6.1B1 快赢
- 🔴 **11 个红档 namespace 桌面 debt ~280 method** 主要集中在 ai (42) + knowledge (46) + system (44) + media (45) + network (42) + power (24) + storage / process / sysinfo (~30 each) — Phase 6.3/6.4 实施前**必须**桌面端先扩 handler
- 多数红档 namespace 实际是 "Desktop ⊂ Android" 关系：iOS impl 桌面已支持子集**天然安全**，剩余 method 是 future debt

---

## 2. 目标 & 非目标

### 2.1 目标（Phase 6 in scope）

| # | 项 | 验收 |
|---|---|---|
| G1 | 5 个前置 Phase 真机 E2E 全跑通 + 修真机暴露的 bug | 5 个 design doc §8.3 / §7 reproducer 全 ✅；任一回锅 framework 改动 ≤ 2 天 |
| G2 | release.yml `build-ios` 恢复 archive + export，.ipa 入每个 vX.Y.Z.N tag 的 assets | tag → release run 全绿 + .ipa 出现在 8 desktop + 4 Android + 1 iOS = 13 assets |
| G3 | 17 个 remote skill 按优先级 1–3 group 全部 impl + 单测 ≥ 30/skill + 至少 1 集成测试 | 23 namespace 全在 `byNamespace` map + UI tab 入口接通 |
| G4 | 本地终端可行性 spike（2 天） | 输出决策 doc：Plan A (WebKit terminal + JS shell)/B (iSH-style x86 emu)/C (放弃，远程终端 only) |
| G5 | watchOS companion 可行性 spike（1 天） | 决策 doc：要做（M+ months）/ 不做（写明业务理由）|
| G6 | iOS in-app update（OTA）对标 Android UpdateChecker | iOS 端起 App Store 跳转 + TestFlight beta channel 检测 + diff 版本号 banner |

### 2.2 非目标（defer）

- **iOS feature module 与桌面对等**（Knowledge / Blockchain / Plugin / Workflow / ImageGen 等 26 个 Features/ 目录）— Phase 6 只关注远程操控对齐，**iOS 原生 feature 完整度**留到 Phase 7+（按用户需求触发，非预防性铺）
- **iOS 端原生本地 LLM**（参考 Android `feature-ai` 的 ggml/llama.cpp 集成）— 留 Phase 8+，与 watchOS 同档
- **多设备 sync 协议主动加 iOS 节点**（Phase 3d Mobile Sync 已 land for Android）— Android 走 P2P session DID 兜替 device registry，iOS 复用同样路径，**接入测试**留 Phase 6 末或 Phase 7
- **Wear OS 跨平台 iOS WatchOS 共享 widget code**（不可能 — Wear OS Compose 与 SwiftUI 是两个 stack）

---

## 3. Open Questions

### OQ-1：5 个 phase E2E 跑法 — 串行单晚 vs 分次跑

**A**：一晚 Mac+iPhone+真桌面在场，按 1.7 → 2.7 → 3.7 → 4.7 → 5.7 顺序串跑（每 phase 30–60min，含 bug fix 4–6h）
**B**：分 2 晚跑：晚 1 = 1.7 + 2.7（pairing + terminal 基础链路），晚 2 = 3.7 + 4.7 + 5.7（framework + 2 skill）
**C**：分 5 晚跑（每晚 1 phase + 充分调试 buffer）

**推荐 A**。理由：(1) 5 phase 全部依赖同一套 RemoteCommandClient + DC + signaling 链路，串跑能在同次环境下找出**跨 phase 的 framework bug**（如 Phase 3 events fan-out 串入 Phase 4 NotificationDispatcher 时新增的 subscription 单消费者 trap）；(2) E2E 失败的修法通常是 framework 改动 + 影响后续 phase，串跑可一次修完 redo；(3) Phase 1.7 是 prerequisite — Pairing 不通后面 4 个 phase 全 0% 可测，先验 Pairing 决定后续节奏；(4) 如果用户带宽允许，分 2 晚（B）作为 fallback 也可接受。

### OQ-2：17 skill impl 顺序 — 用户高频优先 vs 复杂度递增

**A**：按用户高频排序（input → media → display → knowledge → system/process/power → ...）
**B**：按 Android methodCount 递增（history 12 / display 18 / application 18 / device 20 / userBrowser 22 / workflow 24 / input 25 / process 28 / power 28 / browser 30 / storage 32 / system.info* / system 45 / network 47 / ai 余 / knowledge 55 / media 61 / desktop 70 / extension 95）
**C**：按"对桌面端 RPC 已有 / 无"分组：先做桌面端 mobile-bridge.js 已 wire 的 namespace，再补桌面端缺的

**推荐 A 优先 + B 修正**。理由：(1) input/media/display 是远程操控核心场景（"用手机控制桌面"卖点），先做提供最大用户感知；(2) knowledge skill 55 method 体量大但用户高频（笔记/RAG）且 Android 已成熟可镜像；(3) desktop 70 method 与 extension 95 method 留最后 — desktop 鼠键流复杂（30 FPS 输入需新协议机制），extension 是 Chrome 扩展独立 WS 子系统（用户少），延后；(4) C 选项有道理但需要先扫桌面端 `mobile-bridge.js` 的 namespace 覆盖率（独立调研，1–2h），数据出来前 default A。

### OQ-3：每个 skill 是否走 Phase 4/5 6-sub-phase 完整模板

**A**：全部 17 skill 走完整 6-sub-phase（Models / Commands actor / EventDispatcher / ViewModel / View / DI wiring），每个 ~1.5–2 天
**B**：按 skill 类型分档：(b1) 纯 request/response skill（如 input/display 单次调用）跳过 EventDispatcher，5 sub-phase；(b2) 有 push event 的 skill（如 desktop screencast 流）走完整 6 sub-phase
**C**：按是否有 UI 分档：(c1) 后台 skill（如 power/process/system）只有命令调用入口，无独立 UI tab，3 sub-phase（Models / Commands / DI wiring + 在 SystemInfo 或新增 "Tools" tab 收纳）；(c2) 主屏 skill（如 input/media/knowledge）走完整 6 sub-phase

**推荐 B + C 混合**。理由：(1) 全套 6-sub-phase 对纯 request/response skill 是过度设计（EventDispatcher 是空壳）；(2) 17 skill 中估计 10+ 是后台型（power/process/storage/device/network/security/history/application 都没 push event），独立 tab 17 个会让 RemoteOperateView 横向滚动条爆炸；(3) UI 分档（C）把后台 skill 收进 "系统工具" 复合 tab 大幅减少 UI 工作量。最终估算见 §5 子阶段。

### OQ-4：iOS 端 .ipa 出包后 in-app update channel — App Store vs TestFlight vs ad-hoc

**A**：App Store only — 用户跳转 App Store 升级（最简单，但发版要走 Apple 审核 1–7 天）
**B**：TestFlight beta channel — 内测用户走 TestFlight，正式用户走 App Store（标准 iOS 模式）
**C**：ad-hoc 企业分发（参考 Android UpdateChecker 直接下载 .ipa）— 需 Apple Enterprise Developer Program ($299/year) 或绕过 App Store 的灰色路径

**推荐 B**。理由：(1) Android UpdateChecker 直链下载 .ipa 在 iOS 是不被允许的（App Store 审核会 reject 任何绕过 App Store 的 OTA），强行做即使技术可行也会被砍；(2) TestFlight beta 是 iOS 唯一合规的"快速发新版"通道，配合现有 vX.Y.Z.N tag → release 流程；(3) iOS 用户基数预期远小于 Android（已对标 ChainlessChain 桌面主力），不值得为 (c) 选项付企业证书年费 + 维护风险。Phase 6 G6 仅 impl 一个 "in-app banner: 检测到 App Store 有新版 → tap 跳转" 即可，TestFlight 走 Apple 原生 prompt。

### OQ-5：本地终端 spike 决策矩阵预设

无推荐，本 OQ 仅声明决策框架，spike 输出后再选：

| Plan | 路径 | 风险 | 估时 |
|---|---|---|---|
| **A** | WebKit WKWebView + xterm.js + 嵌入 JS shell（如 quickjs-emscripten 跑 shell-like REPL）| iOS 沙盒不让 fork/exec 真二进制；只是 JS 沙盒 REPL；用户不满意"假终端" | 1 周 |
| **B** | iSH-style 用户态 x86/x86_64 翻译器（emscripten + alpine rootfs）| 性能差（10–100x slowdown）；APK size +30MB；Apple 历史上批准过 iSH (TestFlight) 但 App Store 反复下架 | 3–6 周 |
| **C** | 放弃本地终端，主推远程终端 only（Phase 2 Plan A.1）| 用户失去"地铁里临时执行命令"场景；但移动场景下本地终端价值本就低 | 0 |
| **D** | 等 iOS 26+ Apple 放开 BSD shell API（已有传闻但未官宣）| 完全 vendor-dependency 时间 | 12+ months |

### OQ-6：watchOS spike 决策矩阵预设

| 选项 | 范围 | 估时 | 用户感知 |
|---|---|---|---|
| 不做 | watchOS target 跳过 | 0 | 0 |
| MVP | 仅 push notification mirror（从 iPhone 转发到 Apple Watch）| 3–5 天 | 中（接收提醒）|
| Full | mirror Android wear-app 完整功能（表盘 widget + 快捷命令 + 心率传 LLM）| 4–6 周 | 高，但 Apple Watch 用户基数小 |

---

## 4. 范围 & 模块影响

### 4.1 文件新增预估

| 区 | 新文件数（估）| 修改文件数（估）|
|---|---:|---:|
| `ios-app/Modules/CoreP2P/Sources/RemoteSkills/<skill>/` × 17 | ~85 (5/skill avg) | 1 (`SeedRegistry.swift` 已包含 23 entries) |
| `ios-app/ChainlessChain/Features/RemoteOperate/Views/` (UI tab 主屏 skill ~7) | ~14 (2/skill avg: ViewModel + View) | 1 (`RemoteOperateView.swift`) + 1 (`SkillTabPickerView.swift`) |
| `ios-app/ChainlessChain/Features/RemoteTerminal/RemoteDependencies.swift` | 0 | 1 (加 17 个 commands + dispatchers props + fan-out task 多 yield) |
| `ios-app/Tests/CoreP2PTests/RemoteSkills/` × 17 | ~17 (1 test file/skill avg, 各含 8–15 test) | 0 |
| `ios-app/.github/workflows/release.yml` ipa 恢复 | 0 | 1 (revert + 加 archive/export step) |
| `docs/design/iOS_Phase_6_*.md` (每个大 skill 1 doc) | ~8–10 | 0 |

### 4.2 不动的范围

- `ios-app/Modules/Core{Common,Database,DID,E2EE,Security}/` — 0 改动
- `ios-app/ChainlessChain/Features/{AI,Blockchain,Knowledge,Plugin,Workflow,...}/` 现有原生 feature — Phase 6 不动（非目标 §2.2）
- 桌面端 `desktop-app-vue/src/main/mobile-bridge.js` — 仅在 iOS 新 skill 找不到对应桌面 handler 时小幅扩展，原则上 iOS 镜像 Android 已有 namespace 不动桌面

---

## 5. 子阶段 (Sub-phases)

> 子阶段编号沿用 Phase X.Y 范式（Phase 6 大块 → 6.1 / 6.2 / ... 起步；每个新 skill 内部再 6.X.1 / 6.X.2 ...）。

### Phase 6.0 — 5 个前置 E2E 收口 + .ipa 恢复（G1 + G2）

**优先级**：P0（最高，sunk cost 解锁条件）

**时间**：1–2 晚（含 bug fix）

#### 6.0.1 Mac + iPhone + 真桌面环境准备
- 安装 v5.0.3.5x 桌面（dev box 编译或 release download）
- iPhone 通过 Apple Developer 模式安装 ad-hoc .ipa（参考 `ios_signing_infra_state.md`：单 UDID `b9a7376832...`，Team `2GMR44F922`，bundle `com.chainlesschain.ChainlessChain`）
- Mac Xcode debug attach → iPhone（看 console log）

#### 6.0.2 Phase 1.7 Pairing E2E（Flow A + B + 手输）
- 参考 memory `ios_qr_pairing_three_flows.md` 完整 reproducer
- 3 流各 1 次，验 LAN → relay fallback
- 失败回滚到 `iOS_Phase_1_Pairing_Flow_B.md` §6.5 修订路径
- **成功标准**：iPhone 配对成功后 PairedDevicesListView 显示桌面 + 重启 App 后持久化

#### 6.0.3 Phase 2.7 Remote Terminal E2E
- 参考 `iOS_Phase_2_Remote_Terminal.md` §8.3 4 场景
- (1) LAN 同 WiFi DC 握手 ≤ 2s + RTT ≤ 200ms
- (2) 蜂窝 → TURN relay RTT ≤ 500ms + 30min stdout 不断
- (3) 故意杀桌面 mobile-bridge → fallback 中继 ≤ 3s + chip 切色
- (4) 恢复 → 自动切回 P2P 直连
- **预备 trap**：Xcode 资源需 drag `Features/RemoteTerminal/Bundle/` "Create folder references" 加 app target（OQ-1 决策的 Bundle 文件夹）

#### 6.0.4 Phase 3.7 Remote Operate Framework 4 skill E2E
- Clipboard 双向 / File 浏览 ~/Documents / Screenshot 保存相册（PHPhotoLibrary prompt）/ SystemInfo 4 cards + 5s polling
- 参考 memory `ios_remote_operate_phase3.md` 9 实施 trap（Screenshot autoreleasepool base64 内存防 spike / SystemInfo polling lifecycle）

#### 6.0.5 Phase 4.7 Notification E2E（8 场景）
- `iOS_Phase_4_Notification_Skill.md` §8.3 8 场景：拉历史 / 桌面 push / LRU dedup / iPhone markAsRead 双向 / 离线 swipe drainer / quiet hours silenced / authorization denied / app 后台回前台 refresh
- 预备 trap：UN center authorization 第 1 次 prompt

#### 6.0.6 Phase 5.7 AI Chat E2E（8 场景）
- `iOS_Phase_5_AI_Chat_Skill.md` §8.3 8 场景：拉历史 ≤ 500ms / token-by-token 流式 / cancel ≤ 1s 含 LLM 真中断 / tab 切换保留 / 离线发问"需在线"banner / 离线创建对话入队 / 长对话 100 limit / 后台 1min 回前台 refresh
- 预备 trap：第 3 子流 buffer 512 vs 256（chat token 50ms 涌速）

#### 6.0.7 .ipa 恢复
- (1) revert `faa8e267f`（`release.yml` 回 xcodebuild app target build 路径）
- (2) 验 4 secrets `IOS_CERTIFICATE_BASE64` / `IOS_PROVISIONING_PROFILE_BASE64` / `IOS_TEAM_ID` / `IOS_KEYCHAIN_PASSWORD` 在 GitHub repo settings
- (3) v5.0.3.NN tag 触发 release，验 `ios-build` step 出 .ipa + 入 release assets
- 预备 trap：memory `feedback_ios_signing_spm_target_leak.md`（SPM target leak — `PROVISIONING_PROFILE_SPECIFIER` 不能走 CLI）+ `feedback_xcpretty_swallows_xcodebuild_errors.md`（xcpretty silent drop）

#### 6.0.8 深度验证（Trap T2 续作，1–2h）
来自 `Desktop_Mobile_Bridge_Namespace_Coverage.md` §3：
- (1) **desktop sub-dispatch**：验 Android `desktop.mouseMove` 直调走 `Unknown action` 还是桌面有 alias 到 `sendInput` 内层 — 决定 Phase 6.6 desktop skill 51 method 真实可用率
- (2) **android-file-handler 注册路径**：`desktop-app-vue/src/main/remote/handlers/android-file-handler.js` 12 case 没在 remote-gateway register — 是 dead code / 走其它入口 / 待 register？决定 Phase 6 file skill 完整度
- (3) **clipboard text/html/image/files**：是独立 invoke 入口（`clipboard.text`）还是 `get/set` 的 `type` 参数 sub-dispatch — 决定 iOS typed wrapper 是否需扩

#### 6.0.9 SeedRegistry naming drift 修复
修 `android-app/app/src/main/java/com/chainlesschain/android/remote/registry/SeedRegistry.kt` namespace 字段：
- `application` → `app`（与 ApplicationCommands.kt invoke 名一致）
- `system.info` → `sysinfo`（与 SystemInfoCommands.kt invoke 名一致）

**Exit criteria**：5 phase E2E 全 ✅ + 一个新 tag .ipa 进 release + 3 个 sub-dispatch 验证结论写入 Coverage doc §3 + SeedRegistry drift 修复。**任何 framework bug 修后 redo 影响 phase。**

---

### Phase 6.1 — 第 1 批快赢：5 个 100% wired skill（OQ-3 B 选项 + Coverage §4.2 B1）

> **修订 2026-05-18**：按 Coverage §4.2 桌面就绪度重排，本批替代原 Phase 6.1 "后台型 batch"。原后台型 batch 部分挪到 Phase 6.1B3（红档桌面已支持子集）。

**优先级**：P1（最高，纯 iOS 工作无桌面协调）

**时间**：**3–5 天**（5 skill × 0.5–1 天 avg）

**范围**：input (10) + display (11) + app (8) + security (8) + userBrowser (18) = **55 method 全 100% wired**

#### 6.1.1 共享：合并 SystemTools tab 还是各自独立 tab？
3 个候选 UI 收纳方案：
- **A 各自独立 tab**：RemoteOperateView 加 5 个 tab（→ 总 12 tab，超过 Phase 4.5 horizontal scroll 测过的 5+）— 视觉爆炸
- **B 全合并到"系统工具" tab**：新增 SystemToolsView 内置 5 类 picker + detail sheet — Phase 6.1 时机太早（Phase 6.1B3 还会加 6 个后台 skill）
- **C 分两类**：input + display 接现有 Phase 6.2 主屏（用户高频），app + security + userBrowser 进 SystemTools tab（后台型）

**推荐 C**。input/display 进 §6.2；本节后续仅覆盖 app + security + userBrowser 3 个进 SystemTools。

#### 6.1.2 InputCommands actor + iOS 触控板 UI（→ 6.2 主屏 batch 提前 1 个）
- Models: MouseClickRequest / KeyPressRequest / MouseScrollRequest / ...
- InputCommands actor 10 method（mouseMove / mouseClick / mouseDoubleClick / mouseDrag / mouseScroll / sendKeyPress / sendKeyCombo / typeText / getCursorPosition / getKeyboardLayout）
- RemoteInputView SwiftUI：trackpad 触摸区 + 滚轮条 + 虚拟键盘 toggle + sendKeyCombo (Cmd+C 等) quick buttons
- Trap T3 鼠标流批量：本 v0.1 不做（每 click/keyPress 单 RPC，触摸 throttle 由 UI 端 16ms debounce 解决，无需协议层 batch）— 留 Phase 6.6 desktop skill 解
- DI wiring + RemoteOperateView 第 7 tab "操作"（icon `cursorarrow.rays`）
- **单测目标 ≥ 15**（10 method × 1 happy + 5 错误场景）

#### 6.1.3 DisplayCommands actor + iOS 显示器信息视图
- Models: DisplayInfo / ResolutionMode / ColorProfile / ...
- DisplayCommands actor 11 method（getDisplays / getActiveDisplay / setActiveDisplay / getResolution / setResolution / getBrightness / setBrightness / getOrientation / 等）
- RemoteDisplayView SwiftUI：多显示器卡片列表 + 当前分辨率 + 亮度滑条
- DI wiring + 进 SystemTools 子 tab "显示"
- **单测目标 ≥ 13**

#### 6.1.4 ApplicationCommands actor (`app` namespace) + 应用列表视图
- Models: AppInfo / RunningAppInfo / ...
- ApplicationCommands actor 8 method（listInstalled / listRunning / getInfo / launch / close / focus / minimize / restart）
- RemoteApplicationsView SwiftUI：搜索 + 已安装/运行中 segmented + tap 启动/关闭/聚焦
- DI wiring + 进 SystemTools 子 tab "应用"
- **单测目标 ≥ 10**

#### 6.1.5 SecurityCommands actor + iOS 安全状态视图
- Models: FirewallStatus / PermissionInfo / ...
- SecurityCommands actor 8 method（getFirewallStatus / enableFirewall / disableFirewall / listPermissions / 等）
- RemoteSecurityView SwiftUI：只读卡片（防火墙状态 / 权限列表）+ toggle（高危需 ApprovalGate UI 经 Phase 5 既有）
- DI wiring + 进 SystemTools 子 tab "安全"
- **单测目标 ≥ 10**

#### 6.1.6 UserBrowserCommands actor + iOS 浏览器控制视图
- Models: TabInfo / CookieInfo / NavigationCommand / ...
- UserBrowserCommands actor 18 method（listTabs / activeTab / navigate / reload / goBack / goForward / executeScript / screenshot / 等）
- RemoteUserBrowserView SwiftUI：tab 列表 + 当前 tab 地址栏 + 前进/后退/刷新 + 截图查看
- DI wiring + 进 SystemTools 子 tab "浏览器"（与 Phase 6.7 extension 区分：userBrowser 用 CDP 控用户浏览器，extension 是 Chrome 扩展）
- **单测目标 ≥ 18**

#### 6.1.7 SystemTools tab 框架收口
- 新增 `SystemToolsViewModel` + `SystemToolsView` (`Features/RemoteOperate/Views/`)
- 顶部 horizontal picker 4 项（应用 / 安全 / 浏览器 / 显示）
- `RemoteOperateView` 加第 7 tab "系统工具"（icon `gear`）
- DI: `RemoteDependencies` 加 4 commands + 0 dispatcher（5 skill 全 request/response，无 push event 子流）

**Exit criteria**：
- 5 skill 在 `RemoteCommandClient` 可调用
- RemoteOperateView tab 计：terminal / clipboard / file / screenshot / sysinfo / notification / AI Chat / 操作 / 系统工具 = **9 tab**
- 单测累计 +66 → iOS 测试总数 ~420
- DC mock 集成测试：5 skill 各 1 个 mock invoke → decode → assert

### Phase 6.1B3 — 红档桌面已支持子集 batch（原 6.1 后台型）

> 桌面 case ⊂ Android invoke 的 6 个红档 namespace，**iOS 只 impl 桌面已支持的子集** = 天然安全，无桌面 debt。

**优先级**：P2

**时间**：**5–7 天**（6 skill × 0.5–1 天）

**范围**：power (10) / process (6) / network (11) / sysinfo*(增量) / storage (10) / device (4 匹配) = ~45 method（iOS impl 桌面子集）

> *sysinfo Phase 3 已 impl 4 cards，6.1B3 扩到桌面已支持的 10 method 完整集

#### 6.1B3.1 每个 skill 走精简 3 sub-phase
- Models + Commands actor（实施桌面已支持 method）
- Tests + DI wiring
- 接入 SystemToolsView detail sheet（list method + show result，无独立 view）

#### 6.1B3.2 桌面 debt backlog 文档化
为每个红档 namespace 输出"桌面 debt method 清单"到 Coverage doc §X，留 Phase 7+ backlog：
- power 24 method 缺
- process 24 method 缺
- network 42 method 缺
- sysinfo 32 method 缺
- storage 31 method 缺
- device 名称分化清单

**Exit criteria**：6 skill 桌面已支持子集全 wire + SystemToolsView 子 tab 加 6 类 + debt backlog doc

---

### Phase 6.2 — 主屏 skill batch 1（用户高频）

**优先级**：P1（与 6.1 并行）

**时间**：~12 天（input + media + display 扩展 + browser）

#### 6.2.1 input skill（25 method，远程键鼠）
- **新协议**：30 FPS 鼠标移动可能需要类似 chat stream chunk 的批量 throttle（设计待 spike）
- 6 sub-phase：Models / InputCommands actor / InputEventDispatcher（如果有 latency feedback）/ ViewModel / View（trackpad-like 触摸区 + 虚拟键盘）/ DI

#### 6.2.2 media skill（61 method，音量/播放/录制）
- 6 sub-phase：Models / MediaCommands / EventDispatcher（播放状态 push）/ ViewModel / View（音量条 + 播放控制 + 设备 picker）/ DI

#### 6.2.3 browser skill（30 method）
- 与 6.1.X.10 display 配合（屏幕坐标 → 浏览器 tab 截图）
- 6 sub-phase：Models / BrowserCommands / EventDispatcher（tab 变化 push）/ ViewModel / View（tab 列表 + 控制按钮）/ DI

**Exit criteria**：input/media/browser 3 个新 tab 接入 + 真机能从 iPhone 移动鼠标光标 + 调音量 + 切换浏览器 tab

---

### Phase 6.3 — knowledge skill（55 method 大体量）

**优先级**：P1

**时间**：~5–7 天

#### 6.3.1 KnowledgeCommands actor（55 method 完整 wire）
- 笔记 CRUD（createNote / updateNote / deleteNote / getNote / searchNotes）
- 文件夹 + 标签管理（listFolders / createFolder / listTags / createTag）
- 导出 + 高级（exportNote + 其余 ~40 method 含 RAG search / collection 管理）
- 复用 Phase 4 OfflineCommandQueue 对 mutating 调用兜底

#### 6.3.2 KnowledgeListView + KnowledgeDetailView SwiftUI
- 镜像桌面 KnowledgeListPage（用户高频，已 stable）
- 富文本 Markdown 渲染（SwiftUI `MarkdownUI` 或 `swift-markdown`）

#### 6.3.3 KnowledgeRAGSearchView
- 桌面端 chat 自带 RAG（透明），但 iOS 用户可独立触发 RAG search → 看结果列表

**Exit criteria**：iPhone 创建/编辑/搜索桌面笔记 + RAG 检索看结果

---

### Phase 6.4 — ai skill 余 45 method

**优先级**：P2

**时间**：~5 天

#### 6.4.1 controlAgent + listAgents
- 远程控制 desktop agent 启停 / 暂停 / 恢复
- 镜像桌面端 Cowork Multi-Agent UI

#### 6.4.2 RAG operations（ragAddDocument / ragListCollections / etc 8 method）
- 与 6.3 knowledge skill 协同 — knowledge.ragSearch 已在 6.3 覆盖，6.4 补 RAG 管理（add/delete collection）

#### 6.4.3 多模态（generateImage / imageVariation / generateEmbedding）
- 简单 SwiftUI form + 图片显示
- Phase 6 v0.1 不做 prompt engineering UI（参数走默认）

#### 6.4.4 model 管理（getModels select active model）
- AIChatView 加 model picker（Phase 5 v0.1 用桌面 default，6.4 加 user override）

**Exit criteria**：iPhone 启动桌面 agent + 加 RAG document + 生成图片

---

### Phase 6.5 — workflow + system + network + userBrowser（中等体量）

**优先级**：P2

**时间**：~7 天

- workflow (24 method) — 触发桌面工作流 + 看执行历史
- system (45 method, vs 后台 system) — overlap 部分留 6.1 收纳，主屏部分（任务管理 UI）单独 view
- network (47 method) — 主屏只放 Wi-Fi 切换 + 蓝牙开关 + VPN 状态（其余后台）
- userBrowser (22 method) — 与 browser (30) 区分（user 级 vs system 级）

**Exit criteria**：4 个新 tab 或合并 tab + 真机验

---

### Phase 6.6 — desktop skill（70 method，复杂度最高）

**优先级**：P2

**时间**：~10–14 天（含可能的新协议设计）

#### 6.6.1 鼠键流分片协议设计
- 30 FPS mouseMove 不能每帧一个 RPC（DC 通常 100ms+ RTT）
- 设计 batching protocol：iPhone 端 16ms 间隔 collect 鼠标坐标 → 100ms flush 一批 → DC 单 frame 送
- 桌面端 mobile-bridge.js 解 batch → 顺序 dispatch
- 类似 Phase 5 chat stream chunk + LRU dedup

#### 6.6.2 DesktopCommands actor 70 method
- 鼠标（move / click / scroll / drag）
- 键盘（type / keyDown / keyUp / hotkey）
- 窗口（list / focus / minimize / resize / close）
- 剪贴板（与 Phase 3 clipboard skill overlap — 复用 ClipboardCommands）

#### 6.6.3 RemoteDesktopView SwiftUI
- 全屏 trackpad-like 触摸区 + 虚拟键盘 toggle + 窗口列表 sheet
- 与 Phase 2 RemoteTerminal 互补（terminal 是 shell，desktop 是 GUI）

**Exit criteria**：iPhone 完整远程控制桌面 GUI

---

### Phase 6.7 — extension skill（95 method, Chrome 扩展独立 WS）

**优先级**：P3（最低）

**时间**：~5–7 天

- transport=`extension-ws` 与其它 skill 走的 DC RPC 不同
- iOS 端需新 `ExtensionWebSocketClient`（直接连桌面端 extension WS gateway）
- 实施前先调研桌面端 extension WS gateway 是否对 iOS LAN 暴露（可能需要桌面端开 binding）

**Exit criteria**：iPhone 控制桌面 Chrome 扩展（tab / cookie / storage / script 注入）

---

### Phase 6.8 — 本地终端 spike（G4）

**优先级**：P3

**时间**：2 天 spike + 决策 doc

按 OQ-5 4 plan 各做 0.5 天 PoC：
- Plan A：WKWebView + xterm.js + quickjs-emscripten 跑 JS REPL
- Plan B：iSH 现有开源代码评估 + Apple 政策风险（联系 Apple Developer Relations）
- Plan C：放弃，文档化理由
- Plan D：监控 Apple 公告

输出 `docs/design/iOS_Local_Terminal_Spike_Decision.md`。

**Exit criteria**：决策 doc + 用户拍板继续/放弃

---

### Phase 6.9 — watchOS spike（G5）

**优先级**：P3

**时间**：1 天 spike + 决策 doc

按 OQ-6 3 选项评估业务必要性 + 技术复杂度 → 选 MVP（push mirror 3–5 天）/ Full（4–6 周）/ 不做。

**Exit criteria**：决策 doc + 用户拍板

---

### Phase 6.10 — in-app update（G6）

**优先级**：P2

**时间**：1 天

- 实施 OQ-4 推荐 B：App Store URL 跳转 + 版本比较
- iOS app 启动时 GET App Store Lookup API → 比对 `CFBundleShortVersionString` < 远端 → in-app banner "tap to upgrade"
- TestFlight beta 用户走 Apple 原生 prompt（无需 in-app code）

**Exit criteria**：iPhone 装 v5.0.3.NN-1 → 装 v5.0.3.NN → 启动看到 banner

---

## 6. 测试 (Test Plan)

### 6.1 单测覆盖目标

| Phase | 新单测数（估）|
|---|---:|
| 6.0 E2E (no new unit test, only bug fix) | 0 (含 bug fix 时 +5–10) |
| 6.1 10 后台 skill × 8 test | 80 |
| 6.2 input + media + browser 各 15 test | 45 |
| 6.3 knowledge 30 test | 30 |
| 6.4 ai 余 45 method × 1–2 test | 60 |
| 6.5 workflow + system + network + userBrowser 各 12 test | 48 |
| 6.6 desktop 70 method + batching protocol | 50 |
| 6.7 extension 异构 transport | 25 |
| 6.10 in-app update | 6 |
| **累计 Phase 6 新单测** | **~344** |
| iOS 测试总数 Phase 6 末 | 354 (Phase 5 累计) + 344 = **~698** |

### 6.2 集成测试

- 每个 skill 至少 1 个 commandClient mock → invoke → response decode 测试
- Cross-skill：input + display 联动（光标移动 → 截屏获取坐标处颜色）
- Offline drainer：所有 mutating skill 通过 OfflineCommandQueue 兜底，集成测试覆盖 ≥ 5 skill

### 6.3 真机 E2E（Phase 6.X.7 各 phase 末）

每个新 skill 至少 1 个真机场景，写进对应 design doc §8.3。Phase 6 末复用 6.0 E2E 流程做 full regression（pairing → terminal → 17 skill 全 smoke）。

---

## 7. 风险 & 实施 trap 预备

### 7.1 已知 trap（Phase 1–5 累积，Phase 6 沿用）

参考 5 个现有 memory：
- `ios_qr_pairing_three_flows.md`（6 trap）
- `ios_remote_terminal_phase2.md`（9 trap）
- `ios_remote_operate_phase3.md`（9 trap，含通用 sed 禁用 Win CRLF）
- `ios_remote_notification_phase4.md`（8 trap，含 events fan-out 设计 §7 未覆盖）
- `ios_remote_ai_chat_phase5.md`（6 trap，含乱序 chunk pendingChunks + LRU 复合 key）

### 7.2 Phase 6 新预期 trap

#### Trap T1 — RemoteOperateView tab 横向滚动 N>10 性能
Phase 4.5 改 horizontal scroll picker 解决 5 tab 之上；但 17–20 tab 时 SwiftUI ScrollView + button row 性能未验。若卡顿，6.1 SystemToolsView 复合 tab（10 后台 skill 收纳）+ 主屏 7 tab + Terminal/AI 2 tab = 总 9–10 tab 可接受。

#### Trap T2 — 桌面端 mobile-bridge.js namespace 覆盖率 ✅ 已扫描（2026-05-18）
**状态**：已落 `docs/design/Desktop_Mobile_Bridge_Namespace_Coverage.md`。结论：23/23 namespace 全 register，名称 0 mismatch（SeedRegistry display 字段有 drift 待 Phase 6.0.9 修），**但 method-level 仅 45% 严格匹配（310/696）**。详见 Trap T10。

#### Trap T3 — 30 FPS 输入流批量 protocol 与 Android 不兼容
Phase 6.6 desktop skill batching protocol 必须与桌面 mobile-bridge.js 双向对齐。Android `InputCommands.kt` 是否走 batching？需先看 Android impl。若 Android 没 batching（每帧一个 RPC），iOS 加 batching 后桌面端要兼容 vs 不兼容两种 client；建议 Android 一起加 batching。**6.6 启动前先验 Android InputCommands 实现**。

#### Trap T4 — extension skill 独立 WS gateway 在 iOS LAN 不可达
桌面端 extension WS 通常 bind 127.0.0.1 only（Chrome 扩展走 localhost）。iOS 需 LAN/relay 接入，桌面端需 bind 0.0.0.0 + auth token 控制。**6.7 启动前先验桌面 extension WS gateway 是否对 LAN 暴露 + 安全模型**。

#### Trap T5 — .ipa 恢复后 vX.Y.Z.N tag 出包失败但不可见
memory `feedback_xcpretty_swallows_xcodebuild_errors.md`：xcpretty silent drop 让 archive 失败 11s zero 错误行。6.0.7 必带 `2>&1 | tee build/xcodebuild-archive.log` + `if: always()` upload-artifact，避免 silent fail。

#### Trap T6 — SystemToolsView 复合 tab 与 6.4 ai 余 45 method 冲突
6.1 把 10 后台 skill 收进 SystemToolsView；6.4 加 controlAgent 也是后台型，但与 AI tab 强相关。**6.4 实施时 ai.controlAgent 留 AI tab 内**（不进 SystemTools），避免用户找不到。

#### Trap T7 — knowledge skill mutating 调用 offline drainer 容量
Phase 6.3 createNote/updateNote 频率高（用户离线写笔记），OfflineCommandQueue 默认容量可能不够。**预先评估 queue 容量上限 + UserDefaults JSON size 上限**（通常 1MB），必要时改 SQLite 持久化。

#### Trap T8 — Phase 5.8 真实 bug 已通过静态审计修，Phase 6.0 真机 E2E 可能暴露新 bug
Phase 5.7 状态 doc 显示"4 真实 bug 静态审计找到并修"+ 单测 +4 + 4 集成测试。但真机 cancel + 后台切换 + 长对话 100 limit 的边界条件**只能真机验**。Phase 6.0 留 buffer 1–2 天修 Phase 5 真机 bug。

#### Trap T9 — Android 17 个 namespace 中某些 method 桌面端 mobile-bridge.js 实际没 impl ✅ 已确认
Coverage doc 实测：696 Android typed wrapper method 中**只 310 (45%)** 严格名称匹配桌面 case。详见 Trap T10。

#### Trap T10 — 桌面 debt ~280 method（**Phase 6.3/6.4 实施前必做**）
来自 Coverage doc §1：

| Namespace | 桌面 debt method 数 | 影响 Phase | 桌面侧估时 |
|---|---:|---|---:|
| ai | 42 | 6.4 | 5–7 天 |
| knowledge | 46 + 名称分化 | 6.3 | 3–5 天 |
| system | 44 | 6.5 | 3 天 |
| media | 45 | 6.2 | 3 天 |
| network | 42 | 6.1B3 (后台) | 2 天 |
| desktop | **0** ✅（Phase 6.6 doc 已解决 §3.1）| 6.6 | 0 |
| browser | 21 | 6.2 | 2 天 |
| sysinfo | 32 | 6.1B3 | 2 天 |
| storage | 31 | 6.1B3 | 2 天 |
| process | 24 | 6.1B3 | 2 天 |
| power | 24 | 6.1B3 | 2 天 |
| device | 名称分化 | 6.1B3 | 1 天 |
| notification | 5（broadcast/clearAll/delete/getUnreadCount/markAllAsRead）| 6.0（Phase 4.7 E2E 可能暴露）| 1 天 |
| history | 名称分化 | 6.5 | 1 天 |
| workflow | 3 | 6.5 | 0.5 天 |
| extension | 2 | 6.7 | 0.5 天 |
| **总计** | **~280 method** (修正：扣 desktop 0 项，~280)| | **~30 天桌面端工作**（修正：desktop 0；详见 Phase 6.6 doc §1.3）|

**策略**：
- **A**（推荐）：iOS 实施 = 桌面已支持子集（无需桌面协调，iOS 单方向推进）；桌面 debt 留 Phase 7+ backlog 按用户实际需求触发
- **B**：iOS + Desktop 双 stream 并跑（iOS 等桌面 debt），周期翻倍但 Phase 6 结束时与 Android 完全对齐
- **C**：先做 A 走通 Phase 6 主线，B 作为 Phase 7 backfill

---

## 8. 时间线 & 资源

> **修订 2026-05-18**：原表低估桌面 debt。Coverage doc 实测 Trap T10 = ~30 天桌面 handler 扩展工作未在原表内。新表分 iOS / Desktop 双轴。

### 8.1 串行执行估算（iOS-only A 策略，桌面 debt 留 Phase 7+）

| Phase | iOS 工期 | 累计 | 桌面 debt（不阻塞，留 backlog）|
|---|---:|---:|---:|
| 6.0 E2E + .ipa + 深度验证 + SeedRegistry drift 修 | 3 天 | 3 | notification 5 method (Phase 4.7 暴露后修) |
| 6.1 第 1 批 5 个 100% wired skill | 5 天 | 8 | 0 |
| 6.1B3 红档桌面已支持子集 6 skill | 7 天 | 15 | ~150 method (backlog) |
| 6.2 主屏 batch (input 已落 6.1, media + browser) | 6 天 | 21 | media 45 + browser 21 (backlog) |
| 6.3 knowledge | 7 天 | 28 | **46 method blocking** Phase 6.3 完整版 |
| 6.4 ai 余 45 method | 5 天 | 33 | **42 method blocking** Phase 6.4 完整版 |
| 6.5 workflow + system + history | 5 天 | 38 | system 44 + workflow 3 + history 名称分化 |
| 6.6 desktop + batching | 14 天 | 52 | 待 §3.1 验 |
| 6.7 extension | 7 天 | 59 | 2 method (low) |
| 6.8 local terminal spike | 2 天 | 61 | — |
| 6.9 watchOS spike | 1 天 | 62 | — |
| 6.10 in-app update | 1 天 | 63 | — |
| **iOS 主线** | | **~63 天 ≈ 13 周** | |
| 桌面 debt backlog（如选 B 全做）| | +30 天 | **总 ~93 天 ≈ 19 周** |

### 8.2 并行执行（双 stream — A 策略最快）

- Stream 1（iOS 100% wired + 子集 batch）：6.0 → 6.1 → 6.1B3 → 6.2(media+browser) → 6.5 → 6.6 → 6.7 = ~50 天
- Stream 2（iOS knowledge/ai + 桌面 debt 同步推进）：6.3 + 桌面 knowledge handler (5 天) → 6.4 + 桌面 ai handler (7 天) + 6.10 in-app = ~25 天
- Spike (6.8/6.9)：3 天 串入间隙
- **并行最快 ≈ 50 天 ≈ 10 周**（受 6.6 desktop skill bottleneck）

### 8.3 实际建议

- **第 1 周**：Phase 6.0（含 §6.0.8 深度验证 + §6.0.9 SeedRegistry drift 修）— 真机 E2E 需用户在场
- **第 2 周**：Phase 6.1 第 1 批 5 个 100% wired skill（纯 dev box）+ Phase 6.10 in-app update 串入
- **第 3–4 周**：Phase 6.1B3 红档子集 6 skill + Phase 6.8/6.9 spike
- **第 5–7 周**：Phase 6.2 + 6.3（iOS 端 + 桌面 knowledge debt 同步推进，stream 2）
- **第 8–10 周**：Phase 6.4 + 6.5（含桌面 ai debt）
- **第 11–13 周**：Phase 6.6 + 6.7
- **第 14 周**：full regression E2E + docs/changelog/版本号 sweep

### 8.4 关键里程碑

- **M1**（第 1 周末）：5 个前置 phase E2E ✅ + .ipa 出包 ✅ + 深度验证决策 ✅
- **M1.5**（第 2 周末）：**第 1 批 5 个 100% wired skill ✅** — Phase 6 真正落地的第一个收益（input/display/app/security/userBrowser 全可调）
- **M2**（第 4 周末）：6.1B3 子集 batch ✅ + in-app update ✅ + 2 spike 决策 doc ✅
- **M3**（第 7 周末）：knowledge + media + browser ✅（桌面 debt 同步落地）
- **M4**（第 10 周末）：ai 完整 + workflow/system/history ✅
- **M5**（第 14 周末）：desktop + extension + full regression ✅，**iOS 与 Android 远程操控对齐（桌面 debt 选 B 全做）/ 桌面已支持子集对齐（A 策略）**

---

## 9. 决策记录

> 本节随实施推进追加；草案 v0.1 暂记 OQ 推荐。

| 日期 | OQ | 决策 | 决策人 | 备注 |
|---|---|---|---|---|
| 2026-05-18 | OQ-1 | 待定（推荐 A：一晚串跑）| — | 用户带宽决定 |
| 2026-05-18 | OQ-2 | **✅ 改 桌面就绪度优先**（Coverage §4.2 5 批顺序）| 用户 | Trap T2 实测：用户高频在第 1 批之后才出现，先 5 个 100% wired 快赢 |
| 2026-05-18 | OQ-3 | **✅ B + C 混合**（5 个 100% wired 内的 input/display 进主屏，app/security/userBrowser 进 SystemTools 子 tab）| 用户 | Coverage §1.4 影响摘要 |
| 2026-05-18 | T10 桌面 debt | **✅ A 策略**（iOS 只 impl 桌面已支持子集，桌面 debt 留 Phase 7+ backlog）| 用户 | 13 周完成 iOS 主线 vs 19 周 B 策略 |
| 2026-05-18 | OQ-4 | 待定（推荐 B：TestFlight）| — | App Store 合规约束 |
| 2026-05-18 | OQ-5 | 待定（spike 输出后定）| — | Plan A/B/C/D 矩阵 |
| 2026-05-18 | OQ-6 | 待定（spike 输出后定）| — | 不做 / MVP / Full |

---

## 10. 关联文档 & memory

### 10.1 必读 design docs
- `docs/design/iOS_Phase_1_Pairing_Flow_B.md`（Pairing 基础）
- `docs/design/iOS_Phase_2_Remote_Terminal.md`（Plan A.1 WebRTC DC）
- `docs/design/iOS_Phase_3_Remote_Operate_Framework.md`（RemoteCommandClient + OfflineQueue framework）
- `docs/design/iOS_Phase_4_Notification_Skill.md`（events fan-out + dispatcher 模板）
- `docs/design/iOS_Phase_5_AI_Chat_Skill.md`（stream + dispatcher 复杂模板）

### 10.2 必读 memory
- `ios_app_target_compile_state.md`（408 → 0 错收口）
- `ios_app_target_40_errors_snapshot.md`（最后 sprint 15 错跨 8 commit 1.5h 解）
- `ios_signing_infra_state.md`（Team / bundle / UDID / 4 secrets / cert 过期日）
- `feedback_ios_swift_spm_ci_traps.md`（4 SPM CI trap）
- `feedback_ios_signing_spm_target_leak.md`（PROVISIONING_PROFILE_SPECIFIER 全局 leak）
- `feedback_xcpretty_swallows_xcodebuild_errors.md`（silent drop）
- `gitignore_models_unanchored_trap.md`（7 个 silent 屏蔽 swift 文件）
- 5 个 phase trap memory（见 §7.1）

### 10.3 Android 对照
- `android-app/app/src/main/java/com/chainlesschain/android/remote/registry/SeedRegistry.kt`（23 entries × methodCount 795）
- `android-app/app/src/main/java/com/chainlesschain/android/remote/commands/*.kt`（24 Commands.kt）
- `android-app/feature-local-terminal/`（Phase 0.5 mksh + toybox）
- `android-app/wear-app/`（Wear OS 伴侣）
- `desktop-app-vue/src/main/mobile-bridge.js`（桌面端 namespace 覆盖参考）

### 10.4 Phase 6 输出预期
每个大 skill 1 个 design doc：
- `iOS_Phase_6_1_System_Tools.md`
- `iOS_Phase_6_2_Input_Media_Browser.md`
- `iOS_Phase_6_3_Knowledge_Skill.md`
- `iOS_Phase_6_4_AI_Extended.md`
- `iOS_Phase_6_5_Workflow_System_Network.md`
- `iOS_Phase_6_6_Desktop_Skill.md`
- `iOS_Phase_6_7_Extension_Skill.md`
- `iOS_Local_Terminal_Spike_Decision.md`
- `iOS_WatchOS_Spike_Decision.md`
- `Desktop_Mobile_Bridge_Namespace_Coverage.md`（Trap T2 输出）
