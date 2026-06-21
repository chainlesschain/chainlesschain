# CLI Agent 弹性提示（流式停顿 + 弃用模型预警）

> **版本: v0.162.94+ | 状态: ✅ 生产可用 | Claude-Code 2.1.183 / 2.1.185 平价 + 弹性增强 | 前台提示 + 可选硬超时 + Provider 自动回退 | 50 单元测试**
>
> 当 `cc agent` / `cc ask` 与 LLM 接口交互出现「沉默故障」时，CLI 会**主动在 stderr 给出一行提示**（必要时还能**自动恢复**），而不是让用户对着冻住的 spinner 或一句不透明的 `model not found` 干等：
> 1. **流式停顿提示**（2.1.185）——流式回复中途 API 静默（连接还在、但 >20s 没有任何字节）时，提示「仍在等待 API 响应」。
> 2. **弃用模型预警**（2.1.183）——请求的模型 id 命中「厂商已退役快照」名单时提醒并给出替代型号；触发点覆盖**运行开始前**（`cc agent` / `cc ask`）与**配置 pin 时**（`cc config set llm.model`）。
> 3. **流式硬超时**（可选，**默认关闭**）——流持续静默超过用户设定的阈值时，主动取消连接并以**可重试**的 `ETIMEDOUT` 触发自动重发，避免「连接半死、cc 永久挂起、只能 Esc」。
> 4. **Provider 自动回退（sticky + 去重）**——配置的 provider 与其 `baseUrl` 不匹配（auth 失败）时，自动改用可用 provider，并**记住**这次回退，后续回合直连可用 provider（不再每回合白白重试已知坏的那个），回退提示**每个 from→to 对只打印一次**。

## 概述

这两项能力都属于 **agent 对 LLM 接口的容错与可观测性**：它们不改变运行结果，只把「正在悄悄发生什么」翻译成用户能看懂的一行字。设计上共享同一组约束——

- **只写 stderr**：保持 stdout 干净，不污染流式答案、JSON / headless 输出。
- **一次性 + 去重**：同一类事件在一次进程内最多提示一次（每个静默间隙一次 / 每个模型 id 一次）。
- **fail-open**：提示逻辑永远不抛异常、不影响主流程；出错就静默跳过。
- **可一键关闭**：各自带独立环境变量 kill-switch。

两者都是为了消除「沉默等待」：要么 API 慢得像挂了，要么模型早被厂商下线但要等真正调用失败才知道。CLI 把这两种「看不见的卡点」提前、显式地告诉你。

## 核心特性

- ⏳ **流式停顿看门狗**：`_iterateStreamWithStall` 把同一个在途 `read()` 与一个新计时器反复 race——超过 `STREAM_STALL_MS`（默认 20s）没有新字节就触发一次 `onStall(elapsedMs)`，**不丢任何 chunk、不重复读**，`done` / 错误 / abort 全部原样透传。
- 🔌 **三路流式读取器统一接入**：ollama / anthropic / openai 三个流式分支都经由 `options.onStall` + `options.streamStallMs` + `options.streamStallTimeoutMs` 接入同一看门狗；不传 `onStall` 且不开硬超时时退化为零额外计时器的普通读循环。
- 🛑 **可选流式硬超时**：设了 `config.llm.streamStallTimeoutMs`（默认 `0`=关闭）后，看门狗在持续静默超过该阈值时**取消 reader（释放 socket）并抛出可重试的 `ETIMEDOUT`**，由 `_retryStreamingChat` 重发请求；单个**重整计时器**在 `min(停顿提示, 硬超时)` 唤醒，停顿提示仍会在超时前先触发一次。**默认关闭**是因为本地模型（CPU 上的 ollama）首字可能要几分钟——只有用户显式开启 cc 才会自动中断。
- 🟡 **弃用模型保守名单**：`DEPRECATED_MODELS` 只收录厂商**已正式退役 / 排期下线**的快照（Anthropic 的 `claude-1/2/instant`、`claude-3-*-20240229`；OpenAI 的 `gpt-4-0314/0613/32k/vision-preview`、`gpt-3.5-turbo-0301/0613`、`text-davinci-*`）。
- 🎯 **绝不误伤在产模型**：匹配为「精确 id 或前缀」，但所有模式都经过挑选，**不会前缀撞上任何在产 GA 模型**（没有裸 `gpt-4` / `claude-3` 这种宽匹配），对 `doubao-*` / `ollama` 等本地与国产 id 零误报。
- 🧪 **纯函数 + 易测**：`checkModelDeprecation` / `formatModelDeprecationWarning` 都是纯函数；`maybeWarnDeprecatedModel` 在解析出最终 model 后立即调用、命中即提示替代型号。
- 🔕 **vitest 下自动静默**：弃用预警在测试进程（`VITEST` / `VITEST_WORKER_ID`）下被抑制，绝不污染 spawned-bin 测试的 stderr。
- 🔁 **Provider 自动回退（sticky）**：`runnable-provider.js` 在 provider/`baseUrl` 不匹配（`baseurl-mismatch`）导致 auth 失败时，经纯函数 `computeFallback()` 选出可用 provider；`stickyFrom` 记住需回退的 provider，**后续回合直连可用方**，省掉每回合一次注定失败的请求。回退提示**每个 from→to 对仅一次**（此前每回合都打印）。健康 provider 永不被标 sticky。

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
| 弃用模型预警（运行时） | 模型解析后、首次调用前 | `agent.js`（`applyConfigLlmDefaults` 之后）+ `ask.js`（高频单次问答路径） | `chalk.yellow` stderr 一行 |
| 弃用模型预警（pin 时） | `cc config set` 写入模型键 | `config.js`（**仅** `model` / `visionModel` / `fallbackModel` 键，key-gated） | `chalk.yellow` stderr 一行 |
| 流式停顿提示 | 流式回复中途静默 >20s | 三路 streaming reader → `onStall` | REPL `chalk.dim` stderr 一行 |
| 流式硬超时（可选） | 静默超过 `streamStallTimeoutMs` | 三路 reader → 取消 reader + 抛 `ETIMEDOUT` | 经 `_retryStreamingChat` 自动重发 |
| Provider 自动回退 | provider/`baseUrl` 不匹配致 auth 失败 | `runnable-provider.js`（`computeFallback` + `stickyFrom`） | `chalk.dim` stderr `[provider] … retrying with …`（每对一次） |

