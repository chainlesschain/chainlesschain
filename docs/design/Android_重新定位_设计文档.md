# Android 客户端重新定位设计文档

> **版本**: v0.5 (Phase D 桌面 + eb7489bc4 重分类校准, 2026-05-11) | **状态**: 🟡 ADR 8/8 accepted · M1/M5 ✅ · M2 ✅ D1-D3 / 🟠 D4 scaffold-only · M3 部分 · **M4 D1 ✅ / D2 ⚠️ 部分**（桌面 ✅ + Android M5 helper ✅，Android RPC 接收器 ❌）· M6/M7 ⏳ | **关联**: Android v0.37.0 → v1.0.0 | **桌面对标**: v5.0.3.47
>
> 把 ChainlessChain Android 从"对桌面 skill 数量的弱化追赶"重新定位为 **DID 钱包 + 移动端捕获 + REMOTE 遥控器** 三层模型，对齐 Claude Desktop / Mobile 的二端分工，停止以 skill 数量对标桌面，转向场景独占价值。
>
> v0.4 → v0.5 变更：**两处 v0.4 错分类校准**。(1) §5.5 桌面 `mobile-skill-whitelist.js` + `mobile-approval-channel.js` v0.4 标 ⏳ 新（Phase D 任务）—— 实际已在 `d6b3926fa` (2026-05-11 11:17) 全落地（133 + 150 行实现 + 18 + 11 单测 + `command-router-mobile-bridge.test.js` 集成测试 + `command-router.js` line 38/41/155 gate wire-up）。(2) v0.4 把 `eb7489bc4` 标成「M4 D2 Android ApprovalUI 落地」—— 经核 `AndroidApprovalGate.kt` 在 `com.chainlesschain.android.sign` 包下接 **M5 SignAsService** 流程（`sign.request` → gate → BiometricPrompt → StrongBox → 返桌面），不是 M4 D2 的「Android 接收桌面发起的 marketplace.purchase / cowork.spawnTeam approval-request」。M4 D2 真闭环还差 **Android RPC 接收器**（~0.5d，可复用 `AndroidApprovalGate.requestApproval` + `ApprovalDialogHost` 弹 dialog 机制）。事实声明未再变更。

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

### ADR-7 — 配置文件：cc-mobile.json 独立，不复用桌面 unified-config

**选项**：
- A. Android 直接读桌面 `.chainlesschain/config.json`（同步过来）
- B. Android 端独立 `cc-mobile.json`（assets/ 下，**当前为空**），桌面仅新增 `mobileBridge.*` 字段管理桌面侧策略

**选 B**。理由：
- A 把桌面配置耦合进手机，桌面字段巨多大部分手机无关
- B 关注点分离：mobile 端管"我要怎么用"，桌面端管"我对手机开放什么"
- 当前 `android-app/app/src/main/assets/` 为空，新建无包袱

### ADR-8 — REMOTE skill 注册表来源：开机从桌面拉取 + 缓存

**选项**：
- A. Android 内置 hard-coded REMOTE skill 列表，不可变（接近当前 23 commands 散落状态）
- B. 开机时 `RemoteSkillRegistry` 从桌面拉取动态列表 + 元数据 + 本地缓存

