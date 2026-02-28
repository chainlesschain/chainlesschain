# 设计文档

本目录包含 ChainlessChain 系统的设计和架构文档。

## 文档结构

```
docs/design/
├── README.md                        # 本索引文件
├── 系统设计_主文档.md                # 主文档 (概述+技术栈+路线图+总结)
├── modules/                         # 核心模块设计
│   ├── 01_知识库管理模块.md         # 知识库/RAG/向量存储
│   ├── 02_去中心化社交模块.md       # DID/P2P/Signal加密
│   ├── 03_交易辅助模块.md           # 智能合约/信用评分
│   ├── 04_项目管理模块.md           # ⭐核心功能
│   ├── 05_企业版组织模块.md         # RBAC/组织协作
│   ├── 06_AI优化系统.md             # P2优化/高级特性
│   ├── 07_性能优化系统.md           # 三层优化体系
│   ├── 08_MCP与配置系统.md          # MCP/统一配置/预算
│   ├── 09_浏览器自动化系统.md       # ⭐v0.29.0新增 工作流/录制/诊断
│   ├── 10_远程控制系统.md           # ⭐v0.33.0新增 P2P远程/桌面控制
│   ├── 11_企业审计系统.md           # ⭐v0.34.0新增 审计日志/合规/DSR
│   ├── 12_插件市场系统.md           # ⭐v0.34.0新增 插件生命周期/社区
│   ├── 13_多代理系统.md             # ⭐v0.34.0新增 8种专业代理
│   ├── 14_SSO企业认证.md            # ⭐v0.34.0新增 SAML/OAuth/OIDC
│   ├── 15_MCP_SDK系统.md            # ⭐v0.34.0新增 Server Builder
│   ├── 16_AI技能系统.md             # ⭐v0.37.6更新 90技能+统一工具+演示模板
│   ├── 17_EvoMap系统.md             # ⭐Phase 41 GEP-A2A/Gene/Capsule
│   ├── 18_SocialAI系统.md           # ⭐Phase 42 主题分析/社交图谱/AP
│   ├── 19_Compliance系统.md         # ⭐Phase 43 SOC2/数据分类
│   ├── 20_SCIM系统.md               # ⭐Phase 44 SCIM 2.0/IdP同步
│   ├── 21_UnifiedKey系统.md         # ⭐Phase 45-47,52-53 密钥/FIDO2/USB/BLE/PQC/OTA
│   ├── 22_ContentRecommendation系统.md  # ⭐Phase 48 智能推荐/兴趣画像
│   ├── 23_NostrBridge系统.md        # ⭐Phase 49 Nostr协议桥接
│   ├── 24_DLP系统.md                # ⭐Phase 50 数据防泄漏
│   ├── 25_SIEM系统.md               # ⭐Phase 51 SIEM集成/CEF/LEEF
│   ├── 26_Governance系统.md         # ⭐Phase 54 AI社区治理
│   ├── 27_MatrixBridge系统.md       # ⭐Phase 55 Matrix集成/E2EE
│   ├── 28_Terraform系统.md          # ⭐Phase 56 Terraform/IaC
│   ├── 29_ProductionHardening系统.md # ⭐Phase 57 生产强化/性能基线
│   ├── 30_FederationHardening系统.md # ⭐Phase 58 联邦硬化/熔断器
│   ├── 31_StressTest系统.md         # ⭐Phase 59 压力测试/负载模拟
│   ├── 32_ReputationOptimizer系统.md # ⭐Phase 60 信誉优化/异常检测
│   ├── 33_SLAManager系统.md         # ⭐Phase 61 SLA管理/违约检测
│   ├── 34_TechLearning系统.md       # ⭐Phase 62 技术学习/最佳实践
│   ├── 35_AutonomousDeveloper系统.md # ⭐Phase 63 自主开发/L2编码
│   └── 36_CollaborationGovernance系统.md # ⭐Phase 64 协作治理/冲突解决
├── 安全机制设计.md                   # U盾/SIMKey安全 (含PQC/门限签名/生物识别)
├── 数据同步方案.md                   # Git/HTTP/P2P同步
├── AI模型部署方案.md                 # Ollama/云端模型
├── BROWSER_EXTENSION_PLAN.md         # 浏览器扩展规划
├── HOOKS_SYSTEM_DESIGN.md            # Hooks扩展系统
├── 实施总结与附录.md                 # 实施状态/快速开始/API
└── 系统设计_个人移动AI管理系统.md    # 原始完整文档 (归档)
```

## 快速导航

### 入门阅读

| 文档                                      | 说明                     | 推荐阅读 |
| ----------------------------------------- | ------------------------ | -------- |
| [系统设计\_主文档.md](系统设计_主文档.md) | 系统概述、技术栈、架构图 | **首选** |
| [实施总结与附录.md](实施总结与附录.md)    | 快速开始指南、API文档    | 快速上手 |

### 核心模块 (01-16)

