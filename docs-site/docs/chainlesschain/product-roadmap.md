# 产品演进路线图

> **当前版本**: v1.1.0-alpha 企业版 | **Cowork**: v3.3 + v4.0 | **SIMKey**: v0.39.0 | **最后更新**: 2026-02-27

## 概述

产品演进路线图展示了 ChainlessChain 从基础功能到企业平台的完整演进历程，涵盖 AI 智能体、安全硬件、去中心化社交和企业平台四条主线。路线图按季度规划了 100+ Phase 的功能模块，从 Cowork 多代理协作到后量子密码迁移，从 RBAC 权限到低代码平台和 BI 引擎，描绘了产品的长期技术愿景。

## 核心特性

- 🤖 **AI 智能体主线**: Cowork 多代理 → 自然语言编程 → 多模态协作 → 自主运维 → Agent 联邦
- 🔐 **安全硬件主线**: U-Key/SIMKey → FIDO2 → 门限签名 → 卫星 SIM → 后量子密码
- 🌐 **去中心化社交主线**: DID 身份 → P2P 加密 → 协议融合 → DAO 治理 → 社交 AI
- 🏢 **企业平台主线**: RBAC 权限 → SSO → 审计合规 → 低代码平台 → BI 引擎

## 系统架构

```
┌──────────────────────────────────────────────┐
│         ChainlessChain 产品演进架构            │
│                                              │
│  ┌──────────┐ ┌──────────┐ ┌──────────────┐ │
│  │ AI 智能体│ │ 安全硬件 │ │ 去中心化社交 │ │
│  │ Cowork   │ │ U-Key    │ │ DID/P2P      │ │
│  │ v3.3+v4.0│ │ SIMKey   │ │ Signal       │ │
│  └────┬─────┘ └────┬─────┘ └──────┬───────┘ │
│       │            │              │          │
│       ▼            ▼              ▼          │
│  ┌──────────────────────────────────────┐    │
│  │       统一平台层                      │    │
│  │  Desktop | Android | iOS | Web       │    │
│  └──────────────────┬───────────────────┘    │
│                     ▼                        │
│  ┌──────────────────────────────────────┐    │
│  │       企业平台                        │    │
│  │  RBAC | SSO | Audit | Low-Code | BI  │    │
│  └──────────────────────────────────────┘    │
└──────────────────────────────────────────────┘
```

## 配置参考

```javascript
// 产品级全局配置（desktop-app-vue/.chainlesschain/config.json）
{
  "product": {
    "version": "1.1.0",
    "platform": "desktop",            // desktop | android | ios | web
    "featureFlags": {
      "agentFederation": true,         // v2.0 联邦网络
      "nlProgramming": true,           // v3.1 自然语言编程
      "multimodalCollab": true,        // v3.2 多模态协作
      "autonomousOps": true            // v3.3 自主运维
    }
  },
  "security": {
    "hardwareMode": "simkey",          // simkey | ukey | simulation
    "pqcMigration": false,             // 后量子密码迁移（v3.2.0 规划项）
    "zkpEnabled": false                // ZKP 零知识证明（v1.1.0 Beta）
  },
  "enterprise": {
    "rbacEnabled": true,
    "ssoProvider": null,               // null | "saml" | "oidc"
    "auditRetentionDays": 90
  }
}
```

## 性能指标

> 目标性能指标（各阶段规划值，随版本演进持续优化）

| 维度 | v1.1.0 目标 | v2.0.0 目标 | 长期愿景 |
|------|-------------|-------------|---------|
| 内置技能数 | 95 | 200+ | 500+ |
| IPC 处理器数 | 557+ | 700+ | 1000+ |
| 测试用例数 | 19,785+ | 25,000+ | 50,000+ |
| 代理启动延迟 | < 2s | < 1s | < 500ms |
| DID 认证延迟 | < 500ms | < 200ms | < 100ms |
| 联邦网络节点规模 | 100 节点压测 | 1,000 节点 | 全球分布式 |
| 多平台支持 | 4 平台 | 4 平台 + Web Panel | 统一平台层 |
| 后量子密码覆盖 | 部分（ZKP Beta） | 全量迁移规划 | 完全 PQC |

## 测试覆盖率

路线图无单独测试 — 具体功能测试分散在各 feature 模块中。

```
tests/
├── desktop-app-vue/tests/unit/           # Desktop 主进程单测（AI Engine / IPC / LLM）
├── desktop-app-vue/src/renderer/stores/__tests__/   # Renderer Pinia stores 测试
├── packages/cli/__tests__/                # CLI 命令与 runtime 单测
├── packages/session-core/__tests__/       # 会话内核单测（MemoryStore / ApprovalGate）
└── android-app/**/src/test/               # Android 模块单测（MockK + Robolectric）
```

- **v1.1.0 (AI 智能化)**: 覆盖 Agent/Skills/LLM/Memory 模块
- **v1.2.0 (安全与合规)**: 覆盖 Audit/DLP/SIEM/PQC 模块
- **v2.0.0 (去中心化)**: 覆盖 DID/P2P/联邦网络模块
- **v3.0.0+ (长期愿景)**: 按迭代逐步扩展覆盖

## 安全考虑

### 1. 硬件安全主线

U-Key/SIMKey 作为信任根，所有关键密钥操作（签名、加密、DID 私钥派生）均在硬件安全模块内执行，私钥从不以明文形式暴露到应用层。Windows 驱动不可用时自动进入软件模拟模式（仅开发用途）。

### 2. 多主线安全隔离

四条演进主线（AI 智能体、安全硬件、去中心化社交、企业平台）在数据层通过 `orgId` + `userId` 双维度隔离，跨主线数据访问须经 RBAC 权限检查（`auth:check` IPC）。

### 3. 去中心化身份安全

所有 DID 身份使用 Ed25519，P2P 通信使用 Signal Protocol 端到端加密，消息密钥每会话轮换。DAO 治理投票通过 DID 签名防止重复投票和身份伪造。

### 4. 企业合规

审计日志（`audit-compliance` 模块）记录所有敏感操作，保留期默认 90 天可配置。DLP 扫描集成防止数据外泄，SIEM 支持将事件导出至外部安全平台。

### 5. 后量子密码规划

v3.2.0 阶段规划全量后量子密码（PQC）迁移，采用 NIST 标准化算法（Kyber/Dilithium）替换当前 RSA/ECDSA，现有 Ed25519 签名在过渡期内双轨并行。

## 故障排查

**Q: 产品版本更新后 config.json 配置失效**
检查 `.chainlesschain/config.json` 格式是否符合新版 schema（通过 `chainlesschain config list` 验证）。新版本可能新增必填字段，运行 `chainlesschain doctor` 自动诊断并提示修复建议。

**Q: 硬件安全模式（SIMKey）在 macOS/Linux 下无法启动**
U-Key/SIMKey 驱动仅支持 Windows。在 macOS/Linux 下需在配置中设置 `"hardwareMode": "simulation"`，此时密钥操作由软件模拟，仅适用于开发测试环境。

**Q: 企业版 RBAC 权限配置后用户仍无法访问某功能**
运行 `chainlesschain auth check <userId> "<permission>"` 验证权限是否正确分配。检查角色继承链是否完整（`auth:roles` IPC），确认 `rbacEnabled: true` 已在配置中设置。

**Q: 路线图中标注已完成的功能在当前安装版本中不可用**
路线图中 ✅ 标注为代码已实现，但部分功能需通过 Beta Feature Flags 开启。运行 `chainlesschain config beta list` 查看可用的 Beta 功能，通过 `chainlesschain config beta enable <flag>` 激活。

## 关键文件

| 文件 | 职责 |
|------|------|
| `desktop-app-vue/src/main/ai-engine/` | AI 智能体核心引擎 |
| `desktop-app-vue/src/main/ukey/` | U-Key/SIMKey 硬件安全 |
| `desktop-app-vue/src/main/p2p/` | P2P 去中心化通信 |
| `desktop-app-vue/src/main/enterprise/` | 企业平台模块 |
| `desktop-app-vue/src/main/blockchain/` | 区块链与 DAO 治理 |

## 使用示例

```bash
# 查看当前产品版本与功能状态
chainlesschain status
chainlesschain doctor

# 查看并启用 Beta 功能
chainlesschain config beta list
chainlesschain config beta enable agent-federation-2026-06-01

# AI 智能体主线：多代理协作
chainlesschain cowork debate ./src/feature.js   # 多视角代码审查
chainlesschain cowork analyze ./src --agent-id orchestrator

# 安全硬件主线：DID 身份操作
chainlesschain did create
chainlesschain did sign "Hello ChainlessChain"
chainlesschain encrypt file sensitive.txt

# 去中心化社交主线：P2P 通信
chainlesschain p2p peers
chainlesschain social post "My first decentralized post"

# 企业平台主线：RBAC 与审计
chainlesschain auth roles
chainlesschain auth check user1 "pipeline:start"
chainlesschain audit log --limit 50
```

