# 模块66: CLI 分发系统

## 1. 模块概述

### 1.1 设计目标

提供轻量级 npm CLI 工具，让开发者通过 `npm install -g chainlesschain && chainlesschain setup` 一条命令即可安装、配置和管理 ChainlessChain 系统，替代传统的平台特定安装包下载流程。

### 1.2 核心定位

| 维度         | 说明                                                                                      |
| ------------ | ----------------------------------------------------------------------------------------- |
| **角色**     | 薄编排层（~2MB 纯 JS），不包含原生模块                                                    |
| **职责**     | 下载预构建二进制、管理配置、编排 Docker 服务、管理桌面应用进程                            |
| **关键差异** | 与 OpenClaw 等无头网关不同，ChainlessChain 是 GUI Electron 应用，CLI 是辅助工具而非运行时 |

### 1.3 设计约束

- **纯 JS 依赖**：不使用 better-sqlite3、sharp 等原生模块（npm 全局安装无法编译）
- **ES Module**：`"type": "module"`，Node 22 原生 ESM；chalk v5/ora v8 需要 ESM
- **独立配置目录**：CLI 使用 `~/.chainlesschain/`，与 Electron userData 分离
- **无 daemon**：ChainlessChain 是 GUI 应用，Docker 处理后端持久化

## 2. 架构设计

### 2.1 目录结构

```
packages/cli/
├── bin/chainlesschain.js          # 入口 (#!/usr/bin/env node)
├── src/
│   ├── index.js                   # Commander 程序，注册所有命令
│   ├── constants.js               # Release URL、端口、版本、默认配置
│   ├── commands/                  # 34 个命令模块
│   │   ├── setup.js               # 交互式安装向导
│   │   ├── start.js               # 启动应用 (--headless)
│   │   ├── stop.js                # 停止应用 (--services, --all)
│   │   ├── status.js              # 状态报告
│   │   ├── services.js            # Docker Compose 管理
│   │   ├── config.js              # 配置 CRUD
│   │   ├── update.js              # 更新管理
│   │   ├── doctor.js              # 环境诊断
│   │   ├── db.js                  # 数据库管理 (init/info/backup/restore)
│   │   ├── note.js                # 笔记管理 (add/list/show/search/delete/history/diff/revert)
│   │   ├── chat.js                # 交互式 AI 对话 (流式输出)
│   │   ├── ask.js                 # 单次 AI 问答 (非交互)
│   │   ├── llm.js                 # LLM 管理 (models/test/providers/add-provider/switch)
│   │   ├── agent.js               # Agentic AI 会话 (Claude Code 风格)
│   │   ├── skill.js               # 技能管理 (list/info/search/run/categories)
│   │   ├── search.js              # BM25 混合搜索 (Phase 1)
│   │   ├── tokens.js              # Token 用量追踪 (Phase 1)
│   │   ├── memory.js              # 持久记忆管理 (Phase 1)
│   │   ├── session.js             # 会话管理 (Phase 1)
│   │   ├── import.js              # 知识导入 (Markdown/Evernote/Notion/PDF) (Phase 2)
│   │   ├── export.js              # 知识导出 (Markdown/静态站点) (Phase 2)
│   │   ├── git.js                 # Git 集成 (status/init/auto-commit/hooks) (Phase 2)
│   │   ├── mcp.js                 # MCP 服务器管理 (JSON-RPC 2.0) (Phase 3)
│   │   ├── browse.js              # 浏览器自动化 (fetch/scrape/screenshot) (Phase 3)
│   │   ├── instinct.js            # 本能学习管理 (show/reset/decay) (Phase 3)
│   │   ├── p2p.js                 # P2P 消息 (status/peers/send/inbox/pair) (Phase 5)
│   │   ├── sync.js                # 文件同步 (push/pull/conflicts/resolve) (Phase 5)
│   │   ├── wallet.js              # 数字钱包 (create/balance/asset/transfer) (Phase 5)
│   │   ├── org.js                 # 组织管理 (create/invite/team/approval) (Phase 5)
│   │   └── plugin.js              # 插件市场 (install/remove/enable/search) (Phase 5)
│   ├── repl/                      # REPL 交互系统
│   │   ├── chat-repl.js           # 流式对话 REPL (多轮会话)
│   │   └── agent-repl.js          # Agentic REPL (8 工具 + 138 技能)
│   ├── runtime/                   # 无头运行时
│   │   └── bootstrap.js           # 7 阶段无头初始化引导
│   └── lib/                       # 34 个库模块
│       ├── platform.js            # OS/arch 检测，二进制名称映射
│       ├── paths.js               # ~/.chainlesschain/ 路径解析
│       ├── downloader.js          # GitHub Release 下载 + SHA256 校验
│       ├── process-manager.js     # 通过 PID 文件管理 Electron 进程
│       ├── service-manager.js     # Docker Compose 编排
│       ├── config-manager.js      # config.json 读写（兼容 InitialSetupConfig）
│       ├── version-checker.js     # GitHub API 版本比较
│       ├── logger.js              # 控制台日志 (--verbose/--quiet)
│       ├── prompts.js             # 交互式提示封装
│       ├── checksum.js            # SHA256 校验
│       ├── bm25-search.js         # BM25 关键词搜索引擎 (Phase 1)
│       ├── token-tracker.js       # Token 用量追踪 + 多 Provider 费率 (Phase 1)
│       ├── response-cache.js      # LLM 响应缓存 (SHA256 哈希) (Phase 1)
│       ├── session-manager.js     # 会话持久化 + Markdown 导出 (Phase 1)
│       ├── memory-manager.js      # 持久记忆 + 每日笔记 (Phase 1)
│       ├── plan-mode.js           # Agent Plan Mode 规划模式 (Phase 1)
│       ├── knowledge-importer.js  # ENEX/Notion/Markdown/PDF 知识导入 (Phase 2)
│       ├── knowledge-exporter.js  # Markdown/HTML 站点知识导出 (Phase 2)
│       ├── note-versioning.js     # 笔记版本控制 (LCS diff) (Phase 2)
│       ├── git-integration.js     # Git 操作封装 (Phase 2)
│       ├── pdf-parser.js          # 内置 PDF 文本提取 (Phase 2)
│       ├── mcp-client.js          # MCP 客户端 (JSON-RPC 2.0 over stdio) (Phase 3)
│       ├── llm-providers.js       # 7 内置 LLM Provider 注册 (Phase 3)
│       ├── browser-automation.js  # 浏览器自动化 (fetch + CSS 选择器) (Phase 3)
│       ├── instinct-manager.js    # 本能学习 (渐近置信度增长) (Phase 3)
│       ├── did-manager.js         # DID 身份管理 (Ed25519 密钥对) (Phase 4)
│       ├── crypto-manager.js      # AES-256-GCM 文件加密 (Phase 4)
│       ├── permission-engine.js   # RBAC 权限引擎 (Phase 4)
│       ├── audit-logger.js        # 审计日志 (风险评估 + 脱敏) (Phase 4)
│       ├── p2p-manager.js         # P2P 消息 + 设备配对 + Bridge (Phase 5)
│       ├── sync-manager.js        # 文件同步 + 冲突检测/解决 (Phase 5)
│       ├── wallet-manager.js      # Ed25519 钱包 + 资产管理 + 转账 (Phase 5)
│       ├── org-manager.js         # 组织 + 团队 + 审批工作流 (Phase 5)
│       └── plugin-manager.js      # 插件生命周期 + 注册表/市场 (Phase 5)
├── __tests__/
│   ├── unit/                      # 单元测试文件
│   ├── integration/               # 集成测试文件
│   └── e2e/                       # 端到端测试文件
├── vitest.config.js
├── package.json
└── README.md
```

