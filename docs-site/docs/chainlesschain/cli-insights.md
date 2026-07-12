# 会话洞察 — 轮次 / 工具 / 错误 / 时长 / Token + 成本（`cc insights`）

> **版本: Claude Code `/insights` 平价 · 状态: ✅ 生产就绪 | 对已存 JSONL 会话的纯报表视图（不产生新数据）| 复用 `cc cost` 价格表 + `config.llm.pricing` 覆盖 | 与 `cc cost`（只算钱）、`cc session usage`（只算 token）互补 |**
>
> `cc insights [id]` 把一次 Agent 会话「读一遍、算一遍、摆出来」：多少轮对话、调了多少工具、错误率多高、跑了多久、烧了多少 token、估算花了多少钱。它不新增任何数据——只是把会话早已写下的事件重新聚合成一份体检报告。

## 概述

一次 `cc agent` 会话会把每个事件（`token_usage` / `tool_call` / `tool_result` / 消息 / `compact` …）追加写进 `~/.chainlesschain/sessions/<id>.jsonl`。`cc insights` 在这份 JSONL 上做**单遍扫描**，产出五类聚合：

- **轮次**：user / assistant 消息数，以及压缩（compact）次数。
- **工具**：总调用数、错误数、错误率，以及按工具的 Top 列表。
- **时长**：首末事件时间戳之差。
- **Token**：input / output / cache 读写 / 调用数，按模型拆分。
- **成本**：用内建价格表 + `config.llm.pricing` 覆盖估算美元；未定价模型不会瞎猜，单列出来并从总额中排除。

它是 `cc cost`（只报花销）的超集，且对**无头会话更准**——因为它会把会话记录的 model/provider 回填到只带 `{input_tokens, output_tokens}` 的无头 token 事件上，让定价能算。

## 核心特性

- 📊 **一命令全景体检**：轮次 + 工具 + 错误率 + 时长 + token + 成本，一次看全。
- 🧮 **不产生新数据**：纯读已存 JSONL 事件，聚合而非采集。
- 🏷️ **无头会话回填**：把 `session_start` 记录的 model/provider 回填到无头 token 事件上，使定价成立；无工具事件时优雅降级为零。
- 💵 **诚实定价**：内建价格表（Anthropic/OpenAI/DeepSeek/火山等，本地 Ollama 等免费 provider 记 0）+ `config.llm.pricing` 覆盖；**未匹配到价格的模型不计入成本**，单列 `unpriced` 并黄字提示。
- 🧊 **prompt cache 计价**：cache 读按 input 费率的 per-provider 倍率、cache 写按 1.25× 计。
- 🛡️ **大会话安全**：时长用 O(n) 归约求首末时间戳（不 `Math.min(...arr)`，避免 13 万+ 元素展开爆栈）。
- 🔧 **机器可读**：`--json` 输出结构化对象，便于 `jq` 提取。

## 系统架构

```
              cc insights [id]   （省略 id → getLastSessionId()）
                     │
                     ▼
 ┌───────────────────────────────────────────────────────────┐
 │ readEvents(sessionId)   harness/jsonl-session-store.js     │
 │  ~/.chainlesschain/sessions/<id>.jsonl（逐行 JSON + 哈希链）│
 └───────────────────────────────┬───────────────────────────┘
                                 ▼
 ┌───────────────────────────────────────────────────────────┐
 │ analyzeSession(events)   lib/session-insights.js（单遍）    │
 │  · duration = max(ts) − min(ts)（O(n) 归约）               │
 │  · messages {user, assistant, total} · compactions         │
 │  · tools {calls, errors, byTool[]}（错误检测宽松）          │
 │  · usage ← aggregateUsage()  lib/session-usage.js          │
 │  · 无头 token 事件回填 model/provider                       │
 └───────────────────────────────┬───────────────────────────┘
                                 ▼
 ┌───────────────────────────────────────────────────────────┐
 │ 成本叠加   lib/llm-pricing.js                              │
 │  table = mergePricing(config.llm.pricing)                 │
 │  priceRollup(usage, {table}) → byModel[].cost + cost.total │
 │  未匹配模型 → unpriced[]（不计入总额）                      │
 └───────────────────────────────┬───────────────────────────┘
                                 ▼
              人类表格  |  --json 结构化对象
```

