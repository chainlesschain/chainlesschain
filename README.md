# ChainlessChain - 基于U盾和SIMKey的个人移动AI管理系统

<div align="center">

![Version](https://img.shields.io/badge/version-v0.17.0-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)
![Progress](https://img.shields.io/badge/progress-92%25-brightgreen.svg)
![Phase 1](https://img.shields.io/badge/Phase%201-100%25-brightgreen.svg)
![Phase 2](https://img.shields.io/badge/Phase%202-100%25-brightgreen.svg)
![Phase 3](https://img.shields.io/badge/Phase%203-100%25-brightgreen.svg)
![Blockchain](https://img.shields.io/badge/Blockchain-50%25-yellow.svg)

**去中心化 · 隐私优先 · AI原生**

一个完全去中心化的个人AI助手平台,整合知识库管理、社交网络和交易辅助三大核心功能。

[English](./README_EN.md) | [设计文档](./系统设计_个人移动AI管理系统.md)

</div>

---

## ⭐ 当前版本: v0.17.0 (2025-12-29)

### 最新更新
- ✅ **区块链集成Phase 1-3完成** - 智能合约系统(6个合约 + 测试 + 部署)、钱包系统(内置+外部)、Hardhat开发环境
- ✅ **智能合约开发** - ChainlessToken(ERC20)、ChainlessNFT(ERC721)、托管合约、订阅合约、悬赏合约、跨链桥，2400+行代码
- ✅ **技能工具系统集成** - ToolManager + SkillManager集成到主进程，文档自动生成，前端管理页面和组件
- ✅ **浏览器扩展完善** - 自动化测试框架、用户/开发者/测试指南、测试报告生成
- ✅ **插件系统增强** - 集成技能工具系统，支持动态加载和热更新
- ✅ **语音识别系统完成** - Phase 3高级功能，音频增强、多语言检测、字幕生成
- ✅ **19个AI专用引擎** - 代码生成/审查、文档处理(Word/PDF/Excel/PPT)、图像/视频处理、Web开发、数据分析等专业引擎
- ✅ **完整后端服务体系** - Project Service (Spring Boot, 48 API) + AI Service (FastAPI, 38 API) + Community Forum (63 API)
- ✅ **139个Vue组件** - 12个页面、54个项目组件、交易组件(含托管UI)、社交组件、编辑器、技能工具组件

### 项目状态 (整体完成度: 92%)
- 🟢 **知识库管理**: 95% 完成 - **生产就绪**
- 🟢 **AI引擎系统**: 85% 完成 - **19个专用引擎**
- 🟢 **RAG检索系统**: 85% 完成 - **混合搜索+重排序**
- 🟢 **后端服务**: 90% 完成 - **3个微服务可用**
- 🟢 **技能工具系统**: 90% 完成 - **管理器+前端完整**
- 🟢 **插件系统**: 85% 完成 - **动态加载+热更新**
- 🟢 **语音识别**: 90% 完成 - **高级功能完成**
- 🟡 **区块链集成**: 50% 完成 - **阶段1-3完成** ⭐新增
- 🟡 **去中心化身份**: 75% 完成 - **DID+VC核心实现**
- 🟡 **P2P通信**: 75% 完成 - **E2E加密完成**
- 🟡 **社交系统**: 85% 完成 - **好友+动态+论坛**
- 🟡 **交易系统**: 85% 完成 - **8大模块+链上合约**
- 🟡 **浏览器扩展**: 70% 完成 - **测试框架+文档完善**
- 🔴 **U盾集成**: 40% 完成 - **仅XinJinKe驱动**
- 🟡 **移动端应用**: 10% 完成 - **框架搭建中**

## 核心特性

- 🔐 **军事级安全**: SQLCipher AES-256加密 + U盾硬件密钥 + Signal协议E2E加密 ✅
- 🌐 **完全去中心化**: P2P网络(libp2p 3.1.2) + DHT + 本地数据存储，无需中心服务器 ✅
- 🧠 **AI原生**: 支持14+云LLM提供商 + Ollama本地部署 + RAG增强检索 ✅
- 🎯 **19个AI引擎**: 代码/文档/表格/PPT/PDF/图像/视频专业处理，覆盖全场景 ✅
- ⛓️ **区块链集成**: 6个智能合约 + HD钱包系统 + MetaMask/WalletConnect + Hardhat开发环境 ✅
- 🔧 **技能工具系统**: 动态技能管理 + 工具注册 + 文档生成 + AI集成 ✅
- 🔌 **插件系统**: 动态加载 + 热更新 + 生命周期管理 + API扩展 ✅
- 🎤 **语音识别**: 实时转写 + 音频增强 + 多语言检测 + 字幕生成 ✅
- 📱 **跨设备协作**: Git同步 + 多设备P2P通信 + 离线消息队列 ✅
- 🔓 **开源自主**: 140,000+行代码，139个Vue组件，完全透明可审计 ✅
- 📸 **智能图片处理**: Tesseract.js OCR + Sharp图像处理 + 自动索引 ✅
- 💼 **微服务架构**: Project Service + AI Service + Community Forum，149个API端点 ✅
- 🔄 **数据库同步**: SQLite ↔ PostgreSQL 双向同步，软删除+冲突解决 ✅
- 🌐 **浏览器扩展**: 网页标注 + 内容提取 + AI辅助 + 自动化测试 ✅

## 三大核心功能

### 1️⃣ 知识库管理 (95% 完成) ✅

**数据库系统**:
- ✅ SQL.js + SQLCipher AES-256加密数据库（20+张表）
- ✅ 知识库项、标签、对话、项目、任务统一管理
- ✅ 软删除机制 + 自动保存 + 事务支持
- ✅ SQLite ↔ PostgreSQL 双向同步（4个核心模块）

**AI增强检索（RAG）**:
- ✅ ChromaDB/Qdrant 向量存储
- ✅ 混合搜索（向量+关键词+FTS5全文索引）
- ✅ 3种重排序算法（LLM、CrossEncoder、混合）
- ✅ 查询重写（多查询、HyDE、逐步回溯）
- ✅ 性能监控和指标收集

**文件处理**:
- ✅ 多格式导入: Markdown/PDF/Word/TXT/图片
- ✅ OCR识别: Tesseract.js，支持中英文
- ✅ 图片处理: Sharp压缩、缩略图、格式转换
- ✅ 6个专业编辑器: Code/Markdown/Excel/PPT/RichText/WebDev

**版本控制**:
- ✅ isomorphic-git纯JS实现
- ✅ AI自动生成提交消息
- ✅ 可视化冲突解决UI
- ✅ Git同步定时器

### 2️⃣ 去中心化社交 (85% 完成) ✅

**DID身份系统**:
- ✅ W3C DID Core标准 (`did:chainlesschain:<identifier>`)
- ✅ Ed25519签名密钥对 + X25519加密密钥对
- ✅ DID文档生成、签名、验证
- ✅ 多身份支持 + 助记词导出
- ⏳ P2P网络发布和解析（框架已准备）

**可验证凭证（VC）**:
- ✅ 5种凭证类型: 自我声明、技能证书、信任背书、教育凭证、工作经历
- ✅ W3C VC标准签名和验证
- ✅ 凭证生命周期管理 + 撤销机制

**P2P网络**:
- ✅ libp2p 3.1.2 节点管理
- ✅ TCP传输 + Noise加密 + Kademlia DHT
- ✅ mDNS本地发现 + 设备热插拔监听
- ✅ Signal Protocol E2E加密（完整实现）
- ✅ 设备管理 + 跨设备同步 + 离线消息队列
- ⏳ WebRTC支持（框架已准备）

**社交功能**:
- ✅ 好友管理: 请求/接受/拒绝、在线状态、分组、备注
- ✅ 社交动态: 发布、点赞、评论、分享、图片支持
- ✅ P2P加密私信: 离线消息、多设备同步

**社区论坛**（独立应用）:
- ✅ Spring Boot 3.1.5后端 (69个Java文件, 63个API)
- ✅ Vue3前端 (45个文件, 15个页面)
- ✅ 14张数据库表: 用户、帖子、回复、标签、点赞、收藏等
- ✅ Elasticsearch全文搜索 + Redis缓存
- ✅ JWT认证 + Spring Security权限管理

### 3️⃣ 去中心化交易系统 (85% 完成) ✅

总代码量: **8000+行**，8大核心模块 + 区块链智能合约

**1. 数字资产管理** (600行):
- ✅ 4种资产类型: Token、NFT、知识产品、服务凭证
- ✅ 资产创建、铸造、转账、销毁
- ✅ 余额管理 + 转账历史 + 元数据
- ✅ 批量操作支持

**2. 交易市场** (685行):
- ✅ 商品列表管理（创建、更新、上架、下架）
- ✅ 多维搜索筛选（分类、价格、标签）
- ✅ 订单管理（创建、支付、确认、取消）
- ✅ 交易历史和统计

**3. 智能合约引擎** (1102行 + 526行模板):
- ✅ 合约引擎: 条件评估、自动执行、状态管理
- ✅ 6种合约模板: 简单支付、托管、订阅、里程碑、拍卖、众筹
- ✅ 40+条件类型支持
- ✅ 串行/并行任务执行
- ✅ Webhook通知集成

**4. 托管服务** (592行):
- ✅ 4种托管类型: 简单托管、多方托管、仲裁托管、时间锁定
- ✅ 买卖双方保护机制
- ✅ 争议解决流程
- ✅ 自动/手动资金释放

**5. 知识付费** (812行):
- ✅ 知识产品加密（AES-256）+ 密钥管理
- ✅ 3种定价模式: 一次性、订阅、按需
- ✅ 购买流程 + 解密访问
- ✅ 版权保护 + DRM
- ✅ 收入分配和提现

**6. 信用评分** (637行):
- ✅ 6维度评分: 完成率、交易量、好评率、响应速度、纠纷率、账户年龄
- ✅ 5级等级: 新手(0-199)、青铜(200-499)、白银(500-999)、黄金(1000-1999)、钻石(2000+)
- ✅ 动态权重调整算法
- ✅ 实时更新 + 历史快照
- ✅ 信用记录和趋势分析

**7. 评价系统** (671行):
- ✅ 5星评分 + 文字评价 + 图片附件
- ✅ 双向评价（买家/卖家）
- ✅ 评价统计和分析
- ✅ 举报和申诉机制
- ✅ 评价可见性控制

**8. 订单管理** (集成在交易市场):
- ✅ 订单生命周期: 待付款→已付款→进行中→已完成→已取消
- ✅ 订单详情查询
- ✅ 批量订单处理
- ✅ 订单通知和提醒

**9. 区块链智能合约系统** (2400+行) ⭐新增:
- ✅ **ChainlessToken** (ERC-20代币合约, 70行)
  - 自定义名称、符号、小数位
  - Mint/Burn功能，Ownable权限控制
- ✅ **ChainlessNFT** (ERC-721 NFT合约, 140行)
  - 元数据URI支持，批量铸造
  - ERC721Enumerable可枚举扩展
- ✅ **EscrowContract** (托管合约, 260行)
  - 支持ETH/MATIC + ERC20代币
  - 争议解决机制 + 仲裁者功能
  - ReentrancyGuard防重入攻击
- ✅ **SubscriptionContract** (订阅合约, 300行)
  - 按月/按季/按年订阅
  - 自动续订机制
- ✅ **BountyContract** (悬赏合约, 330行)
  - 任务发布、申领、提交审核
  - 支持多人完成，奖金分配
- ✅ **AssetBridge** (跨链桥合约, 300行)
  - 锁定-铸造模式
  - 中继者权限管理，防重复铸造
- ✅ **完整测试套件** (600+行, 45+测试用例)
- ✅ **部署脚本** (支持多网络部署)

**10. 钱包系统** (3000+行) ⭐新增:
- ✅ **内置HD钱包** (900行)
  - BIP39助记词 + BIP44路径
  - AES-256-GCM强加密存储
  - U-Key硬件签名集成
  - EIP-155/EIP-191签名
- ✅ **外部钱包集成** (420行)
  - MetaMask连接
  - WalletConnect v1支持
  - 网络切换和事件监听
- ✅ **交易监控** (350行)
  - 交易状态追踪
  - 自动确认等待
  - 数据库持久化

**交易UI组件** (20+个):
- AssetCreate/List/Transfer - 资产管理
- Marketplace/OrderCreate/OrderDetail - 市场和订单
- ContractCreate/Detail/List/Execute/Sign - 智能合约
- EscrowList/Detail/Dispute/Statistics - 托管管理
- ContractCard/TransactionTimeline - 通用组件
- CreditScore/ReviewList/MyReviews - 信用和评价

## 技术架构

```
┌───────────────────────────────────────────────────────────────────┐
│                         前端应用层                                  │
│  Desktop(Electron+Vue3,139组件) │ Browser Ext │ Mobile(uni-app) │
├───────────────────────────────────────────────────────────────────┤
│                        业务功能层                                   │
│ 知识库(95%) │ AI引擎(85%) │ 社交(85%) │ 交易(85%) │ 区块链(50%) │
│ 技能工具(90%) │ 插件系统(85%) │ 语音识别(90%) │ P2P(75%)      │
├───────────────────────────────────────────────────────────────────┤
│                        后端服务层                                   │
│  Project Service    │    AI Service      │   Community Forum     │
│  (Spring Boot 3.1)  │   (FastAPI)        │   (Spring Boot 3.1)   │
│  48 API端点         │   38 API端点       │   63 API端点          │
│  PostgreSQL + Redis │   Ollama + Qdrant  │   MySQL + Redis       │
├───────────────────────────────────────────────────────────────────┤
│                        区块链层                                     │
│  Hardhat │ Ethers.js v6 │ 6个智能合约 │ HD钱包 │ MetaMask/WC   │
│  Ethereum/Polygon  │  ERC-20/ERC-721  │  托管/订阅/悬赏/跨链   │
├───────────────────────────────────────────────────────────────────┤
│                        数据存储层                                   │
│  SQLite/SQLCipher  │  PostgreSQL  │  MySQL  │  ChromaDB/Qdrant   │
│  (AES-256加密)     │  (项目数据)  │ (论坛)  │  (向量存储)        │
├───────────────────────────────────────────────────────────────────┤
│                        P2P网络层                                    │
│  libp2p 3.1.2  │  Signal E2E  │  Kademlia DHT  │  mDNS发现     │
├───────────────────────────────────────────────────────────────────┤
│                        安全层                                       │
│         U盾 (PC, Windows)     │     SIMKey (移动端, 规划中)       │
└───────────────────────────────────────────────────────────────────┘
```

## 🚀 快速开始

### 环境要求

- **PC端**: Node.js 20+, Docker 20.10+ (可选)
- **移动端**: Android Studio 2024+ / Xcode 15+
- **硬件**: U盾(PC) 或 支持SIMKey的SIM卡(移动端,可选)

### 安装步骤

#### 1. 克隆项目
```bash
git clone https://github.com/chainlesschain/chainlesschain.git
cd chainlesschain
```

#### 2. 启动PC端桌面应用
```bash
# 进入桌面应用目录
cd desktop-app-vue

# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

#### 3. 启动后端服务 (可选)

**Docker服务 (Ollama + Qdrant + PostgreSQL + Redis)**:
```bash
# 启动所有Docker服务
docker-compose up -d

# 查看服务状态
docker-compose ps

# 下载LLM模型 (首次运行)
docker exec chainlesschain-ollama ollama pull qwen2:7b

# 查看日志
docker-compose logs -f
```

**Project Service (Spring Boot)**:
```bash
cd backend/project-service
mvn clean compile
mvn spring-boot:run
# 访问 http://localhost:9090
# Swagger文档: http://localhost:9090/swagger-ui.html
```

**AI Service (FastAPI)**:
```bash
cd backend/ai-service
pip install -r requirements.txt
uvicorn main:app --reload --port 8001
# 访问 http://localhost:8001
# API文档: http://localhost:8001/docs
```

**Community Forum (社区论坛)**:
```bash
# 后端
cd community-forum/backend
mvn spring-boot:run
# 访问 http://localhost:8080

# 前端
cd community-forum/frontend
npm install
npm run dev
# 访问 http://localhost:3000
```

### 其他启动选项

```bash
# 从项目根目录启动桌面应用
npm run dev:desktop-vue

# Docker服务管理
npm run docker:up      # 启动所有服务
npm run docker:down    # 停止所有服务
npm run docker:logs    # 查看日志

# Android应用
cd android-app
./gradlew assembleDebug
```

## 📁 项目结构

```
chainlesschain/
├── desktop-app-vue/              # 🖥️ PC端桌面应用 (Electron + Vue3)
│   ├── src/main/                 # 主进程 (Node.js, 149个文件)
│   │   ├── database.js           # SQLite数据库 (26张表含区块链)
│   │   ├── ukey/                 # U盾管理 (XinJinKe驱动)
│   │   ├── llm/                  # LLM服务 (支持14+提供商)
│   │   ├── rag/                  # RAG系统 (6个核心模块)
│   │   ├── git/                  # Git同步 (isomorphic-git)
│   │   ├── image/                # 图片处理+OCR (Sharp+Tesseract.js)
│   │   ├── did/                  # DID身份 (W3C标准)
│   │   ├── p2p/                  # P2P网络 (libp2p + Signal)
│   │   ├── social/               # 社交功能 (好友+动态)
│   │   ├── trade/                # 交易系统 (8模块, 5625+行)
│   │   ├── blockchain/           # 区块链集成 (3000+行) ⭐新增
│   │   │   ├── wallet-manager.js      # HD钱包管理 (900行)
│   │   │   ├── external-wallet-connector.js  # MetaMask/WC (420行)
│   │   │   ├── transaction-monitor.js # 交易监控 (350行)
│   │   │   ├── blockchain-adapter.js  # 多链适配器
│   │   │   └── blockchain-config.js   # 网络配置
│   │   ├── skill-tool-system/    # 技能工具系统 ⭐新增
│   │   │   ├── skill-manager.js       # 技能管理
│   │   │   ├── tool-manager.js        # 工具管理
│   │   │   └── doc-generator.js       # 文档生成
│   │   ├── plugins/              # 插件系统 ⭐新增
│   │   │   └── plugin-manager.js      # 插件管理
│   │   ├── speech/               # 语音识别系统 ⭐新增
│   │   │   └── speech-service.js      # 语音服务
│   │   ├── vc/                   # 可验证凭证 (5种类型)
│   │   ├── ai-engine/            # AI引擎 (5个组件)
│   │   ├── engines/              # 19个专用引擎
│   │   │   ├── code-engine.js    # 代码生成/审查/重构
│   │   │   ├── document-engine.js # Word处理
│   │   │   ├── excel-engine.js   # Excel编辑
│   │   │   ├── ppt-engine.js     # PPT生成
│   │   │   ├── pdf-engine.js     # PDF操作
│   │   │   ├── image-engine.js   # 图像处理
│   │   │   ├── video-engine.js   # 视频处理
│   │   │   ├── web-engine.js     # HTML/CSS/JS
│   │   │   ├── data-engine.js    # 数据处理
│   │   │   └── ...               # 更多引擎
│   │   ├── sync/                 # 数据库同步 (4个模块)
│   │   ├── import/               # 文件导入 (4种格式)
│   │   ├── prompt/               # 提示词管理 (50+模板)
│   │   └── vector/               # 向量数据库 (ChromaDB)
│   │
│   ├── src/renderer/             # 渲染进程 (Vue3, 139个组件)
│   │   ├── pages/                # 12个页面视图
│   │   │   ├── HomePage.vue
│   │   │   ├── AIChatPage.vue
│   │   │   ├── TradingHub.vue
│   │   │   ├── SkillManagement.vue    # ⭐新增
│   │   │   ├── ToolManagement.vue     # ⭐新增
│   │   │   └── ...
│   │   ├── components/           # 业务组件
│   │   │   ├── project/          # 54个项目组件
│   │   │   ├── trade/            # 20+交易组件(含区块链)
│   │   │   ├── social/           # 25个社交组件
│   │   │   ├── skill/            # 技能组件 ⭐新增
│   │   │   ├── tool/             # 工具组件 ⭐新增
│   │   │   ├── common/           # 通用组件 ⭐新增
│   │   │   └── editors/          # 6个编辑器
│   │   └── stores/               # Pinia状态管理
│   │       ├── skill.js          # ⭐新增
│   │       └── tool.js           # ⭐新增
│   │
│   ├── contracts/                # 🔗 智能合约 (Hardhat) ⭐新增
│   │   ├── contracts/            # Solidity合约 (6个)
│   │   │   ├── tokens/           # ERC-20/ERC-721代币
│   │   │   ├── marketplace/      # 托管合约
│   │   │   ├── payment/          # 订阅/悬赏合约
│   │   │   └── bridge/           # 跨链桥
│   │   ├── test/                 # 合约测试 (45+用例)
│   │   ├── scripts/              # 部署脚本
│   │   └── hardhat.config.js     # Hardhat配置
│   │
│   ├── browser-extension/        # 🌐 浏览器扩展 ⭐新增
│   │   ├── background.js         # 后台脚本
│   │   ├── content.js            # 内容脚本
│   │   ├── test-runner.js        # 测试框架
│   │   └── *.md                  # 用户/开发者指南
│   │
│   ├── tests/                    # 测试套件 (19个文件)
│   │   ├── unit/                 # 14个单元测试
│   │   ├── integration/          # 2个集成测试
│   │   └── performance/          # 3个性能测试
│   │
│   └── scripts/                  # 工具脚本
│       ├── comprehensive-fix.js  # 综合修复工具
│       └── test-runner.js        # 测试运行器
│
├── backend/                      # 🔧 后端服务
│   ├── project-service/          # 项目管理服务
│   │   ├── src/main/java/        # 63个Java文件, 5679行
│   │   │   ├── controller/       # 6个控制器, 48 API
│   │   │   ├── service/          # 7个服务类
│   │   │   └── mapper/           # MyBatis Plus映射
│   │   └── resources/
│   │       ├── application.yml   # Spring Boot配置
│   │       └── db/migration/     # 7个数据库版本
│   │
│   └── ai-service/               # AI推理服务
│       ├── src/                  # 31个Python文件, 12417行
│       │   ├── engines/          # 处理引擎
│       │   ├── code/             # 代码智能
│       │   ├── git/              # Git管理
│       │   ├── rag/              # RAG引擎
│       │   ├── llm/              # LLM客户端
│       │   └── nlu/              # NLU处理
│       ├── main.py               # FastAPI应用, 38 API
│       └── requirements.txt
│
├── community-forum/              # 🌐 社区论坛
│   ├── backend/                  # Spring Boot 3.1.5
│   │   └── src/main/java/        # 69个Java文件, 63 API
│   │       ├── controller/       # 10个控制器
│   │       ├── service/          # 10个服务
│   │       └── entity/           # 14张数据库表
│   │
│   └── frontend/                 # Vue3 + Element Plus
│       └── src/                  # 45个文件, 10958行
│           ├── views/            # 15个页面
│           ├── components/       # UI组件
│           └── api/              # API客户端
│
├── mobile-app-uniapp/            # 📱 移动端应用 (10%完成)
│   ├── pages/                    # 页面
│   ├── services/                 # 服务层
│   └── manifest.json
│
├── docker-compose.yml            # 🐳 Docker服务配置
│   # - Ollama (端口11434)
│   # - Qdrant (端口6333)
│   # - PostgreSQL (端口5432)
│   # - Redis (端口6379)
│   # - Project Service (端口9090)
│   # - AI Service (端口8001)
│
├── docs/                         # 📚 文档
│   ├── 系统设计_个人移动AI管理系统.md (123KB)
│   ├── CLAUDE.md                 # Claude Code项目指南
│   ├── IMPLEMENTATION_COMPLETE.md
│   ├── PROJECT_PROGRESS_REPORT_2025-12-18.md
│   └── HOW_TO_RUN.md
│
└── scripts/                      # 🛠️ 工具脚本
    ├── setup.sh
    └── build.sh
```

### 项目组成说明

| 项目 | 技术栈 | 代码量 | API | 完成度 | 状态 |
|------|--------|--------|-----|-------|------|
| **desktop-app-vue** | Electron 39 + Vue3 | 110,000+行 | 120+ IPC | 92% | ✅ 生产就绪 |
| **contracts** | Hardhat + Solidity | 2,400行 | - | 100% | ✅ 已完成 |
| **browser-extension** | Vanilla JS | 2,000+行 | - | 70% | 🚧 开发中 |
| **backend/project-service** | Spring Boot 3.1 + Java 17 | 5,679行 | 48 API | 95% | ✅ 生产就绪 |
| **backend/ai-service** | FastAPI + Python 3.9+ | 12,417行 | 38 API | 85% | ✅ 功能完整 |
| **community-forum/backend** | Spring Boot 3.1 + MySQL | 5,679行 | 63 API | 90% | ✅ 生产可用 |
| **community-forum/frontend** | Vue3 + Element Plus | 10,958行 | - | 85% | ✅ 功能完整 |
| **mobile-app-uniapp** | uni-app + Vue3 | 少量 | - | 10% | 🚧 开发中 |
| **总计** | - | **150,000+行** | **149 API** | **92%** | ✅ 可投入使用 |

### 代码规模统计

**桌面应用 (desktop-app-vue)**:
- 主进程: 149个JavaScript文件
- 渲染进程: 139个Vue组件 (12页面 + 127组件)
- 交易系统: 8个模块, 5625+行代码
- 区块链系统: 钱包+合约, 5400+行代码 ⭐新增
- 技能工具系统: 集成完成 ⭐新增
- 插件系统: 动态加载完成 ⭐新增
- 语音识别: 高级功能完成 ⭐新增
- 浏览器扩展: 测试框架+文档 ⭐新增
- 19个AI引擎
- 测试文件: 19个

**智能合约 (contracts)**:
- Solidity合约: 6个, 1,500+行
- 测试文件: 3个, 600+行
- 部署脚本: 4个, 500+行
- 测试用例: 45+个

**后端服务**:
- Java代码: 132个文件, 11,358行
- Python代码: 31个文件, 12,417行
- Vue3代码: 45个文件, 10,958行
- 数据库表: 31张 (12+14+5区块链)
- API端点: 149个
- IPC处理器: 120+个

## 🗓️ 开发路线图

### 已完成 ✅
- [x] **Phase 0**: 系统设计和架构规划 (100%)
- [x] **Phase 1 (MVP - 知识库管理)**: 98% 完成
  - [x] 桌面应用框架搭建 (Electron + Vue3)
  - [x] U盾集成和加密存储 (SQLCipher)
  - [x] 本地LLM和RAG实现 (Ollama + ChromaDB)
  - [x] Git同步功能 (含冲突解决)
  - [x] 文件导入 (Markdown/PDF/Word/TXT)
  - [x] 图片上传和OCR (v0.11.0)
  - [x] 全文搜索和标签系统
  - [x] 提示词模板管理

### 进行中 🚧
- [x] **Phase 2 (去中心化社交)**: 100% 完成
  - [x] DID身份系统
  - [x] DHT网络发布
  - [x] 可验证凭证系统
  - [x] P2P通信基础 (libp2p)
  - [x] 社区论坛 (Spring Boot + Vue3)
  - [x] Signal协议端到端加密 (v0.16.0)
  - [x] 多设备支持和消息同步 (v0.16.0)
  - [x] 好友管理系统 (好友请求、在线状态、分组)
  - [x] 社交动态系统 (发布、点赞、评论、图片)

- [x] **Phase 3 (去中心化交易系统)**: 100% 完成
  - [x] 数字资产管理 (asset-manager.js - 600行)
  - [x] 交易市场 (marketplace-manager.js - 685行)
  - [x] 智能合约引擎 (contract-engine.js - 1102行 + 合约模板 526行)
  - [x] 托管服务 (escrow-manager.js - 592行)
  - [x] 知识付费系统 (knowledge-payment.js - 812行)
  - [x] 信用评分系统 (credit-score.js - 637行)
  - [x] 评价和反馈系统 (review-manager.js - 671行)
  - [x] 订单管理 (集成在交易市场)
  - [x] 完整前端UI (20+交易组件)

### 进行中 🚧

- [x] **Phase 4 (区块链集成)**: 50% 完成 ⭐
  - [x] 阶段1: 基础设施搭建 (Hardhat + 数据库扩展)
  - [x] 阶段2: 钱包系统实现 (内置HD钱包 + 外部钱包)
  - [x] 阶段3: 智能合约开发 (6个合约 + 测试 + 部署)
  - [ ] 阶段4: 区块链适配器实现 (20%)
  - [ ] 阶段5: 集成到现有模块
  - [ ] 阶段6: 前端UI适配

- [x] **Phase 5 (生态完善)**: 85% 完成 ⭐
  - [x] 语音识别功能 (Phase 3完成)
  - [x] 浏览器扩展 (测试框架+文档完善, 70%)
  - [x] 技能工具系统 (集成完成, 90%)
  - [x] 插件系统 (动态加载+热更新, 85%)
  - [ ] 完善U盾驱动 (FeiTian、WatchData、模拟驱动)
  - [ ] P2P WebRTC支持和NAT穿透优化
  - [ ] 移动端UI完善
  - [ ] 知识图谱可视化
  - [ ] 多语言支持
  - [ ] 企业版功能

### 计划中 ⏳

- [ ] **Phase 6 (生产优化)**: 规划中
  - [ ] 完整的区块链适配器
  - [ ] 跨链桥生产级实现
  - [ ] 完善的测试覆盖率
  - [ ] 性能优化和监控
  - [ ] 安全审计
  - [ ] 文档完善

### 版本历史

| 版本 | 日期 | 主要更新 |
|------|------|---------|
| v0.17.0 | 2025-12-29 | **区块链集成Phase 1-3**: 智能合约系统(6合约+测试+部署)+钱包系统(HD+外部)+技能工具系统+插件系统+浏览器扩展+语音识别Phase 3 |
| v0.16.0 | 2025-12-28 | **Phase 3完成**: 8大交易模块(5625+行)+19个AI引擎+后端服务体系(149 API)+数据库同步+测试框架 |
| v0.11.0 | 2025-12-18 | 图片上传和OCR功能 (Tesseract.js + Sharp) |
| v0.10.0 | 2025-12 | RAG重排序器(3种算法) + 查询重写 |
| v0.9.0 | 2025-11 | 文件导入功能完善 (PDF/Word/TXT) |
| v0.8.0 | 2025-11 | 可验证凭证系统 (W3C VC标准, 5种类型) |
| v0.6.1 | 2025-10 | DHT网络发布 (DID文档) |
| v0.4.0 | 2025-09 | Git冲突解决 (可视化界面) + AI提交消息 |
| v0.1.0 | 2025-08 | 首个MVP版本 |

## 🛠️ 技术栈

### PC端 (desktop-app-vue) - 主应用
- **框架**: Electron 39.2.6 + Vue 3.4 + TypeScript 5.3
- **UI组件**: Ant Design Vue 4.1.2
- **状态管理**: Pinia 2.1.7
- **路由**: Vue Router 4.2.5
- **编辑器**:
  - Milkdown 7.17.3 (Markdown)
  - Monaco Editor (代码)
  - Jspreadsheet (Excel)
- **数据库**: SQL.js + SQLCipher (AES-256)
- **Git**: isomorphic-git 1.25.10
- **P2P**: libp2p 3.1.2 + Signal Protocol
- **图片处理**: Sharp 0.33 + Tesseract.js 5.0
- **加密**: node-forge + TweetNaCl + U盾SDK (Koffi FFI)
- **向量数据库**: ChromaDB 3.1.8
- **构建**: Vite 7.2.7 + Electron Builder

### 后端服务

#### Project Service (项目管理)
- **框架**: Spring Boot 3.1.11 + Java 17
- **ORM**: MyBatis Plus 3.5.7 (建议升级到3.5.9)
- **数据库**: PostgreSQL 16
- **缓存**: Redis 7
- **Git**: JGit 6.8.0
- **连接池**: HikariCP
- **文档**: SpringDoc OpenAPI 2.2.0
- **端口**: 9090

#### AI Service (AI推理)
- **框架**: FastAPI 0.109.0+ + Python 3.9+
- **LLM**: Ollama (本地) + 14+云提供商
- **向量数据库**: Qdrant 1.7.0+ / ChromaDB 0.4.22
- **嵌入模型**: Sentence Transformers 2.3.0
- **服务器**: Uvicorn 0.27.0+
- **端口**: 8001

#### Community Forum (社区论坛)
**后端**:
- **框架**: Spring Boot 3.1.5 + Java 17
- **ORM**: MyBatis Plus 3.5.9
- **数据库**: MySQL 8.0.12
- **搜索**: Elasticsearch 8.11
- **缓存**: Redis 7.0
- **认证**: JWT 0.12.3 + Spring Security
- **文档**: SpringDoc OpenAPI 2.2.0
- **端口**: 8080

**前端**:
- **框架**: Vue 3.4.0 + Vite 5.0.8
- **UI组件**: Element Plus 2.5.1
- **状态管理**: Pinia 2.1.7
- **路由**: Vue Router 4.2.5
- **HTTP**: Axios 1.6.2
- **Markdown**: Markdown-it 14.0.0
- **端口**: 3000

### 移动端
#### Android (android-app)
- **语言**: Kotlin
- **UI**: Jetpack Compose
- **数据库**: Room ORM + SQLCipher
- **加密**: BouncyCastle
- **SIMKey**: OMAPI
- **LLM**: Ollama Android

#### React Native (mobile-app)
- **框架**: React Native 0.73.2
- **导航**: React Navigation

### Docker服务
- **LLM引擎**: Ollama (latest, 端口11434)
  - 支持模型: Qwen2-7B, LLaMA3-8B, GLM-4, MiniCPM-2B等
  - GPU加速: NVIDIA CUDA支持
- **向量数据库**:
  - Qdrant (latest, 端口6333) - 高性能向量检索
  - ChromaDB 3.1.8 - 轻量级向量存储
- **关系数据库**:
  - PostgreSQL 16 (端口5432) - Project Service
  - MySQL 8.0 (端口3306) - Community Forum
- **缓存**: Redis 7 (端口6379)
- **嵌入模型**: bge-large-zh-v1.5 / bge-small-zh-v1.5
- **RAG系统**: AnythingLLM (可选)
- **Git服务**: Gitea (可选)

### 区块链 (50% 完成) ⭐
- **智能合约**: Solidity 0.8+ + Hardhat 2.28
- **开发框架**: Hardhat Toolbox 5.0
- **合约库**: OpenZeppelin Contracts 5.4
- **交互**: Ethers.js v6.13
- **钱包**:
  - 内置: BIP39 + BIP44 + AES-256-GCM加密
  - 外部: MetaMask + WalletConnect v1
- **网络**:
  - 主网: Ethereum (Chain ID: 1), Polygon (Chain ID: 137)
  - 测试网: Sepolia (11155111), Mumbai (80001)
  - 本地: Hardhat Network (31337)
- **合约类型**:
  - ERC-20代币 (ChainlessToken)
  - ERC-721 NFT (ChainlessNFT)
  - 托管合约 (EscrowContract)
  - 订阅合约 (SubscriptionContract)
  - 悬赏合约 (BountyContract)
  - 跨链桥 (AssetBridge)

## 🤝 贡献指南

我们欢迎所有形式的贡献!

### 如何贡献
1. Fork本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启Pull Request

### 开发规范
- 代码风格: 遵循ESLint/Prettier配置
- 提交信息: 使用语义化提交 (feat/fix/docs/style/refactor/test/chore)
- 测试: 添加必要的单元测试和集成测试
- 文档: 更新相关文档和注释

详见 [CONTRIBUTING.md](./CONTRIBUTING.md)

### 优先级任务
1. 🔴 **高优先级**:
   - 完成区块链适配器实现 (阶段4-6)
   - 完善U盾驱动 (FeiTian、WatchData、模拟模式)
   - P2P WebRTC支持和NAT穿透
   - 移动端UI完善
2. 🟡 **中优先级**:
   - 浏览器扩展完善 (剩余30%)
   - 跨链桥生产级实现 (替换简化版)
   - MyBatis Plus升级到3.5.9
   - 技能工具系统完善 (剩余10%)
3. 🟢 **低优先级**:
   - 知识图谱可视化
   - 多语言支持
   - 企业版功能

## 🔒 安全声明

- **硬件密钥**: 强烈建议使用U盾或SIMKey,软件模拟仅供测试
- **备份重要**: 请务必备份助记词和密钥,丢失无法恢复
- **开源审计**: 所有加密实现开源可审计
- **安全报告**: 发现安全漏洞请发送至 security@chainlesschain.com
- **漏洞奖励**: 重大安全漏洞将给予奖励

### 已知限制

**U盾支持**:
- 仅支持Windows平台 (通过Koffi FFI调用DLL)
- 仅实现XinJinKe驱动（40%完成）
- FeiTian、WatchData驱动待实现
- macOS/Linux需要模拟模式

**区块链集成**:
- 区块链适配器未完成（阶段4-6待开发）
- 跨链桥为简化版本（生产环境建议使用Chainlink CCIP或LayerZero）
- 合约未经第三方安全审计
- 仅支持Ethereum和Polygon
- 前端UI适配未完成

**P2P网络**:
- WebRTC传输未实现（框架已准备）
- NAT穿透需要优化
- 信令服务器需要部署

**后端服务**:
- Project Service的MyBatis Plus版本3.5.7需升级到3.5.9
- AI Service需要更多集成测试
- 云LLM提供商接口需要完整实现

**移动应用**:
- uni-app版本仅完成10%
- SIMKey集成未开发

**其他**:
- 浏览器扩展完成70%（剩余功能开发中）
- 知识图谱可视化未实现
- 多语言UI未实现

## 📜 许可证

本项目采用 **MIT License** 开源许可证 - 详见 [LICENSE](./LICENSE)

核心加密库采用 **Apache 2.0** 许可证

## 📞 联系我们

### 官方渠道
- **官网**: https://www.chainlesschain.com
- **文档**: https://docs.chainlesschain.com
- **论坛**: https://community.chainlesschain.com
- **GitHub**: https://github.com/chainlesschain/chainlesschain

### 联系方式
- **Email**: zhanglongfa@chainlesschain.com
- **安全报告**: security@chainlesschain.com
- **电话**: 400-1068-687
- **微信**: https://work.weixin.qq.com/ca/cawcde653996f7ecb2

### 社区
- **技术讨论**: GitHub Discussions
- **Bug报告**: GitHub Issues
- **功能建议**: GitHub Issues

## 🙏 致谢

感谢以下开源项目和技术:

### 核心框架
- [Electron](https://www.electronjs.org/) - 跨平台桌面应用框架
- [Vue.js](https://vuejs.org/) - 渐进式JavaScript框架
- [React](https://react.dev/) - 用户界面库
- [Spring Boot](https://spring.io/projects/spring-boot) - Java应用框架

### AI & 数据
- [Ollama](https://ollama.ai/) - 本地LLM运行时
- [Qdrant](https://qdrant.tech/) - 向量数据库
- [ChromaDB](https://www.trychroma.com/) - AI原生嵌入式数据库
- [Tesseract.js](https://tesseract.projectnaptha.com/) - OCR识别引擎

### 加密 & 网络
- [SQLCipher](https://www.zetetic.net/sqlcipher/) - 加密数据库
- [libp2p](https://libp2p.io/) - P2P网络协议栈
- [Signal Protocol](https://signal.org/docs/) - 端到端加密协议

### 编辑器 & UI
- [Milkdown](https://milkdown.dev/) - Markdown编辑器
- [Ant Design](https://ant.design/) / [Ant Design Vue](https://antdv.com/) - 企业级UI组件库
- [Element Plus](https://element-plus.org/) - Vue 3组件库

### 工具
- [Vite](https://vitejs.dev/) - 下一代前端构建工具
- [TypeScript](https://www.typescriptlang.org/) - JavaScript超集
- [Docker](https://www.docker.com/) - 容器化平台

---

<div align="center">

## 📊 项目统计

![GitHub stars](https://img.shields.io/github/stars/chainlesschain/chainlesschain?style=social)
![GitHub forks](https://img.shields.io/github/forks/chainlesschain/chainlesschain?style=social)
![GitHub issues](https://img.shields.io/github/issues/chainlesschain/chainlesschain)
![GitHub pull requests](https://img.shields.io/github/issues-pr/chainlesschain/chainlesschain)

### 整体代码统计

**代码总量**: 150,000+ 行
- Desktop App: 110,000+ 行 (JavaScript/TypeScript/Vue)
- Smart Contracts: 2,400 行 (Solidity + 测试 + 脚本)
- Browser Extension: 2,000+ 行 (JavaScript)
- Backend Services: 23,775 行 (Java + Python)
- Community Forum: 10,958 行 (Vue3)

**组件和文件**:
- Vue组件: 184+ 个 (桌面139 + 论坛45)
- JavaScript文件: 149 个 (主进程)
- Solidity合约: 6 个
- Java文件: 132 个
- Python文件: 31 个
- 测试文件: 22 个 (桌面19 + 合约3)

**功能模块**:
- 19个AI专用引擎
- 8大交易模块 (5625+行)
- 区块链系统 (5400+行) ⭐新增
  - 钱包系统 (3000+行)
  - 智能合约 (2400+行)
- 技能工具系统 ⭐新增
- 插件系统 ⭐新增
- 语音识别系统 ⭐新增
- 浏览器扩展 ⭐新增
- 6个RAG核心模块
- 5个AI引擎组件
- 4个数据库同步模块

**后端服务**:
- API端点总数: 149个
  - Project Service: 48 API
  - AI Service: 38 API
  - Community Forum: 63 API
- 数据库表: 31张 (含5张区块链表)
- IPC处理器: 120+ 个

**测试覆盖**:
- 单元测试: 17个文件 (桌面14 + 合约3)
- 集成测试: 2个文件
- 性能测试: 3个文件
- 测试用例: 445+个 (桌面400+ + 合约45+)

**整体完成度: 92%**

**用技术捍卫隐私,用AI赋能个人**

Made with ❤️ by ChainlessChain Team

[⬆ 回到顶部](#chainlesschain---基于u盾和simkey的个人移动ai管理系统)

</div>
