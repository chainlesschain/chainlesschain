import { defineConfig } from "vitepress";

export default defineConfig({
  title: "ChainlessChain 文档",
  description: "去中心化个人AI管理系统和U盾/SIMKey厂家管理平台完整文档",
  lang: "zh-CN",
  ignoreDeadLinks: true,

  head: [
    ["meta", { charset: "utf-8" }],
    // Umami self-hosted analytics (data stays on our server; /u/ → 127.0.0.1:3017)
    [
      "script",
      {
        defer: "",
        src: "https://www.chainlesschain.com/u/script.js",
        "data-website-id": "e2103676-c36a-4c78-8094-62bb68be27e3",
        "data-host-url": "https://www.chainlesschain.com/u",
      },
    ],
    [
      "link",
      { rel: "icon", type: "image/png", sizes: "32x32", href: "/logo-32.png" },
    ],
    [
      "link",
      { rel: "icon", type: "image/png", sizes: "64x64", href: "/logo-64.png" },
    ],
    [
      "link",
      {
        rel: "icon",
        type: "image/png",
        sizes: "128x128",
        href: "/logo-128.png",
      },
    ],
    [
      "link",
      { rel: "apple-touch-icon", sizes: "128x128", href: "/logo-128.png" },
    ],
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
          { text: "移动端 Android (v1.0 GA)", link: "/guide/mobile-android" },
          { text: "移动端 iOS (Phase 1+2+3)", link: "/guide/mobile-ios" },
          { text: "社交协议生态", link: "/guide/social-protocols" },
          { text: "合规与威胁情报", link: "/guide/compliance-threat-intel" },
          { text: "默克尔树证书 MTC", link: "/guide/mtc-merkle-tree-certs" },
          { text: "IDE 任务记录与新会话接力", link: "/guide/ide-task-worklog" },
          {
            text: "远程终端 (Android↔桌面 PTY)",
            link: "/guide/remote-terminal",
          },
          {
            text: "远程文件 (Android↔桌面 浏览/上传/下载)",
            link: "/guide/remote-file",
          },
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

    // Group by topic; dated release notes belong in the collapsed history section.
    sidebar: {
      "/guide/": [
        {
          text: "指南",
          items: [
            { text: "简介", link: "/guide/introduction" },
            { text: "快速开始", link: "/guide/getting-started" },
            { text: "桌面版安装指南", link: "/guide/installation" },
            { text: "系统架构", link: "/guide/architecture" },
            { text: "技术栈", link: "/guide/tech-stack" },
          ],
          collapsed: false,
        },
        {
          text: "桌面版 V6 对话壳",
          items: [
            {
              text: "Chat-First Shell (v6 预览 /v2)",
              link: "/guide/desktop-v6-shell",
            },
            {
              text: "桌面版 UI 重构用户指南 (v6.0+)",
              link: "/guide/desktop-ui-refactor-user-guide",
            },
          ],
          collapsed: true,
        },
        {
          text: "IDE 长任务协作",
          items: [
            { text: "任务记录与新会话接力", link: "/guide/ide-task-worklog" },
          ],
          collapsed: true,
        },
        {
          text: "移动端 Android",
          items: [
            {
              text: "Android 用户操作手册（安装 / 首次启动 / 配对 / 日常使用）",
              link: "/guide/mobile-android-usage",
            },
            {
              text: "Android v1.0 GA 用户文档（三层定位 / 扫码配对 / REMOTE / 远程终端 / 同步 / 故障排查）",
              link: "/guide/mobile-android",
            },
            {
              text: "远程终端 Plan A (Android↔桌面 PTY)",
              link: "/guide/remote-terminal",
            },
            {
              text: "远程文件 (Android↔桌面 浏览/上传/下载)",
              link: "/guide/remote-file",
            },
          ],
          collapsed: true,
        },
        {
          text: "移动端 iOS",
          items: [
            {
              text: "iOS 用户操作手册（安装 / 首次启动 / 配对 / 日常使用）",
              link: "/guide/mobile-ios-usage",
            },
            {
              text: "iOS Phase 1+2+3 用户文档（桌面配对 + 远程终端 + 远程操控 framework + 4 skill）",
              link: "/guide/mobile-ios",
            },
          ],
          collapsed: true,
        },
        {
          text: "专题指南",
          items: [
            {
              text: "社交协议生态 (Nostr/Matrix/ActivityPub)",
              link: "/guide/social-protocols",
            },
            {
              text: "合规与威胁情报 (STIX 2.1/UEBA/SOC2)",
              link: "/guide/compliance-threat-intel",
            },
            {
              text: "默克尔树证书 MTC (后量子安全)",
              link: "/guide/mtc-merkle-tree-certs",
            },
          ],
          collapsed: true,
        },
      ],
      "/chainlesschain/": [
        {
          text: "开始使用",
          collapsed: false,
          items: [
            { text: "系统概述", link: "/chainlesschain/overview" },
            { text: "安装部署", link: "/chainlesschain/installation" },
            { text: "配置说明", link: "/chainlesschain/configuration" },
            { text: "CLI命令行工具", link: "/chainlesschain/cli" },
            {
              text: "CLI 当前发布、升级与证据边界",
              link: "/chainlesschain/agent-platform-release",
            },
          ],
        },
        {
          text: "CLI 与 IDE",
          collapsed: true,
          items: [
            {
              text: "安装、配置与诊断",
              collapsed: true,
              items: [
                { text: "安装向导 (setup)", link: "/chainlesschain/cli-setup" },
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
                  text: "CLI分发系统",
                  link: "/chainlesschain/cli-distribution",
                },
                { text: "启动应用 (start)", link: "/chainlesschain/cli-start" },
                { text: "停止应用 (stop)", link: "/chainlesschain/cli-stop" },
                {
                  text: "系统状态 (status)",
                  link: "/chainlesschain/cli-status",
                },
                {
                  text: "Docker服务 (services)",
                  link: "/chainlesschain/cli-services",
                },
              ],
            },
            {
              text: "Agent 与编程",
              collapsed: true,
              items: [
                {
                  text: "Agent 模式命令大全",
                  link: "/chainlesschain/cli-agent-mode",
                },
                {
                  text: "代理模式 (agent) — 详细参考",
                  link: "/chainlesschain/cli-agent",
                },
                {
                  text: "语义代码智能 — LSP (code-intel)",
                  link: "/chainlesschain/cli-code-intel",
                },
                {
                  text: "行内代码补全 — FIM Ghost-Text (complete)",
                  link: "/chainlesschain/cli-complete",
                },
                {
                  text: "Persona管理 (persona)",
                  link: "/chainlesschain/cli-persona",
                },
                { text: "项目初始化 (init)", link: "/chainlesschain/cli-init" },
                {
                  text: "动态 Worktree 批处理 (batch)",
                  link: "/chainlesschain/cli-batch",
                },
              ],
            },
            {
              text: "会话、上下文与成本",
              collapsed: true,
              items: [
                {
                  text: "Agent 输入、图片预算与会话恢复",
                  link: "/chainlesschain/agent-input-and-recovery",
                },
                {
                  text: "会话管理 (session)",
                  link: "/chainlesschain/cli-session",
                },
                { text: "会话管理器", link: "/chainlesschain/session-manager" },
                {
                  text: "会话压缩 (compact)",
                  link: "/chainlesschain/cli-compact",
                },
                {
                  text: "上下文窗口分解 (context)",
                  link: "/chainlesschain/cli-context",
                },
                {
                  text: "会话洞察 — 轮次/工具/成本 (insights)",
                  link: "/chainlesschain/cli-insights",
                },
                {
                  text: "Token追踪 (tokens)",
                  link: "/chainlesschain/cli-tokens",
                },
                {
                  text: "压缩遥测治理 (compt)",
                  link: "/chainlesschain/cli-compt",
                },
                { text: "成本估算 (cc cost)", link: "/chainlesschain/cost" },
                {
                  text: "流式输出 (stream)",
                  link: "/chainlesschain/cli-stream",
                },
                {
                  text: "Agent 弹性提示 (流式停顿 + 弃用模型)",
                  link: "/chainlesschain/cli-resilience",
                },
              ],
            },
            {
              text: "IDE 插件与任务接力",
              collapsed: true,
              items: [
                {
                  text: "IDE 插件使用指南 (VS Code / JetBrains)",
                  link: "/chainlesschain/ide-plugin",
                },
                {
                  text: "IDE 桥接 (VS Code / JetBrains)",
                  link: "/chainlesschain/ide-bridge",
                },
                {
                  text: "IDE 计划审阅与会话索引",
                  link: "/chainlesschain/ide-plan-review",
                },
                {
                  text: "IDE 任务记录与新会话接力",
                  link: "/chainlesschain/ide-task-worklog",
                },
              ],
            },
            {
              text: "项目与交付",
              collapsed: true,
              items: [
                {
                  text: "项目管理 (project)",
                  link: "/chainlesschain/cli-project",
                },
                { text: "项目打包 (pack)", link: "/chainlesschain/cli-pack" },
                {
                  text: "项目模式打包 (pack --project)",
                  link: "/chainlesschain/cli-pack-project",
                },
                {
                  text: "Artifacts 交付物 (artifacts / publish_artifact)",
                  link: "/chainlesschain/cli-artifacts",
                },
                { text: "Git集成 (git)", link: "/chainlesschain/cli-git" },
              ],
            },
            {
              text: "命令与界面",
              collapsed: true,
              items: [
                {
                  text: "自定义斜杠命令 (cc command)",
                  link: "/chainlesschain/slash-commands",
                },
                { text: "输出风格", link: "/chainlesschain/output-styles" },
                {
                  text: "状态栏 (cc statusline)",
                  link: "/chainlesschain/status-line",
                },
                { text: "Web 管理界面 (ui)", link: "/chainlesschain/cli-ui" },
                {
                  text: "Web 管理面板 (ui)",
                  link: "/chainlesschain/cli-web-panel",
                },
              ],
            },
            {
              text: "后台任务与远程执行",
              collapsed: true,
              items: [
                {
                  text: "长任务调度 — Monitor/Cron/Push (agenda)",
                  link: "/chainlesschain/cli-agenda",
                },
                {
                  text: "命名定时/触发任务 — Cron/Once/Webhook/GitHub (routine)",
                  link: "/chainlesschain/cli-routine",
                },
                {
                  text: "后台 Agent — daemon/attach/logs (background)",
                  link: "/chainlesschain/cli-background-agents",
                },
                { text: "循环执行 (loop)", link: "/chainlesschain/cli-loop" },
                {
                  text: "后台 Shell (run_shell/check_shell)",
                  link: "/chainlesschain/run-shell-background",
                },
                {
                  text: "远程控制 + 移动/Web 审批 (remote-control)",
                  link: "/chainlesschain/cli-remote-control",
                },
                {
                  text: "自托管云端接管 — Bundle→Run→Reflow (cloud)",
                  link: "/chainlesschain/cli-cloud",
                },
                {
                  text: "WebSocket服务器 (serve)",
                  link: "/chainlesschain/cli-serve",
                },
              ],
            },
          ],
        },
        {
          text: "AI 与 Agent 平台",
          collapsed: true,
          items: [
            {
              text: "模型、对话与推理",
              collapsed: true,
              items: [
                { text: "AI模型配置", link: "/chainlesschain/ai-models" },
                { text: "模型量化", link: "/chainlesschain/quantization" },
                { text: "AI对话 (chat)", link: "/chainlesschain/cli-chat" },
                { text: "单次问答 (ask)", link: "/chainlesschain/cli-ask" },
                { text: "LLM管理 (llm)", link: "/chainlesschain/cli-llm" },
                {
                  text: "LLM中转站与自定义接入",
                  link: "/chainlesschain/cli-llm-proxy",
                },
                {
                  text: "模型量化 (quantize)",
                  link: "/chainlesschain/cli-quantize",
                },
                { text: "推理网络", link: "/chainlesschain/inference-network" },
                {
                  text: "去中心化推理 (inference)",
                  link: "/chainlesschain/cli-inference",
                },
              ],
            },
            {
              text: "运行时、协议与 SDK",
              collapsed: true,
              items: [
                {
                  text: "当前 CLI Runtime 实现 (推荐 / npm 0.166.24)",
                  link: "/chainlesschain/cli-runtime-current",
                },
                {
                  text: "Agent SDK — TypeScript + Python",
                  link: "/chainlesschain/agent-sdk",
                },
                {
                  text: "Agent Protocol — Schema 与多语言生成",
                  link: "/chainlesschain/agent-protocol",
                },
                {
                  text: "CC App Server 使用指南",
                  link: "/chainlesschain/cli-app-server",
                },
                {
                  text: "Agent Kernel 使用与运维",
                  link: "/chainlesschain/cli-agent-kernel",
                },
                {
                  text: "Graph Kernel 使用与运维",
                  link: "/chainlesschain/cli-graph-kernel",
                },
                {
                  text: "GraphRun 观测与评估",
                  link: "/chainlesschain/cli-team-graph",
                },
                {
                  text: "Agent 架构优化系统",
                  link: "/chainlesschain/agent-optimization",
                },
                {
                  text: "Session-Core 会话运行时",
                  link: "/chainlesschain/session-core",
                },
                {
                  text: "Agent Bundle 打包部署",
                  link: "/chainlesschain/agent-bundles",
                },
              ],
            },
            {
              text: "编程与工作流",
              collapsed: true,
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
                  text: "代码生成Agent 2.0",
                  link: "/chainlesschain/code-agent-v2",
                },
                { text: "自治Agent", link: "/chainlesschain/autonomous-agent" },
                {
                  text: "自主开发者",
                  link: "/chainlesschain/autonomous-developer",
                },
                { text: "自主开发者 (dev)", link: "/chainlesschain/cli-dev" },
                {
                  text: "代码生成 Agent (codegen)",
                  link: "/chainlesschain/cli-codegen",
                },
                {
                  text: "自然语言编程",
                  link: "/chainlesschain/nl-programming",
                },
                {
                  text: "自然语言编程 (nlprog)",
                  link: "/chainlesschain/cli-nlprog",
                },
              ],
            },
            {
              text: "技能与自进化",
              collapsed: true,
              items: [
                { text: "技能系统", link: "/chainlesschain/skills" },
                { text: "技能系统 (skill)", link: "/chainlesschain/cli-skill" },
                {
                  text: "CLI 指令技能包",
                  link: "/chainlesschain/cli-skill-packs",
                },
                {
                  text: "Skill Creator 使用指南",
                  link: "/chainlesschain/skill-creator",
                },
                {
                  text: "28个新增实用技能(v1.2.0~v1.2.1)",
                  link: "/chainlesschain/new-skills-v1.2",
                },
                {
                  text: "受治理的 Skill 自进化",
                  link: "/chainlesschain/governed-skill-evolution",
                },
                {
                  text: "Record & Replay → Skill",
                  link: "/chainlesschain/record-replay-skill",
                },
                {
                  text: "Jev Skill 决策层试点",
                  link: "/chainlesschain/jev-decision-layer",
                },
                {
                  text: "自进化AI系统",
                  link: "/chainlesschain/self-evolving-ai",
                },
                {
                  text: "自进化系统 (evolution)",
                  link: "/chainlesschain/cli-evolution",
                },
                {
                  text: "CLI 与 IDE 自进化开关配置",
                  link: "/chainlesschain/self-evolution-configuration",
                },
              ],
            },
            {
              text: "自主学习",
              collapsed: true,
              items: [
                {
                  text: "自主学习闭环系统",
                  link: "/chainlesschain/autonomous-learning-loop",
                },
                { text: "自主技术学习", link: "/chainlesschain/tech-learning" },
                {
                  text: "技术学习引擎 (tech)",
                  link: "/chainlesschain/cli-tech",
                },
                {
                  text: "自主学习系统 (learning)",
                  link: "/chainlesschain/cli-learning",
                },
                {
                  text: "学习偏好 (instinct)",
                  link: "/chainlesschain/cli-instinct",
                },
                {
                  text: "智能推荐 (recommend)",
                  link: "/chainlesschain/cli-recommend",
                },
              ],
            },
            {
              text: "多模态与内容创作",
              collapsed: true,
              items: [
                {
                  text: "AI 音视频创作模板",
                  link: "/chainlesschain/ai-media-creator",
                },
                {
                  text: "AI 视频生成 (Volcengine Seedance)",
                  link: "/chainlesschain/ai-video-generation",
                },
                {
                  text: "AI 文档创作模板",
                  link: "/chainlesschain/ai-doc-creator",
                },
                {
                  text: "视频剪辑 Agent (CutClaw)",
                  link: "/chainlesschain/video-editing",
                },
                {
                  text: "视频剪辑 Agent (video)",
                  link: "/chainlesschain/cli-video",
                },
                { text: "多模态协作", link: "/chainlesschain/multimodal" },
                {
                  text: "多模态感知层",
                  link: "/chainlesschain/multimodal-perception",
                },
                {
                  text: "多模态感知 (perception)",
                  link: "/chainlesschain/cli-perception",
                },
                { text: "多模态协作 (mm)", link: "/chainlesschain/cli-mm" },
              ],
            },
            {
              text: "评测与质量",
              collapsed: true,
              items: [
                {
                  text: "可靠性评测 + 趋势门 (eval)",
                  link: "/chainlesschain/cli-eval",
                },
                {
                  text: "QualityGate 通用质量门控",
                  link: "/chainlesschain/quality-gate",
                },
                {
                  text: "PM 效果评测与证据核验",
                  link: "/chainlesschain/pm-effect-evaluation",
                },
              ],
            },
            {
              text: "架构与实施计划",
              collapsed: true,
              items: [
                {
                  text: "Minimal Coding Agent 实施计划",
                  link: "/chainlesschain/minimal-coding-agent-plan",
                },
                {
                  text: "CLI Agent Runtime 重构计划",
                  link: "/chainlesschain/cli-agent-runtime-plan",
                },
                {
                  text: "CLI Runtime 收口路线图",
                  link: "/chainlesschain/cli-runtime-convergence-roadmap",
                },
                {
                  text: "Coding Agent 工具描述统一",
                  link: "/chainlesschain/coding-agent-tool-descriptor-unification-plan",
                },
                {
                  text: "Hermes Agent 对标实施 (6 Phase)",
                  link: "/chainlesschain/hermes-agent-parity",
                },
                {
                  text: "Managed Agents 对标与 CLI 接入",
                  link: "/chainlesschain/managed-agents-parity",
                },
                {
                  text: "Managed Agents 对标 (memory/session/beta)",
                  link: "/chainlesschain/managed-agents-cli",
                },
              ],
            },
          ],
        },
        {
          text: "知识与个人数据",
          collapsed: true,
          items: [
            {
              text: "知识库与记忆",
              collapsed: true,
              items: [
                { text: "知识库管理", link: "/chainlesschain/knowledge-base" },
                {
                  text: "个人 AI 知识库",
                  link: "/chainlesschain/personal-ai-knowledge-base",
                },
                {
                  text: "上下文与记忆（模块 108）",
                  link: "/chainlesschain/context-memory",
                },
                {
                  text: "上下文工程",
                  link: "/chainlesschain/context-engineering",
                },
                {
                  text: "永久记忆系统",
                  link: "/chainlesschain/permanent-memory",
                },
                {
                  text: "层次化记忆2.0",
                  link: "/chainlesschain/hierarchical-memory",
                },
                {
                  text: "持久记忆 (memory)",
                  link: "/chainlesschain/cli-memory",
                },
                {
                  text: "层次化记忆 (hmemory)",
                  link: "/chainlesschain/cli-hmemory",
                },
              ],
            },
            {
              text: "个人数据与检索",
              collapsed: true,
              items: [
                {
                  text: "个人数据中台",
                  link: "/chainlesschain/personal-data-hub",
                },
                {
                  text: "PDH Bridge 个人数据 IDE 桥接",
                  link: "/chainlesschain/pdh-bridge",
                },
                {
                  text: "数据投影恢复与项目任务操作",
                  link: "/chainlesschain/data-actions-current",
                },
                {
                  text: "混合搜索 (search)",
                  link: "/chainlesschain/cli-search",
                },
                {
                  text: "联网搜索 (web_search)",
                  link: "/chainlesschain/web-search",
                },
                {
                  text: "多引擎搜索 (multi-search-engine)",
                  link: "/chainlesschain/multi-search-engine",
                },
              ],
            },
            {
              text: "导入、导出与同步",
              collapsed: true,
              items: [
                { text: "笔记管理 (note)", link: "/chainlesschain/cli-note" },
                { text: "数据库管理 (db)", link: "/chainlesschain/cli-db" },
                {
                  text: "内容导入 (import)",
                  link: "/chainlesschain/cli-import",
                },
                {
                  text: "内容导出 (export)",
                  link: "/chainlesschain/cli-export",
                },
                { text: "Git同步", link: "/chainlesschain/git-sync" },
                { text: "文件同步 (sync)", link: "/chainlesschain/cli-sync" },
                {
                  text: "同步提供方 (sync-providers)",
                  link: "/chainlesschain/cli-sync-providers",
                },
              ],
            },
            {
              text: "存储与基础设施",
              collapsed: true,
              items: [
                {
                  text: "IPFS去中心化存储",
                  link: "/chainlesschain/ipfs-storage",
                },
                {
                  text: "去中心化存储",
                  link: "/chainlesschain/decentralized-storage",
                },
                { text: "IPFS存储 (ipfs)", link: "/chainlesschain/cli-ipfs" },
                {
                  text: "数据库演进框架",
                  link: "/chainlesschain/database-evolution",
                },
                {
                  text: "数据库演进 (dbevo)",
                  link: "/chainlesschain/cli-dbevo",
                },
                {
                  text: "统一应用运行时",
                  link: "/chainlesschain/universal-runtime",
                },
                {
                  text: "统一运行时 (runtime)",
                  link: "/chainlesschain/cli-runtime",
                },
              ],
            },
          ],
        },
        {
          text: "团队协作与企业",
          collapsed: true,
          items: [
            {
              text: "项目目标与团队",
              collapsed: true,
              items: [
                {
                  text: "组织项目、共享目标与多级审批",
                  link: "/chainlesschain/organization-project-current",
                },
                {
                  text: "项目目标、巡检与独立验收（主线）",
                  link: "/chainlesschain/project-goals-current",
                },
                {
                  text: "目标草稿互通与桌面授权",
                  link: "/chainlesschain/goal-drafts-current",
                },
                {
                  text: "RRSI 当前实现与证据边界（主线）",
                  link: "/chainlesschain/rrsi-current",
                },
                { text: "目标 / OKR (cc goal)", link: "/chainlesschain/goal" },
                { text: "团队管理", link: "/chainlesschain/team-manager" },
                {
                  text: "Agent Team — 任务图团队编排 (team)",
                  link: "/chainlesschain/cli-team",
                },
                {
                  text: "多智能体协作 (cowork)",
                  link: "/chainlesschain/cli-cowork",
                },
              ],
            },
            {
              text: "协作与工作流",
              collapsed: true,
              items: [
                {
                  text: "多智能体协作 (cowork)",
                  link: "/chainlesschain/cowork",
                },
                {
                  text: "日常任务协作 (Web Cowork)",
                  link: "/chainlesschain/web-cowork",
                },
                {
                  text: "动态工作流引擎",
                  link: "/chainlesschain/cowork-workflow",
                },
                {
                  text: "协作高级功能",
                  link: "/chainlesschain/cowork-advanced",
                },
                { text: "协作路线图", link: "/chainlesschain/cowork-roadmap" },
                {
                  text: "自主工作流编排",
                  link: "/chainlesschain/workflow-engine",
                },
                {
                  text: "工作流自动化",
                  link: "/chainlesschain/workflow-automation",
                },
                {
                  text: "工作流引擎 (workflow)",
                  link: "/chainlesschain/cli-workflow",
                },
                {
                  text: "工作流自动化 (automation)",
                  link: "/chainlesschain/cli-automation",
                },
                {
                  text: "实时协作(CRDT/Yjs)",
                  link: "/chainlesschain/realtime-collab",
                },
                {
                  text: "协作治理 (collab)",
                  link: "/chainlesschain/cli-collab",
                },
                {
                  text: "协作治理框架",
                  link: "/chainlesschain/collaboration-governance",
                },
              ],
            },
            {
              text: "组织与业务平台",
              collapsed: true,
              items: [
                {
                  text: "企业组织管理",
                  link: "/chainlesschain/enterprise-org",
                },
                { text: "组织管理 (org)", link: "/chainlesschain/cli-org" },
                {
                  text: "多租户SaaS引擎",
                  link: "/chainlesschain/multi-tenant-saas",
                },
                {
                  text: "多租户 SaaS (tenant)",
                  link: "/chainlesschain/cli-tenant",
                },
                {
                  text: "低代码平台",
                  link: "/chainlesschain/low-code-platform",
                },
                {
                  text: "低代码平台 (lowcode)",
                  link: "/chainlesschain/cli-lowcode",
                },
                {
                  text: "企业知识图谱",
                  link: "/chainlesschain/enterprise-knowledge-graph",
                },
                { text: "知识图谱 (kg)", link: "/chainlesschain/cli-kg" },
                { text: "BI智能分析", link: "/chainlesschain/bi-engine" },
                { text: "商业智能 (bi)", link: "/chainlesschain/cli-bi" },
              ],
            },
            {
              text: "企业身份与审计",
              collapsed: true,
              items: [
                { text: "权限系统", link: "/chainlesschain/permissions" },
                { text: "审计日志", link: "/chainlesschain/audit" },
                { text: "RBAC权限 (auth)", link: "/chainlesschain/cli-auth" },
                { text: "审计日志 (audit)", link: "/chainlesschain/cli-audit" },
                { text: "SSO 企业认证 (sso)", link: "/chainlesschain/cli-sso" },
                { text: "SCIM 2.0 用户配置", link: "/chainlesschain/scim" },
                {
                  text: "SCIM用户配置 (scim)",
                  link: "/chainlesschain/cli-scim",
                },
              ],
            },
          ],
        },
        {
          text: "桌面、移动与自动化",
          collapsed: true,
          items: [
            {
              text: "移动端与家庭",
              collapsed: true,
              items: [
                {
                  text: "移动端定位与三层架构",
                  link: "/chainlesschain/mobile-positioning",
                },
                { text: "移动端同步", link: "/chainlesschain/mobile-sync" },
                {
                  text: "Android 本地终端（内置 cc CLI）",
                  link: "/chainlesschain/android-local-terminal",
                },
                {
                  text: "家庭守护 / AI 陪学",
                  link: "/chainlesschain/family-guard",
                },
                {
                  text: "移动推送 (notification)",
                  link: "/chainlesschain/cli-notification",
                },
              ],
            },
            {
              text: "浏览器与远程控制",
              collapsed: true,
              items: [
                {
                  text: "浏览器插件",
                  link: "/chainlesschain/browser-extension",
                },
                {
                  text: "浏览器自动化",
                  link: "/chainlesschain/browser-automation",
                },
                { text: "计算机操控", link: "/chainlesschain/computer-use" },
                { text: "远程控制", link: "/chainlesschain/remote-control" },
                {
                  text: "浏览器自动化 (browse)",
                  link: "/chainlesschain/cli-browse",
                },
              ],
            },
            {
              text: "流水线与运维",
              collapsed: true,
              items: [
                { text: "流水线编排", link: "/chainlesschain/pipeline" },
                {
                  text: "开发流水线编排",
                  link: "/chainlesschain/dev-pipeline",
                },
                {
                  text: "开发流水线 (pipeline)",
                  link: "/chainlesschain/cli-pipeline",
                },
                { text: "自主运维", link: "/chainlesschain/autonomous-ops" },
                { text: "智能运维 (ops)", link: "/chainlesschain/cli-ops" },
                {
                  text: "Terraform 提供者",
                  link: "/chainlesschain/terraform-provider",
                },
                {
                  text: "基础设施编排 (terraform)",
                  link: "/chainlesschain/cli-terraform",
                },
              ],
            },
            {
              text: "插件、Hooks 与集成",
              collapsed: true,
              items: [
                { text: "钩子系统", link: "/chainlesschain/hooks" },
                { text: "Hook系统 (hook)", link: "/chainlesschain/cli-hook" },
                {
                  text: "插件市场 (plugin)",
                  link: "/chainlesschain/cli-plugin",
                },
                {
                  text: "智能插件生态2.0",
                  link: "/chainlesschain/plugin-ecosystem-v2",
                },
                {
                  text: "插件生态 2.0 (ecosystem)",
                  link: "/chainlesschain/cli-ecosystem",
                },
                { text: "MCP服务器 (mcp)", link: "/chainlesschain/cli-mcp" },
                {
                  text: "MCP Tool Search (tool-search)",
                  link: "/chainlesschain/cli-tool-search",
                },
                {
                  text: "远程 MCP 授权 (cc mcp OAuth)",
                  link: "/chainlesschain/mcp-oauth",
                },
                {
                  text: "CLI-Anything集成 (cli-anything)",
                  link: "/chainlesschain/cli-cli-anything",
                },
              ],
            },
          ],
        },
        {
          text: "安全、权限与隐私",
          collapsed: true,
          items: [
            {
              text: "Agent 授权与隔离",
              collapsed: true,
              items: [
                { text: "计划模式", link: "/chainlesschain/plan-mode" },
                {
                  text: "检查点 / 回滚 (cc checkpoint)",
                  link: "/chainlesschain/checkpoint",
                },
                {
                  text: "自动权限模式检视 (auto-mode)",
                  link: "/chainlesschain/cli-auto-mode",
                },
                {
                  text: "权限规则 (permissions)",
                  link: "/chainlesschain/cli-permissions",
                },
                {
                  text: "权限治理 V2 (perm)",
                  link: "/chainlesschain/cli-perm",
                },
                {
                  text: "V2 治理命令族（开发者参考）",
                  link: "/chainlesschain/cli-v2-governance",
                },
                {
                  text: "Agent安全沙箱2.0",
                  link: "/chainlesschain/agent-sandbox-v2",
                },
                {
                  text: "安全沙箱 (sandbox)",
                  link: "/chainlesschain/cli-sandbox",
                },
                {
                  text: "子代理隔离系统",
                  link: "/chainlesschain/sub-agent-isolation",
                },
                {
                  text: "Desktop Graph 调试与 Skill 安全",
                  link: "/chainlesschain/desktop-graph-skill-security",
                },
                {
                  text: "Desktop 模型治理与失败闭合",
                  link: "/chainlesschain/desktop-model-governance",
                },
              ],
            },
            {
              text: "硬件与密钥",
              collapsed: true,
              items: [
                { text: "U盾集成", link: "/chainlesschain/ukey" },
                { text: "SIMKey集成", link: "/chainlesschain/simkey" },
                {
                  text: "SIMKey高级安全",
                  link: "/chainlesschain/simkey-advanced",
                },
                {
                  text: "SIMKey企业版",
                  link: "/chainlesschain/simkey-enterprise",
                },
                {
                  text: "统一密钥 + FIDO2",
                  link: "/chainlesschain/unified-key",
                },
                {
                  text: "门限签名 + 生物特征",
                  link: "/chainlesschain/threshold-security",
                },
                { text: "蓝牙U-Key", link: "/chainlesschain/ble-ukey" },
                { text: "U盾固件 OTA", link: "/chainlesschain/firmware-ota" },
                { text: "三位一体信任根", link: "/chainlesschain/trust-root" },
                { text: "HSM硬件适配器", link: "/chainlesschain/hsm-adapter" },
              ],
            },
            {
              text: "加密、身份与隐私",
              collapsed: true,
              items: [
                { text: "数据加密", link: "/chainlesschain/encryption" },
                {
                  text: "文件加密 (encrypt)",
                  link: "/chainlesschain/cli-encrypt",
                },
                {
                  text: "后量子密码迁移",
                  link: "/chainlesschain/pqc-migration",
                },
                {
                  text: "后量子全面迁移",
                  link: "/chainlesschain/pqc-ecosystem",
                },
                { text: "后量子密码 (pqc)", link: "/chainlesschain/cli-pqc" },
                { text: "去中心化身份2.0", link: "/chainlesschain/did-v2" },
                { text: "DID身份管理 (did)", link: "/chainlesschain/cli-did" },
                {
                  text: "去中心化身份 2.0 (did-v2)",
                  link: "/chainlesschain/cli-did-v2",
                },
                { text: "零知识证明引擎", link: "/chainlesschain/zkp-engine" },
                { text: "零知识证明 (zkp)", link: "/chainlesschain/cli-zkp" },
                {
                  text: "隐私计算框架",
                  link: "/chainlesschain/privacy-computing",
                },
                {
                  text: "隐私计算 (privacy)",
                  link: "/chainlesschain/cli-privacy",
                },
              ],
            },
            {
              text: "合规与信任",
              collapsed: true,
              items: [
                { text: "合规与数据分类", link: "/chainlesschain/compliance" },
                {
                  text: "合规管理 (compliance)",
                  link: "/chainlesschain/cli-compliance",
                },
                { text: "数据防泄漏 (DLP)", link: "/chainlesschain/dlp" },
                { text: "数据防泄漏 (dlp)", link: "/chainlesschain/cli-dlp" },
                { text: "SIEM 集成", link: "/chainlesschain/siem" },
                { text: "SIEM集成 (siem)", link: "/chainlesschain/cli-siem" },
                { text: "默克尔树证书 MTC", link: "/chainlesschain/mtc" },
                {
                  text: "信任与安全 (trust)",
                  link: "/chainlesschain/cli-trust",
                },
                {
                  text: "M-of-N 多签 (multisig)",
                  link: "/chainlesschain/cli-multisig",
                },
              ],
            },
          ],
        },
        {
          text: "社交、Web3 与网络",
          collapsed: true,
          items: [
            {
              text: "社交与通信",
              collapsed: true,
              items: [
                { text: "去中心化社交", link: "/chainlesschain/social" },
                {
                  text: "好友 P2P 加密消息",
                  link: "/chainlesschain/friend-p2p-messaging",
                },
                {
                  text: "好友 P2P 语音/视频通话",
                  link: "/chainlesschain/friend-p2p-calls",
                },
                {
                  text: "社交AI + ActivityPub",
                  link: "/chainlesschain/social-ai",
                },
                {
                  text: "AI社交增强",
                  link: "/chainlesschain/ai-social-enhancement",
                },
                {
                  text: "内容推荐",
                  link: "/chainlesschain/content-recommendation",
                },
                {
                  text: "社交平台 (social)",
                  link: "/chainlesschain/cli-social",
                },
                { text: "P2P消息 (p2p)", link: "/chainlesschain/cli-p2p" },
                {
                  text: "社交图谱分析治理 (sganal)",
                  link: "/chainlesschain/cli-sganal",
                },
              ],
            },
            {
              text: "协议与桥接",
              collapsed: true,
              items: [
                { text: "Nostr桥接", link: "/chainlesschain/nostr-bridge" },
                { text: "Matrix集成", link: "/chainlesschain/matrix-bridge" },
                {
                  text: "协议融合桥接",
                  link: "/chainlesschain/protocol-fusion",
                },
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
                  text: "协议融合 (fusion)",
                  link: "/chainlesschain/cli-fusion",
                },
                { text: "抗审查网络", link: "/chainlesschain/anti-censorship" },
                { text: "卫星通信", link: "/chainlesschain/satellite-comm" },
              ],
            },
            {
              text: "Agent 网络与联邦",
              collapsed: true,
              items: [
                { text: "Agent网络", link: "/chainlesschain/agent-network" },
                {
                  text: "代理联邦网络",
                  link: "/chainlesschain/agent-federation",
                },
                { text: "A2A协议引擎", link: "/chainlesschain/a2a-protocol" },
                {
                  text: "Agent 网络 (agent-network)",
                  link: "/chainlesschain/cli-agent-network",
                },
                { text: "A2A协议 (a2a)", link: "/chainlesschain/cli-a2a" },
                {
                  text: "联邦硬化 (federation)",
                  link: "/chainlesschain/cli-federation",
                },
                {
                  text: "去中心化基础设施 (infra)",
                  link: "/chainlesschain/cli-infra",
                },
              ],
            },
            {
              text: "交易、治理与市场",
              collapsed: true,
              items: [
                { text: "交易辅助", link: "/chainlesschain/trading" },
                {
                  text: "数字钱包 (wallet)",
                  link: "/chainlesschain/cli-wallet",
                },
                { text: "AI 社区治理", link: "/chainlesschain/governance" },
                {
                  text: "社区治理 (governance)",
                  link: "/chainlesschain/cli-governance",
                },
                {
                  text: "DAO治理2.0",
                  link: "/chainlesschain/dao-governance-v2",
                },
                { text: "DAO治理v2 (dao)", link: "/chainlesschain/cli-dao" },
                {
                  text: "跨链互操作协议",
                  link: "/chainlesschain/cross-chain-bridge",
                },
                {
                  text: "跨链互操作 (crosschain)",
                  link: "/chainlesschain/cli-crosschain",
                },
                { text: "技能市场", link: "/chainlesschain/skill-marketplace" },
                {
                  text: "技能市场 (marketplace)",
                  link: "/chainlesschain/cli-marketplace",
                },
                { text: "通证激励", link: "/chainlesschain/token-incentive" },
                {
                  text: "代币激励 (incentive)",
                  link: "/chainlesschain/cli-incentive",
                },
                {
                  text: "Agent经济系统",
                  link: "/chainlesschain/agent-economy",
                },
                {
                  text: "Agent经济 (economy)",
                  link: "/chainlesschain/cli-economy",
                },
              ],
            },
            {
              text: "EvoMap 生态",
              collapsed: true,
              items: [
                { text: "EvoMap GEP协议", link: "/chainlesschain/evomap" },
                {
                  text: "EvoMap全球联邦",
                  link: "/chainlesschain/evomap-federation",
                },
                {
                  text: "EvoMap治理DAO",
                  link: "/chainlesschain/evomap-governance",
                },
                {
                  text: "EvoMap 演化地图 (evomap)",
                  link: "/chainlesschain/cli-evomap",
                },
              ],
            },
          ],
        },
        {
          text: "系统管理与运维",
          collapsed: true,
          items: [
            {
              text: "可靠性与性能",
              collapsed: true,
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
                {
                  text: "性能自动调优",
                  link: "/chainlesschain/performance-tuning",
                },
                {
                  text: "安全加固 (hardening)",
                  link: "/chainlesschain/cli-hardening",
                },
                {
                  text: "压力测试 (stress)",
                  link: "/chainlesschain/cli-stress",
                },
                { text: "SLA 管理 (sla)", link: "/chainlesschain/cli-sla" },
                {
                  text: "信誉优化 (reputation)",
                  link: "/chainlesschain/cli-reputation",
                },
                { text: "性能调优 (perf)", link: "/chainlesschain/cli-perf" },
              ],
            },
            {
              text: "系统架构与配置",
              collapsed: true,
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
                  text: "原生模块保护",
                  link: "/chainlesschain/native-module-guard",
                },
                { text: "i18n国际化", link: "/chainlesschain/i18n" },
                {
                  text: "AI 编排层 (orchestrate)",
                  link: "/chainlesschain/cli-orchestrate",
                },
              ],
            },
          ],
        },
        {
          text: "版本记录与产品规划",
          collapsed: true,
          items: [
            {
              text: "CLI / IDE 升级记录",
              collapsed: true,
              items: [
                {
                  text: "CLI .132 / IDE .170 与 .187 升级",
                  link: "/chainlesschain/cli-ide-update-2026-10-30-132",
                },
                {
                  text: "CLI .131 / IDE .169 与 .186 升级",
                  link: "/chainlesschain/cli-ide-update-2026-10-29-131",
                },
                {
                  text: "CLI .130 / IDE .168 与 .185 升级（历史）",
                  link: "/chainlesschain/cli-ide-update-2026-10-29-130",
                },
                {
                  text: "CLI .129 / IDE .167 与 .184 升级（历史）",
                  link: "/chainlesschain/cli-ide-update-2026-10-29",
                },
                {
                  text: "CLI .128 / IDE .166 与 .183（历史）",
                  link: "/chainlesschain/cli-ide-update-2026-10-28",
                },
                {
                  text: "CLI .121 普通文本投影（历史）",
                  link: "/chainlesschain/cli-ide-update-2026-10-26",
                },
                {
                  text: "CLI .117 / IDE .159 与 .176（历史）",
                  link: "/chainlesschain/cli-ide-update-2026-10-23",
                },
                {
                  text: "CLI .112 / IDE .155 与 .172（历史）",
                  link: "/chainlesschain/cli-ide-update-2026-10-20",
                },
                {
                  text: "CLI .104 / IDE 会话恢复（历史）",
                  link: "/chainlesschain/cli-ide-update-2026-10-17",
                },
                {
                  text: "CLI .103 / IDE 升级与草稿容量",
                  link: "/chainlesschain/cli-ide-update-2026-10-16",
                },
                {
                  text: "CLI .101 升级与草稿恢复",
                  link: "/chainlesschain/cli-ide-update-2026-10-15",
                },
                {
                  text: "CLI .100 升级与故障排查",
                  link: "/chainlesschain/cli-ide-update-2026-10-13",
                },
              ],
            },
            {
              text: "运行时设计记录",
              collapsed: true,
              items: [
                {
                  text: "CLI .132 响应终态与当前任务保护",
                  link: "/design/release-runtime-update-2026-10-30-132",
                },
                {
                  text: "2026-10-29 CLI .131 独立验收与运行时设计",
                  link: "/design/release-runtime-update-2026-10-29-131",
                },
                {
                  text: "2026-10-29 CLI .130 Goal 与主线边界（历史）",
                  link: "/design/release-runtime-update-2026-10-29-130",
                },
                {
                  text: "2026-10-29 CLI .129 公开配对与源码范围（历史）",
                  link: "/design/release-runtime-update-2026-10-29",
                },
                {
                  text: "2026-10-28 Goal 证据与交付复查设计（历史）",
                  link: "/design/release-runtime-update-2026-10-28",
                },
                {
                  text: "2026-10-26 v6 文本投影设计（历史）",
                  link: "/design/release-runtime-update-2026-10-26",
                },
                {
                  text: "2026-10-23 Evolution 输入与图片预算设计（历史）",
                  link: "/design/release-runtime-update-2026-10-23",
                },
                {
                  text: "2026-10-20 目标互通与诊断预算边界",
                  link: "/design/release-runtime-update-2026-10-20",
                },
                {
                  text: "2026-10-16 预算边界与模型分层",
                  link: "/design/release-runtime-update-2026-10-16",
                },
                {
                  text: "2026-10-15 上下文压缩与发行",
                  link: "/design/release-runtime-update-2026-10-15",
                },
                {
                  text: "2026-10-13 CLI / IDE 有界重试与发行",
                  link: "/design/release-runtime-update-2026-10-13",
                },
                {
                  text: "2026-10-10 CLI / IDE 与 Windows 取证",
                  link: "/design/release-runtime-update-2026-10-10",
                },
                {
                  text: "2026-10-08 组织目标与运行时保护",
                  link: "/design/governance-runtime-update-2026-10-08",
                },
                {
                  text: "2026-10-08 发行历史核对",
                  link: "/design/release-runtime-update-2026-10-08-latest",
                },
                {
                  text: "2026-10-07 持久目标与 RRSI 设计",
                  link: "/design/project-goals-rrsi-update-2026-10-07",
                },
                {
                  text: "2026-10-06 数据与受控动作设计",
                  link: "/design/data-actions-update-2026-10-06",
                },
                {
                  text: "2026-10-05 CLI/IDE 运行时设计",
                  link: "/design/agent-runtime-update-2026-10-05",
                },
                {
                  text: "2026-09-26 运行时增量设计",
                  link: "/design/agent-runtime-update-2026-09-26",
                },
              ],
            },
            {
              text: "产品规划",
              collapsed: true,
              items: [
                {
                  text: "产品演进路线图",
                  link: "/chainlesschain/product-roadmap",
                },
                {
                  text: "v1.1.0 实施计划",
                  link: "/chainlesschain/implementation-plan",
                },
              ],
            },
          ],
        },
      ],
      "/design/": [
        {
          text: "架构总览",
          collapsed: false,
          items: [
            { text: "设计文档索引", link: "/design/" },
            { text: "系统设计主文档", link: "/design/system-design-main" },
            { text: "实施总结与附录", link: "/design/implementation-summary" },
            { text: "安全机制设计", link: "/design/security-design" },
            { text: "数据同步方案", link: "/design/data-sync" },
            { text: "AI模型部署方案", link: "/design/ai-model-deploy" },
          ],
        },
        {
          text: "Agent 平台与运行时",
          collapsed: true,
          items: [
            {
              text: "当前运行时",
              collapsed: true,
              items: [
                {
                  text: "CLI Runtime 当前实现与源码候选",
                  link: "/design/cli-runtime-current",
                },
              ],
            },
            {
              text: "平台、协议与内核",
              collapsed: true,
              items: [
                {
                  text: "103 Agent SDK 平台化方案",
                  link: "/design/modules/103-agent-sdk-platform",
                },
                {
                  text: "104 CC App Server 设计",
                  link: "/design/modules/104-cc-app-server",
                },
                {
                  text: "105 Graph Kernel 设计",
                  link: "/design/modules/105-graph-kernel",
                },
                {
                  text: "106 Agent Kernel 设计",
                  link: "/design/modules/106-agent-kernel",
                },
                {
                  text: "107 单一协议 Schema 与自动代码生成",
                  link: "/design/modules/107-agent-protocol-codegen",
                },
                {
                  text: "108 Context/Memory Kernel 设计",
                  link: "/design/modules/108-context-memory-kernel",
                },
                {
                  text: "109 Desktop Cowork Skill 执行安全",
                  link: "/design/modules/109_Desktop_Cowork_Skill_Execution_Security",
                },
                {
                  text: "110 Agent Platform 发布与证据边界",
                  link: "/design/modules/110-agent-platform-release-boundaries",
                },
              ],
            },
            {
              text: "CLI 与编程工作流",
              collapsed: true,
              items: [
                {
                  text: "77 Agent架构优化",
                  link: "/design/modules/77-agent-optimization",
                },
                {
                  text: "78 CLI Agent Runtime重构计划",
                  link: "/design/modules/78-cli-agent-runtime",
                },
                {
                  text: "79 Coding Agent系统",
                  link: "/design/modules/79-coding-agent",
                },
                {
                  text: "80 规范工作流系统",
                  link: "/design/modules/80-canonical-workflow",
                },
                {
                  text: "81 轻量多Agent编排",
                  link: "/design/modules/81-sub-runtime-pool",
                },
                {
                  text: "82 CLI Runtime收口路线图",
                  link: "/design/modules/82-cli-runtime-convergence",
                },
                {
                  text: "83 工具描述规范统一",
                  link: "/design/modules/83-tool-descriptor-unification",
                },
                {
                  text: "89 v5.0.2.9 六项优化",
                  link: "/design/modules/89-runtime-six-enhancements",
                },
                {
                  text: "94 QualityGate 通用质量门控",
                  link: "/design/modules/94-quality-gate",
                },
                {
                  text: "96 V2 规范层 Governance",
                  link: "/design/modules/96-v2-governance",
                },
              ],
            },
            {
              text: "技能、学习与模型治理",
              collapsed: true,
              items: [
                {
                  text: "76 Skill Creator系统",
                  link: "/design/modules/76-skill-creator",
                },
                {
                  text: "84 自主学习闭环系统",
                  link: "/design/modules/84-autonomous-learning-loop",
                },
                {
                  text: "111 Record & Replay → Skill 设计",
                  link: "/design/modules/111-record-replay-skill-design",
                },
                {
                  text: "112 受治理的 Skill 自进化设计",
                  link: "/design/modules/112-governed-skill-evolution-design",
                },
                {
                  text: "113 Desktop 受治理模型入口",
                  link: "/design/modules/113-governed-desktop-model-ingress-design",
                },
                {
                  text: "114 Jev 类型化 Skill 决策层",
                  link: "/design/modules/114-jev-decision-layer-design",
                },
              ],
            },
            {
              text: "Cowork 协作",
              collapsed: true,
              items: [
                {
                  text: "86 Web Cowork协作",
                  link: "/design/modules/86-web-cowork",
                },
                {
                  text: "87 Cowork Evolution N1–N7",
                  link: "/design/modules/87-cowork-evolution",
                },
              ],
            },
            {
              text: "对标与演进计划",
              collapsed: true,
              items: [
                {
                  text: "85 Hermes Agent对标",
                  link: "/design/modules/85-hermes-agent-parity",
                },
                {
                  text: "85b 文档代码差距补全",
                  link: "/design/modules/85b-doc-code-gap-fill",
                },
                {
                  text: "88 Open-Agents 对标",
                  link: "/design/modules/88-open-agents-parity",
                },
                {
                  text: "91 Managed Agents 对标",
                  link: "/design/modules/91-managed-agents-parity",
                },
                {
                  text: "92 Deep Agents Deploy",
                  link: "/design/modules/92-deep-agents-deploy",
                },
              ],
            },
            {
              text: "优化与实施方案",
              collapsed: true,
              items: [
                {
                  text: "CLI 对标 Claude Code 优化计划",
                  link: "/design/CLAUDE_CODE_CLI_PARITY_OPTIMIZATION_PLAN",
                },
              ],
            },
          ],
        },
        {
          text: "CLI、IDE 与创作工具",
          collapsed: true,
          items: [
            {
              text: "CLI 分发与扩展",
              collapsed: true,
              items: [
                {
                  text: "66 CLI分发系统",
                  link: "/design/modules/66-cli-distribution",
                },
                {
                  text: "67 CLI高级功能",
                  link: "/design/modules/67-cli-advanced",
                },
                {
                  text: "68 CLI-Anything集成",
                  link: "/design/modules/68-cli-anything",
                },
                {
                  text: "69 WebSocket服务器",
                  link: "/design/modules/69-websocket-server",
                },
                {
                  text: "70 Agent智能增强",
                  link: "/design/modules/70-agent-intelligence",
                },
                {
                  text: "71 子代理隔离",
                  link: "/design/modules/71-sub-agent-isolation",
                },
              ],
            },
            {
              text: "IDE 与项目集成",
              collapsed: true,
              items: [
                {
                  text: "98 IDE 桥接对标方案",
                  link: "/design/modules/98-ide-bridge",
                },
                {
                  text: "99 项目记忆与 init 对标方案",
                  link: "/design/modules/99-project-memory-init",
                },
                {
                  text: "100 自定义斜杠命令与宏系统",
                  link: "/design/modules/100-slash-commands-macros",
                },
                {
                  text: "101 个人数据 IDE 桥接方案",
                  link: "/design/modules/101-personal-data-ide-bridge",
                },
                {
                  text: "102 Remote Session 方案",
                  link: "/design/modules/102-remote-session",
                },
              ],
            },
            {
              text: "项目打包",
              collapsed: true,
              items: [
                {
                  text: "cc pack 打包指令设计",
                  link: "/design/cc-pack-design",
                },
                {
                  text: "cc pack --project 项目模式",
                  link: "/design/cc-pack-project-mode-design",
                },
              ],
            },
            {
              text: "技能包与内容创作",
              collapsed: true,
              items: [
                {
                  text: "71b AI音视频创作模板",
                  link: "/design/modules/71b-ai-media-creator",
                },
                {
                  text: "72 AI文档创作模板",
                  link: "/design/modules/72-ai-doc-creator",
                },
                {
                  text: "90 AI视频生成 Seedance",
                  link: "/design/modules/90-ai-video-generation-seedance",
                },
                {
                  text: "93 CutClaw 视频剪辑 Agent",
                  link: "/design/modules/93-cutclaw-video-editing-agent",
                },
                {
                  text: "60b CLI指令技能包",
                  link: "/design/modules/60b-cli-skill-packs",
                },
              ],
            },
          ],
        },
        {
          text: "知识与个人数据",
          collapsed: true,
          items: [
            {
              text: "架构与分析",
              collapsed: true,
              items: [
                {
                  text: "主架构（13-Phase 路线图）",
                  link: "/design/Personal_Data_Hub_Architecture",
                },
                {
                  text: "Python Sidecar 设计（fork sjqz）",
                  link: "/design/Personal_Data_Hub_Python_Sidecar",
                },
                {
                  text: "EntityResolver 跨源消歧",
                  link: "/design/Personal_Data_Hub_EntityResolver",
                },
                {
                  text: "Phase 14 移动端原生入口",
                  link: "/design/Personal_Data_Hub_Phase_14_Mobile_Native_Entry",
                },
                {
                  text: "Phase 14.3 双端流式同步进度 + 审计回查",
                  link: "/design/Personal_Data_Hub_Phase_14_3_Sync_Audit_Streaming",
                },
                {
                  text: "sjqz 对比分析（取舍依据）",
                  link: "/design/Personal_Data_Hub_sjqz_Comparison",
                },
                {
                  text: "Phase 11 Analysis Skills（5 内置分析） ✅",
                  link: "/design/Personal_Data_Hub_Analysis_Skills",
                },
              ],
            },
            {
              text: "数据适配器",
              collapsed: true,
              items: [
                {
                  text: "Adapter — Email (IMAP) ✅",
                  link: "/design/Adapter_Email_IMAP",
                },
                {
                  text: "Adapter — 支付宝账单 ✅",
                  link: "/design/Adapter_Alipay_Bill",
                },
                {
                  text: "Adapter — 系统数据 ✅ Phase 4.5",
                  link: "/design/Adapter_System_Data",
                },
                {
                  text: "Adapter — Shopping 三件套 ✅ Phase 7",
                  link: "/design/Adapter_Shopping_Cookie",
                },
                {
                  text: "Adapter — Travel 四件套 ✅ Phase 9",
                  link: "/design/Adapter_Travel_LBS",
                },
                {
                  text: "Adapter — AI 对话历史（9 家国产）✅ Phase 10.2",
                  link: "/design/Adapter_AIChat_History",
                },
                {
                  text: "Adapter — 社交/即时通讯（7 家）✅ Phase 13",
                  link: "/design/Adapter_Social_Messaging",
                },
                {
                  text: "Adapter — 微信 SQLCipher 🚧 v0.5",
                  link: "/design/Adapter_WeChat_SQLCipher",
                },
                {
                  text: "微信 Frida Setup Runbook（rooted 用户）",
                  link: "/design/Adapter_WeChat_SQLCipher_Frida_Setup",
                },
                {
                  text: "Adapter — Social Cookie 模式（A8）",
                  link: "/design/Adapter_Social_Cookie",
                },
              ],
            },
            {
              text: "采集方案与验证",
              collapsed: true,
              items: [
                {
                  text: "E2E Runbook（真账号验收）",
                  link: "/design/Personal_Data_Hub_E2E_Runbook",
                },
                {
                  text: "v0.1 → v1 Fixture Pin 协议（方法论）",
                  link: "/design/Personal_Data_Hub_Fixture_Pin_Protocol",
                },
                {
                  text: "PDH Social 多路径本机采集方案 (Mode A/B/C)",
                  link: "/design/PDH_Social_Multipath_Local_Collection_Plan",
                },
                {
                  text: "PDH Weibo DB Schema 探测",
                  link: "/design/PDH_Weibo_DB_Schema_Probe",
                },
              ],
            },
            {
              text: "Cookie 采集验收",
              collapsed: true,
              items: [
                {
                  text: "A8 Bilibili 真机 E2E 计划",
                  link: "/design/A8_Bilibili_E2E_Plan",
                },
                {
                  text: "A8 Weibo 真机 E2E 计划",
                  link: "/design/A8_Weibo_E2E_Plan",
                },
                {
                  text: "A8 Douyin 真机 E2E 计划",
                  link: "/design/A8_Douyin_E2E_Plan",
                },
                {
                  text: "A8 Xiaohongshu 真机 E2E 计划",
                  link: "/design/A8_Xhs_E2E_Plan",
                },
                {
                  text: "A8 Toutiao 真机 E2E 计划",
                  link: "/design/A8_Toutiao_E2E_Plan",
                },
                {
                  text: "A8 Kuaishou 真机 E2E 计划",
                  link: "/design/A8_Kuaishou_E2E_Plan",
                },
              ],
            },
            {
              text: "真机采集验收",
              collapsed: true,
              items: [
                {
                  text: "PDH Bilibili C 路径 (PC ADB) 真机 E2E",
                  link: "/design/PDH_Bilibili_C_Path_Real_Device_E2E",
                },
                {
                  text: "PDH Bilibili Mode B (Android in-APK root) 真机 E2E",
                  link: "/design/PDH_Bilibili_Mode_B_Real_Device_E2E",
                },
                {
                  text: "PDH Weibo Mode B (Android in-APK root) 真机 E2E",
                  link: "/design/PDH_Weibo_Mode_B_Real_Device_E2E",
                },
                {
                  text: "PDH Weibo C 路径 真机 E2E",
                  link: "/design/PDH_Weibo_Real_Device_E2E",
                },
                {
                  text: "PDH Xiaohongshu C 路径 真机 E2E",
                  link: "/design/PDH_Xhs_Real_Device_E2E",
                },
                {
                  text: "PDH Douyin 真机 E2E",
                  link: "/design/PDH_Douyin_Real_Device_E2E",
                },
                {
                  text: "PDH Toutiao C 路径 真机 E2E",
                  link: "/design/PDH_Toutiao_C_Path_Real_Device_E2E",
                },
                {
                  text: "PDH Kuaishou C 路径 真机 E2E",
                  link: "/design/PDH_Kuaishou_C_Path_Real_Device_E2E",
                },
                {
                  text: "PDH Mode B Toutiao+Douyin 真机 E2E",
                  link: "/design/PDH_Mode_B_Toutiao_Douyin_Real_Device_E2E",
                },
              ],
            },
            {
              text: "知识与采集模块",
              collapsed: true,
              items: [
                {
                  text: "01 知识库管理",
                  link: "/design/modules/01-knowledge-base",
                },
                {
                  text: "48 层次化记忆2.0",
                  link: "/design/modules/48-hierarchical-memory",
                },
                {
                  text: "59 企业知识图谱",
                  link: "/design/modules/59-knowledge-graph",
                },
                {
                  text: "101b QQNT Frida 采集方案",
                  link: "/design/modules/101b-qqnt-frida-collection",
                },
              ],
            },
          ],
        },
        {
          text: "桌面、Web 与移动端",
          collapsed: true,
          items: [
            {
              text: "桌面与 Web 模块",
              collapsed: true,
              items: [
                { text: "73 Web管理界面", link: "/design/modules/73-web-ui" },
                {
                  text: "75 Vue3 Web管理面板 10模块+4主题",
                  link: "/design/modules/75-web-panel",
                },
                {
                  text: "97 桌面版 UI · Claude-Desktop 重构",
                  link: "/design/modules/97-claude-desktop-refactor",
                },
              ],
            },
            {
              text: "桌面架构与交互",
              collapsed: true,
              items: [
                {
                  text: "桌面版 UI 重构 (v6 Shell P0–P6)",
                  link: "/design/desktop-ui-refactor",
                },
                {
                  text: "桌面 Web 壳架构与落地",
                  link: "/design/desktop-web-shell-architecture",
                },
                {
                  text: "工具卡 + TodoWrite 面板落地方案",
                  link: "/design/claudebox-learning-plan",
                },
              ],
            },
            {
              text: "移动端与远程控制",
              collapsed: true,
              items: [
                {
                  text: "Phase 3d 移动端同步",
                  link: "/design/phase3d-mobile-sync",
                },
                {
                  text: "Android v1.0 重新定位 (L1+L2+L3)",
                  link: "/design/android-repositioning",
                },
                {
                  text: "Android AI Chat × cc-exec Tool (Phase 0 MVP)",
                  link: "/design/Android_AI_Chat_CC_Exec_Tool",
                },
                {
                  text: "Android AI Chat × cc-exec — Phase 5.8 E2E SOP",
                  link: "/design/Android_AI_Chat_CC_Exec_Phase_5_8_E2E_SOP",
                },
                {
                  text: "Android AI Chat × cc-exec — Phase 5.8 Checklist",
                  link: "/design/Android_AI_Chat_CC_Exec_Phase_5_8_Checklist",
                },
              ],
            },
            {
              text: "浏览器与任务接力",
              collapsed: true,
              items: [
                {
                  text: "浏览器插件计划",
                  link: "/design/BROWSER_EXTENSION_PLAN",
                },
              ],
            },
          ],
        },
        {
          text: "核心能力与基础设施",
          collapsed: true,
          items: [
            {
              text: "基础模块（02–16）",
              collapsed: true,
              items: [
                {
                  text: "02 去中心化社交",
                  link: "/design/modules/02-decentralized-social",
                },
                { text: "03 交易辅助", link: "/design/modules/03-trading" },
                {
                  text: "04 项目管理",
                  link: "/design/modules/04-project-management",
                },
                {
                  text: "05 企业版组织",
                  link: "/design/modules/05-enterprise-org",
                },
                {
                  text: "06 AI优化系统",
                  link: "/design/modules/06-ai-optimization",
                },
                { text: "07 性能优化", link: "/design/modules/07-performance" },
                { text: "08 MCP与配置", link: "/design/modules/08-mcp-config" },
                {
                  text: "09 浏览器自动化",
                  link: "/design/modules/09-browser-automation",
                },
                {
                  text: "10 远程控制",
                  link: "/design/modules/10-remote-control",
                },
                { text: "11 企业审计", link: "/design/modules/11-audit" },
                {
                  text: "12 插件市场",
                  link: "/design/modules/12-plugin-marketplace",
                },
                {
                  text: "13 多代理系统",
                  link: "/design/modules/13-multi-agent",
                },
                { text: "14 SSO企业认证", link: "/design/modules/14-sso" },
                { text: "15 MCP SDK", link: "/design/modules/15-mcp-sdk" },
                { text: "16 AI技能系统", link: "/design/modules/16-ai-skills" },
              ],
            },
            {
              text: "企业、社交与自动化（17–28）",
              collapsed: true,
              items: [
                { text: "17 EvoMap系统", link: "/design/modules/17-evomap" },
                { text: "17 IPFS存储", link: "/design/modules/17b-ipfs" },
                {
                  text: "18 P2P实时协作",
                  link: "/design/modules/18-p2p-collab",
                },
                { text: "18 社交AI", link: "/design/modules/18b-social-ai" },
                { text: "19 合规分类", link: "/design/modules/19-compliance" },
                {
                  text: "19 自治Agent",
                  link: "/design/modules/19b-agent-runner",
                },
                { text: "20 企业用户配置", link: "/design/modules/20-scim" },
                {
                  text: "20 模型量化",
                  link: "/design/modules/20b-quantization",
                },
                { text: "21 i18n国际化", link: "/design/modules/21-i18n" },
                {
                  text: "21 统一密钥",
                  link: "/design/modules/21b-unified-key",
                },
                {
                  text: "22 性能自动调优",
                  link: "/design/modules/22-auto-tuning",
                },
                {
                  text: "22 内容推荐",
                  link: "/design/modules/22b-content-rec",
                },
                { text: "23 Nostr桥接", link: "/design/modules/23-nostr" },
                {
                  text: "23 企业组织管理",
                  link: "/design/modules/23b-org-management",
                },
                {
                  text: "24 去中心化Agent",
                  link: "/design/modules/24-agent-network",
                },
                { text: "24 数据防泄漏", link: "/design/modules/24b-dlp" },
                { text: "25 SIEM", link: "/design/modules/25-siem" },
                {
                  text: "25 自治运维",
                  link: "/design/modules/25b-autonomous-ops",
                },
                { text: "26 开发流水线", link: "/design/modules/26-pipeline" },
                { text: "26 社区治理", link: "/design/modules/26b-governance" },
                { text: "27 Matrix集成", link: "/design/modules/27-matrix" },
                {
                  text: "27 多模态协作",
                  link: "/design/modules/27b-multimodal",
                },
                {
                  text: "28 基础设施编排",
                  link: "/design/modules/28-infrastructure",
                },
                {
                  text: "28 自然语言编程",
                  link: "/design/modules/28b-nl-programming",
                },
              ],
            },
            {
              text: "生产加固与生态（29–42）",
              collapsed: true,
              items: [
                {
                  text: "29 生产强化",
                  link: "/design/modules/29-production-hardening",
                },
                {
                  text: "30 联邦强化",
                  link: "/design/modules/30-federation-hardening",
                },
                { text: "31 压力测试", link: "/design/modules/31-stress-test" },
                { text: "32 信誉优化", link: "/design/modules/32-reputation" },
                { text: "33 跨组织SLA", link: "/design/modules/33-sla" },
                {
                  text: "34 技术学习引擎",
                  link: "/design/modules/34-tech-learning",
                },
                {
                  text: "35 自主开发者",
                  link: "/design/modules/35-autonomous-dev",
                },
                {
                  text: "36 协作治理",
                  link: "/design/modules/36-collab-governance",
                },
                {
                  text: "37 技能市场",
                  link: "/design/modules/37-skill-marketplace",
                },
                {
                  text: "38 推理网络",
                  link: "/design/modules/38-inference-network",
                },
                {
                  text: "39 信任安全",
                  link: "/design/modules/39-trust-security",
                },
                {
                  text: "40 协议融合",
                  link: "/design/modules/40-protocol-fusion",
                },
                {
                  text: "41 去中心化基础设施",
                  link: "/design/modules/41-decentralized-infra",
                },
                {
                  text: "42 EvoMap高级联邦",
                  link: "/design/modules/42-evomap-federation",
                },
              ],
            },
            {
              text: "架构与 Agent 基础（43–52）",
              collapsed: true,
              items: [
                { text: "43 IPC域分割", link: "/design/modules/43-ipc-split" },
                { text: "44 DI容器", link: "/design/modules/44-di-container" },
                {
                  text: "45 数据库演进",
                  link: "/design/modules/45-db-migration",
                },
                { text: "46 A2A协议", link: "/design/modules/46-a2a-protocol" },
                { text: "47 工作流编排", link: "/design/modules/47-workflow" },
                {
                  text: "49 多模态感知",
                  link: "/design/modules/49-multimodal-perception",
                },
                {
                  text: "50 Agent经济",
                  link: "/design/modules/50-agent-economy",
                },
                {
                  text: "51 代码生成Agent",
                  link: "/design/modules/51-code-agent",
                },
                { text: "52 安全沙箱2.0", link: "/design/modules/52-sandbox" },
              ],
            },
            {
              text: "Web3 与企业平台（53–65）",
              collapsed: true,
              items: [
                { text: "53 零知识证明", link: "/design/modules/53-zkp" },
                {
                  text: "54 跨链互操作",
                  link: "/design/modules/54-cross-chain",
                },
                { text: "55 DID 2.0", link: "/design/modules/55-did-v2" },
                {
                  text: "56 隐私计算",
                  link: "/design/modules/56-privacy-computing",
                },
                {
                  text: "57 DAO治理2.0",
                  link: "/design/modules/57-dao-governance",
                },
                { text: "58 低代码平台", link: "/design/modules/58-low-code" },
                { text: "60 BI智能分析", link: "/design/modules/60-bi-engine" },
                {
                  text: "61 工作流自动化",
                  link: "/design/modules/61-workflow-automation",
                },
                { text: "62 多租户SaaS", link: "/design/modules/62-saas" },
                {
                  text: "63 统一运行时",
                  link: "/design/modules/63-unified-runtime",
                },
                {
                  text: "64 插件生态2.0",
                  link: "/design/modules/64-plugin-ecosystem",
                },
                {
                  text: "65 自进化AI",
                  link: "/design/modules/65-self-evolving-ai",
                },
              ],
            },
            {
              text: "编排与社交扩展",
              collapsed: true,
              items: [
                {
                  text: "74 AI编排层系统",
                  link: "/design/modules/74-orchestration-layer",
                },
                {
                  text: "95 社交协议生态补齐",
                  link: "/design/modules/95-social-protocols-landing",
                },
              ],
            },
            {
              text: "Hooks 扩展",
              collapsed: true,
              items: [
                { text: "Hook系统设计", link: "/design/HOOKS_SYSTEM_DESIGN" },
              ],
            },
          ],
        },
        {
          text: "MTC 默克尔树证书",
          collapsed: true,
          items: [
            { text: "落地方案", link: "/design/mtc-landing-plan" },
            { text: "数据格式 v1", link: "/design/mtc-data-format-v1" },
            {
              text: "联邦治理 v1",
              link: "/design/mtc-federation-governance-v1",
            },
            {
              text: "跨链桥设计 v1",
              link: "/design/mtc-cross-chain-bridge-v1",
            },
            { text: "v0.2 评审清单", link: "/design/mtc-review-checklist" },
          ],
        },
        {
          text: "历史记录与归档",
          collapsed: true,
          items: [
            {
              text: "运行时设计记录",
              collapsed: true,
              items: [
                {
                  text: "CLI .132 响应终态与当前任务保护",
                  link: "/design/release-runtime-update-2026-10-30-132",
                },
                {
                  text: "2026-10-29 CLI .131 独立验收与运行时设计",
                  link: "/design/release-runtime-update-2026-10-29-131",
                },
                {
                  text: "2026-10-29 CLI .130 Goal 与主线边界（历史）",
                  link: "/design/release-runtime-update-2026-10-29-130",
                },
                {
                  text: "2026-10-29 CLI .129 公开配对与源码范围（历史）",
                  link: "/design/release-runtime-update-2026-10-29",
                },
                {
                  text: "2026-10-28 Goal 证据与交付复查设计（历史）",
                  link: "/design/release-runtime-update-2026-10-28",
                },
                {
                  text: "2026-10-26 v6 文本投影设计（历史）",
                  link: "/design/release-runtime-update-2026-10-26",
                },
                {
                  text: "2026-10-23 Evolution 输入与图片预算设计（历史）",
                  link: "/design/release-runtime-update-2026-10-23",
                },
                {
                  text: "2026-10-20 目标互通与诊断预算边界",
                  link: "/design/release-runtime-update-2026-10-20",
                },
                {
                  text: "2026-10-16 预算边界与模型分层",
                  link: "/design/release-runtime-update-2026-10-16",
                },
                {
                  text: "2026-10-15 上下文压缩与发行",
                  link: "/design/release-runtime-update-2026-10-15",
                },
                {
                  text: "2026-10-13 CLI / IDE 有界重试与发行",
                  link: "/design/release-runtime-update-2026-10-13",
                },
                {
                  text: "2026-10-10 CLI / IDE 与 Windows 取证",
                  link: "/design/release-runtime-update-2026-10-10",
                },
                {
                  text: "2026-10-08 组织目标与运行时保护",
                  link: "/design/governance-runtime-update-2026-10-08",
                },
                {
                  text: "2026-10-08 发行历史核对",
                  link: "/design/release-runtime-update-2026-10-08-latest",
                },
                {
                  text: "2026-10-07 持久目标与 RRSI 设计",
                  link: "/design/project-goals-rrsi-update-2026-10-07",
                },
                {
                  text: "2026-10-06 数据与受控动作设计",
                  link: "/design/data-actions-update-2026-10-06",
                },
                {
                  text: "2026-10-05 CLI/IDE 运行时设计",
                  link: "/design/agent-runtime-update-2026-10-05",
                },
                {
                  text: "2026-09-26 运行时增量设计",
                  link: "/design/agent-runtime-update-2026-09-26",
                },
              ],
            },
            {
              text: "原始完整文档",
              collapsed: true,
              items: [
                {
                  text: "完整系统设计(存档)",
                  link: "/design/system-design-full",
                },
              ],
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
          collapsed: false,
        },
        {
          text: "设备管理",
          items: [
            { text: "设备注册", link: "/manufacturer/device-register" },
            { text: "设备激活", link: "/manufacturer/device-activate" },
            { text: "设备管理", link: "/manufacturer/device-manage" },
          ],
          collapsed: true,
        },
        {
          text: "APP版本管理",
          items: [
            { text: "版本上传", link: "/manufacturer/app-upload" },
            { text: "版本发布", link: "/manufacturer/app-publish" },
            { text: "更新检查", link: "/manufacturer/app-update" },
          ],
          collapsed: true,
        },
        {
          text: "数据管理",
          items: [
            { text: "数据备份", link: "/manufacturer/data-backup" },
            { text: "数据恢复", link: "/manufacturer/data-restore" },
            { text: "密码恢复", link: "/manufacturer/password-recovery" },
          ],
          collapsed: true,
        },
        {
          text: "系统管理",
          items: [
            { text: "用户管理", link: "/manufacturer/user-management" },
            { text: "操作日志", link: "/manufacturer/operation-logs" },
            { text: "权限控制", link: "/manufacturer/permissions" },
          ],
          collapsed: true,
        },
      ],
      "/api/": [
        {
          text: "API文档",
          items: [
            { text: "API简介", link: "/api/introduction" },
            { text: "认证授权", link: "/api/authentication" },
          ],
          collapsed: false,
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
          collapsed: true,
        },
        {
          text: "ChainlessChain API",
          items: [
            { text: "知识库", link: "/api/chainlesschain/knowledge" },
            { text: "社交", link: "/api/chainlesschain/social" },
            { text: "交易", link: "/api/chainlesschain/trading" },
          ],
          collapsed: true,
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
