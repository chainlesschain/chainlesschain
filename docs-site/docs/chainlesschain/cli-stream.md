# 流式输出 (stream)

> Headless 命令 — 不依赖桌面 GUI，直接使用核心包运行。适用于服务器、CI/CD、容器化等无桌面环境。

## 核心特性

- 📡 **NDJSON 流**: 将 LLM 响应以 StreamEvent 对象逐行输出到 stdout
- 📝 **文本模式**: `--text` 收集完整响应后输出拼接文本
- 🔄 **多 Provider 支持**: 支持 ollama、openai、anthropic 等多个 LLM 提供商
- ⚙️ **可脚本化**: 标准 NDJSON 输出，便于管道和脚本消费

## 概述

ChainlessChain CLI stream 命令是 session-core StreamRouter 的脚本化入口。将单个 prompt 通过指定的 LLM 提供商流式传输，以 NDJSON（Newline Delimited JSON）格式在 stdout 上逐行输出 StreamEvent 对象，下游脚本可逐行消费。

默认模式输出每个 StreamEvent 为一行 JSON；`--text` 模式调用 `router.collect()` 等待流结束后输出拼接的纯文本。此命令是 Managed Agents Phase H 的 CLI 对称入口，与 Desktop 的 `agent:stream:start` IPC 和 WebSocket `stream.run` 路由功能对等。

## 命令参考

### stream — 流式 prompt

```bash
chainlesschain stream "<prompt>"
chainlesschain stream "用一句话解释量子计算"
chainlesschain stream "Summarize this concept" --provider openai --model gpt-4o
chainlesschain stream "写一首诗" --provider anthropic --api-key sk-xxx
chainlesschain stream "Hello" --text
chainlesschain stream "分析代码" --base-url http://localhost:8080/v1
```

#### 参数

| 参数 | 说明 |
|------|------|
| `<prompt>` | 必填，要发送给 LLM 的提示词 |

#### 选项

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `--provider <provider>` | LLM 提供商 | `ollama`（或 config 中的配置） |
| `--model <model>` | 模型名称 | 配置文件中的默认模型 |
| `--base-url <url>` | API 基础 URL | 配置文件中的默认值 |
| `--api-key <key>` | API 密钥 | 配置文件中的默认值 |
| `--text` | 输出拼接后的纯文本而非 NDJSON | 关闭 |

## 输出格式

### NDJSON 模式（默认）

每行输出一个 JSON 对象，遵循 StreamEvent 协议：

```jsonl
{"type":"text_delta","text":"量子","ts":1713000000001}
{"type":"text_delta","text":"计算","ts":1713000000002}
{"type":"text_delta","text":"是...","ts":1713000000003}
{"type":"stream_end","ts":1713000000004}
```

错误时输出 error 事件：

```jsonl
{"type":"error","error":"Connection refused","ts":1713000000005}
```

### 文本模式（--text）

等待流完成后输出拼接的完整文本：

```
量子计算是一种利用量子力学原理进行信息处理的新型计算范式。
```

## 配置优先级

命令行选项 > `~/.chainlesschain/config.json` 中的 `llm` 配置 > 默认值（ollama）

```json
{
  "llm": {
    "provider": "ollama",
    "model": "qwen2:7b",
    "baseUrl": "http://localhost:11434",
    "apiKey": ""
  }
}
```

## 系统架构

```
用户命令 → stream.js (Commander)
              │
              ▼
         config-manager.js (加载 LLM 配置)
              │
              ▼
     provider-stream.js (构建 provider source)
              │
              ▼
     session-core StreamRouter
         │              │
         ▼              ▼
    stream()       collect()
    (NDJSON)       (--text)
         │              │
         ▼              ▼
       stdout         stdout
```

## 关键文件

