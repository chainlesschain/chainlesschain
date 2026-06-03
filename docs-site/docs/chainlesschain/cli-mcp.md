# MCP 服务器管理 (mcp)

> Model Context Protocol 服务器配置、连接管理与工具调用。通过 MCP 协议扩展 AI 能力，连接外部工具和数据源。

## 概述

`mcp` 命令管理 Model Context Protocol (MCP) 服务器的配置、连接和工具调用，通过标准化协议为 AI 接入外部工具和数据源。支持添加/删除服务器配置、连接管理、工具发现和工具调用，服务器以 stdio 子进程方式运行在本地环境中。

## 核心特性

- 🔹 **服务器配置**: 添加、列出、删除 MCP 服务器配置
- 🔹 **连接管理**: 连接/断开 MCP 服务器，支持会话保持
- 🔹 **工具发现**: 列出已连接服务器提供的工具
- 🔹 **工具调用**: 调用 MCP 工具并返回结果（文本/图片/JSON）
- 🔹 **JSON 输出**: 多数子命令支持 `--json` 格式，便于脚本集成

## 系统架构

```
mcp 命令 → mcp.js (Commander) → MCPClient / MCPServerConfig
                                       │
                  ┌──────────────┬──────┴──────┬──────────────┐
                  ▼              ▼             ▼              ▼
           servers/add/remove  connect     tools           call
                  │              │             │              │
                  ▼              ▼             ▼              ▼
            SQLite 配置存储  stdio 子进程  列出工具列表   执行工具并返回
                            连接保持复用   按服务器筛选   内容块（text/image）
```

## 命令参考

```bash
chainlesschain mcp servers                 # 列出已配置的服务器
chainlesschain mcp servers --json          # JSON 格式输出

# 添加服务器 —— stdio 子进程
chainlesschain mcp add <name> -c <cmd>
# 添加服务器 —— 远程 HTTP/SSE（v5.0.2.10 Streamable HTTP）
chainlesschain mcp add <name> -u <url>               # 从 URL 自动探测传输
chainlesschain mcp add <name> -u <url> -t http       # 显式 Streamable HTTP
chainlesschain mcp add <name> -u <url> -t sse        # 显式 SSE
chainlesschain mcp add <name> -u <url> -H K=V        # 自定义请求头（可重复）

chainlesschain mcp remove <name>           # 删除服务器配置
chainlesschain mcp connect <name>          # 连接到服务器
chainlesschain mcp disconnect <name>       # 断开连接
chainlesschain mcp tools                   # 列出可用工具
chainlesschain mcp call <tool>             # 调用工具

# v5.0.2.10 — MCP Scaffold SDK
chainlesschain mcp scaffold <name>                    # 生成 stdio MCP 服务器骨架
chainlesschain mcp scaffold <name> -t http -p 4001    # 生成 HTTP+SSE 服务器
chainlesschain mcp scaffold <name> --dry-run --json   # 预览不写盘
chainlesschain mcp scaffold <name> -o <dir> --force   # 指定输出目录，覆盖已有

# v5.0.2.10 — 社区服务器仓库
chainlesschain mcp registry list                      # 浏览社区注册中心目录
chainlesschain mcp registry list -c database          # 按类别过滤
chainlesschain mcp registry search <query>            # 关键字搜索（name/description/tags）
chainlesschain mcp registry show <id>                 # 查看条目详情
chainlesschain mcp registry install <id>              # 注册为 MCP 服务器
chainlesschain mcp registry install <id> --as <name> --auto-connect
chainlesschain mcp registry categories                # 列出注册中心类别
```

## 子命令说明

### servers

列出所有已配置的 MCP 服务器，显示名称、命令、参数及自动连接状态。

```bash
chainlesschain mcp servers
chainlesschain mcp servers --json
```

### add

添加或更新一个 MCP 服务器配置。支持两种传输模式：**stdio 子进程**（本地 npx / 可执行文件）与 **远程 HTTP/SSE**（Streamable HTTP / Server-Sent Events，v5.0.2.10 新增）。配置存储在本地数据库中。

