# ChainlessChain 隐私政策 / Privacy Policy

**生效日期 / Effective Date**: 2026-05-16
**版本 / Version**: v5.0.3
**最近更新 / Last Updated**: 2026-05-16

---

## 中文版

### 1. 概述

厦门无链之链科技有限公司（以下简称"我们"）尊重并保护用户隐私。ChainlessChain 是一款**去中心化**的个人 AI 管理应用，采用 P2P 端到端加密架构，您的数据**主要存储在您本地设备上**，不经过我们的中心化服务器。

本政策适用于 ChainlessChain 在 iOS、Android、桌面端（macOS/Windows/Linux）及 Web 端的所有版本。

### 2. 我们收集的信息

| 类别 | 收集内容 | 用途 | 存储位置 |
|------|---------|------|---------|
| 身份标识 (DID) | 您生成的去中心化身份公钥 | 用户身份识别、P2P 通信 | 本地设备 + P2P 网络 |
| 联系人 / 好友列表 | 您添加的 DID 联系人 | 社交功能 | 本地设备（SQLCipher 加密） |
| 照片 | 您主动选择上传的图片 | 知识库、聊天 | 本地设备 |
| 音频 | 您主动录制的语音消息 | 聊天、语音转文字 | 本地设备 |
| 设备信息 | 系统版本、设备型号、应用版本 | 故障诊断、兼容性 | 本地日志 |
| 网络信息 | 本地网络发现（Bonjour）服务 | P2P 设备配对 | 仅本地局域网 |
| 支付信息 | 数字资产交易记录（如使用） | 区块链资产管理 | 本地设备 + 公链 |

**我们不收集**：精确位置、健康数据、广告标识符 (IDFA)、生物特征数据（Face ID 由 iOS 系统处理，我们不接触原始数据）。

### 3. 第三方服务

ChainlessChain 在特定场景下会使用以下第三方服务：

- **Apple 语音识别 (Speech Recognition)**：iOS 13+ 优先使用设备端识别；老设备或长句子可能上传至 Apple 服务器，由 Apple 处理（参见 Apple 隐私政策）。
- **Apple 推送服务 (APNs)**：用于接收远程通知。我们仅向 Apple 发送设备 Token + 通知正文（已端到端加密的元数据）。
- **STUN/TURN 中继 (turn.chainlesschain.com)**：当 P2P 直连失败时用作 NAT 穿透中继，仅转发加密流量，不解密内容。
- **AI 模型服务（用户配置）**：若您配置 OpenAI / Anthropic / 火山豆包等外部 LLM，您的对话内容将按您的配置发送至对应服务商。我们不强制接入任何 LLM。

### 4. 数据加密

- 本地数据库使用 **SQLCipher (AES-256)** 加密。
- P2P 消息使用 **Signal Protocol** 端到端加密。
- 身份签名使用 **Ed25519 + 抗量子 SLH-DSA**（FIPS 205）。
- 加密用途仅限于：用户认证、数字签名、端到端用户内容加密。符合美国出口管制条例 EAR 5D002.c.1 豁免条款。

### 5. 数据共享

我们**不向任何第三方出售、出租或交易**您的个人信息。仅在以下情况下共享：

- 您主动发起的 P2P 通信（仅对方可见您发送的内容）
- 法律强制要求（中国《个人信息保护法》《数据安全法》等相关条款）
- 您明确授权的第三方集成（如导出到您的私人云盘）

### 6. 您的权利

依据《个人信息保护法》和 GDPR，您有权：

- **访问**：查看您的所有数据（设置 → 数据导出）
- **更正**：随时编辑您的资料
- **删除**：卸载应用即清除本地全部数据；P2P 网络中的副本需联系对方删除
- **可携带**：导出为 JSON / Markdown / SQLite 格式
- **撤回授权**：随时关闭单项权限（相机、麦克风等）

### 7. 未成年人保护

ChainlessChain **不面向 14 周岁以下未成年人**。如发现未成年人使用，请监护人联系我们删除。

### 8. 政策更新

我们可能更新本政策。重大变更将在应用内通知，并在本页面更新生效日期。继续使用即视为接受新版本。

### 9. 联系我们

- **公司**：厦门无链之链科技有限公司
- **客服电话**：400-1068-687
- **邮箱**：privacy@chainlesschain.com
- **邮编**：361000
- **ICP 备案**：闽 ICP 备 2025105973 号-1

