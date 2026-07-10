# Android AI Chat × cc-exec Tool — 设计文档

> **状态**：v0.2 草案 (2026-05-19，self-review 第二轮)
> **范围**：Android AI Chat 内通过自然语言调用本地 `cc` CLI，LLM tool-call → 白名单 gate → 本地 Termux Node 执行 → 输出回 chat
> **前置**：Phase 2.5 本地终端 + cc CLI bundle 真机闭环已成 (`cc -v → 0.162.2`, Xiaomi 24115RA8EC, 2026-05-19)
> **目标平台**：Android 优先（与桌面/iOS 解耦，三端 NL→cc 形态可能不同）
>
> **v0.2 修订**：(1) `ask` 移出 v1 allowlist (C1)；(2) provider 协议归一显式化为 §4.5 (C2)；(3) Phase 5.0 加路径核实 (C4)；(4) tool-loop 上限 1→3 + 去重 (I1)；(5) Streaming UX 5 状态机加入 §4.4 (I2)；(6) Token 预算 + 强制 `--limit` 注入 (I3)；(7) fallback 增 system message 防幻觉 (C3)；(8) **重新定位为统一数据资产管理 Phase 0**（用户三条澄清后追加，见 §0 + §12）。

---

## 0. 长期愿景：手机数据资产 NL 统一管理（v0.2 战略定位）

### 0.1 完整愿景一句话

**用户手机上所有数据资产（ChainlessChain 原生 + 其它 app 数据 + 文件系统/多媒体），通过 AI Chat 自然语言 → `cc` 统一命令面 → 本地执行 → 结果回话。**

### 0.2 数据资产分层

| 层 | 内容 | 现状 | 接入 cc 的 namespace |
|---|---|---|---|
| **L1 原生** | notes / memory / skills / DID / sessions / KB / sync state | ✅ cc 已可读 (8 read cmd) | `cc note` / `cc memory` / `cc skill` / `cc did` / `cc session` / `cc search` / `cc mcp` / `cc status` |
| **L2 Hub adapter 导入** | 微信聊天 / 支付宝账单 / 邮件 / 8-vendor AI 聊天历史 / Moments / 公众号 | ⏳ 4 个 Phase 0 design 已就位，0 实现 | `cc hub <adapter>` ＊待设计 |
| **L3 手机文件系统** | 文档（/sdcard/Documents）/ 照片 / 视频 / 音频 / app 私有数据可读部分 | ⏳ MediaStore 包装 + cc 端命令均 0 实现 | `cc fs` / `cc media` ＊待设计 |
| **L4 统一实体视图** | Person / Event / Place / Item / Topic（跨 L1-L3 聚合）| ⏳ schema 已 land 在 `packages/personal-data-hub/`，KG ingestor 0 实现 | `cc entity` ＊待设计 |

### 0.3 当前 doc（v0.2）在愿景中的位置 — Phase 0 MVP

这份设计**只覆盖 L1**：8 个原生只读命令 + AI Chat tool-use 通路 + 白名单 + Android 实现。
- **它是什么**：自然语言 → cc 这条**通路**的最小可行原型；UI 状态机、tool-call 协议归一、安全模型、provider 兼容矩阵 —— 后续扩到 L2/L3/L4 时**这套基础架构全可复用**。
- **它不是什么**：完整的"管手机数据资产"产品。L2 Hub adapter / L3 文件系统 / L4 KG 实体查询都不在 v1 范围；§12 给出路线。

### 0.4 关键设计约束（被愿景倒推）

为了后续扩 L2-L4 不返工，v1 必须满足：
1. **Allowlist forward-compat**：v1 硬编码 8 命令；但 schema 设计要让加 `hub` / `fs` / `media` / `entity` 不破坏既有 type（见 §4.2 v0.2 备注）。
2. **Tool descriptor 描述 forward-compat**：description 当前列 8 命令；future 当 cc 新加命令、Android 端 bootstrap 检到时**动态扩 enum**，描述拼接（不要硬编码 8 命令在 prompt 模板里，免得 v1.1 加 `cc hub` 时全 provider 协议要回滚改 prompt）。
3. **ToolResult content schema 稳定**：plain text + exitCode/duration meta 形态在 L2/L3/L4 沿用；不要在 v1 设计成 L1-only 的 JSON 结构。
4. **5 阶段 UI 状态机抽象**：T1-T6 状态名与 L1-L4 无关；ToolCallCard 不假设命令属于哪个 namespace（只展示 `cc <cmd> ...`）。
5. **Phase 5.0 路径核实结果**要记录到 ADR，因为 L2/L3 adapter 走 cc 子命令时复用同一 ProcessBuilder 路径。

### 0.5 与 Personal Data Hub 设计对齐点

参考：`docs/design/Personal_Data_Hub_Architecture.md` (v0.2) + 4 个 adapter 设计：
- `docs/design/Adapter_Email_IMAP.md` (Phase 5)
- `docs/design/Adapter_Alipay_Bill.md` (Phase 6)
- `docs/design/Adapter_AIChat_History.md` (Phase 10)
- `docs/design/Adapter_WeChat_SQLCipher.md` (Phase 12)

**对齐承诺**：本 doc v1 不阻塞、不抢跑 Hub 工作。Hub 在 desktop 上完成 Phase 0-5 LocalVault + 1-2 个 adapter 跑通后，Android 端复用本 doc 的 tool-use 通路 + Hub 提供的 `cc hub` 命令 = 自动获得 L2 能力。

---

## 1. 目标与非目标

### 1.1 目标（v1 = §0 愿景的 Phase 0 MVP）
- **战略**：建立"自然语言 → cc 统一面"的端到端通路，使后续 L2 Hub adapter / L3 FS / L4 entity 全部沿用同一架构（见 §0.4 5 项约束）。
- **战术 v1**：用户在 AI Chat 输入「列一下我最近的笔记」「我有什么 skill」「查一下我那个关于 RAG 的笔记」等自然语言 → app 自动调用对应 **L1 原生只读** `cc` 子命令 → 结果回到 chat 流。
- **零交互**端到端：用户不需要知道 `cc note list --limit 10` 长什么样。
- **只读 + 白名单**：v1 只允许 8 个 L1 原生无副作用查询命令；写操作（`note add` / `skill install` / `did create`）走 v1.1 二次确认路径，**v1 不做**。
- 复用 Phase 2.5 已验证的 Termux Node + cc bundle 执行环境，不另起进程模型。
- 复用 `EnhancedAIChatScreen` + `LLMTestChatViewModel` + `LLMAdapter.chatWithTools()` —— **三件已就位的基础设施**。
- **Forward-compat**：Allowlist / tool descriptor / ToolResult / UI 状态机均按 §0.4 约束设计，扩 L2-L4 时只加数据不改架构。

### 1.2 非目标 (v1)
- ❌ 写命令 (`add` / `delete` / `install` / `update` / `create`)。Phase v1.1 才做，UX 不一样（必须二次确认 + diff 预览）。
- ❌ `cc ask`（v0.1 曾考虑，v0.2 移出 —— Chat 内直接问 LLM 已是自然路径，`cc ask` 在 Android Chat 里套 nested LLM call 增 2× 成本且与 T12 API key 过滤冲突。终端 tab 仍可手动用）。
- ❌ 用户自定义白名单。v1 硬编码 8 个（去 ask 后）；UI 不暴露配置。
- ❌ iOS / Desktop 端。**Android only**。iOS Phase 5 chat 已就位，但 iOS 本地无 cc，要走 DC RPC 到桌面；Desktop 有 cc 但 146 skill 系统已经把"自然语言→能力"占住，不应再叠一层。三端形态本就该差异化。
- ❌ 流式 cc 输出（cc 也基本不流式，exec 等出口即可）。
- ❌ 并行 tool calls。v1 串行。
- ⚠️ 多轮 tool call **支持但受限**：v0.2 允许最多 3 轮 + 相同 (name, args) 去重（v0.1 误限 1 轮，砍掉合法的"先 search 后 note show"组合查询）。

