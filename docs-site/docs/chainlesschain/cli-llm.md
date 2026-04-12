# LLM 管理 (llm)

> Headless 命令 — 不依赖桌面 GUI，直接使用核心包运行。适用于服务器、CI/CD、容器化等无桌面环境。

## 概述

`llm` 命令用于管理大语言模型的提供商、模型和连通性，内置支持 10 个 LLM 提供商（含火山引擎、OpenAI、Anthropic、DeepSeek 等）。提供模型列表查看、API 连通性测试、提供商动态切换等功能，Agent 模式下还支持根据任务类型智能选择最佳模型。

## 核心特性

- 🔌 **10 个提供商**: Volcengine(豆包)、OpenAI、Anthropic、DeepSeek、DashScope、Gemini、Kimi(月之暗面)、MiniMax(海螺AI)、Mistral、Ollama + 3 种中转站
- 🧪 **连通性测试**: 一键验证 API 可用性
- 📋 **模型列表**: 查看本地已安装的 Ollama 模型
- 🔄 **动态切换**: 运行时切换提供商和模型
- 🧠 **智能模型选择**: 根据任务类型自动推荐最佳模型

## 系统架构

```
llm 命令 → llm.js (Commander) → llm-providers.js
                                      │
                     ┌────────────────┼────────────────┐
                     ▼                ▼                ▼
                  models           test            providers
                     │                │                │
                     ▼                ▼                ▼
               Ollama API      发送测试消息      配置读取
               GET /api/tags   验证 API Key     config.json

task-model-selector.js ── 任务类型检测 → 模型推荐
                           │
                     ┌─────┼─────┐─────┐─────┐─────┐
                     ▼     ▼     ▼     ▼     ▼     ▼
                   chat  code reasoning fast translate creative
```

## 命令参考

```bash
chainlesschain llm models               # 列出已安装的Ollama模型
chainlesschain llm models --json        # JSON格式输出
chainlesschain llm test                 # 测试Ollama连通性
chainlesschain llm test --provider openai --api-key sk-...
chainlesschain llm test --provider volcengine --api-key ark-...
chainlesschain llm providers            # 列出所有提供商
chainlesschain llm providers --json     # JSON格式输出
chainlesschain llm switch <provider>    # 切换默认提供商
```

## 子命令说明

### models

列出本地 Ollama 已安装的模型信息。

```bash
chainlesschain llm models
chainlesschain llm models --json
```

### test

测试 LLM 提供商连通性，发送一条简单消息验证 API 是否可用。

```bash
chainlesschain llm test                                           # 测试默认提供商 (Ollama)
chainlesschain llm test --provider openai --api-key sk-...        # 测试 OpenAI
chainlesschain llm test --provider volcengine --api-key ark-...   # 测试 Volcengine (豆包)
chainlesschain llm test --provider deepseek --api-key sk-...      # 测试 DeepSeek
```

### providers

列出所有内置和自定义 LLM 提供商。

```bash
chainlesschain llm providers            # 表格格式
chainlesschain llm providers --json     # JSON 格式
```

## 支持的 LLM 提供商

| 提供商             | 默认模型                  | 需要 API Key | API 格式           |
| ------------------ | ------------------------- | ------------ | ------------------ |
| Volcengine (豆包)  | doubao-seed-1-6-251015    | 是           | OpenAI 兼容        |
| OpenAI             | gpt-4o                    | 是           | OpenAI             |
| Anthropic (Claude) | claude-sonnet-4-6         | 是           | Anthropic Messages |
| DeepSeek           | deepseek-chat             | 是           | OpenAI 兼容        |
| DashScope (阿里)   | qwen-max                  | 是           | OpenAI 兼容        |
| Google Gemini      | gemini-2.0-flash          | 是           | Gemini 原生        |
| Kimi (月之暗面)    | moonshot-v1-auto          | 是           | OpenAI 兼容        |
| MiniMax (海螺AI)   | MiniMax-Text-01           | 是           | OpenAI 兼容        |
| Mistral AI         | mistral-large-latest      | 是           | OpenAI 兼容        |
| Ollama (本地)      | qwen2:7b                  | 否           | Ollama 原生        |

### Volcengine (豆包) 模型列表

| 模型 ID                        | 适用场景     | 说明                 |
| ------------------------------ | ------------ | -------------------- |
| doubao-seed-1-6-251015         | 通用/推理    | Seed 1.6 旗舰模型   |
| doubao-seed-1-6-flash-250828   | 日常对话     | 快速响应，成本低     |
| doubao-seed-1-6-lite-251015    | 快速查询     | 轻量版，延迟最低     |
| doubao-seed-code               | 代码编程     | 专用代码生成模型     |

## 智能模型选择 (Task Model Selector)

Agent 模式自动根据用户消息检测任务类型，选择最佳模型：

