# Personal Data Hub — Phase 14.5 token-by-token streaming for `hub.ask` 详细设计

> **状态**：v0.1 设计稿（2026-05-21）。父稿 [`Personal_Data_Hub_Phase_14_Mobile_Native_Entry.md`](./Personal_Data_Hub_Phase_14_Mobile_Native_Entry.md) §6 已把 14.5 列为 "follow-up token-by-token streaming"；姊妹 [`Personal_Data_Hub_Phase_14_3_Sync_Audit_Streaming.md`](./Personal_Data_Hub_Phase_14_3_Sync_Audit_Streaming.md) 提供 dispatcher 模板祖本；姊妹 [`iOS_Phase_5_AI_Chat_Skill.md`](./iOS_Phase_5_AI_Chat_Skill.md) 提供 stream 累积 + LRU 复合 key 模式祖本。
>
> **触发缘由**：Phase 14.1 step 5 `HubAskScreen.kt` L151 注释明确把 token-by-token streaming 标记为 Phase 14.5。本稿把那一行 TODO 兑现为可落地设计。
>
> **为什么独立成稿**：父 Phase 14 doc 已 700+ 行（含 14.0/14.1/14.2/14.3/14.4 五个 sub-phase）；再嵌 14.5 的 wire schema + 双端 dispatcher + UI 模式 + 隐私 gate 流式适配会让索引爆。本稿独立 + 父稿 §6 引用即可。
>
> **核心价值**：当前 `hub.ask` 是 single-shot — 用户提问后阻塞 3-8s 才看到第一个字。流式后首 token 通常 ≤ 500ms 出现，UX 感知速度 ~10×。同时为后续"长答案"（数千字 trip 报告 / 月度消费分析）打基础。

---

## 1. 目标 & 非目标

### 1.1 目标 (in scope)

- 在桌面 `AnalysisEngine` 既有 `ask()` 同管线上加 `askStream()` 入口，**复用** query-parser / vault facts / RAG / prompt-builder / 隐私 gate / citation 校验 / audit 写入 — 单点变化集中在 LLM 调用层
- 定义 `personal-data-hub.ask.progress` 事件 wire schema（4+1 状态机：starting / token / done / error；可选 phase 子流 retrieving / building-prompt）
- 桌面 IPC + WS 同时暴露 `ask-stream` 通道（对称 Phase 5.7 `sync-adapter-stream` 模式）
- Android `HubAskEventDispatcher.kt` + iOS `HubAskEventDispatcher.swift`（mirror Phase 5 `AIChatEventDispatcher` + Phase 14.3 `HubSyncEventDispatcher`）
- 双端 UI：token 落屏 + blinking cursor 改为真正 token-by-token + cancel 按钮（Phase 14.1 已铺 HubChatBubble + HubBlinkingCursor，本期接通真 token 流）
- 隐私 gate 流式适配：non-local LLM 拒绝同样发生在 stream 的 **starting** 阶段（不等到第一个 token 才报错）
- 落地 ≥ 32 个新单测 + 2 个集成测试 + 5 真账号 / mock 真机 E2E 场景

### 1.2 非目标 (defer)

- 多 active stream 并发：v1 同一会话同时只允许一个 ask-stream（cancel 旧的再起新的）；UI 锁 submit button
- 跨 reconnect 续传：v1 WS 断 → stream 标 error，用户手点重试；v2 才考虑断点续传（投入产出比低）
- 工具调用流式（tool_calls 字段）：本期仅 token text 流式；分析 skill workflow 的 step-by-step（spending → 4 phase）走 Phase 14.6 设计
- 跨 LLM provider 一致性：v1 仅保证 Ollama / vLLM (本地) 真流式；Anthropic / DeepSeek 等非本地 provider 也支持但 acceptNonLocal=true 才放行，且使用 provider 自身 SSE 上行格式适配
- 桌面端 SPA UI 流式：桌面 `PersonalDataHub.vue` 已 single-shot，本期**不动桌面 UI**（用户面广，UX 优化排到 v5.0.3.78+）；本期 only 双移动端 + 桌面后端 RPC

---

## 2. Wire schema — `personal-data-hub.ask.progress`

### 2.1 状态机

```
[client invoke ask-stream]
        ↓
   ┌─ starting          ── (init: query-parser → vault facts → RAG → prompt-build → 隐私 gate 决策)
   │      ↓
   ├─ token             ── (N 次, LLM 每 emit 一段 delta text 转发一次)
   │      ↓
   └─ done              ── (单次, 最终 AskResult 含 citations + isLocal + llmName + 完整 answer 兜底)
        OR
        error           ── (任何阶段失败终止)
```

