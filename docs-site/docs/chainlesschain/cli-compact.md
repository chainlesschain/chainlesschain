# 会话上下文压缩（cc compact）

> **状态: ✅ 生产可用 | Claude-Code `/compact` headless 平价 | 离线确定性压缩 | 44 个相关测试全绿**
>
> `cc compact` 对**已存储会话的历史**做离线压缩，并把压缩结果作为 `compact` 检查点事件持久化到会话 JSONL 文件，使后续 `cc agent --resume <id>` 自动从精简后的历史继续。它与交互式 agent REPL 的 `/compact`（只作用于内存中的当前对话）互补，也与 `cc checkpoint`（文件状态快照）、`cc workflow checkpoint`（执行状态）完全不同。

## 概述

长会话的历史会不断膨胀，最终撑爆模型上下文窗口。`cc compact` 用现有的 **PromptCompressor** 引擎（snip + dedup + collapse + truncate 多策略管线）对一个已存储会话的消息做压缩：

- **完全离线、确定性**：该命令没有接入 LLM 摘要（`llmQuery` 为空），压缩从不发起网络调用，同一输入必得同一输出，可复现。
- **自适应阈值**：默认按会话记录的 model/provider 查上下文窗口表来定阈值；可用 `--model/--provider` 覆盖，或用 `--max-tokens/--max-messages` 硬指定（硬阈值优先，跳过自适应）。
- **持久化为 `compact` 事件**：压缩后的新历史以 JSONL `compact` 事件追加到会话文件；`rebuildMessages()` 始终从**最后一个** `compact` 事件重建消息，所以 `--resume` 自动拿到精简历史，旧事件不删除（append-only，可审计）。

此外，agent 循环（`agentLoop`）内置**自动压缩**（default-on）：headless 运行时每轮循环顶端检查 `shouldAutoCompact`，超阈值即压缩并 yield `compaction` 事件，`autoCompact: false` 可退出。

## 核心特性

- 🗜️ **多策略压缩管线**：snip（剔除空消息/`[PROCESSED]`/`[STALE]`/琐碎 tool 结果）→ dedup（MD5 + Jaccard 相似度去重，阈值 0.9）→ collapse（折叠连续 tool 调用组为一行摘要）→ truncate（保留最近 N 条），`stats.strategy` 记录实际生效的组合（如 `dedup+truncate`）
- 📏 **自适应上下文窗口**：内置 `CONTEXT_WINDOWS` 表（qwen/gpt/claude/deepseek/gemini/moonshot/doubao 等 28 个模型 + 10 个 provider 默认值），token 阈值 = 窗口 × 0.6，消息阈值 = 15–50 条（按窗口大小对数缩放）
- 🔒 **离线确定性**：无 LLM 调用、无网络依赖，dry-run 与真实压缩结果一致
- 🧪 **干跑预览**：`--dry-run` 只计算缩减量，不写任何事件
- 💾 **resume 自动生效**：压缩持久化为 `compact` 事件，`cc agent --resume` 经 `rebuildMessages()` 自动从压缩边界重建
- 🤖 **agentLoop 自动压缩**：headless agent 默认开启，循环顶端（LLM 调用前）触发；`preserveToolPairs`/`sanitizeToolPairs` 保证截断永不留下孤儿 tool 结果或无应答的 tool_call（严格 API 会拒绝这类序列）
- 🪝 **PreCompact hook 可拦截**：settings.json `PreCompact` hook block 时跳过本轮压缩，emit `compaction-skipped` 事件
- 📤 **JSON 输出**：`--json` 输出 `{ sessionId, dryRun, stats }` 便于脚本消费
- ✅ **无效压缩不落盘**：缩减量为 0（消息数、token 都没降）时直接报告 "Nothing to compact"，不写事件

## 命令参考

```bash
cc compact <session-id>                       # 压缩并持久化（写 compact 事件）
cc compact <session-id> --dry-run             # 预览缩减量，不写任何东西
cc compact <session-id> -m gpt-4o             # 按指定模型的上下文窗口自适应定阈值
cc compact <session-id> -p anthropic          # 按 provider 默认窗口定阈值
cc compact <session-id> --max-tokens 4000     # 硬指定 token 阈值（跳过自适应）
cc compact <session-id> --max-messages 10     # 硬指定消息数阈值（跳过自适应）
cc compact <session-id> --json                # JSON 输出
```

