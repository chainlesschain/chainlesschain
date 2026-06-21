# CLI Agent 弹性提示（流式停顿 + 弃用模型预警）

> **版本: v0.162.94+ | 状态: ✅ 生产可用 | Claude-Code 2.1.183 / 2.1.185 平价 | 2 项前台提示 + 2 个 kill-switch | 22 单元测试**
>
> 当 `cc agent` / `cc ask` 与 LLM 接口交互出现两类「沉默故障」时，CLI 会**主动在 stderr 给出一行提示**，而不是让用户对着冻住的 spinner 或一句不透明的 `model not found` 干等：
> 1. **流式停顿提示**（2.1.185）——流式回复中途 API 静默（连接还在、但 >20s 没有任何字节）时，提示「仍在等待 API 响应」。
> 2. **弃用模型预警**（2.1.183）——请求的模型 id 命中「厂商已退役快照」名单时，在运行**开始前**就提醒并给出替代型号。

## 概述

这两项能力都属于 **agent 对 LLM 接口的容错与可观测性**：它们不改变运行结果，只把「正在悄悄发生什么」翻译成用户能看懂的一行字。设计上共享同一组约束——

- **只写 stderr**：保持 stdout 干净，不污染流式答案、JSON / headless 输出。
- **一次性 + 去重**：同一类事件在一次进程内最多提示一次（每个静默间隙一次 / 每个模型 id 一次）。
- **fail-open**：提示逻辑永远不抛异常、不影响主流程；出错就静默跳过。
- **可一键关闭**：各自带独立环境变量 kill-switch。

两者都是为了消除「沉默等待」：要么 API 慢得像挂了，要么模型早被厂商下线但要等真正调用失败才知道。CLI 把这两种「看不见的卡点」提前、显式地告诉你。

## 核心特性

- ⏳ **流式停顿看门狗**：`_iterateStreamWithStall` 把同一个在途 `read()` 与一个新计时器反复 race——超过 `STREAM_STALL_MS`（默认 20s）没有新字节就触发一次 `onStall(elapsedMs)`，**不丢任何 chunk、不重复读**，`done` / 错误 / abort 全部原样透传。
- 🔌 **三路流式读取器统一接入**：ollama / anthropic / openai 三个流式分支都经由 `options.onStall` + `options.streamStallMs` 接入同一看门狗；不传 `onStall` 时退化为零额外计时器的普通读循环。
- 🟡 **弃用模型保守名单**：`DEPRECATED_MODELS` 只收录厂商**已正式退役 / 排期下线**的快照（Anthropic 的 `claude-1/2/instant`、`claude-3-*-20240229`；OpenAI 的 `gpt-4-0314/0613/32k/vision-preview`、`gpt-3.5-turbo-0301/0613`、`text-davinci-*`）。
- 🎯 **绝不误伤在产模型**：匹配为「精确 id 或前缀」，但所有模式都经过挑选，**不会前缀撞上任何在产 GA 模型**（没有裸 `gpt-4` / `claude-3` 这种宽匹配），对 `doubao-*` / `ollama` 等本地与国产 id 零误报。
- 🧪 **纯函数 + 易测**：`checkModelDeprecation` / `formatModelDeprecationWarning` 都是纯函数；`maybeWarnDeprecatedModel` 在解析出最终 model 后立即调用、命中即提示替代型号。
- 🔕 **vitest 下自动静默**：弃用预警在测试进程（`VITEST` / `VITEST_WORKER_ID`）下被抑制，绝不污染 spawned-bin 测试的 stderr。

## 系统架构

```
┌──────────────────────────────────────────────────────────────┐
│                  cc agent / cc ask 运行                        │
└──────────────┬───────────────────────────────┬───────────────┘
               │                               │
   ┌───────────▼─────────────┐    ┌────────────▼──────────────┐
   │ 模型解析（开始前）        │    │ 流式回复读取（运行中）      │
   │ applyConfigLlmDefaults  │    │ _chatXxxStreaming(reader)  │
   │   ↓                     │    │   ↓                        │
   │ maybeWarnDeprecatedModel│    │ _iterateStreamWithStall    │
   │   ↓ 命中退役名单          │    │   ↓ race(read, timer)      │
   │ stderr: ⚠ 弃用提示        │    │   ↓ 静默 >20s              │
   │   (CC_MODEL_NOTICE=0 关) │    │ onStall(ms) → stderr: ⏳   │
   └─────────────────────────┘    └────────────────────────────┘
        每模型一次 / 进程               每个静默间隙一次
```