**约束**：
- `done` 与 `error` 互斥，且永远是 stream 终态
- `token` 可重复且**不**保证顺序到达手机（WS 多包乱序极少但可能）— dispatcher 端需 `chunkIdx` 排序
- 单 ask 一定从 `starting` 开始（即使本地秒回 also 必发一次 starting）
- 隐私 gate 拒绝在 `starting` 之后立刻 emit `error`（不再发 token） — UI 看 `error.code === "NON_LOCAL_LLM_BLOCKED"` 才弹 AcceptNonLocalDialog

### 2.2 Event payload

```jsonc
// WS 推流（cc ui / web-shell / mobile-bridge 同模式）
{
  "type": "personal-data-hub.ask.progress",
  "askId": "ask-2026-05-21T10-23-15-XXX",  // 单次 ask invoke 标识，UI dispatcher dedupe + filter 用
  "kind": "starting" | "token" | "done" | "error",
  "ts": 1737537795000,                       // server ms
  "detail": {                                // kind-specific (见 §2.3)
    /* ... */
  }
}
```

### 2.3 per-kind detail

| kind | detail 必有 | detail 可选 | UI 展示建议 |
|---|---|---|---|
| `starting` | `factsCount` (vault 取到的相关事件数) | `ragDocsCount` / `llmName` / `isLocal` | "已找到 12 条相关事件，正在推理…" + spinner |
| `token` | `chunkIdx: number` (0-based 单调) + `text: string` (delta) | `tokensUsed?` (provider 报的累计 token) | 累加进 ChatBubble assistant slot，BlinkingCursor 持续闪烁 |
| `done` | `result: AskResult` （含 answer / citations / llmName / isLocal） | `tokensUsed` 终值 | BlinkingCursor 消失，citation chip 渲染 |
| `error` | `error: { code, message }` | `phase: "starting"\|"token"` (失败位置) | 红 banner + 错误码特化处理（NON_LOCAL_LLM_BLOCKED → AcceptNonLocalDialog） |

**AskResult** shape 不变（与既有 single-shot `hub.ask` 同型）：

```ts
type AskResult = {
  answer: string;       // 完整 answer (concat 所有 token text，作为 single-shot fallback / dispatcher dedupe 校验)
  citations: Array<{ eventId: string; reason?: string }>;
  llmName: string;
  isLocal: boolean;
};
```

### 2.4 schema invariants

- `askId` 必填且全局唯一（桌面 `crypto.randomUUID()` 或 `${ts}-${rand5}`）— 复用 [[ios-remote-ai-chat-phase5]] memory 的复合 LRU key 模式
- `chunkIdx` 严格单调递增（0, 1, 2, …）；dispatcher 收到 N+2 但缺 N+1 时**缓冲**，等 N+1 到达后 flush（Phase 5 已踩过乱序坑）
- `ts` 单调（但**不**严格递增 —— `token` × N 可同 ms）
- 跨 ask stream `ts` 比较无意义（每 ask 独立）

### 2.5 错误码

| code | 触发条件 | UI 响应 |
|---|---|---|
| `NON_LOCAL_LLM_BLOCKED` | 隐私 gate 拒；当 LLM 非本地 + acceptNonLocal=false | 显 AcceptNonLocalDialog；用户接受后用 acceptNonLocal=true 重发 |
| `LLM_UNAVAILABLE` | LLMManager 未初始化 / Ollama 未启动 | "请检查 AI 模型配置 → Ollama 是否启动" |
| `LLM_STREAM_FAILED` | provider stream 中途断连（network / provider 异常） | "推理中断 — 请重试" + 保留已收 token 作部分答案 |
| `LLM_CANCELLED` | 用户主动 cancel | UI 静默关闭 stream，answer 保留部分 |
| `VAULT_UNAVAILABLE` | vault open 失败 | "数据库不可用" + 引导走 health 检查 |
| `INVALID_QUESTION` | question 为空 / 过长 (>1000 字) | "问题过长，请精简" |

---

## 3. 桌面端 — AnalysisEngine.askStream

### 3.1 既有 ask() 复用边界

`packages/personal-data-hub/lib/analysis.js` 既有：

```js
async ask(question, options = {}) {
  // 1. query-parser
  const intent = parseQuery(question);
  // 2. vault facts
  const facts = await vault.queryEvents({ ...intent.timeWindow, limit: intent.topK || 50 });
  // 3. RAG (optional)
  const ragDocs = options.useRag !== false ? await ragSink.search(question, intent.topK || 10) : [];
  // 4. prompt-builder
  const messages = buildPrompt({ question, facts, ragDocs });
  // 5. 隐私 gate
  if (!llm.isLocal && !options.acceptNonLocal) {
    throw new Error("Non-local LLM blocked — pass options.acceptNonLocal=true to override");
  }
  // 6. LLM 调用
  const reply = await llm.chat(messages);
  // 7. citation 解析 + 校验
  const citations = parseCitations(reply).filter(c => factsMap.has(c.eventId));
  // 8. audit
  await vault.appendAudit({ action: "ask", actor: "user", ... });
  return { answer: reply, citations, llmName: llm.name, isLocal: llm.isLocal };
}
```

