# 系统设计文档

本目录包含 ChainlessChain 系统的完整设计和架构文档，共 **70 个模块设计文档** + **9 个基础设施文档**。

> **最新版本**: v5.0.1.8 Evolution Edition — Phase 1-102 全部完成，2700+ CLI 测试，4600+ 总测试

## 文档分类

### 主文档

- [系统设计主文档](./system-design-main) — 系统概述、模块索引、技术栈、路线图
- [完整系统设计](./system-design-full) — 原始完整设计文档（存档）
- [实施总结与附录](./implementation-summary) — 实施状态、快速入门、API 文档

### 基础设施

- [安全机制设计](./security-design) — U盾/SIMKey 硬件安全（含 PQC/门限签名/生物识别）
- [数据同步方案](./data-sync) — Git/HTTP/P2P 同步
- [AI 模型部署方案](./ai-model-deploy) — Ollama/云端模型
- [浏览器插件计划](./BROWSER_EXTENSION_PLAN) — 浏览器扩展路线图
- [Hook 系统设计](./HOOKS_SYSTEM_DESIGN) — 20 种事件类型的 Hook 扩展系统

### 核心模块 (Phase 1-16)

| 编号 | 模块 | 说明 |
|------|------|------|
| 01 | [知识库管理](./modules/01-knowledge-base) | RAG/向量存储/第二大脑 |
| 02 | [去中心化社交](./modules/02-decentralized-social) | DID/P2P/Signal 加密 |
| 03 | [交易辅助](./modules/03-trading) | 智能合约/信用评分 |
| 04 | [项目管理](./modules/04-project-management) | 对话式任务/AI 生成 |
| 05 | [企业版组织](./modules/05-enterprise-org) | RBAC/组织协作 |
| 06 | [AI 优化系统](./modules/06-ai-optimization) | P2 优化/高级特性 |
| 07 | [性能优化](./modules/07-performance) | 三层优化体系 |
| 08 | [MCP 与配置](./modules/08-mcp-config) | MCP/统一配置/预算 |
| 09 | [浏览器自动化](./modules/09-browser-automation) | 工作流/录制/回放 |
| 10 | [远程控制](./modules/10-remote-control) | P2P 远程桌面 |
| 11 | [企业审计](./modules/11-audit) | 审计日志/合规/DSR |
| 12 | [插件市场](./modules/12-plugin-marketplace) | 插件生命周期/生态 |
| 13 | [多代理系统](./modules/13-multi-agent) | 8 种专业代理 |
| 14 | [SSO 企业认证](./modules/14-sso) | SAML/OAuth/OIDC |
| 15 | [MCP SDK](./modules/15-mcp-sdk) | Server Builder |
| 16 | [AI 技能系统](./modules/16-ai-skills) | 138 技能/100% Handler |

### 企业增强 (Phase 17-28)

| 编号 | 模块 | 说明 |
|------|------|------|
| 17 | [EvoMap 系统](./modules/17-evomap) | GEP-A2A/Gene/Capsule |
| 17b | [IPFS 存储](./modules/17b-ipfs) | Helia/Kubo 双引擎 |
| 18 | [P2P 实时协作](./modules/18-p2p-collab) | Yjs CRDT/实时同步 |
| 18b | [社交 AI](./modules/18b-social-ai) | 主题分析/ActivityPub |
| 19 | [合规分类](./modules/19-compliance) | SOC2/数据分类 |
| 19b | [自治 Agent Runner](./modules/19b-agent-runner) | ReAct 循环/目标分解 |
| 20 | [企业用户配置](./modules/20-scim) | SCIM 2.0 |
| 20b | [模型量化](./modules/20b-quantization) | GGUF/AutoGPTQ |
| 21 | [i18n 国际化](./modules/21-i18n) | 4 语言支持 |
| 21b | [统一密钥](./modules/21b-unified-key) | FIDO2/BLE/PQC |
| 22 | [性能自动调优](./modules/22-auto-tuning) | 监控/自动调参 |
| 22b | [内容推荐](./modules/22b-content-rec) | TF-IDF/画像 |
| 23 | [Nostr 桥接](./modules/23-nostr) | Nostr 协议 |
| 23b | [企业组织管理](./modules/23b-org-management) | 组织层级/审批 |
| 24 | [去中心化 Agent](./modules/24-agent-network) | DID/联邦 DHT |
| 24b | [数据防泄漏](./modules/24b-dlp) | DLP |
| 25 | [SIEM](./modules/25-siem) | 安全事件管理 |
| 25b | [自治运维](./modules/25b-autonomous-ops) | 异常检测/自动修复 |
| 26 | [开发流水线](./modules/26-pipeline) | 6 种部署策略 |
| 26b | [社区治理](./modules/26b-governance) | 社区治理 |
| 27 | [Matrix 集成](./modules/27-matrix) | Matrix 协议 |
| 27b | [多模态协作](./modules/27b-multimodal) | 跨模态融合 |
| 28 | [基础设施编排](./modules/28-infrastructure) | Terraform |
| 28b | [自然语言编程](./modules/28b-nl-programming) | NL→Code |

### 生产加固 (Phase 29-42)