### 2.2 依赖关系

```
bin/chainlesschain.js
  └─ src/index.js (Commander)
       │
       │  ── 系统管理命令 ──────────────────────┐
       ├─ commands/setup.js                     │
       ├─ commands/start.js                     │
       ├─ commands/stop.js                      ├─► lib/platform.js
       ├─ commands/status.js                    │   lib/paths.js
       ├─ commands/services.js                  │   lib/config-manager.js
       ├─ commands/config.js                    │   lib/downloader.js
       ├─ commands/update.js                    │   lib/process-manager.js
       └─ commands/doctor.js ───────────────────┘   lib/service-manager.js
       │                                            lib/version-checker.js
       │  ── 无头命令 (Headless) ───────────────┐   lib/checksum.js
       ├─ commands/db.js ──────► runtime/bootstrap.js   lib/logger.js
       ├─ commands/note.js ────► runtime/bootstrap.js   lib/prompts.js
       ├─ commands/chat.js ────► repl/chat-repl.js
       ├─ commands/ask.js                       │
       ├─ commands/llm.js                       │
       ├─ commands/agent.js ───► repl/agent-repl.js
       └─ commands/skill.js ───────────────────┘
       │
       │  ── Phase 1 AI智能层 ─────────────────┐
       ├─ commands/search.js ──► lib/bm25-search.js
       ├─ commands/tokens.js ──► lib/token-tracker.js
       │                         lib/response-cache.js
       ├─ commands/memory.js ──► lib/memory-manager.js
       ├─ commands/session.js ─► lib/session-manager.js
       │                                        │
       │  ── Agent 增强 ───────────────────────┤
       └─ repl/agent-repl.js ─► lib/plan-mode.js
       │
       │  ── Phase 2 知识管理 ─────────────────┐
       ├─ commands/import.js ──► lib/knowledge-importer.js
       │                         lib/pdf-parser.js
       ├─ commands/export.js ──► lib/knowledge-exporter.js
       ├─ commands/git.js ─────► lib/git-integration.js
       │                                        │
       │  ── Phase 3 MCP与外部集成 ────────────┤
       ├─ commands/mcp.js ─────► lib/mcp-client.js
       ├─ commands/browse.js ──► lib/browser-automation.js
       ├─ commands/instinct.js ► lib/instinct-manager.js
       └─ commands/llm.js ─────► lib/llm-providers.js (增强)
       │
       │  ── Phase 4 安全与身份 ──────────────┤
       ├─ commands/did.js ────► lib/did-manager.js
       ├─ commands/encrypt.js ► lib/crypto-manager.js
       ├─ commands/auth.js ───► lib/permission-engine.js
       └─ commands/audit.js ──► lib/audit-logger.js
       │
       │  ── Phase 5 P2P与企业 ──────────────┤
       ├─ commands/p2p.js ────► lib/p2p-manager.js
       ├─ commands/sync.js ───► lib/sync-manager.js
       ├─ commands/wallet.js ─► lib/wallet-manager.js
       ├─ commands/org.js ────► lib/org-manager.js
       └─ commands/plugin.js ─► lib/plugin-manager.js
```

**核心包依赖**（无头命令使用 monorepo 内部包）：

```
@chainlesschain/core-env     # 运行环境检测
@chainlesschain/core-config  # 配置加载
@chainlesschain/core-db      # SQLite 数据库操作
@chainlesschain/core-infra   # DI 容器、事件总线
@chainlesschain/shared-logger # 共享日志
```

### 2.3 技术栈

| 组件     | 选型              | 版本 | 理由                   |
| -------- | ----------------- | ---- | ---------------------- |
| CLI 框架 | commander         | ^12  | 成熟、轻量、零原生依赖 |
| 交互提示 | @inquirer/prompts | ^7   | ESM 原生、类型友好     |
| 颜色输出 | chalk             | ^5   | ESM only、零依赖       |
| 进度指示 | ora               | ^8   | spinner + 进度条       |
| 版本比较 | semver            | ^7   | npm 标准               |

## 3. 核心模块设计

### 3.1 平台检测 (platform.js)

```js
getPlatform(); // → 'win32' | 'darwin' | 'linux'
getArch(); // → 'x64' | 'arm64'
getBinaryName(v); // → 'chainlesschain-desktop-vue-{v}-win-x64.exe'
```

二进制命名映射表：

| 平台   | 架构  | 文件名模板                                     |
| ------ | ----- | ---------------------------------------------- |
| win32  | x64   | `chainlesschain-desktop-vue-{v}-win-x64.exe`   |
| darwin | x64   | `chainlesschain-desktop-vue-{v}-mac-x64.dmg`   |
| darwin | arm64 | `chainlesschain-desktop-vue-{v}-mac-arm64.dmg` |
| linux  | x64   | `chainlesschain-desktop-vue-{v}-linux-x64.deb` |

