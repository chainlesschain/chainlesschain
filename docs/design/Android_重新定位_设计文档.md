# Android 客户端重新定位设计文档

> **版本**: v0.1 (规划稿, 2026-05-10) | **状态**: 📋 RFC 评审中 | **关联**: Android v0.32.0 → v1.0.0 | **桌面对标**: v5.0.3.46
>
> 把 ChainlessChain Android 从"桌面 139 skills 的弱化子集"重新定位为 **DID 钱包 + 移动端捕获 + REMOTE 遥控器** 三层模型，对齐 Claude Desktop / Mobile 的二端分工，停止以 skill 数量对标桌面，转向场景独占价值。

## 1. 背景与立项动机

### 1.1 当前问题

ChainlessChain 桌面端是"重资产个人 AI 主机"——139 内置 skills、Cowork 多智能体、RAG / 向量检索、MCP、Marketplace、联邦治理、Workflow、ZKP，典型久坐工作站形态。Android 端当前 28 skills（12 Kotlin handler + 8 doc-only stub + 8 REMOTE）的对标方式有三个结构性问题：

1. **doc-only stub 长期悬置（>1 年）** — 8 个 stub（trading / cowork / BI / workflow 等）无 Kotlin 代码，对用户和维护者都是噪声；既不删也不补的暧昧态。
2. **路线模糊** — "Android 还差 111 个 skill" 是错误的对标方式：手机屏幕、拇指交互、续航限制让 80%+ 桌面 skill 不适合 native port。继续 port 是反 ROI。
3. **场景独占价值未挖掘** — 摄像头、麦克风、生物识别、StrongBox、推送通知、随身性是手机独占能力，桌面无法替代；当前架构里这些是"边角料"。

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
- v0.32.0 后 Android 路线无明确大版本目标
- v1.0.0 GA 在即，需在 GA 前明确定位语义

## 2. 现状速览（基于 2026-05-09 代码核实）

### 2.1 Android 端能力盘点

```
android-app/app/src/main/java/com/chainlesschain/android/
├── 已有真代码（12 native handlers）
│   ├── 知识库：Note CRUD / 搜索（无 RAG / 向量）
│   ├── AI 聊天：Ollama / 火山豆包 / OpenAI 三 provider，token 追踪
│   ├── DID：管理 / QR 加好友 / 查看
│   ├── 项目：列表 / 详情 / 文件浏览 / 步骤管理
│   ├── 同步：SyncCoordinator + SyncAuthVerifier（Phase 3d v1.1+v1.2）
│   ├── 语音：ASR + TTS（已有，未做 continuous Voice Mode）
│   ├── 设置：生物识别 / i18n / auto-update / splash
│   └── 安全：DID auth / 权限 / U-Key placeholder
├── 8 个 doc-only stub（无 Kotlin，仅文档存在）
│   └── trading / marketplace / cowork / BI / workflow / 多模态 / agent federation / 自治 agent
└── 8 个 REMOTE skills（RemoteCommandClient 转发桌面）
    └── screenshot / system status / AI chat / notification / 4 个 TBD
```

### 2.2 已落地的基础设施（v1.0 直接复用）

| 模块                           | 位置                                               | 状态                             |
| ------------------------------ | -------------------------------------------------- | -------------------------------- |
| WebRTC DataChannel             | `android-app/.../P2PClient.kt`                     | ✅ Phase 3d v1.3                  |
| JSON-RPC envelope              | `android-app/.../remote/RemoteCommandClient.kt`    | ✅ 已有，需扩展                   |
| Ed25519 验签                   | `android-app/.../sync/SyncAuthVerifier.kt`         | ✅ Phase 3d v1.2 strict-mode      |
| 30s push 循环                  | `android-app/.../sync/SyncCoordinator.kt`          | ✅ Phase 3d v1.1                  |
| 5 资源类型双向同步             | `desktop/.../sync/mobile-bridge-sync.js`           | ✅ 5 类型：MSG/CONTACT/FRIEND/POST/COMMENT |
| QR 配对                        | `desktop/.../mobile/DevicePairingHandler.js`       | ✅ Phase 3d                       |
| Signal Protocol E2EE           | `android-app/.../signal/`                          | ✅ 已有                           |

### 2.3 桌面端能力索引（不是 v1.0 重做对象，仅作 REMOTE 调用对象）