```javascript
// 通过 IPC 查询产品演进状态（Renderer 层）
const status = await window.electron.ipcRenderer.invoke('app:get-version')
// → { version: '1.1.0', features: ['cowork-v3.3', 'agent-federation', ...] }

const betaFlags = await window.electron.ipcRenderer.invoke('config:beta-list')
// → [{ flag: 'idle-park-2026-05-01', enabled: false }, ...]
```

## 相关文档

- [Cowork 路线图](/chainlesschain/cowork-roadmap)
- [v1.1.0 实施计划](/chainlesschain/implementation-plan)
- [更新日志](/changelog)

本文档描述 ChainlessChain 产品的整体演进规划，涵盖 AI 智能体、安全硬件、去中心化社交、企业级平台四条主线。

> 各模块详细路线图：[Cowork 路线图](/chainlesschain/cowork-roadmap) | [更新日志](/changelog)

---

## 当前状态总览

### 平台矩阵

| 平台                          | 版本   | 技术栈                | 技能数                           | 状态     |
| ----------------------------- | ------ | --------------------- | -------------------------------- | -------- |
| Desktop (Windows/macOS/Linux) | v1.1.0 | Electron + Vue3       | 95                               | 生产就绪 |
| Android                       | v1.1.0 | Jetpack Compose       | 28 (5 LOCAL + 8 REMOTE + 15 doc) | 生产就绪 |
| iOS                           | v1.1.0 | SwiftUI               | —                                | 生产就绪 |
| Web 文档站                    | v1.1.0 | VitePress             | —                                | 已上线   |
| 后端服务                      | v1.1.0 | Spring Boot + FastAPI | —                                | 生产就绪 |

### 核心数据

| 指标       | 数值     |
| ---------- | -------- |
| 总代码行数 | 348,000+ |
| Vue 组件   | 384+     |
| IPC 处理器 | 557+     |
| 内置技能   | 95       |
| 数据库表   | 70+      |
| 测试用例   | 19,785+  |

---

## 演进主线

```
                    ChainlessChain 产品演进
                    ========================

  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
  │  AI 智能体  │  │  安全硬件   │  │ 去中心化社交│  │  企业平台   │
  │  主线       │  │  主线       │  │  主线       │  │  主线       │
  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘
         │                │                │                │
  v2.1.0 已完成    v0.39.0 已完成   v1.0.0 已完成    v1.0.0 已完成
  自进化+知识图谱  TEE+ZKP+卫星    社区+直播+协作    审计+SSO+CRDT
         │                │                │                │
         ▼                ▼                ▼                ▼
  ┌──────────────────────────────────────────────────────────────┐
  │              v1.1.0 — 2026 Q1-Q2 融合升级                   │
  │  Cowork v3.0-v3.3 | SIMKey v0.40 | 社交 AI | 企业合规      │
  └──────────────────────────────────────────────────────────────┘
         │
         ▼
  ┌──────────────────────────────────────────────────────────────┐
  │              v2.0.0 — 2026 H2 去中心化代理网络               │
  │  Cowork v4.0 | Agent DID | 联邦发现 | 跨组织协作             │
  └──────────────────────────────────────────────────────────────┘
```

---

## 第一阶段：v1.1.0 — 全栈智能化（2026 Q1-Q2）

### 主线 A：AI 智能体演进（Cowork v3.0-v3.3）

#### A1. 全自动开发流水线（v3.0） ✅ 已完成

**目标**: 从需求描述到生产部署全程 AI 代理协作，人工干预率 < 20%

**实现状态**: 后端 5 模块 + 15 IPC 已完成 | 前端 `DeploymentMonitorPage.vue` + `deployment.ts` Store 已完成 | [文档](/chainlesschain/pipeline)

```
需求 → 解析 → 架构 → 编码 → 测试 → 审查 → 部署 → 监控
  │      │       │      │      │      │      │      │
  NL   Parser  Orch.  Skills  VLoop  Debate Deploy Monitor
```

| 模块                  | 文件                     | 职责                                            |
| --------------------- | ------------------------ | ----------------------------------------------- |
| Pipeline Orchestrator | `pipeline-ipc.js`        | DAG 流水线编排，5 种步骤类型，10 个预置模板     |
| Requirement Parser    | `requirement-parser.js`  | NL→Spec JSON，用户故事/验收标准提取             |
| Deploy Agent          | `deploy-agent.js`        | 多环境部署（dev/staging/prod），蓝绿/金丝雀策略 |
| Post-Deploy Monitor   | `post-deploy-monitor.js` | 健康监控，KPI 基线偏差检测                      |
| Rollback Manager      | `rollback-manager.js`    | Git Revert/Docker/Config 多策略自动回滚         |

**KPI 目标**:

| 指标             | 目标值   |
| ---------------- | -------- |
| 人工干预率       | < 20%    |
| 需求→部署时间    | < 2 小时 |
| 流水线成功率     | > 85%    |
| 自动回滚响应时间 | < 30 秒  |

**新增**: 15 IPC 处理器，3 张数据库表

---

#### A2. 自然语言编程（v3.1） ✅ 已完成

**目标**: 用自然语言描述需求，代理团队自动实现符合项目编码约定的代码，需求→代码转化率 > 80%

**实现状态**: 后端 2 模块 + 10 IPC 已完成 | 前端 `NLProgrammingPage.vue` + `nlProgram.ts` Store 已完成 | [文档](/chainlesschain/nl-programming)

| 模块                   | 文件                        | 职责                                            |
| ---------------------- | --------------------------- | ----------------------------------------------- |
| Spec Translator        | `spec-translator.js`        | NL→结构化 Spec 9 步翻译，9 种意图分类，LLM 增强 |
| Project Style Analyzer | `project-style-analyzer.js` | 编码约定提取（命名/缩进/注释），自动规则生成    |

**核心流程**:

```
用户自然语言 → 意图识别 → 上下文补全 → Spec 生成
                                         ↓
                              项目风格分析 ← CKG + Instinct
                                         ↓
                              代码生成（符合本地约定）
```

**新增**: 10 IPC 处理器，2 张数据库表

---

#### A3. 多模态协作（v3.2） ✅ 已完成

**目标**: 集成语音、视觉、文档等多模态输入输出，支持 5+ 模态

**实现状态**: 后端 5 模块 + 12 IPC 已完成 | 前端 `MultimodalCollabPage.vue` + `multimodal.ts` Store 已完成 | [文档](/chainlesschain/multimodal)

| 模块               | 文件                    | 职责                                       |
| ------------------ | ----------------------- | ------------------------------------------ |
| Modality Fusion    | `modality-fusion.js`    | 音频/图像/文档/屏幕/文本统一融合引擎       |
| Document Parser    | `document-parser.js`    | PDF/Word/Excel 解析，表格/图片提取，OCR    |
| Screen Recorder    | `screen-recorder.js`    | Electron desktopCapturer 截屏/录制         |
| Multimodal Context | `multimodal-context.js` | 多模态会话上下文，Token 预算控制           |
| Multimodal Output  | `multimodal-output.js`  | 富媒体输出（Markdown/HTML/ECharts/幻灯片） |

**新增**: 12 IPC 处理器，2 张数据库表

---

#### A4. 自主运维（v3.3） ✅ 已完成

**目标**: 代理自动监控、诊断、修复生产环境问题，MTTR < 5 分钟

**实现状态**: 后端 3 模块 + 15 IPC 已完成 | 前端 `AutonomousOpsPage.vue` + `autonomousOps.ts` Store 已完成 | [文档](/chainlesschain/autonomous-ops)

| 模块                 | 文件                      | 职责                                         |
| -------------------- | ------------------------- | -------------------------------------------- |
| Alert Manager        | `alert-manager.js`        | 多通道告警（Webhook/Email/IM），P0-P3 升级链 |
| Auto Remediator      | `auto-remediator.js`      | Playbook 驱动自动修复，8 种动作类型          |
| Postmortem Generator | `postmortem-generator.js` | LLM 事故报告生成，根因分析，改进建议         |

**KPI 目标**:

| 指标            | 目标值   |
| --------------- | -------- |
| MTTR            | < 5 分钟 |
| 自动修复成功率  | > 80%    |
| 误报率          | < 5%     |
| Playbook 覆盖率 | > 70%    |

**新增**: 15 IPC 处理器，3 张数据库表

---

### 主线 B：安全硬件演进

#### B1. SIMKey v0.40 — 跨平台统一安全层

| 方向           | 内容                                          | 优先级 | 状态      | 目标时间 |
| -------------- | --------------------------------------------- | ------ | --------- | -------- |
| 统一密钥管理   | U盾 + SIMKey + TEE 三端密钥统一派生与轮换     | P0     | ✅ 已完成 | 2026 Q2  |
| FIDO2 WebAuthn | SIMKey 作为 FIDO2 认证器，支持 Web 无密码登录 | P0     | ✅ 已完成 | 2026 Q2  |
| 硬件安全聚合   | 多设备硬件安全模块聚合签名（2-of-3 阈值签名） | P1     | ✅ 已完成 | 2026 Q3  |
| 生物特征绑定   | TEE 内生物特征模板与 SIMKey 密钥绑定          | P1     | ✅ 已完成 | 2026 Q3  |
| 量子迁移路线   | ML-KEM/ML-DSA 全面替换 RSA/ECDSA 的迁移计划   | P2     | ✅ 已完成 | 2026 Q4  |