### 3.2 路径管理 (paths.js)

```
~/.chainlesschain/
├── config.json        # 配置文件
├── bin/               # 下载的二进制
├── state/             # 运行状态
│   └── app.pid        # 桌面应用 PID
├── services/          # 服务配置
├── logs/              # CLI 日志
└── cache/             # 下载缓存
```

与 Electron userData 的路径映射：

| 路径 | CLI                             | Electron (Win)                                                     | Electron (Mac)                                                                         |
| ---- | ------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| 配置 | `~/.chainlesschain/config.json` | `%APPDATA%/chainlesschain-desktop-vue/.chainlesschain/config.json` | `~/Library/Application Support/chainlesschain-desktop-vue/.chainlesschain/config.json` |

### 3.3 配置管理 (config-manager.js)

配置结构与 `desktop-app-vue/src/main/config/initial-setup-config.js` 兼容：

```json
{
  "setupCompleted": true,
  "completedAt": "2026-03-11T00:00:00.000Z",
  "edition": "personal | enterprise",
  "llm": {
    "provider": "ollama | openai | dashscope | deepseek | custom",
    "apiKey": "string | null",
    "baseUrl": "string",
    "model": "string"
  },
  "enterprise": {
    "serverUrl": "string | null",
    "apiKey": "string | null",
    "tenantId": "string | null"
  },
  "services": {
    "autoStart": false,
    "dockerComposePath": "string | null"
  },
  "update": {
    "channel": "stable | beta | dev",
    "autoCheck": true
  }
}
```

**配置优先级**：环境变量 > config.json > 默认值

**API**：

- `loadConfig()` — 读取并合并默认值
- `saveConfig(config)` — 写入 JSON
- `getConfigValue(key)` — 点号路径读取（如 `llm.provider`）
- `setConfigValue(key, value)` — 点号路径写入，自动类型转换

### 3.4 下载管理 (downloader.js)

```
GitHub Release API → 解析 asset URL → fetch 下载 → 流式写入 → SHA256 校验
```

**流程**：

1. 通过 `GITHUB_RELEASES_URL/tags/v{version}` 获取 release 信息
2. 匹配平台对应的 asset（`getBinaryName()` 生成文件名）
3. 使用 `fetch()` 流式下载，实时显示进度
4. 可选 SHA256 校验（`verifySha256()`）
5. 写入 `~/.chainlesschain/bin/`

### 3.5 进程管理 (process-manager.js)

```
startApp() → spawn(detached) → 写 PID 文件
stopApp()  → 读 PID → SIGTERM (Unix) / taskkill (Windows) → 删 PID 文件
isAppRunning() → 读 PID → process.kill(pid, 0) 探测
```

### 3.6 服务管理 (service-manager.js)

封装 `docker compose` / `docker-compose` 命令：

- `servicesUp(composePath)` — `docker compose -f {path} up -d`
- `servicesDown(composePath)` — `docker compose -f {path} down`
- `servicesLogs(composePath, opts)` — 流式日志
- `getServiceStatus(composePath)` — JSON 格式服务状态

自动检测 `docker compose` v2 或 `docker-compose` v1。

## 4. 命令设计

### 4.1 setup — 安装向导

```
chainlesschain setup [--skip-download] [--skip-services]
```

**交互流程**：

```
1. [检查] Node.js >= 22.12.0
2. [检查] Docker 可用性
3. [选择] 版本：个人版 / 企业版
4. [选择] LLM 提供商
5. [输入] API Key（云端提供商）
6. [下载] 平台二进制文件
7. [保存] ~/.chainlesschain/config.json
8. [可选] 启动 Docker 服务
```

### 4.2 doctor — 环境诊断

检查项：Node.js、npm、Docker、Docker Compose、Git、配置目录、配置文件、二进制文件、Setup 状态、端口占用、磁盘空间。

### 4.3 命令总览

#### 系统管理命令

| 命令       | 说明        | 关键选项                              |
| ---------- | ----------- | ------------------------------------- |
| `setup`    | 交互式安装  | `--skip-download`, `--skip-services`  |
| `start`    | 启动应用    | `--headless`, `--services`            |
| `stop`     | 停止应用    | `--services`, `--all`                 |
| `status`   | 状态报告    | —                                     |
| `services` | Docker 管理 | `up`, `down`, `logs`, `pull`          |
| `config`   | 配置管理    | `list`, `get`, `set`, `edit`, `reset` |
| `update`   | 更新管理    | `--check`, `--channel`, `--force`     |
| `doctor`   | 环境诊断    | —                                     |

#### 无头命令（Headless，无需 GUI）

| 命令       | 说明            | 子命令 / 关键选项                                                  |
| ---------- | --------------- | ------------------------------------------------------------------ |
| `db`       | 数据库管理      | `init`, `info`, `backup`, `restore` / `--json`                     |
| `note`     | 笔记管理        | `add`, `list`, `show`, `search`, `delete`, `history`, `diff`, `revert` |
| `chat`     | 交互式 AI 对话  | `--model`, `--provider`, `--agent`                                 |
| `ask`      | 单次 AI 问答    | `<question>` / `--model`, `--provider`, `--json`                   |
| `llm`      | LLM 管理        | `models`, `test`, `providers`, `add-provider`, `switch`            |
| `agent`    | Agentic AI 会话 | `--model`, `--provider`, `--base-url`, `--api-key`                 |
| `skill`    | 技能管理与执行  | `list`, `info`, `search`, `run`, `categories`                      |
| `search`   | BM25 混合搜索   | `<query>` / `--mode`, `--top-k`, `--json`                         |
| `tokens`   | Token 用量追踪  | `show`, `breakdown`, `recent`, `cache`                             |
| `memory`   | 持久记忆管理    | `show`, `add`, `search`, `delete`, `daily`, `file`                 |
| `session`  | 会话管理        | `list`, `show`, `resume`, `export`, `delete`                       |
| `import`   | 知识导入        | `markdown`, `evernote`, `notion`, `pdf`                            |
| `export`   | 知识导出        | `markdown`, `site` / `--output`                                    |
| `git`      | Git 集成        | `status`, `init`, `auto-commit`, `hooks`, `history-analyze`        |
| `mcp`      | MCP 服务器管理  | `servers`, `add`, `remove`, `connect`, `disconnect`, `tools`, `call` |
| `browse`   | 浏览器自动化    | `fetch`, `scrape`, `screenshot` / `--selector`                     |
| `instinct` | 本能学习管理    | `show`, `categories`, `prompt`, `delete`, `reset`, `decay`         |
| `did`      | DID 身份管理    | `create`, `show`, `list`, `resolve`, `sign`, `verify`, `export`, `set-default`, `delete` |
| `encrypt`  | 文件加密/解密   | `file`, `db`, `info`, `status` + `decrypt` (`file`, `db`)         |
| `auth`     | RBAC 权限管理   | `roles`, `create-role`, `delete-role`, `grant`, `revoke`, `grant-permission`, `revoke-permission`, `check`, `permissions`, `users`, `scopes` |
| `audit`    | 审计日志        | `log`, `search`, `stats`, `export`, `purge`, `types`              |
| `p2p`      | P2P 消息        | `status`, `peers`, `send`, `inbox`, `pair`, `devices`, `unpair`   |
| `sync`     | 文件同步        | `status`, `push`, `pull`, `conflicts`, `resolve`, `log`, `clear`  |
| `wallet`   | 数字钱包        | `create`, `list`, `balance`, `set-default`, `delete`, `asset`, `assets`, `transfer`, `history`, `summary` |
| `org`      | 组织管理        | `create`, `list`, `show`, `delete`, `invite`, `members`, `team-create`, `teams`, `approval-submit`, `approvals`, `approve`, `reject` |
| `plugin`   | 插件市场        | `list`, `install`, `remove`, `enable`, `disable`, `update`, `info`, `search`, `registry`, `summary` |