## 命令参考

单命令、无子命令：`cc insights [id]`。

```bash
cc insights                              # 分析最近一个会话（人类表格）
cc insights session-1700000000000-a1b2c3 # 指定会话
cc insights --json                       # 最近会话，机器可读
```

| 参数 / 旗标 | 说明                             | 默认                          |
| ----------- | -------------------------------- | ----------------------------- |
| `[id]`      | 要分析的会话 id（可选）          | `getLastSessionId()` 最近会话 |
| `--json`    | 结构化 JSON 输出（否则人类表格） | 关                            |

> 无 `--date`/`--limit`/`--model` 旗标——那些在姊妹命令 `cc cost` / `cc context` 上。无会话时打印提示（不置错误码）；未知 id 报 `no such session` 并置退出码 1。

**`--json` 输出结构**（要点）：

```jsonc
{
  "sessionId": "...",
  "meta": { "title", "model", "provider", "startedAt", "endedAt", "durationMs" },
  "events": 0,
  "messages": { "user": 0, "assistant": 0, "total": 0 },
  "tools":    { "calls": 0, "errors": 0, "byTool": [ { "tool", "count", "errors" } ] },
  "compactions": 0,
  "usage": {
    "total":   { "inputTokens", "outputTokens", "totalTokens", "cacheReadTokens", "cacheCreationTokens", "calls" },
    "byModel": [ { "provider", "model", "...tokens", "cost", "matched", "free" } ],
    "cost":    { "totalCost", "currency": "USD", "unpricedCount" },
    "unpriced":[ { "provider", "model", "totalTokens" } ]
  },
  "cost": { "totalCost", "currency", "unpricedCount" }
}
```

## 配置参考

| 项       | 机制                                    | 默认                       | 备注                                                             |
| -------- | --------------------------------------- | -------------------------- | ---------------------------------------------------------------- |
| 价格覆盖 | `config.llm.pricing`（`config.json`）   | 无（用内建 `PRICE_TABLE`） | 形如 `{ "<provider>": [ { match, in, out } ] }`；负值/畸形项跳过 |
| 会话存储 | `~/.chainlesschain/sessions/<id>.jsonl` | —                          | 追加式 JSONL + 逐事件哈希链                                      |
| 配置文件 | `~/.chainlesschain/config.json`         | —                          | `loadConfig()` 读取                                              |
| 环境变量 | **无**（本命令不直接读 env）            | —                          | 存储根来自 `os.homedir()`                                        |

费率单位 = 每 100 万 token 的美元；按 provider 作用域、最长匹配优先、大小写不敏感子串匹配模型 id。本地 provider（`ollama` / `local` / `llamacpp` / `mediapipe`）费率记 0。

## 性能指标

| 维度       | 特性                                                             |
| ---------- | ---------------------------------------------------------------- |
| 扫描       | 单遍 O(事件数) 聚合                                              |
| 大会话安全 | 首末时间戳用 O(n) 归约求解，避开 `Math.min(...arr)` 的展开爆栈   |
| 错误检测   | 宽松：`data.error` 或 `result.error/is_error/isError` 任一即计错 |
| Top 工具   | 人类表格最多列 8 个工具，`byTool` 按次数降序                     |
| 成本准确性 | 未定价模型不猜价——单列 `unpriced` 并从总额排除                   |

## 测试覆盖

| 测试文件                                  | 数量 | 覆盖                                                                                                              |
| ----------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------- |
| `__tests__/unit/insights-command.test.js` | 5    | `--json` 结构化报告 + 成本（opus $5/1M ≈ 5）· 默认取最近会话 · 未知 id 退出 1 · 无会话处理 · 非 `--json` 美化打印 |
| `__tests__/unit/session-insights.test.js` | —    | 纯 `analyzeSession` / `formatDuration` 分析器单测                                                                 |