**实施计划**:

- **Phase 1（Q2）**: 统一密钥管理 + FIDO2 WebAuthn ✅ — `unified-key-manager.js` BIP-32 统一密钥派生 + `fido2-authenticator.js` WebAuthn 认证器 + 6 IPC + 19+20 单元测试
- **Phase 2（Q3）**: 硬件安全聚合 + 生物特征绑定 ✅
  - `threshold-signature-manager.js` — Shamir 2-of-3 秘密共享，密钥分片分发至 U-Key/SIMKey/TEE，Lagrange 插值重构
  - `biometric-binding.js` — TEE 内 HMAC 生物特征模板存储/验证/解绑，过期控制
  - `ukey-ipc.js` 扩展 4 IPC（`threshold-security:setup-keys/sign`、`threshold-security:bind-biometric/verify-biometric`）
  - `thresholdSecurity.ts` Store + `ThresholdSecurityPage.vue` + 单元测试 62+24 用例
- **Phase 3（Q4）**: 量子迁移路线 ✅
  - `pqc-migration-manager.js` — ML-KEM-768/1024 + ML-DSA-65/87 密钥生成，混合模式过渡（X25519-ML-KEM/Ed25519-ML-DSA）
  - `pqc-ipc.js` — 4 IPC 处理器（`pqc:list-keys/generate-key/get-migration-status/execute-migration`）
  - `pqcMigration.ts` Store + `PQCMigrationPage.vue` + 单元测试 27+14 用例 | [文档](/chainlesschain/pqc-migration)

#### B2. U盾 v2.0 — 跨平台扩展

| 方向             | 内容                                | 优先级 | 状态      | 目标时间 |
| ---------------- | ----------------------------------- | ------ | --------- | -------- |
| macOS/Linux 驱动 | 基于 libusb/WebUSB 的跨平台 U盾驱动 | P0     | ✅ 已完成 | 2026 Q2  |
| 蓝牙 U盾         | BLE 协议支持，移动端无线连接        | P1     | ✅ 已完成 | 2026 Q3  |
| U盾固件 OTA      | 安全固件远程升级通道                | P2     | ✅ 已完成 | 2026 Q4  |

**实施计划**:

- **Phase 1（Q2）**: macOS/Linux 驱动 ✅ — `usb-transport.js` 跨平台 USB 通信 + `webusb-fallback.js` WebUSB 降级方案 + 2 IPC + 18+18 单元测试
- **Phase 2（Q3）**: 蓝牙 U盾 ✅
  - `ble-driver.js` 完善 — BLE GATT 扫描/配对/连接/断开，CTAP2 over BLE，自动重连
  - `driver-registry.js` 扩展 — 注册 BLE 传输层至统一驱动注册表
  - `ukey-ipc.js` 扩展 4 IPC（`ble-ukey:scan-devices/pair-device/connect/disconnect`）
  - `bleUkey.ts` Store + `BLEDevicesPage.vue` + 单元测试 22 用例
- **Phase 3（Q4）**: 固件 OTA ✅
  - `firmware-ota-manager.js` — 多通道版本管理（STABLE/BETA/NIGHTLY），64KB 分块断点续传，SHA-256 校验 + 签名验证，回滚保护
  - `firmware-ota-ipc.js` — 4 IPC 处理器（`firmware:check-updates/list-versions/start-update/get-history`）
  - `firmwareOta.ts` Store + `FirmwareOTAPage.vue` + 单元测试 22+14 用例 | [文档](/chainlesschain/firmware-ota)

---

### 主线 C：去中心化社交演进

#### C1. 社交智能化

| 方向            | 内容                                               | 优先级 | 状态      | 目标时间 |
| --------------- | -------------------------------------------------- | ------ | --------- | -------- |
| AI 社交助手增强 | 上下文感知回复建议、话题深度分析、社交关系图谱     | P0     | ✅ 已完成 | 2026 Q2  |
| 智能内容推荐    | 基于本地知识库和兴趣模型的去中心化推荐（无服务器） | P1     | ✅ 已完成 | 2026 Q3  |
| AI 社区治理     | 自动提案分析、投票影响预测、治理参数优化建议       | P2     | ✅ 已完成 | 2026 Q4  |

**实施计划**:

- **Phase 1（Q2）**: AI 社交助手增强 ✅
  - `topic-analyzer.js` — 话题提取 + 深度分析（关键词/情感/趋势）
  - `social-graph.js` — 社交关系图谱构建（互动频率/亲密度/社区聚类）
  - `social-ipc.js` — 8 新 IPC 处理器 + `SocialInsightsPage.vue` + `socialAI.ts` Store
  - 已完成: 3 个后端模块 + 8 IPC + 1 前端页面 + 1 Store + 单元测试 34 用例
- **Phase 2（Q3）**: 智能内容推荐 ✅
  - `local-recommender.js` — 本地 embedding 余弦相似度推荐引擎，协同过滤，反馈循环
  - `interest-profiler.js` — 用户兴趣画像提取（话题分析 + 社交图谱交互），时间衰减
  - `recommendation-ipc.js` — 6 IPC 处理器
  - `recommendation.ts` Store + `RecommendationsPage.vue` + 单元测试 49+21 用例
- **Phase 3（Q4）**: AI 社区治理 ✅
  - `governance-ai.js` — 提案 CRUD + AI 影响分析（安全/性能/兼容性）+ 情感投票预测，支持 4 种提案类型
  - `governance-ipc.js` — 4 IPC 处理器（`governance:list-proposals/create-proposal/analyze-impact/predict-vote`）
  - `governance.ts` Store + `GovernancePage.vue` + 单元测试 25+14 用例 | [文档](/chainlesschain/governance)

#### C2. 跨平台互通

| 方向             | 内容                                          | 优先级 | 状态      | 目标时间 |
| ---------------- | --------------------------------------------- | ------ | --------- | -------- |
| ActivityPub 完善 | Mastodon/Misskey 双向互通，评论/转发/点赞同步 | P0     | ✅ 已完成 | 2026 Q2  |
| Nostr 桥接       | Nostr 事件格式兼容，中继发现                  | P1     | ✅ 已完成 | 2026 Q3  |
| Matrix 集成      | Matrix 协议桥接，支持加密群聊互通             | P2     | ✅ 已完成 | 2026 Q4  |

**实施计划**:

- **Phase 1（Q2）**: ActivityPub 完善 ✅
  - `activitypub-bridge.js` — ActivityPub S2S 协议，Actor/Inbox/Outbox + HTTP Signatures
  - `ap-content-sync.js` — 帖子/评论/点赞/转发/关注的双向同步
  - `ap-webfinger.js` — WebFinger 协议支持，远程用户发现
  - 已完成: 3 个后端模块 + 10 IPC + `ActivityPubBridgePage.vue` + 单元测试
- **Phase 2（Q3）**: Nostr 桥接 ✅
  - `nostr-bridge.js` — NIP-01 事件签名/验证，中继池 WebSocket 管理，事件发布/订阅
  - `nostr-identity.js` — npub/nsec 密钥派生，DID ↔ Nostr 双向身份映射
  - `nostr-bridge-ipc.js` — 6 IPC 处理器
  - `nostrBridge.ts` Store + `NostrBridgePage.vue` + 单元测试 48+25 用例
- **Phase 3（Q4）**: Matrix 集成 ✅
  - `matrix-bridge.js` — Matrix CS API 密码/SSO 登录，房间管理，Olm/Megolm E2EE 消息收发，DID ↔ MXID 双向映射
  - `matrix-ipc.js` — 5 IPC 处理器（`matrix:login/list-rooms/send-message/get-messages/join-room`）
  - `matrixBridge.ts` Store + `MatrixBridgePage.vue` + 单元测试 26+16 用例 | [文档](/chainlesschain/matrix-bridge)

---

### 主线 D：企业平台演进

#### D1. 合规与治理

| 方向         | 内容                                            | 优先级 | 状态      | 目标时间 |
| ------------ | ----------------------------------------------- | ------ | --------- | -------- |
| SOC 2 合规包 | 自动化 SOC 2 Type II 证据收集与报告生成         | P0     | ✅ 已完成 | 2026 Q2  |
| 数据分类分级 | 自动识别敏感数据（PII/PHI/PCI），标签与策略关联 | P0     | ✅ 已完成 | 2026 Q2  |
| DLP 防泄漏   | 基于内容检测的数据防泄漏策略（审计日志集成）    | P1     | ✅ 已完成 | 2026 Q3  |

**实施计划**:

- **Phase 1（Q2）**: SOC 2 合规包 + 数据分类分级 ✅
  - `soc2-compliance.js` — 自动收集审计日志/访问记录/变更历史，生成 SOC 2 Type II 证据报告
  - `data-classifier.js` — 基于规则 + LLM 的敏感数据自动识别（PII/PHI/PCI）
  - `classification-policy.js` — 分级策略引擎（公开/内部/机密/绝密），自动标签关联
  - `compliance-ipc.js` — 12 IPC + `ComplianceDashboardPage.vue` + `compliance.ts` Store
  - 已完成: 4 个后端模块 + 12 IPC + 1 前端页面 + 1 Store + 单元测试 105 用例
- **Phase 2（Q3）**: DLP 防泄漏 ✅
  - `dlp-engine.js` — 内容扫描引擎（正则 + 关键词 + NLP 指纹），策略匹配，拦截/告警/审计三级响应
  - `dlp-policy.js` — DLP 策略 CRUD，通道规则配置，严重度阈值匹配
  - `dlp-ipc.js` — 8 IPC 处理器
  - `data-classifier.js` 扩展 `getDLPClassification()` + `enterprise-audit-logger.js` 扩展 DLP 事件类型
  - `dlp.ts` Store + `DLPPoliciesPage.vue` + 单元测试 55+27 用例

#### D2. 企业集成

| 方向               | 内容                                             | 优先级 | 状态      | 目标时间 |
| ------------------ | ------------------------------------------------ | ------ | --------- | -------- |
| SCIM 用户同步      | SCIM 2.0 协议，与 Azure AD/Okta 自动同步用户和组 | P0     | ✅ 已完成 | 2026 Q2  |
| SIEM 对接          | Splunk/ELK/Sentinel 审计日志实时推送             | P1     | ✅ 已完成 | 2026 Q3  |
| Terraform Provider | 基础设施即代码管理 ChainlessChain 配置           | P2     | ✅ 已完成 | 2026 Q4  |

**实施计划**:

- **Phase 1（Q2）**: SCIM 用户同步 ✅
  - `scim-server.js` — SCIM 2.0 Server 端实现（/Users, /Groups CRUD + 过滤/分页/PATCH）
  - `scim-sync.js` — 增量同步引擎，与 Azure AD/Okta/OneLogin 对接
  - `scim-ipc.js` — 8 IPC + `SCIMIntegrationPage.vue`
  - 已完成: 3 个后端模块 + 8 IPC + 1 前端页面 + 单元测试 60 用例
- **Phase 2（Q3）**: SIEM 对接 ✅
  - `siem-exporter.js` — CEF/LEEF/JSON 格式转换，批量导出，增量同步（追踪最后导出 ID）
  - `siem-ipc.js` — 4 IPC 处理器
  - `enterprise-audit-logger.js` 扩展 `_siemExporter` 字段，日志事件自动推送
  - `siem.ts` Store + `SIEMIntegrationPage.vue` + 单元测试 26+22 用例
- **Phase 3（Q4）**: Terraform Provider ✅
  - `terraform-manager.js` — 工作区 CRUD，Plan/Apply/Destroy 运行控制，状态版本管理，并发控制（最大 3 并发运行）
  - `terraform-ipc.js` — 4 IPC 处理器（`terraform:list-workspaces/create-workspace/plan-run/list-runs`）
  - `terraform.ts` Store + `TerraformProviderPage.vue` + 单元测试 26+14 用例 | [文档](/chainlesschain/terraform-provider)

---

### v1.1.0 汇总

#### 已完成（主线 A — AI 智能体）

| 维度            | 增量                           | 状态      |
| --------------- | ------------------------------ | --------- |
| 后端模块        | 28 个                          | ✅ 已完成 |
| 新增 IPC 处理器 | +72（总计 490+）               | ✅ 已完成 |
| 前端页面        | 5 个新页面                     | ✅ 已完成 |
| Pinia Store     | 5 个新 Store                   | ✅ 已完成 |
| 路由            | 5 条新路由                     | ✅ 已完成 |
| 功能文档        | 5 篇                           | ✅ 已完成 |
| 新增数据库表    | +13（总计 34+）                | ✅ 已完成 |
| 新增代码行      | +17,120（总计 ~327,000）       | ✅ 已完成 |
| 单元测试        | 5 Store × 187 用例             | ✅ 已完成 |
| E2E 测试        | 5 场景 × 61 用例               | ✅ 已完成 |
| 生产加固        | 安全审查 + 性能基线 (Phase 57) | ✅ 已完成 |

#### 已完成（主线 B/C/D Phase 1 — Q2 2026）

| 主线     | 方向                 | 模块数 | IPC 数 | 单元测试 | 状态      |
| -------- | -------------------- | ------ | ------ | -------- | --------- |
| B1-P1    | 统一密钥+FIDO2       | 2      | 6      | 39       | ✅ 已完成 |
| B2-P1    | 跨平台驱动           | 2      | 2      | 36       | ✅ 已完成 |
| C1-P1    | AI 社交助手增强      | 2      | 8      | 34+测试  | ✅ 已完成 |
| C2-P1    | ActivityPub 双向互通 | 3      | 10     | 测试     | ✅ 已完成 |
| D1-P1    | SOC2+数据分类        | 4      | 12     | 105      | ✅ 已完成 |
| D2-P1    | SCIM 用户同步        | 3      | 8      | 60       | ✅ 已完成 |
| **合计** |                      | **16** | **46** | **~400** |           |

#### 待完成（主线 B/C/D Phase 2-3 — Q3-Q4 2026）

| 主线  | 方向               | 模块数（预估） | IPC 数（预估） | 状态      | 目标时间 |
| ----- | ------------------ | -------------- | -------------- | --------- | -------- |
| B1-P2 | 门限签名+生物绑定  | 2              | 4              | ✅ 已完成 | Q3       |
| B1-P3 | 量子迁移路线       | 1              | 4              | ✅ 已完成 | Q4       |
| B2-P2 | 蓝牙 U盾 BLE       | 0 (扩展)       | 4              | ✅ 已完成 | Q3       |
| B2-P3 | 固件 OTA           | 1              | 4              | ✅ 已完成 | Q4       |
| C1-P2 | 智能内容推荐       | 3              | 6              | ✅ 已完成 | Q3       |
| C1-P3 | AI 社区治理        | 1              | 4              | ✅ 已完成 | Q4       |
| C2-P2 | Nostr 桥接         | 3              | 6              | ✅ 已完成 | Q3       |
| C2-P3 | Matrix 集成        | 1              | 5              | ✅ 已完成 | Q4       |
| D1-P2 | DLP 防泄漏         | 3              | 8              | ✅ 已完成 | Q3       |
| D2-P2 | SIEM 对接          | 2              | 4              | ✅ 已完成 | Q3       |
| D2-P3 | Terraform Provider | 1              | 4              | ✅ 已完成 | Q4       |

---

### v1.1.0 测试覆盖

#### 单元测试（Vitest）

| Store              | 测试文件                | 测试用例 | 覆盖范围                                        |
| ------------------ | ----------------------- | -------- | ----------------------------------------------- |
| `deployment.ts`    | `deployment.test.ts`    | 40       | 流水线 CRUD、门控审批、指标、事件监听、错误处理 |
| `agentNetwork.ts`  | `agentNetwork.test.ts`  | 47       | DID 管理、代理发现、凭证、跨组织任务、信誉系统  |
| `autonomousOps.ts` | `autonomousOps.test.ts` | 38       | 事故管理、Playbook、告警、基线、事故报告        |
| `multimodal.ts`    | `multimodal.test.ts`    | 33       | 输入融合、文档解析、屏幕捕获、输出生成          |
| `nlProgram.ts`     | `nlProgram.test.ts`     | 29       | NL 翻译、验证、细化、代码生成、项目约定分析     |
| **合计**           |                         | **187**  | 初始状态 + Getter + Action + 错误处理 + Loading |

#### E2E 测试（Playwright + Electron）

| 场景               | 测试文件                              | 测试用例 | 覆盖范围                                 |
| ------------------ | ------------------------------------- | -------- | ---------------------------------------- |
| 流水线完整生命周期 | `pipeline-full-lifecycle.e2e.test.ts` | 12       | 创建/启动/暂停/恢复/取消/指标/阶段详情   |
| 自主运维事故处理   | `autonomous-ops-scenario.e2e.test.ts` | 15       | 事故检测/确认/Playbook/修复/回滚/报告    |
| 跨组织任务路由     | `cross-org-routing.e2e.test.ts`       | 19       | DID 创建/注册/发现/凭证/路由/信誉        |
| 多模态输入融合     | `multimodal-fusion.e2e.test.ts`       | 14       | 模态检测/文本/文档/图像/屏幕/上下文/输出 |
| NL 到代码生成      | `nl-to-code.e2e.test.ts`              | 12       | NL 翻译/验证/细化/代码生成/历史/约定     |
| **合计**           |                                       | **72**   | 页面导航 + IPC 调用 + 完整业务流程       |

