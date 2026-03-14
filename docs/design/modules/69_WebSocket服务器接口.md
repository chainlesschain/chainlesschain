# WebSocket 服务器接口设计

**版本**: v5.0.1 (Phase 2: 有状态会话)
**创建日期**: 2026-03-14
**更新日期**: 2026-03-15
**状态**: ✅ 已实现 (Phase 1 + Phase 2)

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
| **协议简洁**      | JSON-over-WebSocket，12 种消息类型（Phase 1: 5 + Phase 2: 7），13 种错误码，客户端实现成本极低        |
| **有状态会话**    | Phase 2 支持 agent/chat 有状态会话，per-session 隔离，SlotFiller 参数填充，InteractivePlanner 计划生成 |

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
│   └── e2e/serve-command.test.js                  # 8 端到端测试（Phase 1）
│   ├── e2e/agent-enhancements.test.js             # 16 端到端测试（Phase 2）
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

## 四、安全机制

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

### 4.4 阻止的命令

| 命令     | 原因                            | Phase 2 变更 |
| -------- | ------------------------------- | ------------ |
| `serve`  | 防止递归启动（fork bomb 风险）  | 仍阻止 |
| `chat`   | 需要 TTY 交互式输入             | Phase 2 通过 `session-create` 会话模式支持 |
| `agent`  | 需要 TTY 交互式输入             | Phase 2 通过 `session-create` 会话模式支持 |
| `setup`  | 需要 TTY 交互式安装向导         | 仍阻止 |

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

## 八、测试覆盖 (Phase 1)

| 测试类型 | 文件                                       | 测试数 | 覆盖范围                                                            |
| -------- | ------------------------------------------ | ------ | ------------------------------------------------------------------- |
| 单元测试 | `ws-server.test.js`                        | 39     | tokenizer(10) + constructor(2) + lifecycle(3) + connection(3) + ping(1) + validation(3) + auth(4) + execute(7) + stream(2) + cancel(1) + timeout(1) + events(1) + blocked(1) |
| 集成测试 | `ws-server-workflow.test.js`               | 7      | 完整 auth→execute→stream 工作流，并发请求，多客户端，阻止命令       |
| 端到端   | `serve-command.test.js`                    | 8      | CLI 二进制启动 serve，WebSocket 连接，认证，流式，阻止命令          |
| **Phase 1 合计** |                                    | **54** |                                                                     |

> Phase 2 新增 196 测试，总计 **250 测试**。详见第十章 10.7 节。

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

---

## 十、Phase 2: 有状态会话架构 (v0.41.0)

### 10.1 背景

Phase 1 的 WebSocket 服务器是无状态 RPC 模式——每条命令 spawn 独立子进程，`chat`/`agent` 被屏蔽。Phase 2 引入有状态会话，允许客户端通过 WebSocket 创建、管理和交互 agent/chat 会话，实现类似 Claude Code 的远程控制体验。

### 10.2 新增模块结构

```
packages/cli/
├── src/lib/
│   ├── ws-server.js                # 核心 WS 服务器（修改：新增 7 种会话消息类型）
│   ├── interaction-adapter.js      # 用户交互抽象层（新增）
│   ├── agent-core.js               # Agent 核心业务逻辑（新增，从 agent-repl.js 提取）
│   ├── chat-core.js                # Chat 流式核心逻辑（新增，从 chat-repl.js 提取）
│   ├── ws-session-manager.js       # WS 会话注册表 + 生命周期管理（新增）
│   ├── ws-agent-handler.js         # WS Agent 会话处理器（新增）
│   ├── ws-chat-handler.js          # WS Chat 会话处理器（新增）
│   ├── slot-filler.js              # 参数槽填充（新增，从桌面版移植）
│   ├── interactive-planner.js      # 交互式计划生成（新增，从桌面版移植）
│   └── plan-mode.js                # Plan Mode 引擎（修改：新增 slot filling 集成）
├── src/commands/
│   └── serve.js                    # serve 命令（修改：新增 --project 选项）
├── src/repl/
│   └── agent-repl.js               # Agent REPL（修改：集成 interactive-planner）
├── __tests__/
│   ├── unit/
│   │   ├── interaction-adapter.test.js       # 24 测试
│   │   ├── agent-core.test.js                # 34 测试
│   │   ├── chat-core.test.js                 # 10 测试
│   │   ├── ws-session-manager.test.js        # 26 测试
│   │   ├── ws-agent-handler.test.js          # 20 测试
│   │   ├── ws-chat-handler.test.js           # 11 测试
│   │   ├── slot-filler.test.js               # 23 测试
│   │   └── interactive-planner.test.js       # 20 测试
│   ├── integration/
│   │   └── ws-session-workflow.test.js        # 12 集成测试
│   └── e2e/
│       └── agent-enhancements.test.js         # 16 端到端测试
```

