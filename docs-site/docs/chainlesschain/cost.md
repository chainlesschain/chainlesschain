# 成本估算（cc cost）

> **版本: Claude-Code cost 平价 | 状态: ✅ 生产可用 | 纯报表视图（不采集新数据）| 价格可配置覆盖 | 含 Anthropic 提示缓存计费**
>
> `cc cost` 基于已记录的 token 用量，叠加 LLM 价格表估算美元花费。它读取与 `cc session usage` 相同的 JSONL `token_usage` 事件，**不采集任何新数据**——是纯粹的报表视图。本地模型（free providers）计 0 成本，未知模型标 `unpriced` 且不计入总额；价格可经 `config.llm.pricing` 覆盖，无需改源码。

## 概述

跑了一堆 agent 会话后，你想知道「这些 token 大概花了多少钱」。`cc cost` 把每个会话/全局记录的输入输出 token 乘以对应模型的公开 list 价格（USD / 1M tokens），给出按模型分组的成本估算。它复用 `cc session usage` 的 token 聚合，只是在其上叠加价格表——因此运行 `cc cost` 不会产生任何新的数据采集，纯读取历史用量。

## 核心特性

- 💰 **美元成本估算**：按模型 list 价格（USD / 1M tokens）估算输入/输出 token 花费
- 📊 **按模型分组**：每个 `provider/model` 一行，显示 token 数与成本
- 🌍 **全局或单会话**：`cc cost` 全局汇总，`cc cost <id>` 单会话
- 🆓 **本地模型计 0**：免费 provider（本地模型）标 `free (local)`，不计费
- ⚠️ **未知模型透明**：无价格的模型标 `unpriced` 并**排除出总额**，明确提示补价格
- 🛠️ **价格可覆盖**：`config.llm.pricing` 覆盖/新增模型费率，无需改源码
- 🔬 **小额高精度**：便宜模型的亚分成本显示到 6 位小数
- 🧊 **Prompt-cache 计费**：Anthropic 提示缓存 token 单独计价——缓存**读** ≈ 输入价 ×0.1、缓存**写**（5 分钟临时断点）≈ 输入价 ×1.25；有缓存的行显示 `cache_read=`，REPL `/cost` 也实时计入（此前 `/cost` 完全忽略缓存 token）
- 📤 **JSON 输出**：`--json` 输出机器可读结构
- 🔁 **零新增采集**：复用 `token_usage` 事件，纯报表，不收集新数据
- 🧮 **缓存-only 用量不丢**：「跳过空用量」守卫现也检查缓存 token，纯缓存事件（0 新增输入/输出）不再被静默丢弃

## 系统架构

```
cc cost [id] [--json] [--limit <n>]
   │
   ▼
┌────────────────────────────────────────────────────────────┐
│ session-usage.js   sessionUsage(id) / allSessionsUsage()    │  读 JSONL token_usage 事件聚合
│        │                                                     │
│        ▼                                                     │
│ llm-pricing.js     mergePricing(config.llm.pricing)         │  PRICE_TABLE + 用户覆盖
│                    priceRollup(aggregate, {table})           │  → cost.totalCost / byModel[] / unpriced[]
│                      ├─ FREE_PROVIDERS → free (本地计 0)      │
│                      ├─ lookupRate 命中 → matched 计费        │
│                      ├─ cacheRead ×0.1 / cacheWrite ×1.25     │  缓存 token 单独计价（Anthropic）
│                      └─ 未命中 → unpriced（排除出总额）        │
└────────────────────────────────────────────────────────────┘
```

> **两条成本路径**：一次性 `cc cost` 经 `session-usage.js` → `llm-pricing.js`；交互 REPL 的 `/cost` 经 `repl/session-cost.js`（`newCostStore`/`addUsage` 携带缓存 token，`renderSessionCost` 实时渲染），两者共用 `llm-pricing.js` 的 `priceRollup` 价格逻辑，保证总额一致。

## 命令参考

```bash
cc cost                    # 全局汇总（所有会话）
cc cost <sessionId>        # 指定会话
cc cost --json             # 机器可读 JSON
cc cost --limit <n>        # 全局汇总最多纳入 n 个会话（默认 1000）
```

输出示例：

```text
Cost — global
  total: $0.1234 USD  (1,234,567 tokens, 89 calls)
  anthropic  claude-opus-4-8           $0.0980  in=12000 out=3400 cache_read=50000
  ollama     qwen2.5:7b           free (local)  in=80000 out=21000
  volcengine doubao-seed-1-6        unpriced     in=4000 out=900
  note: 1 model(s) have no rate — tokens excluded from total. Add rates via config: llm.pricing.
  prices are estimates of public list rates (USD/1M tokens).
```

## 配置参考

价格覆盖写在 `config.llm.pricing`（USD / 1M tokens），`mergePricing` 会把它叠加到内置 `PRICE_TABLE` 之上：

```json
{
  "llm": {
    "pricing": {
      "anthropic/claude-opus-4-8": { "input": 15, "output": 75 },
      "volcengine/doubao-seed-1-6": { "input": 0.5, "output": 1.5 }
    }
  }
}
```