```bash
# stdio 模式 —— 本地子进程
chainlesschain mcp add <name> -c <command> [-a <args>] [--auto-connect] [--json]

# HTTP/SSE 模式 —— 远程服务器（v5.0.2.10）
chainlesschain mcp add <name> -u <url> [-t http|sse|stdio] [-H K=V]... [--auto-connect] [--json]
```

| 参数/选项 | 说明 |
|-----------|------|
| `<name>` | 服务器名称 |
| `-c, --command <cmd>` | 服务器启动命令（stdio 模式必填） |
| `-a, --args <args>` | 命令参数，逗号分隔（stdio 模式） |
| `-u, --url <url>` | 远程服务器 URL（http / https） |
| `-t, --transport <type>` | 显式指定传输：`http`（Streamable HTTP）· `sse` · `stdio`。不指定时从 URL 自动探测 |
| `-H, --header <K=V>` | 自定义请求头，可重复（如 `-H Authorization=Bearer+xxx`） |
| `--auto-connect` | 启动时自动连接 |
| `--json` | JSON 格式输出 |

**Streamable HTTP 传输细节**（v5.0.2.10）：

- 首次 `initialize` 握手后服务端返回 `Mcp-Session-Id`，客户端自动在后续请求里带上
- SSE `event: message` / `data: ...` 多事件解析；保留 `ping` / `keep-alive` 心跳容忍
- `fetch` 可被依赖注入（`_deps.fetch`）方便测试与私有代理

### remove

删除一个已配置的 MCP 服务器。

```bash
chainlesschain mcp remove <name>
```

### connect

连接到一个已配置的 MCP 服务器。连接后会话保持，后续可直接调用工具。

```bash
chainlesschain mcp connect <name> [--json]
```

### disconnect

断开与 MCP 服务器的连接。

```bash
chainlesschain mcp disconnect <name>
```

### tools

列出当前已连接服务器提供的所有工具。可按服务器名称筛选。

```bash
chainlesschain mcp tools
chainlesschain mcp tools -s <server-name>
chainlesschain mcp tools --json
```

### call

调用指定的 MCP 工具。自动查找工具所在服务器，也可手动指定。

```bash
chainlesschain mcp call <tool> [-s <server>] [-a <json-args>] [--json]
```

| 参数/选项 | 说明 |
|-----------|------|
| `<tool>` | 工具名称 |
| `-s, --server <name>` | 指定服务器（可选，自动查找） |
| `-a, --args <json>` | 工具参数，JSON 格式 |
| `--json` | JSON 格式输出 |

### scaffold (v5.0.2.10)

生成 MCP 服务器脚手架项目，内置 `stdio` 与 `streamable HTTP + SSE` 两种传输模式。产出包含 `package.json`、示例工具、README 与（HTTP 模式）Express 启动器，可直接 `npm install` 运行。

```bash
chainlesschain mcp scaffold <name> [options]
```

| 参数/选项 | 说明 |
|-----------|------|
| `<name>` | 服务器名称（也作为包名默认前缀 `mcp-<name>`） |
| `-t, --transport <type>` | 传输类型：`stdio`（默认）或 `http` |
| `-p, --port <port>` | HTTP 模式监听端口（默认 `4001`） |
| `-d, --description <text>` | package.json 描述 |
| `-a, --author <name>` | package.json 作者 |
| `-o, --output <dir>` | 输出目录（默认 `./<name>`） |
| `--force` | 覆盖已有目录 |
| `--dry-run` | 预览文件清单而不写盘 |
| `--json` | JSON 格式输出 |

### registry (v5.0.2.10)

浏览、搜索、安装社区注册中心中的 MCP 服务器。内置目录涵盖 filesystem、git、github、browser、fetch、postgres、sqlite、memory 等常用服务器。支持远程注册中心扩展，网络不可用时降级为仅本地目录。

```bash
chainlesschain mcp registry list [options]
chainlesschain mcp registry search <query> [options]
chainlesschain mcp registry show <id-or-name> [options]
chainlesschain mcp registry install <id> [options]
chainlesschain mcp registry categories [--json]
```

