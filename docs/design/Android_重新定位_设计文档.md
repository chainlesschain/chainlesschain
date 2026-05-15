# Android 客户端重新定位设计文档

> **版本**: v0.16 (§10 C.1 PR3 landed — C.1 主体闭环 wear→phone voice forwarding，2026-05-15) | **状态**: 🎉 ADR 8/8 accepted · M1/M2/M5 ✅ · **M3 5/5 code 全落（VoiceMode + CameraOCR + LocationTagger + ShareReceiver + PushNotifier，+3,861 行 / 99 单测，真机待用户出场）** · **M4 D1 ✅ method-level / D2 ✅ desktop-side full + Android RPC 接收器 + **ApprovalUI 4 类 category** + **ProgressViewer***（真机 E2E 仍待） · M6 性能预算文档就位待真机回填 · M7 GA flip ✅ tag `v1.0.0` + GitHub Release published | **关联**: Android **v1.0.0 GA** | **桌面对标**: v5.0.3.48
>
> 把 ChainlessChain Android 从"对桌面 skill 数量的弱化追赶"重新定位为 **DID 钱包 + 移动端捕获 + REMOTE 遥控器** 三层模型，对齐 Claude Desktop / Mobile 的二端分工，停止以 skill 数量对标桌面，转向场景独占价值。
>
> v0.7 → v0.8 变更（GA 发版稿）：
> 1. **M3 收尾 5/5 code 全落**（commits `47bebed80` VoiceMode / `a69269ced` CameraOCR / `3f5ac8647` LocationTagger Play Services 接线 / `3d1a6e3a8` ShareReceiver→knowledge.createNote flush / `c0d990c91` PushNotifier 本地 channel + FCM 骨架）— D-voice/D-camera/D-push 真机 + FCM 凭证待用户出场（详 [v1.0.0 GA 检查清单](../v1.0_GA_checklist.md)）
> 2. **M4 D1 method-level 元数据**（commit `6e49270fd`）：RemoteSkillRegistry 从 file-level 升 method-level 双粒度，ai.* + knowledge.* 各 10 method seed 含 8 riskOverride 演示
> 3. **M4 ApprovalUI 4 类 category + ProgressViewer**（commit `f4f83cc67`）：M5 sign-only → Sign/Cowork/Marketplace/SystemCritical 4 类 dialog；新 LongTaskRegistry + TaskProgressCommandRouter `task.*` reverse-RPC + Compose 长时任务面板
> 4. **§8.1 + §8.3 收敛**（commit `0bc8e2797`）：android-app/README.md versionName 同步；SkillMetadata.aliases + RemoteSkillRegistry.aliasIndex 1 版兼容窗口
> 5. **M7 GA flip** ✅：android-app versionCode 37 → 100 / versionName 0.37.0 → 1.0.0；CHANGELOG v1.0.0 entry；tag `v1.0.0` 推 gitee+github；GitHub Release published with 4 APK assets + AAB
> 6. **剩 5 项用户出场**（[v1.0_GA_checklist.md](../v1.0_GA_checklist.md)）：M3 真机 E2E / M4 D2 真机 E2E / FCM google-services.json 凭证 / M6 性能实测回填 / docs-site 全栈同步
> 7. **§10 加 GitHub milestone 引用** — [Android v1.1 milestone #1](https://github.com/chainlesschain/chainlesschain/milestone/1) tracking [#19](https://github.com/chainlesschain/chainlesschain/issues/19) (due 2026-09-30) + [Android v1.2 milestone #2](https://github.com/chainlesschain/chainlesschain/milestone/2) tracking [#20](https://github.com/chainlesschain/chainlesschain/issues/20) (due 2026-12-31)；本文档 §10 仍是 single source of truth，issues 是执行追踪面
>
> v0.6 → v0.7 变更：
> 1. **M4 D2 桌面胶水全部落地**：
>    - `mobile-approval-channel.js` requestApproval 加 `payloadHash`（recursive canonical-JSON + SHA-256 hex 64-char）+ `payloadDescription`（默认 `"<Namespace> · <Action>"`，业务可覆写）+ `requireBiometric`（默认 true）
>    - 新文件 `mobile-approval-transport.js`（独立 transport 桥）— `MobileApprovalTransport.wire(channel, bridge)` 把 channel.setOnRequest 接到 `mobileBridge.sendReverseRpcRequest(peerId, {jsonrpc:'2.0', id:requestId, method:'approval.request', params:payload})`，处理 RPC success/error/empty-response/transport-throw 四种返回路径
>    - `remote-gateway.js` 在 `initializeCommandRouter` 构造 `MobileSkillWhitelist` + `MobileApprovalChannel` 注入 CommandRouter；新增 `bindMobileBridge(mobileBridge)` 方法在 MobileBridge ready 后 wire transport；`stop()` 加 unwire + `clearAll('gateway-stopped')` 防 promise 永远挂起
>    - `index.js` 在 `initializeMobileBridge` 末尾 (在 MobileSignClient 之后) 调 `this.remoteGateway.bindMobileBridge(this.mobileBridge)`
> 2. **新增 30 单测 + 10 集成测试**：
>    - `mobile-approval-channel.test.js` 加 9 个新 case（payloadHash 确定性 / payloadDescription 默认 + 覆写 / requireBiometric 默认 / canonicalJson 行为）
>    - `mobile-approval-transport.test.js` 新 10 case（happy / RPC error / transport throw / empty response / unwire / 端到端 requestId 透传）
>    - `m4-d2-cross-end-approval.test.js` 新 10 集成 scenarios — 真接通整个 desktop-side 链路（CommandRouter → whitelist → channel → transport → fake bridge → simulated Android response），含 happy/deny/biometric-fail/rpc-error/transport-error/timeout/non-approval/blocked/并发/desktop-internal-bypass
> 3. **真机 E2E 验收清单**：新 `Android_M4_D2_E2E.md` — 跨端 7 demo scenarios，桌面侧 JVM-integration 10 绿是"差最后一公里"（真 WebRTC + 真 ApprovalDialog + 真 BiometricPrompt + 真 StrongBox）
> 4. **M3 真机测试计划**：新 `Android_M3_Real_Device_Test_Plan.md` — D-share/D-loc Manifest 完整性已落 `be6cb4974`；D-voice/D-camera 待真机；**D-push 需补 google-services.json + FirebaseMessagingService + 5 步**
> 5. **M6 性能验收方法学**：新 `Android_M6_Performance_Validation.md` — 8 个性能预算的 Macrobenchmark / Battery Historian / TC 弱网测量方法，可直接 release-time 回填
> 6. **v0.6 → v0.7 删除"M4 D2 剩 0.3d"声明** — 桌面 desktop-side 已全完，整个 M4 D2 desktop-side scope 收敛到代码 + 测试 + 文档

## 1. 背景与立项动机

### 1.1 当前问题

ChainlessChain 桌面端是"重资产个人 AI 主机"——139 内置 skills、Cowork 多智能体、RAG / 向量检索、MCP、Marketplace、联邦治理、Workflow、ZKP，典型久坐工作站形态。Android 端（v0.37.0）当前的对标方式有三个结构性问题：

1. **REMOTE 缺一等公民地位** — `android-app/.../remote/commands/` 已堆出 23 个 *Commands.kt（AI / Application / Browser / Clipboard / Desktop / Device / Display / Extension / File / History / Input / Knowledge / Media / Network / Notification / Power / Process / Security / Storage / System / SystemInfo / UserBrowser / Workflow），但桌面侧没有统一白名单、签名核验、审批通道，散落在 13+ handlers/ 文件里隐式映射；UI 对应的 `remote/ui/` 18 个子模块也是 hardcoded screen，没有可发现的 SkillRegistry。"REMOTE 即一等公民"是隐性事实，不是显性架构。

2. **路线模糊** — "Android 还差 N 个 skill" 是错误的对标方式：手机屏幕、拇指交互、续航限制让 80%+ 桌面 skill 不适合 native port。继续 port 是反 ROI。同时由于没有清晰的 skill 注册表，"差多少"本身也无法量化，进一步加剧目标模糊。

3. **场景独占价值未挖掘** — 摄像头、麦克风（仅 ASR/TTS 端点存在，无 continuous Voice Mode）、生物识别（仅 Settings flag）、StrongBox（仅 Keystore，无 StrongBox tier）、推送通知（无 FCM 接入）、随身性是手机独占能力，桌面无法替代；当前架构里这些是"边角料"或完全缺失。位置感知、ShareReceiver 整条链路目前 **零代码零权限**。

### 1.2 对标参考：Claude Desktop vs Mobile 的角色分工

Anthropic 官方 Claude 二端是清晰的角色分工而非功能对等：

| 维度       | Claude Desktop (Mac/Win)              | Claude Mobile (iOS/Android)            |
| ---------- | ------------------------------------- | -------------------------------------- |
| 角色       | AI 工作站                              | 随身入口 / 捕获器                      |
| 独占能力   | Projects / Artifacts / **MCP** / **Computer Use** | Voice Mode / 摄像头输入 / 推送 / 生物识别 |
| 数据流向   | 本地 ↔ 云重负载                        | 主"上传 / 查看"，少处理                |
| 同步关系   | 主战场                                 | 桌面延伸，账号同步连续上下文           |
| 不做的事   | 不做"快速一拍即问"                    | 不做 MCP / Computer Use                |

核心模式：**桌面 = "agent + tool 主机"，手机 = "thin client + capture device"**。同账号同步把两端串成连续工作流，**手机不重复实现桌面，只补桌面在手机场景下做不到的事**。本方案直接套用此分工。

### 1.3 立项触发

- Phase 3d v1.3（2026-05-09）双向同步 + REMOTE RPC + Ed25519 strict-mode 三件齐落，技术底座具备
- v0.32.0 README → v0.37.0 实际 versionName 已落差 5 个版本号，Android 路线没有在 README 上显性更新
- v1.0.0 GA 在即，需在 GA 前明确定位语义

## 2. 现状速览（基于 2026-05-11 代码核实）

### 2.1 Android 端能力盘点（基于 `android-app/settings.gradle.kts`）

实际 Gradle 模块结构（25 个模块，远多于 v0.1 文档的"12 native handlers"叙事）：

```
android-app/
├── app/                                     # 主应用
├── core/   9 模块                            # 通用基础
│   ├── core-common / core-database / core-network
│   ├── core-security                         # SecurityChecker.kt 完整实现（443 行）
│   ├── core-p2p                              # SyncManager.kt ResourceType enum（9+ 类型）
│   ├── core-did                              # DIDKeyGenerator / DIDSigner / DIDManager
│   ├── core-e2ee / core-ui / core-blockchain
├── feature/   13 模块                        # 业务能力
│   ├── feature-auth / feature-knowledge / feature-ai
│   ├── feature-p2p / feature-project / feature-file-browser
│   ├── feature-blockchain / feature-enterprise
│   ├── feature-knowledge-graph / feature-mcp / feature-hooks
│   ├── feature-collaboration / feature-performance
└── data/   2 模块（data-knowledge / data-ai）

app/src/main/java/com/chainlesschain/android/
├── feature/project/                          # 唯一直接挂在 app 包下的 feature 子包
├── remote/                                   # ⭐ 已落地的真实 REMOTE 主战场
│   ├── client/RemoteCommandClient.kt          # Phase 3d v1.3
│   ├── commands/  23 *Commands.kt             # AI/Application/Browser/Clipboard/Desktop/
│   │                                          # Device/Display/Extension/File/History/Input/
│   │                                          # Knowledge/Media/Network/Notification/Power/
│   │                                          # Process/Security/Storage/System/SystemInfo/
│   │                                          # UserBrowser/Workflow
│   ├── ui/  18 子模块                         # ai(6)/application/clipboard/connection/
│   │                                          # desktop/file/history/input/media/network/
│   │                                          # notification/power/process/security/storage/
│   │                                          # system(4)/task/workflow，48 .kt
│   ├── p2p/P2PClient.kt                       # WebRTC DataChannel
│   └── webrtc / crypto / model / di / events
├── sync/                                      # Phase 3d 同步桥
│   ├── SyncCoordinator.kt                     # v1.1 push 循环
│   └── SyncAuthVerifier.kt                    # v1.2 Ed25519 strict-mode
├── security/SecurityChecker.kt                # Root / 模拟器 / 调试器 / 完整性
└── （无 ukey/ 子目录；无 Camera*OCR / Location* / FCM* / Share* 模块）
```

**v0.1 已说错并已修正**：
- v0.1 §2.1 列的"8 个 doc-only stub: trading / marketplace / cowork / BI / workflow / 多模态 / agent federation / 自治 agent"——经 grep 核实：**trading / marketplace / BI / agent federation / autonomous 在 .kt 文件里零出现**（不是 stub，是没立项），**cowork / workflow 是真代码**（feature-ai/.../cowork/skills/ 35 .kt + remote/ui/workflow/ + remote/commands/WorkflowCommands.kt）。
- v0.1 §2.1 列的"8 REMOTE skills (screenshot / system status / AI chat / notification / 4 TBD)"——经核实实际是 **23 *Commands.kt + 18 remote/ui 子模块**，远超 8 个。

### 2.2 已落地的基础设施（v1.0 直接复用）

| 模块                           | 位置                                                                | 状态                             |
| ------------------------------ | ------------------------------------------------------------------- | -------------------------------- |
| WebRTC DataChannel             | `android-app/.../remote/p2p/P2PClient.kt`                           | ✅ Phase 3d v1.3                  |
| JSON-RPC envelope              | `android-app/.../remote/client/RemoteCommandClient.kt`              | ✅ 已有，需扩展                   |
| Ed25519 验签                   | `android-app/.../sync/SyncAuthVerifier.kt`                          | ✅ Phase 3d v1.2 strict-mode      |
| 30s push 循环                  | `android-app/.../sync/SyncCoordinator.kt`                           | ✅ Phase 3d v1.1                  |
| 桌面 mobile-bridge-sync.js     | `desktop-app-vue/src/main/sync/mobile-bridge-sync.js` (1122 行)     | ✅ 6 资源类型：MSG/CONTACT/FRIEND/POST/POST_COMMENT/NOTIFICATION |
| 桌面 mobile-bridge.js          | `desktop-app-vue/src/main/p2p/mobile-bridge.js` (1177 行)           | ✅ WebRTC ↔ libp2p                |
| QR 配对                        | `desktop-app-vue/src/main/p2p/device-pairing-handler.js`            | ✅ Phase 3d                       |
| Signal Protocol E2EE           | `android-app/.../signal/`（在 core-e2ee 模块）                       | ✅ 已有                           |
| BiometricPrompt                | `app/src/main/AndroidManifest.xml` USE_BIOMETRIC + Settings flag    | ✅ 入口已有，无统一 BiometricGate |
| ASR / TTS 端点                 | `AsrSettingsScreen.kt` + `AICommands.kt::TTSResponse`               | ⚠️ 各自存在，无 continuous Voice Mode |
| Camera 权限                    | `AndroidManifest.xml` CAMERA + autofocus                             | ⚠️ 权限有，无 OCR pipeline        |
| DID 密钥                       | `core-did/.../DIDKeyGenerator.kt + DIDSigner.kt + DIDManager.kt`    | ⚠️ 单 DID 密钥可生成签名；多 DID 切换 + 助记词备份未实现 |
| Android Keystore               | `core-security/.../AndroidDIDKeyStore` (Hilt 注入)                   | ⚠️ Keystore 已有；StrongBox tier 未专门用 |

### 2.3 桌面端能力索引（不是 v1.0 重做对象，仅作 REMOTE 调用对象）

| 类别              | 桌面位置                                          | Android 关系       |
| ----------------- | ------------------------------------------------- | ------------------ |
| Skills System     | `desktop-app-vue/.../ai-engine/cowork/skills/`    | REMOTE 调用对象（139 skills） |
| RAG / 向量检索    | `desktop-app-vue/.../rag/`                        | REMOTE             |
| Cowork 多智能体   | `desktop-app-vue/.../ai-engine/cowork/`           | REMOTE + 审批 UI   |
| Marketplace       | `desktop-app-vue/.../marketplace/`                | REMOTE + 审批 UI   |
| MCP               | `desktop-app-vue/.../mcp/`                        | **永不上手机**     |
| Computer Use      | `desktop-app-vue/.../browser/computer-use/`       | **永不上手机**     |
| Workflow          | `desktop-app-vue/.../runtime/` + workflow         | REMOTE 触发 + 进度 |

### 2.4 桌面 remote 真实结构（v0.1 路径写错）

| v0.1 文档声明                                          | 实际                                                         |
| ----------------------------------------------------- | ------------------------------------------------------------ |
| `desktop/.../remote/command-handler.js`                | ❌ 不存在。实际 `command-router.js` + `remote-gateway.js` + `handlers/` 子目录 |
| `desktop/.../mobile/DevicePairingHandler.js`           | ❌ 路径错。实际 `desktop/.../p2p/device-pairing-handler.js`    |

## 3. 目标与非目标

### 3.1 v1.0 目标

- **G1** 三层定位（L1 钥匙 / L2 捕获 / L3 REMOTE）落地，文档与代码一致
- **G2** L1 StrongBox tier 显式落地（覆盖 macOS/Linux 用户的硬件签名洞）+ 多 DID 切换 + 助记词备份 UI
- **G3** L2 Voice Mode 连续语音 + Camera OCR 拍照入 KB + LocationTagger + ShareReceiver + FCM 推送五件 mobile-first 体验上线（v0.1 漏列后三件）
- **G4** L3 RemoteSkillRegistry 把 23 个散落 *Commands 收敛到统一注册 + 桌面侧白名单 + 审批通道生效
- **G5** REMOTE 缺失能力对照表落地（cowork/workflow 已存在 → 升级；trading/marketplace/BI 等不存在 → 按桌面 skill 白名单按需开通）
- **G6** 性能预算达成：冷启 < 1.5s / 24h 后台耗电 < 3% / 包体 < 30MB

### 3.2 非目标（v1.0 明确不做）

- **N1** 不做 native port 桌面 skill —— REMOTE 即可，避免重复实现
- **N2** 不上 MCP 与 Computer Use（对标 Claude Mobile）
- **N3** 不做 marketplace / workflow 的完整编辑器（手机屏幕不适合）
- **N4** 不做多设备 N 端 pair（v1.1 处理，v1.0 仍单 peer）
- **N5** 不做离线消息队列（v1.1 处理）
- **N6** 不做 LLM 模型本地部署（包体爆炸 + 续航灾难，全部 REMOTE）

### 3.3 范围边界

| 项                      | 范围 | 备注                                |
| ----------------------- | ---- | ----------------------------------- |
| L1/L2/L3 三层架构       | ✅   | v1.0 主线                           |
| StrongBox tier + 多 DID + 助记词 | ✅ | 必交付                              |
| Voice Mode + Camera OCR + Location + FCM + Share | ✅ | 必交付（5 件，v0.1 漏列） |
| RemoteSkillRegistry 收敛 | ✅   | 必交付                              |
| REMOTE 不存在能力开通指引 | ✅   | 必交付（替代 v0.1 "8 stub 处置"）   |
| 多设备 pair             | ❌   | v1.1                                |
| 离线消息队列            | ❌   | v1.1                                |
| MCP / Computer Use      | ❌   | 永不做                              |
| Native marketplace UI   | ❌   | 永不做（REMOTE 浏览 OK）            |

## 4. 决策（ADR-1 ~ ADR-8）

### ADR-1 — 三层定位结构：L1 Wallet / L2 Capture / L3 REMOTE

**选项**：
- A. 维持当前散落 *Commands.kt + ui/ screens 的状态，按 skill 数量继续追桌面
- B. 三层定位（钥匙 / 捕获 / 遥控器），按场景而非 skill 划分
- C. 完全脱离桌面叙事，做独立 mobile 应用

**选 B**。理由：
- A 是当前问题本体，23 个 commands + 18 ui 子模块没有统一注册表已是事实，继续散落只会加剧
- C 与桌面同步、共享 DID、共享 KB 的核心价值矛盾
- B 与 Claude Desktop/Mobile 已被市场验证的角色分工对齐
- B 让"REMOTE 即一等公民"从隐性变成显性架构

### ADR-2 — L1 密钥后端：StrongBox 优先 + TEE 降级 + 软件 Ed25519 三阶段

**选项**：
- A. 仅 StrongBox（API ≥ 28 + 硬件支持），不支持设备返回错误
- B. StrongBox 优先 → TEE 降级 → 软件 Ed25519 三阶段
- C. 始终软件 Ed25519，不用硬件后端（当前 AndroidDIDKeyStore 走 Keystore，但未显式分层）

**选 B**。理由：
- A 排斥大量中端 / 老设备
- C 放弃手机的硬件签名独占价值，且当前实现就在 C 与 B 之间漂移
- B 通过 UI 标记签名等级（StrongBox / TEE / 软件）让用户和桌面侧都能看到，对高风险操作（marketplace 大额）可单独要求 StrongBox

### ADR-3 — REMOTE 调用：白名单 + DID 签名 + 审批通道，三道闸

**选项**：
- A. 桌面默认放行所有 skill，手机请就给（接近当前隐式状态）
- B. 桌面白名单（exposeRemoteSkills），手机调用必带 Ed25519 签名，高风险操作走 ApprovalUI
- C. 黑名单制

**选 B**。理由：
- A 与"桌面是 AI 主机"语义相反，攻击面爆炸；当前 23 commands 散落 handlers/ 下没有显式白名单已是隐患
- C 加新 skill 时容易漏防，反方向错误
- B 三道闸：白名单（防越权）→ 签名（防伪冒）→ 审批（防大额误操作）

### ADR-4 — Voice Mode：完全 REMOTE chat + 系统/云端 ASR + 系统 TTS

**选项**：
- A. 本地小模型 ASR + 本地 LLM
- B. REMOTE LLM + 系统 ASR/TTS（默认）+ 云端 ASR opt-in
- C. 全云端（ASR + LLM + TTS 都走云）

**选 B**。理由：
- A 包体 / 续航灾难，且体验追不上桌面 LLM
- C 系统 ASR/TTS 已够用且零成本零延迟（且 `AsrSettingsScreen.kt` + `AICommands.kt::TTSResponse` 端点已存在，B 的"默认"位置已经不是空地）
- B 兼顾默认低成本与高质量 opt-in（火山豆包 / Whisper local v1.1）

### ADR-5 — REMOTE 能力盘点：已有升级 / 不存在按需开通（v0.1 "8 stub 处置"已废）

v0.1 ADR-5 基于"8 个 doc-only stub"假设，经 2026-05-11 grep 核实假设错误，本 ADR 重写。

| 能力                | Android 实际状态                               | 桌面对应             | v1.0 处置                                                      |
| ------------------- | ---------------------------------------------- | -------------------- | ------------------------------------------------------------- |
| cowork              | ✅ feature-ai/.../cowork/skills/ 35 .kt 真代码 | 95+ skills           | **升级**：接 RemoteSkillRegistry，桌面 cowork.* 白名单开通     |
| workflow            | ✅ remote/ui/workflow/ + WorkflowCommands.kt   | runtime/             | **升级**：同上，桌面 workflow.* 白名单开通                     |
| trading             | ❌ .kt 零出现                                  | marketplace          | 不立项；走桌面 marketplace.* REMOTE                            |
| marketplace         | ❌ .kt 零出现                                  | marketplace/         | 同上，REMOTE 浏览 + 审批通道                                  |
| BI                  | ❌ .kt 零出现                                  | enterprise/bi-engine | 不立项；REMOTE 调用                                           |
| 多模态              | ❌ .kt 零出现（ASR/TTS 已有但是不是多模态总称） | 多个 skill           | 归并 cli-multimodal，REMOTE 调用                              |
| agent federation    | ❌ .kt 零出现                                  | 联邦发现             | 不立项（基础设施，非用户面 skill）                             |
| 自治 agent runner   | ❌ .kt 零出现                                  | autonomous           | 不立项（桌面后台跑，手机无入口需求）                           |
| **23 个 *Commands** | ✅ 已散落                                      | 桌面 handlers/ 隐式映射 | **统一收敛**：M4 RemoteSkillRegistry 注册 + 桌面 mobileBridge.exposeRemoteSkills 显式列表 |

### ADR-6 — 反向 RPC（桌面调手机做硬件签名）：v1.0 必做

**选项**：
- A. v1.0 仅 Android → Desktop 单向，桌面想签名走自己的 U-Key
- B. v1.0 加反向通道，桌面可发起 `sign.request` 让手机 StrongBox 签名

**选 B**。理由：
- A 让 macOS/Linux 用户没有硬件签名路径（U-Key 仅 Windows）
- B 把手机变成"跨平台硬件 USB Key"，是定位的核心价值之一
- 实现成本不高：transport（mobile-bridge.js）已有，加 RPC method + ApprovalUI 即可

### ADR-7 — 配置文件：移动端配置走 user_settings 表 + `mobile.*` scope（v0.9 amend）

> **v0.9 amend（[ADR Review v2.0](Android_ADR_重评估_v2.0.md) §2 ADR-7）**：v0.1 选 B（`cc-mobile.json` 独立文件 + assets/ 下），但实际落地至今**该文件从未创建**。Phase 3d Mobile Sync（memory `phase_3d_mobile_sync_landing.md`）落地后，`user_settings` 表 + scope 机制承接了移动端配置职责。本 ADR 文本对齐真实形态。

**选项**：
- A. Android 直接读桌面 `.chainlesschain/config.json`（同步过来）
- B. Android 端独立 `cc-mobile.json`（assets/ 下，**v0.1 设想但实际从未创建**）+ 桌面 `mobileBridge.*`
- **B'（v1.2 实际落地）**：移动端配置走 `user_settings` 表 + `mobile.*` scope（如 `mobile.biometric.enabled` / `mobile.push.provider`），通过 Phase 3d Sync 与桌面双向 LWW 同步；桌面侧 `mobileBridge.*` 字段（对手机开放策略）仍在 config.json 单管，**不通过 user_settings 同步**

**选 B'**。理由：
- A 把桌面配置耦合进手机，桌面字段巨多大部分手机无关（与 B/B' 排除 A 一致）
- B 引入独立 schema 文件 + 验证逻辑，包体增长但关注点分离效果与 B' 等同
- B' 关注点分离仍成立：`mobile.*` scope = mobile 端"我要怎么用"；`mobileBridge.*` config.json = 桌面端"我对手机开放什么"
- B' 多账户支持白送（user_settings 的 scope 列原生支持）
- B' 双端同步白送（Phase 3d transport 已落，新加 mobile 字段 0 transport 改动）
- B' 包体 0 增（不引入新文件 schema）

**GA 后续 scope 影响**：无代码改动。已有移动端配置（如 BiometricPrompt 开关）若散落在其他存储位置，可在 v1.3+ 顺手迁到 `user_settings.mobile.*`，opportunistic 不必预防性。

### ADR-8 — REMOTE skill 注册表来源：disk-first + push-based（v0.9 amend）

> **v0.9 amend（[ADR Review v2.0](Android_ADR_重评估_v2.0.md) §2 ADR-8）**：v0.1 选 B（"开机从桌面拉取"）隐含 pull-model，实际 M4 `df61914ff` 落地为 disk-first + seed fallback + push-based update。本 ADR 文本对齐真实形态。signed manifest 验证 deferred 到 Marketplace 上线后。

**选项**：
- A. Android 内置 hard-coded REMOTE skill 列表，不可变（接近当前 23 commands 散落状态）
- B. 开机时 `RemoteSkillRegistry` 从桌面**主动 pull** 动态列表 + 元数据 + 本地缓存（v0.1 设想）
- **B'（v1.2 实际落地）**：`RemoteSkillRegistry.initialize()` **disk-first**（`store.load()`）→ 失败 fallback 到 `SeedRegistry` baseline；桌面通过 mobile-bridge **push** 更新（`registry.update` RPC，DID-signed）；signed manifest 验证 deferred

**选 B'**。理由：
- A 桌面新增 skill 必须发版 Android，更新链超长（与 B/B' 排除 A 一致）
- B 的 pull-model 需 mobile 启动时联网，与离线模式冲突；且 mobile 不必每次启动主动拉
- B' push-model 与 Phase 3d 同步 channel 共用 transport，0 新机制；DID-signed RPC 已为单次 update 提供 attestation
- B' disk-first 保证离线/首启都可用（`SeedRegistry.SKILLS` baseline 兜底）
- 桌面更新仍即时生效（B 的核心优势）— push 通道在线时立刻送达
- 元数据完整下发（描述 / 入参 / 是否需审批）— UI 可自动渲染 (B 的核心优势保留)

**signed manifest 状态**：
- 当前：无 signature 字段，`updateFromRemote()` 信任 DID-signed RPC 包装
- 触发条件：Marketplace 上线（manifest 来自第三方 publisher，需 trust anchor）
- GA 后续 scope 行动：预留 `SkillMetadata.signature: String? = null` forward-compat 字段 + verifier no-op stub（~0.3d）；真验签 deferred 到 marketplace M0 上线后

**GA 后续 scope 影响**：行动项 AI-3 + AI-5 见 [ADR Review v2.0](Android_ADR_重评估_v2.0.md) §4。

## 5. 架构与模块设计

### 5.1 整体架构

```
┌────────────────────────────────── Android v1.0 ──────────────────────────────────┐
│                                                                                  │
│  ┌─── L1 钥匙层（native，桌面无法替代）────────────────────────────────────┐   │
│  │  StrongBoxKeyManager │ DIDWallet │ BiometricGate │ QRPairing │ SignAsService│
│  └────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
│  ┌─── L2 捕获层（移动场景独占）───────────────────────────────────────────┐   │
│  │  CameraOCR │ VoiceMode │ LocationTagger │ PushNotifier │ ShareReceiver  │   │
│  └────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
│  ┌─── L3 REMOTE 层（薄客户端，不做 native skill）───────────────────────────┐   │
│  │  RemoteSkillRegistry │ RemoteCommandClient │ ProgressViewer │ ApprovalUI │   │
│  │  （收敛已有 23 *Commands.kt + 18 remote/ui 子模块到统一 registry）        │   │
│  └────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
│  ┌─── 通用基础设施（已就位）────────────────────────────────────────────────┐ │
│  │  P2PClient (WebRTC) │ SyncCoordinator (Phase 3d) │ SyncAuthVerifier (Ed25519) │
│  └────────────────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────────────┘
                                       ↕ JSON-RPC / Signal Protocol / WebRTC
┌─────────────────────────────── Desktop v5.0.3.47+ ───────────────────────────────┐
│  remote/command-router.js │ remote/remote-gateway.js │ remote/handlers/         │
│  sync/mobile-bridge-sync.js │ p2p/mobile-bridge.js │ p2p/device-pairing-handler.js│
│  ⊕ 新增：remote/handlers/mobile-skill-whitelist.js │ remote/handlers/mobile-approval-channel.js │
└──────────────────────────────────────────────────────────────────────────────────┘
```

### 5.2 L1 钥匙层模块

| 模块                  | 职责                                        | 后端                                | 现状                             | 单测目标 |
| --------------------- | ------------------------------------------- | ----------------------------------- | -------------------------------- | -------- |
| `StrongBoxKeyManager` | Ed25519 密钥生成 / 签名，私钥不出 TEE       | Android Keystore + StrongBox tier   | ✅ M2 D1 `4bce4ae2b` (wrapper-AES path) | 25 |
| `DIDWallet`           | DID 文档构建 / 多身份切换 / 助记词备份导入  | StrongBoxKeyManager + EncryptedFile | ✅ M2 D2 `fd875149e` (multi-DID + BIP-39 + migration) + UI v0.37 `f98d7b096` | 30 |
| `BiometricGate`       | 解锁前置门，敏感操作二次确认                | androidx.biometric                  | ✅ M2 D3 `4124038d9` (Gate integration + wrap cache)                       | 12 |
| `QRPairing`           | 扫码生成 P2P 配对码 / 扫码登录授权          | ZXing + DevicePairingHandler        | 🟠 **scaffold-only** (推 v1.1)：2034 行 UI scaffold 真实（`DevicePairingScreen` 509 + `QRCodeScannerScreen` 313 + `PairingViewModel` 185 + nav 366 + `QRCodeGenerator` 172 + `DeviceScan*` 489），但 (a) `PairingViewModel` 是 `delay(1000) // Simulate` 假 stub，注释 `// This is simplified - in practice would need peer's pre-key bundle` (b) `DEVICE_PAIRING_ROUTE` + `navigateToDevicePairing` 在 P2PNavigation 定义但 `android-app/app/` 0 调用，孤儿 (c) `feature-p2p/ui/QRCodeScannerScreen.kt` 注释 `Safety Numbers QR 码`，wire 到 E2EE peer verification 而非 pairing JSON shape；app NavGraph 引的是 `ui/social/QRCodeScannerScreen.kt`（friend-add 用）(d) 0 单测对接桌面 `handleQRCodeScan` `{type:"device-pairing"}` JSON 协议 | 18（推 v1.1） |
| `SignAsService`       | 暴露 `sign.request` REMOTE 给桌面调用       | RemoteCommandClient 反向通道        | ✅ M5 `6d482d066` (Android SignAsService + Desktop MobileSignClient)        | 14 |

### 5.3 L2 捕获层模块

| 模块             | 职责                                     | 现状                                                       | 同步方向                       |
| ---------------- | ---------------------------------------- | ---------------------------------------------------------- | ------------------------------ |
| `CameraOCR`      | CameraX → 截图 → REMOTE LLM OCR → KB     | ⏳ 仅 CAMERA 权限已声明；OCR pipeline 全新建               | Android → Desktop (sync.push)  |
| `VoiceMode`      | 长按麦克风 → ASR → REMOTE chat → TTS     | ⏳ ASR/TTS 各自端点已有；continuous 模式 + 长按触发新建    | 双向 RPC                       |
| `LocationTagger` | GPS + 时间戳附加到笔记 / DID 凭证        | ⚠️ 部分 M3 D-loc `be6cb4974`（JVM-testable parts 已落）；剩 `ACCESS_FINE_LOCATION` 权限 + GPS provider 接线 + 笔记元数据写入 | Android → Desktop (sync.push) |
| `PushNotifier`   | FCM + 本地 channel，4 类通知             | ⏳ 全新建（无 google-services.json，无 FCM SDK）           | Desktop → Android (推送)       |
| `ShareReceiver`  | Intent.ACTION_SEND 接收，落 Inbox        | ⚠️ 部分 M3 D-share `be6cb4974`（JVM-testable parts 已落）；剩 Manifest `intent-filter` + Activity 入口 + Inbox 队列接 sync.push | local → 队列 → sync.push |

### 5.4 L3 REMOTE 层模块

| 模块                  | 职责                                                    | 现状                                                       |
| --------------------- | ------------------------------------------------------- | ---------------------------------------------------------- |
| `RemoteSkillRegistry` | 维护可远程调用的 skill 清单 + 元数据，开机从桌面拉取    | ✅ M4 D1 `df61914ff` (23-skill seed，file-level granularity；method-level 仍在 M4 实现期补全) |
| `RemoteCommandClient` | JSON-RPC envelope，requestId 关联，AuthInfo Ed25519 签名 | ✅ 已有，需扩展元数据携带                                  |
| `ProgressViewer`      | 长时任务进度面板（订阅 Desktop 事件流）                 | ⏳ 新建（remote/ui/system 已有 ViewModel，但无统一进度面板）|
| `ApprovalUI`          | Cowork 投票 / Marketplace 大额支付 / 关键操作审批       | ⏳ 全新建                                                   |
| `OfflineQueue` (v1.1) | 桌面离线时本地排队，恢复后批量回放                      | ⏳ v1.1                                                     |

### 5.5 桌面端新增 / 改造（路径已对齐 v0.2 真实结构）

| 文件                                                          | 状态 | 职责                                  |
| ------------------------------------------------------------- | ---- | ------------------------------------- |
| `desktop-app-vue/src/main/remote/handlers/mobile-skill-whitelist.js` | ✅ `d6b3926fa` (133 行 + 18 单测) | `exposeRemoteSkills` + `approvalChannelsForMobile` 校验，`namespace.*` / `namespace.method` / `*` 模式，fail-safe disabled→拒绝、空 expose→拒绝 |
| `desktop-app-vue/src/main/remote/handlers/mobile-approval-channel.js`| ✅ `d6b3926fa` (150 行 + 11 单测) | 高风险 skill 的桌面发起 → pending Map → 60s 超时 → 用户响应解 Promise → command-router 继续 |
| `desktop-app-vue/src/main/remote/handlers/mobile-sign-client.js` (及 IPC) | ✅ 新 | M5 `6d482d066` 桌面端反向签名客户端，配 Android `SignAsService` |
| `desktop-app-vue/src/main/remote/__tests__/command-router-mobile-bridge.test.js` | ✅ `d6b3926fa` (集成测试) | router gate + whitelist 拒绝 + approval timeout 端到端联调 |
| `desktop-app-vue/src/main/remote/command-router.js`            | ✅ 改 `d6b3926fa` | line 38/41/155 注入 whitelist + approval-channel gate，`context.source === 'mobile'` 路径前置 + 强 ApprovalUI 调起 |
| `desktop-app-vue/src/main/remote/remote-gateway.js`            | ✅ 改 | 接 mobileBridge 配置                    |
| `desktop-app-vue/src/main/config/unified-config-manager.js`   | ✅ 改 | 加 mobileBridge.* 配置字段（`enabled` / `exposeRemoteSkills` / `approvalChannelsForMobile` / `requireMobileSignature` / `signRequestEnabled` / `signRequiredAbove`） |

### 5.6 envelope 协议（继承 + 扩展 Phase 3d）

```jsonc
{
  "jsonrpc": "2.0",
  "id": "req-uuid-v4",
  "method": "ocr.process",            // 或 sign.request、cowork.spawnTeam 等
  "params": { ... },
  "auth": {                            // Phase 3d v1.2 strict-mode 必填
    "did": "did:cc:...",
    "deviceId": "android-...",
    "nonce": "32-byte-random",
    "timestamp": 1736500000000,
    "signature": "ed25519-base64"      // sign over JCS(method+params+nonce+ts)
  },
  "approval": {                        // 仅 ApprovalUI 已通过的请求带
    "approvedAt": 1736500050000,
    "biometricLevel": "Class3",
    "signatureBackend": "StrongBox"    // StrongBox / TEE / Software
  }
}
```

### 5.7 6 资源类型双向同步（修正 v0.1 "5 类型"）

桌面 `mobile-bridge-sync.js:29-36` ResourceType enum：

| 资源类型       | 方向     | 桌面表名                     | Android 端 enum |
| -------------- | -------- | ---------------------------- | --------------- |
| MESSAGE        | 双向     | `p2p_chat_messages`          | ✅ |
| CONTACT        | 双向     | `contacts`                   | ✅ |
| FRIEND         | 双向     | `friends`                    | ✅ |
| POST           | 双向     | `social_posts`               | ✅ |
| POST_COMMENT   | 双向     | `post_comments`              | ✅ |
| NOTIFICATION   | 双向     | `notifications`              | ✅ |

Android 端 `core-p2p/.../sync/SyncManager.kt::ResourceType` enum 还包含 `KNOWLEDGE_ITEM / CONVERSATION / SETTING / FRIEND_GROUP` 等，但桌面 mobile-bridge-sync.js Walker 当前不扫这些表。**v1.0 需对齐**：要么扩 walker，要么从 Android enum 删去未对接类型。

## 6. 待实施（M1 ~ M7）

| 里程碑 | 工期    | 目标                                                         | 状态 | 验收                                  |
| ------ | ------- | ------------------------------------------------------------ | ---- | ------------------------------------- |
| **M1** | 0.5 天  | 文档评审 + REMOTE 23 commands 现状梳理 + ADR-5 能力对照表落地 | ✅ | RFC 8/8 ADR accepted + inventory PR `2244ced9f` 合并（file-level；method-level 推到 M4） |
| **M2** | 3 天    | L1 钥匙层：StrongBox tier + DIDWallet 多身份+助记词 + BiometricGate + QRPairing 收敛 | ✅ D1-D3 / 🟠 D4 scaffold-only（推 v1.1） | 67 单测 + E2E 首启动落 DID（QRPairing 真落地推 v1.1，scaffold 存在但 stub） |
| **M3** | 3 天    | L2 五件：Voice Mode + CameraOCR + LocationTagger + PushNotifier + ShareReceiver（v0.1 漏列后三件，工期 +1 天） | ⚠️ 部分（D-share/D-loc JVM 已落 `be6cb4974`） | 80+ 单测 + 5 件 E2E + Manifest 权限/intent-filter 改造 |
| **M4** | 2 天    | L3 RemoteSkillRegistry + 桌面白名单 + ApprovalUI              | ✅ desktop-side full（真机 E2E 待）：D1 ✅ `df61914ff` / D2 ✅ 桌面 channel `d6b3926fa` + Android M5 helper `eb7489bc4` + Android RPC 接收器 `eba16a1d8` + 桌面 transport `fc1793933` + **桌面胶水 + payload enrich + 集成 E2E (v0.7)** | 95 单测（29 桌面 channel/whitelist + 16 Android router + 4 Android M5 helper + 30 桌面胶水/transport + 10 端到端集成 + 6 router cross-namespace）+ 桌面白名单严格生效 + 真机 E2E 见 `Android_M4_D2_E2E.md` |
| **M5** | 1 天    | 反向 SignAsService（桌面调手机签名，ADR-6）                   | ✅ `6d482d066` | 14 单测 + E2E 大额 marketplace 通过   |
| **M6** | 1 天    | 性能 / 续航 / 弱网压测，回填 ✅ 实测值                         | ⏳ | 全部 §7.2 目标达标或解释偏差          |
| **M7** | 0.5 天  | 用户文档同步至 docs-site，发版 v1.0；同步更新 README versionName 0.32.0 → v1.0.0 | ⏳ | docs-site 可访问 + CHANGELOG v1.0 + README 修订 |
|        | **共 11 天**（v0.1 是 10 天，M3 +1 天） |                                       | **v1.0 已落 ≈ 9.0 天有效工 (v0.7)**（M4 D2 桌面 desktop-side full 收敛 + M3 / M6 / M7 验收文档就位）；**v1.0 剩 ≈ 2.5 天**（M3 D-voice / D-cam / D-push 真机验收 + D-push FCM 接入 / M4 D2 真机 E2E / M6 实测回填 / M7 GA flip versionName + CHANGELOG + docs-site 同步）；**QRPairing 真落地 ~2.5d 推 v1.1**，与 §8.5 桌面 Mobile Bridge 面板合并 | |

### M2 拆分（3 天）

- D1: ✅ StrongBoxKeyManager（与 AndroidDIDKeyStore 整合，加 tier 判定）+ 单测（25）— `4bce4ae2b`
- D2: ✅ DIDWallet（多身份 + 助记词 + 备份导入）+ 单测（30）— `fd875149e` + UI v0.37 `f98d7b096`
- D3: ✅ BiometricGate（统一现有零散 Settings flag）— `4124038d9`；E2E 首启动（QRPairing 见 D4）
- D4: 🟠 QRPairing **scaffold-only，真落地推 v1.1**（详见 §5.2 表 QRPairing 行 + §10 v1.1 列表）：2034 行 Compose UI scaffold + nav 真实，但 ViewModel 假 `delay()`、route 孤儿、scanner wire 到 Safety Numbers。真落地 ~2.5d，与 §8.5 桌面 Mobile Bridge 面板合并

### M3 拆分（3 天）

- D1: ⏳ VoiceMode 串联（已有 ASR + TTS 端点）+ CameraOCR 流水线
- D2: ⚠️ 部分 LocationTagger（含 Manifest 权限 + Foreground Service）+ ShareReceiver（含 intent-filter）— `be6cb4974` 仅落 JVM-testable parts；剩 Manifest 权限/intent-filter + provider 接线
- D3: ⏳ PushNotifier（FCM 集成 + 本地 channel 兜底）+ 5 件 E2E

### M4 拆分（2 天）

- D1: ⚠️ 部分 RemoteSkillRegistry — `df61914ff`（23-skill seed，file-level granularity）；剩 method-level 元数据补全 + 桌面 mobile-skill-whitelist.js 已 `d6b3926fa` ✅；剩单测（30 部分已落）
- D2: ✅ desktop-side full（真机 E2E 待，见 `Android_M4_D2_E2E.md`）分六段：
  - **桌面 channel** ✅ `d6b3926fa`：`mobile-skill-whitelist.js` + `mobile-approval-channel.js` + `command-router.js` gate wire-up + 18 + 11 单测 + 集成测试
  - **Android M5 helper（M4 D2 复用基座）** ✅ `eb7489bc4`：`AndroidApprovalGate.kt` 104 + `ApprovalDialogHost.kt` 263 + Hilt DI 23 + 单测 184 + MainActivity +22 —— 接 M5 SignAsService `sign.request` 流程；M4 D2 RPC 接收器复用其 `requestApproval` + dialog 机制
  - **Android RPC 接收器** ✅ `eba16a1d8`：`ApprovalCommandRouter.kt` 80 + `CompositeCommandRouter.kt` 30 + `RemoteModule.kt` binding 切 + 16 单测（10 + 6）。`approval.request` method → `ApprovalGate.requestApproval` → 返 `{requestId, approved, deniedReason}` map → `P2PClient` 包成 CommandResponse 反向送回
  - **桌面 transport** ✅ `fc1793933`：`mobile-bridge.js` `pendingReverseRpc` Map + 入向拦截 + `sendReverseRpcRequest(peerId, req, timeoutMs=60s)` generic 反向 RPC + `asMobileSignTransport()` adapter。`sendReverseRpcRequest` 是 generic JSON-RPC 2.0，M4 D2 + M5 共享
  - **桌面胶水 + payload enrich** ✅ (v0.7)：
    1. **mobile-approval-channel.js payload enrich**：`requestApproval` 新增 `payloadHash`（recursive canonical-JSON + SHA-256 hex 64-char，跨平台 deterministic）+ `payloadDescription`（默认 `"<Namespace> · <Action>"` derived，业务可覆写）+ `requireBiometric`（默认 true）— 与 Android `ApprovalCommandRouter` 读 params 字段名一致
    2. **mobile-approval-transport.js**（新独立模块）：`MobileApprovalTransport.wire(channel, bridge)` 把 `channel.setOnRequest(...)` 接到 `bridge.sendReverseRpcRequest(...)`，处理 RPC success/error/empty/transport-throw 4 类回应路径，返 unwire 函数
    3. **remote-gateway.js** 装配：`initializeCommandRouter` 构造 whitelist + channel 注入 CommandRouter；`bindMobileBridge(mobileBridge)` 在 MobileBridge ready 后被 index.js 调用，wire transport；`stop()` 加 unwire + `clearAll('gateway-stopped')`
    4. **index.js** wire：`initializeMobileBridge` 末尾 (MobileSignClient 之后) 调 `this.remoteGateway.bindMobileBridge(this.mobileBridge)`
  - **桌面集成 E2E（JVM）** ✅ (v0.7)：`m4-d2-cross-end-approval.test.js` 10 scenarios — 真接通整个 desktop-side 链路（CommandRouter → whitelist → channel → transport → fake bridge → 模拟 Android response），覆盖 happy / deny / biometric-fail / rpc-error / transport-error / timeout / non-approval / whitelist-blocked / 并发 / desktop-internal-bypass。**桌面侧 JVM 部分已无 gap**
  - **真机 E2E** ⏳ 待：见 `Android_M4_D2_E2E.md` — 跨 WebRTC DataChannel + 真 Compose Dialog + 真 BiometricPrompt + 真 StrongBox 4 个"最后一公里"环节

## 7. v1.0 验收标准

### 7.1 demo 路径

1. **首启**: 全新设备安装 → BiometricGate → DIDWallet 创建（StrongBox tier 显式）→ 助记词备份 → 重启后恢复
2. **配对**: 扫码桌面 → DID 双向认证 → Phase 3d sync 拉数据
3. **拍照入 KB**: 拍发票 → REMOTE OCR → 桌面 KB 看到
4. **Voice Mode**: 长按 → 连续 3 轮中文对话 → TTS 朗读 → 中断恢复
5. **Cowork 审批**: 桌面发起 spawnTeam → 手机推送（FCM）→ 进度面板 → 审批通过 → 桌面执行
6. **大额签名（反向）**: 桌面发起 marketplace 购买 > $10 → 手机 ApprovalUI → StrongBox 签名 → 桌面提交
7. **23 commands 收敛验证**: `cc-mobile` UI 能从 RemoteSkillRegistry 拉到所有 23 commands 的元数据 + 桌面白名单生效（黑名单 skill 拒绝）

### 7.2 性能预算（目标）

| 指标                | 目标         |
| ------------------- | ------------ |
| 冷启动 → DID 解锁   | < 1500ms     |
| 暖启动              | < 400ms      |
| 24h 后台耗电        | < 3%         |
| 包体大小            | < 30MB       |
| 同 LAN REMOTE p50   | < 200ms      |
| 跨 NAT REMOTE p50   | < 800ms      |
| StrongBox 签名      | < 30ms       |
| ASR 首字延迟        | < 500ms      |

### 7.3 测试矩阵

| 层      | 单测目标 | E2E   | 兼容性                                       |
| ------- | -------- | ----- | -------------------------------------------- |
| L1      | 99       | 2     | API 33 主测，30/28 降级测                    |
| L2      | 80+      | 5     | API 33 主测，弱网（3G/200ms RTT/5% loss）；新增 GPS/FCM/Share E2E |
| L3      | 55       | 3     | API 33 + 桌面 v5.0.3.47                      |
| 桌面侧  | 24       | 2     | 桌面 unit + integration                      |
| **共**  | **258+** | **12** | -                                            |

行覆盖率门槛 ≥ 80%。v0.1 是 220+ / 9，v0.2 因 M3 加三件拓宽到 258+ / 12。

## 8. 副线发现（不在 v1.0 范围，单开 issue）

> v0.1 §8.1 (mobile-app/ ↔ android-app/ 双目录) 与 §8.2 (security/ukey/ 半成品) 经核实**不存在**，已删除。剩余条目重新编号。

### 8.1 README versionName 滞后

`android-app/README.md` 声称 v0.32.0（2026-01-26），实际 `app/build.gradle.kts:50-51` versionName=0.37.0 / versionCode=37，落差 5 个版本号。M7 同步修订。

### 8.2 Phase 3d v1.3 单 peer 限制

`SyncCoordinator` 当前单 peer，v1.0 仍单 peer。多设备用户在 v1.0 不能"两台手机都同步"。v1.1 必修，v1.0 release notes 明示限制。

### 8.3 23 个 *Commands 散落 + 18 个 ui 子模块无 registry

当前 23 个 *Commands.kt 与 18 个 remote/ui/ 子模块没有统一注册表，方法名 hardcoded、UI 路由 hardcoded。M4 由 `RemoteSkillRegistry` 收敛，需做对照表 + 1 版兼容窗口（M4 PR 内）。

### 8.4 Android `ResourceType` enum 比桌面 walker 多

Android `core-p2p/.../SyncManager.kt::ResourceType` 含 `KNOWLEDGE_ITEM / CONVERSATION / SETTING / FRIEND_GROUP` 等额外类型，桌面 `mobile-bridge-sync.js` Walker 仅扫 6 类。v1.0 需对齐：扩 walker 或删 Android 多余 enum。

### 8.5 V5/V6 桌面 UI 中"移动端入口"暧昧

桌面 V5/V6 UI 没有专门的"移动端配对管理 / 已配对设备列表 / mobile-bridge 状态"页。v1.0 桌面侧需加一个 Settings → Mobile Bridge 子面板（小工作量，归在 M4 桌面侧）。

### 8.6 mobile-app-uniapp/ 是独立项目，与 android-app 无关

`mobile-app-uniapp/` 是 H5/uniapp 形态的另一条 mobile 路线，与本设计无关；本方案只覆盖 native android-app。需要在 README / 项目 overview 加一行说明，避免新成员混淆。

## 9. 风险与依赖

### 9.1 技术风险

| 风险                                | 缓解                                        | 等级 |
| ----------------------------------- | ------------------------------------------- | ---- |
| StrongBox 厂商裁剪 / 兼容性差异     | TEE 三阶段降级 + UI 标记签名等级（ADR-2）   | 中   |
| BiometricPrompt Class 2 / Class 3 不一致 | 高风险操作强制 Class 3（StrongBox 必备）    | 中   |
| WebRTC NAT 穿透失败率               | WebSocket fallback（已有）+ TURN（v1.1）   | 中   |
| FCM 在国内的可达性                  | 本地 channel + 同步触发拉取兜底            | 高   |
| 系统 ASR 中文识别率低               | opt-in 火山豆包 ASR + v1.1 加 Whisper local | 中   |
| StrongBox 设备 < 50% 用户           | 三阶段降级 + 高风险操作硬要 StrongBox      | 中   |
| 23 commands 收敛迁移破坏向后兼容    | RemoteSkillRegistry 提供 alias + 1 版兼容窗口（M4） | 中 |

### 9.2 依赖

- **桌面 v5.0.3.47+**: mobile-bridge-sync.js + p2p/mobile-bridge.js + remote/command-router.js 已就位
- **Phase 3d v1.2 strict-mode**: SyncAuthVerifier 已落
- **Phase 3d v1.3 mDNS + WebRTC**: transport 已落
- **androidx.biometric 1.2+**: BiometricGate 必需
- **CameraX 1.3+**: CameraOCR 必需
- **Google Play Services + FCM**: PushNotifier 必需（国内兜底见 §9.1）
- **Play services Location**: LocationTagger 必需

无外部团队 / 第三方依赖（除 FCM 和厂商 StrongBox 实现）。

### 9.3 不可控

- FCM 国内可达性是 Google 服务，需文档明示并提供本地 channel 兜底
- 老设备 StrongBox 缺席率随机，无法控制，仅能降级 + 提示

## 10. 后续 milestone（v1.1 / v1.2 历史 + GA 后续 scope）

> **版本号政策（2026-05-15 拍板）**：Android **不再使用独立 semver**（v1.1 / v1.2 / v1.3 之类的命名只保留已 close 的历史 milestone），versionCode + versionName **直接对齐桌面 `productVersion`**（当前 `versionCode = 503053` / `versionName = "5.0.3.53"`，commit `391eef681`）。后续 scope **不再起 v1.3 / v1.4 这类 semver milestone**，统称 "GA 后续 scope"；GitHub milestone "Android v1.3" 保留作为兼容容器但语义已转 placeholder。
>
> **GitHub milestones / tracking issues**（2026-05-12 创建 / 2026-05-15 政策调整）：
>
> | milestone | due | tracking issue | scope 概要 |
> |---|---|---|---|
> | [Android v1.1](https://github.com/chainlesschain/chainlesschain/milestone/1) | 2026-09-30 | [#19](https://github.com/chainlesschain/chainlesschain/issues/19) ✅ CLOSED | P0 §10 6 件 + P1 §8/§9 散落 2 件 + P2 v1.0.0 GA 遗留 4 件 |
> | [Android v1.2](https://github.com/chainlesschain/chainlesschain/milestone/2) | 2026-12-31 | [#20](https://github.com/chainlesschain/chainlesschain/issues/20) ✅ CLOSED | P0 §10 3 件（Auto/Wear/m-of-n）+ P1 性能/包体优化（前置 v1.1） |
> | [Android v1.3](https://github.com/chainlesschain/chainlesschain/milestone/3) (兼容容器) | 2027-Q1+ | [#21](https://github.com/chainlesschain/chainlesschain/issues/21) | GA 后续 scope：跨平台基础设施 + m-of-n Phase 3+ + Wear long-tail；版本号随桌面 productVersion，不单独发 v1.3.0 |
>
> 设计文档 §10 仍是 scope 的 **single source of truth**；issues 是执行追踪面。两者更新规则：
>
> - **scope 增减** 改设计文档 → issues 体在下次 review 时同步
> - **执行进度勾选** 在 issue checklist 完成 → 设计文档不动
> - 关键决策（如 §8.4 Q5 ResourceType 双端对齐方向）改设计文档同时更新 issue 描述

### v1.1（+7.5 天，目标 2026-Q3 — [milestone #1](https://github.com/chainlesschain/chainlesschain/milestone/1) / tracking [#19](https://github.com/chainlesschain/chainlesschain/issues/19)）

- OfflineQueue：桌面离线时 REMOTE 排队 + 恢复回放
- 多设备 N 端 pair（解 §8.2）
- TURN 中继 opt-in（解 §9.1 NAT 穿透）
- Whisper local ASR（解 §9.1 中文识别）
- ResourceType enum 双端对齐（解 §8.4）
- **QRPairing 真落地**（~2.5d，从 v1.0 M2 D4 推下）：(a) `p2pGraph()` 接进 app NavGraph + 加 Settings → "配对桌面" 入口 (b) `PairingViewModel` stub 换实 `RemoteCommandClient.invoke("device.pairing.handleQRCodeScan", ...)` (c) pairing QR scanner 接桌面 `device-pairing-handler.js` 的 `{type:"device-pairing",code,did,expiresAt}` JSON shape (d) 18 单测 + 1 E2E。与 §8.5 桌面 Settings → Mobile Bridge 子面板（Q4 决策）合并实施
- 国内 push 厂商 SDK（OPPO / 小米 / 华为 / vivo，解 §9.1 + Q2 决策）
- v1.0.0 GA 遗留：M3 真机 E2E / M4 D2 真机 E2E / M6 性能实测 / FCM 真接入（详 [docs/v1.0_GA_checklist.md](../v1.0_GA_checklist.md)）

### v1.2（目标 2026-Q4 — [milestone #2](https://github.com/chainlesschain/chainlesschain/milestone/2) / tracking [#20](https://github.com/chainlesschain/chainlesschain/issues/20)）

- Android Auto 入口（车载 Voice Mode + 推送，driving safety 合规：语音 confirm/deny ApprovalUI、不依赖触摸）
- Wear OS 入口（独立 wear/ Gradle module + tile + 简化 ApprovalDialog with vibration + Wear OS 4 BiometricPrompt 本地）
- m-of-n 多签（手机 + 桌面 U-Key 联签，复用 [`@chainlesschain/core-mtc/publisher-signing`](../../packages/core-mtc/src/publisher-signing.js) 的 strip-all-sigs JCS 机制；marketplace.purchase $1000+ 强 2-of-2）

**前置依赖**：v1.2 必须等 v1.1（[#19](https://github.com/chainlesschain/chainlesschain/issues/19)）close — OfflineQueue / N-peer / Whisper 是 v1.2 (Auto + Wear) 的基础设施。

### GA 后续 scope（[#21](https://github.com/chainlesschain/chainlesschain/issues/21)，版本号随桌面 productVersion）

来源：v1.0/v1.1/v1.2 实施过程发现的需求积累。**不属于 §10 三层定位的直接落地**，但支撑 GA 上架审核 + 跨平台长期一致性 + Marketplace marketing 价值。每项启动前需对照当时真实 codebase 复评（落到具体桌面 productVersion 时可能有部分提前掉队）。

**版本号约定**：本 scope 下任何 Android 改动**不发独立 v1.3.0 / v1.4.0 tag**；落地随对应桌面 `productVersion`（如 `v5.0.3.54+`）一次性 build + release，由 `.github/workflows/release.yml` build-android job 同步生成 4 个 ABI APK + AAB（参 memory `feedback_android_tag_follows_desktop.md` + `build_android_keystore_path_bug.md`）。

**Triage 分层（2026-05-12，[#21](https://github.com/chainlesschain/chainlesschain/issues/21) 占位状态下做的预判，GA 反馈到位后回头复评）**：

| 层 | 准入 | 子项 |
|---|---|---|
| **P0 前置** | 纯技术 / META 决策 / 不依赖 GA 反馈 / 可能 block 其他项 | A.3、B.2、B.6 |
| **P1 主体** | 本 scope 主体，GA 反馈引导内部优先级 | A.1、A.2、B.1、B.5、C.1 |
| **P2 候选** | 容量风险大 / 依赖未明 / 基础设施投资 / 可推后做 | B.3、B.4、C.2、C.3 |

**关键依赖链**：

- **A.3 ADR-2 重评估 → B.3 DID rotate**：ADR-2 若决定砍 TEE 中间层，attestation 格式需重设计，B.3 必须先等 A.3
- **A.3 ADR-7 重评估**：影响是否做 user_settings 双端同步对 cc-mobile.json 的吞并
- **B.1 web-shell 签字 → Unified KeyStore 收口**：v1.2 外部前置未完，B.1 启动前先确认 KeyStore 状态
- **C.1 watch face VoiceMode → Auto Phase 1 `cc.voice.start` IPC generic 化**：v1.2 voice intent 是 Auto 私有，wear 复用前需先抽 generic IPC
- **B.4 + B.5 容量互斥**：D 列两项各可独立长成几轮 release 的 scope，单一 release 框可能仅容其一

**A. 跨平台基础设施（GA 上架 + 长期 demo 必经）**

- **A.1（P1）桌面端 Linux native 配对**：v1.0/v1.1 仅 Win/macOS 测过 `device-pairing-handler.js` + libp2p transport；Linux 需补 mDNS systemd 单元 / Wayland 屏幕权限 / headless server 模式（CI runner + 公司开发机友好）。GA 反馈决定优先级（若 Play Store 不接 Linux 用户场景，可降级 P2）
- **A.2（P1）跨手机/手表/桌面三端 UI consistency 设计文档** ✅ baseline landed (2026-05-15 [`三端_UI_Consistency_设计文档.md`](三端_UI_Consistency_设计文档.md))：v0.1 三端 surface inventory + 4 must-be-consistent rules (语义颜色 / DID 短显示 canonical helper / m-of-n 进度三档语境 / 高风险二次确认) + 4 must-be-different rules (Wear 大按钮+vibration / Desktop 侧栏+drawer+table / Phone BottomSheet+Biometric / Auto 语音 only)。**~0.9d 现有偏差 sweep** (DID short 字符数 + 省略号 + m-of-n 列表 tag + Wear payload hash 短码) 列入 opportunistic v0.2。**v0.2 触发**：GA 上架反馈到位后复评 P1 边界（DID nickname 替代 / hex 完全拉齐 / 二次确认形态对齐）
- **A.3（P0 前置）v2.0 重新评估 ADR**：8 个 ADR（ADR-1 ~ ADR-8）实施一年后回看，**本 scope 任何 ADR 相关技术决策开工前必须先做**。详 [Android_ADR_重评估_v2.0.md](Android_ADR_重评估_v2.0.md)（2026-05-12 v1.0 收稿）：5 keep / 2 amend (ADR-7 / ADR-8) / 1 revise (ADR-2，blocks B.3)：
  - **ADR-2**（StrongBox 优先 + TEE 降级 + 软件 Ed25519 三阶段）— Pixel 9 起 StrongBox 默认覆盖率提升后，软件兜底是否可降级为 dev-only？**blocks B.3**
  - **ADR-7**（cc-mobile.json 独立配置）— Phase 3d `user_settings` 表双端同步落地后，配置文件还该独立吗？
  - **ADR-8**（开机拉 skill registry）— Marketplace 上线后是否改 lazy fetch + signed manifest 验证？

**B. m-of-n Phase 3+（[#20](https://github.com/chainlesschain/chainlesschain/issues/20) P0.3 已落 Phase 1+2+Android UI；下一阶段下推到 GA 后续 scope）**

桌面 core-multisig + marketplace mediator + web-shell 入口 + Android dialog 已就位。本 scope 候选：

- **B.1（P1）web-shell private key signing UI** ✅ **PR1+2a+2b+3 全闭环 (2026-05-15** [`B1_WebShell_Multisig_Sign_spike.md`](B1_WebShell_Multisig_Sign_spike.md) v0.4**)**：原 "v1.2 还没收口" framing 已重评（Unified KeyStore infra 在 v1.1.0 已 ready）。**PR1**: MultisigSigner middleware + multisig.sign WS topic (31 tests)。**PR2a**: core-multisig `signWithExternal` async API + ukey wiring (15 tests)。**PR2b**: `buildUkeyManagerSigner` adapter + bootstrap wire + `SignProposalModal.vue`（domain badge + payload hash 短码 per A.2 §2.4.c + signer DID dropdown + source picker + danger 按钮 per A.2 §2.1.a）+ Multisig.vue 签名按钮 (10 tests)。**PR3**: `unified_keys` idempotent ALTER TABLE 加 `did` 列 + `findKeyForDid/setDidForKey` + MultisigSigner unified source 真分发（entry.source==='ukey' 复用 ukeySigner callback；software/simkey/tee 留 NOT_IMPLEMENTED 待加密 secret store F1 follow-up）(13 tests)。**累计 113 tests，0 regression**。secretKey 永不出 main 进程边界。Follow-ups F1-F4 见 spike doc
- **B.2（P0 前置，纯技术）✅ 已落** 削 cc subprocess 冷启：v1.2 web-shell `/multisig` 走 `ws.execute("cc multisig …")` 子进程，asar:true 后冷启 6-10s（见 memory `desktop_release_b4_surgery_lessons.md`）。**2026-05-12 落地**：`multisig-handlers.js` 新增 7 个 in-process WS topics（`multisig.list/show/policy.show/cancel/finalize/sweep` + `marketplace.consume`）调 `@chainlesschain/core-multisig` v0.1.0；`Multisig.vue` `isEmbedded` 分支用新 topics（cc serve 非 asar 模式仍走原 ws.executeJson 兜底）；冷启 6-10s → in-process ~20ms (SQLite open) + 查询；23 unit tests + 379 web-shell regression 全过
- **B.3（P2，双依赖）DID rotate**：手机/桌面 DID 长期不变 → 设备丢失后所有 m-of-n 提案的 signer DID 引用全失效。需要受控 rotation：广播旧→新 DID attestation 让 `core-multisig.policy` 自动重写 signer 列表。**依赖 A.3 ADR-2 + GA 反馈实际误触/丢失率**
- **B.4（P2，spike）air-gapped QR signing**：U-Key 离线机签字。手机/桌面 export 提案为 QR → 离线机扫描签字 → 输出 QR → 重扫入链。比较硬，列在这里要先开 spike 估准工，不必本 scope 一次做完。与 B.5 容量互斥
- **B.5（P1）跨链桥 outbound 接入**：v1.2 多签只签内部 marketplace consume；接入 EVM/Cosmos outbound 后 m-of-n 直接成跨链 gateway governance 层（marketing 价值 > air-gapped，优先级建议更高）。**与 B.4 容量互斥**，本 scope 框入此项则 B.4 留 spike
- **B.6（P0 前置，纯技术）✅ verifier 部分已落** PQC 严格模式：MTC v0.11 已支持 Ed25519+SLH-DSA hybrid（memory `mtc_landing_v0_11.md`）。严格模式 = 拒收纯 Ed25519，强制每个 partial signature 必带 SLH-DSA 段（受 NIST 监管类客户欢迎，代价签名包 +几 KB）。**2026-05-12 verifier 侧落**：`LandmarkCache` 加 `strictPqMode` opt-in flag + `_assertStrictPqMode()` gate + `STRICT_PQ_MODE_VIOLATION` error code + 9 tests，Reading A 语义（全员 SLH-DSA，无 hybrid pair per-member）。生产者侧无需改（已是 heterogeneous，生产者只需配 SLH-DSA signers）。Reading B（per-member hybrid pair）若未来有监管诉求再做数据格式改动

**C. Wear long-tail（[#20](https://github.com/chainlesschain/chainlesschain/issues/20) P0.2 已完 Phase 0-3 主体；下一阶段下推到 GA 后续 scope）**

- **C.1（P1）watch face → VoiceMode shortcut** ✅ **PR1+PR2+PR3 全闭环 (2026-05-15** [`C1_WatchFace_VoiceMode_spike.md`](C1_WatchFace_VoiceMode_spike.md) v0.3**)**：**准入条件重评** — 原 framing "Auto Phase 1 voice intent 抽出 generic" 不准确 (`cc.voice.start` 仓库内 0 匹配；Auto VoiceMode 用 `androidx.car.app` Screen API；phone VoiceModeScreen 完全孤儿)。**真实 scope = 从零建立** phone-side intent + wear→phone Data Layer 桥 + wear UI entry (3 PR)。**PR1**: `VoiceLaunchActions` + `VoiceTriggerSource` 4-enum + `Screen.VoiceMode` route + MainActivity 处理 + manifest filter + 15 tests。**PR2**: `CcPhoneVoiceListener` 精确路径 `/cc/voice/start` listener → `startVoiceActivity` 走 VoiceLaunchActions → MainActivity + 11 tests。安全锁：payload `trigger_source` 不可信，源固定 WEAR_FORWARD。**PR3**: wear `WearVoiceSender` (`/cc/voice/start` json 异步发，三态 OK/NO_PHONE/SEND_FAIL) + `VoiceForwardActivity` invisible trampoline (50ms 入场 vibration + 失败 100ms 双震) + `VoiceComplicationService` 静态 "语音/对话" complication + `VoiceShortcutTileService` 全屏 tile + manifest 注册 + 7 tests。**累计 33 tests，wear↔phone forwarding 端到端协议 wired**（Wearable Data Layer IO 真表 E2E 留 instrumented Follow-up）
- **C.2（P2，工作量大）LongTask running count complication**：v1.2 用 pending approval count 兜底；真接 LongTask 状态 stream 需 phone expose `cowork.longTask.running` 给 wear Data Layer，相当于半个新 sync channel。可推下个 milestone
- **C.3（P2，CI 基础设施）Instrumented test 真路径（Tile / ComplicationRequest）**：JVM 单测里 `com.google.wear.services.tiles.TileInstance NoClassDefFoundError` 是 Google 设计上 JVM-impossible（见 v1.2 commit `dc26f9572` 测试 KDoc）。要么开 gradle managed device AVD CI / 真机 farm / 接受这维度无 coverage。CI infra 投资，可推

**D. 触发与风险**

- 本 scope **何时启动主体 P1**：看 v1.2 GA 上架审核 + 真用户实测反馈（Android v1.0 GA tag = 桌面 `v5.0.3.NN`，Play Store / Android Auto / Wear OS 真用户）。如果 P0.3 m-of-n 生产被频繁误触 / Wear 在不同 watch face 上崩 / Auto DHU 真车测出新问题，本 scope 会被这些 P0/P1 抢占
- 本 scope 与 **v2.0 ADR 重评估** 互相约束：若 ADR-2 决定砍 TEE 中间层，m-of-n DID rotate 的 attestation 格式可能需重设计（**A.3 → B.3 依赖链**）
- 跨链桥 outbound + air-gapped 两项足够长，每项都可能独立长成几轮 release 的 scope；单 release 框可能仅容其一（**B.4/B.5 互斥**）
- **P0 前置 3 项（A.3 / B.2 / B.6）不依赖 GA 反馈，可在 GA 审核期并行启动**，不占主 scope 工期 — 2026-05-12 GA-independent 部分齐落
- 因 Android 不再起独立 semver，本 scope 子项 **按桌面 productVersion 节奏分批 land**，不等单一 v1.3.0 tag 集中发版

## 11. 与既有设计文档的关系

| 文档                                                 | 关系                                              |
| ---------------------------------------------------- | ------------------------------------------------- |
| `Phase3d_Mobile_Sync_设计文档.md`                     | **基础**，本方案直接复用其 transport / sync / 验签 |
| `系统设计_个人移动AI管理系统.md`                       | 早期愿景文档，本方案是其落地路径的具体化           |
| `系统设计_主文档.md`                                  | 整体架构，本方案在"移动端"章节细化                |
| `modules/02_去中心化社交模块.md`                      | DID / 社交，本方案 L1 引用其 DID 规范              |
| `modules/10_远程控制系统.md`                          | REMOTE 远控，本方案 L3 是其 mobile 端落地          |
| `桌面Web壳_架构与落地_设计文档.md`                     | 无直接耦合，但 web-shell 的"瘦客户端"思路与本方案 L3 同源 |
| `默克尔树证书_MTC_落地方案.md`                         | v1.2 多签会复用 MTC publisher_signature M-of-N    |

## 12. 待决问题

- **Q1**: §8.6 mobile-app-uniapp/ 与 android-app 的 README 说明分工，是 M1 落 README 改动还是 v1.1 单独 issue？倾向 M1（一行说明，零工时）。
- **Q2**: §9.1 FCM 国内可达性 — 是否在 v1.0 就接 OPPO / 小米 / 华为推送 SDK？工作量约 2 天，未列入 M1-M7 工期。倾向 v1.0 仅 FCM + 本地兜底，统一推送在 v1.1。
- **Q3**: ADR-6 反向 RPC 在 macOS/Linux 桌面的硬件 USB Key 替代价值是否要写进 marketing？等 M5 demo 完再决定文案。
- **Q4**: §8.5 桌面 Settings → Mobile Bridge 子面板归 M4 还是单独 M4.5？倾向归 M4（DI 1 天内），但要确认桌面 V6 shell port 进度。
- **Q5**: §8.4 ResourceType enum 双端对齐 — 桌面 walker 扩 4 张表（KNOWLEDGE / CONVERSATION / SETTING / FRIEND_GROUP）vs Android enum 删未对接类型。倾向扩 walker（KB 同步是核心价值，不该让 Android enum 单方面降级），但确认是否要纳入 v1.0 范围。

## 变更记录

- 2026-05-15 v0.16：**§10 C.1 PR3 landed — C.1 主体闭环** — wear-side `WearVoiceSender` + `VoiceForwardActivity` trampoline + `VoiceComplicationService` + `VoiceShortcutTileService` + wear manifest 注册 1 activity + 2 services + 7 unit tests。wear→phone forwarding 端到端协议 wired (累计 33 tests across 3 PRs)。真表 instrumented E2E 留 follow-up。
- 2026-05-15 v0.15：**§10 C.1 PR2 landed** — phone-side `CcPhoneVoiceListener` WearableListenerService 收 wear→phone `/cc/voice/start` Data Layer 消息（exact path 与现 `CcPhoneDecisionListener` `/cc/` prefix 不互扰）。`VoiceForwardWire` 解析 + `startVoiceActivity` 走 PR1 VoiceLaunchActions 路径 + Intent flags + setPackage 锁包 + source 固定 WEAR_FORWARD 防 forge。11 Robolectric tests。phone-side 链路收口；PR3 wear UI 是下一步。
- 2026-05-15 v0.14：**§10 C.1 PR1 landed + 准入条件重评** — Audit 显示 `cc.voice.start` 仓库内 0 匹配（spike doc framing 失实），phone VoiceModeScreen 是孤儿，wear 现 complication tap 只回 WearMainActivity。重新写 3 PR 拆分。PR1 加 `VoiceLaunchActions.kt` (ACTION_START_VOICE_MODE constant + VoiceTriggerSource enum 4 个 source) + NavGraph 注册 phone VoiceModeScreen + MainActivity cold-start/onNewIntent 处理 + manifest intent-filter + 15 Robolectric unit tests + spike doc `C1_WatchFace_VoiceMode_spike.md` v0.1。PR2 phone wear listener + PR3 wear UI 列入下一步。
- 2026-05-15 v0.13：**§10 B.1 全 4 PR 闭环** — PR1 (middleware seam) + PR2a (signWithExternal API) + PR2b (UI + ukey wire) + PR3 (DID routing) 全部 land。113 tests / 0 regression。Follow-ups F1-F4 列入 spike doc。renderer 经 WS 调 main 进程 ukeyManager，secretKey 永不出边界。
- 2026-05-15 v0.12：**§10 B.1 PR1 landed + 准入重评** — Unified KeyStore audit 显示 infra 已 ready（v1.1.0），原 "v1.2 还没收口" framing 不成立。`B1_WebShell_Multisig_Sign_spike.md` v0.1 收稿。PR1 `MultisigSigner` middleware + `multisig.sign` WS topic + 31 tests 0 regression。PR2/3 列入 follow-up。
- 2026-05-15 v0.11：**§10 A.2 baseline landed** — `三端_UI_Consistency_设计文档.md` v0.1 收稿（GA-independent 部分）。三端 surface inventory + 4 must-be-consistent rules（语义颜色 / DID 短显示 canonical helper / m-of-n 进度三档语境 / 高风险二次确认）+ 4 must-be-different rules（Wear 大按钮+vibration / Desktop 侧栏+drawer+table / Phone BottomSheet+Biometric / Auto 语音 only）。~0.9d opportunistic sweep 清单（DID short 字符数 / 省略号 / m-of-n 列表 tag / Wear payload hash 短码）。docs-site / docs-site-design ROOT_FILE_MAP 双副本同步。GA 反馈触发 v0.2 复评 DID nickname 替代 / hex 完全拉齐 / 二次确认形态对齐。事实声明无变更，仅 baseline 设计文档。
- 2026-05-15 v0.10：**Android 版本号政策调整 + §10 rebrand**（[#21](https://github.com/chainlesschain/chainlesschain/issues/21) 推进期间确认）。**用户拍板**：Android 不再起独立 semver（v1.1/v1.2/v1.3），versionCode + versionName 直接随桌面 `productVersion`（当前 `503053` / `5.0.3.53`，commit `391eef681` 已落）；后续 scope 子项按桌面 productVersion 节奏分批 release，不再等 v1.3.0 集中发 tag。§10 sweep：(1) 顶部表 "Android v1.3+" → "GA 后续 scope（兼容容器 milestone#3）" (2) §10.v1.3+ 子节 header 改 "GA 后续 scope（[#21]，版本号随桌面 productVersion）" (3) 子节内 "v1.3 scope/milestone" → "本 scope" (4) §3 ADR-7/ADR-8 段 "v1.3+ 影响/行动" → "GA 后续 scope 影响/行动" (5) D 列触发与风险 5 条全 rewrite。历史 v1.1/v1.2 已 close milestone 引用作为历史保留不动。事实声明未变更，仅命名 + 政策记录。
- 2026-05-12 v0.9.4：[#21](https://github.com/chainlesschain/chainlesschain/issues/21) **A.3 AI-3 SkillMetadata.signature forward-compat 落地**（ADR-8 amend §4 行动项）。`android-app/app/src/main/java/com/chainlesschain/android/remote/registry/`：(1) 新增 `ManifestSignatureVerifier.kt`（43 LOC）— `interface` + sealed `VerificationResult.{Accepted | Rejected(reason)}` + `object NoOpManifestVerifier` always-accept stub。(2) `SkillMetadata.kt` 加 `signature: String? = null` field + `init` 不允许 blank（用 null 代表 unsigned）。(3) `RemoteSkillRegistry.kt` 加 `@Volatile manifestVerifier = NoOpManifestVerifier` + `fun setManifestVerifier(v)` swap seam + `updateFromRemote` 跑 verifier per-skill，rejected 走 Timber.w warn-log + 跳过（partial-acceptance），accepted 走原合并路径。(4) `ManifestSignatureVerifierTest.kt`（222 LOC）— 12 tests：field invariants（default null / non-null 直存 / blank reject）、NoOpManifestVerifier 行为、setManifestVerifier swap + RequireSignatureVerifier 部分接受 + AlwaysRejectVerifier 全拒空跑、默认 NoOp path BC 验证。**本地 NDK env 缺失（:feature-ai 配置阶段 CXX1101），无法跑本地 gradle test；纯 Kotlin 改动 0 native 依赖，CI 验证**。Marketplace M0 上线时（#21 AI-5）通过 `setManifestVerifier` 注入真 Ed25519/SLH-DSA hybrid 验签 implementation 即可；调用方 0 改动。
- 2026-05-12 v0.9.3：[#21](https://github.com/chainlesschain/chainlesschain/issues/21) **B.2 削 cc subprocess 冷启 落地**（P0 前置最后一项，三项 P0 完整 GA-independent 部分齐落）。`desktop-app-vue/src/main/web-shell/handlers/multisig-handlers.js` 新增 7 个 in-process WS topics 镜像 CLI `--json` 输出 shape：`multisig.list / show / policy.show / cancel / finalize / sweep` + `marketplace.consume`。topics 调 `openMultisigManager()` from CLI `multisig-runtime.js`（per-call open，SQLite WAL ~20ms），dynamic-import 跨 CJS/ESM 边界（参 `skill-list-handler.js` 同 pattern）。`web-shell-bootstrap.js` `...createMultisigHandlers()` 注入。`packages/web-panel/src/views/Multisig.vue` 加 `callMultisigTopic(topic, msg, fallbackCmd, timeoutMs)` helper 用 `useShellMode().isEmbedded` 分发，7 处 ws.executeJson 全切；非 embedded (cc serve) 保留原 subprocess 路径（无 asar 开销）。冷启 6-10s → in-process ~20ms。23 unit tests + 379 web-shell regression（25 files）全过。Web-panel rebuild 30.48s，postbuild sync 同步到 CLI assets。事实声明：v1.2 web-shell /multisig 实际 UX 不变，仅性能 60-100× 提升；cc serve 路径 0 改动。
- 2026-05-12 v0.9.2：[#21](https://github.com/chainlesschain/chainlesschain/issues/21) **B.6 PQC 严格模式 verifier 侧落地**（P0 前置另一项，独立于 A.3）。`packages/core-mtc/lib/landmark-cache.js` 加 `strictPqMode` opt-in flag + `_assertStrictPqMode()` gate + `STRICT_PQ_MODE_VIOLATION` error code + `CLASSICAL_ALGS` constant + `isClassicalAlg` helper（exported via index.js）。**Reading A 语义**：strict mode 拒收任何 `alg === "Ed25519"` 的 partial sig + publisher_signature；与现 heterogeneous federation 数据格式兼容，无 schema 改动。9 tests 全过（regression 既有 publisher-signature + federation + landmark-cache-persist 29 tests 也全过）。生产者侧无改动：用户已可配 SLH-DSA signers，verifier 加严格 gate 即可。**Reading B（per-member hybrid pair）若未来 NIST 监管诉求强 inline 再做数据格式改动**，本次不做。事实声明：B.6 verifier ✅；producer 默认配置 + 文档侧 minor follow-up 待 GA 之后；issue #21 B.6 box partially checkable。
- 2026-05-12 v0.9.1：A.3 AI-1 落地 — ADR-7 / ADR-8 文本 amend 对齐真实落地形态。**ADR-7**：v0.1 选 B 的独立 `cc-mobile.json` 文件**从未创建**，实际走 `user_settings` 表 + `mobile.*` scope + Phase 3d LWW 同步；ADR 文本改写为 B' 形式 + 影响段标注 opportunistic 迁移。**ADR-8**：v0.1 选 B 的 pull-model 实际落地为 disk-first + seed fallback + push-based update（M4 `df61914ff`）；ADR 文本改写为 B' 形式，signed manifest 验证状态明确 deferred 到 marketplace 上线后，附 forward-compat 字段计划。ADR-2 revise 待 GA API level 数据驱动，未动文本（仍在 review doc 里跟踪）。事实声明未变更，仅 ADR-7/ADR-8 文本对齐真实。
- 2026-05-12 v0.9：A.3 P0 前置任务初稿收口（[#21](https://github.com/chainlesschain/chainlesschain/issues/21) 推进）。产出 [Android_ADR_重评估_v2.0.md](Android_ADR_重评估_v2.0.md) v1.0 — 8 个 ADR 全 audit，结论 **5 keep / 2 amend (ADR-7 cc-mobile.json 从未创建实际走 user_settings + ADR-8 实际 push-based 而非 pull) / 1 revise (ADR-2 三阶段仅在 SignAsService 落地，M2 DID wallet 仍走软件 Ed25519，blocks B.3 DID rotate)**。ADR-2 选项决策需 v1.2 GA 上架后的 API level 分布数据驱动。本文档 §10 v1.3+ A.3 加 review doc 引用 + 概要。事实声明未变更，仅加 review doc 链接 + 概要标注。ADR-1~8 原文文本不动，待 v1.3 后续 PR 按 review doc 落 amend (~0.3d) / revise (依赖 GA 数据决策后)。
- 2026-05-12 v0.8：§10 v1.3+ scope triage 分层（[#21](https://github.com/chainlesschain/chainlesschain/issues/21) "处理"诉求）。12 子项打 P0/P1/P2 layer 标签 + 5 条关键依赖链。**P0 前置 3 项（A.3 ADR 重评估 / B.2 削 cc 冷启 / B.6 PQC 严格模式）**不依赖 GA 反馈，可在 v1.2 GA 审核期并行启动。**P1 主体 5 项（A.1 Linux / A.2 三端 UI / B.1 web-shell 签字 / B.5 跨链桥 / C.1 watch VoiceMode）**GA 反馈引导内部优先级。**P2 候选 4 项（B.3 DID rotate / B.4 air-gapped QR / C.2 LongTask / C.3 instrumented）**容量风险 / 依赖未明 / 可推下个 milestone。事实声明未变更，仅加分层 + 依赖链可视化。
- 2026-05-12 v0.7：§10 补 v1.3+ 占位段（issue [#20](https://github.com/chainlesschain/chainlesschain/issues/20) P0.3 Android UI 落地 `7fd2a2566` 后回填）。新增 4 组：A 跨平台基础设施（Linux native 配对 / 三端 UI consistency / v2.0 ADR 重评估）/ B m-of-n Phase 3+ 6 子项（web-shell private key signing UI / 削 cc subprocess 冷启 / DID rotate / air-gapped QR / 跨链桥 outbound / PQC 严格模式）/ C Wear long-tail 3 子项（watch face VoiceMode shortcut / LongTask complication / Instrumented test 真路径）/ D 触发与风险（v2.0 ADR 互相约束 + 跨链桥 + air-gapped 可能各成 milestone）。§10 顶部表加 v1.3+ 行（milestone 暂未开，等 v1.2 GA 上架反馈触发 #21）。事实声明未变更。
- 2026-05-11 v0.6：M4 D2 Android RPC 接收器落地 + 桌面 transport 平铺审计。(1) **Android RPC 接收器** `eba16a1d8`：`ApprovalCommandRouter.kt` (~80 行) `approval.*` 命名空间路由器，`approval.request` 解析 `requestId/payloadDescription/payloadHash/requireBiometric` → `ApprovalGate.requestApproval` suspend 等用户决策 → 返 `{requestId, approved, deniedReason}` map；`CompositeCommandRouter.kt` (~30 行) 按命名空间分发（sync.* → SyncCommandRouter / approval.* → 本路由器）；`RemoteModule.kt` binding 切 `bindCommandRouter(impl: CompositeCommandRouter)`；16 单测（10 ApprovalCommandRouterTest FakeGate + 6 CompositeCommandRouterTest MockK）。(2) **桌面 transport 审计发现**：另一并行 session 在 `mobile-bridge.js` staged +102 行加 `pendingReverseRpc` Map + 入向 RPC response 拦截分支（line 858+）+ `sendReverseRpcRequest(peerId, req, timeoutMs=60s)` generic JSON-RPC 2.0 反向 RPC + `asMobileSignTransport()` adapter。注释虽然写「M5 ADR-6 transport」，但 transport 是 **generic** 的，M4 D2 也能借这条路。这让 M4 D2 桌面剩工从 ~0.5d 缩到 ~0.3d：仅剩 `mobileApprovalChannel.setOnRequest` 胶水（~20 行接 `sendReverseRpcRequest` + response.result → `resolveApproval`）+ payload enrich（~30 行算 JCS+SHA-256 hash + describe）+ 跨端 E2E。M4 D2 状态升级为 4/5 段已落（剩桌面胶水 + payload enrich + E2E）。v1.0 已落 8d → 8.5d，剩 4d → 3.5d。事实声明未再变更。
- 2026-05-11 v0.5：Phase D 桌面 + `eb7489bc4` 重分类校准。v0.4 两处错分类已修：(1) **桌面 mobile-skill-whitelist.js + mobile-approval-channel.js 不是 ⏳ 新（Phase D 任务），而是 ✅ `d6b3926fa`** (2026-05-11 11:17) —— 全实现 + 29 单测 + 集成测试 + `command-router.js` line 38/41/155 wire-up 都已落。§5.5 桌面表 + §6 M4 行 + M4 D2 拆分回填到现实。(2) **`eb7489bc4` 是 M5 ApprovalGate helper（接 SignAsService 流程），不是 M4 D2 完全落地**。`AndroidApprovalGate` 在 `com.chainlesschain.android.sign` 包下，wire 到 `sign.request` → gate → BiometricPrompt → StrongBox，**不接 generic approval-request from desktop**。M4 D2 真闭环还差 **Android RPC 接收器**：让 Android 从 mobile-bridge 收 `approval.request` RPC → dispatch 给 `AndroidApprovalGate.requestApproval` → 用户响应 → 反向 RPC 回桌面 `MobileApprovalChannel.resolveApproval()`。~0.5d 工 + ~0.5d E2E。v1.0 剩工预算 5d → 4d（桌面侧本就已经落，v0.4 错估让它显得没落）。事实声明未再变更。
- 2026-05-11 v0.4：QRPairing audit + M4 D2 入账。(1) **M2 D4 QRPairing audit 结果**：2034 行 UI scaffold 真实存在，但 `PairingViewModel.kt` 是假 `delay()` stub（注释 `// This is simplified - in practice would need peer's pre-key bundle`）、`DEVICE_PAIRING_ROUTE` + `navigateToDevicePairing` 在 P2PNavigation 定义但 `android-app/app/` 0 调用（孤儿）、`feature-p2p/ui/QRCodeScannerScreen.kt` 实际 wire 到 E2EE Safety Numbers 而非 pairing JSON shape。M2 D4 状态从 ⚠️ 改成 🟠 scaffold-only；真落地 ~2.5d 推到 v1.1 与 §8.5 桌面 Mobile Bridge 面板（Q4）一起做。(2) **M4 D2 Android ApprovalUI 入账** `eb7489bc4`（`AndroidApprovalGate.kt` 104 + `ApprovalDialogHost.kt` 263 + DI 23 + 单测 184 + MainActivity +22）—— 之前被 lint-staged sweep 进 doc commit，本版正式回填到 §5.5 / §6 / M4 拆分。v1.0 剩工 7d → 5d。事实声明未再变更。
- 2026-05-11 v0.3：实施进度回填稿。M1 RFC + inventory 已落 (`2244ced9f`)；M2 D1-D3 全落 (`4bce4ae2b` / `fd875149e` / `4124038d9`) + UI v0.37 (`f98d7b096`)；M3 D-share / D-loc 的 JVM-testable parts 落 (`be6cb4974`)；M4 D1 RemoteSkillRegistry 落 (`df61914ff`)；M5 全落 (`6d482d066`)。§5.2 / §5.3 / §5.4 / §5.5 / §6 状态表 + M2~M5 拆分逐项回填，header 状态从「RFC 评审中」→「ADR 8/8 accepted · M1/M2/M5 ✅ · M3/M4 部分 · M6/M7 ⏳」。剩余面（约 7 天有效工）：M3 D-voice / D-cam / D-push + D-share/D-loc 的 Manifest 接线、M4 ApprovalUI + 桌面 whitelist/approval-channel、M6 性能验收、M7 发版、QRPairing Android 扫码 UI audit。事实声明未再变更。
- 2026-05-11 v0.2：调研收口稿。基于二轮代码核实修正：
  - 桌面对标 v5.0.3.46 → v5.0.3.47
  - Android 版本 v0.32.0 → v0.37.0
  - 删除 v0.1 §8.1（mobile-app/ ↔ android-app/ 双目录，实际不存在）
  - 删除 v0.1 §8.2（security/ukey/ 半成品，实际不存在）
  - ADR-5 完全重写："8 个 doc-only stub" 假设错误（trading/marketplace/BI/agent federation/autonomous 在代码零出现；cowork/workflow 是真代码 35+ .kt），改成"已有升级 / 不存在按需开通"对照表
  - §2.1 现状速览重写：基于 settings.gradle.kts 真实 25 模块结构 + remote/commands 23 个 + remote/ui 18 子模块
  - §2.2 加 BiometricPrompt / ASR/TTS / Camera 权限 / DID 密钥 / Keystore 现状细分
  - §2.4 新增桌面 remote 真实结构（command-router.js 而非 command-handler.js）
  - §3.1 G3 加 LocationTagger / PushNotifier / ShareReceiver 三件
  - §5.5 路径修正到真实 `remote/handlers/` + `command-router.js`
  - §5.7 资源类型 5 → 6（多 NOTIFICATION）
  - M3 工期 2 → 3 天（v0.1 漏列 L2 三件）
  - 总工期 10 → 11 天
  - 单测目标 220+ → 258+，E2E 9 → 12
  - 加 §8.3 (23 commands 散落) §8.4 (resource type 错位) §8.6 (mobile-app-uniapp 说明)
  - 加 Q5 待决问题
- 2026-05-10 v0.1：初稿，三层定位 + 8 ADR + 10 天 M1-M7 路线（部分事实声明经 v0.2 核实有误）
