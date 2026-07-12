# 行内代码补全 — FIM Ghost-Text（`cc complete`）

> **版本: IDE 深度整合 · 状态: ✅ 生产就绪 | 从 stdin 读 `{prefix, suffix, language}` JSON → stdout 打印待插入代码 | 复用 `cc ask` 的 provider 路由与配置（零新增鉴权）| VS Code / JetBrains 插件的 ghost-text 后端 |**
>
> `cc complete` 是给 IDE 用的**填空式（fill-in-the-middle, FIM）行内补全**引擎。它从 stdin 读一段描述光标前后代码的 JSON，把要插入光标处的代码打印到 stdout。它不是给人直接敲的——消费者是 IDE 插件（VS Code 的 `InlineCompletionItemProvider`、JetBrains 的 `InlineCompletionProvider`），它们把编辑器缓冲构造成请求、把回复渲染成灰字建议。

## 概述

普通聊天模型没有原生 FIM，`cc complete` 用一个 `<CURSOR>` 哨兵把「光标前 + 光标后」拼起来，包进一段指令 prompt，让模型只吐**该插入光标处的原始代码**（不解释、不带 markdown 围栏、不重复上下文），再清洗成干净的插入文本。

设计要点（源码明示）：

- **复用 `cc ask` 的后端**：直接调用 `queryLLM`——沿用你已配置好的 LLM/provider/key，**不引入任何新鉴权**。
- **手动触发 v1**：IDE 把它绑到一个快捷键上，所以慢/贵的聊天模型也能接受；配一个快的本地 FIM 模型只是让它更跟手。IDE 两端都**只**在手动触发（`Invoke`）时请求，**不做**逐键自动触发。
- **默认全本地**：默认 provider 是 `ollama`、默认模型 `qwen2.5-coder`——不配云端时代码不出本机。

## 核心特性

- ⌨️ **FIM 行内补全**：`{prefix, suffix, language}` → 插入文本；`<CURSOR>` 哨兵法兼容任意聊天模型。
- 🔌 **零新增鉴权**：复用 `cc ask` 的 provider 路由与凭据（`config.llm.*`）。
- 🏠 **默认本地**：默认 `ollama` / `qwen2.5-coder`，代码留在设备上；配云端才外传。
- 🧼 **输出清洗**：剥 markdown 围栏、去回显的 `<CURSOR>`、硬截 2000 字符、只去尾部空白（保留前导缩进）。
- 🤫 **失败静默**：错误不弹编辑器弹窗——无 `--json` 时写 stderr + 退出码 1；`--json` 时返回 `{completion:"", error}`。
- 🧯 **不吃合法尾 token**：刻意**不**做「补全末尾与 suffix 重叠就裁掉」的天真去重（会误吃如 `if` 块自己的 `}`），去重交给 prompt 指令。

## 系统架构

```
 IDE 插件（VS Code / JetBrains）
   editorTextFocus + 手动触发键
   extractContext → { prefix, suffix, language }（每侧至多 4000 字符）
         │  spawn `cc complete --json`，写 stdin 后关闭
         ▼
 ┌───────────────────────────────────────────────────────────┐
 │ cc complete   commands/complete.js                         │
 │  读 stdin JSON（TTY 或空 → ""；两侧皆空 → 空结果不调 LLM）  │
 │  buildFimPrompt(prefix, suffix, language)                  │
 │    「只输出应插入 <CURSOR> 处的原始代码…」                   │
 │    <prefix><CURSOR><suffix>                                │
 │         │                                                  │
 │         ▼ queryLLM(prompt, resolved)   复用 ask.js 后端     │
 │    ollama → POST /api/chat（stream:false）                 │
 │    OpenAI 兼容 → POST /chat/completions（Bearer）          │
 │         │                                                  │
 │         ▼ cleanCompletion：去围栏 / 去 <CURSOR> / 截 2000 / 去尾空白 │
 └───────────────────────────────┬───────────────────────────┘
                                 ▼
   默认：raw 插入文本 → stdout
   --json：{ completion, model, provider } → stdout
   IDE 再防御性 clean 一遍 → 渲染为灰字 InlineCompletionItem
```

## 输入 / 输出契约

**输入（stdin JSON）**——只消费三个键：