| Flag | 说明 | 默认 |
|------|------|------|
| `-m, --model <model>` | 自适应窗口取该模型 | 会话记录的 model |
| `-p, --provider <provider>` | 自适应窗口取该 provider 默认 | 会话记录的 provider |
| `--max-tokens <n>` | 硬 token 阈值（优先于自适应） | — |
| `--max-messages <n>` | 硬消息数阈值（优先于自适应） | — |
| `--dry-run` | 只预览不写入 | off |
| `--json` | JSON 输出 | off |

## 系统架构

```
┌─────────────────────────────────────────────────────────────────────┐
│ cc compact <session-id>                                              │
└──────────────┬──────────────────────────────────────────────────────┘
               │ sessionExists() 校验 → readEvents() 取 session_start
               │ 的 model/provider → rebuildMessages() 重建当前历史
               ▼
   ┌───────────────────────────┐   --max-tokens/--max-messages → 硬阈值
   │ PromptCompressor          │   --model/--provider/会话记录 → 自适应
   │  (harness/prompt-          │   （getContextWindow → adaptiveThresholds）
   │   compressor.js)           │
   │  snip → dedup → collapse  │
   │  → truncate               │
   └──────────┬────────────────┘
              │ { messages, stats }（缩减量为 0 → 不写，直接返回）
              ▼ （--dry-run → 跳过写入）
   ┌───────────────────────────┐
   │ appendCompactEvent()      │  JSONL 追加 `compact` 事件
   │ <home>/sessions/<id>.jsonl │  （含 stats + 压缩后 messages）
   └──────────┬────────────────┘
              ▼
   cc agent --resume <id> → rebuildMessages() 从最后一个 compact 事件重建

（agentLoop 自动压缩走同一引擎：循环顶 shouldAutoCompact → PreCompact hook
 可 block → compress({preserveToolPairs:true}) → yield `compaction` 事件 →
 sessionExists 时 self-persist compact 事件）
```

## 配置参考

- **阈值优先级**：`--max-tokens`/`--max-messages`（硬）> `--model`/`--provider`（自适应）> 会话记录的 model/provider（自适应）> 默认值（`maxMessages: 20`、`maxTokens: 8000`）。
- **自适应公式**（`adaptiveThresholds`）：`maxTokens = floor(contextWindow × 0.6)`；`maxMessages = clamp(15, 10 + log2(contextWindow/1024) × 5, 50)`；未知模型/provider 的窗口默认 **32768**。
- **Feature flags**（影响策略管线）：`CONTEXT_SNIP`（启用 snip 步骤）、`CONTEXT_COLLAPSE`（启用 collapse 步骤）、`COMPRESSION_AB`（A/B 变体：aggressive `0.4/0.7`、balanced `0.6/1.0`、relaxed `0.75/1.3` 的 token/消息系数）。
- **agentLoop 自动压缩**：`autoCompact: false` 选项可关闭（交互 REPL 即如此，自压自管）；仅在消息数 > 4 时才评估；持久化 gated `sessionExists`（一次性 `-p` 运行不写，`--resume` 会话才写）。
- **会话存储位置**：`<home>/sessions/<session-id>.jsonl`（`getHomeDir()`，即 `~/.chainlesschain/`，受 `CHAINLESSCHAIN_HOME` 影响）。
- **Token 估算**：中文字符 ÷ 1.5 + 其他字符 ÷ 4（`estimateTokens`）。

## 性能指标

- **离线零网络**：压缩在本地纯计算完成，无 LLM/网络调用，耗时与消息体量线性相关。基准数据待补。
- **去重相似度阈值**：Jaccard ≥ **0.9** 判为重复（`similarityThreshold`）。
- **默认阈值**：消息 **20** 条 / **8000** tokens（无任何 model/provider 信息时）；自适应消息阈值钳制在 **15–50** 条。
- **实测参考**（2026-06-09 真实会话）：52 消息种子会话压缩后 54→6 条消息，节省 879 tokens（dedup 策略，ratio 0.445）。
- **最小压缩门槛**：消息 ≤ 2 条直接返回 `strategy: "none"`；snip 要求 > 4 条、collapse 要求 > 6 条才生效。

## 测试覆盖

共 **44** 个测试（统计 `it(`/`test(`）：

