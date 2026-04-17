import { defineConfig } from "vitepress";

export default defineConfig({
  title: "ChainlessChain 文档",
  description: "去中心化个人AI管理系统和U盾/SIMKey厂家管理平台完整文档",
  lang: "zh-CN",
  ignoreDeadLinks: true,

  head: [
    ["meta", { charset: "utf-8" }],
    ["link", { rel: "icon", href: "/favicon.ico" }],
    ["meta", { name: "theme-color", content: "#3eaf7c" }],
    ["meta", { name: "apple-mobile-web-app-capable", content: "yes" }],
    [
      "meta",
      { name: "apple-mobile-web-app-status-bar-style", content: "black" },
    ],
  ],

  themeConfig: {
    logo: "/logo.png",

    nav: [
      { text: "首页", link: "/" },
      { text: "快速开始", link: "/guide/getting-started" },
      {
        text: "产品文档",
        items: [
          { text: "ChainlessChain系统", link: "/chainlesschain/overview" },
          { text: "厂家管理系统", link: "/manufacturer/overview" },
        ],
      },
      {
        text: "专题指南 ⭐",
        items: [
          { text: "社交协议生态", link: "/guide/social-protocols" },
          { text: "合规与威胁情报", link: "/guide/compliance-threat-intel" },
        ],
      },
      { text: "API参考", link: "/api/introduction" },
      { text: "设计文档", link: "/design/" },
      {
        text: "更多",
        items: [
          { text: "常见问题", link: "/faq" },
          { text: "更新日志", link: "/changelog" },
          { text: "关于我们", link: "/about" },
        ],
      },
    ],

    sidebar: {
      "/guide/": [
        {
          text: "指南",
          items: [
            { text: "简介", link: "/guide/introduction" },
            { text: "快速开始", link: "/guide/getting-started" },
            { text: "系统架构", link: "/guide/architecture" },
            { text: "技术栈", link: "/guide/tech-stack" },
          ],
        },
        {
          text: "专题指南 (v5.0.2.10)",
          items: [
            {
              text: "社交协议生态 (Nostr/Matrix/ActivityPub)",
              link: "/guide/social-protocols",
            },
            {
              text: "合规与威胁情报 (STIX 2.1/UEBA/SOC2)",
              link: "/guide/compliance-threat-intel",
            },
          ],
        },
      ],

      "/chainlesschain/": [
        {
          text: "ChainlessChain系统",
          items: [{ text: "系统概述", link: "/chainlesschain/overview" }],
        },
        {
          text: "安装与部署",
          items: [
            { text: "安装部署", link: "/chainlesschain/installation" },
            { text: "配置说明", link: "/chainlesschain/configuration" },
            { text: "CLI命令行工具", link: "/chainlesschain/cli" },
          ],
        },
        {
          text: "核心功能",
          items: [
            { text: "知识库管理", link: "/chainlesschain/knowledge-base" },
            { text: "去中心化社交", link: "/chainlesschain/social" },
            { text: "交易辅助", link: "/chainlesschain/trading" },
            { text: "U盾集成", link: "/chainlesschain/ukey" },
            { text: "SIMKey集成", link: "/chainlesschain/simkey" },
            { text: "SIMKey高级安全", link: "/chainlesschain/simkey-advanced" },
            { text: "SIMKey企业版", link: "/chainlesschain/simkey-enterprise" },
            { text: "移动端同步", link: "/chainlesschain/mobile-sync" },
          ],
        },
        {
          text: "高级功能",
          items: [
            { text: "AI模型配置", link: "/chainlesschain/ai-models" },
            { text: "Git同步", link: "/chainlesschain/git-sync" },
            { text: "数据加密", link: "/chainlesschain/encryption" },
            {
              text: "上下文工程",
              link: "/chainlesschain/context-engineering",
            },
            { text: "永久记忆系统", link: "/chainlesschain/permanent-memory" },
          ],
        },
        {
          text: "自动化功能",
          items: [
            { text: "浏览器插件", link: "/chainlesschain/browser-extension" },
            { text: "计算机操控", link: "/chainlesschain/computer-use" },
            {
              text: "浏览器自动化",
              link: "/chainlesschain/browser-automation",
            },
            { text: "远程控制", link: "/chainlesschain/remote-control" },
            { text: "自治Agent", link: "/chainlesschain/autonomous-agent" },
          ],
        },
        {
          text: "企业版功能",
          items: [
            { text: "多智能体协作", link: "/chainlesschain/cowork" },
            { text: "日常任务协作", link: "/chainlesschain/web-cowork" },
            { text: "会话管理器", link: "/chainlesschain/session-manager" },
            { text: "钩子系统", link: "/chainlesschain/hooks" },
            { text: "权限系统", link: "/chainlesschain/permissions" },
            { text: "计划模式", link: "/chainlesschain/plan-mode" },
            { text: "技能系统", link: "/chainlesschain/skills" },
            { text: "EvoMap GEP协议", link: "/chainlesschain/evomap" },
            { text: "协作高级功能", link: "/chainlesschain/cowork-advanced" },
            { text: "协作路线图", link: "/chainlesschain/cowork-roadmap" },
            { text: "团队管理", link: "/chainlesschain/team-manager" },
            { text: "审计日志", link: "/chainlesschain/audit" },
            { text: "企业组织管理", link: "/chainlesschain/enterprise-org" },
          ],
        },
        {
          text: "v1.0.0 基础增强",
          items: [
            { text: "IPFS去中心化存储", link: "/chainlesschain/ipfs-storage" },
            {
              text: "实时协作(CRDT/Yjs)",
              link: "/chainlesschain/realtime-collab",
            },
            { text: "模型量化", link: "/chainlesschain/quantization" },
            { text: "i18n国际化", link: "/chainlesschain/i18n" },
            {
              text: "性能自动调优",
              link: "/chainlesschain/performance-tuning",
            },
          ],
        },
        {
          text: "v1.1.0 企业增强 (Phase 42-45)",
          items: [
            {
              text: "社交AI + ActivityPub",
              link: "/chainlesschain/social-ai",
            },
            { text: "合规与数据分类", link: "/chainlesschain/compliance" },
            { text: "SCIM 2.0 用户配置", link: "/chainlesschain/scim" },
            { text: "统一密钥 + FIDO2", link: "/chainlesschain/unified-key" },
          ],
        },
        {
          text: "v1.1.0 安全与社交增强 (Phase 46-51)",
          items: [
            {
              text: "门限签名 + 生物特征",
              link: "/chainlesschain/threshold-security",
            },
            { text: "蓝牙U-Key", link: "/chainlesschain/ble-ukey" },
            {
              text: "内容推荐",
              link: "/chainlesschain/content-recommendation",
            },
            { text: "Nostr桥接", link: "/chainlesschain/nostr-bridge" },
            { text: "数据防泄漏 (DLP)", link: "/chainlesschain/dlp" },
            { text: "SIEM 集成", link: "/chainlesschain/siem" },
          ],
        },
        {
          text: "v1.1.0 安全与企业扩展 (Phase 52-56)",
          items: [
            {
              text: "后量子密码迁移",
              link: "/chainlesschain/pqc-migration",
            },
            { text: "U盾固件 OTA", link: "/chainlesschain/firmware-ota" },
            { text: "AI 社区治理", link: "/chainlesschain/governance" },
            { text: "Matrix集成", link: "/chainlesschain/matrix-bridge" },
            {
              text: "Terraform 提供者",
              link: "/chainlesschain/terraform-provider",
            },
          ],
        },
        {
          text: "v1.1.0 新功能",
          items: [
            { text: "流水线编排", link: "/chainlesschain/pipeline" },
            { text: "开发流水线编排", link: "/chainlesschain/dev-pipeline" },
            { text: "自然语言编程", link: "/chainlesschain/nl-programming" },
            { text: "多模态协作", link: "/chainlesschain/multimodal" },
            { text: "自主运维", link: "/chainlesschain/autonomous-ops" },
            { text: "代理联邦网络", link: "/chainlesschain/agent-federation" },
            { text: "Agent网络", link: "/chainlesschain/agent-network" },
          ],
        },
        {
          text: "v1.2.0~v1.2.1 新增技能",
          items: [
            {
              text: "28个新增实用技能(v1.2.0~v1.2.1)",
              link: "/chainlesschain/new-skills-v1.2",
            },
          ],
        },
        {
          text: "v2.0.0 生产加固 (Phase 57-61)",
          items: [
            {
              text: "生产加固",
              link: "/chainlesschain/production-hardening",
            },
            {
              text: "联邦网络加固",
              link: "/chainlesschain/federation-hardening",
            },
            { text: "联邦压力测试", link: "/chainlesschain/stress-test" },
            {
              text: "信誉系统优化",
              link: "/chainlesschain/reputation-optimizer",
            },
            { text: "跨组织 SLA", link: "/chainlesschain/sla-manager" },
          ],
        },
        {
          text: "v3.0.0 自主AI开发 (Phase 62-64)",
          items: [
            {
              text: "自主技术学习",
              link: "/chainlesschain/tech-learning",
            },
            {
              text: "自主开发者",
              link: "/chainlesschain/autonomous-developer",
            },
            {
              text: "协作治理框架",
              link: "/chainlesschain/collaboration-governance",
            },
          ],
        },
        {
          text: "v3.1.0 去中心化AI市场 (Phase 65-67)",
          items: [
            {
              text: "技能市场",
              link: "/chainlesschain/skill-marketplace",
            },
            {
              text: "通证激励",
              link: "/chainlesschain/token-incentive",
            },
            {
              text: "推理网络",
              link: "/chainlesschain/inference-network",
            },
          ],
        },
        {
          text: "v3.2.0 硬件安全生态 (Phase 68-71)",
          items: [
            { text: "三位一体信任根", link: "/chainlesschain/trust-root" },
            {
              text: "后量子全面迁移",
              link: "/chainlesschain/pqc-ecosystem",
            },
            {
              text: "卫星通信",
              link: "/chainlesschain/satellite-comm",
            },
            { text: "HSM硬件适配器", link: "/chainlesschain/hsm-adapter" },
          ],
        },
        {
          text: "v3.3.0 全球去中心化社交 (Phase 72-75)",
          items: [
            {
              text: "协议融合桥接",
              link: "/chainlesschain/protocol-fusion",
            },
            {
              text: "AI社交增强",
              link: "/chainlesschain/ai-social-enhancement",
            },
            {
              text: "去中心化存储",
              link: "/chainlesschain/decentralized-storage",
            },
            {
              text: "抗审查网络",
              link: "/chainlesschain/anti-censorship",
            },
          ],
        },
        {
          text: "v3.4.0 EvoMap全球进化 (Phase 76-77)",
          items: [
            {
              text: "EvoMap全球联邦",
              link: "/chainlesschain/evomap-federation",
            },
            {
              text: "EvoMap治理DAO",
              link: "/chainlesschain/evomap-governance",
            },
          ],
        },
        {
          text: "v4.0.0-alpha 架构重构 (Phase 78-80)",
          items: [
            {
              text: "IPC域分割与懒加载",
              link: "/chainlesschain/ipc-domain-split",
            },
            {
              text: "共享资源层与DI容器",
              link: "/chainlesschain/di-container",
            },
            {
              text: "数据库演进框架",
              link: "/chainlesschain/database-evolution",
            },
          ],
        },
        {
          text: "v4.1.0 AI Agent 2.0 (Phase 81-87)",
          items: [
            { text: "A2A协议引擎", link: "/chainlesschain/a2a-protocol" },
            {
              text: "自主工作流编排",
              link: "/chainlesschain/workflow-engine",
            },
            {
              text: "层次化记忆2.0",
              link: "/chainlesschain/hierarchical-memory",
            },
            {
              text: "多模态感知层",
              link: "/chainlesschain/multimodal-perception",
            },
            { text: "Agent经济系统", link: "/chainlesschain/agent-economy" },
            {
              text: "代码生成Agent 2.0",
              link: "/chainlesschain/code-agent-v2",
            },
            {
              text: "Agent安全沙箱2.0",
              link: "/chainlesschain/agent-sandbox-v2",
            },
          ],
        },
        {
          text: "v4.2.0 Web3深化 (Phase 88-92)",
          items: [
            { text: "零知识证明引擎", link: "/chainlesschain/zkp-engine" },
            {
              text: "跨链互操作协议",
              link: "/chainlesschain/cross-chain-bridge",
            },
            { text: "去中心化身份2.0", link: "/chainlesschain/did-v2" },
            { text: "隐私计算框架", link: "/chainlesschain/privacy-computing" },
            { text: "DAO治理2.0", link: "/chainlesschain/dao-governance-v2" },
          ],
        },
        {
          text: "v4.5.0 企业平台 (Phase 93-97)",
          items: [
            { text: "低代码平台", link: "/chainlesschain/low-code-platform" },
            {
              text: "企业知识图谱",
              link: "/chainlesschain/enterprise-knowledge-graph",
            },
            { text: "BI智能分析", link: "/chainlesschain/bi-engine" },
            {
              text: "工作流自动化",
              link: "/chainlesschain/workflow-automation",
            },
            {
              text: "多租户SaaS引擎",
              link: "/chainlesschain/multi-tenant-saas",
            },
          ],
        },
        {
          text: "v5.0.0 生态融合 (Phase 98-100)",
          items: [
            {
              text: "统一应用运行时",
              link: "/chainlesschain/universal-runtime",
            },
            {
              text: "智能插件生态2.0",
              link: "/chainlesschain/plugin-ecosystem-v2",
            },
            { text: "自进化AI系统", link: "/chainlesschain/self-evolving-ai" },
          ],
        },
        {
          text: "v5.0.1 CLI分发与加固",
          items: [
            {
              text: "CLI命令行工具",
              link: "/chainlesschain/cli",
            },
            {
              text: "CLI分发系统",
              link: "/chainlesschain/cli-distribution",
            },
            {
              text: "项目初始化 (init)",
              link: "/chainlesschain/cli-init",
            },
            {
              text: "Persona管理 (persona)",
              link: "/chainlesschain/cli-persona",
            },
            {
              text: "多智能体协作 (cowork)",
              link: "/chainlesschain/cli-cowork",
            },
            {
              text: "原生模块保护",
              link: "/chainlesschain/native-module-guard",
            },
          ],
        },
        {
          text: "v5.0.1 系统管理 CLI",
          items: [
            {
              text: "安装向导 (setup)",
              link: "/chainlesschain/cli-setup",
            },
            {
              text: "启动应用 (start)",
              link: "/chainlesschain/cli-start",
            },
            {
              text: "停止应用 (stop)",
              link: "/chainlesschain/cli-stop",
            },
            {
              text: "系统状态 (status)",
              link: "/chainlesschain/cli-status",
            },
            {
              text: "配置管理 (config)",
              link: "/chainlesschain/cli-config",
            },
            {
              text: "检查更新 (update)",
              link: "/chainlesschain/cli-update",
            },
            {
              text: "环境诊断 (doctor)",
              link: "/chainlesschain/cli-doctor",
            },
            {
              text: "Docker服务 (services)",
              link: "/chainlesschain/cli-services",
            },
          ],
        },
        {
          text: "v5.0.1 Headless CLI",
          items: [
            {
              text: "数据库管理 (db)",
              link: "/chainlesschain/cli-db",
            },
            {
              text: "笔记管理 (note)",
              link: "/chainlesschain/cli-note",
            },
            {
              text: "AI对话 (chat)",
              link: "/chainlesschain/cli-chat",
            },
            {
              text: "单次问答 (ask)",
              link: "/chainlesschain/cli-ask",
            },
            {
              text: "LLM管理 (llm)",
              link: "/chainlesschain/cli-llm",
            },
            {
              text: "LLM中转站与自定义接入",
              link: "/chainlesschain/cli-llm-proxy",
            },
            {
              text: "代理模式 (agent)",
              link: "/chainlesschain/cli-agent",
            },
            {
              text: "技能系统 (skill)",
              link: "/chainlesschain/cli-skill",
            },
          ],
        },
        {
          text: "v5.0.1 Phase 1 AI智能层",
          items: [
            {
              text: "混合搜索 (search)",
              link: "/chainlesschain/cli-search",
            },
            {
              text: "Token追踪 (tokens)",
              link: "/chainlesschain/cli-tokens",
            },
            {
              text: "持久记忆 (memory)",
              link: "/chainlesschain/cli-memory",
            },
            {
              text: "会话管理 (session)",
              link: "/chainlesschain/cli-session",
            },
            {
              text: "Managed Agents 对标 (memory/session/beta)",
              link: "/chainlesschain/managed-agents-cli",
            },
          ],
        },
        {
          text: "v5.0.1 Phase 2 知识与内容",
          items: [
            {
              text: "内容导入 (import)",
              link: "/chainlesschain/cli-import",
            },
            {
              text: "内容导出 (export)",
              link: "/chainlesschain/cli-export",
            },
            {
              text: "Git集成 (git)",
              link: "/chainlesschain/cli-git",
            },
          ],
        },
        {
          text: "v5.0.1 Phase 3 MCP与外部集成",
          items: [
            {
              text: "MCP服务器 (mcp)",
              link: "/chainlesschain/cli-mcp",
            },
            {
              text: "浏览器自动化 (browse)",
              link: "/chainlesschain/cli-browse",
            },
            {
              text: "学习偏好 (instinct)",
              link: "/chainlesschain/cli-instinct",
            },
          ],
        },
        {
          text: "v5.0.1 Phase 4 安全与身份",
          items: [
            {
              text: "DID身份管理 (did)",
              link: "/chainlesschain/cli-did",
            },
            {
              text: "文件加密 (encrypt)",
              link: "/chainlesschain/cli-encrypt",
            },
            {
              text: "RBAC权限 (auth)",
              link: "/chainlesschain/cli-auth",
            },
            {
              text: "审计日志 (audit)",
              link: "/chainlesschain/cli-audit",
            },
          ],
        },
        {
          text: "v5.0.1 Phase 5 P2P与企业",
          items: [
            {
              text: "P2P消息 (p2p)",
              link: "/chainlesschain/cli-p2p",
            },
            {
              text: "文件同步 (sync)",
              link: "/chainlesschain/cli-sync",
            },
            {
              text: "数字钱包 (wallet)",
              link: "/chainlesschain/cli-wallet",
            },
            {
              text: "组织管理 (org)",
              link: "/chainlesschain/cli-org",
            },
            {
              text: "插件市场 (plugin)",
              link: "/chainlesschain/cli-plugin",
            },
          ],
        },
        {
          text: "v5.0.1 Phase 6-9 高级功能",
          items: [
            {
              text: "Hook系统 (hook)",
              link: "/chainlesschain/cli-hook",
            },
            {
              text: "工作流引擎 (workflow)",
              link: "/chainlesschain/cli-workflow",
            },
            {
              text: "层次化记忆 (hmemory)",
              link: "/chainlesschain/cli-hmemory",
            },
            {
              text: "A2A协议 (a2a)",
              link: "/chainlesschain/cli-a2a",
            },
            {
              text: "安全沙箱 (sandbox)",
              link: "/chainlesschain/cli-sandbox",
            },
            {
              text: "自进化系统 (evolution)",
              link: "/chainlesschain/cli-evolution",
            },
            {
              text: "Agent经济 (economy)",
              link: "/chainlesschain/cli-economy",
            },
            {
              text: "零知识证明 (zkp)",
              link: "/chainlesschain/cli-zkp",
            },
            {
              text: "商业智能 (bi)",
              link: "/chainlesschain/cli-bi",
            },
            {
              text: "低代码平台 (lowcode)",
              link: "/chainlesschain/cli-lowcode",
            },
          ],
        },
        {
          text: "v5.0.1 Phase 7 EvoMap联邦+DAO",
          items: [
            {
              text: "DAO治理v2 (dao)",
              link: "/chainlesschain/cli-dao",
            },
            {
              text: "EvoMap 演化地图 (evomap)",
              link: "/chainlesschain/cli-evomap",
            },
            {
              text: "跨链互操作 (crosschain)",
              link: "/chainlesschain/cli-crosschain",
            },
          ],
        },
        {
          text: "v5.0.1 Phase 8 安全合规",
          items: [
            {
              text: "合规管理 (compliance)",
              link: "/chainlesschain/cli-compliance",
            },
            {
              text: "数据防泄漏 (dlp)",
              link: "/chainlesschain/cli-dlp",
            },
            {
              text: "SIEM集成 (siem)",
              link: "/chainlesschain/cli-siem",
            },
            {
              text: "后量子密码 (pqc)",
              link: "/chainlesschain/cli-pqc",
            },
          ],
        },
        {
          text: "v5.0.1 Phase 8 通信桥接",
          items: [
            {
              text: "Nostr桥接 (nostr)",
              link: "/chainlesschain/cli-nostr",
            },
            {
              text: "Matrix桥接 (matrix)",
              link: "/chainlesschain/cli-matrix",
            },
            {
              text: "ActivityPub 联邦协议 (activitypub)",
              link: "/chainlesschain/cli-activitypub",
            },
            {
              text: "SCIM用户配置 (scim)",
              link: "/chainlesschain/cli-scim",
            },
          ],
        },
        {
          text: "v5.0.1 Phase 8 基础设施",
          items: [
            {
              text: "基础设施编排 (terraform)",
              link: "/chainlesschain/cli-terraform",
            },
            {
              text: "安全加固 (hardening)",
              link: "/chainlesschain/cli-hardening",
            },
          ],
        },
        {
          text: "v5.0.1 Phase 8 社交平台",
          items: [
            {
              text: "社交平台 (social)",
              link: "/chainlesschain/cli-social",
            },
          ],
        },
        {
          text: "v5.0.1 外部集成",
          items: [
            {
              text: "CLI-Anything集成 (cli-anything)",
              link: "/chainlesschain/cli-cli-anything",
            },
            {
              text: "WebSocket服务器 (serve)",
              link: "/chainlesschain/cli-serve",
            },
            {
              text: "流式输出 (stream)",
              link: "/chainlesschain/cli-stream",
            },
          ],
        },
        {
          text: "v5.0.1 学习与隐私",
          items: [
            {
              text: "自主学习系统 (learning)",
              link: "/chainlesschain/cli-learning",
            },
            {
              text: "隐私计算 (privacy)",
              link: "/chainlesschain/cli-privacy",
            },
          ],
        },
        {
          text: "v5.0.1.8 子代理隔离 v2",
          items: [
            {
              text: "子代理隔离系统",
              link: "/chainlesschain/sub-agent-isolation",
            },
          ],
        },
        {
          text: "v5.0.1.9 CLI 指令技能包系统",
          items: [
            {
              text: "CLI 指令技能包",
              link: "/chainlesschain/cli-skill-packs",
            },
          ],
        },
        {
          text: "v5.0.2.0 AI 创作模板",
          items: [
            {
              text: "项目初始化 (init)",
              link: "/chainlesschain/cli-init",
            },
            {
              text: "AI 音视频创作模板",
              link: "/chainlesschain/ai-media-creator",
            },
          ],
        },
        {
          text: "v5.0.2.1 AI 文档修改 (doc-edit)",
          items: [
            {
              text: "AI 文档创作模板",
              link: "/chainlesschain/ai-doc-creator",
            },
          ],
        },
        {
          text: "v5.0.2.3 Web 管理界面 (协议修复)",
          items: [
            {
              text: "Web 管理界面 (ui)",
              link: "/chainlesschain/cli-ui",
            },
          ],
        },
        {
          text: "v5.0.2.4 AI 编排层",
          items: [
            {
              text: "AI 编排层 (orchestrate)",
              link: "/chainlesschain/cli-orchestrate",
            },
          ],
        },
        {
          text: "v5.0.2.8 Web 管理面板 10模块+4主题",
          items: [
            {
              text: "Web 管理面板 (ui)",
              link: "/chainlesschain/cli-web-panel",
            },
          ],
        },
        {
          text: "v5.0.2.7 Skill Creator v1.2.0",
          items: [
            {
              text: "Skill Creator 使用指南",
              link: "/chainlesschain/skill-creator",
            },
          ],
        },
        {
          text: "v5.0.2.9 Agent 架构优化",
          items: [
            {
              text: "Agent 架构优化系统",
              link: "/chainlesschain/agent-optimization",
            },
          ],
        },
        {
          text: "v5.0.2.10 Minimal Coding Agent ⭐NEW",
          items: [
            {
              text: "Coding Agent 系统",
              link: "/chainlesschain/coding-agent",
            },
            {
              text: "规范工作流 ($deep-interview/$ralplan/$ralph/$team)",
              link: "/chainlesschain/coding-workflow",
            },
            {
              text: "Minimal Coding Agent 实施计划",
              link: "/chainlesschain/minimal-coding-agent-plan",
            },
            {
              text: "CLI Agent Runtime 重构计划",
              link: "/chainlesschain/cli-agent-runtime-plan",
            },
          ],
        },
        {
          text: "v5.0.2.10 Session-Core + Agent Bundle ⭐NEW",
          items: [
            {
              text: "Session-Core 会话运行时",
              link: "/chainlesschain/session-core",
            },
            {
              text: "Agent Bundle 打包部署",
              link: "/chainlesschain/agent-bundles",
            },
            {
              text: "QualityGate 通用质量门控",
              link: "/chainlesschain/quality-gate",
            },
            {
              text: "视频剪辑 Agent (CutClaw)",
              link: "/chainlesschain/video-editing",
            },
          ],
        },
        {
          text: "v5.0.2.13 自主学习闭环",
          items: [
            {
              text: "自主学习闭环系统",
              link: "/chainlesschain/autonomous-learning-loop",
            },
          ],
        },
        {
          text: "Hermes Agent 对标",
          items: [
            {
              text: "Hermes Agent 对标实施 (6 Phase)",
              link: "/chainlesschain/hermes-agent-parity",
            },
          ],
        },
        {
          text: "Managed Agents 对标",
          items: [
            {
              text: "Managed Agents 对标与 CLI 接入",
              link: "/chainlesschain/managed-agents-parity",
            },
          ],
        },
        {
          text: "v5.0.2.14 Web Cowork 日常协作",
          items: [
            {
              text: "日常任务协作 (Web Cowork)",
              link: "/chainlesschain/web-cowork",
            },
            {
              text: "多智能体协作 (cowork)",
              link: "/chainlesschain/cowork",
            },
            {
              text: "协作高级功能",
              link: "/chainlesschain/cowork-advanced",
            },
            {
              text: "协作路线图",
              link: "/chainlesschain/cowork-roadmap",
            },
          ],
        },
        {
          text: "v5.0.2.10 压力测试与运维 ⭐NEW",
          items: [
            {
              text: "压力测试 (stress)",
              link: "/chainlesschain/cli-stress",
            },
            {
              text: "SLA 管理 (sla)",
              link: "/chainlesschain/cli-sla",
            },
            {
              text: "信誉优化 (reputation)",
              link: "/chainlesschain/cli-reputation",
            },
            {
              text: "技术学习引擎 (tech)",
              link: "/chainlesschain/cli-tech",
            },
          ],
        },
        {
          text: "v5.0.2.10 自主开发与治理 ⭐NEW",
          items: [
            {
              text: "自主开发者 (dev)",
              link: "/chainlesschain/cli-dev",
            },
            {
              text: "协作治理 (collab)",
              link: "/chainlesschain/cli-collab",
            },
            {
              text: "社区治理 (governance)",
              link: "/chainlesschain/cli-governance",
            },
          ],
        },
        {
          text: "v5.0.2.10 市场与经济 ⭐NEW",
          items: [
            {
              text: "技能市场 (marketplace)",
              link: "/chainlesschain/cli-marketplace",
            },
            {
              text: "代币激励 (incentive)",
              link: "/chainlesschain/cli-incentive",
            },
          ],
        },
        {
          text: "v5.0.2.10 知识与推荐 ⭐NEW",
          items: [
            {
              text: "知识图谱 (kg)",
              link: "/chainlesschain/cli-kg",
            },
            {
              text: "智能推荐 (recommend)",
              link: "/chainlesschain/cli-recommend",
            },
            {
              text: "多租户 SaaS (tenant)",
              link: "/chainlesschain/cli-tenant",
            },
          ],
        },
        {
          text: "v5.0.2.10 视频剪辑 ⭐NEW",
          items: [
            {
              text: "视频剪辑 Agent (video)",
              link: "/chainlesschain/cli-video",
            },
          ],
        },
        {
          text: "v5.0.2.10 代码生成与数据库 ⭐NEW",
          items: [
            {
              text: "代码生成 Agent (codegen)",
              link: "/chainlesschain/cli-codegen",
            },
            {
              text: "数据库演进 (dbevo)",
              link: "/chainlesschain/cli-dbevo",
            },
          ],
        },
        {
          text: "v5.0.2.10 AIOps 智能运维 ⭐NEW",
          items: [
            {
              text: "智能运维 (ops)",
              link: "/chainlesschain/cli-ops",
            },
          ],
        },
        {
          text: "产品规划",
          items: [
            { text: "产品演进路线图", link: "/chainlesschain/product-roadmap" },
            {
              text: "v1.1.0 实施计划",
              link: "/chainlesschain/implementation-plan",
            },
          ],
        },
      ],

      "/design/": [
        {
          text: "设计文档",
          items: [
            { text: "设计文档索引", link: "/design/" },
            { text: "系统设计主文档", link: "/design/system-design-main" },
            { text: "完整系统设计(存档)", link: "/design/system-design-full" },
            { text: "实施总结与附录", link: "/design/implementation-summary" },
          ],
        },
        {
          text: "基础设施设计",
          items: [
            { text: "安全机制设计", link: "/design/security-design" },
            { text: "数据同步方案", link: "/design/data-sync" },
            { text: "AI模型部署方案", link: "/design/ai-model-deploy" },
            { text: "浏览器插件计划", link: "/design/BROWSER_EXTENSION_PLAN" },
            { text: "Hook系统设计", link: "/design/HOOKS_SYSTEM_DESIGN" },
          ],
        },
        {
          text: "核心模块 (Phase 1-16)",
          collapsed: false,
          items: [
            { text: "01 知识库管理", link: "/design/modules/01-knowledge-base" },
            { text: "02 去中心化社交", link: "/design/modules/02-decentralized-social" },
            { text: "03 交易辅助", link: "/design/modules/03-trading" },
            { text: "04 项目管理", link: "/design/modules/04-project-management" },
            { text: "05 企业版组织", link: "/design/modules/05-enterprise-org" },
            { text: "06 AI优化系统", link: "/design/modules/06-ai-optimization" },
            { text: "07 性能优化", link: "/design/modules/07-performance" },
            { text: "08 MCP与配置", link: "/design/modules/08-mcp-config" },
            { text: "09 浏览器自动化", link: "/design/modules/09-browser-automation" },
            { text: "10 远程控制", link: "/design/modules/10-remote-control" },
            { text: "11 企业审计", link: "/design/modules/11-audit" },
            { text: "12 插件市场", link: "/design/modules/12-plugin-marketplace" },
            { text: "13 多代理系统", link: "/design/modules/13-multi-agent" },
            { text: "14 SSO企业认证", link: "/design/modules/14-sso" },
            { text: "15 MCP SDK", link: "/design/modules/15-mcp-sdk" },
            { text: "16 AI技能系统", link: "/design/modules/16-ai-skills" },
          ],
        },
        {
          text: "企业增强 (Phase 17-28)",
          collapsed: true,
          items: [
            { text: "17 EvoMap系统", link: "/design/modules/17-evomap" },
            { text: "17 IPFS存储", link: "/design/modules/17b-ipfs" },
            { text: "18 P2P实时协作", link: "/design/modules/18-p2p-collab" },
            { text: "18 社交AI", link: "/design/modules/18b-social-ai" },
            { text: "19 合规分类", link: "/design/modules/19-compliance" },
            { text: "19 自治Agent", link: "/design/modules/19b-agent-runner" },
            { text: "20 企业用户配置", link: "/design/modules/20-scim" },
            { text: "20 模型量化", link: "/design/modules/20b-quantization" },
            { text: "21 i18n国际化", link: "/design/modules/21-i18n" },
            { text: "21 统一密钥", link: "/design/modules/21b-unified-key" },
            { text: "22 性能自动调优", link: "/design/modules/22-auto-tuning" },
            { text: "22 内容推荐", link: "/design/modules/22b-content-rec" },
            { text: "23 Nostr桥接", link: "/design/modules/23-nostr" },
            { text: "23 企业组织管理", link: "/design/modules/23b-org-management" },
            { text: "24 去中心化Agent", link: "/design/modules/24-agent-network" },
            { text: "24 数据防泄漏", link: "/design/modules/24b-dlp" },
            { text: "25 SIEM", link: "/design/modules/25-siem" },
            { text: "25 自治运维", link: "/design/modules/25b-autonomous-ops" },
            { text: "26 开发流水线", link: "/design/modules/26-pipeline" },
            { text: "26 社区治理", link: "/design/modules/26b-governance" },
            { text: "27 Matrix集成", link: "/design/modules/27-matrix" },
            { text: "27 多模态协作", link: "/design/modules/27b-multimodal" },
            { text: "28 基础设施编排", link: "/design/modules/28-infrastructure" },
            { text: "28 自然语言编程", link: "/design/modules/28b-nl-programming" },
          ],
        },
        {
          text: "生产加固 (Phase 29-42)",
          collapsed: true,
          items: [
            { text: "29 生产强化", link: "/design/modules/29-production-hardening" },
            { text: "30 联邦强化", link: "/design/modules/30-federation-hardening" },
            { text: "31 压力测试", link: "/design/modules/31-stress-test" },
            { text: "32 信誉优化", link: "/design/modules/32-reputation" },
            { text: "33 跨组织SLA", link: "/design/modules/33-sla" },
            { text: "34 技术学习引擎", link: "/design/modules/34-tech-learning" },
            { text: "35 自主开发者", link: "/design/modules/35-autonomous-dev" },
            { text: "36 协作治理", link: "/design/modules/36-collab-governance" },
            { text: "37 技能市场", link: "/design/modules/37-skill-marketplace" },
            { text: "38 推理网络", link: "/design/modules/38-inference-network" },
            { text: "39 信任安全", link: "/design/modules/39-trust-security" },
            { text: "40 协议融合", link: "/design/modules/40-protocol-fusion" },
            { text: "41 去中心化基础设施", link: "/design/modules/41-decentralized-infra" },
            { text: "42 EvoMap高级联邦", link: "/design/modules/42-evomap-federation" },
          ],
        },
        {
          text: "架构重构 (Phase 43-57)",
          collapsed: true,
          items: [
            { text: "43 IPC域分割", link: "/design/modules/43-ipc-split" },
            { text: "44 DI容器", link: "/design/modules/44-di-container" },
            { text: "45 数据库演进", link: "/design/modules/45-db-migration" },
            { text: "46 A2A协议", link: "/design/modules/46-a2a-protocol" },
            { text: "47 工作流编排", link: "/design/modules/47-workflow" },
            { text: "48 层次化记忆2.0", link: "/design/modules/48-hierarchical-memory" },
            { text: "49 多模态感知", link: "/design/modules/49-multimodal-perception" },
            { text: "50 Agent经济", link: "/design/modules/50-agent-economy" },
            { text: "51 代码生成Agent", link: "/design/modules/51-code-agent" },
            { text: "52 安全沙箱2.0", link: "/design/modules/52-sandbox" },
            { text: "53 零知识证明", link: "/design/modules/53-zkp" },
            { text: "54 跨链互操作", link: "/design/modules/54-cross-chain" },
            { text: "55 DID 2.0", link: "/design/modules/55-did-v2" },
            { text: "56 隐私计算", link: "/design/modules/56-privacy-computing" },
            { text: "57 DAO治理2.0", link: "/design/modules/57-dao-governance" },
          ],
        },
        {
          text: "企业平台 (Phase 58-65)",
          collapsed: true,
          items: [
            { text: "58 低代码平台", link: "/design/modules/58-low-code" },
            { text: "59 企业知识图谱", link: "/design/modules/59-knowledge-graph" },
            { text: "60 BI智能分析", link: "/design/modules/60-bi-engine" },
            { text: "61 工作流自动化", link: "/design/modules/61-workflow-automation" },
            { text: "62 多租户SaaS", link: "/design/modules/62-saas" },
            { text: "63 统一运行时", link: "/design/modules/63-unified-runtime" },
            { text: "64 插件生态2.0", link: "/design/modules/64-plugin-ecosystem" },
            { text: "65 自进化AI", link: "/design/modules/65-self-evolving-ai" },
          ],
        },
        {
          text: "CLI系统与扩展 (Phase 66-71) ⭐",
          collapsed: false,
          items: [
            { text: "66 CLI分发系统", link: "/design/modules/66-cli-distribution" },
            { text: "67 CLI高级功能", link: "/design/modules/67-cli-advanced" },
            { text: "68 CLI-Anything集成", link: "/design/modules/68-cli-anything" },
            { text: "69 WebSocket服务器", link: "/design/modules/69-websocket-server" },
            { text: "70 Agent智能增强", link: "/design/modules/70-agent-intelligence" },
            { text: "71 子代理隔离", link: "/design/modules/71-sub-agent-isolation" },
            { text: "71b AI音视频创作模板 ⭐", link: "/design/modules/71b-ai-media-creator" },
            { text: "72 AI文档创作模板 ⭐", link: "/design/modules/72-ai-doc-creator" },
            { text: "73 Web管理界面 ⭐", link: "/design/modules/73-web-ui" },
            { text: "74 AI编排层系统 ⭐", link: "/design/modules/74-orchestration-layer" },
            { text: "75 Vue3 Web管理面板 10模块+4主题 ⭐", link: "/design/modules/75-web-panel" },
            { text: "76 Skill Creator系统 ⭐", link: "/design/modules/76-skill-creator" },
            { text: "77 Agent架构优化 ⭐", link: "/design/modules/77-agent-optimization" },
            { text: "78 CLI Agent Runtime重构计划 ⭐", link: "/design/modules/78-cli-agent-runtime" },
            { text: "79 Coding Agent系统 ⭐", link: "/design/modules/79-coding-agent" },
            { text: "80 规范工作流系统 ⭐", link: "/design/modules/80-canonical-workflow" },
            { text: "81 轻量多Agent编排 ⭐NEW", link: "/design/modules/81-sub-runtime-pool" },
            { text: "82 CLI Runtime收口路线图 ⭐NEW", link: "/design/modules/82-cli-runtime-convergence" },
            { text: "83 工具描述规范统一 ⭐NEW", link: "/design/modules/83-tool-descriptor-unification" },
            { text: "84 自主学习闭环系统 ⭐NEW", link: "/design/modules/84-autonomous-learning-loop" },
            { text: "85 Hermes Agent对标 ⭐NEW", link: "/design/modules/85-hermes-agent-parity" },
            { text: "85b 文档代码差距补全 ⭐NEW", link: "/design/modules/85b-doc-code-gap-fill" },
            { text: "86 Web Cowork协作 ⭐NEW", link: "/design/modules/86-web-cowork" },
            { text: "88 Open-Agents 对标 ⭐NEW", link: "/design/modules/88-open-agents-parity" },
            { text: "89 v5.0.2.9 六项优化 ⭐NEW", link: "/design/modules/89-runtime-six-enhancements" },
            { text: "90 AI视频生成 Seedance ⭐NEW", link: "/design/modules/90-ai-video-generation-seedance" },
            { text: "91 Managed Agents 对标 ⭐NEW", link: "/design/modules/91-managed-agents-parity" },
            { text: "92 Deep Agents Deploy ⭐NEW", link: "/design/modules/92-deep-agents-deploy" },
            { text: "93 CutClaw 视频剪辑 Agent ⭐NEW", link: "/design/modules/93-cutclaw-video-editing-agent" },
            { text: "94 QualityGate 通用质量门控 ⭐NEW", link: "/design/modules/94-quality-gate" },
            { text: "95 社交协议生态补齐 ⭐NEW", link: "/design/modules/95-social-protocols-landing" },
            { text: "60b CLI指令技能包 ⭐", link: "/design/modules/60b-cli-skill-packs" },
          ],
        },
      ],

      "/manufacturer/": [
        {
          text: "厂家管理系统",
          items: [
            { text: "系统概述", link: "/manufacturer/overview" },
            { text: "快速开始", link: "/manufacturer/quick-start" },
            { text: "安装部署", link: "/manufacturer/installation" },
          ],
        },
        {
          text: "设备管理",
          items: [
            { text: "设备注册", link: "/manufacturer/device-register" },
            { text: "设备激活", link: "/manufacturer/device-activate" },
            { text: "设备管理", link: "/manufacturer/device-manage" },
          ],
        },
        {
          text: "APP版本管理",
          items: [
            { text: "版本上传", link: "/manufacturer/app-upload" },
            { text: "版本发布", link: "/manufacturer/app-publish" },
            { text: "更新检查", link: "/manufacturer/app-update" },
          ],
        },
        {
          text: "数据管理",
          items: [
            { text: "数据备份", link: "/manufacturer/data-backup" },
            { text: "数据恢复", link: "/manufacturer/data-restore" },
            { text: "密码恢复", link: "/manufacturer/password-recovery" },
          ],
        },
        {
          text: "系统管理",
          items: [
            { text: "用户管理", link: "/manufacturer/user-management" },
            { text: "操作日志", link: "/manufacturer/operation-logs" },
            { text: "权限控制", link: "/manufacturer/permissions" },
          ],
        },
      ],

      "/api/": [
        {
          text: "API文档",
          items: [
            { text: "API简介", link: "/api/introduction" },
            { text: "认证授权", link: "/api/authentication" },
          ],
        },
        {
          text: "厂家管理系统API",
          items: [
            { text: "设备管理", link: "/api/manufacturer/devices" },
            { text: "APP版本", link: "/api/manufacturer/app-versions" },
            { text: "数据备份", link: "/api/manufacturer/backups" },
            { text: "用户管理", link: "/api/manufacturer/users" },
            { text: "操作日志", link: "/api/manufacturer/logs" },
          ],
        },
        {
          text: "ChainlessChain API",
          items: [
            { text: "知识库", link: "/api/chainlesschain/knowledge" },
            { text: "社交", link: "/api/chainlesschain/social" },
            { text: "交易", link: "/api/chainlesschain/trading" },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: "github", link: "https://github.com/chainlesschain" },
    ],

    footer: {
      message: "基于 MIT 许可发布",
      copyright: "Copyright © 2024-2026 ChainlessChain Team",
    },

    search: {
      provider: "local",
    },

    editLink: {
      pattern: "https://github.com/chainlesschain/docs/edit/main/docs/:path",
      text: "在 GitHub 上编辑此页",
    },

    lastUpdated: {
      text: "最后更新于",
      formatOptions: {
        dateStyle: "short",
        timeStyle: "medium",
      },
    },

    docFooter: {
      prev: "上一页",
      next: "下一页",
    },

    outline: {
      label: "页面导航",
    },

    returnToTopLabel: "回到顶部",
    sidebarMenuLabel: "菜单",
    darkModeSwitchLabel: "主题",
    lightModeSwitchTitle: "切换到浅色模式",
    darkModeSwitchTitle: "切换到深色模式",
  },
});

