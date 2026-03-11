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
    [
      "script",
      {},
      `;(function(){
  // Use capture phase to run BEFORE VitePress Vue handlers, then stopPropagation
  document.addEventListener('click', function(e){
    var t = e.target;
    if (!t.closest) return;

    // ① Sidebar collapsible group header
    var hdr = t.closest('.VPSidebarItem.collapsible > .item');
    if (hdr && !t.closest('a')) {
      e.stopPropagation();
      e.preventDefault();
      var item = hdr.closest('.VPSidebarItem.collapsible');
      item.classList.toggle('collapsed');
      return;
    }

    // ② Mobile "菜单" button
    var menuBtn = t.closest('.VPLocalNav button.menu, button.VPLocalNavButton');
    if (menuBtn) {
      e.stopPropagation();
      e.preventDefault();
      var sb = document.querySelector('.VPSidebar');
      if (!sb) return;
      var opening = !sb.classList.contains('open');
      sb.classList.toggle('open');
      menuBtn.setAttribute('aria-expanded', String(opening));
      // Toggle backdrop if present
      var backdrop = document.querySelector('.VPBackdrop');
      if (backdrop) {
        if (opening) { backdrop.classList.add('open'); }
        else { backdrop.classList.remove('open'); }
      }
      return;
    }

    // ③ Close sidebar when clicking backdrop
    var backdrop = t.closest('.VPBackdrop');
    if (backdrop && backdrop.classList.contains('open')) {
      var sb2 = document.querySelector('.VPSidebar');
      if (sb2) sb2.classList.remove('open');
      backdrop.classList.remove('open');
      var btn = document.querySelector('.VPLocalNav button.menu, button.VPLocalNavButton');
      if (btn) btn.setAttribute('aria-expanded', 'false');
      return;
    }

    // ④ Back to top
    var topBtn = t.closest('.VPLocalNavOutlineDropdown > button');
    if (topBtn) {
      var dd = topBtn.parentElement;
      setTimeout(function(){
        if (!dd.classList.contains('open')) {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      }, 50);
    }
  }, true);
})();`,
    ],
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
          {
            text: "演化图谱与企业增强 (17-28)",
            link: "/modules/17_EvoMap系统",
          },
          {
            text: "生产加固与AI (29-36)",
            link: "/modules/29_生产强化系统",
          },
          {
            text: "市场与安全生态 (37-42)",
            link: "/modules/37_技能市场系统",
          },
          {
            text: "v5.0.0-v5.0.1 架构重构与生态融合 (43-66)",
            link: "/modules/43_IPC域分割与懒加载系统",
          },
        ],
      },
      {
        text: "基础设施",
        items: [
          { text: "安全机制设计", link: "/安全机制设计" },
          { text: "数据同步方案", link: "/数据同步方案" },
          { text: "AI模型部署", link: "/AI模型部署方案" },
          { text: "Hooks扩展系统", link: "/HOOKS_SYSTEM_DESIGN" },
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
          text: "v1.0.0 — 企业与基础增强 (17-23)",
          collapsed: true,
          items: [
            {
              text: "17 IPFS去中心化存储 ⭐",
              link: "/modules/17_IPFS去中心化存储",
            },
            {
              text: "18 P2P实时协作系统 ⭐",
              link: "/modules/18_P2P实时协作系统",
            },
            {
              text: "19 自治Agent Runner ⭐",
              link: "/modules/19_自治Agent_Runner",
            },
            { text: "20 模型量化系统 ⭐", link: "/modules/20_模型量化系统" },
            { text: "21 i18n国际化 ⭐", link: "/modules/21_i18n国际化" },
            { text: "22 性能自动调优 ⭐", link: "/modules/22_性能自动调优" },
            { text: "23 企业组织管理 ⭐", link: "/modules/23_企业组织管理" },
          ],
        },
        {
          text: "v1.1.0 — 全栈智能化 (24-28)",
          collapsed: true,
          items: [
            {
              text: "24 去中心化Agent网络 ⭐",
              link: "/modules/24_去中心化Agent网络",
            },
            { text: "25 自治运维系统 ⭐", link: "/modules/25_自治运维系统" },
            {
              text: "26 开发流水线编排 ⭐",
              link: "/modules/26_开发流水线编排",
            },
            { text: "27 多模态协作 ⭐", link: "/modules/27_多模态协作" },
            { text: "28 自然语言编程 ⭐", link: "/modules/28_自然语言编程" },
          ],
        },
        {
          text: "Phase 41-45 — 演化图谱与企业增强",
          collapsed: true,
          items: [
            { text: "17 演化图谱系统", link: "/modules/17_EvoMap系统" },
            { text: "18 社交AI系统", link: "/modules/18_社交AI系统" },
            { text: "19 合规分类系统", link: "/modules/19_合规分类系统" },
            {
              text: "20 企业用户配置系统",
              link: "/modules/20_企业用户配置系统",
            },
            { text: "21 统一密钥系统", link: "/modules/21_统一密钥系统" },
          ],
        },
        {
          text: "Phase 48-56 — 安全与社交扩展",
          collapsed: true,
          items: [
            {
              text: "22 内容推荐系统",
              link: "/modules/22_智能内容推荐系统",
            },
            { text: "23 去中心化桥接系统", link: "/modules/23_Nostr桥接系统" },
            { text: "24 数据防泄漏系统", link: "/modules/24_数据防泄漏系统" },
            {
              text: "25 安全信息事件管理系统",
              link: "/modules/25_安全信息事件管理系统",
            },
            { text: "26 社区治理系统", link: "/modules/26_社区治理系统" },
            { text: "27 即时通讯集成系统", link: "/modules/27_Matrix集成系统" },
            {
              text: "28 基础设施编排系统",
              link: "/modules/28_基础设施编排系统",
            },
          ],
        },
        {
          text: "Phase 57-61 — v2.0 生产加固",
          collapsed: true,
          items: [
            {
              text: "29 生产强化",
              link: "/modules/29_生产强化系统",
            },
            {
              text: "30 联邦强化系统",
              link: "/modules/30_联邦强化系统",
            },
            { text: "31 压力测试系统", link: "/modules/31_压力测试系统" },
            {
              text: "32 信誉优化系统",
              link: "/modules/32_信誉优化系统",
            },
            {
              text: "33 跨组织SLA管理系统",
              link: "/modules/33_跨组织SLA管理系统",
            },
          ],
        },
        {
          text: "Phase 62-64 — v3.0 自主AI开发",
          collapsed: true,
          items: [
            { text: "34 技术学习引擎", link: "/modules/34_技术学习引擎系统" },
            {
              text: "35 自主开发者系统",
              link: "/modules/35_自主开发者系统",
            },
            {
              text: "36 协作治理系统",
              link: "/modules/36_协作治理系统",
            },
          ],
        },
        {
          text: "Phase 65-71 — v3.1-v3.2 市场与安全生态",
          collapsed: true,
          items: [
            { text: "37 技能市场系统", link: "/modules/37_技能市场系统" },
            {
              text: "38 去中心化推理网络",
              link: "/modules/38_去中心化推理网络系统",
            },
            { text: "39 信任安全系统", link: "/modules/39_信任安全系统" },
          ],
        },
        {
          text: "Phase 72-77 — v3.3-v3.4 协议融合与演化图谱",
          collapsed: true,
          items: [
            { text: "40 协议融合系统", link: "/modules/40_协议融合系统" },
            {
              text: "41 去中心化基础设施",
              link: "/modules/41_去中心化基础设施系统",
            },
            {
              text: "42 演化图谱高级联邦",
              link: "/modules/42_EvoMap高级联邦系统",
            },
          ],
        },
        {
          text: "v5.0.0 Milestone 1 — 架构重构基座 (43-45)",
          collapsed: true,
          items: [
            {
              text: "43 IPC域分割与懒加载",
              link: "/modules/43_IPC域分割与懒加载系统",
            },
            {
              text: "44 共享资源层与DI容器",
              link: "/modules/44_共享资源层与依赖注入容器",
            },
            {
              text: "45 数据库演进与迁移框架",
              link: "/modules/45_数据库演进与迁移框架",
            },
          ],
        },
        {
          text: "v5.0.0 Milestone 2 — AI Agent 2.0 (46-52)",
          collapsed: true,
          items: [
            { text: "46 A2A协议引擎", link: "/modules/46_A2A协议引擎" },
            {
              text: "47 自主工作流编排器",
              link: "/modules/47_自主工作流编排器",
            },
            { text: "48 层次化记忆2.0", link: "/modules/48_层次化记忆系统2.0" },
            { text: "49 多模态感知层", link: "/modules/49_多模态感知层" },
            { text: "50 Agent经济系统", link: "/modules/50_Agent经济系统" },
            {
              text: "51 代码生成Agent 2.0",
              link: "/modules/51_代码生成Agent2.0",
            },
            {
              text: "52 Agent安全沙箱2.0",
              link: "/modules/52_Agent安全沙箱2.0",
            },
          ],
        },
        {
          text: "v5.0.0 Milestone 3 — Web3深化 (53-57)",
          collapsed: true,
          items: [
            { text: "53 零知识证明引擎", link: "/modules/53_零知识证明引擎" },
            { text: "54 跨链互操作协议", link: "/modules/54_跨链互操作协议" },
            { text: "55 去中心化身份2.0", link: "/modules/55_去中心化身份2.0" },
            { text: "56 隐私计算框架", link: "/modules/56_隐私计算框架" },
            { text: "57 DAO治理2.0", link: "/modules/57_DAO治理2.0" },
          ],
        },
        {
          text: "v5.0.0 Milestone 4 — 企业级平台 (58-62)",
          collapsed: true,
          items: [
            { text: "58 低代码平台", link: "/modules/58_低代码平台" },
            { text: "59 企业知识图谱", link: "/modules/59_企业知识图谱" },
            { text: "60 BI智能分析", link: "/modules/60_BI智能分析" },
            {
              text: "61 工作流自动化引擎",
              link: "/modules/61_工作流自动化引擎",
            },
            { text: "62 多租户SaaS引擎", link: "/modules/62_多租户SaaS引擎" },
          ],
        },
        {
          text: "v5.0.0 Milestone 5 — 生态融合 (63-65)",
          collapsed: true,
          items: [
            { text: "63 统一应用运行时", link: "/modules/63_统一应用运行时" },
            { text: "64 智能插件生态2.0", link: "/modules/64_智能插件生态2.0" },
            { text: "65 自进化AI系统", link: "/modules/65_自进化AI系统" },
          ],
        },
        {
          text: "CLI 分发系统 (66)",
          collapsed: false,
          items: [{ text: "66 CLI分发系统", link: "/modules/66_CLI分发系统" }],
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