| 模块                | 文档                                                      | 说明                                                   |
| ------------------- | --------------------------------------------------------- | ------------------------------------------------------ |
| 知识库管理          | [01\_知识库管理模块.md](modules/01_知识库管理模块.md)     | 个人第二大脑,RAG检索                                   |
| 去中心化社交        | [02\_去中心化社交模块.md](modules/02_去中心化社交模块.md) | DID身份,P2P通信                                        |
| 交易辅助            | [03\_交易辅助模块.md](modules/03_交易辅助模块.md)         | 智能合约,信用评分                                      |
| **项目管理** ⭐     | [04\_项目管理模块.md](modules/04_项目管理模块.md)         | **核心功能**,AI驱动                                    |
| 企业版组织          | [05\_企业版组织模块.md](modules/05_企业版组织模块.md)     | RBAC权限,协作                                          |
| AI优化系统          | [06_AI优化系统.md](modules/06_AI优化系统.md)              | P2优化,高级特性,永久记忆,混合搜索 ⭐                   |
| 性能优化            | [07\_性能优化系统.md](modules/07_性能优化系统.md)         | 三层优化体系                                           |
| MCP与配置           | [08_MCP与配置系统.md](modules/08_MCP与配置系统.md)        | Model Context Protocol                                 |
| **浏览器自动化** ⭐ | [09\_浏览器自动化系统.md](modules/09_浏览器自动化系统.md) | **v0.29.0新增**,工作流,录制,诊断                       |
| **远程控制系统** ⭐ | [10\_远程控制系统.md](modules/10_远程控制系统.md)         | **v0.33.0新增**,P2P远程,桌面控制                       |
| **企业审计系统** ⭐ | [11\_企业审计系统.md](modules/11_企业审计系统.md)         | **v0.34.0新增**,审计日志,合规管理                      |
| **插件市场系统** ⭐ | [12\_插件市场系统.md](modules/12_插件市场系统.md)         | **v0.34.0新增**,插件生态,社区                          |
| **多代理系统** ⭐   | [13\_多代理系统.md](modules/13_多代理系统.md)             | **v0.34.0新增**,专业代理,任务编排                      |
| **SSO企业认证** ⭐  | [14_SSO企业认证.md](modules/14_SSO企业认证.md)            | **v0.34.0新增**,SAML/OAuth/OIDC                        |
| **MCP SDK** ⭐      | [15_MCP_SDK系统.md](modules/15_MCP_SDK系统.md)            | **v0.34.0新增**,Server Builder,社区                    |
| **AI技能系统** ⭐   | [16_AI技能系统.md](modules/16_AI技能系统.md)              | **v0.37.6更新**,90技能(100% Handler),统一工具,演示模板 |

### Phase 41-45 模块 (v1.0.0)

| 模块                   | 文档                                                 | 说明                                               |
| ---------------------- | ---------------------------------------------------- | -------------------------------------------------- |
| **EvoMap系统** ⭐      | [17_EvoMap系统.md](modules/17_EvoMap系统.md)         | **Phase 41**,GEP-A2A协议,Gene/Capsule,双向同步     |
| **Social AI系统** ⭐   | [18_SocialAI系统.md](modules/18_SocialAI系统.md)     | **Phase 42**,主题分析,社交图谱,ActivityPub         |
| **Compliance系统** ⭐  | [19_Compliance系统.md](modules/19_Compliance系统.md) | **Phase 43**,SOC2合规,数据分类,DSR处理             |
| **SCIM系统** ⭐        | [20_SCIM系统.md](modules/20_SCIM系统.md)             | **Phase 44**,SCIM 2.0服务器,IdP同步                |
| **Unified Key系统** ⭐ | [21_UnifiedKey系统.md](modules/21_UnifiedKey系统.md) | **Phase 45-47,52-53**,BIP-32,FIDO2,USB,BLE,PQC,OTA |

### Phase 48-51 模块 (v1.1.0 Phase 2)

| 模块                    | 文档                                                                       | 说明                                    |
| ----------------------- | -------------------------------------------------------------------------- | --------------------------------------- |
| **内容推荐系统** ⭐     | [22_ContentRecommendation系统.md](modules/22_ContentRecommendation系统.md) | **Phase 48**,兴趣画像,本地推荐引擎      |
| **Nostr Bridge** ⭐     | [23_NostrBridge系统.md](modules/23_NostrBridge系统.md)                     | **Phase 49**,Nostr协议,中继管理,DID映射 |
| **数据防泄漏 (DLP)** ⭐ | [24_DLP系统.md](modules/24_DLP系统.md)                                     | **Phase 50**,策略驱动扫描,多通道防护    |
| **SIEM集成** ⭐         | [25_SIEM系统.md](modules/25_SIEM系统.md)                                   | **Phase 51**,CEF/LEEF/JSON,多目标导出   |

### Phase 54-56 模块 (v1.1.0 Phase 3)

