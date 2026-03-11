---
layout: home

hero:
  name: ChainlessChain
  text: 去中心化个人AI管理平台
  tagline: v5.0.1 进化版 | 军事级安全 | 完全去中心化 | AI原生 | 138技能 | 100 Phase | AI Agent 2.0 | Web3 深化 | 自进化AI | Headless CLI
  image:
    src: /logo.png
    alt: ChainlessChain Logo
  actions:
    - theme: brand
      text: 快速开始
      link: /guide/getting-started
    - theme: alt
      text: 查看文档
      link: /guide/introduction
    - theme: alt
      text: GitHub
      link: https://github.com/chainlesschain

features:
  - icon: 🔐
    title: 军事级安全
    details: 基于U盾/SIMKey的硬件级加密保护，Signal协议端到端加密，数据完全自主掌控

  - icon: 🌐
    title: 完全去中心化
    details: P2P网络(libp2p 3.1.2)，数据存储在用户自己的设备上，不依赖第三方云服务

  - icon: 🧠
    title: AI原生
    details: 集成14+云LLM提供商 + Ollama本地部署，16个AI专用引擎，RAG增强检索

  - icon: 📱
    title: 跨设备协作
    details: PC端、移动端无缝同步，P2P文件传输，支持Windows/Mac/Linux/Android/iOS

  - icon: 💾
    title: 知识库管理
    details: 个人第二大脑，8个图分析算法，5种可视化方式，智能实体提取，AI增强检索

  - icon: 👥
    title: 去中心化社交
    details: 基于W3C DID标准，WebRTC语音/视频通话，屏幕共享，群聊，消息转发

  - icon: 🔌
    title: MCP集成
    details: Model Context Protocol支持，5个官方服务器，安全沙箱，UI管理

  - icon: 🤖
    title: Cowork多智能体协作
    details: v5.0 AI Agent 2.0，A2A协议，工作流编排，层次化记忆，Agent经济，代码生成Agent，自进化AI，138内置技能

  - icon: 🖥️
    title: Computer Use
    details: 类似Claude Computer Use的电脑操作能力，68+ IPC处理器，视觉AI定位，工作流引擎，操作录制回放

  - icon: 🌐
    title: 浏览器插件
    details: 215个远程命令，完整浏览器自动化，网页操作/数据提取/调试工具，支持Chrome/Edge/Arc

  - icon: 🏢
    title: 企业版
    details: 去中心化组织协作，RBAC权限，实时协作编辑，版本历史，评论讨论

  - icon: 🎨
    title: AI技能系统
    details: 138个内置技能，Agent Skills开放标准，统一工具注册表(60+工具+8 MCP+138技能)，10个演示模板

  - icon: ⛓️
    title: 区块链 + Web3
    details: 零知识证明引擎，跨链互操作(5链)，DID v2.0，DAO治理2.0，隐私计算(联邦学习/MPC/同态加密)

  - icon: 🏗️
    title: 企业级平台
    details: 低代码应用构建，企业知识图谱(GraphRAG)，BI智能分析，工作流自动化(12连接器)，多租户SaaS引擎
---

## 快速开始

### 方式一：CLI 一键安装（推荐）

```bash
npm install -g chainlesschain
chainlesschain setup
chainlesschain start
```

详见 [CLI 命令行工具文档](/chainlesschain/cli)。

### 方式二：源码开发

```bash
# 克隆项目
git clone https://github.com/chainlesschain/chainlesschain.git
cd chainlesschain

# 安装依赖
npm install

# 启动Docker服务
cd backend/docker
docker-compose up -d

# 启动PC端
npm run dev:desktop-vue

# 启动移动端
npm run dev:android
```

### U盾/SIMKey厂家管理系统

```bash
# 克隆项目
git clone https://github.com/chainlesschain/manufacturer-system.git
cd manufacturer-system

# 一键启动(Docker)
# Windows
start.bat

# Linux/Mac
./start.sh

# 访问系统
# 前端: http://localhost
# API文档: http://localhost:8080/api/swagger-ui.html
# 默认账号: admin / admin123456
```

## 核心产品

### 1. ChainlessChain 个人AI管理系统