### 1.3 用户故事（验收锚）
1. "我最近写了什么笔记？" → `cc note list --limit 10` → chat 渲染笔记列表
2. "搜一下 RAG 相关的笔记" → `cc search RAG --limit 20` → chat 渲染命中条目
3. "我装了哪些 skill？" → `cc skill list` → chat 渲染 skill 名 + 描述
4. "看看 cc 跑得起来吗" → `cc status` → chat 渲染状态
5. "我的 DID 是什么" → `cc did show` → chat 渲染 DID
6. **组合查询**："找出我那篇关于 RAG 的笔记内容" → 第 1 轮 `cc search RAG --limit 5` → LLM 看输出选 id → 第 2 轮 `cc note show <id>` → chat 渲染笔记正文（v0.2 新增；多轮上限 3，去重防回环）
7. **拒例**："帮我删掉所有笔记" → LLM 试图 tool-call `cc note delete --all` → 白名单 deny → 假 tool_result 回灌 → LLM paraphrase "该操作 v1 暂不支持，请在终端手动执行"

---

## 2. 系统现状（调研出来的事实，不要再重查）

| 模块 | 文件 | 关键事实 |
|---|---|---|
| 本地终端 | `android-app/feature-local-terminal/src/main/java/.../LocalPtyClient.kt` | 已实现 PTY 包装；当前 session-based 交互式；**无 run-once API** |
| 本地终端 | `.../LocalFilesystemBootstrapper.kt:117-120` | Phase 2.5 从 assets 解压 cc CLI snapshot |
| 本地终端 | `.../PtyEnvironment.kt:30-34, 108-148` | 注入 OPENAI/ANTHROPIC 等 LLM key 到 env；设 `PATH=$PREFIX/bin`, `NODE_PATH=...` |
| 本地终端 | `.../ui/LocalSessionViewModel.kt:27-126` | `boot()` 启 mksh；`writeStdin(bytes)` 写命令；`stdoutFlow` + `exitFlow` 出回 |
| AI Chat | `android-app/app/src/main/java/.../presentation/screens/EnhancedAIChatScreen.kt:42-888` | Compose UI；`ChatMessage(content, codeBlock, attachedFiles, imageUrl)` |
| AI Chat | `.../LLMTestChatViewModel.kt:26-277` | 12 provider；`sendMessage(content, enableRAG)` → `streamChat` (line 90-188) |
| AI Chat | `feature-ai/src/main/java/.../data/llm/LLMAdapter.kt:12-91` | **`chatWithTools(messages, model, tools)` 已存在 (line 55-65)** → 返回 `ToolCall(id, name, arguments)` (line 87-91)；**当前未在 UI 接通** |
| 工具协议 | NOT FOUND in `android-app/` | Tool-call rendering / dispatch 协议在 Android **完全缺失**，需新建 |
| 白名单 | NOT FOUND | `safe-commands.json` 类机制不存在，需新建 |
| cc CLI 命令 | `packages/cli/src/commands/` | 134 文件；9 个明显只读：`ask` / `search` / `note (list)` / `memory` / `skill (list)` / `status` / `session (list)` / `mcp (list)` / `did (show)` |

**核心缺口**：
1. **CcExecService**（非交互式 run-once 接口） —— 调研建议「wrap LocalPtyClient 起一个 PTY 喂命令读到 exit」，**OQ-2 会重判此设计**（推荐绕开 PTY 直走 ProcessBuilder）。
2. **CcAllowlist**（命令白名单 + 强 tokenize 校验）。
3. **ToolCallDispatcher**（接 LLMAdapter.chatWithTools 返回的 ToolCall → 路由到 CcExecService）。
4. **ChatMessage tool 字段** + **ToolCallCard Composable**（UI 渲染）。
5. **LLMTestChatViewModel 接线**（`streamChat` → `chatWithTools`，工具结果再回灌为下一轮 message）。

---

## 3. 架构图

```
┌────────────────────────────────────────────────────────────────────┐
│ Android (24115RA8EC)                                              │
│                                                                    │
│  EnhancedAIChatScreen ─── 用户输入 "列一下最近的笔记" ─────────┐ │
│       ▲                                                          │ │
│       │ 渲染：                                                   │ │
│       │  • assistant 思考气泡                                    │ │
│       │  • ToolCallCard("cc note list --limit 10")               │ │
│       │  • ToolResultBlock(stdout, exitCode, duration)           │ │
│       │  • assistant 最终自然语言回复                            │ │
│       │                                                          │ │
│       └────── observes ───── LLMTestChatViewModel.messages       │ │
│                                                                  │ │
│  LLMTestChatViewModel                                           │ │
│   sendMessage(content) {                                        │ │
│     1. msgs += UserMessage(content)                            │ │
│     2. resp = adapter.chatWithTools(msgs, model, [ccExecTool]) │ │
│     3. if resp.toolCalls.isEmpty():                            │ │
│          msgs += AssistantMessage(resp.text); return           │ │
│     4. for tc in resp.toolCalls (v1 串行):                     │ │
│          msgs += AssistantMessage(toolCall=tc)                 │ │
│          result = dispatcher.dispatch(tc)         ◀── ① ──┐    │ │
│          msgs += ToolResultMessage(tc.id, result)         │    │ │
│     5. resp2 = adapter.chatWithTools(msgs, model, [ccExecTool])│ │
│        msgs += AssistantMessage(resp2.text)                    │ │
│   }                                                            │ │
│                                                                │ │
│  ToolCallDispatcher                            ◀── ① ──────────┘ │
│    dispatch(toolCall):                                          │ │
│      if toolCall.name != "cc_exec": return error("unknown")   │ │
│      args = parse(toolCall.arguments)                          │ │
│      // ② 白名单强校验                                          │ │
│      gate = CcAllowlist.check(args.command, args.subargs)     │ │
│      if !gate.allowed: return ToolResult(error=gate.reason)   │ │
│      // ③ 真执行                                                │ │
│      return CcExecService.run(args.command, args.subargs)     │ │
│                                                                │ │
│  CcAllowlist                                   ◀── ② ──────────┘ │
│    check(cmd, args): {                                         │ │
│      // strict: cmd 必须在 WHITELIST_V1 enum                  │ │
│      // strict: args 不含 metacharacter (;, &, |, $, `, \n)  │ │
│      // strict: 每命令各自白名单 flag （--limit ok, --eval no）│ │
│    }                                                           │ │
│                                                                │ │
│  CcExecService                                 ◀── ③ ──────────┘ │
│    run(cmd, args): {                                           │ │
│      // OQ-2 决策：ProcessBuilder 直走 mksh -c "cc <cmd> ..."  │ │
│      // env = PtyEnvironment.buildEnv() （复用 Phase 2.5）   │ │
│      // working dir = $PREFIX                                  │ │
│      // timeout 30s + 输出截断 16KB                           │ │
│      // 返回 CcResult(exitCode, stdout, stderr, durationMs)    │ │
│    }                                                           │ │
└────────────────────────────────────────────────────────────────┘

注：CcExecService 不进 LocalPtyClient PTY 通道（OQ-2）。
    Phase 2.5 的 LocalPtyClient 留给交互式终端 tab 继续用；
    AI Chat 专用 run-once 走 ProcessBuilder 旁路，原因见 OQ-2。
```

---

## 3.1 Phase 5.0 路径核实报告（2026-05-19，源码 verified ✅）

**核实结论**：**不需要 adb shell**。`LocalFilesystemBootstrapper.kt` + `PtyEnvironment.kt` 源码 100% 暴露 cc 真实 exec 路径，下面是 5.2 实施前必读的事实清单。

### 3.1.1 cc 命令实际是什么

**`cc` 不是二进制，不是 shebang script — 是 `mksh alias` 的文本展开。**

源：`LocalFilesystemBootstrapper.kt:488-497` 写入 `$PREFIX/etc/mkshrc`：

```sh
alias cc='$PREFIX/bin/node $PREFIX/lib/node_modules/chainlesschain/bin/chainlesschain.js'
alias chainlesschain='$PREFIX/bin/node $PREFIX/lib/node_modules/chainlesschain/bin/chainlesschain.js'
alias clc='$PREFIX/bin/node $PREFIX/lib/node_modules/chainlesschain/bin/chainlesschain.js'
alias clchain='$PREFIX/bin/node $PREFIX/lib/node_modules/chainlesschain/bin/chainlesschain.js'
```

注释明确（lines 488-493）："SELinux on Android rejects execve of files in `$PREFIX` (app_data_file context) with execute_no_trans denial. Aliases work because mksh expands them inline before execve, so the actual exec target is `bin/node` which IS exec-allowed under W^X (resolves through `../lib/libnode.so` to nativeLibraryDir)."

> **顺手发现一个小冗余**：`wireCcCliSymlinks()` (line 312-340) 又写了 `$PREFIX/bin/cc` 作为 `#!$PREFIX/bin/mksh` 头的 wrapper shell script。但 SELinux 不让 execve 它，实际 `$ cc` 命中先于 PATH 查找的 alias —— **这个 wrapper 是死代码**（历史尝试残留 / 未来 fallback）。AI Chat 路径不应依赖它。

