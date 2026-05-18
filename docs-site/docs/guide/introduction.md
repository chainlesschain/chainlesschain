# 简介

## ChainlessChain 是什么?

ChainlessChain 是一个去中心化的个人AI管理平台，整合了知识库管理、去中心化社交和交易辅助三大核心功能。通过U盾/SIMKey硬件加密和完全去中心化的架构，为用户提供军事级的隐私保护和数据安全。

## 核心理念

### 🔐 隐私至上

- **端到端加密**: 所有数据传输采用端到端加密
- **硬件级安全**: 基于U盾/SIMKey的硬件加密保护
- **零知识证明**: 服务提供方无法访问用户数据

### 🌐 完全去中心化

- **本地数据存储**: 数据存储在用户自己的设备上
- **P2P通信**: 点对点通信，无中心服务器
- **自主掌控**: 用户完全掌控自己的数据

### 🧠 AI原生

- **本地AI模型**: 支持Ollama、LLaMA、Qwen等本地模型
- **隐私保护**: AI处理完全在本地进行
- **智能增强**: AI增强的搜索、问答和内容生成

## 主要产品

### ChainlessChain 个人AI系统

完全去中心化的个人AI助手平台，提供：

- 📝 **知识库管理**: 个人第二大脑，统一管理笔记、文档、对话历史
- 💬 **去中心化社交**: 基于W3C DID标准的P2P社交网络
- 💰 **交易辅助**: 区块链交易管理和智能合约交互
- 🔄 **Git同步**: 基于Git的版本控制和多设备同步

[了解更多 →](/chainlesschain/overview)

### U盾/SIMKey厂家管理系统

功能完整的设备厂家管理平台，提供：

- 💻 **设备全生命周期管理**: 注册、激活、锁定、注销
- 📱 **多平台APP发布**: Windows、Mac、Linux、Android、iOS
- 💾 **数据备份恢复**: 加密备份和恢复到新设备
- 👥 **用户权限管理**: 角色权限和操作审计

[了解更多 →](/manufacturer/overview)

## 技术特性

### 安全性

- **U盾/SIMKey硬件加密**: 私钥永不离开硬件设备
- **多重身份验证**: 支持生物识别、硬件密钥、密码等多种方式
- **加密存储**: AES-256-GCM加密所有敏感数据
- **安全通信**: TLS 1.3 + Signal协议端到端加密

### 去中心化

- **P2P网络**: 基于libp2p的点对点网络
- **DID身份**: W3C DID标准的去中心化身份
- **无服务器依赖**: 不依赖第三方云服务
- **抗审查**: 分布式架构，无单点故障

### AI能力

- **本地大模型**: 支持Ollama、LLaMA 3、Qwen等
- **RAG检索增强**: 知识库检索增强生成
- **智能问答**: 基于个人知识库的AI问答
- **内容生成**: AI辅助写作和内容创作

### 跨平台

- **PC端**: Windows、macOS、Linux (Electron)
- **移动端**: Android (Jetpack Compose)、iOS (SwiftUI)
- **无缝同步**: 基于Git的跨设备同步

## 应用场景

### 个人知识管理

- 构建个人知识库和第二大脑
- AI增强的笔记和文档管理
- 智能搜索和知识发现
- 版本控制和历史追溯

### 隐私通信

- 端到端加密的即时通讯
- P2P文件传输
- 去中心化社交网络
- 无需信任第三方服务商

### 数字资产管理

- 加密货币钱包管理
- 智能合约交互
- 交易记录和分析
- 硬件钱包集成

### 团队协作

- 去中心化的团队协作
- 加密的文档共享
- 版本控制和冲突解决
- 无需中心服务器

## 为什么选择 ChainlessChain?

### vs 传统云笔记应用