| 键         | 类型   | 说明                            |
| ---------- | ------ | ------------------------------- |
| `prefix`   | string | 光标**前**的代码                |
| `suffix`   | string | 光标**后**的代码                |
| `language` | string | 编辑器语言 id（空则用泛化措辞） |

> 非字符串/缺失字段按 `""` 处理；非 JSON/空/TTY stdin 当作 `{}`；`prefix` 与 `suffix` 皆空 → 直接返回空结果，不调 LLM。当前实现**不**读取 `path` / `maxTokens` / `model` / `cursor` 等键（模型/长度经旗标与硬上限控制）。

**输出（stdout）**——单次写出，非流式：

- **默认（无 `--json`）**：**原始插入文本**（不加多余内容、不加尾换行）。
- **`--json`**：`{"completion": <string>, "model": <string>, "provider": <string>}`；出错时 `{"completion":"", "error": <message>}`。
- **无 `--json` 出错**：错误写 **stderr** + 换行，置退出码 1，stdout 保持空（ghost-text 静默失败）。

## 命令参考

```bash
echo '{"prefix":"function add(a, b) {\n  return ","suffix":"\n}","language":"javascript"}' | cc complete
```

| 旗标               | 说明               | 默认 / 回退                                                         |
| ------------------ | ------------------ | ------------------------------------------------------------------- |
| `--provider <p>`   | 覆盖 LLM provider  | `config.llm.provider`，否则 `ollama`                                |
| `--model <m>`      | 覆盖模型           | `config.llm.model`；ollama 时缺省 `qwen2.5-coder`，否则 `undefined` |
| `--base-url <url>` | 覆盖 provider 端点 | ollama → `resolveOllamaBaseUrl(...)`；其它 → `config.llm.baseUrl`   |
| `--api-key <key>`  | 覆盖 API key       | `config.llm.apiKey`                                                 |
| `--json`           | 输出结构化 JSON    | 关（原始文本）                                                      |

> 无 `--max-tokens` / `--timeout` / `--stop` / `--temperature`——长度由 2000 字符硬上限控制，超时由 IDE 调用方管（VS Code 12s，JetBrains 由参数指定）。

## 配置参考

复用 `cc ask` 的 LLM 配置（`config.json`）：

| 键                       | 说明                                      |
| ------------------------ | ----------------------------------------- |
| `llm.provider`           | provider id（默认 `ollama`）              |
| `llm.model`              | 默认聊天/Agent 模型                       |
| `llm.baseUrl`            | provider 端点                             |
| `llm.apiKey`             | API key（机密）                           |
| `llm.preferAndroidLocal` | 把 ollama 路由到 in-APK 的 LocalLlmServer |

**环境变量**：`CC_HUB_OLLAMA_URL`（覆盖 ollama base，Android LocalCcRunner 注入）；缺 key 时按 provider 取 `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `DEEPSEEK_API_KEY` / `DASHSCOPE_API_KEY` / `GEMINI_API_KEY` / `MISTRAL_API_KEY` / `VOLCENGINE_API_KEY` 等。ollama 默认 base `http://localhost:11434`。

## 性能指标

| 维度      | 特性                                                  |
| --------- | ----------------------------------------------------- |
| 调用      | 单次 `queryLLM`（`stream:false`），无 CLI 侧缓存/去抖 |
| 去抖/取消 | 全由 IDE 负责（超时/取消时 kill 子进程）              |
| 输出上限  | 硬截 2000 字符（`MAX_COMPLETION_CHARS`）              |
| 上下文    | IDE 每侧至多 4000 字符（`CONTEXT_CHARS`）             |
| 触发      | 仅手动触发（`Invoke`），不做逐键自动补全              |

## 测试覆盖

| 测试文件                                              | 数量 | 覆盖                                                                                                        |
| ----------------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------- |
| `__tests__/unit/complete-command.test.js`             | 11   | `buildFimPrompt`(5) + `cleanCompletion`(6) 纯函数                                                           |
| `__tests__/unit/vscode-ext-completion.test.js`（~19） | 19   | `extractContext` / `parseCompletionResponse` / `cleanCompletion` / `spawnComplete` / 手动触发 + 取消 gating |
| `jetbrains-plugin/.../CcCompletionTest.java`          | —    | JetBrains 孪生 `buildRequestJson` / `parseCompletion` / `cleanCompletion`                                   |

> CLI、VS Code、JetBrains 三处各自实现同一套「2000 字符上限 + 去围栏/去 `<CURSOR>` + 去尾空白」契约，作为纵深防御冗余。

