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
│  U盾/BLE/FIDO2 │ PQC(ML-KEM/ML-DSA) │ DLP │ SIEM │ 门限签名   │
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
│   ├── main/              # Electron 主进程 (360+个文件)
│   │   ├── database.js    # SQLite/SQLCipher 数据库
│   │   ├── ukey/          # U-Key 硬件集成 ⭐Phase 45-47,52-53
│   │   │   ├── unified-key-manager.js    # BIP-32 统一密钥
│   │   │   ├── fido2-authenticator.js    # FIDO2/WebAuthn
│   │   │   ├── threshold-signature-manager.js # 门限签名
│   │   │   ├── biometric-binding.js      # 生物识别绑定
│   │   │   ├── ble-driver.js             # BLE蓝牙传输
│   │   │   ├── pqc-migration-manager.js  # 量子后加密迁移
│   │   │   ├── firmware-ota-manager.js   # 固件OTA更新
│   │   │   └── ...
│   │   ├── llm/           # LLM 服务集成
│   │   ├── rag/           # RAG 检索系统
│   │   ├── did/           # DID 身份系统
│   │   ├── p2p/           # P2P 网络
│   │   ├── blockchain/    # 区块链集成
│   │   ├── organization/  # 企业版组织管理
│   │   ├── social/        # 社交功能 ⭐Phase 48-49,54-55
│   │   │   ├── local-recommender.js  # 内容推荐引擎
│   │   │   ├── interest-profiler.js  # 兴趣画像
│   │   │   ├── nostr-bridge.js       # Nostr协议桥接
│   │   │   ├── nostr-identity.js     # Nostr身份管理
│   │   │   ├── governance-ai.js      # AI社区治理
│   │   │   ├── matrix-bridge.js      # Matrix协议集成
│   │   │   └── ...
│   │   ├── enterprise/    # 企业功能 ⭐Phase 44,56
│   │   │   ├── scim-server.js        # SCIM 2.0 服务器
│   │   │   ├── terraform-manager.js  # Terraform提供商
│   │   │   └── ...
│   │   ├── audit/         # 审计合规 ⭐Phase 43,50-51,57
│   │   │   ├── dlp-engine.js         # 数据防泄漏引擎
│   │   │   ├── dlp-policy.js         # DLP策略管理
│   │   │   ├── siem-exporter.js      # SIEM日志导出
│   │   │   ├── security-auditor.js   # 安全审计
│   │   │   └── ...
│   │   ├── performance/   # 性能管理 ⭐Phase 57
│   │   │   ├── performance-baseline.js # 性能基线
│   │   │   ├── hardening-ipc.js       # 生产强化IPC
│   │   │   └── ...
│   │   └── ai-engine/     # AI引擎
│   │       ├── cowork/    # 联邦协作 ⭐Phase 58-61
│   │       │   ├── federation-hardening.js     # 联邦硬化/熔断器
│   │       │   ├── federation-stress-tester.js # 压力测试
│   │       │   ├── reputation-optimizer.js     # 信誉优化
│   │       │   ├── sla-manager.js             # 跨组织SLA
│   │       │   └── ...
│   │       └── autonomous/ # 自主AI ⭐Phase 62-64
│   │           ├── tech-learning-engine.js     # 技术学习
│   │           ├── autonomous-developer.js     # 自主开发
│   │           ├── collaboration-governance.js # 协作治理
│   │           └── ...
│   │
│   └── renderer/          # Vue3 渲染进程 (290+个组件)
│       ├── pages/         # 47个页面视图 ⭐新增 Phase 46-64 共19个页面
│       │   ├── security/  # 门限签名、BLE、PQC迁移、固件OTA
│       │   ├── social/    # 推荐、Nostr、治理、Matrix
│       │   ├── enterprise/ # 合规、SCIM、DLP、SIEM、Terraform
│       │   └── ai/        # 生产强化、联邦硬化、压测、信誉、SLA、技术学习、自主开发、协作治理
│       ├── components/    # 250+个组件
│       └── stores/        # 70个Pinia存储 ⭐新增 Phase 46-64 共19个stores
│
├── contracts/             # Hardhat 智能合约
└── tests/                 # 测试套件 (100+个文件)
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

