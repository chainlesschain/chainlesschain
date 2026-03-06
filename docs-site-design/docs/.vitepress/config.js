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
  function d2f(fn){ requestAnimationFrame(function(){ requestAnimationFrame(fn); }); }
  document.addEventListener('click', function(e){
    var t = e.target;
    // ① Sidebar collapsible group header
    var hdr = t.closest && t.closest('.VPSidebarItem.collapsible > .item');
    if (hdr && !t.closest('a')) {
      var item = hdr.closest('.VPSidebarItem.collapsible');
      var was = item.classList.contains('collapsed');
      d2f(function(){
        if (item.classList.contains('collapsed') === was) {
          item.classList.toggle('collapsed');
        }
      });
      return;
    }
    // ② Mobile "菜单" button
    var menuBtn = t.closest && t.closest('.VPLocalNav button.menu');
    if (menuBtn) {
      var sb = document.querySelector('.VPSidebar');
      if (!sb) return;
      var wasOpen = sb.classList.contains('open');
      d2f(function(){
        if (sb.classList.contains('open') === wasOpen) {
          sb.classList.toggle('open');
          menuBtn.setAttribute('aria-expanded', String(!wasOpen));
          var curtain = document.querySelector('.VPSidebarButton');
          if (curtain) curtain.setAttribute('aria-expanded', String(!wasOpen));
        }
      });
      return;
    }
    // ③ Back to top / outline dropdown button
    var topBtn = t.closest && t.closest('.VPLocalNavOutlineDropdown > button');
    if (topBtn) {
      var dd = topBtn.parentElement;
      d2f(function(){
        if (!dd.classList.contains('open')) {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      });
    }
  });
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
