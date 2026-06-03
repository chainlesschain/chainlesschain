# Token 用量追踪 (tokens)

> Headless 命令 — 不依赖桌面 GUI，直接使用核心包运行。适用于服务器、CI/CD、容器化等无桌面环境。

## 核心特性

- 💰 **成本追踪**: 自动计算每次 API 调用的费用
- 📊 **分类统计**: 按 Provider、模型分组展示用量
- 💾 **响应缓存**: 缓存重复请求，节省 Token 消耗
- 📈 **趋势分析**: 查看最近的 API 调用记录
- 🌐 **多提供商**: 支持 8 个 LLM 提供商的费率计算

## 系统架构

```
tokens 命令 → tokens.js (Commander) → token-tracker.js
                                           │
                      ┌────────────────────┼────────────────────┐
                      ▼                    ▼                    ▼
                 tokens show          tokens breakdown     tokens cache
                      │                    │                    │
                      ▼                    ▼                    ▼
               汇总 token_usage      按 provider/model     response_cache
               计算总费用            分组统计               命中率统计
```

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

## 关键文件

- `packages/cli/src/commands/tokens.js` — 命令实现
- `packages/cli/src/lib/token-tracker.js` — Token 追踪库
- `packages/cli/src/lib/response-cache.js` — 响应缓存

## 配置参考

```bash
# 命令选项
chainlesschain tokens show                  # 总用量统计
chainlesschain tokens breakdown             # 按 Provider/模型分组
chainlesschain tokens recent [--limit N]    # 最近调用记录
chainlesschain tokens cache                 # 缓存统计

# 相关环境变量（费率数据源）
export OPENAI_PRICING_OVERRIDE=/path/to/custom-pricing.json
export CHAINLESSCHAIN_DB_PATH=~/.chainlesschain/db.sqlite
```

## 性能指标

| 操作             | 目标    | 实际      | 状态 |
| ---------------- | ------- | --------- | ---- |
| 总用量聚合查询   | < 100ms | 20–80ms   | ✅   |
| Provider 分组统计 | < 150ms | 30–100ms  | ✅   |
| 最近 10 条记录   | < 50ms  | 10–30ms   | ✅   |
| 缓存命中率计算   | < 100ms | 20–80ms   | ✅   |
| 费用计算（单条） | < 5ms   | 1–3ms     | ✅   |

## 测试覆盖率

```
✅ tokens.test.js  - 覆盖 CLI 主要路径
  ├── 参数解析
  ├── 正常路径
  ├── 错误处理
  └── JSON 输出
```

## 安全考虑

- Token 用量数据仅存储在本地数据库
- 费用为估算值，实际费用以提供商账单为准
- 缓存命中的请求不消耗 Token

## 使用示例

### 场景 1：查看总用量和费用

```bash
chainlesschain tokens show
chainlesschain tokens recent
```

查看 Token 总用量和估算费用，浏览最近的 API 调用记录了解使用趋势。

### 场景 2：按提供商分析成本

```bash
chainlesschain tokens breakdown
```

按 Provider 和模型分组查看用量分布，识别哪个模型消耗最多，优化成本分配。

### 场景 3：利用缓存节省开销

```bash
chainlesschain tokens cache
chainlesschain tokens show
```

查看响应缓存命中率和节省的 Token 数量，评估缓存效果。命中率低时可考虑调整使用模式。

## 故障排查

| 问题 | 解决方案 |
|------|---------|
| `show` 全部为 0 | 需先通过 `chat`/`ask`/`agent` 进行对话 |
| 费用估算不准 | 费率可能已更新，以提供商官方价格为准 |
| `cache` 命中率低 | 缓存仅匹配完全相同的请求 |

## 相关文档

- [AI 对话](./cli-chat) — 对话命令（自动记录 Token）
- [LLM 管理](./cli-llm) — 提供商管理
- [代理模式](./cli-agent) — 代理会话（Token 消耗较高）

## 依赖

- 需要先初始化数据库：`chainlesschain db init`
- Token 记录在 `chat`、`ask`、`agent` 命令调用时自动保存
