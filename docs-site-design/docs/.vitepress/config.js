import { defineConfig } from "vitepress";

export default defineConfig({
  title: "ChainlessChain 设计文档",
  description: "去中心化个人AI管理系统 — 系统架构与模块设计文档（面向开发者）",
  lang: "zh-CN",
  ignoreDeadLinks: true,

  head: [
    // Umami self-hosted analytics (data stays on our server; /u/ → 127.0.0.1:3017)
    ["script", {
      defer: "",
      src: "https://www.chainlesschain.com/u/script.js",
      "data-website-id": "a2896710-c627-4621-bf90-af1b33f74a89",
      "data-host-url": "https://www.chainlesschain.com/u",
    }],
    ["link", { rel: "icon", type: "image/png", sizes: "32x32", href: "/logo-32.png" }],
    ["link", { rel: "icon", type: "image/png", sizes: "64x64", href: "/logo-64.png" }],
    ["link", { rel: "icon", type: "image/png", sizes: "128x128", href: "/logo-128.png" }],
    ["link", { rel: "apple-touch-icon", sizes: "128x128", href: "/logo-128.png" }],
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
          {
            text: "v5.0.2.49 CLI 项目打包 ⭐NEW",
            link: "/cc-pack-design",
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
            link: "https://docs.chainlesschain.com/chainlesschain/minimal-coding-agent-plan",
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
          text: "MTC 默克尔树证书",
          items: [
            { text: "落地方案", link: "/mtc-landing-plan" },
            { text: "数据格式 v1", link: "/mtc-data-format-v1" },
            { text: "联邦治理 v1 ⭐NEW", link: "/mtc-federation-governance-v1" },
            { text: "跨链桥设计 v1 ⭐NEW", link: "/mtc-cross-chain-bridge-v1" },
            { text: "v0.2 评审清单", link: "/mtc-review-checklist" },
          ],
        },
        {
          text: "个人数据中台 ⭐NEW 专题",
          items: [
            {
              text: "主架构（13-Phase 路线图）⭐",
              link: "/Personal_Data_Hub_Architecture",
            },
            {
              text: "Python Sidecar 设计（fork sjqz）",
              link: "/Personal_Data_Hub_Python_Sidecar",
            },
            {
              text: "EntityResolver 设计（跨源消歧）",
              link: "/Personal_Data_Hub_EntityResolver",
            },
            {
              text: "Phase 14 移动端原生入口 ⭐NEW",
              link: "/Personal_Data_Hub_Phase_14_Mobile_Native_Entry",
            },
            {
              text: "Phase 14.3 双端流式同步进度 + 审计回查",
              link: "/Personal_Data_Hub_Phase_14_3_Sync_Audit_Streaming",
            },
            {
              text: "E2E Runbook（真账号验收脚本）",
              link: "/Personal_Data_Hub_E2E_Runbook",
            },
            {
              text: "sjqz 对比分析（取舍依据）",
              link: "/Personal_Data_Hub_sjqz_Comparison",
            },
            {
              text: "Phase 11 Analysis Skills（5 内置分析） ✅",
              link: "/Personal_Data_Hub_Analysis_Skills",
            },
            {
              text: "v0.1 → v1 Fixture Pin 协议（方法论）",
              link: "/Personal_Data_Hub_Fixture_Pin_Protocol",
            },
            {
              text: "Adapter — Email (IMAP) ✅ 已上线",
              link: "/Adapter_Email_IMAP",
            },
            {
              text: "Adapter — 支付宝账单 ✅ 已上线",
              link: "/Adapter_Alipay_Bill",
            },
            {
              text: "Adapter — 系统数据（通讯录/通话/短信/WiFi）✅ Phase 4.5",
              link: "/Adapter_System_Data",
            },
            {
              text: "Adapter — Shopping 三件套（淘宝/京东/美团）✅ Phase 7",
              link: "/Adapter_Shopping_Cookie",
            },
            {
              text: "Adapter — Travel 四件套（高德/百度/携程/12306）✅ Phase 9",
              link: "/Adapter_Travel_LBS",
            },
            {
              text: "Adapter — AI 对话历史（9 家国产）✅ Phase 10.2 全 wired",
              link: "/Adapter_AIChat_History",
            },
            {
              text: "Adapter — 社交/即时通讯（7 家）✅ Phase 13",
              link: "/Adapter_Social_Messaging",
            },
            {
              text: "Adapter — 微信 SQLCipher 🚧 v0.5 frida-indep",
              link: "/Adapter_WeChat_SQLCipher",
            },
            {
              text: "微信 Frida Setup Runbook（rooted 用户）",
              link: "/Adapter_WeChat_SQLCipher_Frida_Setup",
            },
            {
              text: "Adapter — Social Cookie 模式（A8）⭐NEW",
              link: "/Adapter_Social_Cookie",
            },
            {
              text: "A8 Bilibili 真机 E2E 计划 ⭐NEW",
              link: "/A8_Bilibili_E2E_Plan",
            },
            {
              text: "A8 Weibo 真机 E2E 计划 ⭐NEW",
              link: "/A8_Weibo_E2E_Plan",
            },
            {
              text: "A8 Douyin 真机 E2E 计划 ⭐NEW",
              link: "/A8_Douyin_E2E_Plan",
            },
            {
              text: "A8 Xiaohongshu 真机 E2E 计划 ⭐NEW",
              link: "/A8_Xhs_E2E_Plan",
            },
            {
              text: "A8 Toutiao 真机 E2E 计划 ⭐NEW",
              link: "/A8_Toutiao_E2E_Plan",
            },
            {
              text: "A8 Kuaishou 真机 E2E 计划 ⭐NEW",
              link: "/A8_Kuaishou_E2E_Plan",
            },
            {
              text: "PDH Social 多路径本机采集方案 (Mode A/B/C) ⭐NEW",
              link: "/PDH_Social_Multipath_Local_Collection_Plan",
            },
            {
              text: "PDH Bilibili C 路径 (PC ADB) 真机 E2E ⭐NEW",
              link: "/PDH_Bilibili_C_Path_Real_Device_E2E",
            },
            {
              text: "PDH Bilibili Mode B (Android in-APK root) 真机 E2E ⭐NEW",
              link: "/PDH_Bilibili_Mode_B_Real_Device_E2E",
            },
            {
              text: "PDH Weibo DB Schema 探测 ⭐NEW",
              link: "/PDH_Weibo_DB_Schema_Probe",
            },
            {
              text: "PDH Weibo Mode B (Android in-APK root) 真机 E2E ⭐NEW",
              link: "/PDH_Weibo_Mode_B_Real_Device_E2E",
            },
            {
              text: "PDH Weibo C 路径 真机 E2E ⭐NEW",
              link: "/PDH_Weibo_Real_Device_E2E",
            },
            {
              text: "PDH Xiaohongshu C 路径 真机 E2E ⭐NEW",
              link: "/PDH_Xhs_Real_Device_E2E",
            },
            {
              text: "PDH Douyin 真机 E2E ⭐NEW",
              link: "/PDH_Douyin_Real_Device_E2E",
            },
            {
              text: "PDH Toutiao C 路径 真机 E2E ⭐NEW",
              link: "/PDH_Toutiao_C_Path_Real_Device_E2E",
            },
            {
              text: "PDH Kuaishou C 路径 真机 E2E ⭐NEW",
              link: "/PDH_Kuaishou_C_Path_Real_Device_E2E",
            },
            {
              text: "PDH Mode B Toutiao+Douyin 真机 E2E ⭐NEW",
              link: "/PDH_Mode_B_Toutiao_Douyin_Real_Device_E2E",
            },
          ],
        },
        {
          text: "扩展系统设计",
          items: [
            { text: "Hooks扩展系统", link: "/HOOKS_SYSTEM_DESIGN" },
            { text: "浏览器扩展规划", link: "/BROWSER_EXTENSION_PLAN" },
            {
              text: "Minimal Coding Agent 实施计划 ⭐NEW",
              link: "https://docs.chainlesschain.com/chainlesschain/minimal-coding-agent-plan",
            },
            {
              text: "桌面版 UI 重构 (v6 Shell P0–P6) ⭐NEW",
              link: "/desktop-ui-refactor",
            },
            {
              text: "Phase 3d 移动端同步 ⭐",
              link: "/phase3d-mobile-sync",
            },
            {
              text: "Android v1.0 重新定位 (L1+L2+L3) ⭐NEW",
              link: "/android-repositioning",
            },
            {
              text: "Android Remote Operate Plan C (signaling forward) ⭐",
              link: "/Android_Remote_Operate_Plan_C",
            },
            {
              text: "Android Remote Terminal Plan A (PTY 远程操控) ⭐NEW",
              link: "/Android_Remote_Terminal_Plan_A",
            },
            {
              text: "Android AI Chat × cc-exec Tool (Phase 0 MVP)",
              link: "/Android_AI_Chat_CC_Exec_Tool",
            },
            {
              text: "Android AI Chat × cc-exec — Phase 5.8 E2E SOP ⭐NEW",
              link: "/Android_AI_Chat_CC_Exec_Phase_5_8_E2E_SOP",
            },
            {
              text: "Android AI Chat × cc-exec — Phase 5.8 Checklist ⭐NEW",
              link: "/Android_AI_Chat_CC_Exec_Phase_5_8_Checklist",
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
          text: "v5.0.2.49 CLI 项目打包 ⭐NEW",
          collapsed: false,
          items: [
            {
              text: "cc pack 打包指令设计 ⭐NEW",
              link: "/cc-pack-design",
            },
            {
              text: "cc pack --project 项目模式 ⭐NEW",
              link: "/cc-pack-project-mode-design",
            },
          ],
        },
        {
          text: "ClaudeBox 学习方案",
          collapsed: true,
          items: [
            {
              text: "工具卡 + TodoWrite 面板落地方案",
              link: "/claudebox-learning-plan",
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
              text: "94 QualityGate 通用质量门控",
              link: "/modules/m94-quality-gate",
            },
            {
              text: "95 社交协议生态补齐方案 ⭐NEW",
              link: "/modules/m95-social-protocol-parity",
            },
            {
              text: "96 V2 规范层 Governance ⭐NEW",
              link: "/modules/m96-v2-governance",
            },
            {
              text: "97 桌面版 UI · Claude-Desktop 重构 ⭐NEW",
              link: "/modules/m97-claude-desktop-refactor",
            },
            {
              text: "98 IDE 桥接对标方案 ⭐NEW",
              link: "/modules/m98-ide-bridge",
            },
            {
              text: "99 项目记忆与 init 对标方案 ⭐NEW",
              link: "/modules/m99-project-memory-init",
            },
            {
              text: "100 自定义斜杠命令与宏系统 ⭐NEW",
              link: "/modules/m100-slash-commands-macros",
            },
            {
              text: "101 个人数据 IDE 桥接方案 ⭐NEW",
              link: "/modules/m101-personal-data-ide-bridge",
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
