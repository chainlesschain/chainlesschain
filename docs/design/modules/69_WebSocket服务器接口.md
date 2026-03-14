# WebSocket 服务器接口设计

**版本**: v5.0.1
**创建日期**: 2026-03-14
**状态**: ✅ 已实现

---

## 一、模块概述

### 1.1 背景

ChainlessChain CLI (`packages/cli/`) 目前拥有 61 个命令，涵盖 AI 对话、笔记管理、DID 身份、加密解密、MCP 集成、DAO 治理等全部功能。但 CLI 仅支持终端直接调用，无法被外部工具（IDE 插件、Web 前端、自动化脚本、CI/CD 管道等）程序化远程调用。WebSocket 服务器接口解决这一问题。

### 1.2 设计目标

| 目标              | 描述                                                                     |
| ----------------- | ------------------------------------------------------------------------ |
| **零修改集成**    | 子进程执行策略，无需修改任何现有命令代码，所有 61 个命令立即可用           |
| **流式支持**      | `ask`、`search` 等命令的输出逐块推送，适合实时 UI 展示                   |
| **安全第一**      | 默认 localhost 绑定，Token 认证，shell 注入防护，阻止危险命令             |
| **资源保护**      | 连接数限制、命令超时、心跳检测，防止资源耗尽                             |
| **协议简洁**      | JSON-over-WebSocket，6 种消息类���，9 种错误码，客户端实现成本极低        |

---

## 二、技术架构

### 2.1 模块结构

```
packages/cli/
├── src/
│   ├── commands/serve.js           # Commander 命令注册（serve + 6 选项）
│   ├── lib/ws-server.js            # 核心 WebSocket 服务器类
│   ├── constants.js                # DEFAULT_PORTS.wsServer = 18800（修改）
│   └── index.js                    # registerServeCommand（修改）
├── package.json                    # "ws": "^8.14.2" 依赖（修改）
├── __tests__/
│   ├── unit/ws-server.test.js                    # 39 单元测试
│   ├── integration/ws-server-workflow.test.js     # 7 集成测试
│   └── e2e/serve-command.test.js                  # 8 端到端测试
```

### 2.2 核心类设计

```
ChainlessChainWSServer extends EventEmitter {
  // 配置
  port: number          // 默认 18800
  host: string          // 默认 "127.0.0.1"
  token: string|null    // Token 认证（null = 无需认证）
  maxConnections: number // 最大连接数（默认 10）
  timeout: number       // 命令超时 ms（默认 30000）

  // 状态
  wss: WebSocketServer  // ws 库实例
  clients: Map          // clientId → { ws, authenticated, connectedAt, ip, alive }
  processes: Map        // requestId → ChildProcess

  // 生命周期
  start() → Promise     // 启动服务器
  stop() → Promise      // 关闭服务器 + kill 所有子进程

  // 协议处理（私有）
  _handleConnection(ws, req)
  _handleMessage(clientId, ws, message)
  _handleAuth(clientId, ws, message)
  _executeCommand(id, ws, command, stream)
  _cancelRequest(id, ws)
  _startHeartbeat()
  _send(ws, data)

  // 事件
  "listening"     → { port, host }
  "connection"    → { clientId, ip }
  "disconnection" → { clientId, reason? }
  "command:start" → { id, command, stream }
  "command:end"   → { id, exitCode }
  "error"         → Error
  "stopped"       → void
}
```

### 2.3 命令执行流程

```
客户端: {"id":"1","type":"execute","command":"note list --json"}
    ↓
_handleMessage()
    ↓ 检查认证状态
    ↓ 检查是否被阻止的命令
    ↓
tokenizeCommand("note list --json")  →  ["note", "list", "--json"]
    ↓ shell-safe 分词（引号/转义/空白处理）
    ↓
spawn(process.execPath, [binPath, "note", "list", "--json"], {
  env: { FORCE_COLOR: "0", NO_SPINNER: "1" },
  stdio: ["pipe", "pipe", "pipe"]
})
    ↓
    ├── execute 模式: 缓冲 stdout/stderr → 进程结束 → 发送 result
    └── stream 模式:  stdout/stderr data → 逐块发送 stream-data → 进程结束 → stream-end
```

### 2.4 Shell-Safe Tokenizer

自实现命令分词器，**不使用 `shell: true`**，从根本上防止 shell 注入：

```javascript
export function tokenizeCommand(input) {
  // 处理：双引号字符串、单引号字符串、反斜杠转义、空白分隔
  // 输入: 'note add "Hello World" --tag \'test\''
  // 输出: ["note", "add", "Hello World", "--tag", "test"]
}
```

| 特性         | 说明                                       |
| ------------ | ------------------------------------------ |
| 双引号       | `"Hello World"` → `Hello World`            |
| 单引号       | `'Hello World'` → `Hello World`            |
| 反斜杠转义   | `say \"hi\"` → `say "hi"`（仅双引号内）   |
| 多空格       | 连续空格/制表符 → 单分隔                   |
| 空输入       | 返回空数组                                 |

