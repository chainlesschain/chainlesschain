---
layout: home

hero:
  name: ChainlessChain
  text: 系统设计文档
  tagline: v5.0.2.34 | 95+ 模块设计 | 139 技能 | CLI 109 命令/0.143.0 | 13000+ 总测试 | 面向开发者的架构与实现文档
  image:
    src: /logo.png
    alt: ChainlessChain Logo
  actions:
    - theme: brand
      text: 系统架构总览
      link: /system-design-main
    - theme: alt
      text: 模块设计文档
      link: /modules/m01-knowledge-base
    - theme: alt
      text: 用户文档站
      link: https://docs.chainlesschain.com

features:
  - icon: 📐
    title: 73个模块设计
    details: 覆盖知识库、社交、交易、AI引擎、安全、企业、去中心化基础设施、Web3、低代码平台、自进化AI、CLI分发系统、CLI高级功能、AI媒体创作、AI文档创作、Web管理界面等全部子系统的详细设计

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

| 角色              | 推荐阅读                                                                                                                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **新人开发者**    | [系统设计主文档](/system-design-main) → [知识库模块](/modules/m01-knowledge-base) → [社交模块](/modules/m02-decentralized-social)                                                                                     |
| **安全工程师**    | [安全机制设计](/security-design) → [统一密钥系统](/modules/m21-unified-key) → [数据防泄漏系统](/modules/m24b-dlp-prevention)                                                                                      |
| **AI工程师**      | [AI优化系统](/modules/m06-ai-optimization) → [多代理系统](/modules/m13-multi-agent) → [推理网络](/modules/m38-decentralized-inference)                                                                                   |
| **运维工程师**    | [生产强化](/modules/m29-production-hardening) → [基础设施编排](/modules/m28-infra-orchestration) → [SIEM](/modules/m25-siem)                                                                               |
| **产品经理**      | [系统设计主文档](/system-design-main) → [实施总结](/implementation-summary)                                                                                                                                             |
| **v5.0.0 新模块** | [IPC域分割](/modules/m43-ipc-domain-split) → [A2A协议](/modules/m46-a2a-protocol) → [零知识证明](/modules/m53-zkp-engine) → [低代码平台](/modules/m58-low-code) → [自进化AI](/modules/m65-self-evolving-ai) |
| **v5.0.1 新模块** | [CLI分发系统](/modules/m66-cli-distribution) → [CLI高级功能](/modules/m67-cli-advanced)                                                                                                                          |

### 版本演进

| 版本          | Phase  | 核心内容                                                 |
| ------------- | ------ | -------------------------------------------------------- |
| v1.0.0        | 1-41   | 核心功能 + EvoMap                                        |
| v1.1.0        | 42-56  | 企业增强 + 安全扩展                                      |
| v2.0.0        | 57-61  | 生产加固                                                 |
| v3.0.0        | 62-64  | 自主AI开发                                               |
| v3.1.0-v3.4.0 | 65-77  | 去中心化AI市场 + 硬件安全生态 + 全球社交 + EvoMap进化    |
| **v5.0.0**    | 78-100 | 架构重构 + AI Agent 2.0 + Web3深化 + 企业平台 + 自进化AI |
| **v5.0.1**    | 101-102 | CLI分发系统 + 6维Context Engineering + Autonomous Agent + EvoMap + 10 LLM Providers + 3 Proxy Relays + Task Model Selector + 2009测试 |
| **v5.0.2**    | —      | CLI技能包系统(9包) + AI音视频创作模板 + AI文档创作模板 + 5030+测试 |
| **v5.0.2.2**  | —      | Web管理界面(chainlesschain ui) + 浏览器端项目/全局AI对话 + 5130+测试 |
| **v5.0.2.10** | —      | Coding Agent Phase 5 + 去中心化社交协议矩阵 + PQC SLH-DSA + MCP HTTP/SSE + CutClaw 视频剪辑 Agent |
| **v5.0.2.34** | —      | V2 规范层第 1-8 批（SSO / Workflow / Router / Hook / MCP / Coord / A2A / DAO / ZKP / DLP / BI / EvoMap / AP / Matrix / Nostr / Browse / CrossChain / Consol 等 62+ 管家治理表面） + CLI 0.136.0 + 109 命令 + 11700+ 测试 |

---

<div style="text-align: center; margin-top: 40px;">
  <p style="color: #666;">源文件位于 <code>docs/design/</code>，本站点通过同步脚本自动构建</p>
</div>