## 安全考虑

- **默认代码不出本机**：默认 provider 是本地 `ollama` + `qwen2.5-coder`；只有当你配置了云端 provider（openai/anthropic/deepseek…），光标周围的 `prefix`+`suffix`（每侧至多 4000 字符）才会发到该 provider 的 `/chat/completions`。
- **零新增鉴权**：复用 `cc ask` 已配置的同一套 LLM 凭据，不单独存 key。
- **失败静默**：错误不弹编辑器弹窗——无 `--json` 走 stderr + 退出码 1；`--json` 返回 `error` 字段。
- **输出封顶**：硬截 2000 字符，防止失控模型把整份文件灌进编辑器。
- **IDE 硬化**：插件以 hardened env spawn 子进程，超时/取消时排干并 kill。

## 故障排除

| 现象                       | 原因                                       | 处理                                                         |
| -------------------------- | ------------------------------------------ | ------------------------------------------------------------ | ---------------------- |
| 无补全 / 空结果            | `prefix`+`suffix` 皆空，或模型判断无需插入 | 正常；把光标放到有上下文处再触发                             |
| 报错但编辑器无提示         | 无 `--json` 时错误走 stderr                | 命令行手动 `echo ...                                         | cc complete` 看 stderr |
| ollama 连不上              | 本地未起 ollama 或 base 错                 | 起 `ollama serve`，或 `--base-url http://localhost:11434`    |
| 云端 401                   | key 缺失/错误                              | 设 `--api-key` 或 `config.llm.apiKey` / 对应 `*_API_KEY` env |
| 补全带 ```围栏或`<CURSOR>` | 模型不听话                                 | `cleanCompletion` 会剥除；IDE 端再清一遍                     |
| 补全被截断                 | 触到 2000 字符硬上限                       | 设计如此；分多次触发                                         |

## 关键文件

| 文件                                                          | 职责                                            |
| ------------------------------------------------------------- | ----------------------------------------------- |
| `packages/cli/src/commands/complete.js`                       | 命令、`buildFimPrompt`、`cleanCompletion`       |
| `packages/cli/src/commands/ask.js`                            | `queryLLM` / `resolveOllamaBaseUrl`（后端复用） |
| `packages/cli/src/lib/llm-providers.js`                       | 内建 provider、base URL、API-key env 名         |
| `packages/vscode-extension/src/completion.js`                 | VS Code provider + spawn 胶水                   |
| `packages/jetbrains-plugin/.../CcCompletion.java`             | JetBrains spawn 胶水                            |
| `packages/jetbrains-plugin/.../CcInlineCompletionProvider.kt` | JetBrains InlineCompletionProvider              |

## 使用示例

### 1. 默认本地补全（原始文本输出）

```bash
echo '{"prefix":"function add(a, b) {\n  return ","suffix":"\n}","language":"javascript"}' | cc complete
```

### 2. 结构化 JSON（IDE 实际用法）

```bash
echo '{"prefix":"def fib(n):\n    ","suffix":"","language":"python"}' | cc complete --json
# → {"completion":"...","model":"qwen2.5-coder","provider":"ollama"}
```

### 3. 指定本地模型

```bash
echo '{"prefix":"SELECT * FROM ","suffix":";","language":"sql"}' | cc complete --model qwen2.5-coder:7b
```

### 4. 用云端 provider + 显式 key

```bash
echo '{"prefix":"const x = ","suffix":"","language":"typescript"}' | \
  cc complete --provider openai --model gpt-4o-mini --api-key sk-... --json
```

### 5. IDE 如何调用（示意）

IDE 手动触发时 spawn `cc complete --json`，把 `{prefix,suffix,language}` 写进子进程 stdin 后关闭，读 stdout 解析 `completion` 字段，再防御性清洗一遍渲染为灰字建议。VS Code 默认绑 `alt+\`（`editorTextFocus`），设置项 `chainlesschain.completion.enabled` 控制开关。

## 相关文档

- [IDE 插件使用指南](./ide-plugin.md) — VS Code / JetBrains 内的 ghost-text 补全与触发键
- [`cc ask` 一问一答](./cli-ask.md) — 复用的 LLM 后端与 provider 路由
- [LLM 配置 `cc llm`](./cli-llm.md) — provider / 模型 / key 的配置面