### 4.4 无头命令详细设计

#### 4.4.1 db — 数据库管理

```
chainlesschain db init [--path <dbPath>] [--force]    # 初始化数据库
chainlesschain db info [--json]                        # 数据库信息（路径、加密、表数）
chainlesschain db backup [--output <path>]             # 创建时间戳备份
chainlesschain db restore <backupFile>                 # 从备份恢复（需确认）
```

通过 `bootstrap()` 初始化 `@chainlesschain/core-db`，支持 SQLite/SQLCipher。

#### 4.4.2 note — 笔记管理

```
chainlesschain note add <title> [-c <content>] [-t <tags>] [--category <cat>]
chainlesschain note list [--category <cat>] [--tag <tag>] [-n <limit>] [--json]
chainlesschain note show <id>                          # 支持 ID 前缀匹配
chainlesschain note search <query> [--json]            # 全文搜索（标题 + 内容）
chainlesschain note delete <id>                        # 软删除（需确认）
```

直接操作 SQLite `notes` 表，UUID 主键，软删除（`deleted_at` 字段）。

#### 4.4.3 chat — 交互式 AI 对话

```
chainlesschain chat [--model <model>] [--provider <provider>] [--agent]
```

- 默认模式：流式多轮对话，基于 `chat-repl.js`
- `--agent` 模式：切换到 Agentic REPL，AI 可读写文件、执行命令
- 会话内命令：`/exit`, `/model`, `/provider`, `/clear`, `/history`, `/help`

#### 4.4.4 ask — 单次 AI 问答

```
chainlesschain ask "你的问题" [--model <model>] [--provider <provider>] [--json]
```

发送单次查询到 LLM，无对话历史。支持 Ollama (`/api/generate`) 和 OpenAI (`/chat/completions`) 两种后端。

#### 4.4.5 llm — LLM 管理

```
chainlesschain llm models [--provider <provider>]      # 列出已安装模型
chainlesschain llm test [--model <model>]              # 测试连通性和响应时间
```

- `models`：Ollama 调用 `/api/tags`，显示模型名称和大小
- `test`：发送测试提示，返回响应时间（毫秒）

#### 4.4.6 agent — Agentic AI 会话

```
chainlesschain agent [--model <model>] [--provider <provider>]
```

别名 `a`。Claude Code 风格的 AI 助手，用户描述任务后 AI 自动使用工具完成。

**内置 8 个工具**：

| 工具           | 说明                          |
| -------------- | ----------------------------- |
| `read_file`    | 读取文件（大文件截断至 50KB） |
| `write_file`   | 创建/覆盖文件（自动创建目录） |
| `edit_file`    | 查找替换编辑                  |
| `run_shell`    | 执行 Shell 命令（30s 超时）   |
| `search_files` | 按文件名或内容搜索            |
| `list_dir`     | 列出目录内容                  |
| `run_skill`    | 执行内置技能（模糊匹配名称）  |
| `list_skills`  | 列出可用技能                  |

Agentic 循环最多 10 次迭代，防止无限递归。会话命令支持 `/compact`（仅保留最近 4 条消息）。

#### 4.4.7 skill — 技能管理

```
chainlesschain skill list [--category <cat>] [--tag <tag>] [--runnable]
chainlesschain skill info <name>                       # 技能详情与文档
chainlesschain skill search <query>                    # 关键字搜索
chainlesschain skill run <name> [input...]             # 执行技能 handler
chainlesschain skill categories                        # 列出所有分类及数量
```

- 按分类分组显示，标记 handler 可用性（● 有 handler / ○ 仅文档）
- `run` 命令从 `skills/builtin/{skillName}/handler.js` 加载并执行
- 解析 SKILL.md 中的 YAML frontmatter 获取技能元数据

### 4.5 REPL 系统设计

#### 4.5.1 chat-repl.js — 流式对话 REPL

- **流式输出**：逐 token 渲染，支持 Ollama (`/api/chat`) 和 OpenAI (`/chat/completions`) SSE
- **多轮对话**：维护 `messages[]` 数组（role/content 格式）
- **会话命令**：`/exit`, `/quit`, `/model`, `/provider`, `/clear`, `/history`, `/help`
- **实现**：`response.body.getReader()` 解析 Server-Sent Events

#### 4.5.2 agent-repl.js — Agentic REPL

- **Agentic 循环**：LLM 返回 `tool_calls` → 执行工具 → 返回结果 → 继续循环
- **系统提示**：包含当前工作目录和 138 技能列表
- **工具格式**：`[tool_name] param1 param2` 显示调用过程
- **安全限制**：Shell 命令 30s 超时、输出截断 10KB、循环上限 10 次

### 4.6 无头运行时引导（bootstrap.js）