---

## 三、WebSocket 协议

### 3.1 Client → Server

| type      | 说明            | 额外字段                 | 备注                          |
| --------- | --------------- | ------------------------ | ----------------------------- |
| `auth`    | 认证            | `token: string`          | 启用 --token 时必须先发送     |
| `ping`    | 心跳            | —                        | 任何时候可发送                |
| `execute` | 执行命令(缓冲)  | `command: string`        | 等待完成后返回全部输出        |
| `stream`  | 执行命令(流式)  | `command: string`        | 逐块推送 stdout/stderr        |
| `cancel`  | 取消执行        | —                        | id 为要取消的请求 id          |

### 3.2 Server → Client

| type          | 说明       | 字段                                           |
| ------------- | ---------- | ---------------------------------------------- |
| `auth-result` | 认证结果   | `success: boolean`, `message?: string`         |
| `pong`        | 心跳响应   | `serverTime: number`                           |
| `result`      | 命令结果   | `success`, `exitCode`, `stdout`, `stderr`      |
| `stream-data` | 流式数据块 | `channel: "stdout"\|"stderr"`, `data: string`  |
| `stream-end`  | 流结束     | `exitCode: number`                             |
| `error`       | 错误       | `code: string`, `message: string`              |

### 3.3 错误码

| code              | HTTP 类比 | 说明                     |
| ----------------- | --------- | ------------------------ |
| `INVALID_JSON`    | 400       | 消息不是有效 JSON        |
| `MISSING_ID`      | 400       | 缺少 `id` 字段          |
| `UNKNOWN_TYPE`    | 400       | 未知消息类型             |
| `AUTH_REQUIRED`   | 401       | 需要先认证               |
| `COMMAND_BLOCKED` | 403       | 命令被阻止（交互/递归）  |
| `INVALID_COMMAND` | 400       | 无效命令（空或非字符串） |
| `COMMAND_TIMEOUT` | 408       | 命令超时（子进程被 kill）|
| `SPAWN_ERROR`     | 500       | 子进程启动失败           |
| `NOT_FOUND`       | 404       | 找不到指定请求 ID        |

---

## ��、安全机制

### 4.1 网络隔离

| 机制             | 说明                                                |
| ---------------- | --------------------------------------------------- |
| 默认 localhost   | 绑定 `127.0.0.1`，仅本机访问                       |
| `--allow-remote` | 切换为 `0.0.0.0`，**强制要求 `--token`**            |
| SSH 隧道         | 推荐远程访问通过 SSH 隧道转发                       |

### 4.2 认证

- `--token <secret>` 启用 Token 认证
- 客户端连接后第一条消息必须是 `auth`
- 认证失败 → 返回 `{ success: false }` → 100ms 后断开（close code 4001）
- 未认证时发送其他消息 → 返回 `AUTH_REQUIRED` 错误

### 4.3 命令注入防护

```
用户输入: "note add \"hello; rm -rf /\""
                    ↓
tokenizeCommand(): ["note", "add", "hello; rm -rf /"]
                    ↓
spawn(node, [bin, "note", "add", "hello; rm -rf /"])
  → "hello; rm -rf /" 作为单个参数传递，不会被 shell 解释
```

- **不使用 `shell: true`**
- 参数直接传入 `spawn` 的 `args` 数组
- 分号、管道、重定向等 shell 元字符作为普通字符传递

### 4.4 阻止的���令

| 命令     | 原因                            |
| -------- | ------------------------------- |
| `serve`  | 防止递归启动（fork bomb 风险）  |
| `chat`   | 需要 TTY 交互式输入             |
| `agent`  | 需要 TTY 交互式输入             |
| `setup`  | 需要 TTY 交互式安装向导         |

### 4.5 资源保护

| 机制            | 默认值   | 说明                                    |
| --------------- | -------- | --------------------------------------- |
| maxConnections  | 10       | 超限连接直接关闭（code 1013）           |
| timeout         | 30000ms  | 超时后 SIGTERM 子进程                   |
| heartbeat       | 30000ms  | ping/pong 检测死连接，超时后 terminate  |
| FORCE_COLOR=0   | —        | 禁止 chalk 颜色码输出                   |
| NO_SPINNER=1    | —        | 禁止 ora spinner 动画                   |

---

## 五、CLI 命令

```bash
chainlesschain serve [options]

Options:
  -p, --port <port>        端口号 (默认: 18800)
  -H, --host <host>        绑定地址 (默认: 127.0.0.1)
  --token <token>          认证 Token
  --max-connections <n>    最大连接数 (默认: 10)
  --timeout <ms>           命令超时毫秒 (默认: 30000)
  --allow-remote           允许非本地连接 (需配合 --token)
```

### 5.1 启动示例

```bash
# 本地开发
chainlesschain serve

# 生产部署（带认证）
chainlesschain serve --token $(openssl rand -hex 32) --timeout 60000

# 远程访问（必须带 token）
chainlesschain serve --allow-remote --token my-secret --port 8080
```