| 类别              | 桌面位置                                          | Android 关系       |
| ----------------- | ------------------------------------------------- | ------------------ |
| Skills System     | `desktop/.../ai-engine/cowork/skills/` (138)      | REMOTE 调用对象    |
| RAG / 向量检索    | `desktop/.../rag/`                                | REMOTE             |
| Cowork 多智能体   | `desktop/.../ai-engine/cowork/`                   | REMOTE + 审批 UI   |
| Marketplace       | `desktop/.../marketplace/`                        | REMOTE + 审批 UI   |
| MCP               | `desktop/.../mcp/`                                | **永不上手机**     |
| Computer Use      | `desktop/.../browser/computer-use/`               | **永不上手机**     |
| Workflow          | `desktop/.../workflow/`                           | REMOTE 触发 + 进度 |

## 3. 目标与非目标

### 3.1 v1.0 目标

- **G1** 三层定位（L1 钥匙 / L2 捕获 / L3 REMOTE）落地，文档与代码一致
- **G2** L1 StrongBox 硬件签名替代 U-Key placeholder，覆盖 macOS/Linux 用户的硬件签名洞
- **G3** L2 Voice Mode 连续语音 + Camera OCR 拍照入 KB 两个 mobile-first 体验上线
- **G4** L3 RemoteSkillRegistry 统一所有桌面 skill 调用入口，桌面侧白名单 + 审批通道生效
- **G5** 8 个 doc-only stub 处置完毕（删 / 转 REMOTE）
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
| StrongBox 硬件密钥      | ✅   | 必交付                              |
| Voice Mode + Camera OCR | ✅   | 必交付                              |
| 8 stub 处置             | ✅   | 必交付（删 / 转 REMOTE）            |
| 多设备 pair             | ❌   | v1.1                                |
| 离线消息队列            | ❌   | v1.1                                |
| MCP / Computer Use      | ❌   | 永不做                              |
| Native marketplace UI   | ❌   | 永不做（REMOTE 浏览 OK）            |

## 4. 决策（ADR-1 ~ ADR-8）

### ADR-1 — 三层定位结构：L1 Wallet / L2 Capture / L3 REMOTE

**选项**：
- A. 维持 28 skills 等概念，按 skill 数量继续追桌面
- B. 三层定位（钥匙 / 捕获 / 遥控器），按场景而非 skill 划分
- C. 完全脱离桌面叙事，做独立 mobile 应用

**选 B**。理由：
- A 是当前问题本体，doc-only stub 反复证明该路线不可持续
- C 与桌面同步、共享 DID、共享 KB 的核心价值矛盾
- B 与 Claude Desktop/Mobile 已被市场验证的角色分工对齐
- B 让"REMOTE 即一等公民"从隐性变成显性架构

### ADR-2 — L1 密钥后端：StrongBox 优先 + TEE 降级 + 软件 Ed25519 三阶段

**选项**：
- A. 仅 StrongBox（API ≥ 28 + 硬件支持），不支持设备返回错误
- B. StrongBox 优先 → TEE 降级 → 软件 Ed25519 三阶段
- C. 始终软件 Ed25519，不用硬件后端

**选 B**。理由：
- A 排斥大量中端 / 老设备
- C 放弃手机的硬件签名独占价值
- B 通过 UI 标记签名等级（StrongBox / TEE / 软件）让用户和桌面侧都能看到，对高风险操作（marketplace 大额）可单独要求 StrongBox

### ADR-3 — REMOTE 调用：白名单 + DID 签名 + 审批通道，三道闸

**选项**：
- A. 桌面默认放行所有 skill，手机请就给
- B. 桌面白名单（exposeRemoteSkills），手机调用必带 Ed25519 签名，高风险操作走 ApprovalUI
- C. 黑名单制

**选 B**。理由：
- A 与"桌面是 AI 主机"语义相反，攻击面爆炸
- C 加新 skill 时容易漏防，反方向错误
- B 三道闸：白名单（防越权）→ 签名（防伪冒）→ 审批（防大额误操作）

### ADR-4 — Voice Mode：完全 REMOTE chat + 系统/云端 ASR + 系统 TTS

**选项**：
- A. 本地小模型 ASR + 本地 LLM
- B. REMOTE LLM + 系统 ASR/TTS（默认）+ 云端 ASR opt-in
- C. 全云端（ASR + LLM + TTS 都走云）

**选 B**。理由：
- A 包体 / 续航灾难，且体验追不上桌面 LLM
- C 系统 ASR/TTS 已够用且零成本零延迟
- B 兼顾默认低成本与高质量 opt-in（火山豆包 / Whisper local v1.1）

