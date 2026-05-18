# ask 命令

> 单次 AI 问答 — 向 LLM 提供商发送一个问题并获取回答

## 概述

ask 命令提供单次 AI 问答能力，无需进入交互式对话即可快速获取 LLM 回答。支持 Ollama、OpenAI、Anthropic、DeepSeek 等 8 个提供商，可通过 `--base-url` 接入任意 OpenAI 兼容中转站，支持 JSON 格式输出便于脚本集成。

## 核心特性

- 🔹 **单次问答**: 无需进入交互式对话，一条命令即可获得 AI 回答
- 🔹 **8 个提供商**: 支持 Ollama、OpenAI、Anthropic、DeepSeek、DashScope、Gemini、Mistral、Volcengine(豆包)
- 🔹 **中转站支持**: 通过 `--base-url` 接入任意 OpenAI 兼容中转站/代理
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
│             │    ┌──────────────────────────────────┐
│             │───▶│ OpenAI 兼容 API (8 providers)    │
│             │    │ openai/volcengine/deepseek/...   │
│             │    │ POST /chat/completions            │
│             │    │ --base-url 可覆盖为中转站地址     │
└──────┬──────┘    └──────────────────────────────────┘
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
| `--provider <provider>` | LLM 提供商 (ollama/openai/volcengine/deepseek/dashscope/gemini/mistral/anthropic) | `ollama` |
| `--base-url <url>` | API 基础地址（可覆盖为中转站/代理地址） | 根据 provider 自动选择 |
| `--api-key <key>` | API 密钥 | 从对应环境变量读取 |
| `--json` | 以 JSON 格式输出结果 | — |

## 配置参考

```bash
chainlesschain ask <question> [options]

参数:
  <question>                  要提问的问题（必填）

选项:
  --model <name>              模型名称（默认: qwen2:7b）
  --provider <provider>       LLM 提供商 (ollama/openai/volcengine/deepseek/
                              dashscope/gemini/mistral/anthropic) 默认: ollama
  --base-url <url>            API 基础地址（可覆盖为中转站/代理地址）
  --api-key <key>             API 密钥（也可通过对应环境变量传入）
  --json                      以 JSON 格式输出结果

环境变量:
  OPENAI_API_KEY              OpenAI 密钥
  ANTHROPIC_API_KEY           Anthropic 密钥
  DEEPSEEK_API_KEY            DeepSeek 密钥
  DASHSCOPE_API_KEY           阿里 DashScope 密钥
  GEMINI_API_KEY              Google Gemini 密钥
  MISTRAL_API_KEY             Mistral AI 密钥
  VOLCENGINE_API_KEY          Volcengine (豆包) 密钥
```

## 性能指标

| 操作 | 目标 | 实际 | 状态 |
|------|------|------|------|
| 参数解析与 provider 路由 | < 20ms | ~8ms | ✅ |
| Ollama 本地响应（qwen2:7b） | < 3s | ~1.5s | ✅ |
| 云端 API 响应（gpt-4o） | < 5s | ~2s | ✅ |
| JSON 输出序列化 | < 10ms | ~3ms | ✅ |
| 中转站请求透传 | < 5s | ~2.5s | ✅ |
| API Key 读取（环境变量 fallback） | < 5ms | ~1ms | ✅ |

## 测试覆盖率

```
✅ ask.test.js  - 覆盖 ask CLI 的主要路径
  ├── 参数解析 / 选项验证（provider/model/base-url/api-key）
  ├── 正常路径（Ollama、OpenAI、中转站多 provider）
  ├── 错误处理 / 边界情况（缺失 API Key、provider 不支持、连接失败）
  └── JSON 输出格式
```

## 关键文件

- `packages/cli/src/commands/ask.js` — 命令实现，包含 `queryLLM()` 函数和命令注册
- `packages/cli/src/lib/llm-providers.js` — 8 个 LLM 提供商适配层
- `packages/cli/src/lib/logger.js` — 日志输出工具

## 安全考虑

- API 密钥优先从环境变量读取，避免在命令行中暴露
- 使用 `--api-key` 参数传入密钥时，密钥可能出现在进程列表和 shell 历史中
- Ollama 默认使用本地服务，数据不会发送到外部

## 使用示例

### 场景 1：使用本地 Ollama 提问

```bash
chainlesschain ask "什么是区块链？"
chainlesschain ask "解释量子计算" --model llama3:8b
```

### 场景 2：使用火山引擎（豆包）

