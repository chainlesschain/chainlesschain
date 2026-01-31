# ChainlessChain - 基于U盾和SIMKey的个人移动AI管理系统

<div align="center">

![Version](https://img.shields.io/badge/version-v0.27.0-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)
![Progress](https://img.shields.io/badge/progress-100%25-brightgreen.svg)
![Node](https://img.shields.io/badge/node-%3E%3D22.12.0-brightgreen.svg)
![Electron](https://img.shields.io/badge/electron-39.2.7-blue.svg)

**去中心化 · 隐私优先 · AI原生**

一个完全去中心化的个人AI助手平台,整合知识库管理、社交网络和交易辅助三大核心功能。

[English](./README_EN.md) | [设计文档](./docs/design/系统设计_个人移动AI管理系统.md) | [详细功能](./docs/FEATURES.md)

</div>

---

## ⭐ 当前版本: v0.27.1 (2026-01-27)

### 最新更新 - Phase 3/4 工作流优化全部完成 🎉

**AI引擎性能大幅提升** - 新增7个智能优化模块，任务执行成功率从40%提升至70%

#### 核心优化模块 (6,344行新代码)

- ✅ **智能任务计划缓存** - 语义相似度匹配，LLM成本减少70%，缓存命中率60-85%
- ✅ **LLM辅助多代理决策** - 三层智能决策引擎，多代理利用率提升20%，准确率92%
- ✅ **代理池复用系统** - 代理获取速度提升10倍，创建开销减少85%
- ✅ **关键路径优化** - CPM算法智能调度，复杂任务执行时间减少15-36%
- ✅ **实时质量检查** - 文件监控即时反馈，问题发现快1800倍，返工时间减少50%
- ✅ **自动阶段转换** - 事件驱动工作流，消除人为错误100%
- ✅ **智能检查点策略** - 动态间隔优化，IO开销减少30%

#### 性能提升总结

| 指标 | 优化前 | 优化后 | 提升 |
|-----|--------|--------|------|
| 任务成功率 | 40% | 70% | **+75%** |
| LLM规划成本 | 基准 | -70% | **月省$2,550** |
| 缓存命中率 | 20% | 60-85% | **+3-4x** |
| 多代理利用率 | 70% | 90% | **+20%** |
| 代理获取速度 | 基准 | 10x | **+900%** |
| 任务执行时间 | 基准 | -25% | **更快** |
| 质量发现速度 | 30分钟 | <1秒 | **1800x** |

详见: [Phase 3/4 完成总结](./docs/features/WORKFLOW_PHASE3_COMPLETION_SUMMARY.md) | [完整版本历史](./docs/CHANGELOG.md)

### 项目状态 (整体完成度: 100%)

- 🟢 **PC端桌面应用**: 100% 完成 - **生产就绪**
- 🟢 **知识库管理**: 100% 完成 - **8算法+5可视化+智能提取+6导出**
- 🟢 **AI引擎系统**: 100% 完成 - **17项优化+16个专用引擎+智能决策系统**
- 🟢 **Cowork多代理系统**: 100% 完成 - **智能编排+代理池+4技能+4集成+10+图表**
- 🟢 **企业版**: 100% 完成 - **知识库协作+DID邀请链接+企业仪表板**
- 🟢 **区块链集成**: 100% 完成 - **15链支持+RPC管理+完整UI**
- 🟢 **移动端应用**: 100% 完成 - **完整功能+桌面同步+Android P2P UI**

## 核心特性

- 🔐 **军事级安全**: SQLCipher AES-256加密 + U盾硬件密钥 + Signal协议E2E加密
- 📊 **统一日志系统**: 集中式logger管理 + 日志级别控制 + 结构化日志
- 🌐 **完全去中心化**: P2P网络(libp2p 3.1.2) + DHT + 本地数据存储
- 🧠 **AI原生**: 支持14+云LLM提供商 + Ollama本地部署 + RAG增强检索
- 🤖 **Cowork多代理协作**: AI智能编排 + 代理池复用 + 45个IPC接口 + 文件沙箱 + 10+可视化图表
- ⚡ **智能工作流优化**: 17项优化(语义缓存+智能决策+关键路径+实时质量+自动化)
- 🔌 **MCP集成**: Model Context Protocol支持,5个官方服务器 + 安全沙箱
- 📊 **知识图谱可视化**: 8个图分析算法 + 5种可视化方式 + 6种导出格式
- ⛓️ **区块链集成**: 6个智能合约 + HD钱包系统 + LayerZero跨链桥
- 🏢 **企业版**: 多身份架构 + RBAC权限 + 知识库协作 + DID邀请链接
- 📱 **跨设备协作**: Git同步 + 桌面-移动端双向同步 + 多设备P2P通信
- 🔓 **开源自主**: 226,000+行代码,243个Vue组件,完全透明可审计

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

### 4️⃣ Cowork多代理协作 + 工作流优化 (100% 完成) ✅

#### 多代理协作核心

- ✅ 智能编排系统(AI决策+单/多代理任务分配)
- ✅ 代理池复用(10x获取加速+85%开销减少)
- ✅ 文件沙箱(18+敏感文件检测+路径遍历防护)
- ✅ 长时任务管理(智能检查点+恢复机制)
- ✅ 技能系统(4个Office技能+智能匹配)
- ✅ 完整集成(RAG+LLM+错误监控+会话管理)
- ✅ 数据可视化(10+图表类型+实时监控)
- ✅ 企业级安全(5层防护+零信任+全审计)

#### 工作流智能优化 (Phase 1-4, 17项全部完成)

**Phase 1-2 核心优化 (8项)**
- ✅ RAG并行化 - 耗时减少60% (3s→1s)
- ✅ 消息聚合 - 前端性能提升50%
- ✅ 工具缓存 - 重复调用减少15%
- ✅ 文件树懒加载 - 大项目加载快80%
- ✅ LLM降级策略 - 成功率提升50% (60%→90%)
- ✅ 动态并发控制 - CPU利用率提升40%
- ✅ 智能重试策略 - 重试成功率提升183%
- ✅ 质量门禁并行 - 早期错误拦截

**Phase 3-4 智能优化 (9项)**
- ✅ 智能计划缓存 - LLM成本减少70%，命中率60-85%
- ✅ LLM辅助决策 - 多代理利用率提升20%，准确率92%
- ✅ 代理池复用 - 获取速度10x，开销减少85%
- ✅ 关键路径优化 - 执行时间减少15-36% (CPM算法)
- ✅ 实时质量检查 - 问题发现快1800x，返工减少50%
- ✅ 自动阶段转换 - 消除人为错误100%
- ✅ 智能检查点 - IO开销减少30%

**总体提升**: 任务成功率 40%→70% (+75%) | LLM成本 -70% | 执行速度 +25%

详细功能说明见 [功能文档](./docs/FEATURES.md) | [Cowork快速开始](./docs/features/COWORK_QUICK_START.md) | [Phase 3/4总结](./docs/features/WORKFLOW_PHASE3_COMPLETION_SUMMARY.md)

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
│   │   │   ├── ai-engine/    # AI引擎 + 工作流优化
│   │   │   │   ├── cowork/   # Cowork多代理协作系统
│   │   │   │   ├── smart-plan-cache.js           # 智能计划缓存
│   │   │   │   ├── llm-decision-engine.js        # LLM决策引擎
│   │   │   │   ├── critical-path-optimizer.js    # 关键路径优化
│   │   │   │   ├── real-time-quality-gate.js     # 实时质量检查
│   │   │   │   ├── task-executor.js              # 任务执行器
│   │   │   │   └── task-planner-enhanced.js      # 增强型任务规划器
│   │   │   └── monitoring/   # 监控和日志
│   │   └── renderer/         # 渲染进程 (Vue3 + 243个组件)
│   ├── contracts/            # 智能合约 (Hardhat + Solidity)
│   └── tests/                # 测试套件 (单元/集成/E2E/AI引擎)
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
- 16个专用AI引擎 + 17项智能优化 + 115个技能 + 300个工具
- 工作流优化: 智能缓存 + LLM决策 + 代理池 + 关键路径 + 实时质量

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

**工作流优化文档**:

- [🚀 Phase 3/4 完成总结](./docs/features/WORKFLOW_PHASE3_COMPLETION_SUMMARY.md) - 17项优化总览
- [💡 智能计划缓存](./docs/features/PHASE3_OPTIMIZATION3_SMART_PLAN_CACHE.md) - 语义相似度缓存
- [🧠 LLM辅助决策](./docs/features/PHASE3_OPTIMIZATION4_LLM_DECISION.md) - 智能多代理决策
- [⚡ 关键路径优化](./docs/features/PHASE3_OPTIMIZATION8_CRITICAL_PATH.md) - CPM算法调度
- [🔍 实时质量检查](./docs/features/PHASE3_OPTIMIZATION11_REALTIME_QUALITY.md) - 文件监控系统