#### 主线 B/C/D Phase 1 单元测试

| 模块                       | 测试文件                        | 测试用例 | 覆盖范围                                       |
| -------------------------- | ------------------------------- | -------- | ---------------------------------------------- |
| `topic-analyzer.js`        | `topic-analyzer.test.js`        | ~25      | 话题提取、情感分析、趋势分析、批量处理         |
| `social-graph.js`          | `social-graph.test.js`          | ~25      | 互动记录、亲密度计算、社区聚类、图谱查询       |
| `activitypub-bridge.js`    | `activitypub-bridge.test.js`    | ~20      | Actor 管理、Inbox/Outbox、HTTP Signatures      |
| `ap-content-sync.js`       | `ap-content-sync.test.js`       | ~20      | 双向同步、帖子/评论/点赞/转发、冲突解决        |
| `soc2-compliance.js`       | `soc2-compliance.test.js`       | 22       | 证据收集、报告生成、合规评分、审计日志         |
| `data-classifier.js`       | `data-classifier.test.js`       | 29       | PII/PHI/PCI 检测、规则匹配、LLM 增强、批量分类 |
| `classification-policy.js` | `classification-policy.test.js` | 22       | 分级策略、自动标签、策略关联、级别变更         |
| `compliance-ipc.js`        | `compliance-ipc.test.js`        | 22       | 12 IPC 通道注册/注销、参数验证、错误处理       |
| `scim-server.js`           | `scim-server.test.js`           | 20       | CRUD、过滤、分页、PATCH、Schema 验证           |
| `scim-sync.js`             | `scim-sync.test.js`             | 27       | 连接器管理、增量同步、状态追踪、历史记录       |
| `scim-ipc.js`              | `scim-ipc.test.js`              | 13       | 8 IPC 通道注册/注销、SCIM 操作代理             |
| `unified-key-manager.js`   | `unified-key-manager.test.js`   | 19       | BIP-32 派生、密钥轮换、跨设备同步              |
| `fido2-authenticator.js`   | `fido2-authenticator.test.js`   | 20       | WebAuthn 注册/认证、CTAP2、凭证管理            |
| `usb-transport.js`         | `usb-transport.test.js`         | 18       | USB 设备发现、通信协议、跨平台适配             |
| `webusb-fallback.js`       | `webusb-fallback.test.js`       | 18       | WebUSB API、降级策略、浏览器兼容               |
| `socialAI.ts` Store        | `socialAI.test.ts`              | 34       | 状态/Getter/Action + 话题/图谱/回复/批量情感   |
| `compliance.ts` Store      | `compliance.test.ts`            | 32       | 状态/Getter/Action + 证据/报告/分类/策略       |
| **合计**                   |                                 | **~400** | 后端模块 + Pinia Store + IPC 处理器            |

#### 主线 B/C/D E2E 测试

| 场景             | 测试文件                       | 覆盖范围                                 |
| ---------------- | ------------------------------ | ---------------------------------------- |
| 社交洞察         | `social-insights.spec.js`      | 话题分析/趋势/社交图谱/回复建议/批量情感 |
| ActivityPub 桥接 | `activitypub-bridge.spec.js`   | 桥接配置/Actor管理/内容同步/WebFinger    |
| 合规仪表板       | `compliance-dashboard.spec.js` | 证据收集/报告生成/数据分类/策略管理      |
| SCIM 集成        | `scim-integration.spec.js`     | 连接器配置/用户同步/同步状态/历史记录    |

#### 主线 B/C/D Phase 2 单元测试（Q3 2026）

| 模块                             | 测试文件                              | 测试用例 | 覆盖范围                                    |
| -------------------------------- | ------------------------------------- | -------- | ------------------------------------------- |
| `threshold-signature-manager.js` | `threshold-signature-manager.test.js` | 38       | Shamir 分割/重组、密钥设置、签名、DB 存储   |
| `biometric-binding.js`           | `biometric-binding.test.js`           | 38       | 绑定/验证/解绑、HMAC 模板、过期、TEE 认证   |
| `local-recommender.js`           | `local-recommender.test.js`           | 26       | 余弦相似度、推荐生成、反馈、标记已读        |
| `interest-profiler.js`           | `interest-profiler.test.js`           | 23       | 兴趣提取、时间衰减、配置文件合并            |
| `nostr-bridge.js`                | `nostr-bridge.test.js`                | 28       | NIP-01 事件、中继管理、发布/订阅            |
| `nostr-identity.js`              | `nostr-identity.test.js`              | 20       | npub/nsec 派生、DID↔Nostr 映射              |
| `dlp-engine.js`                  | `dlp-engine.test.js`                  | 26       | 正则/关键词匹配、策略执行、事件记录         |
| `dlp-policy.js`                  | `dlp-policy.test.js`                  | 29       | 策略 CRUD、通道规则、正则验证               |
| `siem-exporter.js`               | `siem-exporter.test.js`               | 26       | CEF/LEEF/JSON 格式、批量导出、增量同步      |
| `thresholdSecurity.ts` Store     | `thresholdSecurity.test.ts`           | 24       | 状态/Getter/Action + 密钥设置/签名/生物识别 |
| `bleUkey.ts` Store               | `bleUkey.test.ts`                     | 22       | 状态/Getter/Action + 扫描/配对/连接/断开    |
| `recommendation.ts` Store        | `recommendation.test.ts`              | 21       | 状态/Getter/Action + 推荐获取/生成/反馈     |
| `nostrBridge.ts` Store           | `nostrBridge.test.ts`                 | 25       | 状态/Getter/Action + 中继/事件/密钥/DID映射 |
| `dlp.ts` Store                   | `dlp.test.ts`                         | 27       | 状态/Getter/Action + 策略/事件/扫描/统计    |
| `siem.ts` Store                  | `siem.test.ts`                        | 22       | 状态/Getter/Action + 目标/导出/统计         |
| **合计**                         |                                       | **395**  | 后端模块 + Pinia Store                      |

#### 主线 B/C/D Phase 2 E2E 测试

| 场景         | 测试文件                         | 覆盖范围                              |
| ------------ | -------------------------------- | ------------------------------------- |
| 门限安全     | `threshold-security.e2e.test.ts` | 页面导航/密钥分片/生物识别绑定/UI组件 |
| BLE 设备管理 | `ble-devices.e2e.test.ts`        | 页面导航/蓝牙扫描/设备配对/UI组件     |
| 智能推荐     | `recommendations.e2e.test.ts`    | 页面导航/推荐列表/兴趣画像/UI组件     |
| Nostr 桥接   | `nostr-bridge.e2e.test.ts`       | 页面导航/中继管理/事件浏览/UI组件     |
| DLP 防泄漏   | `dlp-policies.e2e.test.ts`       | 页面导航/策略管理/事件仪表板/UI组件   |
| SIEM 集成    | `siem-integration.e2e.test.ts`   | 页面导航/目标配置/导出状态/UI组件     |

#### 主线 B/C/D Phase 3 单元测试（Q4 2026）

| 模块                       | 测试文件                        | 测试用例 | 覆盖范围                                  |
| -------------------------- | ------------------------------- | -------- | ----------------------------------------- |
| `pqc-migration-manager.js` | `pqc-migration-manager.test.js` | 27       | ML-KEM/ML-DSA 生成、混合模式、迁移执行    |
| `firmware-ota-manager.js`  | `firmware-ota-manager.test.js`  | 22       | 更新检查、版本管理、安装流程、回滚        |
| `governance-ai.js`         | `governance-ai.test.js`         | 25       | 提案 CRUD、AI 影响分析、投票预测          |
| `matrix-bridge.js`         | `matrix-bridge.test.js`         | 26       | 登录、房间管理、E2EE 消息、DID 映射       |
| `terraform-manager.js`     | `terraform-manager.test.js`     | 26       | 工作区 CRUD、Plan/Apply/Destroy、并发控制 |
| `pqcMigration.ts` Store    | `pqcMigration.test.ts`          | 14       | 状态/Getter/Action + 密钥生成/迁移执行    |
| `firmwareOta.ts` Store     | `firmwareOta.test.ts`           | 14       | 状态/Getter/Action + 更新检查/安装/历史   |
| `governance.ts` Store      | `governance.test.ts`            | 14       | 状态/Getter/Action + 提案/分析/预测       |
| `matrixBridge.ts` Store    | `matrixBridge.test.ts`          | 16       | 状态/Getter/Action + 登录/房间/消息       |
| `terraform.ts` Store       | `terraform.test.ts`             | 14       | 状态/Getter/Action + 工作区/运行          |
| **合计**                   |                                 | **198**  | 后端模块 + Pinia Store                    |

#### 主线 B/C/D Phase 3 E2E 测试

