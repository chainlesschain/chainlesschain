# 上下文窗口分解 — Context Window Breakdown（`cc context`）

> **版本: Claude Code `/context` 平价 · 状态: ✅ 生产就绪 | 对已存无头会话按角色桶估算 token 并对照模型上下文窗口 | 纯报表视图（不产生新数据）| 复用自动压缩器同一套 token 估算器 + 窗口表 |**
>
> `cc context [id]` 把一次无头会话的对话重建出来，按角色分桶估算 token，并显示它把某个模型的上下文窗口占满了多少——用了百分之几、还剩多少余量、是否溢出。它是 Claude Code `/context` 的平价视图，帮你判断「这个会话还能不能继续，还是该压缩了」。

## 概述

上下文窗口是有限的。会话越长，system prompt、历史消息、工具调用/结果堆积得越多，离塞满窗口就越近，塞满就得压缩（compact）。`cc context` 就是这块「油表」：

- 从 `~/.chainlesschain/sessions/<id>.jsonl` **重建**对话消息（从最近一次 `compact` 快照起，回放其后的 user/assistant/system 消息）。
- 按角色分五个桶估算 token：`system` / `user` / `assistant` / `tool results` / `tool calls`。
- 从**每模型的上下文窗口表**取窗口大小（不认识的模型走 provider 默认，再不行硬回退 32768）。
- 显示每桶占 total 的份额、total 占窗口的百分比（绿 ≤70% / 黄 >70% / 红 >90%）、剩余余量，溢出时红字提示「需要压缩」。

它**不产生新数据**——只读会话已写下的事件，且与自动压缩器共用同一套 token 估算器与窗口表，口径一致。

## 核心特性

- 📏 **窗口占用一眼看全**：五个角色桶 + total 占窗口百分比 + 剩余余量 + 溢出告警。
- 🧩 **消息重建**：从最近 `compact` 快照 seed，回放其后消息（每条须含 `{role, content}` 才回放）。
- 🎨 **色码油表**：total 条 green ≤70% / yellow >70% / red >90%；溢出红字「⚠ exceeds the model context window — compaction required」。
- 🏷️ **模型/provider 自动识别**：默认取会话 `session_start` 记录的 model/provider，`--model` / `--provider` 可覆盖。
- 🗂️ **内建窗口表**：Ollama/OpenAI/Anthropic/DeepSeek/DashScope/Gemini/Kimi/豆包 等常见模型有已知窗口，未知走 provider 默认，再不行回退 32768。
- 🧮 **启发式 token 估算**：中文字 ÷1.5、其它字符 ÷4 向上取整——无需真 tokenizer、零 API 调用。
- 🔒 **只算不外泄**：读消息正文估 token，但输出**只**含各角色 token 数与计数，不吐任何消息文本。

## 系统架构

```
              cc context [id]   （省略 id → getLastSessionId()）
                     │
                     ▼
 ┌───────────────────────────────────────────────────────────┐
 │ rebuildMessages(id)   harness/jsonl-session-store.js        │
 │  ~/.chainlesschain/sessions/<id>.jsonl                      │
 │  从最近 compact 快照 seed → 回放其后 user/assistant/system   │
 │  session_start → model / provider（--model/--provider 覆盖）│
 └───────────────────────────────┬───────────────────────────┘
                                 ▼
 ┌───────────────────────────────────────────────────────────┐
 │ categorizeContext(messages, estimateTokens)  context.js     │
 │  桶：system / user / assistant / tool / toolCalls           │
 │  estimateTokens：中文 ÷1.5，其它 ÷4，ceil（启发式，无 API）  │
 │  total = 五桶之和                                           │
 └───────────────────────────────┬───────────────────────────┘
                                 ▼
 ┌───────────────────────────────────────────────────────────┐
 │ window = getContextWindow(model, provider)                  │
 │  CONTEXT_WINDOWS 精确模型 → provider 默认 → 32768 回退       │
 │  used = total/window · remaining = max(0, window−total)     │
 │  overflow = total > window                                  │
 └───────────────────────────────┬───────────────────────────┘
                                 ▼
   人类油表（色码条 + 每桶份额 + total 占窗口 %）  |  --json 结构化对象
```