### 10.3 核心类设计

#### InteractionAdapter（交互抽象层）

```
InteractionAdapter (abstract) {
  async askInput(question, options) → string
  async askSelect(question, choices) → string
  async askConfirm(question, defaultVal) → boolean
  emit(eventType, data) → void
}

TerminalInteractionAdapter extends InteractionAdapter {
  // 封装 prompts.js，直接在终端 readline 中交互
}

WebSocketInteractionAdapter extends InteractionAdapter {
  constructor(ws, sessionId)
  // askInput/askSelect → ws.send({ type: "question" }) + 等待 session-answer
  // emit → ws.send({ type: eventType, sessionId, ...data })
  resolveAnswer(requestId, answer)  // ws-server 调用，解除 Promise
}
```

#### WSSessionManager（会话注册表）

```
WSSessionManager {
  constructor({ db, config, defaultProjectRoot })
  createSession({ type, projectRoot, provider, model, apiKey, baseUrl }) → { sessionId }
  resumeSession(sessionId) → session
  closeSession(sessionId)
  listSessions() → [{ id, type, status, createdAt, lastActivity }]
  getSession(sessionId) → session
  persistMessages(sessionId) → void
}
```

每个 session 包含：
- `messages[]` — 完整对话历史
- `contextEngine` — CLIContextEngineering 实例（per-session 隔离）
- `permanentMemory` — CLIPermanentMemory 实例
- `planManager` — PlanModeManager 新实例（非单例）
- `provider/model/apiKey/baseUrl` — LLM 配置
- `projectRoot` — 项目根目录
- `interaction` — WebSocketInteractionAdapter 实例

#### WSAgentHandler / WSChatHandler

```
WSAgentHandler {
  constructor({ session, interaction, db })
  async handleMessage(userMessage, requestId)   // 一轮对话
  handleSlashCommand(command, requestId)         // /plan, /model, /task 等
  destroy()                                      // 清理资源
}

WSChatHandler {
  constructor({ session, interaction })
  async handleMessage(userMessage, requestId)   // 流式对话
  handleSlashCommand(command, requestId)
  destroy()
}
```

#### CLISlotFiller（参数槽填充）

```
CLISlotFiller {
  constructor({ llmChat, db, interaction })
  async fillSlots(intent, context)          // 检测缺失 → 推断 → 提问
  inferFromContext(slotName, context)        // 规则推断
  async askUser(slotName, slotConfig)        // 通过 interaction adapter 提问
  async inferWithLLM(slots, context)         // LLM 低温推断
  validateSlots(intentType, entities)        // 验证完整性
  async learnUserPreference(intent, slot)    // 偏好学习
}
```

#### CLIInteractivePlanner

```
CLIInteractivePlanner extends EventEmitter {
  constructor({ llmChat, db, interaction })
  async startPlanSession(userRequest, projectContext)   // 生成计划
  async handleUserResponse(sessionId, response)         // confirm/adjust/regenerate/cancel
  recommendSkills(userRequest, taskPlan)                // 技能推荐
  evaluateQuality(session)                              // 质量评分
  formatPlanForUser(session)                            // 格式化展示
}
```

