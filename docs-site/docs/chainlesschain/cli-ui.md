# Web 管理界面 (ui)

> 一条命令在浏览器中打开完整的 Web 管理界面，支持项目专属模式和全局管理模式。

## 概述

`chainlesschain ui` 启动一个本地 Web 管理页面。根据当前工作目录自动检测运行模式：

- **项目模式**：从含 `.chainlesschain/` 目录的项目路径运行，AI 自动携带项目上下文
- **全局模式**：从任意非项目目录运行，打开通用 AI 管理面板

**核心优势：**

- 完全内置，无需额外安装，一条命令即可启动
- 流式 Markdown 渲染（marked.js + highlight.js 代码高亮）
- 会话管理：新建/切换/历史记录
- 支持 Agent 和 Chat 两种会话模式
- 交互式问答弹窗（Agent slot-filling 支持）
- 断线自动重连
- Token 认证保护

## 快速开始

```bash
# 项目模式（从含 .chainlesschain/ 的目录运行）
cd /your/project
chainlesschain ui

# 全局模式（从任意目录运行）
chainlesschain ui

# 自定义端口
chainlesschain ui --port 9000 --ws-port 9001

# 启用认证
chainlesschain ui --token mysecret

# 仅启动服务器，不自动打开浏览器
chainlesschain ui --no-open
```

启动后访问：`http://127.0.0.1:18810`

## 命令选项

```
Usage: chainlesschain ui [options]

Options:
  -p, --port <port>      HTTP 服务器端口 (默认: 18810)
  --ws-port <port>       WebSocket 服务器端口 (默认: 18800)
  -H, --host <host>      绑定地址 (默认: 127.0.0.1)
  --no-open              不自动打开浏览器
  --token <token>        WebSocket 认证 token
  -h, --help             显示帮助信息
```

## 两种工作模式

### 项目模式

从含 `.chainlesschain/config.json` 的目录（或其子目录）运行时自动激活项目模式：

```bash
cd /workspace/my-project    # 该目录含 .chainlesschain/config.json
chainlesschain ui
```

**特点：**
- 侧边栏顶部显示项目名称和路径
- Agent 会话自动携带 `projectRoot` 上下文，AI 能感知项目结构
- 适合与特定项目的代码库进行对话、分析、重构等操作

### 全局模式

从不含 `.chainlesschain/` 的目录运行时自动激活全局模式：

```bash
cd ~
chainlesschain ui
```

**特点：**
- 显示"全局管理面板"标识
- 适合通用 AI 对话、跨项目任务、系统级操作

## 界面功能说明

### 侧边栏

| 元素 | 功能 |
|------|------|
| **新建会话** | 创建新的 Agent 或 Chat 会话 |
| **会话列表** | 点击切换历史会话 |
| **连接状态** | 显示 WebSocket 连接状态（绿色=已连接）|
| **模式标识** | 显示当前项目名称或全局模式标识 |

### 会话类型

| 类型 | 说明 |
|------|------|
| **Agent** | 具备工具使用能力，支持文件读写、命令执行等（对应 `chainlesschain agent`）|
| **Chat** | 纯对话模式，适合快速问答（对应 `chainlesschain chat`）|

切换 Tab 选择会话类型，点击"新建会话"时生效。

### 消息区域

- **流式输出**：AI 回复实时 token 逐字显示
- **Markdown 渲染**：标题、列表、表格、代码块等完整支持
- **代码高亮**：自动识别 50+ 编程语言（highlight.js）
- 输入框支持 `Enter` 发送，`Shift+Enter` 换行

### 交互式问答

Agent 执行过程中若需要用户输入（参数填充），会弹出对话框：
- **选择题**：点击选项直接回答
- **填空题**：文本框输入后按 Enter 或点击确认

## 端口说明

`chainlesschain ui` 同时启动两个服务器：

| 服务 | 默认端口 | 说明 |
|------|---------|------|
| HTTP（Web 页面） | 18810 | 浏览器访问入口 |
| WebSocket（AI 通信）| 18800 | 与 `chainlesschain serve` 共享默认端口 |