> **停顿提示 vs 硬超时**：两者共用同一个看门狗与单个重整计时器——计时器在 `min(停顿提示, 硬超时)` 唤醒。先到 20s 触发**一次**停顿提示（软：只通知、继续等）；再到硬超时阈值则**取消连接 + 抛可重试 `ETIMEDOUT`**（硬：放弃这条静默连接、重发）。硬超时未配置（=0）时只有软提示、永不自动中断。
>
> **三种「回退」别混淆**：① **Provider 自动回退**（本表，`runnable-provider.js`）——provider 标错（与 baseUrl 不符）时换 provider，sticky 记住。② **Fallback 模型链**——`--model` 命中 model-not-found 时切到链中下一个模型，打 `[fallback] model "X" failed … retrying with "Y"`。③ **弃用模型预警**——在失败**前**就提醒（见下）。
>
> **与 fallback-model 的关系**：2.1.183 描述的「自动切换到更新的模型」那一半，已由 fallback-model 机制覆盖（model-not-found 错误 → 切链中下一个模型 → `onFallback` 提示）。本特性补的是**主动那一半**：在失败前就预警。

## 配置参考

```jsonc
// ~/.chainlesschain/config.json —— 流式硬超时（默认关闭）
{
  "llm": {
    // 流持续静默超过此毫秒数则取消连接 + 自动重试。
    // 0 / 缺省 = 关闭（永不自动中断）。建议 >20000（停顿提示阈值），
    // 例如 120000 = 静默 2 分钟仍无字节才放弃这条连接并重发。
    "streamStallTimeoutMs": 0
  }
}
```

```bash
# ── 流式停顿提示（软，默认开启）──────────────────────────────
# 阈值（毫秒）：连接存活但无新字节超过此值即提示一次。默认 20000。
# 源码常量，编程接口经 options.streamStallMs 覆盖，通常无需调整。
STREAM_STALL_MS=20000        # 仅源码默认；非环境变量开关

# ── 流式硬超时（默认关闭）────────────────────────────────────
STREAM_STALL_TIMEOUT_MS=0    # 仅源码默认；实际开启请用 config.llm.streamStallTimeoutMs

# ── 弃用模型预警 ────────────────────────────────────────────
CC_MODEL_NOTICE=0            # 环境变量：关闭弃用模型预警（默认开启）

# 提示样例：
#   ⚠ Warning: model "claude-2.1" is deprecated — Anthropic retired the
#     Claude 2 family. Consider switching to claude-sonnet-4-6 or
#     claude-opus-4-8. (CC_MODEL_NOTICE=0 to hide)
#   ⏳ waiting for API response (silent 21s)…
```

