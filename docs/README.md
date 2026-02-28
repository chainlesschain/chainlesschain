# ChainlessChain 文档中心

欢迎来到 ChainlessChain 文档中心!这里包含了项目的所有详细文档。

## 📚 文档导航

### 核心文档

- **[功能详解](./FEATURES.md)** - 详细功能列表和说明
  - 核心特性详解
  - 知识库管理系统
  - 去中心化社交
  - 去中心化交易
  - 企业版功能
  - AI模板系统

- **[安装指南](./INSTALLATION.md)** - 各平台详细安装步骤
  - Windows 安装
  - macOS 安装
  - Linux 安装
  - 从源码构建

- **[架构文档](./ARCHITECTURE.md)** - 技术架构和项目结构
  - 系统架构
  - 项目结构
  - 技术栈
  - 数据库设计

- **[开发指南](./DEVELOPMENT.md)** - 开发环境搭建和贡献规范
  - 快速开始
  - 开发路线图
  - 贡献指南
  - 代码规范

- **[版本历史](./CHANGELOG.md)** - 完整版本更新记录
  - 最新版本
  - 历史版本
  - 版本对比

- **[区块链文档](./BLOCKCHAIN.md)** - 区块链集成和跨链桥
  - 区块链适配器
  - 智能合约
  - 跨链桥系统
  - 钱包管理

### 功能文档 (features/)

- [MCP 用户指南](./features/MCP_USER_GUIDE.md)
- [LLM 性能仪表板](./features/LLM_PERFORMANCE_DASHBOARD.md)
- [Session Manager](./features/SESSION_MANAGER.md)
- [Error Monitor](./features/ERROR_MONITOR.md)
- [移动端与PC端数据同步](./features/MOBILE_PC_SYNC.md)

### 工作流程文档 (flows/) ⭐新增

- 开发流程和最佳实践
- 部署流程
- 测试流程

### 实施报告 (implementation-reports/) ⭐新增

- 各模块实施完成报告
- 技术实现细节
- 性能优化报告

### 状态报告 (status-reports/) ⭐新增

- 项目进度报告
- 阶段性总结
- 功能完成度统计

### 测试报告 (test-reports/) ⭐新增

- 单元测试报告
- 集成测试报告
- E2E测试报告
- 测试覆盖率统计

## 🔍 快速查找

### 我想...

- **安装应用** → [安装指南](./INSTALLATION.md)
- **了解功能** → [功能详解](./FEATURES.md)
- **开始开发** → [开发指南](./DEVELOPMENT.md)
- **理解架构** → [架构文档](./ARCHITECTURE.md)
- **使用区块链** → [区块链文档](./BLOCKCHAIN.md)
- **查看更新** → [版本历史](./CHANGELOG.md)

## 📂 完整文档目录

```
docs/
├── README.md                    # 文档中心导航 (本文件)
├── FEATURES.md                  # 功能详解
├── INSTALLATION.md              # 安装指南
├── ARCHITECTURE.md              # 架构文档
├── DEVELOPMENT.md               # 开发指南
├── CHANGELOG.md                 # 版本历史
├── BLOCKCHAIN.md                # 区块链文档
├── API_REFERENCE.md             # API参考
├── USER_MANUAL_COMPLETE.md      # 用户手册
├── QUICK_SUMMARY.md             # 快速概览
├── MANUS_OPTIMIZATION_GUIDE.md  # Manus优化指南
│
├── features/                    # 功能文档
├── flows/                       # 工作流程 (新增)
├── implementation-reports/      # 实施报告 (新增)
├── status-reports/              # 状态报告 (新增)
├── test-reports/                # 测试报告 (新增)
├── design/                      # 设计文档
├── development/                 # 开发文档
├── deployment/                  # 部署文档
├── enterprise/                  # 企业版文档
├── blockchain/                  # 区块链文档
├── mobile/                      # 移动端文档
└── ...                          # 其他20+个分类
```

## 🎯 文档更新

### v1.1.0-alpha (2026-02-28) ⭐最新

**Phase 46-51 (Q3 2026) 企业版 Phase 2**:

- ✅ **Phase 46 - 门限签名 + 生物识别 (Threshold Signatures + Biometric)**
  - Shamir 2-of-3/3-of-5/5-of-7 密钥分片
  - TEE 生物识别模板哈希绑定
  - 文档: [功能详解 - 门限签名部分](./FEATURES.md#门限签名--生物识别-threshold-signatures--biometric-新增-phase-46)

- ✅ **Phase 47 - BLE U-Key (蓝牙U盾)**
  - BLE GATT 设备发现和自动重连
  - USB/BLE 多传输选择
  - 文档: [功能详解 - BLE部分](./FEATURES.md#ble-u-key-蓝牙u盾-新增-phase-47)

- ✅ **Phase 48 - 内容推荐系统 (Content Recommendation)**
  - 本地 TF-IDF + 协同过滤推荐
  - 用户兴趣画像和衰减机制
  - 文档: [功能详解 - 推荐部分](./FEATURES.md#内容推荐系统-content-recommendation-新增-phase-48)

- ✅ **Phase 49 - Nostr 协议桥接 (Nostr Bridge)**
  - NIP-01 事件发布/订阅
  - DID ↔ Nostr npub 映射
  - 文档: [功能详解 - Nostr部分](./FEATURES.md#nostr-协议桥接-nostr-bridge-新增-phase-49)

- ✅ **Phase 50 - 数据防泄漏 (DLP)**
  - 策略驱动扫描，多通道防护
  - 4种响应动作（允许/告警/阻止/隔离）
  - 文档: [功能详解 - DLP部分](./FEATURES.md#数据防泄漏-dlp-新增-phase-50)

- ✅ **Phase 51 - SIEM 集成 (SIEM Integration)**
  - CEF/LEEF/JSON 多格式导出
  - Splunk/Elasticsearch/Azure Sentinel 支持
  - 文档: [功能详解 - SIEM部分](./FEATURES.md#siem-集成-siem-integration-新增-phase-51)

**Phase 52-56 (Q4 2026) 企业版 Phase 3**:

- ✅ **Phase 52 - 量子后加密迁移 (PQC Migration)**
  - ML-KEM/ML-DSA 后量子算法支持
  - 混合模式：传统 + 后量子双重保护
  - 自动化迁移和进度追踪
  - 文档: [功能详解 - PQC部分](./FEATURES.md#量子后加密迁移-pqc-migration-新增-phase-52)

- ✅ **Phase 53 - 固件OTA更新 (Firmware OTA)**
  - U-Key固件自动更新
  - 签名验证和安全安装
  - 自动回滚机制
  - 文档: [功能详解 - 固件OTA部分](./FEATURES.md#固件ota更新-firmware-ota-新增-phase-53)

- ✅ **Phase 54 - AI社区治理 (AI Community Governance)**
  - 提案管理和AI影响分析
  - 投票预测和治理自动化
  - 文档: [功能详解 - 治理部分](./FEATURES.md#ai社区治理-ai-community-governance-新增-phase-54)

- ✅ **Phase 55 - Matrix协议集成 (Matrix Integration)**
  - Matrix Client-Server API
  - E2EE加密消息（Olm/Megolm）
  - DID ↔ Matrix ID 桥接
  - 文档: [功能详解 - Matrix部分](./FEATURES.md#matrix协议集成-matrix-integration-新增-phase-55)

- ✅ **Phase 56 - Terraform提供商 (Terraform Provider)**
  - IaC基础设施即代码
  - 工作区和状态管理
  - Plan/Apply/Destroy运行
  - 文档: [功能详解 - Terraform部分](./FEATURES.md#terraform提供商-terraform-provider-新增-phase-56)

**Phase 57-64 (Q1 2027) 企业版 Phase 4**:

- ✅ **Phase 57 - 生产强化 (Production Hardening)**
  - 性能基线管理和回归检测
  - 自动化安全审计（5类/5级）
  - 文档: [功能详解 - 生产强化部分](./FEATURES.md#生产强化-production-hardening-新增-phase-57)

- ✅ **Phase 58 - 联邦硬化 (Federation Hardening)**
  - 熔断器模式（CLOSED/OPEN/HALF_OPEN）
  - 实时健康检查和故障隔离
  - 文档: [功能详解 - 联邦硬化部分](./FEATURES.md#联邦硬化-federation-hardening-新增-phase-58)

- ✅ **Phase 59 - 联邦压力测试 (Federation Stress Test)**
  - 可配置并发压测方案
  - 吞吐量/延迟/P95/P99完整指标
  - 文档: [功能详解 - 压力测试部分](./FEATURES.md#联邦压力测试-federation-stress-test-新增-phase-59)

- ✅ **Phase 60 - 信誉优化器 (Reputation Optimizer)**
  - 贝叶斯参数优化
  - Z-Score异常检测
  - 文档: [功能详解 - 信誉优化部分](./FEATURES.md#信誉优化器-reputation-optimizer-新增-phase-60)

- ✅ **Phase 61 - 跨组织SLA (Cross-Org SLA)**
  - SLA合约管理和违规追踪
  - 合规检查仪表板
  - 文档: [功能详解 - SLA部分](./FEATURES.md#跨组织sla-cross-org-sla-新增-phase-61)

- ✅ **Phase 62 - 技术学习引擎 (Tech Learning Engine)**
  - 8种清单格式自动检测
  - 最佳实践提取和技能合成
  - 文档: [功能详解 - 技术学习部分](./FEATURES.md#技术学习引擎-tech-learning-engine-新增-phase-62)

- ✅ **Phase 63 - 自主开发者 (Autonomous Developer)**
  - Intent→PRD→架构→代码→自审流水线
  - 架构决策记录（ADR）
  - 文档: [功能详解 - 自主开发部分](./FEATURES.md#自主开发者-autonomous-developer-新增-phase-63)

- ✅ **Phase 64 - 协作治理 (Collaboration Governance)**
  - 人机协作审批工作流
  - 渐进式自主级别（0-10）
  - 文档: [功能详解 - 协作治理部分](./FEATURES.md#协作治理-collaboration-governance-新增-phase-64)

**代码更新**:

- ⭐新增 120+个主进程文件（Phase 46-64 全部模块）
- ⭐新增 19个Pinia stores（TypeScript）
- ⭐新增 19个Vue页面（security×4, social×4, enterprise×3, ai×8）
- ⭐新增 39个数据库表
- ⭐新增 95个IPC处理器（Phase 46-64）

**文档更新**:

- 更新 [CHANGELOG.md](./CHANGELOG.md) - v1.1.0版本记录（含Phase 57-64）
- 更新 [FEATURES.md](./FEATURES.md) - 新增8个功能模块详解
- 更新 [ARCHITECTURE.md](./ARCHITECTURE.md) - 架构图和数据库设计
- 更新设计文档导航系统

### v0.26.2 (历史版本)

- ✅ 重组文档目录结构
- ✅ 新增4个文档分类 (flows/implementation-reports/status-reports/test-reports)
- ✅ 更新README版本号和最新特性
- ✅ 完善项目结构说明
- ✅ 优化文档导航系统

## 📖 文档贡献

如果你发现文档有误或需要改进,欢迎提交PR:

1. 文档使用 Markdown 格式
2. 遵循现有文档的结构和风格
3. 添加必要的代码示例和截图
4. 更新文档目录
5. 确保文档与代码同步

---

**更多信息**: 返回 [主README](../README.md)
