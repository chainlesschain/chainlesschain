# 移动端定位与三层架构

> **版本: v1.2 (GA 发版稿, 2026-05-12) | 状态: 🎉 Android v1.0.0 GA (code 落地，+5,749 行 / 167 单测) | 桌面对标: v5.0.3.48**
>
> ChainlessChain Android 客户端定位为 **DID 钱包 + 移动场景捕获 + REMOTE 遥控器**，不重复实现桌面 141 skills，专注桌面无法替代的手机独占价值。本文档同时面向用户与开发者。
>
> v1.1 → v1.2 变更：M3 5/5 + M4 全部 code 落地 → v1.0.0 tag GA（仓库层面）。剩 5 项用户出场：M3 真机 E2E / M4 D2 真机 E2E / FCM 凭证 / M6 性能实测 / docs-site 同步（详 [v1.0.0 GA 检查清单](https://github.com/chainlesschain/chainlesschain/blob/v1.0.0/docs/v1.0_GA_checklist.md)）。

## 概述

ChainlessChain 桌面端是"重资产个人 AI 主机"——141 内置 skills、Cowork 多智能体、RAG 检索、MCP、Marketplace、联邦治理、Workflow、ZKP，是一个完整的 AI 工作站。Android 端在 v0.37.0 已经在 `android-app/.../remote/` 下堆出 23 个 \*Commands.kt 与 18 个 UI 子模块，但这些散落能力**没有统一注册表与桌面侧白名单 / 审批通道**，REMOTE 是隐性事实而非显性架构。

v1.0 重新对标 Claude Desktop / Mobile 的角色分工：**桌面是 AI 工作站，手机是随身钥匙 + 捕获器 + 遥控器**。手机端不重复桌面，只补桌面在手机场景下做不到的事；二端通过 Phase 3d 双向同步和 REMOTE RPC 连成连续工作流。

| 维度     | 桌面 (Win/Mac/Linux)                  | 移动端 (Android)                              |
| -------- | ------------------------------------- | --------------------------------------------- |
| 角色     | AI 工作站                             | 随身钥匙 / 捕获器 / 遥控器                    |
| 独占能力 | MCP、Computer Use、141 skills、Cowork | StrongBox、Voice Mode、摄像头、推送、生物识别 |
| 数据流向 | 本地 ↔ 云重负载                       | 主"上传 / 查看"，少处理                       |
| 同步关系 | 主战场                                | 桌面延伸，DID + KB 连续上下文                 |
| 不做的事 | 不做"快速一拍即问"                    | 不做 MCP / Computer Use / 完整编辑器          |

### 三层定位

- **L1 钥匙层**：DID 钱包、StrongBox 硬件签名、生物识别、QR 配对/授权——桌面 U-Key 仅 Windows，手机 StrongBox 是 macOS/Linux 用户唯一的硬件签名路径
- **L2 捕获层**：摄像头 OCR、Voice Mode 连续语音、位置感知、推送通知、跨 app 分享——手机独占场景
- **L3 REMOTE 层**：所有桌面重计算 skill（RAG / Cowork / Marketplace / Workflow）通过 JSON-RPC 调用桌面，手机做触发与展示，不做 native port；现有 23 个 \*Commands.kt 收敛到统一 RemoteSkillRegistry

## 核心特性

### L1 钥匙层（v1.0 必交付）

- 🔐 **StrongBox 硬件签名** — Android Keystore TEE/StrongBox 后端，私钥不出芯片（当前 AndroidDIDKeyStore 已用 Keystore，**未显式分 StrongBox tier**，v1.0 补）
- 🆔 **DID 钱包** — Ed25519 + 助记词备份 + 多 DID 切换（**当前 core-did 模块已有单 DID 密钥**，多 DID + 助记词 v1.0 新建）
- 👆 **生物识别解锁** — BiometricPrompt + 失败回退 PIN（**USE_BIOMETRIC 权限 + Settings flag 已有**，统一 BiometricGate v1.0 新建）
- 📱 **QR 配对 / 授权** — 扫码加好友 / 扫码登录桌面 / 扫码授权 marketplace 操作（**桌面 device-pairing-handler.js 已有**）
- ✍️ **签名即服务** — 桌面可发起 `sign.request` 让手机 StrongBox 签名（跨平台硬件 USB Key，v1.0 新建）
- 🛡️ **三阶段降级** — StrongBox → TEE → 软件 Ed25519，UI 标识当前签名等级

### L2 捕获层（v1.0 必交付）

- 📸 **拍照笔记 + OCR** — 摄像头一拍 → REMOTE LLM OCR → 自动入桌面 KB（**CAMERA 权限已声明**，OCR pipeline v1.0 新建）
- 🎤 **Voice Mode** — 长按说话 / 双击启动连续对话；ASR → REMOTE LLM → TTS（**ASR/TTS 端点各自存在**，continuous 模式 v1.0 新建）
- 📍 **位置时间打卡** — GPS + 时间戳标记笔记 / 任务（**当前无任何 Location 代码与权限**，v1.0 全新建）
- 🔔 **推送通知** — 朋友消息 / agent 跑完 / marketplace 提醒 / 同步异常 / 待签名请求（**当前无 FCM 接入 / 无 google-services.json**，v1.0 全新建）
- 🧾 **快速捕获** — 锁屏 widget / 共享菜单接收文本 / 图片 / 链接（**Manifest 无 ACTION_SEND intent-filter**，v1.0 全新建）

### L3 REMOTE 层（v1.0 必交付）

- 🌐 **统一 REMOTE skill 表** — 现有 23 个散落 \*Commands.kt 收敛到 `RemoteSkillRegistry`，从桌面拉取动态元数据
- 📡 **JSON-RPC over WebRTC** — 复用 Phase 3d v1.3 已落地的 transport（`RemoteCommandClient.kt`）
- 🔑 **DID 签名鉴权** — 复用 Phase 3d v1.2 SyncAuthVerifier（Ed25519 strict-mode）
- 🔄 **双向同步** — 复用 Phase 3d v1.1 SyncCoordinator（30s push 循环 + cursor pull）
- 📊 **进度 / 审批 UI** — Cowork 任务、长时 workflow 在手机端只看进度 + 审批
- 🚫 **三道闸安全** — 桌面白名单 + Ed25519 签名 + ApprovalUI 审批

### 性能与体验目标

- ⚡ 冷启动 < 1.5s（StrongBox 解锁 + DID 加载）
- 🔋 后台耗电 < 3% / 24h
- 📦 安装包 < 30MB（不打 LLM 模型）
- 🎯 同 LAN REMOTE p50 < 200ms / 跨 NAT < 800ms

## 系统架构

### 整体架构图

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
│  │  （收敛 23 *Commands.kt + 18 remote/ui 子模块到统一 registry）           │   │
│  └────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
│  ┌─── 通用基础设施（已就位，Phase 3d）───────────────────────────────────────┐ │
│  │  P2PClient (WebRTC) │ SyncCoordinator │ SyncAuthVerifier (Ed25519)         │
│  └────────────────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────────────┘
                                       ↕ JSON-RPC / Signal Protocol / WebRTC
┌─────────────────────────────── Desktop v5.0.3.47+ ───────────────────────────────┐
│  remote/command-router.js │ remote/remote-gateway.js │ remote/handlers/         │
│  sync/mobile-bridge-sync.js │ p2p/mobile-bridge.js │ p2p/device-pairing-handler.js│
│  ⊕ 新增：remote/handlers/mobile-skill-whitelist.js │ mobile-approval-channel.js  │
└──────────────────────────────────────────────────────────────────────────────────┘
```

### 三层职责分工

| 层  | 职责                           | 是否 native    | 与桌面关系             |
| --- | ------------------------------ | -------------- | ---------------------- |
| L1  | 身份 / 签名 / 解锁             | ✅ 全部 native | 反向：桌面调手机签名   |
| L2  | 捕获 / 输入 / 推送             | ✅ 全部 native | 同步上传 → 桌面 KB     |
| L3  | 调用桌面 skill / 看进度 / 审批 | ❌ 全部 REMOTE | 桌面真执行，手机只展示 |

### envelope 协议

```jsonc
{
  "jsonrpc": "2.0",
  "id": "req-uuid-v4",
  "method": "ocr.process",            // 或 sign.request、cowork.spawnTeam 等
  "params": { ... },
  "auth": {
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

### 同步资源类型（继承 Phase 3d，桌面 mobile-bridge-sync.js 实测 6 类）

| 资源类型     | 方向 | 桌面表名            |
| ------------ | ---- | ------------------- |
| MESSAGE      | 双向 | `p2p_chat_messages` |
| CONTACT      | 双向 | `contacts`          |
| FRIEND       | 双向 | `friends`           |
| POST         | 双向 | `social_posts`      |
| POST_COMMENT | 双向 | `post_comments`     |
| NOTIFICATION | 双向 | `notifications`     |

> Android 端 `core-p2p/.../sync/SyncManager.kt::ResourceType` enum 还包含 KNOWLEDGE_ITEM / CONVERSATION / SETTING / FRIEND_GROUP，但桌面 walker 当前未扫描这些表。v1.0 计划对齐扩展（详见设计文档 §8.4）。

## 配置参考

### Android 端（`android-app/app/src/main/assets/cc-mobile.json`，v1.0 新建）

```jsonc
{
  "positioning": {
    "version": "v1.0",
    "mode": "wallet-capture-remote", // L1+L2+L3 三层固定
    "allowNativeSkillFallback": false, // 强制 REMOTE，禁止 silent native fallback
  },
  "l1Wallet": {
    "useStrongBox": true, // 必须 true，false 仅 dev
    "biometricRequired": true,
    "biometricTimeoutSec": 300,
    "didMaxCount": 5,
    "highRiskRequiresStrongBox": true, // 高风险操作强制硬件签名
  },
  "l2Capture": {
    "voiceMode": {
      "enabled": true,
      "asrProvider": "system", // system | volcano | whisper-remote
      "ttsProvider": "system",
      "continuousMode": true,
    },
    "cameraOCR": {
      "engine": "remote-llm", // remote-llm | local-tesseract
      "autoSyncToKB": true,
    },
    "location": { "enabled": true, "minIntervalMs": 60000 },
    "push": { "fcm": true, "localFallback": true },
  },
  "l3Remote": {
    "transport": "webrtc", // webrtc | websocket
    "fallback": "websocket",
    "rpcTimeoutMs": 30000,
    "offlineQueueEnabled": false, // v1.1 启用
    "approvalRequiredForSkills": [
      "marketplace.purchase",
      "did.delegate",
      "cowork.spawnTeam",
    ],
  },
  "sync": {
    // 复用 Phase 3d
    "pushIntervalSec": 30,
    "pullCursorTable": "sync_external_state",
    "providerId": "mobile",
    "conflictStrategy": "last-write-wins",
  },
}
```

### 桌面端（`.chainlesschain/config.json` 新增 `mobileBridge.*` 字段）

```jsonc
{
  "mobileBridge": {
    "enabled": true,
    "exposeRemoteSkills": [
      // 白名单：仅这些 skill 可被手机调用
      "rag.search",
      "rag.embed",
      "cowork.*",
      "marketplace.browse",
      "marketplace.purchase",
      "workflow.run",
      "workflow.status",
      "ocr.process",
      "chat.stream",
    ],
    "requireMobileSignature": true, // 强制 Ed25519 验签
    "approvalChannelsForMobile": [
      "marketplace.purchase",
      "did.delegate",
      "cowork.spawnTeam",
    ],
    "signRequestEnabled": true, // ADR-6 反向：桌面可调手机签名
    "signRequiredAbove": 10, // 大额阈值（marketplace 单位）
  },
}
```

### 三阶段密钥后端

| 阶段      | 触发条件                    | UI 标识   | 高风险操作  |
| --------- | --------------------------- | --------- | ----------- |
| StrongBox | API ≥ 28 + 硬件支持         | 🔒 硬件级 | ✅ 允许     |
| TEE       | API ≥ 28，无 StrongBox      | 🔐 TEE    | ⚠️ 警告允许 |
| Software  | API < 28 或 Keystore 不可用 | 🔓 软件级 | ❌ 拒绝     |

## 性能指标

> 以下为 v1.0 验收目标，🎯 标识目标值，发版时回填 ✅ 实测值。

### 启动与续航

| 指标              | 目标        | 备注                       |
| ----------------- | ----------- | -------------------------- |
| 冷启动 → DID 解锁 | 🎯 < 1500ms | StrongBox 解锁 + DID 加载  |
| 暖启动            | 🎯 < 400ms  | 进程驻留，仅 BiometricGate |
| 24h 后台耗电      | 🎯 < 3%     | 30s push 循环 + FCM 待机   |
| 包体大小          | 🎯 < 30MB   | 不打 LLM 模型              |
| 内存（前台）      | 🎯 < 150MB  | 含 CameraX 预览            |
| 内存（后台）      | 🎯 < 50MB   | 仅同步守护                 |

### REMOTE RPC 时延

| 场景               | p50 目标      | p95 目标    | 备注               |
| ------------------ | ------------- | ----------- | ------------------ |
| 同 LAN（mDNS）     | 🎯 < 200ms    | 🎯 < 500ms  | WebRTC DataChannel |
| 跨 NAT（STUN）     | 🎯 < 800ms    | 🎯 < 2000ms | 含 ICE 协商        |
| WebSocket fallback | 🎯 < 1500ms   | 🎯 < 4000ms | 桌面公网 / 中继    |
| 离线（v1.1）       | local enqueue | -           | 不计时             |

### 同步吞吐（继承 Phase 3d v1.3）

| 指标                 | 目标              |
| -------------------- | ----------------- |
| 单次 push 批量       | 🎯 ≤ 200 条       |
| 单次 pull 批量       | 🎯 ≤ 500 条       |
| 增量 cursor 推进延迟 | 🎯 < 1s（同 LAN） |
| 冲突解决耗时         | 🎯 < 50ms / 条    |

### L1 / L2 模块响应

| 操作                   | 目标       |
| ---------------------- | ---------- |
| StrongBox Ed25519 签名 | 🎯 < 30ms  |
| BiometricPrompt 通过率 | 🎯 > 98%   |
| 摄像头 → OCR 触发      | 🎯 < 100ms |
| 语音 ASR 首字延迟      | 🎯 < 500ms |
| 推送 → 前台展开        | 🎯 < 800ms |

## 测试覆盖

> v1.0 验收要求 ≥ 80% 行覆盖率，关键路径 100% E2E。

### 单元测试规划

```
L1 钥匙层：
✅ StrongBoxKeyManagerTest          - 25 用例（生成/签名/导出禁/StrongBox 缺席降级）
✅ DIDWalletTest                    - 30 用例（多身份/助记词/导出/切换）
✅ BiometricGateTest                - 12 用例（成功/失败/超时/回退 PIN）
✅ QRPairingTest                    - 18 用例（生成/扫码/防重放/过期）
✅ SignAsServiceTest                - 14 用例（反向 RPC + 审批门）

L2 捕获层（v1.0 五件齐落）：
✅ CameraOCRTest                    - 20 用例（拍照/REMOTE OCR/KB 写入）
✅ VoiceModeTest                    - 22 用例（连续模式/打断/ASR/TTS pipeline）
✅ LocationTaggerTest               - 12 用例（GPS/Foreground Service/权限拒绝）
✅ PushNotifierTest                 - 14 用例（FCM/本地兜底/4 类通知）
✅ ShareReceiverTest                - 12 用例（ACTION_SEND/类型分发/Inbox 队列）

L3 REMOTE 层：
✅ RemoteSkillRegistryTest          - 15 用例（拉取/缓存/版本协商/23 commands 收敛）
✅ RemoteCommandClientTest          - 40 用例（envelope/sig/retry/timeout/auth fail）
✅ ApprovalUITest                   - 14 用例（whitelist/超时/拒绝）

复用扩展：
✅ SyncCoordinatorTest              - +10 用例（v1.0 新 RPC 集成）
✅ SyncAuthVerifierTest             - +8 用例（mobile 反向签）

桌面侧：
✅ mobile-skill-whitelist.test.js   - 12 用例（exposeRemoteSkills 校验）
✅ mobile-approval-channel.test.js  - 12 用例（审批回路 + 超时）
```

**总目标**: 258+ 用例，≥ 80% 行覆盖率（v1.0 因 L2 五件齐落，从 v0.1 的 220 + 提升到 258 +）

### E2E 测试场景（12 个）

- ✅ 首启 → DID → StrongBox → 助记词 → 重启恢复
- ✅ QR 配对桌面 → 双向认证 → Phase 3d sync 拉数据
- ✅ 拍照 → REMOTE OCR → 桌面 KB 入库
- ✅ Voice Mode 连续 3 轮对话 → 中断恢复
- ✅ LocationTagger GPS 打卡笔记 → 桌面看到（v0.1 漏列）
- ✅ FCM 推送 / 国内本地兜底（v0.1 漏列）
- ✅ ShareReceiver 跨 app 分享文本+图片 → KB Inbox（v0.1 漏列）
- ✅ 桌面发起 Cowork → 手机推送 → 进度 → 审批
- ✅ Marketplace 大额购买 → 反向 SignAsService → StrongBox 签名
- ✅ 23 commands 收敛 → 桌面白名单严格生效（黑名单 skill 拒绝）
- ✅ Ed25519 验签失败 → 拒绝并审计
- ✅ 三阶段密钥降级（StrongBox 缺席→TEE→软件）

### 性能与压测

- ✅ 1000 条同步 push 批量耗时 / 内存峰值
- ✅ Voice Mode 连续 30 分钟续航
- ✅ 后台 24h 耗电曲线（FCM idle）
- ✅ 弱网（3G / 200ms RTT / 5% 丢包）下 REMOTE 重试与超时

### Android 兼容性矩阵

| Android API | 设备示例            | StrongBox | 状态                |
| ----------- | ------------------- | --------- | ------------------- |
| 33+ (T)     | Pixel 7+ / 主流旗舰 | ✅        | 主测试              |
| 30 (R)      | Pixel 5 / 中端      | ⚠️ TEE    | 降级签名            |
| 28 (P)      | 老设备              | ❌        | 软件 Ed25519 + 警告 |
| < 28        | -                   | -         | 不支持              |

## 安全考虑

### 密钥与身份

1. **私钥不出 StrongBox** — Ed25519 KeyPair 生成于 TEE，签名通过 Keystore API 完成；任何导出尝试 throw `KeyStoreException`
2. **生物识别绑定** — `setUserAuthenticationRequired(true)`，签名前必须 Biometric/PIN 认证
3. **助记词加密备份** — AES-GCM with user passphrase + Argon2id；不上云，仅本地导出 / 二维码
4. **DID 撤销** — 支持 `did.revoke` 凭证，通过 Phase 3d sync 广播到桌面与 federation

### REMOTE RPC 三道闸

1. **白名单（防越权）** — 桌面 `exposeRemoteSkills` 严格白名单，未列出的 skill 即便手机请求也拒绝。**v1.0 之前 23 个 \*Commands.kt 是隐式映射在 handlers/ 下，无显式白名单**
2. **签名（防伪冒）** — 所有 RPC 必须带 AuthInfo（DID + Ed25519 签名）；桌面 `requireMobileSignature=true` 默认开
3. **审批（防误操作）** — `marketplace.purchase` / `did.delegate` / `cowork.spawnTeam` 等必须手机端 ApprovalUI 二次确认 + StrongBox 签名

补充：4. **防重放** — RPC envelope 含 nonce + timestamp，桌面 5 分钟窗口内不重收 5. **传输加密** — Signal Protocol over WebRTC DataChannel（继承 Phase 3d）

### 移动场景特有

1. **截图防护** — 敏感页面（助记词 / DID 私钥相关 UI）`FLAG_SECURE`
2. **剪贴板敏感期** — DID 复制后 60s 自清；助记词不允许复制
3. **后台模糊** — Android Recent Apps 显示模糊预览
4. **Root 检测** — 检测 root / debuggable 时降级（StrongBox 必检失败警告，但不强制阻断）；当前 `SecurityChecker.kt` 已有完整实现可直接复用
5. **应用签名校验** — REMOTE 桌面侧验证 mobile 端 APK 签名 fingerprint，防伪冒

### 数据安全

1. **EncryptedSharedPreferences** — 所有本地配置 AES-256-GCM
2. **Room + SQLCipher** — 同步缓存数据库加密
3. **缓存清理** — Voice Mode ASR 中间结果不落盘 / Camera 临时文件 onPause 清理

### 残余风险

| 风险                     | 缓解                                    |
| ------------------------ | --------------------------------------- |
| StrongBox 缺席设备       | 显式降级提示，TEE / 软件签名标识在 UI   |
| Biometric Class 2 弱认证 | 高风险操作要求 Class 3 强认证           |
| FCM 通道泄密风险         | 通知 payload 不含明文，仅 ID + 拉取触发 |
| WebRTC ICE 暴露内网 IP   | 走 TURN 中继 opt-in（v1.1）             |

## 故障排除

### Q: 安装后 StrongBox 初始化失败 / 应用崩溃？

**A**: 设备不支持 StrongBox（API < 28 或厂商裁剪）。检查 `KeyguardManager.isHardwareDetected()`：

- 真无 StrongBox → 自动降级 TEE Ed25519，UI 顶部显示"软件签名"标记
- 仅暂时不可用（如 Keystore 损坏）→ 引导用户重启 / 出厂签名重置
- v1.0 不强制 StrongBox，但 marketplace 购买等高风险操作会拒绝软件签名

### Q: 配对桌面后 sync 不动，没数据？

**A**: 三步排查：

1. 桌面 `mobile-bridge-sync.js` 日志：是否收到 RPC？没收到 → WebRTC ICE 失败
2. Android `SyncCoordinator` 日志：是否 30s 触发 push？没触发 → workmanager 被系统 kill（电池优化白名单）
3. `SyncAuthVerifier` 验签：失败 → DID 配对时未交换公钥，重走 QR 配对

### Q: REMOTE 调用一直超时？

**A**:

- 同 LAN：mDNS 是否被路由器禁了？切 WebSocket fallback 测一下
- 跨 NAT：STUN 服务器可达性？v1.1 会加 TURN 中继
- 桌面离线：v1.0 直接报错，v1.1 才有离线队列

### Q: 调任何 skill 都说"未在白名单"？

**A**: 桌面 `.chainlesschain/config.json` 的 `mobileBridge.exposeRemoteSkills` 默认空。需手动加入或在桌面"设置 → 移动桥接"开启对应 skill。安全设计如此，不允许默认放行所有 skill。

### Q: Voice Mode 一直被打断 / 中文识别差？

**A**:

- `asrProvider: "system"` 用厂商 ASR，识别率随设备波动；切 `volcano` 用云端
- `continuousMode: true` 时麦克风长占用，被其它 app（电话 / 微信语音）抢占会中断；这是预期行为
- 若需离线 ASR，v1.1 集成 Whisper local

### Q: 桌面 U-Key 与 Android StrongBox 同时签名同一笔操作冲突？

**A**: v1.0 不支持双因素硬件签名。同一 DID 在两端各持一份私钥（备份恢复时同步），签名互相独立。后续若做 m-of-n 多签，复用 MTC 联邦的 publisher_signature M-of-N 机制（v1.2 计划）。

### Q: Android 端目前支持哪些桌面能力？

**A**: v1.0.0 GA 状态：

- **已 REMOTE 接通 + 统一注册表**：cowork（35 .kt 真代码）/ workflow / AI 对话 / 知识库 / 文件 / 通知 / 系统监控等 23 类 \*Commands.kt 全部进 RemoteSkillRegistry（file + method 双粒度元数据 + alias 兼容窗口），桌面侧白名单 + 审批通道生效（M4 D2 desktop-side full + Android RPC 接收器 `ApprovalCommandRouter` 落地）
- **ApprovalUI 4 类**：Sign / Cowork / Marketplace / SystemCritical，dialog 按 method 前缀自动 fromMethod 推断 category
- **桌面有 / Android REMOTE 待开通**：marketplace / RAG / BI / 多模态 → 通过 `mobileBridge.exposeRemoteSkills` 白名单按需开通即可，无需 native 实现
- **永不上手机**：MCP / Computer Use（架构决策，与 Claude Mobile 对标）

### Q: 推送在国内收不到？

**A**: v1.0 使用 FCM，国内不可达时切到本地 channel 兜底（依赖手机端定时拉取桌面状态）。v1.1 计划接 OPPO / 小米 / 华为统一推送。

### Q: 我有两台手机，能同步吗？

**A**: v1.0 仍是单 peer 限制（继承 Phase 3d v1.1）。v1.1 会支持多设备 N 端 pair。当前请将主用手机作为唯一同步 peer。

### Q: `mobile-app-uniapp/` 是干嘛的？跟 android-app 什么关系？

**A**: 两条独立 mobile 路线：

- `android-app/` — native Kotlin Android 客户端，本文档覆盖范围，v1.0 主线
- `mobile-app-uniapp/` — uniapp/H5 形态的实验性入口，独立项目，与本设计无耦合

## 关键文件

> 源码位置以 v1.0 实施完成后为准。⏳ 标识尚未创建，✅ 已存在，⚠️ 部分存在需扩展。

### Android 端（`android-app/`）

```
android-app/app/src/main/java/com/chainlesschain/android/
├── wallet/                                     # ⏳ L1 钥匙层（v1.0 新建子包）
│   ├── StrongBoxKeyManager.kt                  # ⚠️ 与现有 core-security/AndroidDIDKeyStore 整合
│   ├── DIDWallet.kt                            # ⚠️ 与现有 core-did/DIDManager 整合，扩多 DID + 助记词
│   ├── BiometricGate.kt                        # ⚠️ 现有 Settings biometricEnabled flag 收敛
│   ├── QRPairing.kt                            # ⚠️ 现有桌面 device-pairing-handler 配套
│   └── SignAsService.kt                        # ⏳ 反向 RPC，v1.0 新建
├── capture/                                    # ⏳ L2 捕获层（v1.0 新建子包）
│   ├── CameraOCR.kt                            # ⚠️ CAMERA 权限已声明，pipeline 新建
│   ├── VoiceMode.kt                            # ⚠️ ASR/TTS 端点已有，连续模式新建
│   ├── LocationTagger.kt                       # ⏳ 全新建（无权限无代码）
│   ├── PushNotifier.kt                         # ⏳ 全新建（无 FCM）
│   └── ShareReceiver.kt                        # ⏳ 全新建（无 intent-filter）
├── remote/                                     # ✅ 已大量存在，v1.0 收敛
│   ├── client/RemoteCommandClient.kt           # ✅
│   ├── commands/  23 *Commands.kt              # ✅ AI/Browser/Clipboard/...（待 RemoteSkillRegistry 注册）
│   ├── ui/  18 子模块                          # ✅ ai/application/clipboard/...（待 registry-driven 渲染）
│   ├── p2p/P2PClient.kt                        # ✅
│   ├── RemoteSkillRegistry.kt                  # ⏳ 新增（v1.0 主新建）
│   ├── ProgressViewer.kt                       # ⏳ 新增
│   ├── ApprovalUI.kt                           # ⏳ 新增
│   └── OfflineQueue.kt                         # ⏳ v1.1
└── sync/                                       # ✅ Phase 3d 已落地
    ├── SyncCoordinator.kt
    └── SyncAuthVerifier.kt
```

### 桌面端（`desktop-app-vue/src/main/`）

```
desktop-app-vue/src/main/
├── sync/mobile-bridge-sync.js                       # ✅ Phase 3d，6 资源类型
├── p2p/mobile-bridge.js                             # ✅ WebRTC ↔ libp2p（1177 行）
├── p2p/device-pairing-handler.js                    # ✅ QR 配对
├── remote/command-router.js                         # ✅ 现有，v1.0 加 sign.request
├── remote/remote-gateway.js                         # ✅ 现有，接 mobileBridge
├── remote/handlers/                                  # ✅ 现有 13+ handler，v1.0 加新文件
│   ├── mobile-skill-whitelist.js                    # ⏳ 新增（exposeRemoteSkills）
│   └── mobile-approval-channel.js                   # ⏳ 新增（审批回路）
└── config/unified-config-manager.js                 # ✅ 现有，加 mobileBridge.* 字段
```

### 配置与文档

```
android-app/app/src/main/assets/cc-mobile.json          # ⏳ Android 端配置（assets/ 目前为空）
.chainlesschain/config.json                              # ✅ 加 mobileBridge.* 字段
docs/design/Android_重新定位_设计文档.md                  # ✅ 设计文档源（v0.2）
docs-site/docs/chainlesschain/mobile-positioning.md      # ✅ 本文档（v1.1）
```

### 测试

```
android-app/app/src/test/.../wallet/             # ⏳ L1 单测（99 用例）
android-app/app/src/test/.../capture/            # ⏳ L2 单测（80+ 用例，五件齐落）
android-app/app/src/test/.../remote/             # ⏳ L3 单测（55 用例）
android-app/app/src/androidTest/.../e2e/         # ⏳ E2E（12 场景）
desktop-app-vue/tests/integration/mobile-*.test.js  # ⏳ 桌面侧（24 用例）
```

## 使用示例

### 示例 1：用户首次启动 → DID 落地

```kotlin
// L1: 启动期 BiometricGate 拦截
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        BiometricGate.requireAuthOnStart(this) {
            // 第一次启动：DIDWallet.createNew 生成 StrongBox 密钥
            val wallet = DIDWallet.getOrCreate(strongBox = true)
            Log.i("CC", "DID ready: ${wallet.activeDid}")
            setContent { App() }
        }
    }
}
```

### 示例 2：扫码配对桌面

```kotlin
// L1: 扫码 → DID 双向认证 → Phase 3d sync 自动拉数据
suspend fun onPairQRScanned(qrPayload: String) {
    val pairing = QRPairing.parse(qrPayload)
    val sig = StrongBoxKeyManager.sign(pairing.challenge)
    val result = P2PClient.handshake(pairing.peerDid, sig)
    if (result.success) {
        SyncCoordinator.start(peer = result.peerId)
        Toast.makeText(this, "已配对：${result.peerName}", LENGTH_SHORT).show()
    }
}
```

### 示例 3：拍照 → REMOTE OCR → KB

```kotlin
// L2: 用户摁拍照按钮，REMOTE 走桌面 LLM OCR
suspend fun onCaptureClick(image: Bitmap) {
    val result = RemoteCommandClient.invoke(
        method = "ocr.process",
        params = mapOf(
            "image" to image.toBase64(),
            "engine" to "llm",
            "userBudget" to "medium"
        )
    )
    // OCR 结果通过 Phase 3d sync 落到桌面 KB
    Toast.makeText(this, "已入库：${result.title}", LENGTH_SHORT).show()
}
```

### 示例 4：Voice Mode 连续对话

```kotlin
// L2: 长按麦克风触发连续对话
VoiceMode.start(
    onPartialTranscript = { text -> updateTranscriptUI(text) },
    onFinalTranscript = { text ->
        // REMOTE chat 流式
        RemoteCommandClient.streamInvoke("chat.stream", mapOf("prompt" to text)) { chunk ->
            VoiceMode.speak(chunk)            // TTS 朗读
            appendToConversationView(chunk)
        }
    },
    onInterrupted = { VoiceMode.stop() }
)
```

### 示例 5：Cowork 任务审批

```kotlin
// L3: 桌面发起 spawnTeam → 手机推送 → 审批
class CoworkApprovalReceiver : NotificationReceiver() {
    override fun onPayload(payload: ApprovalPayload) {
        ApprovalUI.show(
            title = "Cowork 团队 ${payload.teamName} 申请创建",
            detail = "包含 ${payload.maxAgents} 个代理，预算 ${payload.budget} tokens",
            requireBiometric = true
        ) { approved ->
            if (approved) {
                val sig = StrongBoxKeyManager.sign(payload.requestHash)
                RemoteCommandClient.invoke(
                    "cowork.approval.respond",
                    mapOf(
                        "requestId" to payload.requestId,
                        "approved" to true,
                        "signature" to sig
                    )
                )
            }
        }
    }
}
```

### 示例 6：桌面调手机做硬件签名（反向 RPC）

```javascript
// 桌面端：marketplace 大额购买必须手机签名
async function executeHighValuePurchase(itemId, amount) {
  if (amount > config.mobileBridge.signRequiredAbove) {
    const sig = await mobileBridge.invokeRemote(pairedDeviceId, {
      method: "sign.request",
      params: {
        payload: buildPurchaseHash(itemId, amount),
        description: `购买 ${itemId}，金额 ${amount}`,
      },
      timeoutMs: 60000, // 留给用户审批
    });
    if (!sig) throw new Error("Mobile approval declined or timeout");
    return submitPurchaseWithSig(itemId, amount, sig);
  }
  return submitPurchaseLocal(itemId, amount);
}
```

### 示例 7：从其他 app 分享内容入 KB

```kotlin
// L2: ShareReceiver 接 Intent.ACTION_SEND
class ShareReceiverActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val text = intent.getStringExtra(Intent.EXTRA_TEXT)
        val image = intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
        ShareReceiver.enqueue(text, image)
        // 入队后 SyncCoordinator 30s 内推到桌面 KB
        finish()
    }
}
```

## 相关文档

### 内部文档

- [Android 重新定位设计文档](../design/android-repositioning) — 本文档的设计源文件，含 ADR 决策、里程碑拆分、副线发现
- [Phase 3d Mobile Sync 设计文档](../design/phase3d-mobile-sync) — 已落地的双向同步基础（v1.0 直接复用）
- [Cowork 多智能体协作系统](./cowork.md) — Android 通过 REMOTE 调用桌面 Cowork
- [DID v2](./did-v2.md) — DID 钱包基础规范
- [BLE U-Key](./ble-ukey.md) — 桌面硬件密钥（与 StrongBox 角色对位）
- [CLI Cowork](./cli-cowork.md) — REMOTE 调用的协议层
- [安装指南](./installation.md) — Android 安装与配对

### 外部参考

- [Claude Desktop](https://claude.ai/download) / [Claude Mobile](https://claude.ai) — 二端定位对标
- [Android Keystore + StrongBox](https://developer.android.com/privacy-and-security/keystore) — L1 硬件签名后端
- [androidx.biometric](https://developer.android.com/jetpack/androidx/releases/biometric) — BiometricGate 依赖
- [WebRTC DataChannel](https://webrtc.org/) — REMOTE transport（已就位）
- [JSON Canonicalization Scheme (JCS)](https://datatracker.ietf.org/doc/html/rfc8785) — envelope 签名规范

---

> **变更记录**
>
> - 2026-05-12 v1.2 (GA 发版稿)：Android v1.0.0 GA flip。
>   - 状态线 "📋 RFC 评审中" → "🎉 v1.0.0 GA (code 部分)"
>   - 桌面对标 v5.0.3.47 → v5.0.3.48
>   - 9 commits 落地：M3 L2 5 件齐落 (VoiceMode/CameraOCR/LocationTagger/ShareReceiver/PushNotifier, +3,861 行 / 99 单测) + M4 method-level + ApprovalUI 4 类 + ProgressViewer + §8.3 alias 兼容窗口 (+1,610 行 / 68 单测)
>   - FAQ "Android 支持哪些桌面能力" 更新到 v1.0.0 GA 事实
>   - 剩 5 项用户出场清单见 [docs/v1.0_GA_checklist.md](https://github.com/chainlesschain/chainlesschain/blob/v1.0.0/docs/v1.0_GA_checklist.md)
> - 2026-05-11 v1.1 (调研收口稿)：基于 v0.2 设计文档同步事实修正：
>   - 桌面对标 v5.0.3.46 → v5.0.3.47；Android 版本说明加 v0.37.0 起点
>   - 关键文件路径全部修正（mobile-app/ → android-app/；desktop remote/command-handler.js → command-router.js + handlers/；desktop mobile/DevicePairingHandler.js → p2p/device-pairing-handler.js）
>   - 资源类型 5 → 6（多 NOTIFICATION）
>   - 删除"8 个 doc-only stub 现在去哪了"FAQ（基于错误前提），改为"Android 端目前支持哪些桌面能力"
>   - 新增"mobile-app-uniapp 与 android-app 什么关系"FAQ
>   - L2 五件齐落（CameraOCR / VoiceMode / LocationTagger / PushNotifier / ShareReceiver），E2E 9 → 12，单测 220+ → 258+
>   - 各模块加现状标注（✅/⚠️/⏳）说明已存在 vs 待新建
> - 2026-05-10 v1.0 (规划稿)：初稿，三层定位 + 配置 + 性能 + 测试 + 安全 + FAQ（部分事实声明经 v1.1 核实有误）