### 3.1.2 CcExecService 唯一正确的 exec 形态（5.2 抄这段）

```kotlin
// android-app/feature-ai/src/main/java/.../tools/CcExecService.kt
internal class CcExecService @Inject constructor(
    private val bootstrapper: LocalFilesystemBootstrapper,
    private val ptyEnv: PtyEnvironment,
) {
    suspend fun run(command: String, subargs: List<String>, timeoutMs: Long = 30_000): CcResult {
        val prefix = bootstrapper.prefixDir.absolutePath
        val node = "$prefix/bin/node"
        val ccJs = "$prefix/lib/node_modules/chainlesschain/bin/chainlesschain.js"

        // Precondition: Phase 2.5 bootstrap must have run on this device
        if (!java.io.File(node).exists())
            return CcResult.error("node binary missing — 请先打开本地终端 tab 触发 bootstrap")
        if (!java.io.File(ccJs).exists())
            return CcResult.error("cc CLI snapshot missing — Phase 2.5 资源未解包，请重启 app")

        val argv = listOf(node, ccJs, command) + subargs
        val pb = ProcessBuilder(argv)
            .directory(bootstrapper.homeDir)        // cwd = $HOME, cc reads project ctx from here
            .redirectErrorStream(false)

        // env: 复用 PtyEnvironment.envp() 但过滤敏感（见 §3.1.3）
        pb.environment().clear()
        pb.environment().putAll(filteredEnvForCcExec())

        // ... start + waitFor(timeoutMs) + capture stdout/stderr (UTF-8) + 进程组 kill (T16)
    }
}
```

**3 个 verified 事实**：
1. `$PREFIX` = `<context.filesDir>/usr` （`LocalFilesystemBootstrapper.prefixDir`, line 69）— 在物理设备上展开为 `/data/user/0/com.chainlesschain.android/files/usr`。
2. `$PREFIX/bin/node` 是 symlink → `../lib/libnode.so` → APK `nativeLibraryDir/libnode.so`（patched Termux Node 25, RUNPATH=`$ORIGIN`）。SELinux 允许 execve 因为最终落到 APK 私有目录的 `lib/<abi>/libnode.so`（W^X 白名单）。
3. cc CLI 入口 = `$PREFIX/lib/node_modules/chainlesschain/bin/chainlesschain.js` —— 注意路径**不是** `@chainlesschain/cli`（v0.1 doc 写错），是 `chainlesschain/bin/chainlesschain.js`（npm pack 形态，无 scope）。

### 3.1.3 env 过滤策略（T12 具化）

PtyEnvironment.envp() 输出 12-22 个 env vars（基础 12 + 最多 10 个 LLM API key），完整清单 verified at `PtyEnvironment.kt:55-92, 108-148`：

| 类别 | env name | AI Chat cc_exec 路径处理 |
|---|---|---|
| **必保留** | `PATH`, `HOME`, `TMPDIR`, `SHELL`, `TERM`, `LANG`, `PREFIX`, `ENV`, `LD_LIBRARY_PATH`, `NODE_PATH` | 全保留（cc/node 运行必需）|
| **过滤掉** | `CC_UI_HOST`, `CC_UI_TOKEN` | AI Chat 不启 `cc ui` web 服务 |
| **过滤掉**（LLM key）| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`, `DASHSCOPE_API_KEY`, `GEMINI_API_KEY`, `VOLCENGINE_API_KEY`, `MOONSHOT_API_KEY`, `ERNIE_API_KEY`, `ZHIPU_API_KEY`, `SPARK_API_KEY` | v1 read-only 不调 LLM；防 cc 子进程意外泄漏（注：v1 已删 ask，无需这些 key）|

实现：

```kotlin
private fun filteredEnvForCcExec(): Map<String, String> {
    val FORBIDDEN_PREFIXES = listOf("OPENAI_", "ANTHROPIC_", "DEEPSEEK_", "DASHSCOPE_",
        "GEMINI_", "VOLCENGINE_", "MOONSHOT_", "ERNIE_", "ZHIPU_", "SPARK_", "CC_UI_")
    return ptyEnv.envp().mapNotNull { kv ->
        val (k, v) = kv.split('=', limit=2).let { it[0] to it.getOrElse(1) { "" } }
        if (FORBIDDEN_PREFIXES.any { k.startsWith(it) }) null else k to v
    }.toMap()
}
```

### 3.1.4 影响 — Phase 5.x 的更新

- **Phase 5.0 ✅ done**（无需 adb 验证；源码已 verified）
- **Phase 5.2**：直接抄 §3.1.2 模板 + §3.1.3 env 过滤即可，5.2 工时可从 3h 缩到 2h
- **Trap T7 修订**：原写 "mksh 不在 $PREFIX/bin"，更具体为 "node 或 chainlesschain.js 不在预期路径"
- **Trap T12 修订**：补 10 个 LLM key + 2 个 CC_UI_* 的完整清单（已在 §3.1.3）
- **Trap T17 关闭**：cc exec 路径已 verified，T17 标记 resolved
- **mksh alias / wrapper script 的设计争论**：彻底绕开，**AI Chat 路径完全不经 mksh + alias 解析**，零 shell 解释、零 PATH 查找、零 W^X 风险。

---

## 4. 协议设计

### 4.1 单一 `cc_exec` tool schema（canonical form）

**v0.2 注**：OpenAI / Anthropic / Doubao **schema 形状不一致**：
- OpenAI Chat Completions：`tools: [{type:"function", function:{name, description, parameters: <jsonschema>}}]`
- Anthropic Messages：`tools: [{name, description, input_schema: <jsonschema>}]`，且 messages 内 tool_result **role 是 user**（不是 tool）含 `content:[{type:"tool_result", tool_use_id, content}]`
- Doubao：近 OpenAI 形态

dispatcher 持有的是 **canonical 中间态**（下面这份），每个 adapter 内部转换 —— 见 §4.5。

```jsonc
// canonical（dispatcher 喂给 LLMAdapter.chatWithTools 的形态）
{
  "name": "cc_exec",
  "description": "Execute a read-only ChainlessChain CLI query command on the user's local device. Allowed commands: note (list/show), search, memory (list/show), skill (list), status, session (list), mcp (list), did (show). Cannot be used for write/delete/install operations. For queries that may return many rows, the runtime auto-injects --limit if not provided.",
  "parameters": {
    "type": "object",
    "properties": {
      "command": {
        "type": "string",
        "enum": ["note", "search", "memory", "skill", "status", "session", "mcp", "did"],
        "description": "The cc subcommand to invoke."
      },
      "subargs": {
        "type": "array",
        "items": {"type": "string"},
        "description": "Arguments, e.g. ['list', '--limit', '10']. Each arg is a plain token (no shell metacharacters)."
      }
    },
    "required": ["command", "subargs"]
  }
}
```

**为什么单一 generic tool 而非 8 个 typed tool**（cc_note_list / cc_search / ...）：
- token 成本：8 个 tool descriptor 比 1 个胖 ~7×，每轮 chat 都付。
- LLM 选择困难：8 个 tool 名近似，选错率升高。
- 维护成本：新加只读 cmd 只改 enum + Allowlist，不需 8 个 schema。
- 缺点：参数自由度大，LLM 可能传错 flag —— 由 **Allowlist 第二层 strict 校验 + 数值范围 + 默认 --limit 注入** 兜底（见 4.2）。

**Default `--limit` 注入策略（v0.2 新增，缓解 token 爆炸）**：
- `note list` / `search` / `memory list` / `session list` 若 subargs 未含 `--limit` 形式参数，dispatcher 自动追加 `--limit 20`。
- 用户/LLM 显式传值仍以白名单 range 校验为准（见 §4.2）。
- 注入操作发生在 Allowlist 通过之后、CcExecService 调用之前，对 LLM 透明（LLM 看到的 tool_result stdout 体现实际被限的数量）。

### 4.2 Allowlist v1（硬编码 Kotlin enum）

```kotlin
// android-app/feature-ai/src/main/java/.../tools/CcAllowlist.kt
internal object CcAllowlist {
    const val MIN_CC_VERSION = "0.162.0"     // bootstrap check，低于此版本拒所有 tool call

