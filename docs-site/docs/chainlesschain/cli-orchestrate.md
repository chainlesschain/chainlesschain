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

## 常见问题

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

## 相关文档

- [WebSocket 服务器 (serve)](./cli-serve) — WebSocket API 接口
- [Web 管理界面 (ui)](./cli-ui) — 浏览器端管理界面
- [AI 问答 (ask)](./cli-ask) — 单次 AI 查询
- [Agent 模式 (agent)](./cli-agent) — 交互式 Agent 会话
- [设计文档 — 模块 74](../design/modules/74-orchestration-layer) — 技术架构详解
