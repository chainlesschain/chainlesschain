# LLM 中转站与自定义接入

> 本指南详细介绍如何通过 `--base-url` 使用 OpenAI 中转站、第三方代理、自建网关接入各种 LLM 服务，以及火山引擎（豆包）和自定义 Provider 的完整使用示例。

## 概述

ChainlessChain CLI 所有 AI 命令（`ask`、`chat`、`agent`）均支持 `--base-url` 参数，可将请求转发到任意兼容 OpenAI API 格式的服务端点。这意味着你可以：

- 通过**中转站**（如 OpenAI-SB、API2D、CloseAI 等）使用 GPT-4o
- 通过**自建 Nginx 反向代理**访问受限 API
- 使用**企业 API 网关**统一管理密钥
- 接入任何实现了 `/chat/completions` 接口的自定义 LLM 服务

## 快速上手

30 秒接入中转站：

```bash
# 1. 从中转站获取 API Key 和 Base URL

# 2. 一行命令即可使用 GPT-4o
chainlesschain ask "你好" \
  --provider openai \
  --base-url https://oa.api2d.net/v1 \
  --api-key fk-xxxxxx \
  --model gpt-4o
```

30 秒接入火山引擎（豆包）：

```bash
# 1. 设置 API Key
export VOLCENGINE_API_KEY=ark-xxxxxxxxxxxx

# 2. 直接使用
chainlesschain ask "你好" --provider volcengine
chainlesschain chat --provider volcengine
chainlesschain agent --provider volcengine
```

---

## 通用参数

所有 AI 命令共享以下参数：

```bash
--provider <name>    # LLM 提供商 (ollama/openai/volcengine/deepseek/...)
--base-url <url>     # API 基础 URL（覆盖提供商默认地址）
--api-key <key>      # API 密钥（覆盖环境变量）
--model <model>      # 模型名称
```

**关键机制**：`--base-url` 覆盖提供商默认 URL，但保留其 API 格式（OpenAI 兼容）。

---

## 一、OpenAI 中转站接入

### 什么是中转站？

中转站是第三方提供的 OpenAI API 代理服务，通常提供：
- 无需科学上网即可访问 GPT-4o / o1 等模型
- 按量计费，价格通常低于官方
- 使用中转站自己的 API Key

### 接入步骤

```bash
# 1. 从中转站获取 API Key 和 Base URL（以 api2d 为例）

# 2. 单次提问
chainlesschain ask "解释量子计算" \
  --provider openai \
  --base-url https://oa.api2d.net/v1 \
  --api-key fk-xxxxxx \
  --model gpt-4o

# 3. 交互式聊天
chainlesschain chat \
  --provider openai \
  --base-url https://oa.api2d.net/v1 \
  --api-key fk-xxxxxx \
  --model gpt-4o

# 4. Agent 模式（可读写文件、执行命令）
chainlesschain agent \
  --provider openai \
  --base-url https://oa.api2d.net/v1 \
  --api-key fk-xxxxxx \
  --model gpt-4o
```

### 使用环境变量（推荐）

每次输入 `--api-key` 不方便，推荐使用环境变量：

```bash
# Linux / macOS
export OPENAI_API_KEY=fk-xxxxxx
export OPENAI_BASE_URL=https://oa.api2d.net/v1

# Windows (PowerShell)
$env:OPENAI_API_KEY="fk-xxxxxx"

# Windows (CMD)
set OPENAI_API_KEY=fk-xxxxxx

# 使用时只需指定 base-url
chainlesschain ask "什么是 WebRTC?" \
  --provider openai \
  --base-url https://oa.api2d.net/v1 \
  --model gpt-4o
```

### 常见中转站示例

| 中转站        | Base URL                         | 说明                         |
| ------------- | -------------------------------- | ---------------------------- |
| API2D         | `https://oa.api2d.net/v1`       | 国内可用，支持 GPT-4o        |
| OpenAI-SB     | `https://api.openai-sb.com/v1`  | 按量计费                     |
| CloseAI       | `https://api.closeai-proxy.xyz/v1` | 低延迟                    |
| AiHubMix      | `https://aihubmix.com/v1`      | 多模型聚合                   |
| 自建 Nginx    | `https://your-proxy.com/v1`     | 企业内网部署                 |

> **注意**：中转站的 URL 格式可能略有差异，请以中转站实际提供的文档为准。部分中转站不需要 `/v1` 后缀。

---

## 二、火山引擎（豆包）使用指南

### 获取 API Key

