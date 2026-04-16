# AI 编排层 (orchestrate)

> 让 ChainlessChain 成为 AI 编程任务的编排中心：自动分解任务 → 并行调用 Claude Code / Codex / Gemini 等 AI 工具 → CI/CD 验证 → 多渠道通知。

## 概述

`chainlesschain orchestrate` 实现了 **OpenClaw 架构**：

```
你的指令
  │
  ▼
ChainlessChain（编排层）
  │── LLM 分解任务为子任务
  │── AgentRouter 分发给多个 AI 执行器
  │     ├── Claude Code (claude CLI)
  │     ├── Codex (codex CLI)
  │     ├── Gemini / OpenAI / Ollama (API)
  │     └── 5 种路由策略
  │── CI/CD 自动验证（失败则带错误上下文重试）
  └── 通知结果到 Telegram / 企业微信 / 钉钉 / 飞书 / WebSocket
```

**核心特性：**

- **自动检测** 已安装的 AI CLI 工具（claude、codex）和 API 密钥（Gemini、OpenAI 等）
- **零额外依赖**：只需安装 Claude Code（`npm i -g @anthropic-ai/claude-code`）即可使用
- **CI/CD 闭环**：Agent 执行完成后自动跑 CI，失败则让 Agent 根据错误日志重试
- **双向 IM 集成**：不仅推送通知，还可从企业微信/钉钉/飞书接收任务指令

## 快速开始

```bash
# 安装 Claude Code（执行代理）
npm install -g @anthropic-ai/claude-code

# 检测可用的 AI 工具
chainlesschain orchestrate detect

# 执行一个编程任务
chainlesschain orchestrate "Fix the authentication bug in login.ts"

# 查看编排器状态
chainlesschain orchestrate --status
```

## 命令选项

```
Usage: chainlesschain orchestrate [task] [options]

Arguments:
  task                    任务描述（自然语言）

Options:
  -a, --agents <n>        最大并发 Agent 数 (默认: 3)
  --ci <command>          CI 命令 (默认: npm test)
  --no-ci                 跳过 CI/CD 验证
  --source <type>         来源: cli|sentry|github|file|wecom|dingtalk|feishu
  --file <path>           从文件读取任务（配合 --source file）
  --context <text>        额外上下文（如错误堆栈）
  --cwd <path>            项目根目录（默认：当前目录）
  --provider <name>       分解用 LLM 提供商
  --model <name>          分解用 LLM 模型
  --backends <list>       指定后端：claude,codex,gemini,openai,ollama（逗号分隔）
  --strategy <name>       路由策略：round-robin|by-type|parallel-all|primary (默认: round-robin)
  --retries <n>           CI 失败最大重试次数 (默认: 3)
  --timeout <sec>         单个 Agent 超时秒数 (默认: 300)
  --no-notify             禁用通知
  --status                显示编排器状态
  --watch                 启动定时监控模式
  --interval <min>        监控间隔分钟数 (默认: 10)
  --webhook               启动 HTTP Webhook 服务器（接收 IM 平台指令）
  --webhook-port <port>   Webhook 端口 (默认: 18820)
  --json                  JSON 格式输出
  --verbose               详细日志
  -h, --help              显示帮助
```

## 使用场景

### 场景一：修复 Bug

```bash
# 自动检测到 Claude Code，直接执行
chainlesschain orchestrate "Fix the null reference error in auth.service.ts" \
  --ci "npm run test:unit" \
  --retries 3
```

输出示例：
```
⚡ ChainlessChain Orchestrator

  Task:    Fix the null reference error in auth.service.ts
  CWD:     /workspace/my-app
  Agents:  max 3 × claude
  CI:      npm run test:unit

✅ Task completed [t-1a2b3c]  status: completed

  Summary
  ─────────────────────────────────
  ID:       t-1a2b3c
  Source:   cli
  Retries:  0
  Status:   completed
  Subtasks: 1
  Agents:   1 passed / 0 failed
```

### 场景二：并行多路 Agent

```bash
# 同时用 Claude Code 和 Gemini API 执行，取最优结果
chainlesschain orchestrate "Refactor the payment module" \
  --backends claude,gemini \
  --strategy parallel-all
```

### 场景三：大型重构（多子任务）

```bash
# LLM 自动将大任务分解为多个子任务，并行分发
chainlesschain orchestrate "Add comprehensive unit tests for the user module" \
  --agents 5 \
  --ci "npm test" \
  --retries 5 \
  --verbose
```

### 场景四：从文件读取任务