**接入点**

| 能力 | 触发时机 | 接入位置 | 渲染 |
|------|---------|---------|------|
| 弃用模型预警 | 模型解析后、首次调用前 | `agent.js`（`applyConfigLlmDefaults` 之后）+ `ask.js`（高频单次问答路径） | `chalk.yellow` stderr 一行 |
| 流式停顿提示 | 流式回复中途静默 >20s | 三路 streaming reader → `onStall` | REPL `chalk.dim` stderr 一行 |

> **与 fallback-model 的关系**：2.1.183 描述的「自动切换到更新的模型」那一半，已由 fallback-model 机制覆盖（model-not-found 错误 → 切链中下一个模型 → `onFallback` 提示）。本特性补的是**主动那一半**：在失败前就预警。

## 配置参考

```bash
# ── 流式停顿提示 ──────────────────────────────────────────
# 阈值（毫秒）：连接存活但无新字节超过此值即提示一次。默认 20000。
# 仅作为内部 options.streamStallMs 覆盖，通常无需调整。
STREAM_STALL_MS=20000        # 源码常量，编程接口经 options.streamStallMs 覆盖

# ── 弃用模型预警 ──────────────────────────────────────────
CC_MODEL_NOTICE=0            # 关闭弃用模型预警（默认开启）

# 提示样例：
#   ⚠ Warning: model "claude-2.1" is deprecated — Anthropic retired the
#     Claude 2 family. Consider switching to claude-sonnet-4-6 or
#     claude-opus-4-8. (CC_MODEL_NOTICE=0 to hide)
#   ⏳ waiting for API response (silent 21s)…
```

**编程接口**（`chatWithTools` / 流式读取器 options）：

| 选项 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `options.onStall` | `(elapsedMs:number)=>void` | 无 | 静默间隙回调；不传则不挂计时器 |
| `options.streamStallMs` | `number` | `20000` | 单次流式停顿判定阈值 |

## 性能指标

- **零额外开销（默认路径）**：不提供 `onStall` 时，看门狗退化为普通 `await read()` 循环，**不创建任何计时器**。
- **计时器 unref**：停顿计时器调用 `timer.unref()`，绝不阻止进程退出。
- **不丢 chunk / 不重复读**：每个静默间隙复用同一个在途 `read()` promise 与新计时器 race，超时只触发提示、不重新发起读取。
- **弃用查表 O(n)**：`DEPRECATED_MODELS` 名单 < 20 条，单次解析查表纯内存、无 I/O。
- **去重**：弃用预警每个模型 id 在一次进程内只打印一次（`_warned` Set）；停顿提示每个间隙只触发一次（`notified` 标志）。

## 测试覆盖率

```bash
cd packages/cli

# 弃用模型预警（14 测试）：精确/前缀/大小写匹配、对 GA 模型 +
#   doubao/ollama id 零误报、去重、env kill-switch、fail-open
npx vitest run src/lib/__tests__/model-deprecation.test.js

# 流式停顿看门狗（8 测试）：看门狗生成器 + chatWithTools 端到端接线；
#   无 onStall 的普通路径不变
npx vitest run __tests__/unit/agent-core-stream-stall.test.js
```

| 模块 | 测试数 | 覆盖要点 |
|------|-------|---------|
| `model-deprecation.test.js` | 14 | 精确/前缀/大小写匹配、GA + 国产/本地 id 不误报、去重、`CC_MODEL_NOTICE=0`、fail-open |
| `agent-core-stream-stall.test.js` | 8 | 看门狗生成器 race 行为、三路接线、`done`/abort 透传、无 `onStall` 路径不变 |

> 既有 streaming / resilience 套件（45 测试）保持全绿；普通无 `onStall` 路径字节级不变。
> 已现网实测：`claude-2.1` 触发预警，`claude-opus-4-8` 静默。

