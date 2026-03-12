# ask 命令

> 单次 AI 问答 — 向 LLM 提供商发送一个问题并获取回答

## 核心特性

- 🔹 **单次问答**: 无需进入交互式对话，一条命令即可获得 AI 回答
- 🔹 **多提供商支持**: 支持 Ollama（本地）和 OpenAI（云端）两种 LLM 提供商
- 🔹 **模型可选**: 通过 `--model` 参数指定任意已安装模型
- 🔹 **JSON 输出**: 支持 `--json` 格式化输出，便于脚本集成
- 🔹 **API 密钥管理**: 支持命令行参数或环境变量传入 API 密钥

## 系统架构

```
用户输入问题
    │
    ▼
┌─────────────┐
│  ask 命令   │
│  参数解析    │
└──────┬──────┘
       │
       ▼
┌─────────────┐    ┌──────────────┐
│  queryLLM() │───▶│ Ollama API   │  POST /api/generate
│  路由分发    │    │ (本地 11434) │
│             │    └──────────────┘
│             │    ┌──────────────┐
│             │───▶│ OpenAI API   │  POST /v1/chat/completions
│             │    │ (云端)       │
└──────┬──────┘    └──────────────┘
       │
       ▼
┌─────────────┐
│ 格式化输出   │  文本 / JSON
└─────────────┘
```

## 用法

```bash
chainlesschain ask <question> [options]
```

### 参数

| 参数 | 说明 |
|------|------|
| `<question>` | 要提问的问题（必填） |

### 选项

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `--model <model>` | 模型名称 | `qwen2:7b` |
| `--provider <provider>` | LLM 提供商 (`ollama`, `openai`) | `ollama` |
| `--base-url <url>` | API 基础地址 | Ollama: `http://localhost:11434`，OpenAI: `https://api.openai.com/v1` |
| `--api-key <key>` | API 密钥（OpenAI 必需） | 从 `OPENAI_API_KEY` 环境变量读取 |
| `--json` | 以 JSON 格式输出结果 | — |

## 关键文件

- `packages/cli/src/commands/ask.js` — 命令实现，包含 `queryLLM()` 函数和命令注册
- `packages/cli/src/lib/logger.js` — 日志输出工具

## 安全考虑

- API 密钥可通过环境变量 `OPENAI_API_KEY` 传入，避免在命令行中暴露
- 使用 `--api-key` 参数传入密钥时，密钥可能出现在进程列表和 shell 历史中
- Ollama 默认使用本地服务，数据不会发送到外部

## 使用示例

### 场景 1：使用本地 Ollama 提问

```bash
chainlesschain ask "什么是区块链？"
```

### 场景 2：指定模型

```bash
chainlesschain ask "解释量子计算" --model llama3:8b
```

### 场景 3：使用 OpenAI 提问

```bash
chainlesschain ask "写一首诗" --provider openai --api-key sk-xxx
```

### 场景 4：JSON 格式输出（用于脚本集成）

```bash
chainlesschain ask "今天天气如何？" --json
```

输出示例：
```json
{
  "question": "今天天气如何？",
  "answer": "...",
  "model": "qwen2:7b",
  "provider": "ollama"
}
```

### 场景 5：自定义 API 地址

```bash
chainlesschain ask "Hello" --provider ollama --base-url http://192.168.1.100:11434
```

## 故障排查

| 问题 | 解决方案 |
|------|---------|
| `Ollama error: 404` | 模型未安装，运行 `ollama pull qwen2:7b` |
| `Ollama error: connection refused` | Ollama 服务未启动，运行 `ollama serve` |
| `OpenAI API key required` | 设置环境变量 `OPENAI_API_KEY` 或使用 `--api-key` 参数 |
| `Unsupported provider` | 仅支持 `ollama` 和 `openai` 两种提供商 |
| 响应较慢 | 本地模型受硬件限制，可尝试使用较小的模型如 `qwen2:1.5b` |

## 相关文档

- [chat 命令](./cli-chat) — 交互式 AI 对话（支持流式输出）
- [agent 命令](./cli-agent) — Agentic AI 会话（支持工具调用）
- [llm 命令](./cli-llm) — LLM 模型和提供商管理