---

## English Version

### 1. Overview

Xiamen Chainlesschain Technology Co., Ltd. ("we") respects and protects user privacy. ChainlessChain is a **decentralized** personal AI management application built on P2P end-to-end encryption. Your data is **stored primarily on your local device** and does not pass through our centralized servers.

This policy applies to ChainlessChain across iOS, Android, Desktop (macOS/Windows/Linux), and Web.

### 2. Information We Collect

| Category | What | Purpose | Storage |
|----------|------|---------|---------|
| Identity (DID) | Your decentralized identity public key | Identification, P2P communication | Local device + P2P network |
| Contacts / Friends | DID contacts you add | Social features | Local device (SQLCipher) |
| Photos | Images you choose to upload | Knowledge base, chat | Local device |
| Audio | Voice messages you record | Chat, speech-to-text | Local device |
| Device Info | OS version, device model, app version | Diagnostics, compatibility | Local logs |
| Network Info | Bonjour local network discovery | P2P device pairing | Local LAN only |
| Payment Info | Digital asset transaction records (if used) | Blockchain asset management | Local device + public chain |

**We do NOT collect**: precise location, health data, advertising identifiers (IDFA), or biometric raw data (Face ID is handled by iOS).

### 3. Third-Party Services

- **Apple Speech Recognition**: iOS 13+ uses on-device by default; older devices or long phrases may upload to Apple servers (see Apple's Privacy Policy).
- **Apple Push Notification Service (APNs)**: For remote notifications. We send only device token + encrypted notification payload to Apple.
- **STUN/TURN Relay (turn.chainlesschain.com)**: NAT traversal fallback when P2P direct connection fails. Relays encrypted traffic only; we cannot decrypt content.
- **AI Model Services (user-configured)**: If you configure OpenAI / Anthropic / Volcengine etc., your conversations are sent to those providers per your configuration. No LLM is mandatory.

### 4. Encryption

- Local database: **SQLCipher (AES-256)**
- P2P messages: **Signal Protocol** end-to-end encryption
- Identity signatures: **Ed25519 + post-quantum SLH-DSA** (FIPS 205)
- Encryption uses are limited to: user authentication, digital signatures, and end-to-end user content encryption — qualifying for EAR §740.17(b)(1) / 5D002.c.1 license exception (TSU/ENC).

### 5. Data Sharing

We **never sell, rent, or trade** your personal information. Sharing occurs only when:

- You initiate P2P communication (recipient sees only what you send)
- Legally required (China PIPL, DSL, or equivalent jurisdiction laws)
- You explicitly authorize third-party integration (e.g., export to your private cloud)

### 6. Your Rights

Under PIPL and GDPR, you have the right to:

- **Access**: View all your data (Settings → Data Export)
- **Rectify**: Edit your profile anytime
- **Erase**: Uninstall clears all local data; P2P-replicated copies require contacting recipients
- **Portability**: Export as JSON / Markdown / SQLite
- **Withdraw consent**: Revoke any permission (camera, microphone, etc.) anytime

### 7. Children

ChainlessChain is **not intended for users under 14**. If you discover a minor using the app, please have their guardian contact us for deletion.

### 8. Policy Updates

We may update this policy. Material changes will be announced in-app and reflected on this page. Continued use constitutes acceptance.

### 9. Contact

- **Company**: Xiamen Chainlesschain Technology Co., Ltd.
- **Service Line**: 400-1068-687
- **Email**: privacy@chainlesschain.com
- **Postal Code**: 361000
- **ICP License**: 闽 ICP 备 2025105973 号-1

---

> 法律免责声明：本模板为 ChainlessChain 团队内部起草，**未经法务专业审核**。正式上架前请由公司法务或外部律师复核中文版（依据中国《个人信息保护法》《数据安全法》《网络安全法》），英文版（依据 GDPR / CCPA / Apple App Store Review Guideline 5.1.1）。
>
> Disclaimer: This template was drafted internally and **has not undergone legal review**. Before App Store submission, have this reviewed by company legal counsel or external attorneys for compliance with applicable laws (PIPL/DSL/CSL for Chinese version; GDPR/CCPA/Apple Guideline 5.1.1 for English version).
