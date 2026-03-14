# WebSocket 服务器 (serve)

> 通过 WebSocket 暴露全部 CLI 命令，供 IDE 插件、Web 前端、自动化脚本等远程调用。

## 概述

`chainlesschain serve` 启动一个 WebSocket 服务器，外部工具通过标准 WebSocket 协议连接后即可执行任意 CLI 命令。支持缓冲模式和流式模式两种执行方式。

**核心优势：**

- 所有 61 个 CLI 命令立即可用（子进程执行策略，零修改）
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

## 文件清单

| 文件 | 说明 |
|---|---|
| `packages/cli/src/lib/ws-server.js` | WebSocket 服务器核心类 |
| `packages/cli/src/commands/serve.js` | serve 命令注册 |

## 测试

```bash
cd packages/cli
npx vitest run __tests__/unit/ws-server.test.js        # 39 个单元测试
npx vitest run __tests__/integration/ws-server-workflow.test.js  # 7 个集成测试
npx vitest run __tests__/e2e/serve-command.test.js       # 8 个 E2E 测试
```

共 54 个测试，覆盖 tokenizer、连接管理、认证、缓冲/流式执行、取消、超时、心跳、阻止命令等全部功能。