**选 B**。理由：
- A 桌面新增 skill 必须发版 Android，更新链超长；且当前 hardcoded 状态已经造成 commands 与 ui 不可发现
- B 桌面更新即生效，且元数据（描述 / 入参 / 是否需审批）一并下发，UI 可自动渲染

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
| **M4** | 2 天    | L3 RemoteSkillRegistry + 桌面白名单 + ApprovalUI              | ⚠️ 部分（D1 ✅ `df61914ff` / D2 ⚠️：桌面 ✅ `d6b3926fa` + Android M5 helper ✅ `eb7489bc4`，**剩 Android RPC 接收器 + E2E**） | 55 单测（已落 29 桌面 + 4 Android helper）+ 桌面白名单严格生效 + 审批 E2E |
| **M5** | 1 天    | 反向 SignAsService（桌面调手机签名，ADR-6）                   | ✅ `6d482d066` | 14 单测 + E2E 大额 marketplace 通过   |
| **M6** | 1 天    | 性能 / 续航 / 弱网压测，回填 ✅ 实测值                         | ⏳ | 全部 §7.2 目标达标或解释偏差          |
| **M7** | 0.5 天  | 用户文档同步至 docs-site，发版 v1.0；同步更新 README versionName 0.32.0 → v1.0.0 | ⏳ | docs-site 可访问 + CHANGELOG v1.0 + README 修订 |
|        | **共 11 天**（v0.1 是 10 天，M3 +1 天） |                                       | **v1.0 已落 ≈ 8 天有效工**（含 桌面 M4 D2 `d6b3926fa` + Android M5 helper `eb7489bc4` + 29 桌面单测）；**v1.0 剩 ≈ 4 天**（M3 D-voice/D-cam/D-push + D-share/D-loc Manifest 收尾 / **M4 D2 Android RPC 接收器 ~0.5d** + 审批 E2E / M6 性能验收 / M7 发版）；**QRPairing 真落地 ~2.5d 推 v1.1**，与 §8.5 桌面 Mobile Bridge 面板合并 | |

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
- D2: ⚠️ 部分 ApprovalUI 落地分三段：
  - **桌面侧** ✅ `d6b3926fa`：`mobile-skill-whitelist.js` + `mobile-approval-channel.js` + `command-router.js` gate wire-up + 18 + 11 单测 + 集成测试
  - **Android M5 helper** ✅ `eb7489bc4`：`AndroidApprovalGate.kt` 104 + `ApprovalDialogHost.kt` 263 + Hilt DI 23 + 单测 184 + MainActivity +22 —— 但**这套 wire 到 M5 SignAsService**（`sign.request` 流程），不直接接 M4 D2 generic approval-request
  - **Android RPC 接收器** ❌ **剩**：让 Android 从 mobile-bridge 收到桌面发起的 `approval.request` 类 RPC，dispatch 给 `AndroidApprovalGate.requestApproval(payloadDescription, payloadHash)`（payload 用 method+params 序列化 + JCS hash），用户响应 → 反向 RPC 回桌面 `MobileApprovalChannel.resolveApproval()`。~0.5d
  - **E2E** ❌ **剩**：跨端审批 E2E（桌面 → mobile-bridge → Android RPC → AndroidApprovalGate → user → 反向 RPC → 桌面 resolve → command-router continue）。~0.5d

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

## 10. 后续 milestone（v1.1 / v1.2 占位）

### v1.1（+7.5 天，目标 2026-Q3）

- OfflineQueue：桌面离线时 REMOTE 排队 + 恢复回放
- 多设备 N 端 pair（解 §8.2）
- TURN 中继 opt-in（解 §9.1 NAT 穿透）
- Whisper local ASR（解 §9.1 中文识别）
- ResourceType enum 双端对齐（解 §8.4）
- **QRPairing 真落地**（~2.5d，从 v1.0 M2 D4 推下）：(a) `p2pGraph()` 接进 app NavGraph + 加 Settings → "配对桌面" 入口 (b) `PairingViewModel` stub 换实 `RemoteCommandClient.invoke("device.pairing.handleQRCodeScan", ...)` (c) pairing QR scanner 接桌面 `device-pairing-handler.js` 的 `{type:"device-pairing",code,did,expiresAt}` JSON shape (d) 18 单测 + 1 E2E。与 §8.5 桌面 Settings → Mobile Bridge 子面板（Q4 决策）合并实施

### v1.2（目标 2026-Q4）

- Android Auto 入口（车载 Voice Mode + 推送）
- Wear OS 入口（手表 ApprovalUI + 推送）
- m-of-n 多签（手机 + 桌面 U-Key 联签，复用 MTC publisher_signature M-of-N 机制）

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