| 特性 | ChainlessChain | 传统云笔记 |
|------|----------------|------------|
| 数据存储 | 本地设备 | 云端服务器 |
| 隐私保护 | 端到端加密 | 服务商可访问 |
| 依赖性 | 无需服务器 | 依赖云服务 |
| AI处理 | 本地模型 | 云端API |
| 费用 | 一次性 | 持续订阅 |

### vs 中心化社交平台

| 特性 | ChainlessChain | 中心化社交 |
|------|----------------|------------|
| 通信方式 | P2P直连 | 经过服务器 |
| 数据所有权 | 用户拥有 | 平台拥有 |
| 审查风险 | 无 | 有 |
| 身份认证 | DID | 平台账号 |
| 隐私保护 | Signal协议 | 取决于平台 |

## 开源生态

ChainlessChain 采用开源协议，欢迎社区贡献：

- **核心系统**: MIT License
- **加密库**: Apache 2.0 License
- **文档**: CC BY 4.0

### 参与方式

- 🐛 [报告问题](https://github.com/chainlesschain/chainlesschain/issues)
- 💡 [提交建议](https://github.com/chainlesschain/chainlesschain/discussions)
- 🔧 [贡献代码](https://github.com/chainlesschain/chainlesschain/pulls)
- 📖 [改进文档](https://github.com/chainlesschain/docs)

## 下一步

- [快速开始](/guide/getting-started) - 5分钟部署运行
- [系统架构](/guide/architecture) - 了解技术架构
- [ChainlessChain系统](/chainlesschain/overview) - 个人AI系统详解
- [厂家管理系统](/manufacturer/overview) - 设备管理平台详解

---

**用技术捍卫隐私，用AI赋能个人**


## 附录：规范章节补全（v5.0.2.34）

> 为对齐项目用户文档标准结构，下列章节补齐若干未在正文中单独列出的视角。已在正文覆盖的章节在此段仅作简述并标注 `见上文` 指引。

### 1. 概述

ChainlessChain 是面向个人的去中心化 AI 管理系统，由桌面版（Electron + Vue3）、CLI（`chainlesschain` / `cc`）、移动端（Android Jetpack Compose）三端构成。以硬件级安全（U-Key / SIMKey）、P2P 加密协议、DID 身份为基础，内置 139 个 Desktop Skills + 28 Android Skills + 109 CLI 命令，累计 14,800+ 测试。

### 2. 核心特性

- **Chat-First 入口**：桌面 v6 壳统一把笔记 / 社交 / 交易 / LLM 调用合为一条对话流
- **硬件安全**：U-Key（Windows 原生）+ SQLCipher AES-256 + DID 身份
- **插件化平台**：13 内置插件 + 社区 Registry + 企业 `.ccprofile` + MDM 三路径
- **RAG 知识库**：BM25 / TF-IDF + Qdrant 向量检索
- **多端协同**：桌面、CLI、Android 共享同一 DID 与加密同步层

### 3. 系统架构

见 [系统架构](/guide/architecture)。简述：三端（Desktop / CLI / Android）共用 Java + Python 双后端；P2P 走 libp2p + WebRTC + Signal Protocol；数据层 PostgreSQL 16 + Redis 7 + SQLCipher；AI 层 Ollama + Qdrant。

### 4. 系统定位

- **个人**：一体化 "第二大脑 + 社交 + 资产" 工作站
- **团队**：DID + 端到端加密的协作空间
- **企业**：无需 fork 源代码即可通过 Profile / MDM 换品牌 + 换 LLM + 换审计链路

### 5. 核心功能

| 模块 | 说明 |
|---|---|
| 知识库 | 笔记、RAG 搜索、版本化 |
| 社交 | Nostr / Matrix / ActivityPub 三协议桥 |
| 交易 | 资产管理、市场、智能合约 |
| AI Engine | Cowork 多 Agent、Plan Mode、Skill 系统 |
| 企业 | RBAC、SSO、合规审计 |

### 6. 技术架构

见 [技术栈](/guide/tech-stack)。核心栈：Electron 39 + Vue 3.4 + TypeScript 5.9 + Pinia 2.1 + Ant Design Vue 4.1 + Spring Boot 3.1.11 + Java 17 + FastAPI。

### 7. 系统特点

- 本地优先：默认所有数据存于本地加密磁盘
- 可插拔 LLM：Ollama / OpenAI-兼容网关 / 企业内网推理全部可热切
- V2 规范层：220+ 治理表面（`*gov-*-v2` 系列）覆盖绝大多数 CLI 子系统
- 测试驱动：14,800+ 测试（单元 + 集成 + E2E）

### 8. 应用场景

- 个人 Second Brain + 本地 AI 助手
- 研发团队 DID 协作 + 合规审计
- 金融 / 医疗桌面硬件级签名工作站
- 教育 / 培训 Skill 包分发
- 政府 / 国企 MDM 强制下发

### 9. 竞品对比

| 能力 | ChainlessChain | ChatGPT 桌面 | Obsidian | VSCode |
|---|---|---|---|---|
| 硬件级密钥 | ✅ U-Key | ❌ | ❌ | ❌ |
| DID / P2P | ✅ | ❌ | ❌ | ❌ |
| 企业整包定制 | ✅ Profile / MDM | ❌ | ⚠️ | ⚠️ |
| 本地 LLM | ✅ Ollama | ❌ | ⚠️ 插件 | ⚠️ 扩展 |
| Skill 系统 | ✅ 139+ | ❌ | ⚠️ | ⚠️ |

### 10. 配置参考

主配置目录：`%APPDATA%/chainlesschain-desktop-vue/.chainlesschain/`。关键文件：

```
.chainlesschain/
  config.json        # 主配置
  rules.md           # 项目规则（优先级 > CLAUDE.md）
```

优先级：环境变量 > `config.json` > 默认值。

### 11. 性能指标

- 冷启动到可交互：≈ 2.4s（参考机型）
- 13 个内置插件载入：≈ 38ms
- CLI 命令启动：≈ 200ms

### 12. 测试覆盖

- 累计测试：**14,800+**
- V2 治理表面：**220+**（iter16–iter28 合计 ≈ 5,984 V2 测试）
- 单元 + 集成 + E2E 三层覆盖

### 13. 安全考虑

- 本地数据：SQLCipher AES-256
- 硬件签名：U-Key（Windows 原生 / 其他平台 simulation）
- 身份：DID + ed25519
- 插件：ed25519 签名 + sha256 校验 + `trustedPublicKeys` 白名单
- P2P：Signal Protocol 双棘轮

### 14. 故障排除

- **Ollama 无响应**：`curl http://localhost:11434/api/tags` 检查
- **Qdrant 不可达**：确认 `docker-compose up -d` 启动
- **U-Key 不识别**：仅 Windows 原生；其他平台默认 simulation 模式
- 其他：见 [快速开始](/guide/getting-started) 的 FAQ

### 15. 关键文件

```
desktop-app-vue/src/main/        # Electron 主进程
desktop-app-vue/src/renderer/    # Vue3 渲染器（51 Pinia stores）
packages/cli/                    # CLI（109 命令）
backend/project-service/         # Java 后端
backend/ai-service/              # Python AI 后端
mobile-app/                      # Android
```

### 16. 使用示例

```bash
# 安装 CLI
npm i -g chainlesschain

# 启动桌面版
cd desktop-app-vue && npm install && npm run dev

# 基础对话
cc chat "帮我整理今天的会议笔记"
```

### 17. 相关文档

- [系统架构](/guide/architecture)
- [技术栈](/guide/tech-stack)
- [快速开始](/guide/getting-started)
- [桌面版 V6 对话壳](/guide/desktop-v6-shell)
- [合规与威胁情报](/guide/compliance-threat-intel)
- [去中心化社交协议](/guide/social-protocols)
- [系统设计主文档](/design/)