> **配置 vs 环境变量**：弃用预警用环境变量 `CC_MODEL_NOTICE` 关；流式硬超时用配置 `config.llm.streamStallTimeoutMs` 开（REPL 启动时读取）。停顿提示阈值与硬超时的源码默认（`STREAM_STALL_MS` / `STREAM_STALL_TIMEOUT_MS`）不作为环境变量暴露，仅在编程接口经 options 覆盖。

**编程接口**（`chatWithTools` / 流式读取器 options）：

| 选项 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `options.onStall` | `(elapsedMs:number)=>void` | 无 | 静默间隙回调；不传则不挂计时器 |
| `options.streamStallMs` | `number` | `20000` | 单次流式停顿（软提示）判定阈值 |
| `options.streamStallTimeoutMs` | `number` | `0` | 流式硬超时（取消 + 抛 `ETIMEDOUT`）；`0`=关闭 |

## 性能指标

- **零额外开销（默认路径）**：不提供 `onStall` 且未开硬超时时，看门狗退化为普通 `await read()` 循环，**不创建任何计时器**。
- **单个重整计时器**：软提示与硬超时共用一个计时器，唤醒点取 `min(streamStallMs, streamStallTimeoutMs)`，到点重整——不会为两套阈值各挂一个计时器。
- **计时器 unref**：停顿计时器调用 `timer.unref()`，绝不阻止进程退出。
- **不丢 chunk / 不重复读**：每个静默间隙复用同一个在途 `read()` promise 与新计时器 race，软提示只通知、不重新发起读取；仅硬超时才取消 reader 并以 `ETIMEDOUT` 走重试。
- **弃用查表 O(n)**：`DEPRECATED_MODELS` 名单 < 20 条，单次解析查表纯内存、无 I/O。
- **去重**：弃用预警每个模型 id 在一次进程内只打印一次（`_warned` Set）；停顿提示每个间隙只触发一次（`notified` 标志）。

## 测试覆盖率

```bash
cd packages/cli

# 弃用模型预警（14 测试）：精确/前缀/大小写匹配、对 GA 模型 +
#   doubao/ollama id 零误报、去重、env kill-switch、fail-open
npx vitest run src/lib/__tests__/model-deprecation.test.js

# 流式停顿看门狗 + 硬超时（12 测试）：看门狗生成器 + chatWithTools 端到端接线 +
#   硬超时抛可重试 ETIMEDOUT 并取消 reader + 提示先于超时 + 默认关闭不误伤
npx vitest run __tests__/unit/agent-core-stream-stall.test.js
```

| 模块 | 测试数 | 覆盖要点 |
|------|-------|---------|
| `model-deprecation.test.js` | 14 | 精确/前缀/大小写匹配、GA + 国产/本地 id 不误报、去重、`CC_MODEL_NOTICE=0`、fail-open |
| `agent-core-stream-stall.test.js` | 12 | 看门狗 race 行为、三路接线、`done`/abort 透传、无 `onStall` 路径不变、硬超时抛可重试 `ETIMEDOUT` + 取消 reader、提示先于超时排序、默认关闭慢 chunk 仍到达、`chatWithTools` 静默流重试 3× 后浮出超时 |
| `runnable-provider.test.js` | 24 | `computeFallback` 选取、sticky 跨回合直连、env-key sticky、健康 provider 永不 sticky、回退提示每对一次 |

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
| cc 对着死连接永久挂起、只能 Esc | 连接半死（TCP 存活、无字节/无 close/无 error），硬超时未开 | 设 `config.llm.streamStallTimeoutMs`（如 `120000`）让 cc 自动取消并重发 |
| 开了硬超时后本地模型被误中断 | 本地模型（CPU ollama）首字耗时可能数分钟，超过了阈值 | 调大 `streamStallTimeoutMs`，或对本地模型设回 `0` 关闭 |
| `ETIMEDOUT` 重试 3 次后报错退出 | 连接持续静默、重试用尽 | 上游确实不可用；检查 provider/网络，或换模型 |
| 启动时出现 `model is deprecated` 预警 | 配置/`--model` 指向厂商已退役快照 | 按提示切换到替代型号；`cc llm switch`/改 `config.json` |
| 不想看到弃用预警 | — | 设 `CC_MODEL_NOTICE=0` |
| 用了在产模型却被误报弃用 | 不应发生（名单从严、不前缀撞 GA） | 若确有误报请提 issue 并附完整 model id |
| 测试/CI 的 stderr 里没有弃用预警 | vitest 下自动抑制 | 预期行为，不污染 spawned-bin 测试 |
| 每回合都打印 `[provider] … retrying with …` | 旧版每回合重试坏 provider；或 provider 与 baseUrl 不匹配 | 升级后 sticky 跨回合直连、提示每对一次；根因是 `config.llm.provider` 标错——改成与 `baseUrl` 匹配的 provider 即不再回退 |