### 5.2 graceful shutdown

- `SIGINT` (Ctrl+C) 和 `SIGTERM` 触发优雅关闭
- kill 所有运行中的子进程
- 关闭所有客户端连接（close code 1001）
- 关闭 WebSocket 服务器

---

## 六、核心 API

### 6.1 ws-server.js 导出

| 导出                       | 类型     | 用途                                          |
| -------------------------- | -------- | --------------------------------------------- |
| `ChainlessChainWSServer`   | class    | WebSocket 服务器核心类                         |
| `tokenizeCommand(input)`   | function | Shell-safe 命令分词器                          |

### 6.2 事件

| 事件名          | 参数                        | 触发时机                 |
| --------------- | --------------------------- | ------------------------ |
| `listening`     | `{ port, host }`            | 服务器开始监听           |
| `connection`    | `{ clientId, ip }`          | 新客户端连接             |
| `disconnection` | `{ clientId, reason? }`     | 客户端断开               |
| `command:start` | `{ id, command, stream }`   | 命令开始执行             |
| `command:end`   | `{ id, exitCode }`          | 命令执行结束             |
| `error`         | `Error`                     | 服务器错误               |
| `stopped`       | —                           | 服务器关闭               |

---

## 七、集成场景

### 7.1 IDE 插件

```javascript
// VS Code 扩展示例
const ws = new WebSocket('ws://127.0.0.1:18800');
ws.onopen = () => {
  ws.send(JSON.stringify({
    id: '1', type: 'execute',
    command: 'note search "TODO" --json'
  }));
};
```

### 7.2 Web 前端

```javascript
// 流式显示 AI 回答
ws.send(JSON.stringify({
  id: '1', type: 'stream',
  command: 'ask "解释一下这段代码"'
}));
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.type === 'stream-data') outputEl.textContent += msg.data;
};
```

### 7.3 自动化脚本 (Python)

```python
import asyncio, json, websockets

async def run_command(cmd):
    async with websockets.connect('ws://127.0.0.1:18800') as ws:
        await ws.send(json.dumps({'id': '1', 'type': 'execute', 'command': cmd}))
        result = json.loads(await ws.recv())
        return result['stdout'] if result['success'] else result['stderr']

notes = asyncio.run(run_command('note list --json'))
```

### 7.4 CI/CD 管道

```yaml
# GitHub Actions 示例
- name: Start ChainlessChain server
  run: chainlesschain serve --token ${{ secrets.CC_TOKEN }} &

- name: Run automated checks
  run: |
    wscat -c ws://127.0.0.1:18800 -x '{"id":"1","type":"auth","token":"${{ secrets.CC_TOKEN }}"}'
    wscat -c ws://127.0.0.1:18800 -x '{"id":"2","type":"execute","command":"doctor"}'
```

---

## 八、测试覆盖

| 测试类型 | 文件                                       | 测试数 | 覆盖范围                                                            |
| -------- | ------------------------------------------ | ------ | ------------------------------------------------------------------- |
| 单元测试 | `ws-server.test.js`                        | 39     | tokenizer(10) + constructor(2) + lifecycle(3) + connection(3) + ping(1) + validation(3) + auth(4) + execute(7) + stream(2) + cancel(1) + timeout(1) + events(1) + blocked(1) |
| 集成测试 | `ws-server-workflow.test.js`               | 7      | 完整 auth→execute→stream 工作流，并发请求，多客户端，阻止命令       |
| 端到端   | `serve-command.test.js`                    | 8      | CLI 二进制启动 serve，WebSocket 连接，认证，流式，阻止命令          |
| **合计** |                                            | **54** |                                                                     |

---

## 九、设计决策

1. **子进程执行策略**：每次命令 spawn 子进程而非进程内调用。优点：零侵入（不修改任何现有命令）、进程隔离（命令崩溃不影响服务器）、自动支持所有命令。缺点：启动开销（~200ms/命令），可接受
2. **ws 库而非 socket.io**：ws 是 Node.js 生态最轻量的 WebSocket 库（零依赖），适合 CLI 工具。socket.io 过重且引入非标准协议
3. **JSON 协议**：所有消息 JSON 编码，无二进制帧。CLI 输出本质是文本，JSON 足够且调试友好
4. **默认 localhost**：安全优先，远程访问通过 `--allow-remote + --token` 显式开启
5. **FORCE_COLOR=0 + NO_SPINNER=1**：子进程环境变量抑制终端格式化（chalk 颜色码、ora 动画），确保输出为纯文本
6. **30s 心跳**：复用项目中 signaling-server 的 ping/pong 模式，检测客户端断线
7. **Token 认证而非 JWT**：CLI 场景下单一 Token 足够，无需 JWT 的过期/刷新复杂性
8. **自实现 tokenizer**：不使用 `shell-quote` 等第三方库（减少依赖），不使用 `shell: true`（防注入），覆盖引号/转义/空白等常见场景