### 10.4 会话协议扩展

#### Client → Server（7 种新消息类型）

| type | 说明 | 额外字段 | 备注 |
|------|------|----------|------|
| `session-create` | 创建 agent/chat 会话 | `sessionType`, `provider`, `model`, `apiKey`, `baseUrl`, `projectRoot` | 可指定项目上下文 |
| `session-resume` | 从 DB 恢复历史会话 | `sessionId` | 加载历史消息 |
| `session-message` | 发送用户消息到会话 | `sessionId`, `content` | 触发 agent loop |
| `session-list` | 列出所有会话 | — | 返回会话列表 |
| `session-close` | 关闭会话 | `sessionId` | 清理 handler + manager |
| `slash-command` | 发送 slash 命令 | `sessionId`, `command` | /plan, /model, /task 等 |
| `session-answer` | 回答 SlotFiller/Planner 的提问 | `sessionId`, `requestId`, `answer` | 解除 pending question |

#### Server → Client（新增响应类型）

| type | 说明 |
|------|------|
| `session-created` | 会话已创建，含 `sessionId`, `sessionType` |
| `session-resumed` | 会话已恢复，含 `sessionId`, `history[]` |
| `tool-executing` | 正在执行工具，含 `tool`, `args` |
| `tool-result` | 工具执行结果 |
| `response-token` | 流式 token |
| `response-complete` | 完整响应 |
| `question` | 向用户提问（SlotFiller/Planner），含 `questionType`, `choices` |
| `plan-ready` | 计划已生成，等待确认 |
| `command-response` | slash 命令结果 |
| `session-list-result` | 会话列表 |

#### 新增错误码

| code | 说明 |
|------|------|
| `NO_SESSION_SUPPORT` | 服务器未配置 sessionManager |
| `SESSION_NOT_FOUND` | 找不到指定会话或 handler |
| `SESSION_CREATE_FAILED` | 会话创建失败 |
| `MESSAGE_FAILED` | 消息处理失败 |

### 10.5 项目上下文绑定

`session-create` 支持 `projectRoot` 参数，创建会话时自动加载项目上下文：

1. `{projectRoot}/.chainlesschain/rules.md` → 注入 system prompt
2. `{projectRoot}/.chainlesschain/skills/` → workspace 层 skills
3. `{projectRoot}/.chainlesschain/config.json` → 项目配置

```
客户端: {"id":"1","type":"session-create","sessionType":"agent","projectRoot":"/my/project"}
    ↓
WSSessionManager.createSession()
    ↓ 加载 rules.md + workspace skills + config
    ↓ 创建 per-session ContextEngine + PermanentMemory + PlanManager
    ↓
WSAgentHandler 初始化
    ↓ 注入 WebSocketInteractionAdapter
    ↓
服务器: {"id":"1","type":"session-created","sessionId":"session-xxx","sessionType":"agent"}
```

### 10.6 serve 命令更新

```bash
chainlesschain serve [options]

Options:
  -p, --port <port>        端口号 (默认: 18800)
  -H, --host <host>        绑定地址 (默认: 127.0.0.1)
  --token <token>          认证 Token
  --max-connections <n>    最大连接数 (默认: 10)
  --timeout <ms>           命令超时毫秒 (默认: 30000)
  --allow-remote           允许非本地连接 (需配合 --token)
  --project <path>         默认项目根目录（会话创建时的 fallback）  ← Phase 2 新增
```

> **v0.41.1 更新**: `serve.js` 已调用 `bootstrap()` 初始化 DB 并自动创建 `WSSessionManager` 注入到服务器。会话功能现已默认启用。

### 10.7 测试覆盖更新