## 命令参考

单命令、无子命令：`cc context [id]`。

```bash
cc context                                   # 最近一个无头会话
cc context session-1720000000-ab12cd         # 指定会话
cc context --model claude-sonnet-4-6         # 按 200k 窗口衡量
cc context session-1720000000-ab12cd --json  # 机器可读
```

| 参数 / 旗标             | 说明                             | 默认                               |
| ----------------------- | -------------------------------- | ---------------------------------- |
| `[id]`                  | 会话 id（可选）                  | `getLastSessionId()` 最近无头会话  |
| `--model <model>`       | 按此模型的上下文窗口衡量         | 会话记录的 model，否则 `null`      |
| `--provider <provider>` | provider（决定窗口默认值）       | 会话记录的 provider，否则 `ollama` |
| `--json`                | 结构化 JSON 输出（否则人类油表） | 关                                 |

> 无会话 → 报错退出码 1；会话不存在或非无头 → 报 `No headless transcript for session…` 退出码 1。

**`--json` 输出结构**：

```jsonc
{
  "sessionId": "...",
  "model": "claude-sonnet-4-6",       // 或 null
  "provider": "anthropic",
  "contextWindow": 200000,
  "totalTokens": 0,
  "usedFraction": 0.0000,             // 4 位小数
  "remainingTokens": 0,
  "messageCount": 0,
  "breakdown": { "system", "user", "assistant", "tool", "toolCalls" },  // token 数
  "counts":    { "system", "user", "assistant", "tool" },               // 条数
  "overflows": false
}
```

## 配置参考

| 项       | 机制                                     | 默认  | 备注                              |
| -------- | ---------------------------------------- | ----- | --------------------------------- |
| 会话存储 | `~/.chainlesschain/sessions/<id>.jsonl`  | —     | 仅无头 JSONL 会话；非无头会话被拒 |
| 配置/env | **无**（本命令不读专用 config 键或 env） | —     | 存储根来自 `os.homedir()`         |
| 窗口回退 | provider 默认 → 硬回退                   | 32768 | 见下表                            |

**内建模型上下文窗口表**（`getContextWindow`：精确模型 → provider 默认 → 32768）：

| provider        | 代表模型 → 窗口                                                                 | provider 默认 |
| --------------- | ------------------------------------------------------------------------------- | ------------- |
| ollama          | qwen2.5:7b/14b · mistral:7b = 32768；llama3:8b = 8192；codellama:7b = 16384     | 32768         |
| openai          | gpt-4o / gpt-4o-mini / gpt-4-turbo = 128000；gpt-3.5-turbo = 16385；o1 = 200000 | 128000        |
| anthropic       | claude-opus-4-6 / sonnet-4-6 / haiku-4-5 = 200000                               | 200000        |
| deepseek        | deepseek-chat/coder/reasoner = 64000                                            | 64000         |
| dashscope       | qwen-turbo / qwen-plus = 131072；qwen-max = 32768                               | 131072        |
| gemini          | gemini-2.0-flash/pro / 1.5-flash = 1048576                                      | 1048576       |
| kimi/moonshot   | moonshot-v1-auto/128k = 131072；-8k = 8192；-32k = 32768                        | 131072        |
| 豆包/volcengine | doubao-seed-1-6 / 2-1-pro = 32768                                               | 32768         |
| 未知            | —                                                                               | **32768**     |

## 性能指标

| 维度       | 特性                                                          |
| ---------- | ------------------------------------------------------------- |
| 扫描       | 重建消息 + 单遍分桶，O(消息数)                                |
| token 估算 | 启发式（中文 ÷1.5 / 其它 ÷4），无真 tokenizer、无网络         |
| 重建       | 从最近 `compact` 快照 seed，只回放合法 `{role, content}` 消息 |
| 桶数       | 五桶：system / user / assistant / tool results / tool calls   |
| 色码阈值   | total 条 green ≤70% / yellow >70% / red >90%                  |

## 测试覆盖