### ADR-5 — 8 个 doc-only stub 处置：4 转 REMOTE / 2 归并 / 2 删

| Stub                | 处置        | 理由                                |
| ------------------- | ----------- | ----------------------------------- |
| trading             | 转 REMOTE   | 桌面 marketplace 已实现             |
| marketplace         | 转 REMOTE   | 同上                                |
| cowork              | 转 REMOTE   | 桌面 Cowork 95 skills 已生产就绪    |
| BI                  | 转 REMOTE   | 桌面 BI Engine 已落地               |
| workflow            | 归并到 cli-workflow | 不单独做 mobile UI            |
| 多模态              | 归并到 cli-multimodal | 同上                          |
| agent federation    | 删除        | 联邦发现是基础设施，非用户面 skill  |
| 自治 agent runner   | 删除        | 桌面后台跑，手机无入口需求          |

### ADR-6 — 反向 RPC（桌面调手机做硬件签名）：v1.0 必做

**选项**：
- A. v1.0 仅 Android → Desktop 单向，桌面想签名走自己的 U-Key
- B. v1.0 加反向通道，桌面可发起 `sign.request` 让手机 StrongBox 签名

**选 B**。理由：
- A 让 macOS/Linux 用户没有硬件签名路径（U-Key 仅 Windows）
- B 把手机变成"跨平台硬件 USB Key"，是定位的核心价值之一
- 实现成本不高：transport 已有，加 RPC method + ApprovalUI 即可

### ADR-7 — 配置文件：cc-mobile.json 独立，不复用桌面 unified-config

**选项**：
- A. Android 直接读桌面 `.chainlesschain/config.json`（同步过来）
- B. Android 端独立 `cc-mobile.json`，桌面仅新增 `mobileBridge.*` 字段管理桌面侧策略

**选 B**。理由：
- A 把桌面配置耦合进手机，桌面字段巨多大部分手机无关
- B 关注点分离：mobile 端管"我要怎么用"，桌面端管"我对手机开放什么"

### ADR-8 — REMOTE skill 注册表来源：开机从桌面拉取 + 缓存

**选项**：
- A. Android 内置 hard-coded REMOTE skill 列表，不可变
- B. 开机时 `RemoteSkillRegistry` 从桌面拉取动态列表 + 元数据 + 本地缓存

**选 B**。理由：
- A 桌面新增 skill 必须发版 Android，更新链超长
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
│  └────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
│  ┌─── 通用基础设施（已就位）────────────────────────────────────────────────┐ │
│  │  P2PClient (WebRTC) │ SyncCoordinator (Phase 3d) │ SyncAuthVerifier (Ed25519) │
│  └────────────────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────────────┘
                                       ↕ JSON-RPC / Signal Protocol / WebRTC