### 3.2 新增 askStream() 入口

```js
/**
 * Phase 14.5 — async-generator 接口，yield 状态机事件。
 * - 1..6 阶段同 single-shot ask（复用同源码 helper）
 * - 第 6 阶段改调 llm.chatStream() (per provider SSE) 流式收 token
 * - 第 7/8 阶段在 done 事件 detail 兜底完整 answer 时同步跑
 *
 * @param {string} question
 * @param {object} options { acceptNonLocal?, useRag?, signal? (AbortSignal) }
 * @returns {AsyncGenerator<AskStreamEvent>}
 */
async *askStream(question, options = {}) {
  const askId = "ask-" + crypto.randomUUID();
  const startTs = Date.now();
  try {
    if (!question || question.trim().length === 0) {
      yield { askId, kind: "error", ts: Date.now(), detail: { error: { code: "INVALID_QUESTION", message: "空问题" } } };
      return;
    }
    if (question.length > 1000) {
      yield { askId, kind: "error", ts: Date.now(), detail: { error: { code: "INVALID_QUESTION", message: "问题超 1000 字" } } };
      return;
    }

    // 1-4: 同 single-shot
    const intent = parseQuery(question);
    const facts = await vault.queryEvents({ ...intent.timeWindow, limit: intent.topK || 50 });
    const ragDocs = options.useRag !== false ? await ragSink.search(question, intent.topK || 10) : [];
    const messages = buildPrompt({ question, facts, ragDocs });

    // 5: 隐私 gate（先 emit starting，再 gate；让 UI 收到 starting 后才决定弹 dialog）
    yield {
      askId, kind: "starting", ts: Date.now(),
      detail: { factsCount: facts.length, ragDocsCount: ragDocs.length,
                llmName: llm.name, isLocal: llm.isLocal },
    };
    if (!llm.isLocal && !options.acceptNonLocal) {
      yield {
        askId, kind: "error", ts: Date.now(),
        detail: { phase: "starting", error: { code: "NON_LOCAL_LLM_BLOCKED",
                                              message: "Non-local LLM blocked — pass options.acceptNonLocal=true to override" } },
      };
      return;
    }

    // 6: LLM 流式调用
    let chunkIdx = 0;
    let acc = "";
    let tokensUsed = 0;
    try {
      for await (const delta of llm.chatStream(messages, { signal: options.signal })) {
        acc += delta.text || "";
        tokensUsed = delta.tokensUsed || tokensUsed;
        yield {
          askId, kind: "token", ts: Date.now(),
          detail: { chunkIdx: chunkIdx++, text: delta.text || "", tokensUsed },
        };
      }
    } catch (err) {
      const code = err.name === "AbortError" ? "LLM_CANCELLED" : "LLM_STREAM_FAILED";
      yield {
        askId, kind: "error", ts: Date.now(),
        detail: { phase: "token", error: { code, message: err.message || "" }, partialAnswer: acc },
      };
      return;
    }

    // 7-8: citation 解析 + audit（与 single-shot 共享 helper）
    const factsMap = new Map(facts.map(f => [f.id, f]));
    const citations = parseCitations(acc).filter(c => factsMap.has(c.eventId));
    await vault.appendAudit({
      action: "ask", actor: "user",
      context: { askId, question, llmName: llm.name, isLocal: llm.isLocal,
                 factsCount: facts.length, tokensUsed, durationMs: Date.now() - startTs },
    });

    yield {
      askId, kind: "done", ts: Date.now(),
      detail: { result: { answer: acc, citations, llmName: llm.name, isLocal: llm.isLocal },
                tokensUsed },
    };
  } catch (err) {
    yield {
      askId, kind: "error", ts: Date.now(),
      detail: { error: { code: err.code || "UNKNOWN", message: err.message || String(err) } },
    };
  }
}
```

### 3.3 LLM client 适配

各 LLM provider 客户端需新增 `chatStream(messages, opts): AsyncIterable<{text, tokensUsed?}>`。

| Provider | 状态 | 适配 |
|---|---|---|
| `OllamaClient` (`lib/llm-client.js`) | 🚧 待实现 | Ollama `/api/chat` 支持 `stream: true`，按 line 解析 JSON delta + `done: true` 终止 |
| `CcLLMAdapter` (`bridges/cc-llm-adapter.js`) | 🚧 待实现 | 复用既有 `desktop-app-vue/src/main/llm/` 的 stream API（各 provider 已支持，仅需暴露） |
| `MockLLMClient` (test only) | 🚧 待实现 | 把 deterministic answer 按 5-char 切片 yield，便于单测覆盖乱序 / cancel / done |

#### Ollama stream 范本

