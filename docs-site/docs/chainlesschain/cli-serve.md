# WebSocket 服务器 (serve)

> 通过 WebSocket 暴露全部 CLI 命令，供 IDE 插件、Web 前端、自动化脚本等远程调用。

## 概述

`chainlesschain serve` 启动一个 WebSocket 服务器，外部工具通过标准 WebSocket 协议连接后即可执行任意 CLI 命令。支持缓冲模式和流式模式两种执行方式。

**核心优势：**

- 所有 63 个 CLI 命令立即可用（子进程执行策略，零修改）
- 流式输出支持（`ask`、`search` 等命令逐块返回）
- Token 认证 + localhost 默认绑定
- Shell 注入防护（自实现 tokenizer，无 `shell: true`）
- 心跳检测 + 连接限制 + 命令超时

## 快速开始

```bash
# 启动服务器（默认端口 18800，仅本地访问）
chainlesschain serve

# 指定端口
chainlesschain serve --port 9000

# 带认证
chainlesschain serve --token my-secret-token

# 允许远程连接（必须配合 --token）
chainlesschain serve --allow-remote --token my-secret-token
```

### 连接测试

```bash
# 使用 wscat 测试
npm install -g wscat
wscat -c ws://127.0.0.1:18800

> {"id":"1","type":"ping"}
< {"id":"1","type":"pong","serverTime":1710400000000}

> {"id":"2","type":"execute","command":"note list --json"}
< {"id":"2","type":"result","success":true,"exitCode":0,"stdout":"[...]","stderr":""}
```

## 命令选项

```
chainlesschain serve [options]

Options:
  -p, --port <port>        端口号 (默认: 18800)
  -H, --host <host>        绑定地址 (默认: 127.0.0.1)
  --token <token>          认证 Token（启用后客户端必须先发送 auth 消息）
  --max-connections <n>    最大连接数 (默认: 10)
  --timeout <ms>           命令执行超时，单位毫秒 (默认: 30000)
  --allow-remote           允许非本地连接（需配合 --token）
  --project <path>         默认项目根目录（会话创建时的 fallback）
```

## WebSocket 协议

所有消息为 JSON 格式，必须包含 `id`（请求标识）和 `type`（消息类型）字段。

### Client → Server

#### 认证 (`auth`)

若服务器启用了 `--token`，客户端连接后必须先发送认证消息：

```json
{ "id": "1", "type": "auth", "token": "your-secret-token" }
```

响应：

```json
{ "id": "1", "type": "auth-result", "success": true }
```

认证失败时连接将被断开（close code 4001）。

#### 心跳 (`ping`)

```json
{ "id": "2", "type": "ping" }
```

响应：

```json
{ "id": "2", "type": "pong", "serverTime": 1710400000000 }
```

#### 执行命令 — 缓冲模式 (`execute`)

等待命令完成后一次性返回全部输出：

```json
{ "id": "3", "type": "execute", "command": "note list --json" }
```

响应：

```json
{
  "id": "3",
  "type": "result",
  "success": true,
  "exitCode": 0,
  "stdout": "[{\"id\":1,\"title\":\"My Note\"}]",
  "stderr": ""
}
```

#### 执行命令 — 流式模式 (`stream`)

逐块推送输出数据，适合 `ask`、`search` 等需要实时显示的命令：

```json
{ "id": "4", "type": "stream", "command": "ask \"hello\"" }
```

服务器逐块推送：

```json
{ "id": "4", "type": "stream-data", "channel": "stdout", "data": "Hello! " }
{ "id": "4", "type": "stream-data", "channel": "stdout", "data": "How can I help?" }
{ "id": "4", "type": "stream-end", "exitCode": 0 }
```

#### 取消命令 (`cancel`)

取消正在执行的命令（通过 id 匹配）：

```json
{ "id": "4", "type": "cancel" }
```

### 错误码

| 错误码 | 说明 |
|---|---|
| `INVALID_JSON` | 消息不是有效 JSON |
| `MISSING_ID` | 缺少 `id` 字段 |
| `UNKNOWN_TYPE` | 未知消息类型 |
| `AUTH_REQUIRED` | 需要先认证 |
| `COMMAND_BLOCKED` | 命令被阻止（交互式或递归） |
| `INVALID_COMMAND` | 无效命令（空或非字符串） |
| `COMMAND_TIMEOUT` | 命令超时（被自动终止） |
| `SPAWN_ERROR` | 子进程启动失败 |
| `NOT_FOUND` | 找不到指定请求 ID |

## 安全机制

### 默认 localhost

服务器默认绑定 `127.0.0.1`，仅允许本地连接。远程工具需通过 SSH 隧道或 `--allow-remote` 访问。

### Token 认证

启用 `--token` 后，客户端连接后的第一条消息必须是认证。未认证的请求返回 `AUTH_REQUIRED` 错误。认证失败后连接立即断开。

### 命令注入防护

命令字符串通过自实现的 shell-safe tokenizer 解析（支持双引号、单引号、转义），参数直接传入 `spawn()` 的 `args` 数组，**不使用 `shell: true`**，从根本上防止 shell 注入攻击。