> 命令级测试 mock JSONL store + config，但跑**真实**分析器与价格表。

## 安全考虑

- **不外泄消息正文**：`readEvents` 会读到 `user_message` / `assistant_message` 的 `content`，但 `analyzeSession` 只**计数**、绝不把消息文本写进报告；人类与 `--json` 输出都只含聚合指标。
- **工具参数天生不落盘**：会话以紧凑形只记 `{tool, is_error, skill?}`，**不记工具参数**（参数可能含整份文件正文），故工具段无法泄露文件内容。
- **路径穿越硬化**：`isUnsafeSessionId` 拒绝含 `/`、`\`、`..` 的 id，构造 id（如 `cc insights ../../etc/x`）无法读到 sessions 目录之外。
- **成本永不静默出错**：未匹配价格的模型不瞎猜，报为 `matched:false` / `unpricedCount` 并黄字提示，避免美元数悄悄算错。
- **全程本地**：无任何网络调用。

## 故障排除

| 现象                                   | 原因                            | 处理                                                    |
| -------------------------------------- | ------------------------------- | ------------------------------------------------------- |
| `No sessions found`                    | 还没有任何会话                  | 先 `cc agent` 跑一个会话                                |
| `no such session: <id>`（退出 1）      | id 写错或会话已清               | `cc session list` 查正确 id                             |
| `tools: none recorded`                 | 无头会话不写 tool 事件          | 正常——无头运行常省略 tool_call/tool_result              |
| 成本明显偏低 / 黄字 `N model unpriced` | 该模型不在价格表                | 在 `config.llm.pricing` 加该模型的 `{ match, in, out }` |
| 本地模型成本为 0                       | Ollama 等免费 provider 费率记 0 | 符合预期                                                |
| 时长为 0 或异常                        | 会话只有单个事件或时间戳缺失    | 检查会话 JSONL 是否完整                                 |

## 关键文件

| 文件                                              | 职责                                                          |
| ------------------------------------------------- | ------------------------------------------------------------- |
| `packages/cli/src/commands/insights.js`           | 命令注册、I/O、成本叠加                                       |
| `packages/cli/src/lib/session-insights.js`        | `analyzeSession` / `formatDuration`（纯分析器）               |
| `packages/cli/src/lib/session-usage.js`           | `aggregateUsage`（token 聚合）                                |
| `packages/cli/src/lib/llm-pricing.js`             | `PRICE_TABLE` / `mergePricing` / `lookupRate` / `priceRollup` |
| `packages/cli/src/harness/jsonl-session-store.js` | 会话读写、`readEvents` / `getLastSessionId` / `sessionExists` |

## 使用示例

### 1. 分析最近一个会话

```bash
cc insights
# Insights — session session-1700…
# model: anthropic/opus   duration: 4m 12s   events: 318
# turns: 12 user / 12 assistant
# tools: 47 call(s), 2 error(s) (4.3% error rate)
# tokens: 128900 (in 96000 / out 32900, 24 call(s))   cost: $0.9312
```

### 2. 分析指定会话

```bash
cc insights session-1700000000000-a1b2c3
```

### 3. 机器可读 + jq 提取成本

```bash
cc insights --json | jq '.cost.totalCost'
```

### 4. 指定会话的 JSON

```bash
cc insights session-1700000000000-a1b2c3 --json
```

### 5. 先找 id 再体检

```bash
cc session list
cc insights <id-from-list>
```

## 相关文档

- [成本估算 `cc cost`](./cost.md) — 只报花销的姊妹命令（insights 是其超集）
- [Token 用量追踪 `cc tokens`](./cli-tokens.md) — 按 provider / 模型分组的 token 与成本统计
- [会话管理 `cc session`](./cli-session.md) — `list` / `show` / `resume` / `usage` / `verify`
- [会话压缩 `cc compact`](./cli-compact.md) — 产生 insights 计数的 `compact` 事件