| 场景           | 测试文件                         | 覆盖范围                            |
| -------------- | -------------------------------- | ----------------------------------- |
| PQC 迁移       | `pqc-migration.e2e.test.ts`      | 页面导航/密钥管理/迁移计划/UI组件   |
| 固件 OTA       | `firmware-ota.e2e.test.ts`       | 页面导航/更新检查/安装流程/UI组件   |
| AI 治理        | `governance.e2e.test.ts`         | 页面导航/提案管理/影响分析/UI组件   |
| Matrix 桥接    | `matrix-bridge.e2e.test.ts`      | 页面导航/登录/房间列表/UI组件       |
| Terraform 管理 | `terraform-provider.e2e.test.ts` | 页面导航/工作区管理/运行记录/UI组件 |

---

## 第二阶段：v2.0.0 — 去中心化代理网络（2026 H2）

### Cowork v4.0 — 全球代理网络 ✅ 已完成（提前交付）

**目标**: 基于 DID 的代理身份认证和跨组织协作，支持 100+ 节点

**实现状态**: 后端 6 模块 + 20 IPC 已完成 | 前端 `FederatedNetworkPage.vue` + `agentNetwork.ts` Store 已完成 | [文档](/chainlesschain/agent-federation)

```
┌──────────────────────────────────────────────────────────┐
│                   去中心化代理网络                        │
│                                                          │
│   组织 A              KadDHT              组织 B         │
│  ┌────────┐     ┌──────────────┐     ┌────────┐         │
│  │Agent-α │────→│ 联邦代理注册 │←────│Agent-β │         │
│  │DID:cc:a│     │  技能发现    │     │DID:cc:b│         │
│  └────────┘     │  信誉评分    │     └────────┘         │
│       │         └──────────────┘          │              │
│       │              ↕                    │              │
│       └──── 跨组织任务委派 + VC 认证 ─────┘              │
│                                                          │
│   组织 C                                                 │
│  ┌────────┐                                              │
│  │Agent-γ │  ← 延迟感知路由，SLA 预算，全程审计          │
│  │DID:cc:c│                                              │
│  └────────┘                                              │
└──────────────────────────────────────────────────────────┘
```

| 模块                | 文件                          | 职责                                                     |
| ------------------- | ----------------------------- | -------------------------------------------------------- |
| Agent DID           | `agent-did.js`                | W3C DID 规范，`did:cc:agent-{uuid}` 格式，Ed25519 密钥对 |
| Credential Manager  | `agent-credential-manager.js` | W3C VC 签发/验证/吊销，3 种凭证类型                      |
| Agent Authenticator | `agent-authenticator.js`      | Challenge-Response / 凭证证明 / 双向 TLS                 |
| Federated Registry  | `federated-agent-registry.js` | KadDHT 去中心化发现，跨组织技能查询                      |
| Cross-Org Router    | `cross-org-task-router.js`    | 跨组织任务委派，SLA 预算，审计日志                       |
| Reputation System   | `agent-reputation.js`         | 多维信誉评分（0.0-1.0），时间衰减，4 级声望              |

**KPI 目标**:

| 指标             | 目标值  |
| ---------------- | ------- |
| 网络节点数       | ≥ 100   |
| 跨组织任务成功率 | > 90%   |
| DID 认证延迟     | < 500ms |
| 技能发现延迟     | < 2 秒  |
| 信誉更新一致性   | > 99%   |

**新增**: 20 IPC 处理器，3 张数据库表

---

## 第三阶段：长期愿景（2027+）

### 方向 1：全自主 AI 开发者（v3.0.0）

**愿景**: 用户描述业务目标 → AI 自主完成从架构到运维的全生命周期，人工仅参与业务决策审批

```
业务目标 → 需求理解 → 技术选型 → 架构设计 → 代码生成 → 测试验证 → 部署上线 → 持续运维
    │          │          │          │          │          │          │          │
  用户输入   NL Parser  Tech Scout  Architect  Coder     VLoop     Deploy    AutoOps
                            │
                        自主学习新技术栈
```

#### 1.1 自主技术学习引擎

| 子模块       | 内容                                                              | 优先级 |
| ------------ | ----------------------------------------------------------------- | ------ |
| 技术栈感知器 | 自动检测项目技术栈版本，跟踪官方文档/Release Notes 变更           | P0     |
| 在线学习代理 | 从 StackOverflow/GitHub/官方文档自主提取最佳实践，转化为 Instinct | P0     |
| 技能自动合成 | 基于 EvoMap 社区 Gene 和本地经验，自动合成新 Skill                | P1     |
| 跨语言迁移   | 已掌握的 Pattern 在不同语言/框架间自动迁移（如 React → Vue）      | P2     |

#### 1.2 端到端自主开发流程

| 子模块           | 内容                                                     | 优先级 |
| ---------------- | -------------------------------------------------------- | ------ |
| 业务意图理解     | 多轮对话提炼业务需求，自动生成 PRD + 技术方案            | P0     |
| 自主架构决策     | 基于 Decision Knowledge Base 历史决策 + 项目约定自动选型 | P0     |
| 全栈代码生成     | 前端 + 后端 + 数据库 + 配置一体化生成，符合项目风格      | P0     |
| 自主 Code Review | 多角度审查（安全/性能/可维护性），自动修复发现的问题     | P1     |
| 持续优化闭环     | 监控生产指标 → 发现瓶颈 → 自动优化 → 验证效果            | P1     |

#### 1.3 人机协作治理

| 子模块         | 内容                                             | 优先级 |
| -------------- | ------------------------------------------------ | ------ |
| 决策审批网关   | 关键决策（架构变更/数据迁移/安全策略）需人工审批 | P0     |
| 操作回放与审计 | 所有自主操作可回放，支持任意时间点回滚           | P0     |
| 置信度门控     | 低置信度操作自动暂停并请求人工确认               | P1     |
| 渐进式自主权   | 根据历史表现逐步扩大 AI 自主决策范围             | P2     |

**KPI 目标**:

| 指标             | 目标值      |
| ---------------- | ----------- |
| 端到端自主完成率 | > 80%       |
| 人工干预频率     | < 5 次/项目 |
| 新技术栈学习周期 | < 24 小时   |
| 生产事故自愈率   | > 95%       |

---

### 方向 2：去中心化 AI 市场（v3.1.0）

**愿景**: 基于代理信誉的去中心化 AI 服务市场，让 AI 能力像商品一样自由交易

```
┌─────────────────────────────────────────────────────────┐
│                  去中心化 AI 市场                         │
│                                                         │
│  ┌─────────┐    ┌─────────────┐    ┌─────────┐         │
│  │ 技能提供 │───→│  EvoMap Hub │←───│ 技能消费 │         │
│  │ 方 (卖)  │    │  撮合/评价  │    │ 方 (买)  │         │
│  └─────────┘    └──────┬──────┘    └─────────┘         │
│       │                │                │               │
│  发布 Skill       代币结算         发现+购买            │
│  赚取积分        信誉加权          按需付费             │
│       │                │                │               │
│  ┌──────────────────────────────────────────┐           │
│  │          去中心化推理网络                  │           │
│  │   节点 A ←──→ 节点 B ←──→ 节点 C         │           │
│  │   (GPU)       (CPU)       (TEE)          │           │
│  └──────────────────────────────────────────┘           │
└─────────────────────────────────────────────────────────┘
```

#### 2.1 Skill-as-a-Service（SaaS）

| 子模块       | 内容                                                        | 优先级 |
| ------------ | ----------------------------------------------------------- | ------ |
| 技能市场协议 | 标准化技能描述（输入/输出/依赖/SLA），基于 EvoMap Gene 格式 | P0     |
| 按需调用     | REST/gRPC 远程技能调用，跨组织代理委派                      | P0     |
| 版本管理     | Skill 语义化版本、向后兼容检测、自动迁移                    | P1     |
| 组合编排     | 多个远程 Skill 组合为 Pipeline，DAG 编排执行                | P1     |

#### 2.2 代币激励机制

| 子模块       | 内容                                            | 优先级 |
| ------------ | ----------------------------------------------- | ------ |
| 贡献奖励     | 发布高质量 Skill/Gene 获得代币，社区使用量加权  | P0     |
| 算力贡献     | 提供 GPU/CPU 推理算力获得代币，按实际使用量结算 | P0     |
| 数据贡献     | 贡献脱敏训练数据获得代币，隐私保护 + 质量评分   | P1     |
| 信誉加权定价 | 高信誉代理的 Skill 可设置更高价格，市场动态定价 | P2     |

#### 2.3 去中心化推理网络

| 子模块       | 内容                                               | 优先级 |
| ------------ | -------------------------------------------------- | ------ |
| 推理节点注册 | GPU/CPU 节点自注册，算力基准测试，可用性 SLA 承诺  | P0     |
| 任务调度     | 基于延迟/成本/算力的智能调度，支持模型分片并行推理 | P0     |
| 隐私推理     | TEE 内执行推理，输入/输出加密，模型参数不暴露      | P1     |
| 联邦学习协调 | 多节点联邦训练，梯度加密聚合，差分隐私保护         | P2     |

**KPI 目标**:

| 指标               | 目标值  |
| ------------------ | ------- |
| 市场可用 Skill 数  | > 1,000 |
| 跨节点推理延迟     | < 2 秒  |
| 代币交易 TPS       | > 100   |
| 隐私推理准确率损失 | < 3%    |

---

### 方向 3：硬件安全生态（v3.2.0）

**愿景**: 形成完整的硬件信任链生态，从芯片到卫星的全链路安全

```
┌─────────────────────────────────────────────────┐
│              硬件信任链生态                        │
│                                                 │
│   芯片层        设备层        通信层        应用层│
│  ┌──────┐    ┌──────┐    ┌──────┐    ┌──────┐  │
│  │ TEE  │───→│SIMKey│───→│ 卫星 │───→│ DApp │  │
│  │ SE   │    │ U盾  │    │ Tor  │    │ Agent│  │
│  └──────┘    └──────┘    └──────┘    └──────┘  │
│     │            │            │            │    │
│  信任根       密钥管理     离线通信      零知识  │
│  安全启动     生物绑定     抗审查        VC验证  │
└─────────────────────────────────────────────────┘
```

#### 3.1 三位一体信任根

| 子模块         | 内容                                              | 优先级 |
| -------------- | ------------------------------------------------- | ------ |
| 统一信任根协议 | U盾 + SIMKey + TEE 三端统一信任根，硬件认证链互验 | P0     |
| 跨设备密钥同步 | 基于阈值签名的多设备密钥分片，任意 2-of-3 可恢复  | P0     |
| 安全启动链     | 从固件到应用的完整启动验证链，防篡改检测          | P1     |
| 硬件指纹绑定   | 设备硬件指纹 + 生物特征双因子绑定，防克隆         | P1     |

#### 3.2 后量子密码迁移

| 子模块          | 内容                                               | 优先级 |
| --------------- | -------------------------------------------------- | ------ |
| ML-KEM 密钥封装 | 替换 RSA/ECDH 密钥交换为 ML-KEM（CRYSTALS-Kyber）  | P0     |
| ML-DSA 数字签名 | 替换 ECDSA/Ed25519 为 ML-DSA（CRYSTALS-Dilithium） | P0     |
| 混合模式过渡    | 传统 + PQC 双算法并行期，确保向后兼容              | P1     |
| SIMKey PQC 固件 | SIMKey 硬件内置 PQC 算法加速，固件 OTA 升级        | P2     |

#### 3.3 卫星通信离线安全

| 子模块           | 内容                                                  | 优先级 |
| ---------------- | ----------------------------------------------------- | ------ |
| LEO 卫星消息通道 | 低轨卫星短消息收发（Iridium/Globalstar），加密 + 压缩 | P1     |
| 离线签名同步     | 离线期间本地签名队列，联网后批量同步验证              | P1     |
| 紧急密钥吊销     | 卫星通道紧急密钥吊销广播，全网 < 30 分钟生效          | P2     |
| 灾难恢复         | 完全离线环境下的密钥恢复和身份验证流程                | P2     |

#### 3.4 开放硬件安全标准

| 子模块           | 内容                                                | 优先级 |
| ---------------- | --------------------------------------------------- | ------ |
| HSM 开放接口规范 | 定义统一的硬件安全模块接口标准（API/协议/数据格式） | P1     |
| 第三方硬件适配   | Yubikey/Ledger/Trezor 等第三方硬件适配层            | P1     |
| 合规认证框架     | FIPS 140-3 / CC EAL4+ 认证路径规划                  | P2     |

**KPI 目标**:

| 指标           | 目标值     |
| -------------- | ---------- |
| PQC 迁移覆盖率 | 100%       |
| 密钥恢复成功率 | > 99.9%    |
| 卫星消息延迟   | < 60 秒    |
| 硬件认证通过率 | FIPS 140-3 |

---

### 方向 4：全球去中心化社交（v3.3.0）

**愿景**: 跨协议、跨平台、跨国界的去中心化社交网络，实现真正的通信自由

```
┌────────────────────────────────────────────────────────┐
│                 全球去中心化社交网络                      │
│                                                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐             │
│  │ActivityPub│  │  Nostr   │  │  Matrix  │             │
│  │(Mastodon) │  │ (NIP-01) │  │ (Synapse)│             │
│  └─────┬────┘  └─────┬────┘  └─────┬────┘             │
│        │             │             │                   │
│        └──────────┬──┴─────────────┘                   │
│                   │                                    │
│          ┌────────┴────────┐                           │
│          │ 统一协议桥接层   │                           │
│          │ (Protocol Bridge)│                           │
│          └────────┬────────┘                           │
│                   │                                    │
│     ┌─────────────┼─────────────┐                     │
│     │             │             │                     │
│  ┌──┴───┐   ┌────┴───┐   ┌───┴────┐                  │
│  │AI翻译 │   │IPFS存储│   │Tor通信 │                  │
│  │多语言 │   │Filecoin│   │抗审查  │                  │
│  └──────┘   └────────┘   └────────┘                  │
└────────────────────────────────────────────────────────┘
```

#### 4.1 多协议融合桥接

| 子模块               | 内容                                                        | 优先级 |
| -------------------- | ----------------------------------------------------------- | ------ |
| ActivityPub 完整互通 | Mastodon/Misskey/Pleroma 双向互通，帖子/评论/点赞/转发同步  | P0     |
| Nostr 协议桥接       | NIP-01/04/05 事件格式兼容，中继发现，加密私信互通           | P0     |
| Matrix 集成          | Matrix 协议桥接（Synapse），E2EE 群聊互通，Spaces 映射      | P1     |
| 统一消息格式         | 跨协议消息标准化（富文本/媒体/引用/反应），无损转换         | P1     |
| 身份映射             | DID ↔ ActivityPub Actor ↔ Nostr npub ↔ Matrix MXID 统一映射 | P2     |

#### 4.2 AI 驱动社交增强

| 子模块         | 内容                                                | 优先级 |
| -------------- | --------------------------------------------------- | ------ |
| 多语言实时翻译 | 基于本地 LLM 的实时消息翻译（50+ 语言），上下文感知 | P0     |
| 智能内容推荐   | 基于本地知识库的去中心化推荐，无中心化服务器依赖    | P1     |
| 社交关系图谱   | AI 分析社交互动模式，推荐潜在联系人，识别社区结构   | P1     |
| 内容质量评估   | AI 辅助识别低质量/有害内容，去中心化共识审核        | P2     |

#### 4.3 去中心化内容存储

| 子模块            | 内容                                              | 优先级 |
| ----------------- | ------------------------------------------------- | ------ |
| IPFS 内容寻址存储 | 媒体文件/长文本内容 IPFS 存储，CID 引用，自动固定 | P0     |
| Filecoin 持久化   | 重要内容 Filecoin 存储交易，存储证明验证          | P1     |
| 内容分发加速      | 基于 P2P 节点的内容分发网络，热点内容自动缓存     | P1     |
| 内容版本管理      | IPLD DAG 内容版本链，编辑历史可追溯               | P2     |

#### 4.4 抗审查通信

| 子模块                    | 内容                                                     | 优先级 |
| ------------------------- | -------------------------------------------------------- | ------ |
| Tor 隐藏服务              | .onion 地址直连，流量混淆，出口节点多样化                | P1     |
| 域前置（Domain Fronting） | CDN 域前置策略，伪装正常 HTTPS 流量                      | P1     |
| 卫星消息广播              | 通过 LEO 卫星广播关键消息，绕过地面网络封锁              | P2     |
| 网状网络                  | BLE/WiFi Direct 本地网状网络，无互联网环境下的近距离通信 | P2     |

**KPI 目标**:

| 指标             | 目标值  |
| ---------------- | ------- |
| 协议互通覆盖     | 3+ 协议 |
| 翻译支持语言数   | 50+     |
| IPFS 内容可用率  | > 99.5% |
| 抗审查通信成功率 | > 95%   |

---

### 方向 5：EvoMap 全球进化网络（v3.4.0）

**愿景**: 基于 EvoMap GEP 协议的全球 AI 知识进化网络，让 AI 经验在社区中自然进化

#### 5.1 全球进化网络

| 子模块       | 内容                                                     | 优先级 |
| ------------ | -------------------------------------------------------- | ------ |
| 多 Hub 联邦  | 多个 EvoMap Hub 节点联邦互连，Gene 跨 Hub 流通           | P0     |
| 进化压力选择 | 社区使用数据驱动的 Gene 自然选择，高适应度 Gene 自动推广 | P0     |
| 基因重组     | 多个 Gene 自动重组产生新 Gene，组合优势探索              | P1     |
| 进化谱系追踪 | Gene 演化谱系可视化，从源头到当前版本的完整进化路径      | P2     |

#### 5.2 知识产权与治理

| 子模块          | 内容                                            | 优先级 |
| --------------- | ----------------------------------------------- | ------ |
| Gene 所有权证明 | 基于 DID + VC 的 Gene 原创性证明，防抄袭        | P0     |
| 贡献溯源        | Gene 衍生链追踪，自动分配收益给所有贡献者       | P1     |
| 社区治理 DAO    | Gene 质量投票、争议仲裁、标准制定的去中心化治理 | P2     |

