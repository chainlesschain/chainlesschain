import { defineConfig } from "vitepress";

export default defineConfig({
  title: "ChainlessChain 设计文档",
  description: "去中心化个人AI管理系统 — 系统架构与模块设计文档（面向开发者）",
  lang: "zh-CN",
  ignoreDeadLinks: true,

  head: [
    ["link", { rel: "icon", href: "/favicon.ico" }],
    ["meta", { name: "theme-color", content: "#6366f1" }],
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
      { text: "系统总览", link: "/system-design-main" },
      {
        text: "模块设计",
        items: [
          {
            text: "核心模块 (01-08)",
            link: "/modules/m01-knowledge-base",
          },
          {
            text: "扩展模块 (09-16)",
            link: "/modules/m09-browser-automation",
          },
          {
            text: "演化图谱与企业增强 (17-28)",
            link: "/modules/m17-evomap",
          },
          {
            text: "生产加固与AI (29-36)",
            link: "/modules/m29-production-hardening",
          },
          {
            text: "市场与安全生态 (37-42)",
            link: "/modules/m37-skill-marketplace",
          },
          {
            text: "v5.0.0-v5.0.1 架构重构与生态融合 (43-71)",
            link: "/modules/m43-ipc-domain-split",
          },
          {
            text: "v5.0.2 CLI技能包与AI模板 (60b, 71b, 72)",
            link: "/modules/m60b-cli-skill-packs",
          },
          {
            text: "v5.0.2.2 Web管理界面 (73)",
            link: "/modules/m73-web-ui",
          },
          {
            text: "v5.0.2.4 AI编排层 (74)",
            link: "/modules/m74-orchestration-layer",
          },
          {
            text: "v5.0.2.8 Web管理面板 10模块+4主题 (75) ⭐NEW",
            link: "/modules/m75-web-panel",
          },
          {
            text: "v5.0.2.7 Skill Creator (76)",
            link: "/modules/m76-skill-creator",
          },
          {
            text: "v5.0.2.10 Agent 架构优化 (77)",
            link: "/modules/m77-agent-optimization",
          },
          {
            text: "v5.0.2.10 CLI Agent Runtime 重构 (78) ⭐NEW",
            link: "/modules/m78-cli-agent-runtime",
          },
          {
            text: "v5.0.2.10 Coding Agent 系统 (79)",
            link: "/modules/m79-coding-agent",
          },
          {
            text: "v5.0.2.10 Runtime收口 (80-83) ⭐NEW",
            link: "/modules/m80-canonical-workflow",
          },
        ],
      },
      {
        text: "基础设施",
        items: [
          { text: "安全机制设计", link: "/security-design" },
          { text: "数据同步方案", link: "/data-sync-design" },
          { text: "AI模型部署", link: "/ai-model-deploy" },
          { text: "Hooks扩展系统", link: "/HOOKS_SYSTEM_DESIGN" },
          {
            text: "Minimal Coding Agent 实施计划",
            link: "/MINIMAL_CODING_AGENT_PLAN",
          },
        ],
      },
      {
        text: "相关链接",
        items: [
          { text: "用户文档站", link: "https://docs.chainlesschain.com" },
          { text: "GitHub", link: "https://github.com/chainlesschain" },
        ],
      },
    ],

    sidebar: {
      "/": [
        {
          text: "系统总览",
          items: [
            { text: "系统设计主文档", link: "/system-design-main" },
            { text: "安全机制设计", link: "/security-design" },
            { text: "数据同步方案", link: "/data-sync-design" },
            { text: "AI模型部署方案", link: "/ai-model-deploy" },
            { text: "实施总结与附录", link: "/implementation-summary" },
          ],
        },
        {
          text: "扩展系统设计",
          items: [
            { text: "Hooks扩展系统", link: "/HOOKS_SYSTEM_DESIGN" },
            { text: "浏览器扩展规划", link: "/BROWSER_EXTENSION_PLAN" },
            {
              text: "Minimal Coding Agent 实施计划 ⭐NEW",
              link: "/MINIMAL_CODING_AGENT_PLAN",
            },
          ],
        },
        {
          text: "核心模块 (01-08)",
          collapsed: false,
          items: [
            {
              text: "01 知识库管理",
              link: "/modules/m01-knowledge-base",
            },
            {
              text: "02 去中心化社交",
              link: "/modules/m02-decentralized-social",
            },
            {
              text: "03 交易辅助",
              link: "/modules/m03-trading-assistant",
            },
            {
              text: "04 项目管理 ⭐",
              link: "/modules/m04-project-management",
            },
            {
              text: "05 企业版组织",
              link: "/modules/m05-enterprise-org",
            },
            {
              text: "06 AI优化系统",
              link: "/modules/m06-ai-optimization",
            },
            {
              text: "07 性能优化系统",
              link: "/modules/m07-performance-optimization",
            },
            { text: "08 MCP与配置系统", link: "/modules/m08-mcp-config" },
          ],
        },
        {
          text: "扩展模块 (09-16)",
          collapsed: false,
          items: [
            {
              text: "09 浏览器自动化",
              link: "/modules/m09-browser-automation",
            },
            {
              text: "10 远程控制系统",
              link: "/modules/m10-remote-control",
            },
            {
              text: "11 企业审计系统",
              link: "/modules/m11-enterprise-audit",
            },
            {
              text: "12 插件市场系统",
              link: "/modules/m12-plugin-marketplace",
            },
            { text: "13 多代理系统", link: "/modules/m13-multi-agent" },
            {
              text: "14 SSO企业认证",
              link: "/modules/m14-sso-enterprise-auth",
            },
            { text: "15 MCP SDK系统", link: "/modules/m15-mcp-sdk" },
            { text: "16 AI技能系统", link: "/modules/m16-ai-skills" },
          ],
        },
        {
          text: "v1.0.0 — 企业与基础增强 (17-23)",
          collapsed: true,
          items: [
            {
              text: "17 IPFS去中心化存储 ⭐",
              link: "/modules/m17b-ipfs-storage",
            },
            {
              text: "18 P2P实时协作系统 ⭐",
              link: "/modules/m18b-p2p-realtime-collab",
            },
            {
              text: "19 自治Agent Runner ⭐",
              link: "/modules/m19b-agent-runner",
            },
            {
              text: "20 模型量化系统 ⭐",
              link: "/modules/m20b-model-quantization",
            },
            { text: "21 i18n国际化 ⭐", link: "/modules/m21b-i18n" },
            {
              text: "22 性能自动调优 ⭐",
              link: "/modules/m22b-performance-tuning",
            },
            {
              text: "23 企业组织管理 ⭐",
              link: "/modules/m23b-enterprise-org-mgmt",
            },
          ],
        },
        {
          text: "v1.1.0 — 全栈智能化 (24-28)",
          collapsed: true,
          items: [
            {
              text: "24 去中心化Agent网络 ⭐",
              link: "/modules/m24-decentralized-agent-network",
            },
            {
              text: "25 自治运维系统 ⭐",
              link: "/modules/m25b-autonomous-ops",
            },
            {
              text: "26 开发流水线编排 ⭐",
              link: "/modules/m26b-dev-pipeline",
            },
            {
              text: "27 多模态协作 ⭐",
              link: "/modules/m27b-multimodal-collab",
            },
            {
              text: "28 自然语言编程 ⭐",
              link: "/modules/m28b-nl-programming",
            },
          ],
        },
        {
          text: "Phase 41-45 — 演化图谱与企业增强",
          collapsed: true,
          items: [
            { text: "17 演化图谱系统", link: "/modules/m17-evomap" },
            { text: "18 社交AI系统", link: "/modules/m18-social-ai" },
            { text: "19 合规分类系统", link: "/modules/m19-compliance" },
            {
              text: "20 企业用户配置系统",
              link: "/modules/m20-enterprise-provisioning",
            },
            { text: "21 统一密钥系统", link: "/modules/m21-unified-key" },
          ],
        },
        {
          text: "Phase 48-56 — 安全与社交扩展",
          collapsed: true,
          items: [
            {
              text: "22 内容推荐系统",
              link: "/modules/m22-content-recommendation",
            },
            {
              text: "23 去中心化桥接系统",
              link: "/modules/m23-nostr-bridge",
            },
            {
              text: "24 数据防泄漏系统",
              link: "/modules/m24b-dlp-prevention",
            },
            {
              text: "25 安全信息事件管理系统",
              link: "/modules/m25-siem",
            },
            {
              text: "26 社区治理系统",
              link: "/modules/m26-community-governance",
            },
            {
              text: "27 即时通讯集成系统",
              link: "/modules/m27-matrix-integration",
            },
            {
              text: "28 基础设施编排系统",
              link: "/modules/m28-infra-orchestration",
            },
          ],
        },
        {
          text: "Phase 57-61 — v2.0 生产加固",
          collapsed: true,
          items: [
            {
              text: "29 生产强化",
              link: "/modules/m29-production-hardening",
            },
            {
              text: "30 联邦强化系统",
              link: "/modules/m30-federation-hardening",
            },
            {
              text: "31 压力测试系统",
              link: "/modules/m31-stress-testing",
            },
            {
              text: "32 信誉优化系统",
              link: "/modules/m32-reputation-optimizer",
            },
            {
              text: "33 跨组织SLA管理系统",
              link: "/modules/m33-cross-org-sla",
            },
          ],
        },
        {
          text: "Phase 62-64 — v3.0 自主AI开发",
          collapsed: true,
          items: [
            {
              text: "34 技术学习引擎",
              link: "/modules/m34-tech-learning",
            },
            {
              text: "35 自主开发者系统",
              link: "/modules/m35-autonomous-developer",
            },
            {
              text: "36 协作治理系统",
              link: "/modules/m36-collaboration-governance",
            },
          ],
        },
        {
          text: "Phase 65-71 — v3.1-v3.2 市场与安全生态",
          collapsed: true,
          items: [
            {
              text: "37 技能市场系统",
              link: "/modules/m37-skill-marketplace",
            },
            {
              text: "38 去中心化推理网络",
              link: "/modules/m38-decentralized-inference",
            },
            {
              text: "39 信任安全系统",
              link: "/modules/m39-trust-security",
            },
          ],
        },
        {
          text: "Phase 72-77 — v3.3-v3.4 协议融合与演化图谱",
          collapsed: true,
          items: [
            {
              text: "40 协议融合系统",
              link: "/modules/m40-protocol-fusion",
            },
            {
              text: "41 去中心化基础设施",
              link: "/modules/m41-decentralized-infra",
            },
            {
              text: "42 演化图谱高级联邦",
              link: "/modules/m42-evomap-federation",
            },
          ],
        },
        {
          text: "v5.0.0 Milestone 1 — 架构重构基座 (43-45)",
          collapsed: true,
          items: [
            {
              text: "43 IPC域分割与懒加载",
              link: "/modules/m43-ipc-domain-split",
            },
            {
              text: "44 共享资源层与DI容器",
              link: "/modules/m44-di-container",
            },
            {
              text: "45 数据库演进与迁移框架",
              link: "/modules/m45-database-migration",
            },
          ],
        },
        {
          text: "v5.0.0 Milestone 2 — AI Agent 2.0 (46-52)",
          collapsed: true,
          items: [
            {
              text: "46 A2A协议引擎",
              link: "/modules/m46-a2a-protocol",
            },
            {
              text: "47 自主工作流编排器",
              link: "/modules/m47-workflow-orchestrator",
            },
            {
              text: "48 层次化记忆2.0",
              link: "/modules/m48-hierarchical-memory",
            },
            {
              text: "49 多模态感知层",
              link: "/modules/m49-multimodal-perception",
            },
            {
              text: "50 Agent经济系统",
              link: "/modules/m50-agent-economy",
            },
            {
              text: "51 代码生成Agent 2.0",
              link: "/modules/m51-code-agent",
            },
            {
              text: "52 Agent安全沙箱2.0",
              link: "/modules/m52-agent-sandbox",
            },
          ],
        },
        {
          text: "v5.0.0 Milestone 3 — Web3深化 (53-57)",
          collapsed: true,
          items: [
            {
              text: "53 零知识证明引擎",
              link: "/modules/m53-zkp-engine",
            },
            {
              text: "54 跨链互操作协议",
              link: "/modules/m54-cross-chain",
            },
            {
              text: "55 去中心化身份2.0",
              link: "/modules/m55-did-v2",
            },
            {
              text: "56 隐私计算框架",
              link: "/modules/m56-privacy-computing",
            },
            {
              text: "57 DAO治理2.0",
              link: "/modules/m57-dao-governance",
            },
          ],
        },
        {
          text: "v5.0.0 Milestone 4 — 企业级平台 (58-62)",
          collapsed: true,
          items: [
            { text: "58 低代码平台", link: "/modules/m58-low-code" },
            {
              text: "59 企业知识图谱",
              link: "/modules/m59-enterprise-kg",
            },
            {
              text: "60 BI智能分析",
              link: "/modules/m60-bi-analytics",
            },
            {
              text: "61 工作流自动化引擎",
              link: "/modules/m61-workflow-automation",
            },
            {
              text: "62 多租户SaaS引擎",
              link: "/modules/m62-multi-tenant-saas",
            },
          ],
        },
        {
          text: "v5.0.0 Milestone 5 — 生态融合 (63-65)",
          collapsed: true,
          items: [
            {
              text: "63 统一应用运行时",
              link: "/modules/m63-unified-runtime",
            },
            {
              text: "64 智能插件生态2.0",
              link: "/modules/m64-plugin-ecosystem",
            },
            {
              text: "65 自进化AI系统",
              link: "/modules/m65-self-evolving-ai",
            },
          ],
        },
        {
          text: "v5.0.1 CLI 分发与高级功能 (66-71)",
          collapsed: false,
          items: [
            {
              text: "66 CLI分发系统",
              link: "/modules/m66-cli-distribution",
            },
            {
              text: "67 CLI高级功能补齐 ⭐",
              link: "/modules/m67-cli-advanced",
            },
            {
              text: "68 CLI-Anything集成 ⭐",
              link: "/modules/m68-cli-anything",
            },
            {
              text: "69 WebSocket服务器接口 ⭐",
              link: "/modules/m69-websocket-server",
            },
            {
              text: "70 Agent智能增强系统 ⭐",
              link: "/modules/m70-agent-intelligence",
            },
            {
              text: "71 子代理隔离系统 ⭐",
              link: "/modules/m71-sub-agent-isolation",
            },
          ],
        },
        {
          text: "v5.0.2 CLI技能包与AI模板 (60b, 71b, 72)",
          collapsed: false,
          items: [
            {
              text: "60b CLI指令技能包系统 ⭐",
              link: "/modules/m60b-cli-skill-packs",
            },
            {
              text: "71b AI音视频创作模板 ⭐",
              link: "/modules/m71b-ai-media-creator",
            },
            {
              text: "72 AI文档创作模板 ⭐",
              link: "/modules/m72-ai-doc-creator",
            },
          ],
        },
        {
          text: "v5.0.2.2 Web管理界面 (73)",
          collapsed: false,
          items: [
            {
              text: "73 Web管理界面",
              link: "/modules/m73-web-ui",
            },
          ],
        },
        {
          text: "v5.0.2.4 AI编排层 (74)",
          collapsed: false,
          items: [
            {
              text: "74 AI编排层系统",
              link: "/modules/m74-orchestration-layer",
            },
          ],
        },
        {
          text: "v5.0.2.8 Web管理面板 10模块+4主题 (75) ⭐NEW",
          collapsed: false,
          items: [
            {
              text: "75 Vue3 Web管理面板 10模块+4主题 ⭐NEW",
              link: "/modules/m75-web-panel",
            },
          ],
        },
        {
          text: "v5.0.2.7 Skill Creator (76)",
          collapsed: false,
          items: [
            {
              text: "76 Skill Creator系统",
              link: "/modules/m76-skill-creator",
            },
          ],
        },
        {
          text: "v5.0.2.10 Agent 架构与 Runtime 重构 (77-83) ⭐NEW",
          collapsed: false,
          items: [
            {
              text: "77 Agent 架构优化系统",
              link: "/modules/m77-agent-optimization",
            },
            {
              text: "78 CLI Agent Runtime 重构实施计划",
              link: "/modules/m78-cli-agent-runtime",
            },
            {
              text: "79 Coding Agent 系统",
              link: "/modules/m79-coding-agent",
            },
            {
              text: "80 规范工作流系统",
              link: "/modules/m80-canonical-workflow",
            },
            {
              text: "81 轻量多Agent编排系统",
              link: "/modules/m81-sub-runtime-pool",
            },
            {
              text: "82 CLI Runtime 收口路线图",
              link: "/modules/m82-cli-runtime-convergence",
            },
            {
              text: "83 工具描述规范统一",
              link: "/modules/m83-tool-descriptor-unification",
            },
            {
              text: "84 自主学习闭环系统",
              link: "/modules/m84-autonomous-learning-loop",
            },
            {
              text: "85 Hermes Agent对标实施方案",
              link: "/modules/m85-hermes-agent-parity",
            },
            {
              text: "85b 文档代码差距补全",
              link: "/modules/m85b-doc-code-gap-fill",
            },
            {
              text: "86 Web Cowork日常任务协作系统",
              link: "/modules/m86-web-cowork",
            },
            {
              text: "87 Cowork Evolution N1-N7",
              link: "/modules/m87-cowork-evolution",
            },
            {
              text: "88 OpenAgents对标补齐方案",
              link: "/modules/m88-open-agents-parity",
            },
            {
              text: "89 v5.0.2.9 六项优化设计说明",
              link: "/modules/m89-runtime-six-enhancements",
            },
            {
              text: "90 AI视频生成 Volcengine Seedance",
              link: "/modules/m90-ai-video-generation-seedance",
            },
            {
              text: "91 Managed Agents对标计划",
              link: "/modules/m91-managed-agents-parity",
            },
            {
              text: "92 Deep Agents Deploy 借鉴落地方案",
              link: "/modules/m92-deep-agents-deploy",
            },
            {
              text: "93 CutClaw借鉴 视频剪辑Agent",
              link: "/modules/m93-cutclaw-video-editing-agent",
            },
            {
              text: "94 QualityGate 通用质量门控 ⭐NEW",
              link: "/modules/m94-quality-gate",
            },
          ],
        },
        {
          text: "归档",
          collapsed: true,
          items: [
            { text: "原始完整文档", link: "/system-design-full" },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: "github", link: "https://github.com/chainlesschain" },
    ],

    footer: {
      message: "ChainlessChain 系统设计文档 — 面向开发者",
      copyright: "Copyright © 2024-2026 ChainlessChain Team",
    },

    search: {
      provider: "local",
    },

    editLink: {
      pattern:
        "https://github.com/chainlesschain/chainlesschain/edit/main/docs/design/:path",
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
      level: [2, 3],
    },

    returnToTopLabel: "回到顶部",
    sidebarMenuLabel: "菜单",
    darkModeSwitchLabel: "主题",
    lightModeSwitchTitle: "切换到浅色模式",
    darkModeSwitchTitle: "切换到深色模式",
  },
});