| 测试类型 | 文件 | 测试数 | 覆盖范围 |
|----------|------|--------|----------|
| 单元测试 | `ws-server.test.js` | 39 | tokenizer + constructor + lifecycle + connection + ping + auth + execute + stream + cancel + timeout + events + blocked |
| 单元测试 | `interaction-adapter.test.js` | 24 | Terminal/WebSocket adapter, askInput/askSelect/askConfirm, resolveAnswer, timeout |
| 单元测试 | `agent-core.test.js` | 34 | AGENT_TOOLS(9), systemPrompt, executeTool, chatWithTools, agentLoop generator, hook pipeline |
| 单元测试 | `chat-core.test.js` | 10 | chatStream generator, provider routing, streamOllama, streamOpenAI |
| 单元测试 | `ws-session-manager.test.js` | 26 | createSession, resumeSession, closeSession, listSessions, persistMessages, project context |
| 单元测试 | `ws-agent-handler.test.js` | 20 | handleMessage, handleSlashCommand, plan mode, event emission, concurrent guard |
| 单元测试 | `ws-chat-handler.test.js` | 11 | handleMessage, slash commands (/model, /provider, /clear, /history) |
| 单元测试 | `slot-filler.test.js` | 23 | fillSlots, inferFromContext, askUser, inferWithLLM, validateSlots, learnUserPreference |
| 单元测试 | `interactive-planner.test.js` | 20 | startPlanSession, handleUserResponse, recommendSkills, evaluateQuality, formatPlan |
| 集成测试 | `ws-server-workflow.test.js` | 7 | auth→execute→stream 完整工作流 |
| 集成测试 | `ws-session-workflow.test.js` | 12 | session-create/resume/message/list/close/slash/answer 完整工作流 |
| 端到端 | `serve-command.test.js` | 8 | CLI 二进制启动 serve，WebSocket 连接 |
| 端到端 | `agent-enhancements.test.js` | 16 | agent-core tools, run_code, MAX_ITERATIONS, enhanced prompts |
| **合计** | | **250** | |

### 10.8 设计决策（Phase 2）

1. **per-session 隔离**：每个 WS 会话拥有独立的 ContextEngine、PermanentMemory、PlanModeManager 实例，避免多会话间状态污染
2. **InteractionAdapter 抽象**：统一终端和 WebSocket 两种交互模式。SlotFiller/InteractivePlanner 通过抽象层提问，不关心底层传输方式
3. **懒加载 handler 模块**：`_handleSessionCreate` 使用 `await import()` 动态加载 ws-agent-handler.js / ws-chat-handler.js / interaction-adapter.js，避免 ws-server.js 的静态依赖树膨胀和循环依赖
4. **async _handleMessage**：会话创建涉及 `await import()`，因此 `_handleMessage` 改为 async。非会话消息（ping/execute/stream 等）不受影响
5. **Fire-and-forget 消息处理**：`session-message` 触发 agent loop 后不阻塞 `_handleMessage`，通过 interaction adapter 异步推送事件流到客户端
6. **从 agent-repl.js 提取 agent-core.js**：将工具定义、系统提示词、工具执行、LLM 调用、agent loop 等核心逻辑提取为传输无关的模块。REPL 和 WebSocket handler 都消费同一套逻辑
7. **SlotFiller 通过 interaction adapter 提问**：终端模式用 readline，WebSocket 模式发 `question` 消息并等待 `session-answer` 回复，统一提问体验
8. **SlotFiller 集成到 agentLoop**（v0.41.1）：在 agentLoop 调用 LLM 前增加 slot-filling 阶段。`detectIntent()` 使用正则匹配 9 种意图类型，`_extractEntities()` 提取实体。终端 REPL、WebSocket handler 均传入 `slotFiller` + `interaction` 选项
9. **serve.js 接入 WSSessionManager**（v0.41.1）：调用 `bootstrap()` 获取 DB 实例，创建 `WSSessionManager({ db, defaultProjectRoot })` 注入到服务器构造函数。会话功能默认启用
10. **session-resume 重建 handler**（v0.41.1）：`_handleSessionResume` 现在在恢复会话后自动创建 `WebSocketInteractionAdapter` 和 `WSAgentHandler`/`WSChatHandler`，确保后续 `session-message` 可正常处理