## 安全考虑

- **不影响运行结果**：两项提示都是只读旁路，命中与否都不改变请求字节、模型选择或返回内容。
- **stdout 干净**：提示一律走 stderr，绝不污染流式答案、`--output-format json` / headless 输出，便于管道与脚本解析。
- **fail-open**：任何提示逻辑异常都被吞掉（best-effort），「提示」永远不会让一次本可成功的运行失败。
- **保守名单避免噪声**：弃用名单刻意从严——宁可漏报、不可对在产模型误报，避免「狼来了」式提示稀释信任。
- **无外呼**：弃用判定纯本地查表，不联网、不上报任何模型 id 或遥测。

## 故障排除

| 现象 | 原因 | 处理 |
|------|------|------|
| 一直看到 `⏳ waiting for API response` | API 慢/过载，连接存活但长时间无字节 | 属正常提示；如频繁出现可换 provider/模型，或检查上游 API 负载 |
| 想关掉停顿提示 | — | 编程接口不传 `onStall` 即可（REPL 默认开启，提示无害） |
| 启动时出现 `model is deprecated` 预警 | 配置/`--model` 指向厂商已退役快照 | 按提示切换到替代型号；`cc llm switch`/改 `config.json` |
| 不想看到弃用预警 | — | 设 `CC_MODEL_NOTICE=0` |
| 用了在产模型却被误报弃用 | 不应发生（名单从严、不前缀撞 GA） | 若确有误报请提 issue 并附完整 model id |
| 测试/CI 的 stderr 里没有弃用预警 | vitest 下自动抑制 | 预期行为，不污染 spawned-bin 测试 |

## 关键文件

```
packages/cli/src/lib/model-deprecation.js                    # 弃用名单 + 查表 + maybeWarnDeprecatedModel
packages/cli/src/lib/__tests__/model-deprecation.test.js     # 14 单元测试
packages/cli/src/runtime/agent-core.js                       # _iterateStreamWithStall 看门狗 + 三路接线 + STREAM_STALL_MS
packages/cli/__tests__/unit/agent-core-stream-stall.test.js  # 8 单元测试
packages/cli/src/commands/agent.js                           # 弃用预警接入（applyConfigLlmDefaults 之后）
packages/cli/src/commands/ask.js                             # 弃用预警接入（cc ask 单次问答路径）
packages/cli/src/repl/agent-repl.js                          # onStall → dim stderr 提示渲染
```

## 使用示例

```bash
# 1) 误用已退役模型 —— 运行开始前即预警，并给出替代型号
cc agent -p "总结这个文件" --model claude-2.1
#   ⚠ Warning: model "claude-2.1" is deprecated — Anthropic retired the
#     Claude 2 family. Consider switching to claude-sonnet-4-6 or claude-opus-4-8.

# 2) 关闭弃用预警（例如你确知在用一个兼容网关的同名快照）
CC_MODEL_NOTICE=0 cc agent -p "..."

# 3) 在产模型 —— 静默，无任何额外提示
cc agent -p "..." --model claude-opus-4-8

# 4) 流式回复中途 API 静默 —— REPL 下提示「仍在等待」而非冻住 spinner
cc agent
# > 帮我写一个长函数...
#   ⏳ waiting for API response (silent 21s)…       ← API 慢，连接仍在
#   （随后正常续流，答案照常输出在 stdout）

# 5) headless / 管道场景 —— 提示在 stderr，stdout 仅保留干净结果
cc agent -p "..." --output-format json 2>/dev/null   # 屏蔽提示只取 JSON
```

## 相关文档

- [代理模式 (cc agent)](./cli-agent.md) — 代理式 AI 会话与工具循环
- [LLM 管理 (cc llm)](./cli-llm.md) — 模型/提供商配置、`llm switch` 切换默认型号
- [LLM 中转站与自定义接入](./cli-llm-proxy.md) — 代理、自建网关、自定义 Provider
- [AI 对话 (cc chat / ask)](./cli-chat.md) — 交互式与单次对话
- [AI 模型配置](./ai-models.md) — 模型选择与部署详情
