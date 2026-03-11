# Token 用量追踪 (tokens)

> Headless 命令 — 不依赖桌面 GUI，直接使用核心包运行。适用于服务器、CI/CD、容器化等无桌面环境。

## 概述

追踪和分析 LLM API 的 Token 用量和成本。支持多个 Provider 的费用统计、用量趋势分析和成本优化建议。

## 命令参考

```bash
chainlesschain tokens show                # 显示总用量统计
chainlesschain tokens breakdown            # 按 Provider/模型分组统计
chainlesschain tokens recent               # 最近的 API 调用记录
chainlesschain tokens cache                # 响应缓存统计
```

## 子命令

### show — 用量概览

显示总 Token 用量和成本摘要：

```bash
chainlesschain tokens show
```

**输出示例：**

```
Token Usage Summary
─────────────────────
Total tokens:    125,430
  Input:          98,200
  Output:         27,230
Est. cost:       $1.85
Sessions:        42
```

### breakdown — 分类统计

按 Provider 和模型分组显示用量：

```bash
chainlesschain tokens breakdown
```

**输出示例：**

```
Cost Breakdown by Provider
──────────────────────────
ollama (qwen2:7b)        45,200 tokens   $0.00
openai (gpt-4o)          62,130 tokens   $1.55
deepseek (deepseek-chat) 18,100 tokens   $0.30
```

### recent — 最近调用

显示最近的 LLM API 调用记录：

```bash
chainlesschain tokens recent           # 默认最近 10 条
chainlesschain tokens recent --limit 5 # 最近 5 条
```

### cache — 缓存统计

显示响应缓存的命中率和节省的 Token：

```bash
chainlesschain tokens cache
```

## 费率说明

| Provider  | 模型            | 输入费率       | 输出费率       |
| --------- | --------------- | -------------- | -------------- |
| Ollama    | 所有本地模型     | 免费           | 免费           |
| OpenAI    | gpt-4o          | $2.50/1M       | $10.00/1M      |
| OpenAI    | gpt-4o-mini     | $0.15/1M       | $0.60/1M       |
| Anthropic | claude-3.5      | $3.00/1M       | $15.00/1M      |
| DeepSeek  | deepseek-chat   | $0.14/1M       | $0.28/1M       |
| DashScope | qwen-max        | $0.02/1M       | $0.06/1M       |

## 依赖

- 需要先初始化数据库：`chainlesschain db init`
- Token 记录在 `chat`、`ask`、`agent` 命令调用时自动保存
