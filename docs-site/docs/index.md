---
layout: home

hero:
  name: ChainlessChain
  text: 去中心化个人AI管理平台
  tagline: 军事级安全 | 完全去中心化 | AI原生
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
    details: 基于U盾/SIMKey的硬件级加密保护，端到端加密，数据完全自主掌控

  - icon: 🌐
    title: 完全去中心化
    details: 数据存储在用户自己的设备上，不依赖第三方云服务，真正的隐私保护

  - icon: 🧠
    title: AI原生
    details: 集成本地大模型，支持Ollama、LLaMA、Qwen等，保护隐私的同时享受AI能力

  - icon: 📱
    title: 跨设备协作
    details: PC端、移动端无缝同步，支持Windows、Mac、Linux、Android、iOS

  - icon: 💾
    title: 知识库管理
    details: 个人第二大脑，笔记、文档、对话历史统一管理，AI增强检索和智能问答

  - icon: 👥
    title: 去中心化社交
    details: 基于W3C DID标准，P2P通信，Signal协议端到端加密，无服务器依赖

  - icon: 🔄
    title: Git同步
    details: 基于Git的版本控制，完整历史记录，冲突解决，支持多设备同步

  - icon: 🏭
    title: 厂家管理平台
    details: 完整的U盾/SIMKey设备管理、APP版本发布、数据备份恢复系统

  - icon: 📊
    title: 可视化管理
    details: Dashboard统计报表，设备监控，用户管理，操作日志，一目了然
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

完全去中心化的个人AI助手平台，整合知识库管理、社交网络和交易辅助三大核心功能。

**主要特性:**
- 🔐 军事级安全 (U盾/SIMKey硬件加密)
- 🌐 完全去中心化 (P2P网络)
- 🧠 本地AI模型 (隐私保护)
- 📱 跨设备同步 (PC/移动端)

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
- Vue 3 + Composition API
- Element Plus / Ant Design
- Electron (桌面端)
- Jetpack Compose (Android)
- SwiftUI (iOS)

### 后端
- Spring Boot 3
- MyBatis Plus
- MySQL 8.0
- Redis 7.0
- Ollama (AI模型)

### 区块链
- Ethereum / Polygon
- Solidity智能合约
- Web3.js / Ethers.js

## 社区与支持

### 联系我们

- 📧 **邮箱**: zhanglongfa@chainlesschain.com
- 📞 **电话**: 400-1068-687
- 💬 **微信**: [企业微信](https://work.weixin.qq.com/ca/cawcde653996f7ecb2)
- 🌐 **官网**: https://chainlesschain.com

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
