# ChainlessChain - 基于U盾和SIMKey的个人移动AI管理系统

<div align="center">

![Version](https://img.shields.io/badge/version-v0.26.2-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)
![Progress](https://img.shields.io/badge/progress-100%25-brightgreen.svg)
![Node](https://img.shields.io/badge/node-%3E%3D22.12.0-brightgreen.svg)
![Electron](https://img.shields.io/badge/electron-39.2.7-blue.svg)

**去中心化 · 隐私优先 · AI原生**

一个完全去中心化的个人AI助手平台,整合知识库管理、社交网络和交易辅助三大核心功能。

[English](./README_EN.md) | [设计文档](./docs/design/系统设计_个人移动AI管理系统.md) | [详细功能](./docs/FEATURES.md)

</div>

---

## ⭐ 当前版本: v0.26.2 (2026-01-26)

### 最新更新

- ✅ **文档结构重组** - 重新组织文档目录,新增flows/implementation-reports/status-reports等分类
- ✅ **桌面应用根目录重组** - 优化desktop-app-vue项目结构,提升代码可维护性
- ✅ **Android社交与LLM功能合并** - 完整的移动端P2P社交和AI功能集成
- ✅ **统一日志系统** - 将700+个console调用迁移到集中式logger,支持日志级别控制
- ✅ **Android P2P UI完整集成** - 8个P2P屏幕(设备发现/配对/安全验证/DID管理)
- ✅ **ChatPanel内存泄漏防护** - 4层防护机制,确保长时间运行稳定性
- ✅ **E2E测试套件** - 100%通过率,完整的端到端测试覆盖
- ✅ **测试覆盖率提升** - 新增78个AI引擎单元测试,测试实现进度达46%

更多更新详见 [完整版本历史](./docs/CHANGELOG.md)

### 项目状态 (整体完成度: 100%)

- 🟢 **PC端桌面应用**: 100% 完成 - **生产就绪**
- 🟢 **知识库管理**: 100% 完成 - **8算法+5可视化+智能提取+6导出**
- 🟢 **AI引擎系统**: 100% 完成 - **P2优化+16个专用引擎**
- 🟢 **企业版**: 100% 完成 - **知识库协作+DID邀请链接+企业仪表板**
- 🟢 **区块链集成**: 100% 完成 - **15链支持+RPC管理+完整UI**
- 🟢 **移动端应用**: 100% 完成 - **完整功能+桌面同步+Android P2P UI**

## 核心特性

- 🔐 **军事级安全**: SQLCipher AES-256加密 + U盾硬件密钥 + Signal协议E2E加密
- 📊 **统一日志系统**: 集中式logger管理 + 日志级别控制 + 结构化日志
- 🌐 **完全去中心化**: P2P网络(libp2p 3.1.2) + DHT + 本地数据存储
- 🧠 **AI原生**: 支持14+云LLM提供商 + Ollama本地部署 + RAG增强检索
- 🔌 **MCP集成**: Model Context Protocol支持,5个官方服务器 + 安全沙箱
- 📊 **知识图谱可视化**: 8个图分析算法 + 5种可视化方式 + 6种导出格式
- ⛓️ **区块链集成**: 6个智能合约 + HD钱包系统 + LayerZero跨链桥
- 🏢 **企业版**: 多身份架构 + RBAC权限 + 知识库协作 + DID邀请链接
- 📱 **跨设备协作**: Git同步 + 桌面-移动端双向同步 + 多设备P2P通信
- 🔓 **开源自主**: 220,000+行代码,243个Vue组件,完全透明可审计

更多特性详见 [功能详解](./docs/FEATURES.md)

## 三大核心功能

### 1️⃣ 知识库管理 (100% 完成) ✅

- ✅ SQLCipher AES-256加密数据库(50+张表)
- ✅ 知识图谱可视化(8算法+5可视化+智能提取)
- ✅ AI增强检索(混合搜索+3种重排序)
- ✅ 多格式导入(Markdown/PDF/Word/TXT/图片)
- ✅ 版本控制(Git集成+冲突解决)

### 2️⃣ 去中心化社交 (100% 完成) ✅

- ✅ DID身份系统(W3C标准+组织DID)
- ✅ P2P网络(libp2p + Signal E2E加密)
- ✅ 社交功能(好友+动态+群聊+文件传输)
- ✅ WebRTC语音/视频通话
- ✅ 社区论坛(Spring Boot + Vue3)

### 3️⃣ 去中心化交易 (100% 完成) ✅

- ✅ 数字资产管理(Token/NFT/知识产品)
- ✅ 智能合约引擎(5种合约类型)
- ✅ 托管服务(4种托管类型)
- ✅ 区块链集成(15链支持+跨链桥)
- ✅ 信用评分系统(6维度评分+5级等级)

详细功能说明见 [功能文档](./docs/FEATURES.md)

## 🚀 快速开始

### 环境要求

- **Node.js**: 22.12.0+ (推荐使用最新LTS版本)
- **npm**: 10.0.0+
- **Docker**: 20.10+ (可选,用于后端服务)
- **移动端**: Android Studio 2024+ / Xcode 15+ (可选)

### 安装步骤

#### 1. 克隆项目

```bash
git clone https://github.com/chainlesschain/chainlesschain.git
cd chainlesschain
```

#### 2. 启动PC端桌面应用

```bash
cd desktop-app-vue
npm install
npm run dev
```

#### 3. 启动后端服务 (可选)

```bash
# 启动Docker服务
docker-compose up -d

# 下载LLM模型
docker exec chainlesschain-ollama ollama pull qwen2:7b
```

更多详细说明见 [开发指南](./docs/DEVELOPMENT.md)

## 📥 下载安装

### 下载地址

- **GitHub Releases**: [最新版本](https://github.com/chainlesschain/chainlesschain/releases/latest)
- **Gitee Releases** (国内加速): [Gitee发布页](https://gitee.com/chainlesschaincn/chainlesschain/releases)

### 支持平台

- **Windows**: Windows 10/11 (64位) - 便携版,无需安装
- **macOS**: Intel芯片 (x64) - 拖拽安装到应用程序文件夹
- **Linux**: Ubuntu/Debian/Fedora/Arch - ZIP便携版 + DEB安装包

详细安装说明见 [安装指南](./docs/INSTALLATION.md)

## 📁 项目结构

```
chainlesschain/
├── desktop-app-vue/          # PC端桌面应用 (Electron 39.2.7 + Vue3.4)
│   ├── src/
│   │   ├── main/             # 主进程
│   │   │   ├── api/          # IPC API处理器
│   │   │   ├── config/       # 配置管理
│   │   │   ├── database/     # 数据库操作
│   │   │   ├── llm/          # LLM集成 (16个AI引擎)
│   │   │   ├── rag/          # RAG检索系统
│   │   │   ├── did/          # DID身份系统
│   │   │   ├── p2p/          # P2P网络 (libp2p)
│   │   │   ├── mcp/          # MCP集成
│   │   │   └── monitoring/   # 监控和日志
│   │   └── renderer/         # 渲染进程 (Vue3 + 243个组件)
│   ├── contracts/            # 智能合约 (Hardhat + Solidity)
│   └── tests/                # 测试套件 (单元/集成/E2E)
├── backend/
│   ├── project-service/      # Spring Boot 3.1.11 (Java 17)
│   └── ai-service/           # FastAPI + Ollama + Qdrant
├── community-forum/          # 社区论坛 (Spring Boot + Vue3)
├── mobile-app-uniapp/        # 移动端应用 (100%完成)
└── docs/                     # 完整文档系统
    ├── features/             # 功能文档
    ├── flows/                # 工作流程文档 (新增)
    ├── implementation-reports/  # 实现报告 (新增)
    ├── status-reports/       # 状态报告 (新增)
    ├── test-reports/         # 测试报告 (新增)
    └── ...                   # 20+个文档分类
```

详细结构说明见 [架构文档](./docs/ARCHITECTURE.md)

## 🛠️ 技术栈

### PC端

- Electron 39.2.6 + Vue 3.4 + Ant Design Vue 4.1
- SQLite/SQLCipher (AES-256) + libp2p 3.1.2
- 16个专用AI引擎 + 115个技能 + 300个工具

### 后端

- Spring Boot 3.1.11 + Java 17 + MyBatis Plus 3.5.9
- FastAPI + Python 3.9+ + Ollama + Qdrant

### 区块链

- Solidity 0.8+ + Hardhat 2.28 + Ethers.js v6.13
- 支持15条区块链(以太坊/Polygon/BSC/Arbitrum等)

详细技术栈见 [技术文档](./docs/ARCHITECTURE.md#技术栈)

## 🗓️ 开发路线图

### 已完成 ✅

- [x] Phase 1: 知识库管理 (100%)
- [x] Phase 2: 去中心化社交 (100%)
- [x] Phase 3: 去中心化交易 (100%)
- [x] Phase 4: 区块链集成 (100%)
- [x] Phase 5: 生态完善 (100%)

### 计划中 ⏳

- [ ] Phase 6: 生产优化 (规划中)
  - [ ] 性能优化和监控
  - [ ] 安全审计
  - [ ] 文档完善

详细路线图见 [开发计划](./docs/DEVELOPMENT.md#开发路线图)

## 🤝 贡献指南

我们欢迎所有形式的贡献!

1. Fork本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启Pull Request

详见 [贡献指南](./docs/DEVELOPMENT.md#贡献指南)

## 📜 许可证

本项目采用 **MIT License** 开源许可证 - 详见 [LICENSE](./LICENSE)

## 📞 联系我们

- **Email**: zhanglongfa@chainlesschain.com
- **安全报告**: security@chainlesschain.com
- **GitHub**: https://github.com/chainlesschain/chainlesschain

## 🙏 致谢

感谢以下开源项目: Electron, Vue.js, Spring Boot, Ollama, Qdrant, libp2p, Signal Protocol

---

**更多文档**:

- [📖 文档中心](./docs/README.md) - 完整文档导航和索引
- [✨ 功能详解](./docs/FEATURES.md) - 详细功能列表和说明
- [📥 安装指南](./docs/INSTALLATION.md) - 各平台详细安装步骤
- [🏗️ 架构文档](./docs/ARCHITECTURE.md) - 技术架构和项目结构
- [💻 开发指南](./docs/DEVELOPMENT.md) - 开发环境搭建和贡献规范
- [📝 版本历史](./docs/CHANGELOG.md) - 完整版本更新记录
- [⛓️ 区块链文档](./docs/BLOCKCHAIN.md) - 区块链集成和跨链桥
- [🔧 API参考](./docs/API_REFERENCE.md) - API接口文档
- [📚 用户手册](./docs/USER_MANUAL_COMPLETE.md) - 完整用户使用手册