```bash
# 将复杂需求写入文件，避免命令行长度限制
echo "Implement OAuth2 login with Google and GitHub providers..." > task.txt
chainlesschain orchestrate --source file --file task.txt
```

### 场景五：JSON 输出（脚本集成）

```bash
# 适合 CI/CD 流水线、脚本自动化
result=$(chainlesschain orchestrate "Fix lint errors" --no-ci --json)
status=$(echo $result | node -e "process.stdin|{...}" | jq -r '.status')
echo "Task status: $status"
```

## 路由策略详解

### round-robin（默认）

加权轮询，多后端时按 weight 比例分配子任务：

```bash
# claude 承担更多任务
chainlesschain orchestrate "task" \
  --backends claude,gemini \
  --strategy round-robin
```

### primary

优先使用第一个后端，失败自动切换到下一个：

```bash
# 优先 claude，claude 失败时用 codex
chainlesschain orchestrate "task" \
  --backends claude,codex \
  --strategy primary
```

### parallel-all

所有后端同时执行，选取最优结果（有成功则取成功中最快的）：

```bash
# claude + gemini 同时执行，竞速取优
chainlesschain orchestrate "task" \
  --backends claude,gemini \
  --strategy parallel-all
```

### by-type

根据任务的 `type` 字段路由到最适合的后端（适用于 API/WS 触发时传入类型）。

## 检测已安装工具

```bash
chainlesschain orchestrate detect
```

示例输出：
```
🔍 AI CLI Detection

  ✓ claude  2.1.81 (Claude Code)
  ✗ codex   not found
```

## 查看状态

```bash
chainlesschain orchestrate --status
```

```
⚡ Orchestrator Status

  CLI Tools
    claude:  2.1.81 (Claude Code)
    codex:   not installed

  Auto-detected Backends
    🖥 claude       cli  weight:1
    🌐 ollama       api  weight:1

  Notification Channels
    (none configured — set TELEGRAM_BOT_TOKEN, WECOM_WEBHOOK_URL, etc.)
```

JSON 格式：

```bash
chainlesschain orchestrate --status --json
```

```json
{
  "cliTools": {
    "claude": "2.1.81 (Claude Code)",
    "codex": "not found"
  },
  "activeCliTool": "claude",
  "backends": [
    { "type": "claude", "kind": "cli", "weight": 1 },
    { "type": "ollama", "kind": "api", "weight": 1 }
  ]
}
```

## 通知配置

通过环境变量配置通知渠道，任务完成/失败时自动推送：

```bash
# Telegram
export TELEGRAM_BOT_TOKEN=your-bot-token
export TELEGRAM_CHAT_ID=your-chat-id

# 企业微信群机器人
export WECOM_WEBHOOK_URL=https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...

# 钉钉群机器人（secret 可选，用于加签）
export DINGTALK_WEBHOOK_URL=https://oapi.dingtalk.com/robot/send?access_token=...
export DINGTALK_SECRET=SECxxx   # 可选

# 飞书群机器人（secret 可选，用于签名校验）
export FEISHU_WEBHOOK_URL=https://open.feishu.cn/open-apis/bot/v2/hook/...
export FEISHU_SECRET=xxx        # 可选

# 执行任务（配置了通知渠道会自动推送）
chainlesschain orchestrate "Fix the bug" --ci "npm test"
```

### 通知内容

| 时机 | 内容 |
|------|------|
| 任务开始 | 任务 ID、描述、子任务数 |
| CI 失败 | 失败原因摘要、当前重试次数 |
| 任务完成 | 执行时间、Agent 数、CI 通过 |

## Webhook 模式：从 IM 接收指令

启动 HTTP 服务器，让企业微信/钉钉/飞书群机器人把消息转发给编排器：

```bash
chainlesschain orchestrate --webhook --webhook-port 18820
```

输出：
```
⚡ Orchestrator Webhook Server

  WeCom:    POST http://localhost:18820/wecom
  DingTalk: POST http://localhost:18820/dingtalk
  Feishu:   POST http://localhost:18820/feishu

  Press Ctrl+C to stop
```

### 配置方法

**钉钉**：在机器人设置中将 Webhook 地址设为 `http://your-server:18820/dingtalk`，关键词设为空或任意词。群内发消息即触发任务。

**飞书**：在应用事件订阅中填写 `http://your-server:18820/feishu`，首次配置时自动完成 challenge 验证。

**企业微信**：在群机器人设置中填写回调地址为 `http://your-server:18820/wecom`。