7 阶段初始化流程，为无头命令提供核心服务：

```
阶段 1: 环境检测 → @chainlesschain/core-env（平台、路径、目录创建）
阶段 2: 路径解析 → config/data/logs 目录
阶段 3: 日志初始化 → shared-logger 或 CLI logger 降级
阶段 4: 配置加载 → @chainlesschain/core-config（app-config.json）
阶段 5: 数据库初始化 → @chainlesschain/core-db（可选，skipDb 跳过）
阶段 6: 服务容器 → @chainlesschain/core-infra（DI 注册 db/config）
阶段 7: 事件总线激活 → 事件驱动就绪
```

返回 context 对象：`{ env, config, db, container, eventBus, initialized }`

单例缓存，多次调用不重复初始化。缺失核心包时优雅降级（context 字段为 null）。

## 5. CI/CD 集成

### 5.1 npm 自动发布

在 `.github/workflows/release.yml` 的 `create-release` 后执行 `publish-cli` job：

```yaml
publish-cli:
  needs: [create-release]
  steps:
    - Setup Node.js + registry-url: npmjs.org
    - npm ci + vitest run (测试通过)
    - 从 git tag 同步 package.json 版本
    - 检查版本是否已发布（避免重复）
    - npm publish --provenance --access public
```

**安全措施**：

- `--provenance` 启用 npm 供应链安全证明
- 版本重复检查防止发布冲突
- 兼容 tag push 和 `workflow_dispatch` 两种触发方式

### 5.2 CI 测试

`.github/workflows/cli-ci.yml`：

- **触发**：`packages/cli/**` 路径变更时
- **矩阵**：Ubuntu + Windows + macOS
- **测试**：unit → integration → E2E
- **PR 检查**：`npm publish --dry-run` 验证包结构

## 6. 测试策略

### 6.1 测试分层

| 层次     | 文件数 | 覆盖范围                                                                                                                       |
| -------- | ------ | ------------------------------------------------------------------------------------------------------------------------------ |
| 单元测试 | 38     | platform, paths, config-manager, checksum, service-manager, bm25-search, token-tracker, response-cache, session-manager, memory-manager, plan-mode, knowledge-importer, knowledge-exporter, note-versioning, git-integration, pdf-parser, mcp-client, llm-providers, browser-automation, instinct-manager, did-manager, crypto-manager, permission-engine, audit-logger, p2p-manager, sync-manager, wallet-manager, org-manager, plugin-manager, command-registration, skill, project-detector, skill-loader, cowork-adapter, debate-review-cli, ab-comparator-cli, code-knowledge-graph-cli, plugin-skills |
| 集成测试 | 3      | setup-flow, update-flow, service-lifecycle                                                                                     |
| E2E 测试 | 14     | cross-platform, headless-commands, init-and-cowork-commands, phase1-commands, phase2-commands, phase3-commands, phase4-commands, phase5-commands + 3 core |
| **合计** | **55** | **1009 tests** (全部通过)                                                                                                      |

### 6.2 测试工具

- **Vitest** — ES module 原生支持
- `vi.doMock()` — 延迟模块 mock（避免 ESM 提升问题）
- `vi.stubGlobal('fetch', ...)` — mock 网络请求
- 临时目录 (`mkdtempSync`) — 隔离文件系统操作

## 7. 版本策略

CLI 版本与主项目版本同步（当前 `0.37.9`）。Release workflow 自动从 git tag 提取版本号写入 `package.json`。

更新通道：

- **stable** — 仅正式版
- **beta** — 包含预发布版
- **dev** — 包含所有版本（含草稿）

## 8. 设计决策记录

| 决策                                          | 理由                                               |
| --------------------------------------------- | -------------------------------------------------- |
| 纯 JS CLI，二进制延迟到 setup 下载            | npm 全局安装无法编译原生模块                       |
| 不引入 daemon/launchd/systemd                 | ChainlessChain 是 GUI 应用，Docker 处理后端持久化  |
| `~/.chainlesschain/` 独立于 Electron userData | CLI 无需 Electron 即可工作；setup 可种子化两个位置 |
| ES Modules (`"type": "module"`)               | Node 22 原生 ESM，chalk v5/ora v8 要求             |
| GitHub Releases 作为二进制源                  | 已使用 electron-builder + GitHub publishing        |
| 无头命令通过 monorepo core-\* 包复用桌面逻辑  | 避免重复实现 DB/Config 逻辑，保持一致性            |
| Agentic REPL 内置 8 工具而非调用外部 API      | 纯本地执行，无需网络依赖（LLM 除外）               |
| 7 阶段引导 + 单例缓存                         | 无头命令按需初始化，避免不必要的 DB 连接           |
| 流式 SSE 解析用于 chat/agent                  | 实时输出提升交互体验，避免等待完整响应             |
| MCP 客户端纯 JSON-RPC 实现                    | 避免引入 @modelcontextprotocol/sdk (~500KB)        |
| PDF 解析内置 Tj/TJ 扫描                       | 避免引入 pdf-parse 等外部依赖                      |
| 浏览器自动化基于 fetch + 正则                  | playwright 仅截图可选，核心功能零外部依赖          |
| 笔记版本控制使用 LCS diff                     | 纯 JS 实现，无需外部 diff 库                       |

## 9. Phase 2: 知识与内容管理

### 9.1 知识导入 (knowledge-importer.js)

支持 4 种格式导入：

| 格式       | 实现方式                                    | 特点                            |
| ---------- | ------------------------------------------- | ------------------------------- |
| Markdown   | YAML frontmatter 解析 + 内容提取            | 支持标题/标签/分类元数据        |
| Evernote   | ENEX XML 解析（`<note>` + CDATA HTML 内容） | HTML 转纯文本，保留标签         |
| Notion     | 目录递归 + UUID 后缀文件名清理              | 自动移除 32 位十六进制 UUID 后缀 |
| PDF        | 内置 PDF 流解析（Tj/TJ 文本运算符）         | 零外部依赖，基础文本提取        |

### 9.2 知识导出 (knowledge-exporter.js)

| 导出格式    | 输出内容                              | 特点                                    |
| ----------- | ------------------------------------- | --------------------------------------- |
| Markdown    | 每笔记一个 `.md` 文件 + YAML frontmatter | 保留标题/标签/分类/日期元数据           |
| 静态 HTML   | `index.html` + `style.css` + 每笔记页面  | 完整 CSS 主题，可直接部署为静态站点     |