| 任务类型   | 检测关键词                          | Volcengine 推荐模型          |
| ---------- | ----------------------------------- | ---------------------------- |
| 日常对话   | 普通问候、闲聊                      | doubao-seed-1-6-flash-250828 |
| 代码任务   | code, debug, function, 代码, 编程   | doubao-seed-code             |
| 复杂推理   | analyze, step by step, 分析, 推理   | doubao-seed-1-6-251015       |
| 快速响应   | quick, brief, 简短, 一句话          | doubao-seed-1-6-lite-251015  |
| 翻译任务   | translate, 翻译, 英译中             | doubao-seed-1-6-251015       |
| 创意写作   | story, poem, essay, 写文章, 创作    | doubao-seed-1-6-251015       |

Agent 模式下自动切换示例：
```
you> 写一个Python排序函数
[auto] 代码任务 → doubao-seed-code
ai>  def bubble_sort(arr): ...
```

## 关键文件

- `packages/cli/src/commands/llm.js` — 命令实现
- `packages/cli/src/lib/llm-providers.js` — 10 个 LLM 提供商适配层
- `packages/cli/src/lib/task-model-selector.js` — 任务智能模型选择器
- `packages/cli/src/repl/chat-repl.js` — 流式聊天 REPL
- `packages/cli/src/repl/agent-repl.js` — Agent 模式 REPL

## 环境变量

| 变量名              | 提供商           | 说明          |
| ------------------- | ---------------- | ------------- |
| `VOLCENGINE_API_KEY`| Volcengine (豆包) | 火山引擎 API Key |
| `OPENAI_API_KEY`    | OpenAI           | OpenAI API Key |
| `ANTHROPIC_API_KEY` | Anthropic        | Anthropic API Key |
| `DEEPSEEK_API_KEY`  | DeepSeek         | DeepSeek API Key |
| `DASHSCOPE_API_KEY` | DashScope        | 阿里 DashScope API Key |
| `GEMINI_API_KEY`    | Google Gemini    | Gemini API Key |
| `MOONSHOT_API_KEY`  | Kimi (月之暗面)  | Moonshot API Key |
| `MINIMAX_API_KEY`   | MiniMax (海螺AI) | MiniMax API Key |
| `MISTRAL_API_KEY`   | Mistral AI       | Mistral API Key |

## 安全考虑

- API Key 存储在本地 `~/.chainlesschain/config.json`，文件权限建议设为 600
- 使用 Ollama 本地模型时无需 API Key，数据不出设备
- `test` 命令仅发送简单测试消息，不传输敏感数据

## 使用示例

### 场景 1：查看本地模型

```bash
chainlesschain llm models
chainlesschain llm models --json
```

列出本地 Ollama 已安装的模型及大小信息，JSON 格式输出便于脚本处理。

### 场景 2：测试不同提供商连通性

```bash
chainlesschain llm test
chainlesschain llm test --provider openai --api-key sk-xxx
chainlesschain llm test --provider volcengine --api-key ark-xxx
chainlesschain llm test --provider deepseek --api-key sk-xxx
```

逐个测试各 LLM 提供商的 API 连通性，确保配置正确后再开始对话。

### 场景 3：使用火山引擎 (豆包) 对话

```bash
# 设置环境变量
export VOLCENGINE_API_KEY=ark-xxx

# 单次提问
chainlesschain ask "什么是机器学习？" --provider volcengine

# 交互式聊天
chainlesschain chat --provider volcengine --model doubao-seed-1-6-flash-250828

# Agent 模式（自动选择最佳模型）
chainlesschain agent --provider volcengine
```

### 场景 4：切换默认提供商

```bash
chainlesschain llm switch volcengine
chainlesschain llm test
```

切换默认 LLM 提供商为火山引擎，测试连通性。

## 故障排查

| 问题 | 解决方案 |
|------|---------|
| `models` 返回空列表 | 确认 Ollama 已启动且已拉取模型：`ollama list` |
| `test` 连接超时 | 检查 `OLLAMA_HOST` 环境变量（默认 `http://localhost:11434`） |
| 自定义提供商报错 | 检查 `baseUrl` 格式，确保以 `/v1` 结尾 |
| 火山引擎认证失败 | 检查 `VOLCENGINE_API_KEY` 是否正确设置 |
| 模型自动选择不生效 | 仅在 Agent 模式 (`chainlesschain agent`) 下生效 |

## 相关文档

- [LLM 中转站与自定义接入](./cli-llm-proxy) — 中转站、代理、自建网关、自定义 Provider 完整指南
- [AI 对话](./cli-chat) — 使用 LLM 进行对话
- [代理模式](./cli-agent) — 代理式 AI 会话
- [AI 模型](./ai-models) — 模型配置详情