| 模块                      | 文档                                                     | 说明                                      |
| ------------------------- | -------------------------------------------------------- | ----------------------------------------- |
| **AI社区治理** ⭐         | [26_Governance系统.md](modules/26_Governance系统.md)     | **Phase 54**,提案管理,AI影响分析,投票预测 |
| **Matrix集成** ⭐         | [27_MatrixBridge系统.md](modules/27_MatrixBridge系统.md) | **Phase 55**,CS API,E2EE消息,房间管理     |
| **Terraform Provider** ⭐ | [28_Terraform系统.md](modules/28_Terraform系统.md)       | **Phase 56**,工作空间,Plan/Apply/Destroy  |

### Phase 57-61 模块 (v2.0.0 生产强化)

| 模块              | 文档                                                                   | 说明                                       |
| ----------------- | ---------------------------------------------------------------------- | ------------------------------------------ |
| **生产强化** ⭐   | [29_ProductionHardening系统.md](modules/29_ProductionHardening系统.md) | **Phase 57**,性能基线,安全审计,强化建议    |
| **联邦硬化** ⭐   | [30_FederationHardening系统.md](modules/30_FederationHardening系统.md) | **Phase 58**,熔断器,健康检查,连接池        |
| **压力测试** ⭐   | [31_StressTest系统.md](modules/31_StressTest系统.md)                   | **Phase 59**,并发测试,负载模拟,瓶颈识别    |
| **信誉优化器** ⭐ | [32_ReputationOptimizer系统.md](modules/32_ReputationOptimizer系统.md) | **Phase 60**,贝叶斯优化,异常检测,防作弊    |
| **跨组织SLA** ⭐  | [33_SLAManager系统.md](modules/33_SLAManager系统.md)                   | **Phase 61**,SLA合约,多级SLA,违约检测,补偿 |

### Phase 62-64 模块 (v3.0.0 自主AI)

| 模块                | 文档                                                                           | 说明                                             |
| ------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------ |
| **技术学习引擎** ⭐ | [34_TechLearning系统.md](modules/34_TechLearning系统.md)                       | **Phase 62**,技术栈分析,最佳实践,反模式检测      |
| **自主开发者** ⭐   | [35_AutonomousDeveloper系统.md](modules/35_AutonomousDeveloper系统.md)         | **Phase 63**,L2自主编码,架构决策,代码审查,重构   |
| **协作治理** ⭐     | [36_CollaborationGovernance系统.md](modules/36_CollaborationGovernance系统.md) | **Phase 64**,任务分配,冲突解决,质量评估,自主级别 |

### 基础设施

| 文档                                                   | 说明                                         |
| ------------------------------------------------------ | -------------------------------------------- |
| [安全机制设计.md](安全机制设计.md)                     | U盾/SIMKey硬件安全,PQC迁移,门限签名,生物识别 |
| [数据同步方案.md](数据同步方案.md)                     | Git同步,P2P移动端同步                        |
| [AI模型部署方案.md](AI模型部署方案.md)                 | Ollama本地部署,云端API                       |
| [HOOKS_SYSTEM_DESIGN.md](HOOKS_SYSTEM_DESIGN.md)       | Hooks扩展系统,20种事件类型                   |
| [BROWSER_EXTENSION_PLAN.md](BROWSER_EXTENSION_PLAN.md) | 浏览器扩展规划 (Phase 26-32)                 |

## 按角色导航

### 开发者

1. [系统设计\_主文档.md](系统设计_主文档.md) - 了解整体架构
2. [04\_项目管理模块.md](modules/04_项目管理模块.md) - 核心功能实现
3. [安全机制设计.md](安全机制设计.md) - 安全机制
4. [21_UnifiedKey系统.md](modules/21_UnifiedKey系统.md) - 硬件密钥管理

### 产品经理

1. [系统设计\_主文档.md](系统设计_主文档.md) - 系统概述和功能列表
2. [实施总结与附录.md](实施总结与附录.md) - 实施完成状态

### 运维人员

1. [AI模型部署方案.md](AI模型部署方案.md) - 模型部署
2. [数据同步方案.md](数据同步方案.md) - 同步配置
3. [28_Terraform系统.md](modules/28_Terraform系统.md) - IaC管理

### 安全工程师

1. [安全机制设计.md](安全机制设计.md) - 密钥/加密/PQC
2. [21_UnifiedKey系统.md](modules/21_UnifiedKey系统.md) - FIDO2/BLE/PQC
3. [24_DLP系统.md](modules/24_DLP系统.md) - 数据防泄漏
4. [25_SIEM系统.md](modules/25_SIEM系统.md) - SIEM集成

## 归档文档

- [系统设计\_个人移动AI管理系统.md](系统设计_个人移动AI管理系统.md) - 原始完整文档 (~6800行, 123KB)
  - 已拆分为上述独立文档,保留作为归档参考

---

**最后更新**: 2026-02-28 (v3.0.0, Phase 41-64 完整实现)
