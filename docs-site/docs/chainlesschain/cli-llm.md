# LLM 管理 (llm)

> Headless 命令 — 不依赖桌面 GUI，直接使用核心包运行。适用于服务器、CI/CD、容器化等无桌面环境。

## 核心特性

- 🔌 **7 个提供商**: Ollama、OpenAI、Anthropic、DeepSeek、DashScope、Groq、自定义
- 🧪 **连通性测试**: 一键验证 API 可用性
- 📋 **模型列表**: 查看本地已安装的 Ollama 模型
- 🔄 **动态切换**: 运行时切换提供商和模型

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
```

## 命令参考

```bash
chainlesschain llm models               # 列出已安装的Ollama模型
chainlesschain llm models --json        # JSON格式输出
chainlesschain llm test                 # 测试Ollama连通性
chainlesschain llm test --provider openai --api-key sk-...
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
chainlesschain llm test                                    # 测试默认提供商 (Ollama)
chainlesschain llm test --provider openai --api-key sk-... # 测试 OpenAI
chainlesschain llm test --provider deepseek --api-key sk-...
```

## 支持的 LLM 提供商

| 提供商           | 默认模型      | 需要 API Key |
| ---------------- | ------------- | ------------ |
| Ollama (本地)    | qwen2:7b      | 否           |
| OpenAI           | gpt-4o        | 是           |
| DashScope (阿里) | qwen-max      | 是           |
| DeepSeek         | deepseek-chat | 是           |
| 自定义           | —             | 是           |

## 关键文件

- `packages/cli/src/commands/llm.js` — 命令实现
- `packages/cli/src/lib/llm-providers.js` — 7 个 LLM 提供商适配层

## 安全考虑

- API Key 存储在本地 `~/.chainlesschain/config.json`，文件权限建议设为 600
- 使用 Ollama 本地模型时无需 API Key，数据不出设备
- `test` 命令仅发送简单测试消息，不传输敏感数据

## 故障排查

| 问题 | 解决方案 |
|------|---------|
| `models` 返回空列表 | 确认 Ollama 已启动且已拉取模型：`ollama list` |
| `test` 连接超时 | 检查 `OLLAMA_HOST` 环境变量（默认 `http://localhost:11434`） |
| 自定义提供商报错 | 检查 `baseUrl` 格式，确保以 `/v1` 结尾 |

## 相关文档

- [AI 对话](./cli-chat) — 使用 LLM 进行对话
- [代理模式](./cli-agent) — 代理式 AI 会话
- [AI 模型](./ai-models) — 模型配置详情
