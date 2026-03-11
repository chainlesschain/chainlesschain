import { defineConfig } from "vitepress";

export default defineConfig({
  title: "ChainlessChain 文档",
  description: "去中心化个人AI管理系统和U盾/SIMKey厂家管理平台完整文档",
  lang: "zh-CN",
  ignoreDeadLinks: true,

  head: [
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
      { text: "API参考", link: "/api/introduction" },
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