### 工作流程

```
IM 平台群消息
    │  "Fix the login bug"
    ▼
Webhook Server (POST /dingtalk)
    │
    ▼
Orchestrator.addTask()
    │  异步执行，立即返回 200
    ▼
Claude Code 执行 → CI 检查 → 通知结果回群
```

> **提示**：Webhook 服务器在接收到消息后立即返回 HTTP 200（IM 平台要求 5 秒内响应），实际编排在后台异步执行。

## 通过 WebSocket 触发

若使用 `chainlesschain serve` 或 `chainlesschain ui` 已有 WS 连接，可直接发送：

```json
{
  "type": "orchestrate",
  "id": "req-001",
  "task": "Fix the failing test in auth.spec.ts",
  "cwd": "/path/to/project",
  "ciCommand": "npm test"
}
```

进度事件会实时推回同一 WS 连接：

```json
{ "type": "orchestrate:event", "event": "start", "subtaskCount": 2 }
{ "type": "orchestrate:event", "event": "agent:output", "chunk": "Analyzing code..." }
{ "type": "orchestrate:event", "event": "ci:pass", "duration": 45000 }
{ "type": "orchestrate:done", "status": "completed", "retries": 0 }
```

## CI/CD 集成

### 在 GitHub Actions 中使用

```yaml
- name: AI Fix & Verify
  run: |
    npm install -g chainlesschain @anthropic-ai/claude-code
    chainlesschain orchestrate "Fix all TypeScript errors" \
      --ci "npm run type-check" \
      --retries 3 \
      --json \
      --no-ci   # 用 orchestrate 自带的 CI 检查
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

### 与 Sentry 集成

```bash
# 将 Sentry 报错直接作为任务
chainlesschain orchestrate \
  "Fix the error: TypeError at auth.js:42 — Cannot read property 'id' of null" \
  --source sentry \
  --context "User: john@example.com, Env: production" \
  --ci "npm test"
```

## 故障排查

**Q: 执行时报 `No agent backends available`？**

运行 `orchestrate detect` 检查是否安装了 Claude Code。安装方法：
```bash
npm install -g @anthropic-ai/claude-code
claude --version  # 验证安装
```

**Q: CI 一直失败怎么办？**

每次 CI 失败后，Agent 会收到完整的错误输出作为上下文进行重试。可以通过 `--retries` 增加重试次数，或 `--verbose` 查看 Agent 的详细输出。

**Q: 如何只执行不验证 CI？**

```bash
chainlesschain orchestrate "task" --no-ci
```

**Q: 任务太大，Agent 超时了？**

```bash
# 增加 timeout（秒）并多分配并发 Agent
chainlesschain orchestrate "Large refactoring task" \
  --timeout 600 \
  --agents 5
```

**Q: Webhook 服务器无法从外网访问？**

默认绑定 `127.0.0.1`。如需从外网访问（例如配置 IM 平台回调），需要通过 Nginx 反代或内网穿透工具（如 ngrok）暴露：

```bash
# 本地运行
chainlesschain orchestrate --webhook --webhook-port 18820

# 另一个终端（使用 ngrok 暴露）
ngrok http 18820
# 将 ngrok 给出的 HTTPS URL 填写到 IM 平台的 Webhook 设置中
```

## 核心特性

- **自动检测 AI CLI** — 自动发现已安装的 claude、codex 命令行工具及 API 密钥（Gemini、OpenAI、Ollama 等），零配置即可启动
- **5 种路由策略** — round-robin（加权轮询）、primary（主备切换）、parallel-all（并行竞速取优）、by-type（按任务类型路由）、weighted（按权重分配）
- **Webhook 通知集成** — 支持企业微信、钉钉、飞书、Telegram 四大平台的双向集成，既可推送结果通知，也可接收 IM 指令触发任务
- **WebSocket 实时集成** — 通过 `chainlesschain serve` 的 WS 连接触发编排任务，实时接收进度事件和最终结果
- **CI/CD 闭环验证** — Agent 执行完成后自动运行 CI 命令，失败时将错误日志作为上下文让 Agent 重试，支持配置最大重试次数
- **多 Agent 并行执行** — 支持同时调度多个 AI 后端并行处理子任务，自动分解大型任务为可并行的子任务

## 系统架构

```
用户指令 (CLI / WebSocket / Webhook)
        │
        ▼
┌──────────────────────────────────┐
│        orchestrate.js            │  CLI 命令入口，解析参数
│        (Commander)               │
└──────────┬───────────────────────┘
           │
           ▼