| 概念 | 说明 |
|------|------|
| `FREE_PROVIDERS` | 本地/免费 provider（如 ollama），计 0 成本，标 `free (local)` |
| `PRICE_TABLE` | 内置公开 list 价格表（USD / 1M tokens） |
| `config.llm.pricing` | 用户覆盖/新增费率（键为 `provider/model`） |
| `unpriced` | 无费率的模型，token 不计入总额，提示补价格 |
| `CACHE_READ_MULTIPLIER` / `CACHE_WRITE_MULTIPLIER` | 提示缓存读/写相对**输入价**的倍率（`0.1` / `1.25`，Anthropic 公开价）；仅在缓存 token >0 时计入 |

> 价格为公开 list 价格的**估算**，仅供参考，不等同于实际账单。

## 性能指标

- **零采集**：复用既有 `token_usage` JSONL 事件，无新增 I/O 采集。
- **纯本地聚合**：读取本地会话用量 + 价格表相乘，无网络请求。
- **全局可限量**：`--limit` 控制全局汇总纳入的会话数（默认 1000），避免超大历史拖慢。

## 测试覆盖率

```bash
cd packages/cli
npx vitest run __tests__/unit/llm-pricing.test.js
```

覆盖 `mergePricing`（覆盖叠加）、`lookupRate`（命中/未命中）、`estimateCost`（含 `cacheReadCost` / `cacheCreationCost`）、`priceRollup`（free / matched / unpriced 分类与总额排除、缓存倍率计价）。`cc cost` 命令与 REPL `/cost`（`repl/session-cost.js`）在其上做展示层封装。

## 安全考虑

- **只读报表**：`cc cost` 仅读取已有用量事件，不修改、不外发、不采集新数据。
- **本地数据**：用量与价格均为本地数据，估算过程不联网。
- **不暴露内容**：仅统计 token 数与成本，不读取/展示对话内容。

## 故障排查

| 现象 | 可能原因 | 处理 |
|------|---------|------|
| `(no token_usage events recorded)` | 该会话/全局没有记录用量事件 | 先用 `cc agent`/`cc chat` 产生带用量记录的会话 |
| 某模型显示 `unpriced` | 内置价格表无该模型费率 | 在 `config.llm.pricing` 加 `provider/model` 费率 |
| 本地模型显示 `free (local)` | 该 provider 在 `FREE_PROVIDERS` | 预期：本地模型不计费 |
| 总额比预期低 | 有 `unpriced` 模型被排除出总额 | 看 `note` 行提示，补齐费率后重算 |
| 成本显示很多位小数 | 亚分成本（便宜模型）高精度展示 | 预期：`< $0.01` 显示 6 位小数 |
| 行里没有 `cache_read=` | 该会话无缓存 token，或模型非 Anthropic 提示缓存 | 预期：仅缓存读/写 token >0 时才显示 |
| `/cost` 与 `cc cost` 总额对不上 | 旧版 `/cost` 忽略缓存 token | 升级后两者共用 `priceRollup`，已一致 |

## 关键文件

| 文件 | 说明 |
|------|------|
| `packages/cli/src/commands/cost.js` | `cc cost` 命令（展示层） |
| `packages/cli/src/lib/llm-pricing.js` | `PRICE_TABLE` / `FREE_PROVIDERS` / `mergePricing` / `lookupRate` / `estimateCost` / `priceRollup` / `CACHE_READ_MULTIPLIER` / `CACHE_WRITE_MULTIPLIER` |
| `packages/cli/src/lib/session-usage.js` | `sessionUsage` / `allSessionsUsage`（token 聚合，含缓存 token、缓存-only 不丢弃） |
| `packages/cli/src/repl/session-cost.js` | REPL `/cost` 实时累计（`newCostStore` / `addUsage` / `renderSessionCost`，携缓存 token） |
| `packages/cli/__tests__/unit/llm-pricing.test.js` | 价格表与 rollup 单元测试（含缓存计价） |

## 使用示例

```bash
# 1) 看全局花了多少
cc cost
#    Cost — global
#      total: $0.1234 USD  (1,234,567 tokens, 89 calls)

# 2) 看某个会话
cc cost 7f8e9d0a1b2c3d4e

# 3) 机器可读
cc cost --json

# 4) 补一个未知模型的价格（config.llm.pricing），再看成本
#    "llm": { "pricing": { "volcengine/doubao-seed-1-6": { "input": 0.5, "output": 1.5 } } }
cc cost

# 5) 交互会话内实时看本会话花费（含提示缓存）
#    在 cc agent REPL 里输入：
#    /cost
#      cache: 50,000 read + 2,000 write tokens   ← Anthropic 提示缓存计入
```

## 相关文档

- [CLI Agent 智能代理](./cli-agent.md)
- [会话管理器](./session-manager.md)
- [AI 模型配置](./ai-models.md)
- [目标 / OKR 系统（cc goal）](./goal.md)
- [检查点 / 回滚（cc checkpoint）](./checkpoint.md)