**Phase 46-51 表** (9 张) ⭐Phase 2 (Q3 2026):

- `threshold_key_shares` - 门限签名密钥分片（Shamir 2-of-3）
- `biometric_bindings` - 生物识别绑定（TEE模板哈希）
- `user_interest_profiles` - 用户兴趣画像
- `content_recommendations` - 内容推荐记录
- `nostr_relays` - Nostr中继服务器
- `nostr_events` - Nostr事件（NIP-01）
- `dlp_policies` - 数据防泄漏策略
- `dlp_incidents` - DLP安全事件
- `siem_exports` - SIEM日志导出记录

**Phase 52-56 表** (10 张) ⭐Phase 3 (Q4 2026):

- `pqc_keys` - 量子后加密密钥（ML-KEM/ML-DSA）
- `pqc_migration_status` - PQC迁移状态跟踪
- `firmware_versions` - U-Key固件版本信息
- `firmware_update_log` - 固件更新历史记录
- `governance_proposals` - 社区治理提案
- `governance_votes` - 治理投票记录
- `matrix_rooms` - Matrix房间信息
- `matrix_events` - Matrix消息事件
- `terraform_workspaces` - Terraform工作区
- `terraform_runs` - Terraform运行历史

**Phase 57-64 表** (20 张) ⭐Phase 4 (Q1 2027):

- `performance_baselines` - 性能基线数据
- `security_audit_reports` - 安全审计报告
- `federation_circuit_breakers` - 联邦熔断器状态
- `federation_health_checks` - 联邦健康检查记录
- `stress_test_runs` - 压力测试运行
- `stress_test_results` - 压力测试结果
- `reputation_optimization_runs` - 信誉优化运行
- `reputation_analytics` - 信誉分析记录
- `sla_contracts` - SLA合约
- `sla_violations` - SLA违规记录
- `tech_stack_profiles` - 技术栈画像
- `learned_practices` - 学习到的最佳实践
- `dev_sessions` - 自主开发会话
- `architecture_decisions` - 架构决策记录
- `governance_decisions` - 协作治理决策
- `autonomy_levels` - 自主级别配置

**总表数**: 95+ 张（基础20+ + 企业版14 + 区块链10+ + Phase 46-51 9张 + Phase 52-56 10张 + Phase 57-64 20张 + 其他）

---

## 代码规模统计

### 桌面应用

| 模块     | 文件数 | 代码量     | 备注                       |
| -------- | ------ | ---------- | -------------------------- |
| 主进程   | 400+   | ~230,000行 | ⭐Phase 46-64 全部模块     |
| 渲染进程 | 290+   | ~40,000行  | ⭐新增 19个页面/19个stores |
| 智能合约 | 6      | 2,400行    |                            |
| 测试文件 | 310+   | ~23,000行  | ⭐新增 Phase 46-64 测试    |

### 后端服务

| 服务            | 代码量   | API数 |
| --------------- | -------- | ----- |
| Project Service | 5,679行  | 48    |
| AI Service      | 12,417行 | 38    |
| Community Forum | 16,637行 | 63    |

### 总计

- **总代码量**: 310,000+ 行 ⭐Phase 46-64 新增 ~45,000 行
- **总文件数**: 880+ 个 ⭐新增 120+ 个文件
- **API端点**: 149 个
- **Vue组件**: 290+ 个 ⭐新增 38+ 个组件
- **Pinia Stores**: 70 个 ⭐新增 19 个stores（Phase 46-64）
- **IPC处理器**: 420+ 个 ⭐新增 95 个处理器（Phase 46-64）
- **数据库表**: 95+ 张 ⭐新增 39 张表（Phase 46-64）

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