    data class FlagSpec(
        val name: String,                    // 含 '--' 前缀
        val type: FlagType,                  // BOOL / INT / STRING_LIMITED
        val intRange: IntRange? = null,      // INT 时必填，超 range 拒
        val stringMaxLen: Int = 64           // STRING_LIMITED 时使用
    )
    enum class FlagType { BOOL, INT, STRING_LIMITED }

    data class CmdSpec(
        val command: String,
        val allowedSubcommands: Set<String>?,
        val flags: List<FlagSpec>,
        val maxArgs: Int = 8,
        val defaultLimit: Int? = null        // 非 null 时 dispatcher 在未传 --limit 时自动追加 "--limit <N>"
    )

    private val LIMIT_1_200 = FlagSpec("--limit", FlagType.INT, 1..200)
    private val JSON_BOOL   = FlagSpec("--json", FlagType.BOOL)

    val V1: Map<String, CmdSpec> = listOf(
        CmdSpec("note",    setOf("list", "show", "view"), listOf(LIMIT_1_200, JSON_BOOL, FlagSpec("--id", FlagType.STRING_LIMITED, stringMaxLen=128)), defaultLimit = 20),
        CmdSpec("search",  null,                          listOf(LIMIT_1_200, JSON_BOOL), defaultLimit = 20),
        CmdSpec("memory",  setOf("list", "show"),         listOf(LIMIT_1_200, JSON_BOOL), defaultLimit = 20),
        CmdSpec("skill",   setOf("list"),                 listOf(JSON_BOOL)),
        CmdSpec("status",  null,                          listOf(JSON_BOOL)),
        CmdSpec("session", setOf("list"),                 listOf(LIMIT_1_200, JSON_BOOL), defaultLimit = 20),
        CmdSpec("mcp",     setOf("list"),                 listOf(JSON_BOOL)),
        CmdSpec("did",     setOf("show"),                 listOf(JSON_BOOL))
        // 注：v0.2 起 'ask' 移出。Chat 内自然询问已是 LLM 直答路径，nested cc ask 增 2× LLM 调用成本。
    ).associateBy { it.command }

    // 命令名/subcommand 必须 ASCII 小写（防同形字攻击 T6）
    private fun isAsciiKebabLower(s: String): Boolean =
        s.isNotEmpty() && s.all { it in 'a'..'z' || it == '-' }

    private val FORBIDDEN_CHARS = setOf(';', '&', '|', '$', '`', '\n', '\r', '>', '<', ' ')

    fun check(command: String, subargs: List<String>): GateResult {
        if (!isAsciiKebabLower(command)) return GateResult.deny("non-ASCII command name")
        val spec = V1[command] ?: return GateResult.deny("command '$command' not in v1 allowlist")
        if (subargs.size > spec.maxArgs) return GateResult.deny("too many args (${subargs.size} > ${spec.maxArgs})")

        // subcommand 校验
        val firstNonFlag = subargs.firstOrNull { !it.startsWith("--") }
        if (spec.allowedSubcommands != null && firstNonFlag != null) {
            if (!isAsciiKebabLower(firstNonFlag) || firstNonFlag !in spec.allowedSubcommands)
                return GateResult.deny("subcommand '$firstNonFlag' not in allowlist for '$command'")
        }

        // 每个 arg strict scan
        var i = 0
        while (i < subargs.size) {
            val a = subargs[i]
            if (a.isEmpty()) return GateResult.deny("empty arg")
            if (a.length > 256) return GateResult.deny("arg too long")
            if (a.any { it in FORBIDDEN_CHARS }) return GateResult.deny("forbidden char in arg: ${a.take(40)}")

            if (a.startsWith("--")) {
                // 拆 --name=value 或 --name + 下一 arg 形态
                val name = a.substringBefore('=')
                val flagSpec = spec.flags.firstOrNull { it.name == name }
                    ?: return GateResult.deny("flag '$name' not in allowlist for '$command'")

                val valueRaw: String? = when {
                    a.contains('=') -> a.substringAfter('=')
                    flagSpec.type == FlagType.BOOL -> null
                    else -> subargs.getOrNull(i + 1)?.also { i++ }
                        ?: return GateResult.deny("flag '$name' missing value")
                }

                when (flagSpec.type) {
                    FlagType.BOOL -> if (valueRaw != null && valueRaw !in setOf("true","false"))
                        return GateResult.deny("bool flag '$name' got non-bool '$valueRaw'")
                    FlagType.INT -> {
                        val n = valueRaw!!.toIntOrNull()
                            ?: return GateResult.deny("flag '$name' value '$valueRaw' not int")
                        if (n !in flagSpec.intRange!!)
                            return GateResult.deny("flag '$name' value $n out of range ${flagSpec.intRange}")
                    }
                    FlagType.STRING_LIMITED -> {
                        if (valueRaw!!.length > flagSpec.stringMaxLen)
                            return GateResult.deny("flag '$name' value too long")
                    }
                }
            }
            i++
        }

        return GateResult.allow
    }

    /** dispatcher 在 Allowlist 通过后、CcExecService 调用前调用：未传 --limit 时按 spec 注入。 */
    fun applyDefaults(command: String, subargs: List<String>): List<String> {
        val spec = V1[command] ?: return subargs
        val lim = spec.defaultLimit ?: return subargs
        val hasLimit = subargs.any { it == "--limit" || it.startsWith("--limit=") }
        return if (hasLimit) subargs else subargs + listOf("--limit", lim.toString())
    }
}

sealed class GateResult {
    object Allow : GateResult()
    data class Deny(val reason: String) : GateResult()
    companion object {
        val allow: GateResult = Allow
        fun deny(reason: String): GateResult = Deny(reason)
    }
}
```

**安全防线（三层）**：
1. LLM 层（tool descriptor 限定 enum + 描述明确"read-only"）—— 软约束，可绕过。
2. Allowlist 层（command/subcommand/flag 三段 strict match + 元字符黑名单 + **flag value 类型/范围/长度校验 + ASCII-only 命令名**）—— 硬约束，**这是真防线**。
3. 进程层（ProcessBuilder 不走 shell，args 数组传递，**不存在 shell injection**）—— 兜底。

**版本兼容校验**：app 启动时（或首次 chat 内 tool call 前）跑 `cc --version`，若低于 `MIN_CC_VERSION` 不开 cc_exec tool descriptor（chat header 显示 "🔧 cc bundle 过旧，请升级 app"）。

**Forward-compat 设计承诺（§0.4 倒推）**：v1 硬编码 8 个 L1 命令；v1.x/v2 扩 L2-L4 时**加法不改架构**：
- 新加 namespace（如 `cc hub wechat search` / `cc fs ls` / `cc media photo` / `cc entity person`）只需追加 `CmdSpec` 到 `V1` map（演进可命名 `V2` / `V3` 同时保留 `V1` 兼容），CmdSpec data class 形态不变。
- LLM 看到的 enum 列表由 `V1.keys.toList()` 动态生成，prompt 模板不硬编码命令名 —— 加新命令零 prompt 改动。
- 复合命名（`hub wechat`）的处理：`command = "hub"`，`subargs = ["wechat", "search", ...]`，复用现有 subcommand 校验逻辑（`allowedSubcommands` 改 nested 校验函数即可，class 字段不变）。
- 跨 namespace 数据查询（如"找一下我妈妈相关的所有事"→`cc entity person --name 妈妈 --include events,items`）走 L4 实体接口，复用同一 Allowlist 机制。

### 4.3 ToolResult 回灌格式（canonical → adapter 翻译）

dispatcher 持有的 canonical tool_result：

```jsonc
{
  "toolCallId": "<original-id>",
  "content": "exitCode=0\nduration=234ms\nstdout (truncated to 4KB if needed):\n<raw cc output>\n\nstderr:\n<stderr if any>"
}
```

各 adapter 翻译到 SDK message 时形态不同：
- **OpenAI**: `{role:"tool", tool_call_id, content}`
- **Anthropic**: 加进 `messages` 数组的 **`role: "user"`** 项（不是 `tool`）：`{role:"user", content:[{type:"tool_result", tool_use_id, content}]}`
- **Doubao**: 同 OpenAI 形态

**stdout 截断阈值 v0.2 改为 4KB**（v0.1 误写 16KB → 4000 tokens × 多轮上下文爆炸）。超过部分追加 `\n... [TRUNCATED, total=NNNNN bytes, NNN lines]`。

**为什么 content 是 plain text 而非 JSON**：cc 输出本就是给人看的（表格、彩色 → 已剥 ANSI），LLM 直接 paraphrase；JSON wrap 反而让模型困惑"是数据还是元数据"。

### 4.4 Streaming UX 五阶段状态机（v0.2 新增）

整端到端含 2 次 LLM roundtrip + 1 次 cc exec，**期间 UI 必须显式表达 5 阶段**，否则 5~15s 黑屏感等同于挂死。状态字段加在 `ChatMessage`：`status: ChatStatus` ∈ {THINKING, TOOL_CALLED, TOOL_RUNNING, TOOL_DONE, FINALIZING, COMPLETE, FAILED, CANCELLED}。

```
T0 ─ user sendMessage
  │