```js
async *chatStream(messages, { signal } = {}) {
  const resp = await fetch(`${this.baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: this.model, messages, stream: true }),
    signal,
  });
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const json = JSON.parse(line);
      if (json.message?.content) yield { text: json.message.content };
      if (json.done) return;
    }
  }
}
```

---

## 4. 桌面端 — IPC + WS wiring

### 4.1 IPC channel — `personal-data-hub:ask-stream`

`desktop-app-vue/src/main/ipc/personal-data-hub-ipc.js` 新增：

```js
ipcMain.handle(`${NS}:ask-stream`, async (evt, { question, options, progressChannel }) => {
  const hub = await hubWiring.getHub();
  if (!hub.engine) return { error: "Analysis engine unavailable — LLM manager not initialized" };

  const controller = new AbortController();
  // Caller can cancel by ipcMain.send(`${progressChannel}:cancel`, {})
  const cancelChannel = `${progressChannel}:cancel`;
  const onCancel = () => controller.abort();
  ipcMain.once(cancelChannel, onCancel);

  try {
    for await (const e of hub.engine.askStream(question, { ...options, signal: controller.signal })) {
      evt.sender.send(progressChannel, e);
    }
  } finally {
    ipcMain.removeListener(cancelChannel, onCancel);
  }
  return { ok: true };
});
```

### 4.2 WS topic — `personal-data-hub.ask-stream`

`packages/cli/src/gateways/ws/personal-data-hub-protocol.js` 新增：

```js
"personal-data-hub.ask-stream": async (msg, sender) => {
  const controller = new AbortController();
  // Sub-protocol: client send `personal-data-hub.ask-stream.cancel { askId }` to abort
  sender.onMessage?.((m) => {
    if (m.type === "personal-data-hub.ask-stream.cancel") controller.abort();
  });
  for await (const e of hub.engine.askStream(msg.question, { ...msg.options, signal: controller.signal })) {
    sender.send({ type: "personal-data-hub.ask.progress", ...e });
  }
  return { ok: true };
},
```

### 4.3 mobile-bridge fan-out

`desktop-app-vue/src/main/personal-data-hub/route-mobile.js` 已 fan-out `personal-data-hub.sync.progress`；本期复用同 sender pattern fan-out `personal-data-hub.ask.progress` 到 mobile peer。**仅一行注册**，无新代码路径。

---

## 5. Android — Phase 14.5.1 数据层 + 14.5.2 dispatcher

### 5.1 `PersonalDataHubCommands.askStream`

`android-app/app/src/main/java/com/chainlesschain/android/remote/commands/PersonalDataHubCommands.kt`：

```kotlin
suspend fun askStream(
    question: String,
    acceptNonLocal: Boolean? = null,
    useRag: Boolean? = null,
): Result<String> = runCatching {
    val askId = "ask-${System.currentTimeMillis()}-${Random.nextInt(10000)}"
    client.invoke(
        method = "personal-data-hub.ask-stream",
        payload = mapOf(
            "question" to question,
            "askId" to askId,
            "options" to mapOf(
                "acceptNonLocal" to acceptNonLocal,
                "useRag" to useRag,
            ),
        ),
    )
    askId   // 返回 askId 供 ViewModel 订阅 dispatcher
}