┌──────────────────────────────────┐
│        agent-router.js           │  检测已安装的 AI 工具和 API 密钥
│  ┌─────────────────────────────┐ │  维护后端列表及权重
│  │ autoDetect()                │ │  根据策略选择执行后端
│  │ selectBackend(strategy)     │ │
│  └─────────────────────────────┘ │
└──────────┬───────────────────────┘
           │
           ▼
┌──────────────────────────────────┐
│        orchestrator.js           │  任务分解 → 子任务分发 → CI 验证 → 重试
│  ┌────┐  ┌────┐  ┌────┐         │
│  │ 分解 │→│ 路由 │→│ CI  │→ 通知  │
│  └────┘  └────┘  └────┘         │
└──────────┬───────────────────────┘
           │
     ┌─────┴─────┬────────────┐
     ▼           ▼            ▼
┌─────────┐ ┌─────────┐ ┌──────────┐
│ claude- │ │ Gemini  │ │ Ollama   │
│ code-   │ │ /OpenAI │ │ (local)  │
│ bridge  │ │ API     │ │          │
└─────────┘ └─────────┘ └──────────┘
                │
                ▼
┌──────────────────────────────────┐
│        notifiers/                │  通知渠道
│  telegram / wecom / dingtalk /   │
│  feishu                          │
└──────────────────────────────────┘
```

## 配置参考

```bash
# CLI 启动参数
chainlesschain orchestrate [task] [options]
  -a, --agents <n>          # 最大并发 Agent 数 (默认 3)
  --ci <command>            # CI 命令 (默认 npm test)
  --no-ci                   # 跳过 CI/CD 验证
  --source <type>           # cli | sentry | github | file | wecom | dingtalk | feishu
  --file <path>             # 从文件读取任务
  --context <text>          # 额外上下文（错误堆栈等）
  --cwd <path>              # 项目根目录
  --provider <name>         # 分解用 LLM 提供商
  --model <name>            # 分解用 LLM 模型
  --backends <list>         # claude,codex,gemini,openai,ollama
  --strategy <name>         # round-robin | by-type | parallel-all | primary | weighted
  --retries <n>             # CI 失败重试次数 (默认 3)
  --timeout <sec>           # Agent 超时秒数 (默认 300)
  --no-notify               # 禁用通知
  --status                  # 显示状态
  --watch                   # 定时监控模式
  --interval <min>          # 监控间隔 (默认 10)
  --webhook                 # 启动 Webhook 服务器
  --webhook-port <port>     # Webhook 端口 (默认 18820)
  --json                    # JSON 输出
  --verbose                 # 详细日志

# 环境变量（AI 后端）
ANTHROPIC_API_KEY=<key>         # Claude API
OPENAI_API_KEY=<key>            # OpenAI / Codex
GEMINI_API_KEY=<key>            # Gemini API
OLLAMA_HOST=http://localhost:11434

# 环境变量（通知）
TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID
WECOM_WEBHOOK_URL
DINGTALK_WEBHOOK_URL / DINGTALK_SECRET
FEISHU_WEBHOOK_URL / FEISHU_SECRET

# 配置路径
~/.chainlesschain/orchestrate-config.json   # 后端权重、通知渠道持久化
```

## 性能指标

| 操作 | 目标 | 实际 | 状态 |
| --- | --- | --- | --- |
| AI 工具检测 (autoDetect) | < 300ms | ~150ms | ✅ |
| 任务分解 (LLM 调用) | < 5s | ~2.8s (Gemini Flash) | ✅ |
| 单子任务执行 (claude-code) | 依赖任务 | ~30-180s | ✅ |
| parallel-all 并发调度 | 延迟 ≈ 最慢后端 | ≈ max(backends) | ✅ |
| Webhook 事件响应 | < 200ms | ~80ms | ✅ |
| WebSocket 状态推送 | < 50ms | ~20ms | ✅ |

## 测试覆盖率

```
packages/cli/__tests__/
├── unit/
│   ├── ✅ orchestrator.test.js          # 任务分解 / CI 闭环 / 重试
│   ├── ✅ agent-router.test.js          # 5 种路由策略 + autoDetect
│   ├── ✅ claude-code-bridge.test.js    # spawn / 流式解析
│   └── ✅ notifiers-*.test.js           # telegram / wecom / dingtalk / feishu
└── integration/
    ├── ✅ orchestrate-cli.test.js       # CLI 参数解析与分发
    └── ✅ orchestrate-webhook.test.js   # Webhook 事件处理