### 9.3 笔记版本控制 (note-versioning.js)

- **存储**: `note_versions` 表 (id, note_id, version, title, content, tags, category, change_type, created_at)
- **版本号**: 自增，每笔记独立计数
- **Diff 算法**: LCS (Longest Common Subsequence) 逐行比较
- **Revert**: 先保存当前状态为新版本，再应用目标版本
- **change_type**: `create` | `edit` | `revert`

### 9.4 Git 集成 (git-integration.js)

封装系统 `git` 命令，不引入 isomorphic-git 等库：

- `gitStatus()` — 使用 `--porcelain` 保留原始格式解析
- `gitAutoCommit()` — 自动生成包含文件数和时间戳的提交信息
- `gitHistoryAnalyze()` — 分析总提交数、贡献者、首/末提交时间、追踪文件数

## 10. Phase 3: MCP 与外部集成

### 10.1 MCP 客户端 (mcp-client.js)

纯 JS 实现 JSON-RPC 2.0 over stdio 传输协议：

**MCPClient 类** (extends EventEmitter):
- 管理多个 MCP 服务器连接 (name → { process, state, tools, resources })
- `connect(name, config)` → spawn 子进程 → initialize 握手 → 获取 tools/resources 列表
- `callTool(server, tool, args)` → JSON-RPC request → 等待 response
- 30s 请求超时，自动清理 pending requests

**MCPServerConfig 类**:
- `mcp_servers` 数据库表持久化服务器配置
- 支持 `auto_connect` 标记自动连接服务器

**服务器状态**: `disconnected` → `connecting` → `connected` | `error`

### 10.2 LLM 多 Provider (llm-providers.js)

7 个内置 Provider：

| Provider   | baseUrl                       | 认证                    |
| ---------- | ----------------------------- | ----------------------- |
| Ollama     | http://localhost:11434        | 无需                    |
| OpenAI     | https://api.openai.com        | OPENAI_API_KEY          |
| Anthropic  | https://api.anthropic.com     | ANTHROPIC_API_KEY       |
| DeepSeek   | https://api.deepseek.com      | DEEPSEEK_API_KEY        |
| DashScope  | https://dashscope.aliyuncs.com| DASHSCOPE_API_KEY       |
| Gemini     | https://generativelanguage.googleapis.com | GEMINI_API_KEY |
| Mistral    | https://api.mistral.ai        | MISTRAL_API_KEY         |

**LLMProviderRegistry 类**: 数据库持久化 active provider，支持自定义 provider 注册。

### 10.3 浏览器自动化 (browser-automation.js)

基于 `fetch` 的轻量实现：

- `fetchPage(url)` — 获取 HTML 内容
- `extractText(html)` — 正则移除标签提取纯文本
- `querySelectorAll(html, selector)` — 正则匹配 CSS 选择器（支持标签/class/id）
- `extractLinks(html, baseUrl)` — 提取 `<a href>` 链接
- `takeScreenshot(url)` — 可选 playwright 依赖

### 10.4 本能学习 (instinct-manager.js)

6 个类别: tool_preference, coding_style, response_format, language, workflow, behavior

- **置信度算法**: `newConf = conf + (1 - conf) × 0.1`（渐近逼近 1.0，永不到达）
- **衰减机制**: 超过 N 天未触发的本能乘以 0.9 衰减因子（最低 0.1）
- **Prompt 生成**: 将高置信度本能注入 LLM 系统提示

## 11. Phase 4: 安全与身份

### 11.1 DID 身份管理 (did-manager.js)

基于 Ed25519 的 W3C DID 去中心化身份：

- **密钥生成**: `crypto.generateKeyPairSync("ed25519")` (Node.js 内置)
- **DID 格式**: `did:chainless:<base64url(sha256(publicKey))>`
- **DID 文档**: W3C DID Core 子集，含 verificationMethod/authentication/assertionMethod
- **存储**: `did_identities` 表 (did, label, public_key, private_key, did_document, is_default, created_at)

**API**:

- `createIdentity(label)` — 生成密钥对 + DID + 文档，存入数据库
- `signMessage(did, message)` — Ed25519 签名 → base64 编码
- `verifySignature(did, message, signature)` — 签名验证
- `verifyWithDID(did, message, signature)` — 从 DID 文档解析公钥验证
- `exportIdentity(did, includePrivate)` — 导出 DID 文档和密钥

### 11.2 文件加密 (crypto-manager.js)

AES-256-GCM 认证加密：

**文件格式 (CCLC01)**:

```
┌──────────────────────────────┐
│ Magic: "CCLC01" (6 bytes)   │  格式标识和版本
├──────────────────────────────┤
│ Salt (32 bytes)              │  PBKDF2 随机盐
├──────────────────────────────┤
│ IV (12 bytes)                │  初始化向量
├──────────────────────────────┤
│ Auth Tag (16 bytes)          │  GCM 认证标签
├──────────────────────────────┤
│ Ciphertext (variable)        │  加密后数据
└──────────────────────────────┘
```

**安全参数**:

| 参数           | 值          | 说明                   |
| -------------- | ----------- | ---------------------- |
| 加密算法       | AES-256-GCM | 认证加密（AEAD）       |
| 密钥派生       | PBKDF2      | SHA-512, 100K 次迭代   |
| 盐值长度       | 32 bytes    | 每次加密随机生成       |
| IV 长度        | 12 bytes    | NIST 推荐 GCM IV 长度 |
| Auth Tag 长度  | 16 bytes    | 128 位认证标签         |

**API**:

- `encryptFile(inputPath, outputPath, password)` — 文件加密
- `decryptFile(inputPath, outputPath, password)` — 文件解密
- `isEncryptedFile(path)` — 检测是否为 CCLC01 格式
- `hashPassword(password)` / `verifyPassword(password, hash)` — 密码哈希（bcrypt 风格）

### 11.3 RBAC 权限引擎 (permission-engine.js)

基于角色的访问控制：

**4 个内置角色**:

| 角色     | 权限                                                          |
| -------- | ------------------------------------------------------------- |
| `admin`  | `*` (全部权限)                                                |
| `editor` | note:*, session:*, llm:*, skill:*, search:*, memory:*         |
| `viewer` | note:read, session:read, skill:read, search:read              |
| `agent`  | note:read, note:write, skill:run, llm:chat, search:read      |

**26 个权限范围**: note:read/write/delete, session:read/write/delete, llm:chat/manage/config, mcp:read/manage/connect, skill:read/run, search:read/manage, memory:read/write/delete, system:config/admin/audit, did:read/manage, encrypt:read/manage, auth:manage

**数据库表**:

- `roles` (id, name, description, permissions JSON, is_builtin)
- `user_roles` (id, user_id, role_id, granted_by, expires_at)
- `role_permissions` (id, role_id, scope, granted_by)

**权限检查算法**: 聚合用户所有角色权限 → 过滤过期角色 → 通配符匹配（`*` 匹配所有，`note:*` 匹配 `note:` 前缀）

### 11.4 审计日志 (audit-logger.js)

操作审计与风险评估：

**8 种事件类型**: auth, data_access, data_modify, system, security, export, import, admin

**4 个风险级别**: low, medium, high, critical

**自动风险评估规则**:

| 操作特征                          | 风险级别   |
| --------------------------------- | ---------- |
| 包含 "delete" / "drop" / "purge" | critical   |
| 包含 "admin" / "permission"      | high       |
| 包含 "create" / "modify"         | medium     |
| 默认                              | low        |

**敏感数据脱敏**: password → `***`, apiKey → `sk-***...xxx` (前3后3), privateKey/secret/token → `***`

**API**:

- `logEvent(type, operation, details, userId, riskLevel)` — 记录事件（自动风险评估和脱敏）
- `queryLogs(filters)` — 按类型/用户/时间范围查询
- `getStatistics()` — 统计信息（总数/类型分布/高风险计数）
- `exportLogs(format, filters)` — 导出 JSON/CSV
- `purgeLogs(beforeDays)` — 清理旧日志

### 11.5 设计决策 (Phase 4)

| 决策                                   | 理由                                      |
| -------------------------------------- | ----------------------------------------- |
| Ed25519 而非 RSA                       | 更短密钥(32B)、更快签名、Node.js 内置支持 |
| CCLC01 自定义格式而非 GPG             | 零外部依赖，格式简单，可自动检测          |
| PBKDF2 100K 迭代而非 Argon2           | Node.js 内置，无需 native 依赖            |
| RBAC 避免 JOIN 查询                    | 兼容 MockDatabase 测试框架                |
| 审计日志避免 IN/OR SQL                 | MockDatabase 不支持复杂 SQL，拆分为多查询 |

## 12. Phase 5: P2P、区块链与企业功能

### 12.1 P2P 消息系统 (p2p-manager.js)

P2P 点对点消息和设备配对：

**数据库表**:

- `p2p_peers` (peer_id, display_name, did, public_key, last_seen, status, device_type)
- `p2p_messages` (id, from_peer, to_peer, content, encrypted, read, created_at)
- `p2p_paired_devices` (device_id, device_name, device_type, pairing_code, paired_at, status)

**API**:

- `registerPeer(db, peerId, displayName, did, publicKey, deviceType)` — 注册/更新 peer
- `sendMessage(db, fromPeer, toPeer, content, encrypted)` — 发送消息（验证收件人）
- `getInbox(db, peerId, { unreadOnly, limit })` — 获取收件箱
- `pairDevice(db, deviceName, deviceType)` — 设备配对（6 位随机码）
- `confirmPairing(db, deviceId, code)` — 确认配对

**P2PBridge 类** (extends EventEmitter):
- HTTP 桥接到桌面应用 (`localhost:9001`)
- `checkBridge()` — 健康检查（5s 超时）

### 12.2 文件同步 (sync-manager.js)

资源同步和冲突管理：

**数据库表**:

- `sync_state` (resource_id PK, resource_type, local_version, remote_version, content_hash, status, last_synced)
- `sync_conflicts` (id, resource_id, local_content, remote_content, local_version, remote_version, status, strategy, resolved_at)
- `sync_log` (id, operation, resource_id, details, status, created_at)

**冲突解决策略**: `local` (保留本地) | `remote` (保留远程) | `manual` (手动合并)

### 12.3 数字钱包 (wallet-manager.js)

Ed25519 钱包和数字资产管理：

- **密钥生成**: `crypto.generateKeyPairSync("ed25519")` (Node.js 内置)
- **地址格式**: `0x` + SHA-256(publicKey) 前 40 位
- **私钥加密**: AES-256-GCM + PBKDF2 (100K 迭代)

**数据库表**:

- `wallets` (address PK, name, wallet_type, public_key, encrypted_key, balance, is_default)
- `digital_assets` (id, wallet_address, asset_type, name, description, metadata, amount, status)
- `transactions` (id, from_address, to_address, asset_id, amount, tx_type, status, metadata)

### 12.4 组织管理 (org-manager.js)

组织、团队和审批工作流：

**数据库表**:

- `organizations` (id, name, description, owner_id, status, created_at)
- `org_members` (id, org_id, user_id, role, status, invited_by, joined_at)
- `org_teams` (id, org_id, name, description, created_at)
- `org_team_members` (id, team_id, member_id, role, added_at)
- `approval_requests` (id, org_id, requester_id, title, description, status, reviewer_id, reviewed_at)

**审批工作流**: pending → approved / rejected

### 12.5 插件市场 (plugin-manager.js)

插件安装、管理和注册表：

**数据库表**:

- `plugins` (id, name, version, description, author, homepage, entry_point, permissions, status, enabled)
- `plugin_settings` (id, plugin_id, key, value)
- `plugin_registry` (name PK, latest_version, description, author, downloads, rating, tags)

**API**:

- `installPlugin(db, pluginInfo)` — 安装插件（记录到 DB）
- `enablePlugin/disablePlugin(db, name)` — 启停插件
- `setPluginSetting/getPluginSetting(db, pluginName, key, value)` — 插件配置
- `searchRegistry(db, query)` — 注册表搜索（名称 + 描述模糊匹配）

### 12.6 设计决策 (Phase 5)