suspend fun cancelAskStream(askId: String): Result<Unit> = runCatching {
    client.invoke(
        method = "personal-data-hub.ask-stream.cancel",
        payload = mapOf("askId" to askId),
    )
    Unit
}
```

### 5.2 `HubAskEventDispatcher.kt`

```kotlin
// android-app/app/src/main/java/com/chainlesschain/android/remote/dispatcher/HubAskEventDispatcher.kt
@Singleton
class HubAskEventDispatcher @Inject constructor(
    private val client: RemoteCommandClient,
    private val scope: CoroutineScope,
) {
    private val _activeAsks = MutableStateFlow<Map<String, HubAskState>>(emptyMap())
    val activeAsks: StateFlow<Map<String, HubAskState>> = _activeAsks.asStateFlow()

    private val askIdLru = LinkedHashSet<String>()
    // Per-askId 乱序缓冲（Phase 5 trap：chunkIdx N+2 到达但缺 N+1）
    private val pendingChunks = mutableMapOf<String, SortedMap<Int, String>>()

    init {
        scope.launch {
            client.events
                .filter { it.type == "personal-data-hub.ask.progress" }
                .collect { handleEvent(it) }
        }
    }

    private fun handleEvent(envelope: ServerEnvelope) {
        val payload = envelope.payload as? Map<*, *> ?: return
        val askId = payload["askId"] as? String ?: return
        val kind = payload["kind"] as? String ?: return

        val state = _activeAsks.value[askId] ?: HubAskState(askId)
        val updated = when (kind) {
            "starting" -> state.copy(
                stage = AskStage.STARTING,
                factsCount = ((payload["detail"] as? Map<*, *>)?.get("factsCount") as? Number)?.toInt() ?: 0,
                llmName = (payload["detail"] as? Map<*, *>)?.get("llmName") as? String,
                isLocal = ((payload["detail"] as? Map<*, *>)?.get("isLocal") as? Boolean) ?: true,
            )
            "token" -> applyToken(state, payload)
            "done" -> state.copy(
                stage = AskStage.DONE,
                result = parseAskResult(payload["detail"]),
            )
            "error" -> state.copy(
                stage = AskStage.ERROR,
                error = parseError(payload["detail"]),
            )
            else -> state
        }
        _activeAsks.value = _activeAsks.value + (askId to updated)

        askIdLru.remove(askId); askIdLru.add(askId)
        if (askIdLru.size > 32) {
            val oldest = askIdLru.first()
            askIdLru.remove(oldest)
            _activeAsks.value = _activeAsks.value - oldest
            pendingChunks.remove(oldest)
        }
    }

    private fun applyToken(state: HubAskState, payload: Map<*, *>): HubAskState {
        val detail = payload["detail"] as? Map<*, *> ?: return state
        val idx = (detail["chunkIdx"] as? Number)?.toInt() ?: return state
        val text = detail["text"] as? String ?: return state

        val buf = pendingChunks.getOrPut(state.askId) { sortedMapOf() }
        buf[idx] = text

        // Flush 连续从 nextExpectedChunkIdx 开始的所有
        var nextIdx = state.nextExpectedChunkIdx
        val toAppend = StringBuilder(state.accumulatedAnswer)
        while (buf.containsKey(nextIdx)) {
            toAppend.append(buf.remove(nextIdx))
            nextIdx++
        }
        return state.copy(
            stage = AskStage.TOKEN,
            accumulatedAnswer = toAppend.toString(),
            nextExpectedChunkIdx = nextIdx,
            tokensUsed = (detail["tokensUsed"] as? Number)?.toInt() ?: state.tokensUsed,
        )
    }
}

data class HubAskState(
    val askId: String,
    val stage: AskStage = AskStage.STARTING,
    val factsCount: Int = 0,
    val llmName: String? = null,
    val isLocal: Boolean = true,
    val accumulatedAnswer: String = "",
    val nextExpectedChunkIdx: Int = 0,
    val tokensUsed: Int = 0,
    val result: AskResult? = null,
    val error: HubAskError? = null,
)

enum class AskStage { STARTING, TOKEN, DONE, ERROR }
data class HubAskError(val code: String, val message: String, val phase: String? = null, val partialAnswer: String? = null)
```

### 5.3 `HubAskViewModel` 改造

Phase 14.1 既有 `submit()` 改 `submitStream()`（保留 single-shot 作 fallback 当 ask-stream 不可用时）：

```kotlin
fun submit() {
    val q = _uiState.value.question.trim()
    if (q.isEmpty()) return
    if (_uiState.value.isLoading) return

    viewModelScope.launch {
        _uiState.update {
            it.copy(isLoading = true, errorMessage = null, answer = null,
                    citations = emptyList(), submittedQuestion = q)
        }
        val acceptNonLocal = _uiState.value.acceptNonLocalConfirmed
        val askIdResult = hub.askStream(q, acceptNonLocal = if (acceptNonLocal) true else null)

        askIdResult.onSuccess { askId ->
            _uiState.update { it.copy(activeAskId = askId) }
            // Subscribe dispatcher
            dispatcher.activeAsks
                .map { it[askId] }
                .filterNotNull()
                .takeWhile { it.stage !in listOf(AskStage.DONE, AskStage.ERROR) || true }
                // ↑ Note: takeWhile inclusive for DONE/ERROR — keep last emission
                .collect { state ->
                    when (state.stage) {
                        AskStage.STARTING -> _uiState.update { it.copy(llmName = state.llmName, isLocal = state.isLocal) }
                        AskStage.TOKEN -> _uiState.update { it.copy(answer = state.accumulatedAnswer) }
                        AskStage.DONE -> {
                            val r = state.result!!
                            _uiState.update {
                                it.copy(answer = r.answer, citations = r.citations,
                                        llmName = r.llmName, isLocal = r.isLocal,
                                        isLoading = false, activeAskId = null)
                            }
                            return@collect
                        }
                        AskStage.ERROR -> {
                            handleStreamError(q, state.error!!)
                            return@collect
                        }
                    }
                }
        }.onFailure { err -> handleAskFailure(q, err) }
    }
}