---

## 实施时间线

```
2026 Q1  ┃ v1.1.0-alpha ┃ ✅ v3.0 流水线 + v3.1 NL编程 + v3.2 多模态 + v3.3 运维
         ┃              ┃ ✅ v4.0 联邦代理网络（提前交付）
         ┃              ┃ ✅ 28 后端模块 + 72 IPC + 5 前端页面 + 5 Store + 5 文档
         ┃              ┃ ✅ 单元测试 187 用例 + E2E 测试 72 用例（全部通过）
         ┃              ┃
2026 Q2  ┃ v1.1.0       ┃ ✅ B1-P1: SIMKey 统一密钥管理 + FIDO2 WebAuthn
         ┃              ┃ ✅ B2-P1: U盾 macOS/Linux 跨平台驱动
         ┃              ┃ ✅ C1-P1: AI 社交助手增强（回复建议/话题分析/关系图谱）
         ┃              ┃ ✅ C2-P1: ActivityPub 双向互通
         ┃              ┃ ✅ D1-P1: SOC 2 合规包 + 数据分类分级
         ┃              ┃ ✅ D2-P1: SCIM 2.0 用户同步
         ┃              ┃ ✅ 16 后端模块 + 46 IPC + 4 前端页面 + 2 Store + ~400 单元测试
         ┃              ┃ ✅ 生产加固: 性能基线 + 安全审查 (Phase 57)
         ┃              ┃
2026 Q3  ┃ v1.1.0-rc    ┃ ✅ B1-P2: 门限签名 + 生物特征绑定 (Phase 46)
         ┃              ┃ ✅ B2-P2: 蓝牙 U盾 BLE 通信 (Phase 47)
         ┃              ┃ ✅ C1-P2: 智能内容推荐 (Phase 48)
         ┃              ┃ ✅ C2-P2: Nostr 协议桥接 (Phase 49)
         ┃              ┃ ✅ D1-P2: DLP 防泄漏 (Phase 50)
         ┃              ┃ ✅ D2-P2: SIEM 对接（Splunk/ELK）(Phase 51)
         ┃              ┃ ✅ 13 后端模块 + 32 IPC + 6 前端页面 + 6 Store + ~395 单元测试
         ┃              ┃
2026 Q4  ┃ v1.1.0-final ┃ ✅ B1-P3: 量子迁移路线 (Phase 52, 4 IPC, 27 tests)
         ┃              ┃ ✅ B2-P3: 固件 OTA (Phase 53, 4 IPC, 22 tests)
         ┃              ┃ ✅ C1-P3: AI 社区治理 (Phase 54, 4 IPC, 25 tests)
         ┃              ┃ ✅ C2-P3: Matrix 集成 (Phase 55, 5 IPC, 26 tests)
         ┃              ┃ ✅ D2-P3: Terraform Provider (Phase 56, 4 IPC, 26 tests)
         ┃              ┃
2026 H2  ┃ v2.0.0       ┃ ✅ 联邦网络生产加固 (Phase 58, 4 IPC)
         ┃              ┃ ✅ 100 节点压测 (Phase 59, 4 IPC)
         ┃              ┃ ✅ 信誉系统调优 (Phase 60, 4 IPC)
         ┃              ┃ ✅ 跨组织 SLA (Phase 61, 5 IPC)
         ┃              ┃
2027 H1  ┃ v3.0.0       ┃ ✅ 自主技术学习引擎 (Phase 62, 5 IPC)
         ┃              ┃ ✅ 端到端自主开发 (Phase 63, 5 IPC)
         ┃              ┃ ✅ 人机协作治理框架 (Phase 64, 5 IPC)
         ┃              ┃
2027 H2  ┃ v3.1.0       ┃ ✅ 去中心化 AI 市场 (Phase 65-67, 16 IPC)
         ┃              ┃ ✅ Skill-as-a-Service + 代币激励 + 推理网络
         ┃              ┃
2028 H1  ┃ v3.2.0       ┃ ✅ 硬件安全生态 (Phase 68-71, 18 IPC)
         ┃              ┃ ✅ 三位一体信任根 + PQC全迁移 + 卫星通信 + 开放硬件
         ┃              ┃
2028 H2  ┃ v3.3.0       ┃ ✅ 全球去中心化社交 (Phase 72-75, 20 IPC)
         ┃              ┃ ✅ 多协议融合 + AI社交增强 + 去中心化存储 + 抗审查
         ┃              ┃
2029+    ┃ v3.4.0       ┃ ✅ EvoMap 全球进化网络 (Phase 76-77, 10 IPC)
         ┃              ┃ ✅ 多 Hub 联邦 + 基因IP + DAO治理
```

---

## 版本对比总表

| 版本   | 主题             | 核心技术                                                       | 状态                       |
| ------ | ---------------- | -------------------------------------------------------------- | -------------------------- |
| v1.0.0 | 企业版发布       | 95技能, P2P社交, CRDT协作, 硬件安全                            | ✅ 已发布                  |
| v1.1.0 | 全栈智能化       | 全自动流水线, NL编程, 多模态, 自主运维, B/C/D Phase 1-3        | ✅ Phase 1-3 全部完成      |
| v2.0.0 | 去中心化代理网络 | Agent DID, 联邦发现, 跨组织协作, 信誉系统, 生产加固, 压测, SLA | ✅ 提前交付（Phase 58-61） |
| v3.0.0 | 全自主 AI 开发者 | 自主学习, 端到端开发, 人机协作治理                             | ✅ 提前交付（Phase 62-64） |
| v3.1.0 | 去中心化 AI 市场 | Skill-as-a-Service, 代币激励, 推理网络                         | ✅ 提前交付（Phase 65-67） |
| v3.2.0 | 硬件安全生态     | 三位一体信任根, PQC全迁移, 卫星通信, 开放硬件                  | ✅ 提前交付（Phase 68-71） |
| v3.3.0 | 全球去中心化社交 | 多协议融合, AI社交增强, 去中心化存储, 抗审查                   | ✅ 提前交付（Phase 72-75） |
| v3.4.0 | 全球进化网络     | EvoMap 多Hub联邦, 基因IP, DAO治理                              | ✅ 提前交付（Phase 76-77） |

---

> 本文档持续更新。各模块详细规划请参阅：
>
> - [v1.1.0 实施计划](/chainlesschain/implementation-plan)
> - [流水线编排](/chainlesschain/pipeline) | [自然语言编程](/chainlesschain/nl-programming) | [多模态协作](/chainlesschain/multimodal) | [自主运维](/chainlesschain/autonomous-ops) | [代理联邦网络](/chainlesschain/agent-federation)
> - [Cowork 路线图（v3.0-v4.0 详细设计）](/chainlesschain/cowork-roadmap)
> - [SIMKey 企业版](/chainlesschain/simkey-enterprise) | [门限安全](/chainlesschain/threshold-security) | [BLE U盾](/chainlesschain/ble-ukey)
> - [智能推荐](/chainlesschain/content-recommendation) | [Nostr 桥接](/chainlesschain/nostr-bridge) | [DLP 防泄漏](/chainlesschain/dlp) | [SIEM 集成](/chainlesschain/siem)
> - [PQC 迁移](/chainlesschain/pqc-migration) | [固件 OTA](/chainlesschain/firmware-ota) | [AI 治理](/chainlesschain/governance) | [Matrix 集成](/chainlesschain/matrix-bridge) | [Terraform](/chainlesschain/terraform-provider)
> - [生产加固](/chainlesschain/production-hardening) | [联邦网络加固](/chainlesschain/federation-hardening) | [压力测试](/chainlesschain/stress-test) | [信誉优化](/chainlesschain/reputation-optimizer) | [跨组织 SLA](/chainlesschain/sla-manager)
> - [自主技术学习](/chainlesschain/tech-learning) | [自主开发者](/chainlesschain/autonomous-developer) | [协作治理](/chainlesschain/collaboration-governance)
> - [EvoMap GEP 协议](/chainlesschain/evomap)
> - [技能市场](/chainlesschain/skill-marketplace) | [代币激励](/chainlesschain/token-incentive) | [推理网络](/chainlesschain/inference-network)
> - [信任根](/chainlesschain/trust-root) | [PQC生态](/chainlesschain/pqc-ecosystem) | [卫星通信](/chainlesschain/satellite-comm) | [HSM适配](/chainlesschain/hsm-adapter)
> - [协议融合](/chainlesschain/protocol-fusion) | [AI社交增强](/chainlesschain/ai-social-enhancement) | [去中心化存储](/chainlesschain/decentralized-storage) | [抗审查](/chainlesschain/anti-censorship)
> - [EvoMap联邦](/chainlesschain/evomap-federation) | [EvoMap治理](/chainlesschain/evomap-governance)
> - [更新日志](/changelog)