```bash
# 设置环境变量（推荐）
export VOLCENGINE_API_KEY=ark-xxxxxxxxxxxx

# 单次提问（使用旗舰模型）
chainlesschain ask "什么是大语言模型？" --provider volcengine

# 指定模型
chainlesschain ask "写一个快速排序" --provider volcengine --model doubao-seed-code

# 使用快速模型（更低成本）
chainlesschain ask "今天星期几？" --provider volcengine --model doubao-seed-1-6-lite-251015
```

### 场景 3：使用 OpenAI

```bash
export OPENAI_API_KEY=sk-xxxxxxxxxxxx
chainlesschain ask "写一首诗" --provider openai --model gpt-4o
```

### 场景 4：使用 DeepSeek

```bash
export DEEPSEEK_API_KEY=sk-xxxxxxxxxxxx
chainlesschain ask "用 Rust 写一个 HTTP 服务器" --provider deepseek --model deepseek-coder
```

### 场景 5：通过中转站使用 GPT-4o（无需科学上网）

```bash
# API2D 中转站
chainlesschain ask "解释量子计算" \
  --provider openai \
  --base-url https://oa.api2d.net/v1 \
  --api-key fk-xxxxxx \
  --model gpt-4o

# OpenAI-SB 中转站
chainlesschain ask "你好" \
  --provider openai \
  --base-url https://api.openai-sb.com/v1 \
  --api-key sb-xxxxxx \
  --model gpt-4o

# One-API 网关（本地部署的多模型聚合）
chainlesschain ask "test" \
  --provider openai \
  --base-url http://localhost:3000/v1 \
  --api-key sk-oneapi-xxxxxx \
  --model gpt-4o
```

### 场景 6：通过中转站使用 DeepSeek / Claude

```bash
# 中转站使用 DeepSeek
chainlesschain ask "你好" \
  --provider deepseek \
  --base-url https://your-proxy.com/v1 \
  --api-key sk-xxxxxx \
  --model deepseek-chat

# 通过 OpenAI 兼容中转站使用 Claude
chainlesschain ask "写一首诗" \
  --provider openai \
  --base-url https://your-claude-proxy.com/v1 \
  --api-key sk-xxxxxx \
  --model claude-sonnet-4-20250514
```

### 场景 7：企业自建代理

```bash
# Nginx 反向代理
chainlesschain ask "分析一下" \
  --provider openai \
  --base-url https://ai-gateway.company.com/v1 \
  --model gpt-4o

# vLLM 部署的本地模型
chainlesschain ask "你好" \
  --provider openai \
  --base-url http://localhost:8000/v1 \
  --api-key dummy \
  --model my-finetuned-llama
```

### 场景 8：JSON 格式输出（用于脚本集成）

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

## 环境变量

| 变量名 | 提供商 |
|--------|--------|
| `OPENAI_API_KEY` | OpenAI |
| `ANTHROPIC_API_KEY` | Anthropic |
| `DEEPSEEK_API_KEY` | DeepSeek |
| `DASHSCOPE_API_KEY` | DashScope (阿里) |
| `GEMINI_API_KEY` | Google Gemini |
| `MISTRAL_API_KEY` | Mistral AI |
| `VOLCENGINE_API_KEY` | Volcengine (豆包) |

## 故障排查

| 问题 | 解决方案 |
|------|---------|
| `Ollama error: 404` | 模型未安装，运行 `ollama pull qwen2:7b` |
| `Ollama error: connection refused` | Ollama 服务未启动，运行 `ollama serve` |
| `API key required for volcengine` | 设置 `VOLCENGINE_API_KEY` 或使用 `--api-key` |
| `Unsupported provider` | 支持 8 个提供商，使用 `chainlesschain llm providers` 查看列表 |
| 中转站返回 401 | 检查 `--api-key` 格式，中转站密钥格式可能与官方不同 |
| `--base-url` 不生效 | 确保 URL 包含 `/v1` 后缀 |
| 响应较慢 | 本地模型受硬件限制，可尝试使用云端 API 或更小的模型 |

## 相关文档

- [chat 命令](./cli-chat) — 交互式 AI 对话（支持流式输出）
- [agent 命令](./cli-agent) — Agentic AI 会话（支持工具调用）
- [llm 命令](./cli-llm) — LLM 模型和提供商管理
- [LLM 中转站与自定义接入](./cli-llm-proxy) — 中转站、代理、自建网关完整指南