fun cancelCurrentAsk() {
    val askId = _uiState.value.activeAskId ?: return
    viewModelScope.launch {
        hub.cancelAskStream(askId)
        _uiState.update { it.copy(isLoading = false, activeAskId = null) }
    }
}
```

### 5.4 UI 改动

`HubAskScreen.kt` Phase 14.1 step 5 既有 ChatBubble + BlinkingCursor 已**几乎不动**：

- BlinkingCursor 改为 token 累加时仍闪烁，token=done 时消失 — 一行条件改成 `state.activeAskId != null`
- 加 "取消" 按钮 — 当 `state.activeAskId != null` 时显示，点击调 `viewModel.cancelCurrentAsk()`
- LinearProgressIndicator 替换为 token 流式累加进 ChatBubble 的 Text 组件

零新 Composable，仅条件分支调整。

---

## 6. iOS — Phase 14.5.3 + 14.5.4

### 6.1 `PersonalDataHubCommands.askStream`

```swift
// Modules/CoreP2P/Sources/RemoteSkills/PersonalDataHub/PersonalDataHubCommands.swift

extension PersonalDataHubCommands {
    public func askStream(
        question: String,
        acceptNonLocal: Bool? = nil,
        useRag: Bool? = nil
    ) async throws -> String {
        let askId = "ask-\(Int(Date().timeIntervalSince1970 * 1000))-\(Int.random(in: 0..<10000))"
        var options: [String: Any] = [:]
        if let v = acceptNonLocal { options["acceptNonLocal"] = v }
        if let v = useRag { options["useRag"] = v }
        let payload: [String: Any] = [
            "question": question,
            "askId": askId,
            "options": options,
        ]
        _ = try await client.invoke(method: "personal-data-hub.ask-stream", payload: payload)
        return askId
    }

    public func cancelAskStream(askId: String) async throws {
        _ = try await client.invoke(
            method: "personal-data-hub.ask-stream.cancel",
            payload: ["askId": askId]
        )
    }
}
```

### 6.2 `HubAskEventDispatcher.swift`

```swift
// Modules/CoreP2P/Sources/RemoteSkills/PersonalDataHub/HubAskEventDispatcher.swift
@MainActor
public final class HubAskEventDispatcher: ObservableObject {
    @Published public private(set) var activeAsks: [String: HubAskState] = [:]
    @Published public private(set) var completedAsks: [String: AskResult] = [:]
    @Published public private(set) var askErrors: [String: HubAskError] = [:]

    private var pendingChunks: [String: [Int: String]] = [:]
    private var askIdLru: LRUSet<String> = .init(capacity: 32)
    private var subscription: Task<Void, Never>?

    public init(eventsStream: AsyncStream<ServerEnvelope>) {
        subscription = Task { [weak self] in
            for await env in eventsStream {
                guard env.type == "personal-data-hub.ask.progress" else { continue }
                await self?.handle(env)
            }
        }
    }

    deinit { subscription?.cancel() }

    private func handle(_ env: ServerEnvelope) async {
        // Parse askId / kind / detail; per-kind state transition same as Android.
        // Token kind: insert into pendingChunks[askId][chunkIdx], flush contiguous from nextExpected.
        // ... (mirror Android §5.2)
    }
}

public struct HubAskState {
    public let askId: String
    public var stage: AskStage = .starting
    public var factsCount: Int = 0
    public var llmName: String?
    public var isLocal: Bool = true
    public var accumulatedAnswer: String = ""
    public var nextExpectedChunkIdx: Int = 0
    public var tokensUsed: Int = 0
}

public enum AskStage: String { case starting, token, done, error }

public struct HubAskError {
    public let code: String
    public let message: String
    public let phase: String?
    public let partialAnswer: String?
}
```

### 6.3 fan-out 第 5 子流

iOS `RemoteDependencies` 既有 fan-out 4 子流（terminal / notification / aichat / hubSync）；本期加第 5 子流 `hubAskEventsStream` buffer 256 — 与 Phase 5 `aichat` 同等量级（token 涌速 50-100ms 一发）。

```swift
// Modules/CoreP2P/Sources/RemoteDependencies.swift (existing fan-out task)
// Add 5th sub-stream:
let hubAskContinuation: AsyncStream<ServerEnvelope>.Continuation
let hubAskEventsStream: AsyncStream<ServerEnvelope>
(hubAskEventsStream, hubAskContinuation) = AsyncStream<ServerEnvelope>.makeStream(
    bufferingPolicy: .bufferingNewest(256)
)

