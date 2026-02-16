---
name: mcp-server-generator
display-name: MCP Server Generator
description: MCP服务器生成技能 - 从自然语言生成完整MCP服务器代码
version: 1.0.0
category: development
user-invocable: true
tags: [mcp, server, generator, tool, protocol, sdk]
capabilities:
  [
    server-generation,
    tool-definition,
    transport-setup,
    auth-configuration,
    registry-integration,
  ]
tools:
  - file_reader
  - file_writer
  - code_analyzer
handler: ./handler.js
dependencies:
  - mcp-sdk
instructions: |
  Use this skill when the user wants to create a custom MCP server. Generate complete
  MCP server code using the existing MCPServerBuilder SDK from natural language descriptions.
  Support both HTTP+SSE and stdio transports, authentication setup, and automatic
  registration in the community registry. This leverages the existing MCP SDK at
  src/main/mcp/sdk/ to generate production-ready MCP servers.
examples:
  - input: "/mcp-server-generator 'an MCP server that queries our PostgreSQL database'"
    output: "Generated: mcp-server-postgres-custom/ with 3 tools (query, list_tables, describe_table), stdio transport"
  - input: "/mcp-server-generator 'an MCP server that monitors GitHub Actions workflows'"
    output: "Generated: mcp-server-github-actions/ with 5 tools (list_runs, get_run, cancel_run, rerun, get_logs), Bearer auth"
  - input: "/mcp-server-generator 'a Jira MCP server for reading issues and creating tasks'"
    output: "Generated: mcp-server-jira/ with 6 tools (list_issues, get_issue, create_issue, update_issue, add_comment, search), API-Key auth"
os: [win32, darwin, linux]
author: ChainlessChain
---

# MCP 服务器生成技能

## 描述

从自然语言描述生成完整的 MCP (Model Context Protocol) 服务器代码。使用现有的 MCPServerBuilder SDK，生成包含工具定义、传输配置、认证设置和注册集成的可用服务器。

## 使用方法

```
/mcp-server-generator <描述>
```

## 生成内容

### 服务器代码

- `index.js` - 服务器入口，使用 MCPServerBuilder 构建
- `tools/` - 工具实现（每个工具一个文件）
- `config.json` - 服务器配置
- `package.json` - 依赖声明
- `README.md` - 使用说明

### 工具定义

从描述自动推断工具集:

- 工具名称和描述
- 参数 JSON Schema
- 返回值格式
- 错误处理

### 传输配置

| 传输方式 | 适用场景           |
| -------- | ------------------ |
| stdio    | 本地使用、CLI 工具 |
| HTTP+SSE | 远程访问、多客户端 |

### 认证设置

| 认证方式 | 说明       |
| -------- | ---------- |
| None     | 本地开发   |
| Bearer   | Token 认证 |
| API-Key  | API 密钥   |
| Basic    | 用户名密码 |

## 生成示例

### 输入

```
/mcp-server-generator "an MCP server that manages Notion pages - list databases, query pages, create pages, update pages"
```

### 输出

```javascript
// Generated: mcp-server-notion/index.js
const { MCPServerBuilder } = require("@chainlesschain/mcp-sdk");

const server = new MCPServerBuilder()
  .name("notion-manager")
  .description("Manage Notion pages and databases")
  .version("1.0.0")
  .tool("list_databases", {
    description: "List all Notion databases",
    parameters: {},
    handler: async () => {
      /* ... */
    },
  })
  .tool("query_pages", {
    description: "Query pages in a database",
    parameters: {
      database_id: { type: "string", required: true },
      filter: { type: "object" },
    },
    handler: async ({ database_id, filter }) => {
      /* ... */
    },
  })
  // ...more tools
  .transport("stdio")
  .build();

server.start();
```

## 选项

- `--transport <type>` - 传输方式: stdio, http (默认: stdio)
- `--auth <type>` - 认证方式: none, bearer, api-key, basic
- `--output <dir>` - 输出目录
- `--register` - 自动注册到社区注册表

## 示例

生成 Jira MCP 服务器:

```
/mcp-server-generator "a Jira MCP server for reading issues and creating tasks"
```

生成带 HTTP 传输的服务器:

```
/mcp-server-generator "a weather API MCP server" --transport http --auth api-key
```
