# ChainlessChain 架构文档

本文档详细说明 ChainlessChain 的技术架构和项目结构。

## 目录

- [系统架构](#系统架构)
- [项目结构](#项目结构)
- [技术栈](#技术栈)
- [数据库设计](#数据库设计)
- [代码规模统计](#代码规模统计)

---

## 系统架构

### 整体架构图

```
┌───────────────────────────────────────────────────────────────────┐
│                         前端应用层                                  │
│  Desktop(Electron+Vue3) │ Browser Ext │ Mobile(uni-app)          │
├───────────────────────────────────────────────────────────────────┤
│                        业务功能层                                   │
│ 知识库 │ AI引擎 │ 社交 │ 交易 │ 企业版 │ 区块链 │ 测试           │
├───────────────────────────────────────────────────────────────────┤
│                        后端服务层                                   │
│  Project Service    │    AI Service      │   Community Forum     │
│  (Spring Boot 3.1)  │   (FastAPI)        │   (Spring Boot 3.1)   │
│  48 API端点         │   38 API端点       │   63 API端点          │
├───────────────────────────────────────────────────────────────────┤
│                        区块链层                                     │
│  Hardhat │ Ethers.js v6 │ 6个智能合约 │ HD钱包                  │
├───────────────────────────────────────────────────────────────────┤
│                        数据存储层                                   │
│  SQLite/SQLCipher  │  PostgreSQL  │  MySQL  │  Qdrant/ChromaDB  │
├───────────────────────────────────────────────────────────────────┤
│                        P2P网络层                                    │
│  libp2p 3.1.2  │  Signal E2E  │  Kademlia DHT                   │
├───────────────────────────────────────────────────────────────────┤
│                        安全层                                       │
│    U盾 (PC, 5品牌)        │     SIMKey (移动端, 规划中)         │
└───────────────────────────────────────────────────────────────────┘
```

### 架构设计原则

1. **去中心化优先** - 所有功能优先考虑去中心化实现
2. **安全第一** - 端到端加密、硬件密钥保护
3. **模块化设计** - 松耦合、高内聚
4. **可扩展性** - 支持插件、扩展
5. **跨平台支持** - PC/移动端/Web全平台

---

## 项目结构

### 根目录结构

```
chainlesschain/
├── desktop-app-vue/       # PC端桌面应用
├── backend/               # 后端服务
│   ├── project-service/   # Spring Boot 项目服务
│   └── ai-service/        # FastAPI AI服务
├── community-forum/       # 社区论坛
├── mobile-app-uniapp/     # uni-app 移动端
├── signaling-server/      # P2P 信令服务器
├── docs/                  # 文档
└── docker-compose.yml     # Docker 编排
```

### 桌面应用结构

```
desktop-app-vue/
├── src/
│   ├── main/              # Electron 主进程 (335个文件)
│   │   ├── database.js    # SQLite/SQLCipher 数据库
│   │   ├── ukey/          # U-Key 硬件集成
│   │   ├── llm/           # LLM 服务集成
│   │   ├── rag/           # RAG 检索系统
│   │   ├── did/           # DID 身份系统
│   │   ├── p2p/           # P2P 网络
│   │   ├── blockchain/    # 区块链集成
│   │   └── organization/  # 企业版组织管理
│   │
│   └── renderer/          # Vue3 渲染进程 (243个组件)
│       ├── pages/         # 23个页面视图
│       ├── components/    # 220个组件
│       └── stores/        # Pinia 状态管理
│
├── contracts/             # Hardhat 智能合约
└── tests/                 # 测试套件 (94个文件)
```

---

## 技术栈

### PC端

**框架和库**:

- Electron 39.2.6 + Vue 3.4
- Ant Design Vue 4.1.2
- Pinia 2.1.7 + Vue Router 4.2.5

**数据库**:

- SQL.js + SQLCipher (AES-256)

**P2P 和加密**:

- libp2p 3.1.2
- Signal Protocol
- U盾 SDK (Koffi FFI)

**其他**:

- Sharp 0.33 + Tesseract.js 5.0
- isomorphic-git 1.25.10
- ChromaDB 3.1.8

### 后端服务

**Project Service**:

- Spring Boot 3.1.11 + Java 17
- MyBatis Plus 3.5.9
- PostgreSQL 16 + Redis 7

**AI Service**:

- FastAPI 0.109.0+ + Python 3.9+
- Ollama + Qdrant 1.7.0+
- Sentence Transformers 2.3.0

**Community Forum**:

- Spring Boot 3.1.5 + MySQL 8.0.12
- Elasticsearch 8.11 + Redis 7.0
- Vue 3.4.0 + Element Plus 2.5.1

### 区块链

- Solidity 0.8+ + Hardhat 2.28
- Ethers.js v6.13
- OpenZeppelin Contracts 5.4
- 支持15条区块链

### Docker 服务

- Ollama (端口 11434)
- Qdrant (端口 6333)
- PostgreSQL 16 (端口 5432)
- Redis 7 (端口 6379)

---

## 数据库设计

### SQLite 主数据库

**基础表** (20+ 张):

- notes - 知识笔记
- tags - 标签系统
- chat_conversations - 对话记录
- projects - 项目管理
- did_identities - DID 身份
- contacts - 联系人

**企业版表** (14 张):

- organization_info - 组织信息
- organization_members - 组织成员
- organization_roles - 组织角色
- invitation_links - DID 邀请链接
- p2p_sync_state - P2P 同步状态

**区块链表** (10+ 张):

- blockchain_wallets - 钱包信息
- blockchain_asset_mapping - 资产映射
- bridge_transfers - 跨链桥转账

---

## 代码规模统计

### 桌面应用

| 模块     | 文件数 | 代码量     |
| -------- | ------ | ---------- |
| 主进程   | 335    | ~190,000行 |
| 渲染进程 | 243    | ~30,000行  |
| 智能合约 | 6      | 2,400行    |
| 测试文件 | 94     | ~15,000行  |

### 后端服务

| 服务            | 代码量   | API数 |
| --------------- | -------- | ----- |
| Project Service | 5,679行  | 48    |
| AI Service      | 12,417行 | 38    |
| Community Forum | 16,637行 | 63    |

### 总计

- **总代码量**: 260,000+ 行
- **总文件数**: 747+ 个
- **API端点**: 149 个
- **Vue组件**: 243 个

---

## 性能指标

### 应用性能

- **启动时间**: < 3秒
- **内存占用**: 200-500MB
- **CPU占用**: < 5% (空闲时)

### 数据库性能

- **查询响应**: < 50ms
- **全文搜索**: < 200ms
- **向量搜索**: < 100ms

---

## 安全设计

### 加密层级

1. **硬件层**: U盾/SIMKey 硬件密钥
2. **数据库层**: SQLCipher AES-256 加密
3. **传输层**: Signal Protocol E2E 加密
4. **网络层**: libp2p Noise 加密

---

## 相关文档

- [返回主文档](../README.md)
- [功能详解](./FEATURES.md)
- [开发指南](./DEVELOPMENT.md)
- [区块链文档](./BLOCKCHAIN.md)