┌─────────────────────────────── Desktop v5.0.3.46+ ───────────────────────────────┐
│  remote/command-handler.js │ mobile-bridge-sync.js │ 139 skills │ Cowork │ RAG  │
│  ⊕ 新增：mobile-skill-whitelist.js │ mobile-approval-channel.js                 │
└──────────────────────────────────────────────────────────────────────────────────┘
```

### 5.2 L1 钥匙层模块

| 模块                  | 职责                                        | 后端                                | 单测目标 |
| --------------------- | ------------------------------------------- | ----------------------------------- | -------- |
| `StrongBoxKeyManager` | Ed25519 密钥生成 / 签名，私钥不出 TEE       | Android Keystore + StrongBox        | 25       |
| `DIDWallet`           | DID 文档构建 / 多身份切换 / 助记词备份导入  | StrongBoxKeyManager + EncryptedFile | 30       |
| `BiometricGate`       | 解锁前置门，敏感操作二次确认                | androidx.biometric                  | 12       |
| `QRPairing`           | 扫码生成 P2P 配对码 / 扫码登录授权          | ZXing + DevicePairingHandler        | 18       |
| `SignAsService`       | 暴露 `sign.request` REMOTE 给桌面调用       | RemoteCommandClient 反向通道        | 14       |

### 5.3 L2 捕获层模块

| 模块             | 职责                                     | 同步方向                       |
| ---------------- | ---------------------------------------- | ------------------------------ |
| `CameraOCR`      | CameraX → 截图 → REMOTE LLM OCR → KB     | Android → Desktop (sync.push)  |
| `VoiceMode`      | 长按麦克风 → ASR → REMOTE chat → TTS     | 双向 RPC                       |
| `LocationTagger` | GPS + 时间戳附加到笔记 / DID 凭证        | Android → Desktop (sync.push)  |
| `PushNotifier`   | FCM + 本地 channel，4 类通知             | Desktop → Android (推送)       |
| `ShareReceiver`  | Intent.ACTION_SEND 接收，落 Inbox        | local → 队列 → sync.push       |

### 5.4 L3 REMOTE 层模块

| 模块                  | 职责                                                    |
| --------------------- | ------------------------------------------------------- |
| `RemoteSkillRegistry` | 维护可远程调用的 skill 清单 + 元数据，开机从桌面拉取    |
| `RemoteCommandClient` | JSON-RPC envelope，requestId 关联，AuthInfo Ed25519 签名 |
| `ProgressViewer`      | 长时任务进度面板（订阅 Desktop 事件流）                 |
| `ApprovalUI`          | Cowork 投票 / Marketplace 大额支付 / 关键操作审批       |
| `OfflineQueue` (v1.1) | 桌面离线时本地排队，恢复后批量回放                      |

### 5.5 桌面端新增 / 改造

| 文件                                          | 状态 | 职责                                  |
| --------------------------------------------- | ---- | ------------------------------------- |
| `desktop/.../remote/mobile-skill-whitelist.js`| ⏳ 新 | exposeRemoteSkills 校验 + 拒绝日志    |
| `desktop/.../remote/mobile-approval-channel.js`| ⏳ 新| 高风险 skill 的桌面发起 / 手机响应路由 |
| `desktop/.../remote/command-handler.js`       | ✅ 改 | 加 sign.request 反向通道处理          |
| `desktop/.../config/unified-config-manager.js`| ✅ 改 | 加 mobileBridge.* 配置字段            |

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

## 6. 待实施（M1 ~ M7）

| 里程碑 | 工期    | 目标                                                         | 验收                                  |
| ------ | ------- | ------------------------------------------------------------ | ------------------------------------- |
| **M1** | 0.5 天  | 文档评审 + 8 doc-only stub 处置 PR 合并                       | RFC 通过 + stub 文档清理 PR 合并      |
| **M2** | 3 天    | L1 钥匙层：StrongBox + DIDWallet + BiometricGate + QRPairing  | 67 单测 + E2E 首启动落 DID            |
| **M3** | 2 天    | L2 Voice Mode + CameraOCR                                    | 42 单测 + E2E 连续对话 + 拍照入 KB    |
| **M4** | 2 天    | L3 RemoteSkillRegistry + 桌面白名单 + ApprovalUI              | 55 单测 + 桌面白名单严格生效 + 审批 E2E |
| **M5** | 1 天    | 反向 SignAsService（桌面调手机签名，ADR-6）                   | 14 单测 + E2E 大额 marketplace 通过   |
| **M6** | 1 天    | 性能 / 续航 / 弱网压测，回填 ✅ 实测值                         | 全部 §7.2 目标达标或解释偏差          |
| **M7** | 0.5 天  | 用户文档同步至 docs-site，发版 v1.0                           | docs-site 可访问 + CHANGELOG v1.0     |
|        | **共 10 天** |                                                         |                                       |

### M2 拆分（3 天）

- D1: StrongBoxKeyManager + 单测（25）
- D2: DIDWallet（多身份 + 助记词 + 备份导入）+ 单测（30）
- D3: BiometricGate + QRPairing + E2E 首启动

### M4 拆分（2 天）

- D1: RemoteSkillRegistry + 桌面 mobile-skill-whitelist.js + 单测（30）
- D2: ApprovalUI + mobile-approval-channel.js + E2E（25 + E2E）

## 7. v1.0 验收标准

### 7.1 demo 路径

1. **首启**: 全新设备安装 → BiometricGate → DIDWallet 创建（StrongBox）→ 助记词备份 → 重启后恢复
2. **配对**: 扫码桌面 → DID 双向认证 → Phase 3d sync 拉数据
3. **拍照入 KB**: 拍发票 → REMOTE OCR → 桌面 KB 看到
4. **Voice Mode**: 长按 → 连续 3 轮中文对话 → TTS 朗读 → 中断恢复
5. **Cowork 审批**: 桌面发起 spawnTeam → 手机推送 → 进度面板 → 审批通过 → 桌面执行
6. **大额签名（反向）**: 桌面发起 marketplace 购买 > $10 → 手机 ApprovalUI → StrongBox 签名 → 桌面提交
7. **8 stub 已无残留**: 文档站搜索"trading skill"等不再出现 doc-only 条目

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
| L2      | 42       | 2     | API 33 主测，弱网（3G/200ms RTT/5% loss） |
| L3      | 55       | 3     | API 33 + 桌面 v5.0.3.46                      |
| 桌面侧  | 24       | 2     | 桌面 unit + integration                      |
| **共**  | **220+** | **9** | -                                            |

行覆盖率门槛 ≥ 80%。

## 8. 副线发现（不在 v1.0 范围，单开 issue）

### 8.1 `mobile-app/` 与 `android-app/` 双目录并存

仓库当前两份并存，一份 doc-only 索引一份真代码。新成员混淆风险高。建议 v1.0 前合并或重命名（issue 待开）。

### 8.2 U-Key Android placeholder 残留代码

`android-app/.../ukey/` 模块有半成品代码（非纯 doc-only）。v1.0 由 StrongBox 替代，需清理 + 在 release notes 写明。

### 8.3 Phase 3d v1.3 单 peer 限制

`SyncCoordinator` 当前单 peer，v1.0 仍单 peer。多设备用户在 v1.0 不能"两台手机都同步"。v1.1 必修，v1.0 release notes 明示限制。

### 8.4 REMOTE 8 skills 老接口无 registry

当前 8 个 REMOTE 没有统一注册表，方法名 hard-coded。v1.0 由 `RemoteSkillRegistry` 重构，但需做老接口对照表 + 1 版兼容窗口（M4 PR 内）。

### 8.5 V5/V6 桌面 UI 中"移动端入口"暧昧

桌面 V5/V6 UI 没有专门的"移动端配对管理 / 已配对设备列表 / mobile-bridge 状态"页。v1.0 桌面侧需加一个 Settings → Mobile Bridge 子面板（小工作量，归在 M4 桌面侧）。

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

### 9.2 依赖

- **桌面 v5.0.3.46+**: mobile-bridge-sync.js 与 remote/ 已就位
- **Phase 3d v1.2 strict-mode**: SyncAuthVerifier 已落
- **Phase 3d v1.3 mDNS + WebRTC**: transport 已落
- **androidx.biometric 1.2+**: BiometricGate 必需
- **CameraX 1.3+**: CameraOCR 必需

无外部团队 / 第三方依赖（除 FCM 和厂商 StrongBox 实现）。

### 9.3 不可控

- FCM 国内可达性是 Google 服务，需文档明示并提供本地 channel 兜底
- 老设备 StrongBox 缺席率随机，无法控制，仅能降级 + 提示

## 10. 后续 milestone（v1.1 / v1.2 占位）

### v1.1（+5 天，目标 2026-Q3）

- OfflineQueue：桌面离线时 REMOTE 排队 + 恢复回放
- 多设备 N 端 pair（解 §8.3）
- TURN 中继 opt-in（解 §9.1 NAT 穿透）
- Whisper local ASR（解 §9.1 中文识别）
- v1.0 副线 issue 收口（§8.1 / §8.2 双目录与残留）

### v1.2（目标 2026-Q4）

- Android Auto 入口（车载 Voice Mode + 推送）
- Wear OS 入口（手表 ApprovalUI + 推送）
- m-of-n 多签（手机 + 桌面 U-Key 联签，复用 MTC publisher_signature 机制）

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

- **Q1**: §8.1 的 `mobile-app/` vs `android-app/` 是 M1 处置还是 v1.1 单独 issue？倾向 M1 处置（避免 v1.0 文档继续混乱），需要用户拍板。
- **Q2**: §9.1 FCM 国内可达性 — 是否在 v1.0 就接 OPPO / 小米 / 华为推送 SDK？工作量约 2 天，未列入 M1-M7 工期。倾向 v1.0 仅 FCM + 本地兜底，统一推送在 v1.1。
- **Q3**: ADR-6 反向 RPC 在 macOS/Linux 桌面的硬件 USB Key 替代价值是否要写进 marketing？等 M5 demo 完再决定文案。
- **Q4**: §8.5 桌面 Settings → Mobile Bridge 子面板归 M4 还是单独 M4.5？倾向归 M4（DI 1 天内），但要确认桌面 V6 shell port 进度。

## 变更记录

- 2026-05-10 v0.1：初稿，三层定位 + 8 ADR + 10 天 M1-M7 路线
