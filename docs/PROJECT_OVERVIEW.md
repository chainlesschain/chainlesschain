# ChainlessChain 项目概览

**版本**: v0.17.0
**更新时间**: 2025-12-29
**整体完成度**: 92%
**状态**: 🟢 活跃开发中

---

## 📌 项目简介

ChainlessChain 是一个完全去中心化的个人AI助手平台，整合**知识库管理**、**去中心化社交**和**去中心化交易**三大核心功能。采用军事级加密、P2P通信和区块链技术，实现真正的数据主权和隐私保护。

### 核心特点
- 🔐 **军事级安全**: SQLCipher AES-256 + U盾硬件密钥 + Signal E2E加密
- 🌐 **完全去中心化**: libp2p P2P网络 + DHT + 本地存储
- 🧠 **AI原生**: 14+云LLM + Ollama本地部署 + RAG增强检索
- 🎯 **19个专业AI引擎**: 覆盖代码/文档/表格/PPT/PDF/图像/视频等全场景
- ⛓️ **区块链集成**: 智能合约 + HD钱包 + MetaMask/WalletConnect
- 🔧 **可扩展架构**: 插件系统 + 技能工具系统 + 模板引擎
- 📱 **跨平台**: Electron桌面应用 + 浏览器扩展 + 移动端(规划中)

---

## 🗂️ 项目结构

\`\`\`
chainlesschain/
├── desktop-app-vue/          # 主应用 (Electron + Vue3) ⭐核心
│   ├── src/main/             # Electron 主进程 (30+ 模块)
│   │   ├── ai-engine/        # AI引擎管理器
│   │   ├── blockchain/       # 区块链集成 ⭐新增
│   │   ├── database/         # SQLCipher加密数据库 (20+ 表)
│   │   ├── engines/          # 19个专业AI引擎
│   │   ├── plugins/          # 插件系统 ⭐新增
│   │   ├── skill-tool-system/# 技能工具系统 ⭐新增
│   │   ├── speech/           # 语音识别 ⭐新增
│   │   └── [25+ 其他模块]
│   ├── src/renderer/         # Vue3 渲染进程
│   │   ├── pages/            # 25个页面组件
│   │   └── components/       # 139个UI组件
│   └── browser-extension/    # 浏览器扩展 ⭐新增
├── backend/                  # 后端微服务 (149 API)
├── contracts/                # 智能合约 (6个) ⭐新增
└── docs/                     # 文档中心 (80+)
\`\`\`

---

## ✅ 已完成的工作 (v0.17.0)

### 1. 核心模块实现 (30+ 模块)

- ✅ **database/** - SQLCipher AES-256 (20+ 表)
- ✅ **ukey/** - U盾硬件集成 (多品牌支持)
- ✅ **git/** - Git + AI自动提交
- ✅ **llm/** - LLM管理 (14+ 提供商)
- ✅ **rag/** - RAG检索 (混合搜索 + 重排序)
- ✅ **ai-engine/** - AI引擎调度器
- ✅ **engines/** - 19个专业引擎
- ✅ **p2p/** - libp2p + NAT穿透
- ✅ **blockchain/** - 智能合约 + 钱包 ⭐
- ✅ **plugins/** - 插件系统 ⭐
- ✅ **skill-tool-system/** - 技能工具 ⭐
- ✅ **speech/** - 语音识别 ⭐
- ✅ [20+ 其他模块]

### 2. 前端界面 (25页面 + 139组件)

**25个页面**: AI聊天、知识列表/详情/图谱、项目管理、插件管理、技能管理、工具管理、交易中心、Web IDE等

**139个组件**: 项目组件(54)、交易组件、社交组件、编辑器、技能工具组件等

### 3. 19个专业AI引擎

Code、Document、Excel、PPT、PDF、Image、Video、Web、Data Viz、Template等

### 4. 后端服务 (149 API)

- AI Service (38 API)
- Project Service (48 API)
- Community Forum (63 API)

### 5. 区块链集成 (50%) ⭐

- ✅ 6个智能合约 (2400+ 行 Solidity)
- ✅ HD钱包 + MetaMask/WalletConnect
- 🚧 区块链适配器

---

## 🚀 快速开始

\`\`\`bash
# 1. 安装依赖
npm install
cd desktop-app-vue && npm install

# 2. 启动Docker服务 (可选)
npm run docker:up

# 3. 启动应用
npm run dev:desktop-vue
\`\`\`

默认PIN码: \`123456\`

---

## 📊 项目统计

| 类型 | 数量 |
|------|------|
| 主进程模块 | 30+ |
| 前端页面 | 25 |
| UI组件 | 139 |
| AI引擎 | 19 |
| 后端API | 149 |
| 智能合约 | 6 |
| 总代码量 | 140,000+ 行 |

**整体完成度**: 92%

---

## 📚 相关文档

- [README.md](../README.md)
- [CURRENT_STATUS.md](./CURRENT_STATUS.md)
- [QUICK_START.md](./QUICK_START.md)
- [CLAUDE.md](../CLAUDE.md)

---

**ChainlessChain v0.17.0 - 数据主权，由你掌握！** 🚀
