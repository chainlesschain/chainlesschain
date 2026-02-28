import { defineConfig } from "vitepress";

export default defineConfig({
  title: "ChainlessChain 设计文档",
  description: "去中心化个人AI管理系统 — 系统架构与模块设计文档（面向开发者）",
  lang: "zh-CN",
  ignoreDeadLinks: true,

  head: [
    ["link", { rel: "icon", href: "/favicon.ico" }],
    ["meta", { name: "theme-color", content: "#6366f1" }],
  ],

  themeConfig: {
    logo: "/logo.png",

    nav: [
      { text: "首页", link: "/" },
      { text: "系统总览", link: "/系统设计_主文档" },
      {
        text: "模块设计",
        items: [
          { text: "核心模块 (01-08)", link: "/modules/01_知识库管理模块" },
          { text: "扩展模块 (09-16)", link: "/modules/09_浏览器自动化系统" },
          { text: "EvoMap + 企业 (17-28)", link: "/modules/17_EvoMap系统" },
          {
            text: "生产 + AI (29-36)",
            link: "/modules/29_ProductionHardening系统",
          },
          {
            text: "市场 + 安全 (37-42)",
            link: "/modules/37_SkillMarketplace系统",
          },
        ],
      },
      {
        text: "基础设施",
        items: [
          { text: "安全机制设计", link: "/安全机制设计" },
          { text: "数据同步方案", link: "/数据同步方案" },
          { text: "AI模型部署", link: "/AI模型部署方案" },
          { text: "Hooks系统", link: "/HOOKS_SYSTEM_DESIGN" },
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
            { text: "系统设计主文档", link: "/系统设计_主文档" },
            { text: "安全机制设计", link: "/安全机制设计" },
            { text: "数据同步方案", link: "/数据同步方案" },
            { text: "AI模型部署方案", link: "/AI模型部署方案" },
            { text: "实施总结与附录", link: "/实施总结与附录" },
          ],
        },
        {
          text: "扩展系统设计",
          items: [
            { text: "Hooks扩展系统", link: "/HOOKS_SYSTEM_DESIGN" },
            { text: "浏览器扩展规划", link: "/BROWSER_EXTENSION_PLAN" },
          ],
        },
        {
          text: "核心模块 (01-08)",
          collapsed: false,
          items: [
            { text: "01 知识库管理", link: "/modules/01_知识库管理模块" },
            { text: "02 去中心化社交", link: "/modules/02_去中心化社交模块" },
            { text: "03 交易辅助", link: "/modules/03_交易辅助模块" },
            { text: "04 项目管理 ⭐", link: "/modules/04_项目管理模块" },
            { text: "05 企业版组织", link: "/modules/05_企业版组织模块" },
            { text: "06 AI优化系统", link: "/modules/06_AI优化系统" },
            { text: "07 性能优化系统", link: "/modules/07_性能优化系统" },
            { text: "08 MCP与配置系统", link: "/modules/08_MCP与配置系统" },
          ],
        },
        {
          text: "扩展模块 (09-16)",
          collapsed: false,
          items: [
            { text: "09 浏览器自动化", link: "/modules/09_浏览器自动化系统" },
            { text: "10 远程控制系统", link: "/modules/10_远程控制系统" },
            { text: "11 企业审计系统", link: "/modules/11_企业审计系统" },
            { text: "12 插件市场系统", link: "/modules/12_插件市场系统" },
            { text: "13 多代理系统", link: "/modules/13_多代理系统" },
            { text: "14 SSO企业认证", link: "/modules/14_SSO企业认证" },
            { text: "15 MCP SDK系统", link: "/modules/15_MCP_SDK系统" },
            { text: "16 AI技能系统", link: "/modules/16_AI技能系统" },
          ],
        },
        {
          text: "Phase 41-45 — EvoMap + 企业增强",
          collapsed: true,
          items: [
            { text: "17 EvoMap系统", link: "/modules/17_EvoMap系统" },
            { text: "18 SocialAI系统", link: "/modules/18_SocialAI系统" },
            { text: "19 Compliance系统", link: "/modules/19_Compliance系统" },
            { text: "20 SCIM系统", link: "/modules/20_SCIM系统" },
            { text: "21 UnifiedKey系统", link: "/modules/21_UnifiedKey系统" },
          ],
        },
        {
          text: "Phase 48-56 — 安全与社交扩展",
          collapsed: true,
          items: [
            {
              text: "22 内容推荐系统",
              link: "/modules/22_ContentRecommendation系统",
            },
            { text: "23 Nostr Bridge", link: "/modules/23_NostrBridge系统" },
            { text: "24 DLP系统", link: "/modules/24_DLP系统" },
            { text: "25 SIEM系统", link: "/modules/25_SIEM系统" },
            { text: "26 Governance系统", link: "/modules/26_Governance系统" },
            { text: "27 Matrix Bridge", link: "/modules/27_MatrixBridge系统" },
            { text: "28 Terraform系统", link: "/modules/28_Terraform系统" },
          ],
        },
        {
          text: "Phase 57-61 — v2.0 生产加固",
          collapsed: true,
          items: [
            {
              text: "29 生产强化",
              link: "/modules/29_ProductionHardening系统",
            },
            {
              text: "30 联邦硬化",
              link: "/modules/30_FederationHardening系统",
            },
            { text: "31 压力测试", link: "/modules/31_StressTest系统" },
            {
              text: "32 信誉优化器",
              link: "/modules/32_ReputationOptimizer系统",
            },
            { text: "33 SLA管理", link: "/modules/33_SLAManager系统" },
          ],
        },
        {
          text: "Phase 62-64 — v3.0 自主AI",
          collapsed: true,
          items: [
            { text: "34 技术学习引擎", link: "/modules/34_TechLearning系统" },
            {
              text: "35 自主开发者",
              link: "/modules/35_AutonomousDeveloper系统",
            },
            {
              text: "36 协作治理",
              link: "/modules/36_CollaborationGovernance系统",
            },
          ],
        },
        {
          text: "Phase 65-71 — v3.1-v3.2 市场与安全",
          collapsed: true,
          items: [
            { text: "37 技能市场", link: "/modules/37_SkillMarketplace系统" },
            { text: "38 推理网络", link: "/modules/38_InferenceNetwork系统" },
            { text: "39 信任安全", link: "/modules/39_TrustSecurity系统" },
          ],
        },
        {
          text: "Phase 72-77 — v3.3-v3.4 协议融合与EvoMap",
          collapsed: true,
          items: [
            { text: "40 协议融合", link: "/modules/40_ProtocolFusion系统" },
            {
              text: "41 去中心化基础设施",
              link: "/modules/41_DecentralizedInfra系统",
            },
            { text: "42 EvoMap高级", link: "/modules/42_EvoMapAdvanced系统" },
          ],
        },
        {
          text: "归档",
          collapsed: true,
          items: [
            { text: "原始完整文档", link: "/系统设计_个人移动AI管理系统" },
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