### 阻止的命令

以下命令无法通过 WebSocket 执行：

| 命令 | 原因 |
|---|---|
| `serve` | 防止递归启动服务器 |
| `chat` | 需要交互式 TTY |
| `agent` | 需要交互式 TTY |
| `setup` | 需要交互式 TTY |

执行这些命令会收到 `COMMAND_BLOCKED` 错误。

### 资源保护

- **连接限制**: `--max-connections` 防止资源耗尽（默认 10）
- **命令超时**: `--timeout` 超时自动终止子进程（默认 30s）
- **心跳检测**: 30 秒 ping/pong 自动检测并清理死连接

## 集成示例

### JavaScript / Node.js

```javascript
import WebSocket from 'ws';

const ws = new WebSocket('ws://127.0.0.1:18800');

ws.on('open', () => {
  // 如果启用了 token 认证，先认证
  ws.send(JSON.stringify({
    id: 'auth',
    type: 'auth',
    token: 'my-secret'
  }));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());

  if (msg.type === 'auth-result' && msg.success) {
    // 认证成功，执行命令
    ws.send(JSON.stringify({
      id: 'cmd1',
      type: 'execute',
      command: 'note list --json'
    }));
  }

  if (msg.type === 'result') {
    console.log('Output:', msg.stdout);
    const notes = JSON.parse(msg.stdout);
    console.log(`Found ${notes.length} notes`);
  }
});
```

### Python

```python
import asyncio
import json
import websockets

async def main():
    async with websockets.connect('ws://127.0.0.1:18800') as ws:
        # 执行命令
        await ws.send(json.dumps({
            'id': '1',
            'type': 'execute',
            'command': 'note list --json'
        }))

        response = json.loads(await ws.recv())
        if response['success']:
            notes = json.loads(response['stdout'])
            print(f"Found {len(notes)} notes")

asyncio.run(main())
```

### 浏览器 (Web 前端)

```javascript
const ws = new WebSocket('ws://127.0.0.1:18800');

ws.onopen = () => {
  ws.send(JSON.stringify({
    id: '1',
    type: 'stream',
    command: 'ask "介绍下ChainlessChain"'
  }));
};

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.type === 'stream-data') {
    document.getElementById('output').textContent += msg.data;
  }
  if (msg.type === 'stream-end') {
    console.log('Done, exit code:', msg.exitCode);
  }
};
```

## 架构

```
┌─────────────────────────────────────────────┐
│          外部工具 / IDE / Web 前端            │
└──────────────────┬──────────────────────────┘
                   │ WebSocket (ws://...)
┌──────────────────▼──────────────────────────┐
│         ChainlessChainWSServer              │
│                                             │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐   │
│  │连接管理   │ │Token认证  │ │心跳检测   │   │
│  └────┬─────┘ └──────────┘ └──────────┘   │
│       │                                     │
│  ┌────▼─────────────────────────────────┐   │
│  │  命令 Tokenizer (shell-safe 分词)    │   │
│  └────┬─────────────────────────────────┘   │
│       │                                     │
│  ┌────▼─────────────────────────────────┐   │
│  │  spawn(node, [chainlesschain, ...])  │   │
│  │  FORCE_COLOR=0  NO_SPINNER=1         │   │
│  └────┬─────────────────────────────────┘   │
│       │                                     │
│  ┌────▼────┐  ┌────────────┐                │
│  │ stdout  │  │ stderr     │                │
│  │ 缓冲/流 │  │ 缓冲/流    │                │
│  └─────────┘  └────────────┘                │
└─────────────────────────────────────────────┘
```

## 有状态会话（Session）

> v0.41.0 新增

除了无状态 RPC 命令执行，WebSocket 服务器还支持有状态的 agent/chat 会话，提供类似 Claude Code 的远程控制体验。

### 会话协议

#### Client → Server

| type | 说明 | 额外字段 |
|------|------|----------|
| `session-create` | 创建 agent/chat 会话 | `sessionType` ("agent"\|"chat"), `provider`, `model`, `apiKey`, `baseUrl`, `projectRoot` |
| `session-resume` | 从 DB 恢复历史会话 | `sessionId` |
| `session-message` | 发送用户消息到会话 | `sessionId`, `content` |
| `session-list` | 列出所有会话 | — |
| `session-close` | 关闭会话 | `sessionId` |
| `slash-command` | 发送 slash 命令 | `sessionId`, `command` |
| `session-answer` | 回答 AI 的提问 | `sessionId`, `requestId`, `answer` |

#### Server → Client

| type | 说明 |
|------|------|
| `session-created` | 会话已创建，含 `sessionId`, `sessionType` |
| `session-resumed` | 会话已恢复，含 `sessionId`, `history[]` |
| `tool-executing` | 正在执行工具 |
| `tool-result` | 工具执行结果 |
| `response-token` | 流式 token |
| `response-complete` | 完整响应 |
| `question` | AI 向用户提问（参数确认） |
| `session-list-result` | 会话列表 |

### 会话示例