Task {
    for await env in commandClient.events {
        // ... existing 4 fan-outs
        hubAskContinuation.yield(env)
    }
}
```

### 6.4 `HubAskViewModel` Swift 端 + UI

镜像 Android 5.3 / 5.4 — 既有 SwiftUI `HubAskView` 既有 ChatBubble 已存在，仅 ViewModel 内 stream → `accumulatedAnswer` 落 `@Published` 即可。

---

## 7. 关键 trap & 防御

### 7.1 Token 乱序（Phase 5 教训）

WS over WebRTC DataChannel 极偶尔会乱序到达。`HubAskEventDispatcher.applyToken` 必须用 sortedMap 排序缓冲，等连续 chunkIdx 到达后才 flush 到 accumulatedAnswer。**否则 UI 会闪烁回退** — 收到 idx=5 后渲染，再收到 idx=4 → answer 倒退。

### 7.2 Cancel race（Phase 5 教训）

用户连发 cancel + 第二次 ask；要求 dispatcher 写入顺序保证：先 `cancelAskStream()` RPC 等返回，**再** 清 activeAsks 中旧 askId 状态。否则旧 token 还在路上时新 ask 已开始 → answer 拼接错乱。

### 7.3 隐私 gate 流式时机

`error` 必须发生在 `starting` 之后，**不**等 LLM 真调用前。Engine 内部 ordering: `yield starting` → `if (!isLocal && !accept) yield error; return;`。**反向**会导致 UI 看到 NON_LOCAL_LLM_BLOCKED 但已经看到了 starting 的 llmName/isLocal 卡片闪一下 — 视觉怪。

### 7.4 LRU 复合 key（Phase 5 教训）

Long-running session 跨多 ask（用户连提 5+ 个问题）→ activeAsks Map 无限膨胀。LRU 上限 32 askId（与 Phase 5 一致）。**注意**：清出 LRU 时也要清 pendingChunks 中同 askId 的 buffer，否则内存泄漏。

### 7.5 Ollama stream JSON 边界

Ollama `/api/chat?stream=true` 返回 NDJSON（newline-delimited），单 JSON 可能横跨多次 `reader.read()`。**必须** maintain buffer 累积，按 `\n` 切分 — 不要直接 `JSON.parse(chunk)`。

### 7.6 fallback to single-shot

若桌面侧返回 `error: "stream not supported"`（旧版本桌面 cli ui 未升级到 14.5），ViewModel 自动 fall through 调既有 single-shot `ask()` — 用户无感知。

### 7.7 audit 写入时机

`audit_log` 写入必须在 `done` 阶段同步完成 — **不**在 token 阶段每个 chunk 写。否则 1k tokens = 1k audit rows 爆。**但** cancel / error 也得写一条带 partial 的 audit（"已取消，已生成 N 字符"）。

### 7.8 acceptNonLocal 重试 askId

acceptNonLocal=true 重试时**必须**生成新 askId — 沿用旧 askId 会让 dispatcher 把新 starting 当作旧 stream 的状态机回退（unexpected transition STARTING ← ERROR）。Phase 14.1 既有 `acceptNonLocalAndRetry` 在 ViewModel 层 reset activeAskId 即可。

### 7.9 桌面 IPC `cancel` channel naming

`progressChannel:cancel` 必须**字符串拼接**而非保留字。`evt.sender.send(...)` 时若 frontend 用 IPC 监听 `progressChannel` 接 progress，**同名**监听 `progressChannel:cancel` 不会冲突 — 不同字符串。但写测试时要 mock 两个 channel。

### 7.10 token tokensUsed 反向

各 provider 报 tokensUsed 字段名不同：Ollama `prompt_eval_count + eval_count`、Anthropic `usage.output_tokens`、Volcengine `usage.completion_tokens`。`CcLLMAdapter` 适配层需统一兜底 → `delta.tokensUsed`。UI 不强依赖此字段（可能始终 0），仅用于 done 阶段统计展示。

---

## 8. Sub-phase 拆分 & 工期估

| Sub-phase | 内容 | 工时 |
|---|---|---|
| **14.5.0** | 设计稿落地（本稿） + OQ 决策 | 0.5d ✅ |
| **14.5.1** | 桌面 `AnalysisEngine.askStream` + `OllamaClient.chatStream` + `MockLLMClient.chatStream` + 12 单测 | 1.5d |
| **14.5.2** | 桌面 IPC `:ask-stream` + WS `.ask-stream` + mobile-bridge fan-out + 8 单测 | 0.5d |
| **14.5.3** | Android `PersonalDataHubCommands.askStream` + `HubAskEventDispatcher.kt` + 12 单测 | 1d |
| **14.5.4** | Android `HubAskViewModel.submit()` 改 stream + UI cancel 按钮 + 6 单测 | 0.5d |
| **14.5.5** | iOS `PersonalDataHubCommands.askStream` + `HubAskEventDispatcher.swift` + fan-out 第 5 子流 + 12 单测 | 1d |
| **14.5.6** | iOS `HubAskViewModel` Swift 端 stream 接入 + 6 单测 | 0.5d |
| **14.5.7** | 集成测试 — 2 个 end-to-end 场景（真 Ollama + Mock LLM）+ docs 更新 | 0.5d |
| **14.5.8** | 真机 E2E spot-check — Xiaomi + iPhone + 真桌面（5 场景：本地 LLM 直通 / 非本地 dialog / cancel mid-stream / token 乱序 / done 后 citation） | 0.5d (blocked on hardware) |
| **合计** | — | **5.5d**（不含 14.5.8 真机） |

---

## 9. 测试覆盖目标

### 9.1 单测

| 模块 | 目标 | 备注 |
|---|---|---|
| `analysis.test.js` (`askStream`) | +14 | 含 query-parser pass-through / 隐私 gate 流式 / facts 0 边界 / cancel 中途 / LLM error 中途 / chunk concat / citation 校验在 done / audit 写入只在 done|
| `llm-client.test.js` (`OllamaClient.chatStream`) | +6 | NDJSON 多包跨边界 / done=true 终止 / signal cancel / non-200 回退 / 无 message.content 跳过 / 空 stream |
| `llm-client.test.js` (`MockLLMClient.chatStream`) | +4 | 5-char 切片 / cancel / deterministic seed / 空 question |
| `personal-data-hub-ipc.test.js` (`ask-stream`) | +4 | controller wired / cancel channel listened / removeListener cleanup / progressChannel send 顺序 |
| `personal-data-hub-protocol.test.js` (WS `ask-stream`) | +4 | sender.onMessage cancel sub-protocol / event progress format / done emit / error emit |
| `HubAskEventDispatcher.kt`（Android JVM） | +12 | starting / token concat / token 乱序排序 / done / error / cancel cleanup / LRU 32 / pendingChunks 同步清 / 多 askId 并发 / acceptNonLocal 重试新 askId / phase=token error 含 partial / NON_LOCAL_LLM_BLOCKED 路由 |
| `HubAskViewModelTest.kt`（Android） | +6 | submit → stream → done / cancel 按钮路径 / acceptNonLocal 重试 / token 累加 UI / 隐私 gate dialog 触发顺序 / activeAskId null 时 cancel no-op |
| `HubAskEventDispatcherTests.swift`（iOS） | +12 | 镜像 Android 12 测试 |
| `HubAskViewModelTests.swift`（iOS） | +6 | 镜像 Android 6 测试 |
| **合计单测** | **+68** | 双端 dispatcher 各 12 + ViewModel 各 6 + 桌面 38 |

### 9.2 集成测试

| 场景 | 验收 |
|---|---|
| **A — 本地 LLM 流式 happy path** | Mock LLM 5-char 切片 yield 50 段 → ChatBubble accumulatedAnswer 50 字 / done 携 citations / audit 1 行 |
| **B — Cancel mid-stream** | Mock LLM 1s 间隔 token；50 段中第 10 段 cancel → state.error.code=LLM_CANCELLED + partialAnswer 长度 50 字符（10 段）/ audit 1 行 partial=true |

### 9.3 真机 E2E（Phase 14.5.8 — blocked on hardware）

5 场景（详见 §8 拆分 14.5.8）。Mac + iPhone + Xiaomi 24115RA8EC + 真桌面 + 真 Ollama qwen2.5:7b。

---

## 10. 开放问题 (OQ)

| # | 问题 | 推荐 | 备选 | 决策 |
|---|---|---|---|---|
| **OQ-1** | LRU 上限 32 askId 跨 session 持久化吗？ | **不持久化**（与 Phase 5 一致 — 进程重启即清） | 用 DataStore 持久化（多余、内存够） | 推荐 A |
| **OQ-2** | Cancel 时 partial answer 是否落 vault? | **不落**（半成品不入审计图谱）| 落 + 标 partial=true 字段 | 推荐 A |
| **OQ-3** | tokensUsed 在所有 provider 都准吗？需统一断言吗？ | **不强一致**（best-effort, UI 仅展示，不依赖逻辑）| 强一致：CcLLMAdapter 适配层统一计算 | 推荐 A |
| **OQ-4** | Stream 期间用户再次点 submit 按钮怎么处理？ | **disable submit 按钮**（既有 `isLoading=true` 已 disable，本期沿用）| 弹 confirm "中断当前 ask 起新的？" | 推荐 A |
| **OQ-5** | 桌面 SPA UI 也升级为流式？ | **defer 到 v5.0.3.78+**（桌面 single-shot 已可用，UX 优化优先级低；本期仅双端移动）| 同期升级（开发量 +1.5d，本期不接） | 推荐 A — defer |

---

## 11. 关联与索引

- 父稿：[`Personal_Data_Hub_Phase_14_Mobile_Native_Entry.md`](./Personal_Data_Hub_Phase_14_Mobile_Native_Entry.md)
- 姊妹：[`Personal_Data_Hub_Phase_14_3_Sync_Audit_Streaming.md`](./Personal_Data_Hub_Phase_14_3_Sync_Audit_Streaming.md) — dispatcher 模板祖本
- 姊妹：[`iOS_Phase_5_AI_Chat_Skill.md`](./iOS_Phase_5_AI_Chat_Skill.md) — stream 累积 + LRU 复合 key 模式祖本
- 实施基线：`HubAskScreen.kt` L151 注释（"Phase 14.5"）+ Phase 14.1 step 5 ChatBubble + BlinkingCursor 已就位

> **下一步**：14.5.1 桌面 `askStream` 实现起步（mock + Ollama），决策 OQ-1~5 后落地。