| 文件 | 职责 |
|------|------|
| `packages/cli/src/commands/stream.js` | stream 命令主入口 |
| `packages/cli/src/lib/provider-stream.js` | LLM 提供商流式适配器 |
| `packages/cli/src/lib/session-core-singletons.js` | StreamRouter 单例工厂 |
| `packages/cli/src/lib/config-manager.js` | 配置加载 |

## 配置参考

| 配置项 | 含义 | 默认 |
| ------ | ---- | ---- |
| `--provider` | LLM 提供商 | `ollama` |
| `--model` | 模型名 | 由 provider 决定 |
| `--base-url` | 自定义网关 | 依赖 `.env` |
| `--text` | 仅输出文本（关闭 NDJSON） | false |
| `--max-tokens` | 最大生成 token | 2048 |
| `--temperature` | 采样温度 | 0.7 |

事件流格式：每行一个 JSON（`{"delta": "..."}` / `{"done": true, "usage": {...}}`）。

## 性能指标

| 指标 | 典型值 | 备注 |
| ---- | ------ | ---- |
| 首 token 延迟 | 依赖 provider | Ollama 本地 300–600 ms |
| token 吞吐 | 依赖模型 | 7B 量化 ~30–80 tok/s |
| CLI 解析开销 | < 10 ms | Commander + singleton 工厂 |
| 管道背压 | 原生 stdout | NDJSON 行对齐便于 `jq -c` |

## 测试覆盖率

```
__tests__/unit/stream-command.test.js — 3 tests
```

主要覆盖命令注册与 `--text` / NDJSON 两种输出路径；provider 行为由 `provider-options.test.js` / mock-provider 覆盖。

## 安全考虑

1. **Prompt 注入**：流式输出不对上游内容做过滤，CLI 仅负责透传；敏感场景请包裹 `session policy` 审批
2. **凭据隔离**：`--base-url` 指向的自建网关 API Key 走环境变量（`PROVIDER_API_KEY`），勿硬编码
3. **长任务 Ctrl-C**：CLI 会向 provider 发送 cancel；若网关不支持可能产生后台计费，需网关侧兜底
4. **日志**：默认不回写 stream 明文到 SQLite（避免敏感泄漏）；需审计请显式使用 `cc session record`

## 使用示例

### 场景 1：本地 Ollama 流式输出

```bash
# 默认使用 ollama
chainlesschain stream "用三句话介绍 Rust 语言"

# 指定模型
chainlesschain stream "解释 WASM" --model llama3:8b
```

### 场景 2：云端提供商

```bash
# OpenAI
chainlesschain stream "Write a haiku" --provider openai --model gpt-4o --api-key sk-xxx

# Anthropic
chainlesschain stream "Explain P2P" --provider anthropic --api-key sk-ant-xxx

# 自定义兼容端点
chainlesschain stream "Hello" --provider openai --base-url http://my-proxy:8080/v1
```

### 场景 3：脚本管道消费

```bash
# NDJSON 管道 — 提取文本增量
chainlesschain stream "列出 5 个编程语言" | jq -r 'select(.type=="text_delta") | .text'

# 文本模式直接获取结果
RESULT=$(chainlesschain stream "1+1=?" --text)
echo "Answer: $RESULT"

# 写入文件
chainlesschain stream "生成 README 模板" --text > README_draft.md
```

## 故障排查

| 症状 | 可能原因 | 解决方案 |
|------|---------|---------|
| "connect ECONNREFUSED" | Ollama 未启动 | 启动 `ollama serve` |
| "Stream errored" | API 密钥无效 | 检查 `--api-key` 或配置文件 |
| 无输出 | 模型未安装 | 运行 `ollama pull <model>` |
| 乱码输出 | 终端编码问题 | 确保终端使用 UTF-8 |

## 相关文档

- [WebSocket 服务](./cli-serve) — `cc serve` WebSocket 服务器（含 `stream.run` 路由）
- [AI 对话](./cli-chat) — 交互式 AI 聊天
- [LLM 管理](./cli-llm) — 模型和提供商管理