完全去中心化的个人AI助手平台（v5.0.1 进化版），整合知识库管理、社交网络和交易辅助三大核心功能，内置AI Agent 2.0生态、Web3深化、企业级平台和CLI分发系统。

**主要特性:**

- 🔐 军事级安全 (U盾/SIMKey硬件加密 + Signal协议)
- 🌐 完全去中心化 (P2P网络 + DHT)
- 🧠 16个AI专用引擎 + 14+云LLM提供商
- 📱 跨设备同步 (PC/移动端/浏览器扩展)
- 🔌 MCP集成 + 138内置技能 + 统一工具注册表
- 🎨 AI技能系统 (138技能 + Agent Skills标准 + 10演示模板)
- 💻 Headless CLI (29命令 + 5核心包 + Agent REPL + 138技能 + Plan Mode)
- ⛓️ 区块链集成 (15链 + 6个智能合约)
- 🤖 AI Agent 2.0 (A2A协议、工作流编排、层次化记忆、多模态感知、Agent经济)
- 🖥️ Computer Use (68+ IPC处理器，视觉AI，工作流引擎)
- ⛓️ Web3深化 (ZKP引擎、跨链桥接、DID v2、隐私计算、DAO v2)
- 🏗️ 企业平台 (低代码、知识图谱、BI分析、工作流自动化、多租户SaaS)
- 🧬 自进化AI (持续学习、自我诊断、行为预测、能力评估)

[查看详细文档 →](/chainlesschain/overview)

### 2. U盾/SIMKey厂家管理系统

功能完整的设备厂家管理平台，提供设备全生命周期管理、多平台APP发布、数据备份恢复等功能。

**主要功能:**

- 💻 设备管理 (注册/激活/锁定/注销)
- 📱 APP版本管理 (上传/发布/更新检查)
- 💾 数据备份恢复 (加密备份/恢复到设备)
- 👥 用户管理 (角色权限/操作审计)

[查看详细文档 →](/manufacturer/overview)

## 技术栈

### 前端

- Vue 3.4 + Composition API
- Ant Design Vue 4.1
- Electron 39.2.6 (桌面端)
- Jetpack Compose (Android)
- SwiftUI (iOS)
- libp2p 3.1.2 (P2P网络)

### 后端

- Spring Boot 3.1.11 + Java 17
- MyBatis Plus 3.5.9
- PostgreSQL 16 / SQLite
- Redis 7.0
- FastAPI (AI服务)
- Ollama (本地AI模型)

### 区块链

- Ethereum / Polygon / 15链支持
- Solidity智能合约 (6个合约)
- Hardhat开发环境
- MetaMask / WalletConnect

### 统计数据

- 📊 380,000+ 行代码
- 🧩 384+ 个Vue组件
- 🔌 735+ IPC处理器 (+178 v5.0)
- 🧪 20,400+ 测试用例 (+646 v5.0)
- 🎨 138个内置技能 + 统一工具注册表
- 💻 34个CLI命令 + 5核心包 (903测试)
- 💾 95+ 张数据库表
- 🏗️ 64个Pinia Store
- 🔧 100个开发阶段完成 (Phase 1-100)

## 社区与支持

### 联系我们

- 📧 **邮箱**: zhanglongfa@chainlesschain.com
- 📞 **电话**: 400-1068-687
- 💬 **微信**: [企业微信](https://work.weixin.qq.com/ca/cawcde653996f7ecb2)
- 🌐 **官网**: https://www.chainlesschain.com

### 加入社区

- [GitHub](https://github.com/chainlesschain)
- [论坛](https://community.chainlesschain.com)
- [文档](https://docs.chainlesschain.com)

## 开源许可

本项目采用 [MIT License](https://opensource.org/licenses/MIT) 开源许可证。

核心加密库采用 [Apache 2.0](https://www.apache.org/licenses/LICENSE-2.0) 许可证。

---

<div style="text-align: center; margin-top: 60px;">
  <p style="font-size: 18px; font-weight: bold;">用技术捍卫隐私，用AI赋能个人</p>
  <p style="color: #666;">Made with ❤️ by ChainlessChain Team</p>
</div>