| 子命令 | 关键选项 |
|--------|---------|
| `list` | `-c, --category <cat>` · `-t, --tags <tag1,tag2>` · `--sort <field>` · `--order <asc\|desc>` · `--json` |
| `search` | `--json` — 匹配 name/description/tags |
| `show` | 接受条目 `id` 或短名 |
| `install` | `--as <alias>` 自定义服务器名 · `--auto-connect` 安装后立即连接 |
| `categories` | `--json` |

## 配置参考

```bash
# CLI 选项
-c, --command <cmd>      # MCP 服务器启动命令
-a, --args <args>        # 命令参数或工具调用 JSON 参数
-s, --server <name>      # 指定服务器（tools / call 子命令）
--auto-connect           # 服务器启动时自动连接
--json                   # JSON 格式输出

# 环境变量
CHAINLESSCHAIN_DB_PATH       # MCP 服务器配置存储路径
MCP_DEFAULT_TIMEOUT_MS       # 工具调用超时（默认 30000ms）
MCP_SERVER_LOG_LEVEL         # 子进程日志级别（error/warn/info/debug）
```

## 性能指标

| 操作 | 目标 | 实际 | 状态 |
|------|------|------|------|
| `mcp servers` | < 100ms | ~50ms | ✅ |
| `mcp add` | < 150ms | ~80ms | ✅ |
| `mcp connect` (npx 子进程) | < 3s | ~1.8s | ✅ |
| `mcp tools` (已连接) | < 200ms | ~120ms | ✅ |
| `mcp call` (本地工具) | < 500ms | ~250ms | ✅ |
| `mcp disconnect` | < 200ms | ~100ms | ✅ |

## 测试覆盖率

```
✅ mcp-client.test.js  - 覆盖 CLI 主要路径
  ├── 参数解析
  ├── 正常路径
  ├── 错误处理
  └── JSON 输出
```

## 关键文件

- `packages/cli/src/commands/mcp.js` — 命令实现
- `packages/cli/src/lib/mcp-client.js` — MCP 客户端与服务器配置管理

## 安全考虑

- MCP 服务器以子进程方式启动，运行在本地环境中
- 服务器配置（命令、参数）存储在本地 SQLite 数据库
- API 密钥等敏感信息不应通过 `--args` 传递，建议使用环境变量
- 连接保持为单例模式，进程结束后自动断开

## 使用示例

### 场景 1：添加并连接文件系统 MCP 服务器

```bash
chainlesschain mcp add fs -c npx -a "-y,@modelcontextprotocol/server-filesystem,/home/user/docs"
chainlesschain mcp connect fs
chainlesschain mcp tools
```

添加一个基于 npm 包的文件系统 MCP 服务器，连接后查看可用工具。

### 场景 2：调用工具读取文件

```bash
chainlesschain mcp call read_file -a '{"path": "/home/user/docs/README.md"}'
chainlesschain mcp call read_file -a '{"path": "/tmp/data.json"}' --json
```

调用文件系统工具读取文件内容。`--json` 输出适合脚本处理。

### 场景 3：管理多个服务器

```bash
chainlesschain mcp add fs -c npx -a "-y,@modelcontextprotocol/server-filesystem" --auto-connect
chainlesschain mcp add github -c npx -a "-y,@modelcontextprotocol/server-github"
chainlesschain mcp servers --json
chainlesschain mcp remove github
```

配置多个服务器，`--auto-connect` 标记启动时自动连接，按需增删。

## 故障排查

| 问题 | 解决方案 |
|------|---------|
| `Database not available` | 先运行 `chainlesschain db init` 初始化数据库 |
| `Server not configured` | 使用 `chainlesschain mcp add` 添加服务器配置 |
| `Connection failed` | 检查命令和参数是否正确，确认 npx/node 可用 |
| `Tool not found` | 先连接服务器：`chainlesschain mcp connect <name>` |
| 工具调用超时 | 检查 MCP 服务器进程是否正常运行 |

## 相关文档

- [LLM 配置](./cli-llm) — LLM 提供商管理
- [浏览器自动化](./browser-automation) — 浏览器集成
- [技能系统](./skills) — AI 技能管理