T1 ─ status=THINKING；UI："正在思考..." + spinner
  │   LLM 1st pass 流式：若模型有前缀文字（"我帮你查一下..."），逐 token 流到 assistant 气泡（不是 ToolCallCard）
  │   LLM 决定 tool call：tool_call delta 累积到完整 args
  │
T2 ─ status=TOOL_CALLED；UI：ToolCallCard 折叠形态出现，标题 `cc note list --limit 10`
  │
T3 ─ status=TOOL_RUNNING；UI：ToolCallCard 加 "执行中..." progress dot + 30s timer
  │   Allowlist gate → applyDefaults → CcExecService.run()
  │
T4 ─ status=TOOL_DONE；UI：ToolCallCard 显示 exitCode=N、duration=Xms、stdout 前 6 行预览 + "展开" 折叠按钮
  │   ToolResultMessage 入 messages 列表
  │
T5 ─ status=FINALIZING；UI："整理结果..." spinner
  │   LLM 2nd pass 流式：assistant 最终回复 token-by-token 流出
  │   多轮 tool-call 模式：若 LLM 又发 tool_call 且未触上限/去重 → 回到 T2 重复
  │
T6 ─ status=COMPLETE；spinner 撤；输入框 re-enable
```

**关键 UI 规则**：
- T1 阶段 LLM 前缀文字必须流式显示（OpenAI/Claude 通常会发 "I'll check..." 前缀，砍掉它 = 失去思考链路反馈）。
- T3 阶段提供 "取消" 按钮 → 取消 ViewModel scope → `CcExecService.run` cancellable suspending → 进程组 kill（见 T16）。
- T5 阶段若 LLM 又发 tool_call，UI 滚动追加新 ToolCallCard，不复用上一个。
- T2/T3 共用 ToolCallCard 组件，只切内态 prop；不要新建/销毁，避免 reflow 抖动。
- T4 "展开"动作 expand 整 stdout（无 4KB 限制，本地查看用）。

### 4.5 LLMAdapter 协议归一（v0.2 显式化 C2）

`LLMAdapter.chatWithTools(messages, model, tools)` 签名保持，但**各 adapter 内部归一**职责显式：

| 责任 | 实现位置 |
|---|---|
| canonical tool schema → SDK tool descriptor | `OpenAIAdapter.toOpenAITools()` / `AnthropicAdapter.toAnthropicTools()` / `DoubaoAdapter.toDoubaoTools()` |
| canonical ChatMessage(role=tool,...) → SDK message | adapter 内部 `materializeMessages()` |
| SDK streaming chunk → canonical `ChatWithToolsResponse` | adapter 内 stream collector：累积 `delta.tool_calls[].function.arguments` (OpenAI/Doubao) 或 `input_json_delta` events (Anthropic) 到完整 JSON 后解析 |
| 文本前缀 prefix + tool_call 共存 | adapter 同时透出 `text: String?` 和 `toolCalls: List<ToolCall>` |

**fallback 行为（v0.2 fix C3）**：当前 `LLMAdapter` 默认 impl 静默丢 tools，**会让 LLM 幻觉假数据**。修法：
- LLMAdapter interface 加 `val supportsToolUse: Boolean` 属性，默认 false。
- ViewModel 在 `sendMessage` 前检查 `adapter.supportsToolUse`：
  - true → 走 chatWithTools 路径。
  - false → 走原 streamChat 路径，**并 prepend system message**：「本模型不支持工具调用，遇到需要查询本地数据的请求（笔记/skill/状态等），请明确告知用户切换到 OpenAI/Doubao/Anthropic 模型，不要凭空捏造答案。」
- 在 chat header 显示 "🔧 工具调用：可用 / 不支持当前模型 (切换模型可启用)"。

**v1 真接的 3 个 adapter（覆盖率验收）**：OpenAI / Doubao / Anthropic。其它 9 provider supportsToolUse=false 走 fallback。

---

## 5. 子阶段拆分（v0.2 修订）

| Phase | 内容 | 工时 | 产出 |
|---|---|---|---|
| **5.0** | ~~cc 实际 exec 路径核实~~ ✅ **Done 2026-05-19** | 0h (源码 verified) | 通过读 `LocalFilesystemBootstrapper.kt` + `PtyEnvironment.kt` 100% 确认；详见 §3.1。无需 adb shell。**5.2 可直接抄 §3.1.2 模板**。 |
| **5.1** | CcAllowlist + 单测 **← NEXT** | 3h | `CcAllowlist.kt`（含 flag value type/range/length + ASCII guard + applyDefaults）+ ≥30 单测（allow/deny 各 case，含 `--limit 99999` / 西里尔同形字 / boolean type / range 边界） |
| **5.2** | CcExecService + 单测 | 2h (从 3h 下调 — Phase 5.0 已把路径 + env 过滤模板写出) | `CcExecService.kt`（直抄 §3.1.2 + §3.1.3，30s timeout，cancellable suspending，进程组 kill）+ ≥12 单测（含真跑 `cc -v` 集成测 + 中文 stdout + 进程组 kill ps 验） |
| **5.3** | ToolCallDispatcher + 单测 | 2h | `CcToolCallDispatcher.kt`（route + Allowlist gate + applyDefaults + JSON.decodeFromString 兜底 stringified args + 假 tool_result 错误回灌）+ ≥8 单测 |
| **5.4** | LLMTestChatViewModel 接线 | 4h | `sendMessage` 加 tool-loop（v0.2 上限 3 + 相同 (name, args) 去重 + token budget watchdog）+ supportsToolUse 路径分支 + fallback system message prepend + 并发 mutex + ≥10 单测 mock `LLMAdapter.chatWithTools` |
| **5.5** | EnhancedAIChatScreen UI + 状态机 | 4h | `ChatMessage.status/toolCall/toolResult` 字段 + `ToolCallCard`（T2/T3 共用） + `ToolResultBlock`（4KB 展开） + 5 阶段状态机（§4.4 T1-T6） + 取消按钮 + chat header tool-availability badge |
| **5.6.0** | **LLMAdapter 协议归一层**（v0.2 新增 C2）| 3h | 新增 `LLMAdapter.supportsToolUse: Boolean` + canonical `Tool/ToolCall/ToolResult` data class + `materializeMessages()` 抽象 + ≥6 单测验证 canonical→3 家 SDK 形态转换 |
| **5.6** | 3 Provider tool-use 真接 | 6h | OpenAI / Doubao / Anthropic 三 adapter 各自实现 `chatWithTools`（含 streaming chunk 累积 + tool_calls vs input_json_delta 协议差异） + canned fixture replay 单测每家 ≥3 + 其它 9 provider 默认 supportsToolUse=false |
| **5.7** | 静态审计 | 1h | 跑 detekt + 验收 Checklist（§10）逐项打勾 |
| **5.8** | 真机 E2E | 2h | Xiaomi 24115RA8EC 9 场景跑通（见 §8.3） |

**总工时**：~27h ≈ 3-4 天（v0.2: 5.0 从 0.5h→0h、5.2 从 3h→2h，源码 verified 替代 adb）。

**串行依赖**：~~5.0~~ ✅ → **5.1 (NEXT)** → 5.2 → 5.3 → 5.4 ←（5.6.0 → 5.6）→ 5.5 → 5.7 → 5.8。5.5 与 5.6 可并行（5.5 mock adapter，5.6 mock UI）；5.6.0 必先于 5.6 和 5.4。

---

## 6. Open Questions（v0.2 收口）

> **状态**：OQ-1 ~ OQ-7 全部 **已决断**。本节保留决策记录便于回看；新 OQ 出现再追加。

### OQ-1：单一 generic tool vs N 个 typed tool？— **采纳 A（单 generic）**
B（typed）token 翻 ~7 倍 + 维护成本 + LLM 选错率，唯一好处是 schema 强类型而 v1 Allowlist 已经强类型兜底。

### OQ-2：CcExecService 走 PTY 还是 ProcessBuilder？— **采纳 B（ProcessBuilder + node 直 invoke）**
PTY 是交互式 session，end-detect 靠 prompt 解析脆且 LocalPtyClient owner 生命周期与 AI Chat 不匹配。ProcessBuilder 直跑 node + js entry **零 shell injection 面**、exit code 原生、env 复用 `PtyEnvironment.buildEnv()`。Phase 5.0 先核实 node + js entry 真实路径。

### OQ-3：白名单源头 — **采纳 A（硬编码 Kotlin enum）**
JSON / `cc --help` 派生 v1 不必要；后者更危险（`--force` 看着无害实则破坏性）。v1.1 暴露用户设置时再考虑 JSON 化。

### OQ-4：哪些 LLM provider 在 v1 真接 chatWithTools？— **采纳 A（OpenAI / Doubao / Anthropic）**
其它 9 provider supportsToolUse=false，**fallback 必带 system message 防幻觉**（见 §4.5 v0.2 修订）。

### OQ-5：tool call 超时？— **采纳 B（30s wall-clock + 4KB 截断，v0.2 从 16KB 改 4KB）**

### OQ-6：拒答提示怎么回灌？— **采纳 B（假 tool_result error，LLM paraphrase）**
exitCode=126, stderr="command not allowed in v1 read-only mode"。UX 连贯，不打断对话流。

### OQ-7：`cc ask` 留还是删？（v0.2 新增）— **采纳 A（v1 移出 allowlist）**
原因：
1. Chat 内自然询问已是 LLM 直答路径，nested cc ask 增 2× LLM 调用 + 2× 延迟 + 2× 成本。
2. T12（API key env 过滤）与 cc ask 需要 LLM key 直接冲突 —— 留 ask 必须给 cc ask 例外保留 key，加复杂度。
3. 用户真要"用 cc 跑 LLM 问答"可在终端 tab 手动 `cc ask`，不属高频需求。
v1.1 若有强需求再加，届时配独立 ask-specific env handling。

---

## 7. Forward-Looking Traps

| # | Trap | 触发点 | 防御 |
|---|---|---|---|
| T1 | Tool-call streaming 协议各家不一 | 5.6 接 3 provider | LLMAdapter 已抽象 `ChatWithToolsResponse`；每 adapter 实现内部归一；测试矩阵每家跑一遍 sample tool call |
| T2 | cc stdout 大（`cc search` 几千行）| 5.2 | 16KB 截断 + 末尾追加 `\n... [TRUNCATED, total=NNNNN bytes]`；超大文件本就该让用户去终端看 |
| T3 | Android logcat / String 解码默认 UTF-8 但 cc 输出含中文宽字符 | 5.2 | `ProcessBuilder.redirectErrorStream(false)` + `InputStreamReader(stream, "UTF-8")` 显式；测试用例覆盖中文 note title |
| T4 | cc exit code 非 0 不等于"失败"（如 `cc search` 无命中 exit 1） | 5.2 / 5.3 | dispatcher 不把 exitCode≠0 当 dispatch error；原样回灌 LLM，让 LLM 判断 |
| T5 | 用户中途取消 chat（按返回 / kill app） | 5.4 / 5.5 | `CcExecService.run` 必须 cancellable suspending；ViewModel scope cancel 时 `Process.destroyForcibly()` |
| T6 | Allowlist string match 被 unicode 同形字绕过（如 `note` vs `nоte` 西里尔 о） | 4.2 | ASCII-only check：`require(command.all { it in 'a'..'z' \|\| it == '-' })`；Allowlist key 同样 ASCII |
| T7 | **cc 入口不在预期路径**（Phase 5.0 verified path：`$PREFIX/bin/node` + `$PREFIX/lib/node_modules/chainlesschain/bin/chainlesschain.js`，**不是** `@chainlesschain/cli`）；首次启动 bootstrap 未跑 / 失败 / cc-cli.tgz 资产缺 | 5.2 | `CcExecService.run` 第一步两 file exists check；缺 → 返回 ToolResult error "请先打开本地终端 tab 触发 bootstrap" |
| T8 | cc CLI 版本不匹配 Allowlist（cc 升级后某 cmd 改名/删除） | 5.7 / 5.8 | bootstrap 时跑 `cc --version` 记录；E2E 跑 `cc <each-allowed-cmd> --help` 冒烟；列在 5.8 |
| T9 | LLM tool call arguments 是 stringified JSON 不是 object（OpenAI 历史行为） | 5.3 | `parseArgs(toolCall.arguments)` 既接 `Map` 又接 `String`（先 JSON.decodeFromString 兜底） |
| T10 | 多 tool calls 同 LLM 回复（虽 v1 不支持但模型可能发） | 5.4 | sendMessage 强制只取 `resp.toolCalls.firstOrNull()`；多余的扔，附 system note "v1 单次一个工具" |
| T11 | LLM 反复 tool_call（合法多步 vs 死循环） | 5.4 | v0.2：上限 **3 轮** tool call（v0.1 误限 1 砍掉合法的 search→show 组合查询）+ 相同 `(name, args)` 去重（hash key = name + sortedJson(args)）+ 上限触发后发 system note "已达工具调用上限，下面以现有信息回复" |
| T12 | PtyEnvironment Phase 2.5 注入 LLM API key，cc 子进程可拿到 | 5.2 | v0.2 + Phase 5.0 verified：12 + 10 env vars 完整清单见 §3.1.3。过滤前缀清单 `OPENAI_/ANTHROPIC_/DEEPSEEK_/DASHSCOPE_/GEMINI_/VOLCENGINE_/MOONSHOT_/ERNIE_/ZHIPU_/SPARK_/CC_UI_`；保留 `PATH/HOME/TMPDIR/SHELL/TERM/LANG/PREFIX/ENV/LD_LIBRARY_PATH/NODE_PATH` |
| T13 | 用户在 chat 同时跑多个 cc | 5.4 | ViewModel-level mutex：tool dispatch 期间 `isToolRunning=true` block 新 sendMessage（输入框 disable + spinner） |
| T14 | Allowlist 演进时 Kotlin enum 与文档不同步 | 5.1 | 测试断言：`CcAllowlist.V1.keys == DOCUMENTED_COMMANDS`（DOCUMENTED_COMMANDS 在测试里硬编码本设计文档 §4.2 列出的 8 个） |
| T15 | Token 预算爆炸（v0.2 新增 I3）：4 条历史 + 16KB stdout + 8 命令 enum + 2 次 tool roundtrip → 小 context 模型爆 | 5.2 / 5.4 | 三重防御：(a) §4.1 dispatcher 自动注入 `--limit 20` 默认；(b) §4.3 stdout 4KB 截断；(c) 5.4 维护 token estimate watchdog，> model.contextLimit × 0.7 时截短历史（保留 system + 最近 4 条 + 当前 turn） |
| T16 | 进程树 kill：cc 可能 spawn 子模块/插件，`Process.destroyForcibly()` 只杀直接子 → 孙子僵尸（v0.2 新增 I5）| 5.2 | 复用 Phase 2.5 LocalSessionViewModel.shutdown() 的 pgid 杀整组方案；Android 上用 `Os.killpg(pgid, SIGTERM)` → 200ms → `SIGKILL`；5.8 E7 跑完用 `adb shell ps \| grep node` 验零残留 |
| T17 | ~~cc 实际 exec 路径与 Phase 2.5 不一致~~ | ~~5.0~~ | **✅ Resolved (2026-05-19)**: Phase 5.0 源码 verified，路径见 §3.1.2，**无需 adb 验证**。AI Chat 路径完全绕开 mksh alias / shell wrapper，直 node + chainlesschain.js |

---

## 8. 测试与 E2E

### 8.1 单测目标（5.1–5.5 累计 ≥50 unit）

| 模块 | 测试用例 |
|---|---|
| CcAllowlist | allow `note list --limit 10` / allow `search foo` / deny `note delete` / deny `note ; rm -rf /` / deny `note --eval ...` / deny 元字符 / deny 命令名西里尔 / 边界 maxArgs / empty arg / 256+ char arg |
| CcExecService | 真跑 `cc -v` 集成测 / mock ProcessBuilder unit / timeout / stdout 截断 / stderr 捕获 / cancellation / `$PREFIX/bin/node` 不存在 / 中文 stdout |
| CcToolCallDispatcher | 路由 ok / unknown tool / parse JSON args / parse stringified JSON args / gate deny → fake tool_result / exec error → fake tool_result |
| ViewModel | sendMessage 无 tool call 路径 / 单 tool call 路径 / 多 tool call 取首 / tool loop 上限 / mutex / provider 不支持 tool fallback |
| UI | ToolCallCard 渲染 / 长 stdout 折叠展开 / exitCode≠0 红色 badge / 取消按钮 |

### 8.2 集成测（≥3）
1. mock LLMAdapter 返回 ToolCall("cc_exec", {command:"note", subargs:["list"]}) → 真跑 cc → stdout 回灌 → adapter 第二轮被调用且看到 tool_result message。
2. mock LLMAdapter 返回 ToolCall("cc_exec", {command:"note", subargs:["delete"]}) → Allowlist deny → adapter 第二轮看到 error tool_result。
3. ViewModel scope cancel 在 cc 执行中 → CcExecService 抛 CancellationException 且 Process killed (`ps` 无遗留)。

### 8.3 真机 E2E（Xiaomi 24115RA8EC，Phase 2.5 终端基线已验；v0.2 9 场景）

| # | 场景 | 验收 |
|---|---|---|
| E1 | 装好新 APK → 开 chat → 选 OpenAI 模型 → "列一下最近的 10 个 note" | ≤ 12s 端到端，UI 经历 T1→T2→T3→T4→T5→T6 5 阶段；ToolCallCard 显示 `cc note list --limit 10`；exitCode=0 |
| E2 | "搜一下 RAG 相关笔记" | 调 `cc search RAG --limit 20`（v0.2 默认注入）→ 命中条目；如无命中 LLM 解释 "未找到，可能..." |
| E3 | "我有什么 skill？" | `cc skill list --json` → LLM paraphrase 成人话列表（不照搬 JSON） |
| E4 | "查一下 cc 跑得起来吗" | `cc status` → chat 渲染 + LLM 总结"运行正常 / 异常 X" |
| E5 | "帮我把所有笔记删了" | Allowlist deny → 假 tool_result error 回灌 → LLM 自然解释"v1 暂不支持"；`adb shell ps \| grep node` 0 残留 |
| E6 | 切 Qwen → "列下笔记" | supportsToolUse=false 路径：streamChat + 注入 system message → LLM 不编假数据，明确提示切换模型 |
| E7 | tool call 跑到一半按返回退出 chat | 取消按钮 / scope cancel → 200ms 内 SIGTERM → 1s 内 SIGKILL 兜底；`adb shell ps` 0 node 残留（含孙子进程） |
| E8 | **多轮组合查询**（v0.2 新增 E9 替代原 ask E8）："找出我那篇关于 RAG 的笔记内容" | UI 展示 2 个 ToolCallCard：1) `cc search RAG --limit 5` 2) `cc note show <id>`；中间 LLM 看 search 输出选 id；3 轮上限未触发；E1 之后 ≤ 20s |
| E9 | **去重防回环**：诱导 LLM "用相同参数再搜一次"（如让模型连续调 `search RAG` 3 次） | 第 2 次去重命中 → dispatcher 直接返回上次 tool_result 不再 exec；3 次 tool call 上限触发后 LLM 改文字回答；ps 仅 1 次 node 真启 |

### 8.4 性能基线（v0.2 修订 — v0.1 ≤ 5s 不现实）
- E1 端到端 **p50 ≤ 10s, p95 ≤ 18s**（含 LLM 1st pass 2-3s + cc exec 0.5-1s + LLM 2nd pass 2-3s + UI + 国内访 OpenAI/Anthropic 网络抖动）
- E8 多轮 p50 ≤ 18s, p95 ≤ 30s
- cc exec 单次 p50 ≤ 800ms，p95 ≤ 3s
- 内存：tool exec 期间 RSS 增 ≤ 80MB（node + cc bundle）；多轮不应累积（验 E8 期间 RSS 增 ≤ 100MB）
- 取消响应：≤ 1.5s 用户按取消到进程组完全 kill

---

## 9. v1.1 短线路线（同一 L1 层内增量）

不在 v1 范围，但设计要预留接口：
- **写命令 UX**：ToolCallCard 多一个 "确认执行 / 取消" 按钮，点击前 cc 不真跑；CcExecService 接 `dryRun: Boolean` 参数（dryRun=true 时 cc 子命令加 `--dry-run` flag，要求 cc 侧支持 —— 这是 cc CLI 的 follow-up）。
- **多轮 agent**：tool-loop 上限从 3 改 5，加 token budget；UI 渲染"步骤 1/3, 2/3..."。
- **用户配置白名单**：设置页加"高级 → 启用以下写命令"，多选；持久化到 EncryptedSharedPreferences。
- **历史回放**：每次 tool call 持久化 `(cmd, stdout-hash, timestamp)` 到 Room，便于 audit + 用户查"我让 AI 跑过什么"。
- **离线 fallback**：网络断开时，纯本地 cc 仍可跑（不需要 LLM 翻译），出"直接终端模式"快捷入口。

---

## 10. 验收 Checklist（5.7 用，v0.2 修订）

- [ ] **Phase 5.0 路径核实结果**回填到 §3 注释（cc 真实 entry path 实测记录）
- [ ] `CcAllowlist.V1` 与本文档 §4.2 列出的 **8 个**命令一一对应（已去 ask）
- [ ] `CcAllowlist` 含 flag value type/range/length 校验 + ASCII guard + applyDefaults
- [ ] `MIN_CC_VERSION` check 在启动期跑，低版本时 tool descriptor 不暴露给 LLM
- [ ] `CcExecService` 走 ProcessBuilder 直 node 路径（OQ-2 B），未 import LocalPtyClient
- [ ] env 过滤剔除 `*_API_KEY` / `*_TOKEN` 等敏感前缀（T12）
- [ ] cwd 设 `$PREFIX/home`；UTF-8 显式解码
- [ ] 进程组 kill 复用 LocalSessionViewModel.shutdown() 同方案（SIGTERM→SIGKILL，T16）
- [ ] tool-loop 上限 hardcoded = **3** + (name, args) 去重（T11 v0.2）
- [ ] token budget watchdog 在 > model.contextLimit × 0.7 时截短历史（T15）
- [ ] stdout 截断 **4KB**（v0.2 改）
- [ ] ViewModel 在 tool exec 期 disable 输入（T13）
- [ ] `LLMAdapter.supportsToolUse: Boolean` 属性已加；fallback 路径 prepend 防幻觉 system message（C3）
- [ ] 3 provider (OpenAI/Doubao/Anthropic) `chatWithTools` canned fixture 各 ≥3 测过
- [ ] 9 个其它 provider 的 supportsToolUse=false 默认路径稳定（不崩）
- [ ] UI 5 阶段状态机（§4.4 T1-T6）实现 + 取消按钮 + chat header tool-availability badge
- [ ] detekt 干净 + `app:assembleDebug` 0 warning
- [ ] adb logcat 跑 E1-E9 无 ANR / native crash
- [ ] E7 取消后 `adb shell ps \| grep node` 0 残留
- [ ] CHANGELOG.md + docs-site/changelog.md 同步追加 entry

---

## 11. 实施前的决策点（v0.2 收尾）

v0.1 列的 3 项决策全部默认推荐已采纳：
- ✅ OQ-2 = B（ProcessBuilder + node 直 invoke）
- ✅ OQ-4 = A（OpenAI / Doubao / Anthropic 三家）
- ✅ Allowlist 命令清单（v0.2 改 8 个，去 ask）

v0.2 self-review 后新增 7 项已直接改进文档（无需再确认）：
- ✅ C1 ask 移出
- ✅ C2 §4.5 协议归一层 + 5.6.0 子阶段
- ✅ C3 fallback system message
- ✅ C4 Phase 5.0 真路径核实
- ✅ I1 tool-loop 上限 3 + 去重
- ✅ I2 §4.4 5 阶段 UX 状态机
- ✅ I3 token 预算 + 默认 --limit 注入 + 4KB 截断

**仍需用户确认的 1 项**：
- **Phase 5.0 是否先做？**（推荐：做，0.5h 投入避免 5.2 撞墙）

确认后即可起 5.0 → 5.1。

---

## 12. v1 → v5 长线路线（手机数据资产统一管理）

### 12.1 阶段总览

| 版本 | 数据层 | 时间窗 | 用户体验 | 关键依赖 |
|---|---|---|---|---|
| **v1.0** (本 doc) | L1 原生只读 | ~4 天 | "列我的笔记" / "搜 RAG 笔记" 等 8 命令 | Phase 2.5 ✅ |
| **v1.1** | L1 原生 + 写 | ~1 周 | "帮我加个笔记 X" / "给笔记 Y 加标签 Z"（带二次确认 UI）| §9 短线 |
| **v2.0** | + L2 Hub adapter（首批 2 个）| 2-3 月 | "搜下我和老妈的微信聊天" / "本月支付宝消费多少" | Personal Data Hub Phase 0-5 LocalVault + WeChat / Alipay adapter Phase 1 impl + **`cc hub` namespace 设计** + Android adapter 模块（feature-hub）|
| **v2.5** | + L2 全部 4 adapter | +1 月 | + 邮件 / + 8-vendor AI chat history 检索 | Email IMAP adapter + AI Chat History adapter 落地 |
| **v3.0** | + L3 文件系统 / 多媒体 | +1-2 月 | "我去年拍的桂林照片" / "找下名字带 'invoice' 的 pdf" | Android MediaStore wrap + DocumentsProvider 接入 + **`cc fs` / `cc media` namespace 设计** + 缩略图渲染 UI |
| **v4.0** | + L4 统一实体视图 | +2-3 月 | "妈妈相关的所有事和东西" / "上个月去了哪些地方" | KG ingestor 实现（packages/personal-data-hub L4） + **`cc entity` namespace** + 跨源去重 / 实体对齐 |
| **v5.0** | + 跨源安全写 + 备份 | +2 月 | "把这批微信发的照片归档到本地相册" / "导出 2025 年所有数据到 IPFS" | 写权限模型 / 备份策略 / IPFS 接入 |

### 12.2 cc namespace 演进表

| Namespace | v1 | v1.1 | v2 | v3 | v4 | v5 |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| `cc note` | R | RW | RW | RW | RW | RW |
| `cc memory` | R | RW | RW | RW | RW | RW |
| `cc skill` | R | RW | RW | RW | RW | RW |
| `cc did` | R | RW | RW | RW | RW | RW |
| `cc session` | R | RW | RW | RW | RW | RW |
| `cc search` | R | R | R | R | R | R |
| `cc status` | R | R | R | R | R | R |
| `cc mcp` | R | RW | RW | RW | RW | RW |
| `cc hub wechat` | — | — | R | R | R | RW |
| `cc hub alipay` | — | — | R | R | R | RW |
| `cc hub email` | — | — | — | R (v2.5) | R | RW |
| `cc hub aichat` | — | — | — | R (v2.5) | R | RW |
| `cc fs` | — | — | — | R | R | RW |
| `cc media` | — | — | — | R | R | RW |
| `cc entity person/event/place/item/topic` | — | — | — | — | R | R |
| `cc backup` | — | — | — | — | — | RW |

R = 只读；RW = 读写（写需二次确认 UI 或 dryRun 预览）。

### 12.3 关键架构对齐点

| 项 | v1 设计选择 | 在 v2+ 复用方式 |
|---|---|---|
| `cc_exec` tool descriptor | 单 generic tool + enum 命令名 | enum 动态扩；description 当用 cc 子树检测到新 namespace 时自动注入 |
| Allowlist | Kotlin `CmdSpec` 数据类 | v2+ 接 nested subcommand (`hub wechat search`)；`flags` list 加 namespace 共享 flag |
| ProcessBuilder + node 直 invoke | $PREFIX/bin/node + js entry | L2 adapter 仍走 cc CLI 子命令，路径不变；L3/L4 同理 |
| ToolResult 4KB plain text | 截断 + duration meta | L2 大数据集（如 50 万条微信消息）必须配合 `cc hub wechat search --limit 20` 默认限制（同 v1 applyDefaults 机制） |
| 5 阶段 UI 状态机 | T1-T6 + ToolCallCard | L2-L4 命令重型（如 `cc hub wechat search` 全量扫秒级），T3 阶段延长不破坏体验；可加 progress 流（cc 子命令支持 `--progress-stream`，由 cc 端实现） |
| API key env 过滤 | 剔除 `*_API_KEY/*_TOKEN` | L2 adapter 可能需访问外部 API（如 IMAP）但 cc 侧应从加密本地 vault 读，不经 env 传；env 过滤策略不动 |

### 12.4 不沿用 / 必须重设计的部分

- **写权限模型**：v1 read-only Allowlist 简单一刀切；v1.1+ 写命令需"用户预授权的命令类别"+ "本次会话授权"两层 + dryRun 预览 + diff UI。这是独立设计 task。
- **大数据集 UI**：L2 微信聊天 / L3 媒体可能返回数千条；ToolResultBlock 不能简单"展开全部"，需要分页 + 搜索内嵌过滤 + 缩略图 grid（媒体专用）。
- **跨源去重**：L4 实体视图需要冲突解决 UI（同一个"妈妈" Person 来自微信、通讯录、邮件）—— v4 时单独 ADR。
- **离线 / 增量同步**：L2 adapter 数据本地化后是否要桌面↔手机增量同步？目前 Personal Data Hub doc 假设单端 LocalVault，跨端复用 v3 P2P sync 还是新通道，v2 决策时再定。

### 12.5 触发 v1 收口后下一步的信号

v1 上线后，下面 4 件事任一发生就启动对应 vN 设计：
1. Personal Data Hub Phase 0 LocalVault impl 跑通桌面 → 启动 v2 `cc hub` namespace 设计 + Android feature-hub 模块。
2. 用户报告"v1 chat 中想加笔记"高频次（埋点 ≥ 30%/周）→ 启动 v1.1 写命令 + 二次确认 UX 设计。
3. 手机内存 / 隐私场景受关注 → 启动 v3 MediaStore + cc fs 设计（产品需求驱动）。
4. 跨源问答（"妈妈相关的"）成为运营关键卖点 → 启动 v4 KG ingestor + cc entity namespace 设计。

**不要预防性铺**：v1 在 §0.4 5 项约束基础上保证 forward-compat，但 v2+ 不在 v1 实施 PR 内做。每个 vN 单独设计 doc + 单独评审。

## 附录：规范章节补全（v5.0.3.108）

> 本文为设计文档。为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文细节。

### 1. 概述

见正文「范围」。Android AI Chat × cc-exec Tool 让 AI Chat 内用自然语言调用本地 `cc` CLI：LLM tool-call → 白名单 gate → 本地 Termux Node 执行 → 输出回 chat。前置 Phase 2.5 cc bundle 真机闭环（`cc -v → 0.162.2`）。

### 2. 核心特性

NL → LLM tool-call → 白名单 gate → 本地执行；forward-compat 5 项约束（§0.4）；v1 只读类命令。

### 3. 系统架构

见正文架构节；AI Chat → tool-call → 白名单 → Termux Node `cc` → 结果回 chat。

### 4. 系统定位

Android AI Chat 的**本地 cc CLI 执行工具**（v1 草案）。

### 5. 核心功能

见正文：tool-call 解析、白名单 gate、Termux Node 执行、输出回填。

### 6. 技术架构

LLM tool-call；命令白名单；本地 Termux Node 运行 cc CLI bundle。

### 7. 系统特点

v1 forward-compat（§0.4 5 约束）；v2+（写命令 / cc hub / MediaStore / KG）单独设计不预防性铺（见正文末）。

### 8. 应用场景

chat 内自然语言跑 cc 命令（查笔记 / 搜索等只读场景）。

### 9. 竞品对比

桌面 cc agent tool-call 平价（移动端落地）。

### 10. 配置参考

见正文 §0.4 约束与白名单配置。

### 11. 性能指标

Termux Node 冷启动 + cc 执行时延；真机基线见 `..._E2E_SOP.md` §8.4。

### 12. 测试覆盖

真机 E2E 9 场景（见 `Android_AI_Chat_CC_Exec_Phase_5_8_E2E_SOP.md`）。

### 13. 安全考虑

白名单 gate 限制可执行命令；v1 只读；写命令 / 二次确认推迟 v1.1。

### 14. 故障排除

见 `..._Checklist.md` 排查表（输入框转圈 / Hilt DI / logcat 无 Cc* 行）。

### 15. 关键文件

Termux Node bundle（见 `Android_Local_Terminal_CI_Bundle.md`）；白名单 gate；tool-call handler。

### 16. 使用示例

见正文 tool-call 示例与 `..._E2E_SOP.md` 9 场景。

### 17. 相关文档

`Android_AI_Chat_CC_Exec_Phase_5_8_E2E_SOP.md`、`Android_AI_Chat_CC_Exec_Phase_5_8_Checklist.md`、`Android_Local_Terminal_CI_Bundle.md`。
