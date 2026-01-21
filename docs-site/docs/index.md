---
layout: home

hero:
  name: ChainlessChain
  text: 去中心化个人AI管理平台
  tagline: v0.26.0 | 军事级安全 | 完全去中心化 | AI原生 | 100%完成
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

  - icon: 🏢
    title: 企业版
    details: 去中心化组织协作，RBAC权限，实时协作编辑，版本历史，评论讨论

  - icon: ⛓️
    title: 区块链集成
    details: 6个智能合约，15链支持，HD钱包系统，MetaMask/WalletConnect集成
---

## 快速开始

### ChainlessChain 个人AI系统

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
npm run dev:desktop

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

完全去中心化的个人AI助手平台（v0.26.0，100%完成），整合知识库管理、社交网络和交易辅助三大核心功能。

**主要特性:**

- 🔐 军事级安全 (U盾/SIMKey硬件加密 + Signal协议)
- 🌐 完全去中心化 (P2P网络 + DHT)
- 🧠 16个AI专用引擎 + 14+云LLM提供商
- 📱 跨设备同步 (PC/移动端/浏览器扩展)
- 🔌 MCP集成 + 115技能 + 300工具
- ⛓️ 区块链集成 (15链 + 6个智能合约)

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

- 📊 220,000+ 行代码
- 🧩 243个Vue组件
- 🔌 149个API端点
- 🧪 94个测试文件，900+测试用例

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