```

- **路由策略**: round-robin / primary / parallel-all / by-type / weighted 全覆盖
- **CI 闭环**: CI 成功/失败、重试次数上限、错误上下文注入
- **通知渠道**: 四个 IM 平台的签名校验、challenge 验证
- **Webhook**: 企业微信 / 钉钉 / 飞书的回调解析与指令触发

## 安全考虑

| 安全措施 | 说明 |
|----------|------|
| Webhook 本地绑定 | Webhook 服务器默认绑定 `127.0.0.1`，不对外暴露，需通过 Nginx 反代或 ngrok 显式暴露 |
| API 密钥管理 | 所有 AI 后端的 API 密钥通过环境变量传递，不在配置文件或日志中明文存储 |
| 任务输出隔离 | 任务执行结果和代码变更仅保留在本地工作目录，不会自动上传至外部通知服务 |
| 通知内容脱敏 | 推送到 IM 平台的通知仅包含任务状态摘要（ID、状态、耗时），不包含代码内容或敏感上下文 |
| CI 命令限制 | CI 验证命令在本地项目目录中执行，受限于当前用户权限 |
| Claude Code 沙箱 | 当使用 Claude Code 作为后端时，继承其内置的文件读写权限控制 |

## 使用示例

```bash
# 1. 自动检测 AI 后端并显示状态
chainlesschain orchestrate detect
chainlesschain orchestrate --status --json

# 2. 最常见用法：修 bug + CI 闭环
chainlesschain orchestrate "Fix null reference in auth.service.ts" \
  --ci "npm run test:unit" --retries 3

# 3. 并行多路竞速（取最优结果）
chainlesschain orchestrate "Refactor payment module" \
  --backends claude,gemini --strategy parallel-all

# 4. 大任务分解（自动拆分为子任务并并发执行）
chainlesschain orchestrate "Add unit tests for user module" \
  --agents 5 --ci "npm test" --retries 5 --verbose

# 5. 从文件读取任务描述
chainlesschain orchestrate --source file --file ./tasks/bugfix.md

# 6. 从 Sentry 错误堆栈触发
chainlesschain orchestrate "Fix production crash" \
  --source sentry --context "$(cat sentry-stack.txt)"

# 7. Webhook 模式 — 接收 IM 指令
chainlesschain orchestrate --webhook --webhook-port 18820
# 企业微信/钉钉/飞书机器人 @ 即可触发

# 8. 定时监控模式（每 10 分钟检查一次）
chainlesschain orchestrate --watch --interval 10 \
  --source sentry --ci "npm test"

# 9. 跳过 CI、仅执行
chainlesschain orchestrate "Prototype experiment" --no-ci

# 10. 通过 WebSocket 外部触发
# 参考 cli-serve 文档，发送 {type: "orchestrate", task: "..."}
```

## 关键文件

| 文件 | 说明 |
|------|------|
| `packages/cli/src/commands/orchestrate.js` | CLI 命令入口，解析参数并调用 Orchestrator |
| `packages/cli/src/lib/orchestrator.js` | 核心编排器，负责任务分解、子任务分发、CI 验证和重试逻辑 |
| `packages/cli/src/lib/agent-router.js` | Agent 路由器，自动检测后端、维护权重、实现 5 种路由策略 |
| `packages/cli/src/lib/claude-code-bridge.js` | Claude Code CLI 桥接器，通过 `spawn` 调用 `claude -p` 并解析流式输出 |
| `packages/cli/src/lib/notifiers/telegram.js` | Telegram Bot 通知推送 |
| `packages/cli/src/lib/notifiers/wecom.js` | 企业微信 Webhook 通知推送 |
| `packages/cli/src/lib/notifiers/dingtalk.js` | 钉钉 Webhook 通知推送（支持加签） |
| `packages/cli/src/lib/notifiers/feishu.js` | 飞书 Webhook 通知推送（支持签名校验和 challenge 验证） |
| `packages/cli/src/lib/ws-server.js` | WebSocket 服务器中的 `orchestrate` 消息处理 |

## 相关文档

- [WebSocket 服务器 (serve)](./cli-serve) — WebSocket API 接口
- [Web 管理界面 (ui)](./cli-ui) — 浏览器端管理界面
- [AI 问答 (ask)](./cli-ask) — 单次 AI 查询
- [Agent 模式 (agent)](./cli-agent) — 交互式 Agent 会话
- [设计文档 — 模块 74](../design/modules/74-orchestration-layer) — 技术架构详解