| 测试文件                            | 数量 | 覆盖                                                                                                                                             |
| ----------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `__tests__/unit/cc-context.test.js` | 6    | 纯 `categorizeContext`：角色分桶 · `tool_calls` 单独计 · tool 角色桶 · 未知角色→assistant + 空值跳过 · 非字符串内容 stringify · total = 五桶之和 |

> 命令 I/O 是分类器之上的「薄渲染」，故只单测分类器；`estimateTokens` 与窗口表在 prompt-compressor 自己的套件里测。

## 安全考虑

- **读正文但不外泄**：为估 token 会把消息内容 stringify 后喂给估算器，但人类油表与 `--json` 输出**都不含任何消息文本**——只有各角色 token 数、消息条数、窗口大小与占比（`breakdown`/`counts` 均为数字）。
- **路径穿越硬化**：`isUnsafeSessionId` 拒绝含 `/`、`\`、`..` 的 id；对不安全 id，`readEvents` 返回 `[]` 而非抛错，无法逃出 sessions 目录。
- **全程本地**：只读 `~/.chainlesschain/sessions/*.jsonl`，无任何网络调用。

## 故障排除

| 现象                                            | 原因                                 | 处理                                                    |
| ----------------------------------------------- | ------------------------------------ | ------------------------------------------------------- |
| `No session found`（退出 1）                    | 还没有任何无头会话                   | 先 `cc agent -p ...` 跑一个无头会话                     |
| `No headless transcript for session…`（退出 1） | id 错，或该会话非无头 JSONL          | `cc session list` 查正确 id；仅无头会话可分析           |
| total 百分比看着偏差大                          | token 是启发式估算（非真 tokenizer） | 用于趋势/预警足够；精确计费看 `cc cost` / `cc insights` |
| 未知模型窗口显示 32768                          | 模型不在窗口表，走回退               | 用 `--model` 指定一个已知模型来衡量                     |
| 红字「exceeds the model context window」        | 会话已溢出窗口                       | 跑 `cc compact <id>` 压缩后再 `--resume`                |

## 关键文件

| 文件                                              | 职责                                                                         |
| ------------------------------------------------- | ---------------------------------------------------------------------------- |
| `packages/cli/src/commands/context.js`            | 命令 + 纯函数 `categorizeContext` + 油表渲染                                 |
| `packages/cli/src/harness/prompt-compressor.js`   | `estimateTokens` · `CONTEXT_WINDOWS` · `getContextWindow`（估算器 + 窗口表） |
| `packages/cli/src/harness/jsonl-session-store.js` | `rebuildMessages` / `readEvents` / `getLastSessionId` / `sessionExists`      |

## 使用示例

### 1. 看最近一个无头会话的窗口占用

```bash
cc context
# Context — session session-1720…
# model claude-sonnet-4-6 · provider anthropic · window 200000 tokens · 42 messages
# system        1234  ███░░░░░░░  8% (1)
# user          5600  ██████░░░░ 36% (12)
# assistant     8900  █████████░ 57% (12)
# ...
# total        15734  ██░░░░░░░░  7.9% of window     headroom 184266 tokens remaining
```

### 2. 指定会话

```bash
cc context session-1720000000-ab12cd
```

### 3. 按某个模型的窗口衡量

```bash
cc context --model claude-sonnet-4-6     # 200k 窗口
cc context --provider openai             # 用 openai provider 默认窗口 128000
```

### 4. 机器可读

```bash
cc context session-1720000000-ab12cd --json | jq '.usedFraction, .overflows'
```

### 5. 溢出后压缩再续

```bash
cc context <id>            # 红字提示溢出
cc compact <id>           # 离线压缩
cc agent --resume <id>    # 压缩后继续
```

## 相关文档

- [会话洞察 `cc insights`](./cli-insights.md) — 更全面的会话分析（轮次/工具/错误/时长/token/成本）
- [成本估算 `cc cost`](./cost.md) — 按记录的 token 用量估算美元花费（占窗口 vs. 花钱两个视角）
- [会话压缩 `cc compact`](./cli-compact.md) — 溢出后的补救（共用同一估算器与窗口表）
- [会话管理 `cc session`](./cli-session.md) — `list` / `show` / `resume` / `usage` / `verify`