```bash
# 使用 wscat 创建 agent 会话
wscat -c ws://127.0.0.1:18800

> {"id":"1","type":"session-create","sessionType":"agent","provider":"ollama","model":"qwen2.5:7b"}
< {"id":"1","type":"session-created","sessionId":"session-abc123","sessionType":"agent"}

> {"id":"2","type":"session-message","sessionId":"session-abc123","content":"list files in current directory"}
< {"id":"2","type":"tool-executing","tool":"list_dir","args":{"path":"."}}
< {"id":"2","type":"tool-result","tool":"list_dir","result":{...}}
< {"id":"2","type":"response-complete","content":"Here are the files..."}

> {"id":"3","type":"slash-command","sessionId":"session-abc123","command":"/plan enter"}
< {"id":"3","type":"command-response","result":"Entered plan mode."}

> {"id":"4","type":"session-close","sessionId":"session-abc123"}
< {"id":"4","type":"result","success":true,"sessionId":"session-abc123"}
```

### 会话事件详情

#### `slot-filling` 事件

当 SlotFiller 检测到缺失参数并补全时发送：

```json
{
  "id": "req-1",
  "type": "session-event",
  "sessionId": "session-abc123",
  "event": "slot-filling",
  "slot": "platform",
  "question": "Filled \"platform\" = \"docker\""
}
```

#### `tool-executing` 事件（run_code 示例）

```json
{
  "id": "req-2",
  "type": "tool-executing",
  "tool": "run_code",
  "args": {
    "language": "python",
    "code": "import pandas as pd\ndf = pd.read_csv('data.csv')\nprint(df.shape)"
  }
}
```

#### `tool-result` 事件（含 autoInstalled）

当 `run_code` 自动安装了缺失的 Python 包时，`result` 中包含 `autoInstalled` 字段：

```json
{
  "id": "req-2",
  "type": "tool-result",
  "tool": "run_code",
  "result": {
    "success": true,
    "output": "(100, 5)",
    "language": "python",
    "duration": "1523ms",
    "autoInstalled": ["pandas"],
    "scriptPath": ".chainlesschain/agent-scripts/2026-03-15-10-30-45-python.py"
  }
}
```

### 项目上下文绑定

创建会话时指定 `projectRoot`，服务器自动加载项目上下文：

```json
{
  "id": "1",
  "type": "session-create",
  "sessionType": "agent",
  "projectRoot": "/path/to/my/project"
}
```

加载内容：
- `{projectRoot}/.chainlesschain/rules.md` → 注入 system prompt
- `{projectRoot}/.chainlesschain/skills/` → workspace 层 skills
- `{projectRoot}/.chainlesschain/config.json` → 项目配置

### 会话错误码

| 错误码 | 说明 |
|--------|------|
| `NO_SESSION_SUPPORT` | 服务器未配置会话管理器 |
| `SESSION_NOT_FOUND` | 找不到指定会话 |
| `SESSION_CREATE_FAILED` | 会话创建失败 |
| `MESSAGE_FAILED` | 消息处理失败 |

## 文件清单

| 文件 | 说明 |
|---|---|
| `packages/cli/src/lib/ws-server.js` | WebSocket 服务器核心类 |
| `packages/cli/src/commands/serve.js` | serve 命令注册 |
| `packages/cli/src/lib/ws-session-manager.js` | 会话注册表与生命周期管理 |
| `packages/cli/src/lib/ws-agent-handler.js` | Agent 会话处理器 |
| `packages/cli/src/lib/ws-chat-handler.js` | Chat 会话处理器 |
| `packages/cli/src/lib/interaction-adapter.js` | 用户交互抽象层 |
| `packages/cli/src/lib/agent-core.js` | Agent 核心业务逻辑 |
| `packages/cli/src/lib/chat-core.js` | Chat 流式核心逻辑 |
| `packages/cli/src/lib/slot-filler.js` | 参数槽填充引擎 |
| `packages/cli/src/lib/interactive-planner.js` | 交互式计划生成器 |

## 测试

```bash
cd packages/cli

# RPC 测试
npx vitest run __tests__/unit/ws-server.test.js                 # 39 个单元测试
npx vitest run __tests__/integration/ws-server-workflow.test.js  # 7 个集成测试
npx vitest run __tests__/e2e/serve-command.test.js               # 8 个 E2E 测试

# 会话测试
npx vitest run __tests__/unit/ws-session-manager.test.js         # 20 个单元测试
npx vitest run __tests__/unit/ws-agent-handler.test.js           # 18 个单元测试
npx vitest run __tests__/unit/ws-chat-handler.test.js            # 8 个单元测试
npx vitest run __tests__/unit/interaction-adapter.test.js        # 15 个单元测试
npx vitest run __tests__/unit/slot-filler.test.js                # 35 个单元测试
npx vitest run __tests__/unit/interactive-planner.test.js        # 20 个单元测试
npx vitest run __tests__/integration/ws-session-workflow.test.js # 16 个集成测试
```

共 220+ 个 WebSocket 相关测试，覆盖 RPC 命令执行、有状态会话、SlotFiller 意图检测、交互式规划等全部功能。
