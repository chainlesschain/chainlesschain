/**
 * CLI Command Skill Pack — Domain Schema
 *
 * Defines the 9 domain packs that wrap CLI commands as agent-callable skills.
 * Each pack groups related commands by functional domain.
 *
 * execution-mode values:
 *   direct     — spawnSync execution, no LLM required
 *   llm-query  — single-shot LLM call, non-interactive
 *   agent      — requires interactive REPL (cannot be spawnSync'd)
 *   hybrid     — mix of direct + optional LLM
 */

export const CLI_PACK_DOMAINS = {
  "cli-knowledge-pack": {
    displayName: "知识管理技能包",
    description:
      "笔记增删改查、全文混合搜索(BM25+向量)、Markdown/PDF/Evernote导入导出、Git集成、Token用量、会话管理",
    executionMode: "direct",
    category: "cli-direct",
    tags: ["note", "search", "import", "export", "git", "knowledge", "memory"],
    commands: {
      note: {
        description: "笔记管理",
        subcommands: ["add", "list", "show", "search", "delete", "export"],
        example: 'note add "标题" -c "内容" -t "标签1,标签2"',
      },
      search: {
        description: "全文混合搜索 (BM25 + 向量)",
        example: 'search "关键词"',
      },
      import: {
        description: "导入内容 (markdown目录/pdf文件/evernote备份)",
        example: "import markdown ./docs",
      },
      export: {
        description: "导出笔记为静态网站或ZIP",
        example: "export site -o ./output",
      },
      git: {
        description: "Git集成 (状态查看/自动提交)",
        example: "git status",
      },
      tokens: {
        description: "Token用量追踪与统计",
        example: "tokens show",
      },
      memory: {
        description: "持久化记忆管理",
        example: 'memory add "需要记住的内容"',
      },
      session: {
        description: "会话列表管理",
        example: "session list",
      },
    },
  },

  "cli-identity-pack": {
    displayName: "身份安全技能包",
    description:
      "DID去中心化身份(Ed25519)、AES-256-GCM文件加密解密、RBAC权限检查、审计日志",
    executionMode: "direct",
    category: "cli-direct",
    tags: ["did", "encrypt", "auth", "audit", "identity", "security", "crypto"],
    commands: {
      did: {
        description: "DID去中心化身份管理",
        subcommands: [
          "create",
          "show",
          "list",
          "sign",
          "verify",
          "export",
          "delete",
          "set-default",
        ],
        example: "did create",
      },
      encrypt: {
        description: "AES-256-GCM文件加密",
        example: "encrypt file secret.txt",
      },
      decrypt: {
        description: "解密加密文件",
        example: "decrypt file secret.txt.enc",
      },
      auth: {
        description: "RBAC权限角色与检查",
        subcommands: ["roles", "check"],
        example: 'auth check user1 "note:read"',
      },
      audit: {
        description: "审计日志查看与统计",
        subcommands: ["log", "stats"],
        example: "audit log",
      },
    },
  },

  "cli-infra-pack": {
    displayName: "基础设施技能包",
    description:
      "系统启停、数据库生命周期管理、配置管理、Docker服务编排、环境诊断、版本更新",
    executionMode: "direct",
    category: "cli-direct",
    tags: ["db", "config", "docker", "infra", "system", "setup", "doctor"],
    commands: {
      setup: {
        description: "交互式安装向导",
        example: "setup",
      },
      start: {
        description: "启动桌面应用",
        example: "start",
      },
      stop: {
        description: "停止应用",
        example: "stop",
      },
      status: {
        description: "查看系统运行状态",
        example: "status",
      },
      services: {
        description: "Docker服务管理",
        subcommands: ["up", "down", "logs", "ps"],
        example: "services up",
      },
      config: {
        description: "配置项管理",
        subcommands: ["list", "get", "set", "reset"],
        example: "config list",
      },
      update: {
        description: "检查并更新CLI版本",
        example: "update",
      },
      doctor: {
        description: "诊断运行环境 (Node/Docker/Ollama等)",
        example: "doctor",
      },
      db: {
        description: "数据库生命周期管理",
        subcommands: ["init", "info", "backup", "restore", "migrate"],
        example: "db info",
      },
    },
  },

  "cli-ai-query-pack": {
    displayName: "AI查询技能包",
    description:
      "单次LLM问答、LLM提供商管理(10+)、偏好学习、多视角代码评审、A/B方案对比、代码分析",
    executionMode: "llm-query",
    category: "cli-direct",
    tags: ["ask", "llm", "cowork", "ai", "query", "instinct"],
    commands: {
      ask: {
        description: "单次AI问答 (非交互式，支持10+提供商)",
        example: 'ask "如何优化这段代码？"',
      },
      llm: {
        description: "LLM提供商管理",
        subcommands: ["models", "test", "providers", "add-provider", "switch"],
        example: "llm models",
      },
      instinct: {
        description: "偏好学习与行为建议",
        subcommands: ["show", "learn", "reset"],
        example: "instinct show",
      },
      cowork: {
        description: "多视角AI协作分析",
        subcommands: ["debate", "compare", "analyze", "status"],
        example: "cowork debate src/main.js",
      },
    },
  },

  "cli-agent-mode-pack": {
    displayName: "Agent模式技能包",
    description:
      "交互式AI对话(流式输出)、全工具访问的Agent会话(文件读写/命令执行/138技能)。注意：此类指令需要在终端中直接运行，无法被子进程调用。",
    executionMode: "agent",
    category: "cli-agent",
    tags: ["agent", "chat", "interactive", "repl", "session"],
    commands: {
      chat: {
        description: "交互式AI多轮对话 (流式输出，支持会话恢复)",
        example: "chat --provider ollama --model qwen2:7b",
        isAgentMode: false,
      },
      agent: {
        description:
          "Agent会话 (完整工具访问: 文件读写/命令执行/138技能/Plan Mode)",
        example: "agent --session <id>",
        isAgentMode: true,
      },
    },
  },

  "cli-web3-pack": {
    displayName: "Web3与社交技能包",
    description:
      "P2P加密通讯、数字资产钱包、组织协作管理、DAO治理(二次方投票)、Agent微支付、去中心化社交、Nostr/Matrix桥接",
    executionMode: "direct",
    category: "cli-direct",
    tags: ["p2p", "wallet", "dao", "web3", "social", "blockchain", "nostr"],
    commands: {
      p2p: {
        description: "P2P点对点加密通讯管理",
        subcommands: ["peers", "send", "pair"],
        example: 'p2p send <peer> "消息"',
      },
      sync: {
        description: "跨设备数据同步",
        subcommands: ["status", "push", "pull"],
        example: "sync status",
      },
      wallet: {
        description: "数字资产钱包管理",
        subcommands: ["create", "assets", "transfer"],
        example: 'wallet create --name "主钱包"',
      },
      org: {
        description: "组织管理与成员协作",
        subcommands: ["create", "invite", "approve"],
        example: 'org create "Acme Corp"',
      },
      dao: {
        description: "DAO治理提案与投票 (二次方投票)",
        subcommands: [
          "propose",
          "vote",
          "delegate",
          "execute",
          "treasury",
          "stats",
        ],
        example: "dao propose '提案标题'",
      },
      economy: {
        description: "Agent微支付与贡献NFT",
        subcommands: ["pay", "market", "nft"],
        example: "economy market list",
      },
      nostr: {
        description: "Nostr协议中继与事件发布",
        subcommands: ["relays", "publish", "keygen", "map-did"],
        example: 'nostr publish "Hello World"',
      },
      matrix: {
        description: "Matrix聊天桥接",
        subcommands: ["login", "rooms", "send"],
        example: 'matrix send <room> "消息"',
      },
      social: {
        description: "去中心化社交网络管理",
        subcommands: ["contact", "friend", "post", "chat", "stats"],
        example: 'social post publish "帖子内容"',
      },
    },
  },

  "cli-security-pack": {
    displayName: "安全合规技能包",
    description:
      "GDPR/HIPAA/SOC2合规证据、DLP数据防泄漏、SIEM日志导出、后量子密码学(ML-KEM)、ZKP零知识证明、沙箱执行、安全基线",
    executionMode: "direct",
    category: "cli-direct",
    tags: [
      "compliance",
      "security",
      "dlp",
      "siem",
      "pqc",
      "zkp",
      "sandbox",
      "hipaa",
      "gdpr",
    ],
    commands: {
      compliance: {
        description: "合规证据收集与报告生成",
        subcommands: ["evidence", "report", "classify", "scan"],
        example: "compliance evidence gdpr",
      },
      dlp: {
        description: "DLP数据防泄漏扫描与策略",
        subcommands: ["scan", "incidents", "policy"],
        example: 'dlp scan "内容文本"',
      },
      siem: {
        description: "SIEM安全信息与事件管理",
        subcommands: ["targets", "add-target", "export"],
        example: "siem targets",
      },
      pqc: {
        description: "后量子密码学密钥管理 (ML-KEM-768)",
        subcommands: ["keys", "generate", "migration-status", "migrate"],
        example: "pqc generate ML-KEM-768",
      },
      zkp: {
        description: "零知识证明电路编译与验证",
        subcommands: ["compile", "prove", "verify"],
        example: "zkp compile --name age-proof",
      },
      sandbox: {
        description: "沙箱创建与安全隔离执行",
        subcommands: ["create", "exec", "audit"],
        example: 'sandbox exec <id> "command"',
      },
      hardening: {
        description: "安全基线采集与回归对比",
        subcommands: ["baseline", "audit"],
        example: 'hardening baseline collect "v1"',
      },
    },
  },

  "cli-enterprise-pack": {
    displayName: "企业级技能包",
    description:
      "BI商业智能(NL→SQL)、低代码平台、Terraform工作空间、SCIM用户同步、Webhook事件、DAG工作流、Agent间协议、层次化记忆",
    executionMode: "direct",
    category: "cli-direct",
    tags: ["bi", "lowcode", "enterprise", "workflow", "hook", "a2a", "hmemory"],
    commands: {
      bi: {
        description: "BI商业智能查询与仪表盘",
        subcommands: ["query", "dashboard", "anomaly"],
        example: 'bi query "显示月度销售额"',
      },
      lowcode: {
        description: "低代码应用创建与发布",
        subcommands: ["create", "components", "publish"],
        example: 'lowcode create --name "app1"',
      },
      terraform: {
        description: "Terraform工作空间管理",
        subcommands: ["workspaces", "create", "plan"],
        example: 'terraform create "prod"',
      },
      scim: {
        description: "SCIM用户目录同步",
        subcommands: ["users", "sync"],
        example: "scim users list",
      },
      hook: {
        description: "Webhook事件注册与触发",
        subcommands: ["list", "add", "run", "stats"],
        example: "hook list",
      },
      workflow: {
        description: "DAG工作流编排与执行",
        subcommands: ["create", "run", "templates"],
        example: "workflow templates",
      },
      a2a: {
        description: "Agent间协议注册与任务分发",
        subcommands: ["register", "discover", "submit"],
        example: 'a2a register --name "agent1" --capabilities \'["code"]\'',
      },
      hmemory: {
        description: "层次化记忆存储与召回",
        subcommands: ["store", "recall", "consolidate"],
        example: 'hmemory store "事实" --importance 0.8',
      },
    },
  },

  "cli-integration-pack": {
    displayName: "集成扩展技能包",
    description:
      "MCP工具服务器管理、浏览器自动化与抓取、插件生态市场、CLI工具桥接(Python)、EvoMap基因交换、WebSocket服务器、AI自演化、项目初始化与Persona",
    executionMode: "hybrid",
    category: "cli-direct",
    tags: [
      "mcp",
      "browser",
      "plugin",
      "cli-anything",
      "evomap",
      "serve",
      "evolution",
      "init",
      "persona",
    ],
    commands: {
      mcp: {
        description: "MCP工具服务器管理",
        subcommands: ["servers", "add", "tools"],
        example:
          'mcp add fs -c npx -a "-y,@modelcontextprotocol/server-filesystem"',
      },
      browse: {
        description: "浏览器自动化 (抓取/元素提取)",
        subcommands: ["fetch", "scrape"],
        example: "browse fetch https://example.com",
      },
      plugin: {
        description: "插件生态市场",
        subcommands: ["list", "install", "search"],
        example: "plugin list",
      },
      "cli-anything": {
        description: "CLI工具桥接 (Python + cli-anything)",
        subcommands: ["doctor", "scan", "register", "list", "remove"],
        example: "cli-anything scan",
      },
      evomap: {
        description: "EvoMap基因交换与联邦",
        subcommands: [
          "search",
          "download",
          "publish",
          "list",
          "hubs",
          "federation",
          "gov",
        ],
        example: "evomap list",
      },
      serve: {
        description: "启动WebSocket服务器 (默认端口18800)",
        example: "serve --port 9000",
      },
      evolution: {
        description: "AI能力自演化评估与诊断",
        subcommands: ["assess", "diagnose", "learn"],
        example: "evolution diagnose",
      },
      init: {
        description: "交互式项目初始化 (含Persona模板)",
        subcommands: ["--template", "--bare", "--yes"],
        example: "init --template code-project --yes",
      },
      persona: {
        description: "项目Persona个性配置",
        subcommands: ["show", "set", "reset"],
        example: "persona show",
      },
    },
  },
};

/** 执行模式说明 */
export const EXECUTION_MODE_DESCRIPTIONS = {
  direct: "直接执行 — 通过子进程调用CLI指令，无需LLM参与，毫秒级响应",
  "llm-query": "LLM查询 — 单次非交互式LLM调用，需要配置LLM提供商，30秒内完成",
  agent:
    "Agent模式 — 需要交互式终端，不可被子进程调用。请直接在终端运行对应指令",
  hybrid: "混合模式 — 大部分子指令直接执行，部分复杂子指令需要Agent模式",
};

/** Agent模式下需要特殊处理的指令列表 */
export const AGENT_MODE_COMMANDS = new Set(["chat", "agent"]);

/** 版本信息 — 用于sync检测 */
export const PACK_SCHEMA_VERSION = "1.0.0";
