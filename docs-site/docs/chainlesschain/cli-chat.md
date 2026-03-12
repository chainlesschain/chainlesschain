# AI 对话 (chat/ask)

> Headless 命令 — 不依赖桌面 GUI，直接使用核心包运行。适用于服务器、CI/CD、容器化等无桌面环境。

## 核心特性

- 🗣️ **流式输出**: 实时显示 AI 回复，支持 Markdown 渲染
- 🔄 **多提供商**: 支持 Ollama、OpenAI、DeepSeek、DashScope 等 7 个提供商
- 🤖 **代理模式**: `--agent` 参数启用工具调用（读写文件、执行命令）
- 📝 **会话自动保存**: 对话历史自动持久化到数据库
- 💰 **Token 追踪**: 自动记录每次对话的 Token 用量和成本

## 系统架构

```
chat 命令 → chat-repl.js (REPL 循环)
                │
    ┌───────────┼───────────┐
    ▼           ▼           ▼
 用户输入   llm-providers  session-manager
 (readline)  (7 providers)  (自动保存)
    │           │           │
    ▼           ▼           ▼
 斜杠命令   流式 API 调用   SQLite sessions 表
 解析       token-tracker
```

## chat — 交互式对话

启动交互式 AI 对话，支持流式输出。

```bash
chainlesschain chat                     # 默认: Ollama qwen2:7b
chainlesschain chat --model llama3      # 使用其他模型
chainlesschain chat --provider openai --api-key sk-...
chainlesschain chat --agent             # 代理模式（可读写文件、执行命令）
```

### 对话内斜杠命令

| 命令        | 说明         |
| ----------- | ------------ |
| `/exit`     | 退出对话     |
| `/model`    | 切换模型     |
| `/provider` | 切换提供商   |
| `/clear`    | 清空对话历史 |
| `/history`  | 查看对话历史 |
| `/help`     | 显示帮助     |

## ask — 单次问答

非交互式单次 AI 问答，适用于脚本和 CI/CD 流水线。

```bash
chainlesschain ask "什么是WebRTC?"
chainlesschain ask "解释这段代码" --model gpt-4o --provider openai
chainlesschain ask "Hello" --json       # JSON输出（含问题/回答/模型信息）
```

## 关键文件

- `packages/cli/src/commands/chat.js` — chat/ask 命令实现
- `packages/cli/src/repl/chat-repl.js` — 交互式对话 REPL（流式输出）
- `packages/cli/src/lib/llm-providers.js` — 多 LLM 提供商适配

## 安全考虑

- API Key 通过 `--api-key` 传递时不会写入历史记录
- 对话内容仅保存在本地数据库，不上传到第三方服务
- 使用 `--provider ollama` 时数据完全离线处理

## 使用示例

### 场景 1：本地离线对话

```bash
chainlesschain chat
chainlesschain chat --model llama3
```

使用本地 Ollama 模型进行交互式对话，数据完全不出设备，适合处理敏感信息。

### 场景 2：Agent 模式辅助开发

```bash
chainlesschain chat --agent
```

启用代理模式后，AI 可以读写文件、执行命令，适合代码生成、文件修改等开发场景。对话中使用 `/help` 查看可用工具。

### 场景 3：脚本集成单次问答

```bash
chainlesschain ask "将以下 JSON 转为 YAML 格式：{\"name\":\"test\"}" --json
chainlesschain ask "解释 WebRTC 的 ICE 候选流程" --provider openai --api-key sk-xxx
```

非交互模式适合在 CI/CD 流水线或脚本中调用，`--json` 输出便于程序解析。

## 故障排查

| 问题 | 解决方案 |
|------|---------|
| 连接 Ollama 超时 | 确认 Ollama 已启动：`ollama serve`，检查端口 11434 |
| OpenAI API 报错 401 | 检查 API Key 是否正确，是否有余额 |
| 中文乱码 | 确保终端编码为 UTF-8：`chcp 65001` (Windows) |
| 流式输出卡住 | 检查网络连接，或切换到本地模型 |

## 相关文档

- [LLM 管理](./cli-llm) — 模型列表与提供商管理
- [代理模式](./cli-agent) — 带工具调用的高级对话
- [会话管理](./cli-session) — 对话历史持久化与恢复
- [Token 追踪](./cli-tokens) — 用量统计与成本分析
