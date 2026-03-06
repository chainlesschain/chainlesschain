---
layout: home

hero:
  name: ChainlessChain
  text: 系统设计文档
  tagline: v3.4.0 | 42个模块设计 | 77 Phase | 面向开发者的架构与实现文档
  image:
    src: /logo.png
    alt: ChainlessChain Logo
  actions:
    - theme: brand
      text: 系统架构总览
      link: /系统设计_主文档
    - theme: alt
      text: 模块设计文档
      link: /modules/01_知识库管理模块
    - theme: alt
      text: 用户文档站
      link: https://docs.chainlesschain.com

features:
  - icon: 📐
    title: 42个模块设计
    details: 覆盖知识库、社交、交易、AI引擎、安全、企业、去中心化基础设施等全部子系统的详细设计

  - icon: 🏗️
    title: 架构设计
    details: 系统整体架构、技术栈选型、数据库设计、IPC通信协议、安全机制等基础架构文档

  - icon: 🔐
    title: 安全机制
    details: U盾/SIMKey硬件安全、PQC后量子密码、门限签名、FIDO2、生物识别等安全设计

  - icon: 🤖
    title: AI引擎设计
    details: 多代理协作、自主开发、技术学习、推理网络、技能市场等AI子系统架构

  - icon: 🌐
    title: 去中心化协议
    details: DID身份、P2P通信、ActivityPub/Nostr/Matrix多协议融合、抗审查网络设计

  - icon: 🏢
    title: 企业级功能
    details: RBAC权限、SOC2合规、SCIM用户配置、DLP数据防泄漏、SIEM安全信息管理
---

## 快速导航

### 按角色

| 角色           | 推荐阅读                                                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **新人开发者** | [系统设计主文档](/系统设计_主文档) → [知识库模块](/modules/01_知识库管理模块) → [社交模块](/modules/02_去中心化社交模块)       |
| **安全工程师** | [安全机制设计](/安全机制设计) → [统一密钥系统](/modules/21_统一密钥系统) → [数据防泄漏系统](/modules/24_数据防泄漏系统)        |
| **AI工程师**   | [AI优化系统](/modules/06_AI优化系统) → [多代理系统](/modules/13_多代理系统) → [推理网络](/modules/38_去中心化推理网络系统)     |
| **运维工程师** | [生产强化](/modules/29_生产强化系统) → [基础设施编排](/modules/28_基础设施编排系统) → [SIEM](/modules/25_安全信息事件管理系统) |
| **产品经理**   | [系统设计主文档](/系统设计_主文档) → [实施总结](/实施总结与附录)                                                               |

### 版本演进

| 版本          | Phase | 核心内容                                              |
| ------------- | ----- | ----------------------------------------------------- |
| v1.0.0        | 1-41  | 核心功能 + EvoMap                                     |
| v1.1.0        | 42-56 | 企业增强 + 安全扩展                                   |
| v2.0.0        | 57-61 | 生产加固                                              |
| v3.0.0        | 62-64 | 自主AI开发                                            |
| v3.1.0-v3.4.0 | 65-77 | 去中心化AI市场 + 硬件安全生态 + 全球社交 + EvoMap进化 |

---

<div style="text-align: center; margin-top: 40px;">
  <p style="color: #666;">源文件位于 <code>docs/design/</code>，本站点通过同步脚本自动构建</p>
</div>