> **注意**：若已运行 `chainlesschain serve` 占用了 18800，请通过 `--ws-port` 使用不同端口：
> ```bash
> chainlesschain ui --ws-port 18801
> ```

## 安全说明

### 默认本地访问

默认绑定 `127.0.0.1`，仅本机可访问，不对外暴露。

### Token 认证

启用认证后，浏览器端会在建立 WebSocket 连接时自动发送 token：

```bash
chainlesschain ui --token my-secure-token
```

Web 页面会读取启动时注入的 token 并在连接时自动认证，无需手动输入。

### 远程访问

如需从其他设备访问（如手机、局域网内的另一台电脑），请使用 `serve` 命令配合 `--allow-remote`，然后单独访问 Web 页面，或通过 `--host 0.0.0.0` 绑定所有网卡：

```bash
# 绑定所有网卡（局域网可访问）
chainlesschain ui --host 0.0.0.0 --token my-token
# 访问：http://<本机IP>:18810
```

## 技术实现

`chainlesschain ui` 内置两个服务：

1. **HTTP 服务器**（端口 18810）：提供单页 HTML 应用，包含完整的 CSS、JavaScript 和 CDN 资源引用
2. **WebSocket 服务器**（端口 18800）：复用 `ChainlessChainWSServer`，支持完整的会话和流式协议

Web 页面通过 `window.__CC_CONFIG__` 获取运行时配置（wsPort、wsToken、projectRoot、mode 等），配置值经过 HTML-safe JSON 转义，防止 XSS 攻击。

### WebSocket 协议要点（v5.0.2.3 修复后）

前端发送的每条消息都会自动注入 `id: "ui-N"` 字段（服务端强制要求）。关键事件类型：

| 事件 | 方向 | 说明 |
|------|------|------|
| `auth` | →服务端 | 发送 token 认证 |
| `auth-result` | ←服务端 | 认证结果（含 `success` 字段） |
| `session-list` | →服务端 | 请求会话列表 |
| `session-list-result` | ←服务端 | 返回会话列表 |
| `create-session` | →服务端 | 创建新会话 |
| `session-created` | ←服务端 | 返回 `sessionId`/`sessionType` |
| `chat` | →服务端 | 发送消息 |
| `response-token` | ←服务端 | 流式 token（Chat 模式） |
| `response-complete` | ←服务端 | 流式结束 |
| `tool-executing` | ←服务端 | Agent 工具调用（显示为系统消息） |

## 与 `serve` 命令的区别

| 特性 | `chainlesschain ui` | `chainlesschain serve` |
|------|---------------------|------------------------|
| 用途 | 浏览器 Web 交互界面 | 供程序调用的 WebSocket API |
| 启动服务 | HTTP + WebSocket | 仅 WebSocket |
| 默认端口 | HTTP:18810, WS:18800 | WS:18800 |
| 自动打开浏览器 | ✅ | ❌ |
| 项目感知 | ✅ 自动检测 | 需 `--project` 手动指定 |
| 适用场景 | 日常人工交互 | IDE 插件、脚本、自动化集成 |

## 常见问题

**Q: 启动后浏览器没有自动打开？**

使用 `--no-open` 时不会自动打开。未使用该选项但没有打开时，请手动访问 `http://127.0.0.1:18810`。

**Q: 连接状态显示"连接错误"？**

WebSocket 端口可能被占用。尝试：
```bash
chainlesschain ui --ws-port 18801
```

**Q: 如何在已有 `serve` 服务运行时使用 `ui`？**

使用不同的 WS 端口：
```bash
# 已有 serve 在 18800
chainlesschain ui --ws-port 18801
```

**Q: 会话历史保存在哪里？**

会话数据保存在本地 SQLite 数据库（`data/chainlesschain.db`）。下次启动同样可通过侧边栏切换历史会话。

## 相关文档

- [WebSocket 服务器 (serve)](./cli-serve) — 程序化 WebSocket API 接口
- [Agent 模式](./cli-agent) — 命令行 Agent 会话
- [项目初始化 (init)](./cli-init) — 创建 `.chainlesschain/` 项目目录
- [设计文档 — 模块 73](../design/modules/73-web-ui) — 技术架构与实现细节