1. 访问 [火山引擎控制台](https://console.volcengine.com/)
2. 开通「豆包大模型」服务
3. 在「API Key 管理」中创建密钥

### 设置环境变量

```bash
# Linux / macOS
export VOLCENGINE_API_KEY=ark-xxxxxxxxxxxx

# Windows (PowerShell)
$env:VOLCENGINE_API_KEY="ark-xxxxxxxxxxxx"

# Windows (CMD)
set VOLCENGINE_API_KEY=ark-xxxxxxxxxxxx
```

### 基础使用

```bash
# 单次提问（使用旗舰模型）
chainlesschain ask "什么是大语言模型？" --provider volcengine

# 交互式聊天（使用快速模型，成本更低）
chainlesschain chat --provider volcengine --model doubao-seed-1-6-flash-250828

# Agent 模式（自动根据任务选择最佳模型）
chainlesschain agent --provider volcengine
```

### 模型选择指南

| 模型 ID                        | 适用场景         | 特点               | 推荐用法           |
| ------------------------------ | ---------------- | ------------------ | ------------------ |
| `doubao-seed-1-6-251015`       | 通用/推理/创作   | 旗舰模型，能力最强 | 复杂分析、长文写作 |
| `doubao-seed-1-6-flash-250828` | 日常对话         | 快速响应，成本低   | 日常问答、闲聊     |
| `doubao-seed-1-6-lite-251015`  | 快速查询         | 延迟最低           | 简单查询、快速回答 |
| `doubao-seed-code`             | 代码编程         | 专用代码模型       | 写代码、debug      |

### 任务智能选择

Agent 模式下会自动检测任务类型并选择最佳模型：

```
you> 写一个 Python 快速排序函数
[auto] 代码任务 → doubao-seed-code
ai>  def quicksort(arr):
         if len(arr) <= 1:
             return arr
         ...

you> 分析 TCP 三次握手的过程
[auto] 复杂推理 → doubao-seed-1-6-251015
ai>  TCP三次握手过程如下：
     1. SYN: 客户端发送 SYN=1, seq=x ...

you> 今天天气怎么样？
ai>  (使用默认 flash 模型，快速响应)
```

### 火山引擎 + 中转站

如果你在海外或需要通过代理访问火山引擎：

```bash
chainlesschain chat \
  --provider volcengine \
  --base-url https://your-proxy.com/volcengine/v3 \
  --model doubao-seed-1-6-251015
```

---

## 三、DeepSeek 使用示例

```bash
# 设置环境变量
export DEEPSEEK_API_KEY=sk-xxxxxxxxxxxx

# 日常对话
chainlesschain chat --provider deepseek --model deepseek-chat

# 代码任务
chainlesschain ask "用 Rust 写一个 HTTP 服务器" \
  --provider deepseek --model deepseek-coder

# 通过中转站使用 DeepSeek
chainlesschain ask "你好" \
  --provider deepseek \
  --base-url https://your-proxy.com/v1 \
  --api-key sk-xxxxxx \
  --model deepseek-chat
```

---

## 四、Claude (Anthropic) 中转站接入

Anthropic 的 Claude 使用非标准 API 格式（Messages API），但许多中转站提供了 OpenAI 兼容接口：

```bash
# 方式 1：通过支持 Claude 的 OpenAI 兼容中转站
chainlesschain ask "写一首诗" \
  --provider openai \
  --base-url https://your-claude-proxy.com/v1 \
  --api-key sk-xxxxxx \
  --model claude-sonnet-4-20250514

# 方式 2：直连 Anthropic API（原生格式）
export ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxx
chainlesschain agent --provider anthropic --model claude-sonnet-4-6
```

---

## 五、自建代理 / 企业网关

### Nginx 反向代理

如果你需要在企业内网中转 OpenAI API：

```nginx
# /etc/nginx/conf.d/openai-proxy.conf
server {
    listen 443 ssl;
    server_name ai-gateway.company.com;

    location /v1/ {
        proxy_pass https://api.openai.com/v1/;
        proxy_set_header Authorization $http_authorization;
        proxy_set_header Content-Type $http_content_type;
    }
}
```

```bash
# 使用企业代理
chainlesschain agent \
  --provider openai \
  --base-url https://ai-gateway.company.com/v1 \
  --model gpt-4o
```

### One-API / New-API 网关

[One-API](https://github.com/songquanpeng/one-api) 是常用的多模型聚合网关：

```bash
# One-API 将多个 LLM 统一为 OpenAI 兼容格式
chainlesschain chat \
  --provider openai \
  --base-url http://localhost:3000/v1 \
  --api-key sk-oneapi-xxxxxx \
  --model gpt-4o          # 或 claude-3-5-sonnet, deepseek-chat, 等

# 也可以使用 One-API 的渠道切换
chainlesschain agent \
  --provider openai \
  --base-url http://localhost:3000/v1 \
  --api-key sk-oneapi-xxxxxx \
  --model deepseek-chat
```

---

## 六、自定义 Provider（编程接入）

通过 CLI 注册全新的自定义 LLM 提供商：

```bash
# 添加自定义提供商
chainlesschain llm add my-llm \
  --display-name "My LLM" \
  --base-url https://my-llm-service.com/v1 \
  --api-key-env MY_LLM_KEY \
  --models "model-a,model-b"

# 使用自定义提供商
export MY_LLM_KEY=xxxxxx
chainlesschain chat --provider my-llm --model model-a

# 移除自定义提供商
chainlesschain llm remove my-llm
```

### 适用场景

- 企业自建大模型服务
- vLLM / TGI 等推理框架部署的本地模型
- 内部 API 网关后的模型服务

```bash
# vLLM 部署的本地模型
chainlesschain chat \
  --provider openai \
  --base-url http://localhost:8000/v1 \
  --api-key dummy \
  --model my-finetuned-llama

# text-generation-inference
chainlesschain ask "你好" \
  --provider openai \
  --base-url http://localhost:8080/v1 \
  --api-key dummy \
  --model tgi-model
```

---

## 七、完整配置参考

### 所有内置提供商

| 提供商             | 环境变量                | 默认 Base URL                                              |
| ------------------ | ----------------------- | ---------------------------------------------------------- |
| Volcengine (豆包)  | `VOLCENGINE_API_KEY`    | `https://ark.cn-beijing.volces.com/api/v3`                 |
| OpenAI             | `OPENAI_API_KEY`        | `https://api.openai.com/v1`                                |
| Anthropic (Claude) | `ANTHROPIC_API_KEY`     | `https://api.anthropic.com/v1`                             |
| DeepSeek           | `DEEPSEEK_API_KEY`      | `https://api.deepseek.com/v1`                              |
| DashScope (阿里)   | `DASHSCOPE_API_KEY`     | `https://dashscope.aliyuncs.com/compatible-mode/v1`        |
| Google Gemini      | `GEMINI_API_KEY`        | `https://generativelanguage.googleapis.com/v1beta`         |
| Kimi (月之暗面)    | `MOONSHOT_API_KEY`      | `https://api.moonshot.cn/v1`                               |
| MiniMax (海螺AI)   | `MINIMAX_API_KEY`       | `https://api.minimax.chat/v1`                              |
| Mistral AI         | `MISTRAL_API_KEY`       | `https://api.mistral.ai/v1`                                |
| Ollama (本地)      | —                       | `http://localhost:11434`                                   |

### 优先级规则

1. `--api-key` 命令行参数 > 环境变量 > 配置文件
2. `--base-url` 命令行参数 > 提供商默认 URL
3. `--model` 命令行参数 > Agent 智能选择 > 提供商默认模型

### 环境变量快速配置（.env 文件）

```bash
# ~/.bashrc 或 ~/.zshrc 中添加常用配置
export VOLCENGINE_API_KEY=ark-xxxxxxxxxxxx
export OPENAI_API_KEY=sk-xxxxxxxxxxxx
export ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxx
export DEEPSEEK_API_KEY=sk-xxxxxxxxxxxx
export MOONSHOT_API_KEY=sk-xxxxxxxxxxxx
export MINIMAX_API_KEY=xxxxxxxxxxxx
```

---

## 核心特性

- **10 大 LLM 提供商** — 内置 Ollama、OpenAI、Anthropic、DeepSeek、Volcengine（豆包）、DashScope（阿里）、Google Gemini、Kimi（月之暗面）、MiniMax（海螺AI）、Mistral AI
- **3 种中转模式** — 直连官方 API、通过第三方中转站代理、自建 Nginx/One-API 网关转发
- **`--base-url` 统一覆盖** — 所有 AI 命令（ask/chat/agent）支持 `--base-url` 参数，将请求转发到任意 OpenAI 兼容端点
- **API 密钥管理** — 支持命令行参数、环境变量、配置文件三级优先级，密钥不落盘到日志
- **模型智能选择** — Agent 模式下根据任务类型自动选择最优模型（代码任务→代码模型，复杂推理→旗舰模型）
- **流式输出** — 所有提供商支持 SSE 流式响应，实时输出 token
- **自定义 Provider 注册** — 通过 `chainlesschain llm add` 注册企业自建模型服务、vLLM、TGI 等推理框架

## 系统架构

```
用户命令 (ask / chat / agent)
        │
        ▼
┌──────────────────────────────────┐
│     CLI AI 命令层                │
│  --provider / --base-url /       │
│  --api-key / --model             │
└──────────┬───────────────────────┘
           │
           ▼
┌──────────────────────────────────┐
│     LLM Provider 路由层          │
│  ┌─────────────────────────────┐ │
│  │ 优先级：命令行 > 环境变量    │ │
│  │         > 配置文件 > 默认值  │ │
│  └─────────────────────────────┘ │
└──────────┬───────────────────────┘
           │
     ┌─────┴──────┬──────────┬──────────┐
     ▼            ▼          ▼          ▼
┌─────────┐ ┌─────────┐ ┌────────┐ ┌─────────┐
│ Ollama  │ │ OpenAI  │ │Anthropic│ │ Custom  │
│ (local) │ │ /中转站 │ │ Claude │ │ Provider│
│ :11434  │ │ /v1     │ │ /v1    │ │ --base  │
└─────────┘ └─────────┘ └────────┘ └─────────┘
     │            │          │          │
     └────────────┴──────────┴──────────┘
                    │
                    ▼
            LLM API 响应 (SSE 流式 / JSON)
```

## 使用示例

```bash
# 列出所有支持的 LLM 提供商
chainlesschain llm providers

# 切换活跃提供商
chainlesschain llm switch anthropic

# 测试当前提供商连通性
chainlesschain llm test

# 通过中转站使用 GPT-4o
chainlesschain ask "解释量子计算" \
  --provider openai \
  --base-url https://oa.api2d.net/v1 \
  --api-key fk-xxxxxx \
  --model gpt-4o

# 使用火山引擎（豆包）
export VOLCENGINE_API_KEY=ark-xxxxxxxxxxxx
chainlesschain chat --provider volcengine

# 注册自定义提供商（企业自建模型）
chainlesschain llm add my-llm \
  --display-name "My LLM" \
  --base-url https://my-llm-service.com/v1 \
  --api-key-env MY_LLM_KEY \
  --models "model-a,model-b"

# 使用本地 vLLM 部署的模型
chainlesschain chat \
  --provider openai \
  --base-url http://localhost:8000/v1 \
  --api-key dummy \
  --model my-finetuned-llama
```

## 安全考虑

| 安全措施 | 说明 |
|----------|------|
| API 密钥本地存储 | 密钥通过环境变量或本地配置文件管理，不会传输至第三方服务 |
| 密钥不落日志 | CLI 输出和日志中自动脱敏 API 密钥，避免泄露 |
| 端点验证 | `--base-url` 指定的端点需为 HTTPS（中转站）或本地地址（Ollama/vLLM），CLI 不会向未验证端点发送密钥 |
| 本地模型优先 | 默认使用本地 Ollama 模型，敏感数据不出境；仅在用户显式指定云端提供商时才发送到外部 API |
| 中转站风险提示 | 第三方中转站由其运营方管理，API 密钥和请求内容经过中转站服务器，用户需自行评估信任度 |
| 环境变量隔离 | 每个提供商使用独立的环境变量名（`OPENAI_API_KEY`、`ANTHROPIC_API_KEY` 等），避免密钥混用 |

## 关键文件

| 文件 | 说明 |
|------|------|
| `packages/cli/src/lib/llm-providers/` | LLM 提供商适配器目录，每个提供商一个文件 |
| `packages/cli/src/lib/llm-providers/index.js` | 提供商注册表和路由入口 |
| `packages/cli/src/lib/llm-providers/ollama.js` | Ollama 本地模型适配器 |
| `packages/cli/src/lib/llm-providers/openai.js` | OpenAI 适配器（同时用于中转站和 One-API） |
| `packages/cli/src/lib/llm-providers/anthropic.js` | Anthropic Claude 适配器（Messages API 格式） |
| `packages/cli/src/lib/llm-providers/volcengine.js` | 火山引擎（豆包）适配器 |
| `packages/cli/src/lib/llm-providers/deepseek.js` | DeepSeek 适配器 |
| `packages/cli/src/lib/llm-providers/gemini.js` | Google Gemini 适配器 |
| `packages/cli/src/commands/llm.js` | `chainlesschain llm` 命令入口（providers/switch/test/add/remove） |

## 故障排查

| 问题                               | 解决方案                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------ |
| 中转站返回 401                     | 检查 `--api-key` 是否正确，注意中转站密钥格式可能与官方不同              |
| 连接超时                           | 检查 `--base-url` 是否可访问，尝试 `curl <base-url>/models`             |
| 模型不存在                         | 中转站可能不支持所有模型，使用 `--model` 指定中转站支持的模型            |
| `--base-url` 不生效                | 确保 URL 包含 `/v1` 后缀（如 `https://proxy.com/v1`）                   |
| Agent 模式工具调用失败             | 部分中转站不支持 function calling，建议使用支持 tools 的模型             |
| 火山引擎认证失败                   | 确认 API Key 以 `ark-` 开头，且已开通豆包模型服务                       |
| 流式输出乱码                       | Windows 用户确保终端 UTF-8：`chcp 65001`                                |

## 相关文档

- [LLM 管理](./cli-llm) — 提供商管理与连通性测试
- [AI 对话](./cli-chat) — 交互式聊天
- [代理模式](./cli-agent) — Agent 工具调用
- [AI 模型配置](./ai-models) — 桌面端模型配置详情