## 关键文件

```
packages/cli/src/lib/model-deprecation.js                    # 弃用名单 + 查表 + maybeWarnDeprecatedModel
packages/cli/src/lib/__tests__/model-deprecation.test.js     # 14 单元测试
packages/cli/src/runtime/agent-core.js                       # _iterateStreamWithStall 看门狗（软提示 + 硬超时）+ 三路接线 + STREAM_STALL_MS / STREAM_STALL_TIMEOUT_MS + 可重试 ETIMEDOUT
packages/cli/__tests__/unit/agent-core-stream-stall.test.js  # 12 单元测试
packages/cli/src/commands/agent.js                           # 弃用预警接入（applyConfigLlmDefaults 之后）
packages/cli/src/commands/ask.js                             # 弃用预警接入（cc ask 单次问答路径）
packages/cli/src/commands/config.js                          # 弃用预警接入（cc config set 模型键 pin 时，key-gated）
packages/cli/src/repl/agent-repl.js                          # onStall → dim stderr 提示渲染；启动读 config.llm.streamStallTimeoutMs
packages/cli/src/lib/runnable-provider.js                    # Provider 自动回退 computeFallback + stickyFrom（每对一次提示）
packages/cli/__tests__/unit/runnable-provider.test.js        # 24 单元测试
```

## 使用示例

```bash
# 1) 误用已退役模型 —— 运行开始前即预警，并给出替代型号
cc agent -p "总结这个文件" --model claude-2.1
#   ⚠ Warning: model "claude-2.1" is deprecated — Anthropic retired the
#     Claude 2 family. Consider switching to claude-sonnet-4-6 or claude-opus-4-8.

# 2) 关闭弃用预警（例如你确知在用一个兼容网关的同名快照）
CC_MODEL_NOTICE=0 cc agent -p "..."

# 3) 配置 pin 时即预警 —— 写入退役模型 id 的那一刻就提醒（不必等到运行失败）
cc config set llm.model claude-3-5-sonnet-20241022
#   ⚠ Warning: model "claude-3-5-sonnet-20241022" is deprecated — ...
# 仅对模型键生效：llm.provider=claude-2 这类非模型键不会误报

# 4) 在产模型 —— 静默，无任何额外提示
cc agent -p "..." --model claude-opus-4-8

# 5) 流式回复中途 API 静默 —— REPL 下提示「仍在等待」而非冻住 spinner
cc agent
# > 帮我写一个长函数...
#   ⏳ waiting for API response (silent 21s)…       ← API 慢，连接仍在
#   （随后正常续流，答案照常输出在 stdout）

# 6) headless / 管道场景 —— 提示在 stderr，stdout 仅保留干净结果
cc agent -p "..." --output-format json 2>/dev/null   # 屏蔽提示只取 JSON

# 7) 开启流式硬超时 —— 静默 2 分钟仍无字节则自动取消并重发（默认关闭）
#    编辑 ~/.chainlesschain/config.json：
#    { "llm": { "streamStallTimeoutMs": 120000 } }
#    云端 API 建议开启；本地 CPU 模型（ollama 首字慢）保持 0 或设更大值。
cc agent
# > ...
#   ⏳ waiting for API response (silent 21s)…   ← 先软提示
#   ⟳ connection dropped — retrying (attempt 1)… ← 到 120s 硬超时 → 自动重发

# 8) provider 标错（与 baseUrl 不符）—— 自动回退，且多回合只提示一次
#    config.llm.provider=anthropic 但 baseUrl 指向火山引擎：
cc agent           # 多回合对话
#   [provider] "anthropic" auth failed (baseurl-mismatch) — retrying with "volcengine"
#   （仅首次出现；后续回合直连 volcengine，不再每回合重试 anthropic）
# 根治：把 config.llm.provider 改成与 baseUrl 匹配的 volcengine
```

## 相关文档

- [代理模式 (cc agent)](./cli-agent.md) — 代理式 AI 会话与工具循环
- [LLM 管理 (cc llm)](./cli-llm.md) — 模型/提供商配置、`llm switch` 切换默认型号
- [LLM 中转站与自定义接入](./cli-llm-proxy.md) — 代理、自建网关、自定义 Provider
- [AI 对话 (cc chat / ask)](./cli-chat.md) — 交互式与单次对话
- [AI 模型配置](./ai-models.md) — 模型选择与部署详情