| 测试文件 | 数量 | 覆盖 |
|----------|------|------|
| `packages/cli/__tests__/unit/compact-command.test.js` | 5 | 命令本体（不存在会话、dry-run、持久化、JSON、无可压缩） |
| `packages/cli/__tests__/unit/prompt-compressor.test.js` | 24 | 压缩引擎各策略 + 自适应阈值 |
| `packages/cli/__tests__/unit/prompt-compressor-toolpairs.test.js` | 7 | `sanitizeToolPairs` 孤儿 tool 对修复 |
| `packages/cli/__tests__/unit/agent-core-autocompact.test.js` | 3 | agentLoop 自动压缩触发/关闭 |
| `packages/cli/__tests__/unit/agent-core-compact-persist.test.js` | 5 | 自动压缩 self-persist（gated sessionExists） |

```bash
cd packages/cli
npx vitest run __tests__/unit/compact-command.test.js __tests__/unit/prompt-compressor.test.js
```

## 安全考虑

- **不可变审计**：会话文件 append-only，压缩不删除旧事件，原始历史始终可查。
- **离线确定性**：压缩永不发起网络调用，不会把会话内容发给任何 LLM/第三方（本命令未接 LLM 摘要）。
- **fail-safe 落盘**：缩减量为 0 时不写事件，避免无意义的 `compact` 边界污染重建逻辑。
- **tool 对完整性**：agentLoop 路径强制 `preserveToolPairs`，压缩后的序列保证被严格 chat API（OpenAI/Anthropic）接受，不会因孤儿 `tool_call_id` 拒绝请求。
- **显式 UTF-8**：会话 JSONL 读写全部显式 `utf-8`，规避 Windows GBK 默认编码。

## 故障排除

| 现象 | 可能原因 | 处理 |
|------|---------|------|
| `no such session: <id>` | 会话 id 不存在 | `cc session list` 查可用会话 |
| 提示 "Nothing to compact" | 历史未超阈值（消息数与 token 都在阈值内） | 用 `--max-tokens`/`--max-messages` 压低阈值强制压缩 |
| 压缩后 `--resume` 历史没变短 | 用了 `--dry-run`（没写入） | 去掉 `--dry-run` 重跑 |
| 阈值看起来不对 | 会话 `session_start` 没记录 model/provider → 走 32768 默认窗口 | 显式传 `--model`/`--provider` 或硬阈值 |
| headless agent 没有自动压缩 | 消息 ≤ 4 条，或调用方传了 `autoCompact: false` | 预期行为；交互 REPL 自管压缩 |
| 自动压缩被跳过（`compaction-skipped`） | settings.json `PreCompact` hook 返回 block | 检查 `.claude/settings.json` hooks 配置 |
| `--output-format json` 看不到压缩过程 | json 模式只输出最终 result envelope | 用 `--output-format stream-json` 可见 `compaction` NDJSON 事件 |

## 关键文件

| 文件 | 说明 |
|------|------|
| `packages/cli/src/commands/compact.js` | `cc compact` 命令（阈值解析、dry-run、持久化） |
| `packages/cli/src/harness/prompt-compressor.js` | PromptCompressor 引擎（5 策略、自适应阈值、`sanitizeToolPairs`） |
| `packages/cli/src/harness/jsonl-session-store.js` | 会话 JSONL 存储（`appendCompactEvent`、`rebuildMessages`） |
| `packages/cli/src/runtime/agent-core.js` | `agentLoop` 自动压缩（循环顶触发、PreCompact hook、self-persist） |
| `packages/cli/__tests__/unit/compact-command.test.js` | 命令单测（5） |

## 使用示例

```bash
# 1) 先看会用什么策略、能省多少（不写入）
cc compact session-1717900000-abc123 --dry-run
#    Would compact session-1717900000-abc123
#      54 → 12 messages, 1584 → 705 tokens (saved 879, dedup+truncate)

# 2) 真正压缩并持久化
cc compact session-1717900000-abc123
#    ✓ Compacted session-1717900000-abc123
#      resume with: cc agent --resume session-1717900000-abc123

# 3) 续跑——自动从压缩后的历史继续
cc agent --resume session-1717900000-abc123 -p "继续上次的任务"

# 4) 按目标模型的窗口压缩（要把会话搬去小窗口模型时）
cc compact <id> --model llama3:8b

# 5) 极限压缩到 10 条消息以内
cc compact <id> --max-messages 10

# 6) 脚本消费
cc compact <id> --json | jq .stats.saved
```

## 相关文档

- [CLI Agent 智能代理](./cli-agent.md)
- [会话管理（cc session）](./cli-session.md)
- [检查点 / 回滚（cc checkpoint）](./checkpoint.md)
- [Hooks 系统](./hooks.md)
- [会话管理器](./session-manager.md)