| 编号 | 模块 | 说明 |
|------|------|------|
| 29 | [生产强化](./modules/29-production-hardening) | 生产环境加固 |
| 30 | [联邦强化](./modules/30-federation-hardening) | 联邦网络加固 |
| 31 | [压力测试](./modules/31-stress-test) | 联邦压测 |
| 32 | [信誉优化](./modules/32-reputation) | 信誉系统 |
| 33 | [跨组织 SLA](./modules/33-sla) | SLA 管理 |
| 34 | [技术学习引擎](./modules/34-tech-learning) | 自主学习 |
| 35 | [自主开发者](./modules/35-autonomous-dev) | 自主开发 |
| 36 | [协作治理](./modules/36-collab-governance) | 治理框架 |
| 37 | [技能市场](./modules/37-skill-marketplace) | 通证激励 |
| 38 | [推理网络](./modules/38-inference-network) | 去中心化推理 |
| 39 | [信任安全](./modules/39-trust-security) | TPM/TEE/SE |
| 40 | [协议融合](./modules/40-protocol-fusion) | 4 桥接协议 |
| 41 | [去中心化基础设施](./modules/41-decentralized-infra) | 去中心化基础设施 |
| 42 | [EvoMap 高级联邦](./modules/42-evomap-federation) | 全球联邦 |

### 架构重构 (Phase 43-57)

| 编号 | 模块 | 说明 |
|------|------|------|
| 43 | [IPC 域分割](./modules/43-ipc-split) | 10 域/懒加载 |
| 44 | [DI 容器](./modules/44-di-container) | 依赖注入/LRU |
| 45 | [数据库演进](./modules/45-db-migration) | 迁移框架 |
| 46 | [A2A 协议](./modules/46-a2a-protocol) | Agent-to-Agent |
| 47 | [工作流编排](./modules/47-workflow) | 自主工作流 |
| 48 | [层次化记忆 2.0](./modules/48-hierarchical-memory) | 分层记忆 |
| 49 | [多模态感知](./modules/49-multimodal-perception) | 感知层 |
| 50 | [Agent 经济](./modules/50-agent-economy) | Agent 经济 |
| 51 | [代码生成 Agent 2.0](./modules/51-code-agent) | 代码生成 |
| 52 | [安全沙箱 2.0](./modules/52-sandbox) | 安全沙箱 |
| 53 | [零知识证明](./modules/53-zkp) | ZKP 引擎 |
| 54 | [跨链互操作](./modules/54-cross-chain) | 跨链桥 |
| 55 | [DID 2.0](./modules/55-did-v2) | 去中心化身份 |
| 56 | [隐私计算](./modules/56-privacy-computing) | 隐私计算 |
| 57 | [DAO 治理 2.0](./modules/57-dao-governance) | DAO 治理 |

### 企业平台 (Phase 58-65)

| 编号 | 模块 | 说明 |
|------|------|------|
| 58 | [低代码平台](./modules/58-low-code) | 低代码/15+ 组件 |
| 59 | [企业知识图谱](./modules/59-knowledge-graph) | 知识图谱 |
| 60 | [BI 智能分析](./modules/60-bi-engine) | NL→SQL |
| 61 | [工作流自动化](./modules/61-workflow-automation) | 自动化引擎 |
| 62 | [多租户 SaaS](./modules/62-saas) | SaaS 引擎 |
| 63 | [统一运行时](./modules/63-unified-runtime) | 应用运行时 |
| 64 | [插件生态 2.0](./modules/64-plugin-ecosystem) | 插件生态 |
| 65 | [自进化 AI](./modules/65-self-evolving-ai) | 自进化/NAS |

### CLI 系统 (Phase 66-70)

| 编号 | 模块 | 说明 |
|------|------|------|
| 66 | [CLI 分发系统](./modules/66-cli-distribution) | npm CLI/预构建二进制 |
| 67 | [CLI 高级功能](./modules/67-cli-advanced) | 17 模块/2503 测试 |
| 68 | [CLI-Anything 集成](./modules/68-cli-anything) | 外部软件 Agent 化 |
| 69 | [WebSocket 服务器](./modules/69-websocket-server) | 远程 CLI/有状态会话 |
| 70 | [Agent 智能增强](./modules/70-agent-intelligence) | agent-core/auto pip-install |

### Agent Runtime 重构与 Coding Agent (Phase 71-79)

| 编号 | 模块 | 说明 |
|------|------|------|
| 71 | [子代理隔离系统](./modules/71-sub-agent-isolation) | Phase 5 扩展候选 |
| 71b | [AI 音视频创作模板](./modules/71b-ai-media-creator) | 媒体创作技能包 |
| 72 | [AI 文档创作模板](./modules/72-ai-doc-creator) | 文档创作技能包 |
| 73 | [Web 管理界面](./modules/73-web-ui) | 单页管理面板 |
| 74 | [AI 编排层系统](./modules/74-orchestration-layer) | 多后端 Agent 路由 |
| 75 | [Web 管理面板](./modules/75-web-panel) | Vue3 管理面板 |
| 76 | [技能创建系统](./modules/76-skill-creator) | Skill 生成器 |
| 77 | [Agent 架构优化系统](./modules/77-agent-optimization) | 后台任务/Worktree/压缩观测/会话迁移 |
| 78 | [CLI Agent Runtime 重构](./modules/78-cli-agent-runtime) | runtime / gateway / harness 分层 |
| 79 | [Coding Agent 系统](./modules/79-coding-agent) | 统一信封 v1.0 + Phase 5 最小 Harness + 真实 interrupt |