| 决策                                   | 理由                                      |
| -------------------------------------- | ----------------------------------------- |
| P2P 桥接而非内嵌 libp2p              | 避免 ~15MB 依赖，CLI 保持轻量            |
| 钱包 Ed25519 而非 secp256k1           | 与 DID 模块复用同一密钥类型，Node.js 内置 |
| 组织审批为本地工作流                   | 无需外部服务，可离线使用                  |
| 插件 DB 注册而非文件系统扫描          | 启停状态持久化，设置可查询                |
| 同步采用版本号而非时间戳              | 避免时钟偏移问题                          |

## 13. Phase 102: CLI 功能补齐 — 项目初始化 + 多层技能 + 多智能体协作

### 13.1 概述

将桌面版的项目初始化、4 层技能系统、多智能体协作(cowork)等核心功能移植到 CLI，使 CLI 从纯管理工具升级为完整的开发者工作台。新增 10 个源文件、修改 5 个现有文件、新增 8 个测试文件（共 106 个新测试），CLI 总测试数从 903 提升至 1009。

### 13.2 新增模块

#### 13.2.1 项目初始化 (`init` 命令)

**文件**: `src/commands/init.js`, `src/lib/project-detector.js`

```bash
chainlesschain init [--template <name>] [--yes] [--bare]
```

- 4 种模板: `code-project`, `data-science`, `devops`, 空项目
- 生成目录结构: `.chainlesschain/config.json` + `rules.md` + `skills/`
- `project-detector.js` 提供 `findProjectRoot()`, `loadProjectConfig()`, `isInsideProject()` 工具函数
- 向上遍历目录树查找 `.chainlesschain/config.json`

#### 13.2.2 多层技能系统 (4 层优先级)

**文件**: `src/lib/skill-loader.js`

| 层 | 优先级 | 路径 | 用途 |
|---|--------|------|------|
| bundled | 0 (最低) | `desktop-app-vue/.../skills/builtin/` | 138 内置技能 |
| marketplace | 1 | `<userData>/marketplace/skills/` | 插件安装的技能 |
| managed | 2 | `<userData>/skills/` | 用户全局自定义技能 |
| workspace | 3 (最高) | `<projectRoot>/.chainlesschain/skills/` | 项目级自定义技能 |

- `CLISkillLoader` 类: `getLayerPaths()`, `loadAll()`, `getResolvedSkills()`, `clearCache()`
- 同名技能按优先级覆盖（workspace > managed > marketplace > bundled）
- 每个技能包含 `source` 字段标识来源层

**新增 skill 子命令**:

```bash
chainlesschain skill add <name> [--global]     # 创建自定义技能
chainlesschain skill remove <name> [--global]  # 删除自定义技能
chainlesschain skill sources [--json]          # 显示各层路径和技能数量
chainlesschain skill list --source bundled     # 按来源层过滤
```

#### 13.2.3 插件技能集成

**修改文件**: `src/lib/plugin-manager.js`, `src/commands/plugin.js`

- 新增 `plugin_skills` 数据库表记录插件-技能关联
- `installPluginSkills(db, pluginName, pluginPath, skills)` — 安装时复制技能到 marketplace
- `removePluginSkills(db, pluginName)` — 卸载时清理技能
- `plugin install --manifest <path>` 支持安装包含技能的插件

#### 13.2.4 多智能体协作 (cowork 命令)

**文件**: `src/commands/cowork.js`, `src/lib/cowork-adapter.js`, `src/lib/cowork/*.js`

```bash
chainlesschain cowork debate <file> [--perspectives perf,security,maintain]
chainlesschain cowork compare <prompt> [--variants 3] [--criteria quality,performance]
chainlesschain cowork analyze <path> [--type style|knowledge-graph|decisions]
chainlesschain cowork status
```

**核心模块**:

- **cowork-adapter.js** — LLM 适配器，支持 Ollama/Anthropic/OpenAI 兼容 provider
- **debate-review-cli.js** — 多视角辩论审查 (5 内置视角: performance/security/maintainability/correctness/architecture)
- **ab-comparator-cli.js** — A/B 方案对比 (4 变体风格: conservative/innovative/pragmatic/performance-focused)
- **code-knowledge-graph-cli.js** — 静态代码分析 (无需 LLM，提取 imports/exports/classes/functions)
- **decision-kb-cli.js** — LLM 驱动的架构决策记录提取
- **project-style-analyzer-cli.js** — LLM 驱动的项目风格分析

#### 13.2.5 Agent REPL 集成

**修改文件**: `src/repl/agent-repl.js`

- 替换内联技能加载为 `CLISkillLoader`，支持全部 4 层技能
- 新增 `/cowork debate <file>` 和 `/cowork compare <prompt>` 斜杠命令

### 13.3 测试覆盖

| 测试文件 | 类型 | 测试数 | 覆盖范围 |
|----------|------|--------|----------|
| project-detector.test.js | 单元 | 7 | findProjectRoot, loadProjectConfig, isInsideProject |
| skill-loader.test.js | 单元 | 17 | parseSkillMd, CLISkillLoader, 4 层加载 |
| cowork-adapter.test.js | 单元 | 12 | createChatFn (Ollama/Anthropic/OpenAI), coworkLogger |
| debate-review-cli.test.js | 单元 | 9 | startDebate, 多视角审查, LLM mock |
| ab-comparator-cli.test.js | 单元 | 9 | compare, A/B 对比, 评分排名 |
| code-knowledge-graph-cli.test.js | 单元 | 9 | buildKnowledgeGraph, JS/TS/CJS 分析 |
| plugin-skills.test.js | 单元 | 11 | installPluginSkills, removePluginSkills, getPluginSkills |
| init-and-cowork-commands.test.js | E2E | 21 | init --bare/--template, skill add/remove/sources, cowork help/status |
| **合计** | | **95** | |

### 13.4 设计决策

| 决策 | 理由 |
|------|------|
| 4 层优先级覆盖而非合并 | 与桌面版一致，workspace 最高优先级覆盖同名技能 |
| cowork 模块独立于桌面版 | CLI 使用轻量 fetch-based LLM 调用，无需 Electron 依赖 |
| code-knowledge-graph 无需 LLM | 纯静态分析（正则提取），可离线使用 |
| project-detector 向上遍历 | 与 git 的 `.git` 查找逻辑一致，用户无需指定路径 |
| 插件技能复制到 marketplace 层 | 避免插件目录变动影响技能可用性 |
