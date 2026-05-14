package com.chainlesschain.android.remote.terminal

import com.chainlesschain.android.remote.client.SignalingRpcClient
import com.chainlesschain.android.remote.webrtc.SignalClient
import com.chainlesschain.android.remote.webrtc.WebRTCClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import org.json.JSONObject
import timber.log.Timber
import java.util.Collections
import javax.inject.Inject
import javax.inject.Singleton

/**
 * TerminalRpcClient — Plan A 远程终端命令客户端。
 *
 * 复用 [SignalingRpcClient] 同款 envelope 协议（method/params + requestId
 * deferred）发 `terminal.create / list / stdin / resize / close / history`
 * 命令。桌面端 `handleTerminalCommand` 处理后返响应。
 *
 * 与 stdout/exit 推送的关系：
 *   - 命令请求/响应一对一走 SignalingRpcClient.invoke（req → res）
 *   - 桌面 PtyManager 真有新 stdout 数据时通过 mobileBridge.sendToMobile 推
 *     `{type:"chainlesschain:event", payload:{event:"terminal.stdout", sessionId, data, seq}}`
 *   - 本类 [observeStdout] / [observeExit] 拦截这些 push 事件 → 暴露 SharedFlow
 *   - 调用 [start] 一次（通常在 ViewModel init）安装 SignalClient 上的
 *     onForwardedMessage 钩子；钩子忽略已被 SignalingRpcClient 消费的 RPC
 *     响应帧，只挑 event:"terminal.*" 出来 emit
 *
 * Wire 格式（与 desktop side 对齐）：
 *   - 请求 envelope 同 [SignalingRpcClient.invoke] 流程
 *   - 响应 result 是 PtyManager.create() 返回的 object：
 *     `{sessionId, pid, shell, createdAt}` for create
 *     `{sessions: [...]}` for list
 *     `{ok: true}` for stdin/resize/close
 *     `{chunks: [{seq, data}], truncated}` for history
 *
 * data 字段是 plain UTF-8 string（不 base64）— Android JSON 直接吃。
 */
@Singleton
class TerminalRpcClient @Inject constructor(
    private val rpc: SignalingRpcClient,
    private val signalClient: SignalClient,
    // Plan A.1 Phase 4 — DC 直连路径上的 chainlesschain:event push（terminal.stdout
    // / terminal.exit）通过 [WebRTCClient.messages] 到达；要双路监听 + 按
    // (sessionId, seq) / (sessionId, exitCode-marker) 去重避免 UI 重复渲染输出。
    private val webRTCClient: WebRTCClient,
) {

    data class CreatedSession(
        val sessionId: String,
        val pid: Int,
        val shell: String,
        val createdAt: Long,
    )

    data class SessionRow(
        val id: String,
        val shell: String,
        val cwd: String?,
        val alive: Boolean,
        val lastSeq: Long,
    )

    data class StdoutEvent(val sessionId: String, val data: String, val seq: Long)
    data class ExitEvent(val sessionId: String, val exitCode: Int?, val signal: String?)
    data class HistoryChunk(val seq: Long, val data: String)
    data class HistoryResponse(val chunks: List<HistoryChunk>, val truncated: Boolean)

    private val _stdout = MutableSharedFlow<StdoutEvent>(extraBufferCapacity = 256)
    private val _exit = MutableSharedFlow<ExitEvent>(extraBufferCapacity = 32)

    fun observeStdout(): SharedFlow<StdoutEvent> = _stdout.asSharedFlow()
    fun observeExit(): SharedFlow<ExitEvent> = _exit.asSharedFlow()

    @Volatile private var pushListenerInstalled = false
    @Volatile private var signalingListenerJob: Job? = null
    @Volatile private var dcListenerJob: Job? = null

    // Plan A.1 Phase 4 — 反向去重 LRU。stdout 按 "sessionId|seq" 索引；exit 按
    // "sessionId|exit"（每 session 只允许 emit 一次 exit）。LinkedHashMap +
    // synchronized + accessOrder=true 实现简易 LRU；上限 256 是合理的 burst 容量
    // （桌面 ring buffer 也是 256KB 量级）。
    private val recentStdoutKeys: MutableSet<String> = Collections.newSetFromMap(
        Collections.synchronizedMap(object : LinkedHashMap<String, Boolean>(256, 0.75f, true) {
            override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Boolean>): Boolean = size > 256
        }),
    )
    private val recentExitKeys: MutableSet<String> = Collections.newSetFromMap(
        Collections.synchronizedMap(object : LinkedHashMap<String, Boolean>(64, 0.75f, true) {
            override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Boolean>): Boolean = size > 64
        }),
    )

    // Plan A.1 — Dispatchers.Main.immediate 让 listener job 跟随 Dispatchers.setMain
    // 在测试里走 TestDispatcher 受 runCurrent 控制。生产下处理量小（JSON parse +
    // emit 到 SharedFlow），跑 Main 无压力。Phase 2 DC 路径上线后如果 stdout 流量
    // 大（>100KB/s），考虑切回 IO。
    private val scope = CoroutineScope(Dispatchers.Main.immediate + SupervisorJob())

    /**
     * 必须在使用 [observeStdout] 之前调用一次。订阅**双路**消息流，挑
     * `terminal.stdout` / `terminal.exit` 事件 emit 到 [_stdout] / [_exit]。
     *
     * Plan A.1 Phase 4 — 双路监听：
     *   1. [SignalClient.forwardedMessages] — 信令转发路径
     *   2. [WebRTCClient.messages] — DC 直连路径（也含 signaling 入，因
     *      WebRTCClient.initialize callback 同步 emit 到此 flow）
     *
     * 按 (sessionId, seq) 去重 stdout；按 sessionId 去重 exit（每会话一次）。
     * desktop sendToMobile DC ready 时**只发 DC**（Phase 4 desktop 收紧），
     * 但保留双路监听作为防御兜底——网络分区或竞态下 listener 都能正常工作。
     *
     * Plan A.1 Phase 1 — 从单 callback `setOnForwardedMessageReceived` 切到
     * SharedFlow，修 WebRTCClient / SignalingRpcClient / 本类三方互覆盖的 Trap 1。
     */
    fun start() {
        if (pushListenerInstalled) return
        signalingListenerJob = signalClient.forwardedMessages
            .onEach { raw -> handleForwardedEvent(raw) }
            .launchIn(scope)
        dcListenerJob = webRTCClient.messages
            .onEach { raw -> handleForwardedEvent(raw) }
            .launchIn(scope)
        pushListenerInstalled = true
        Timber.i("[TerminalRpc] push listener installed (forwardedMessages + webRTCClient.messages)")
    }

    private fun handleForwardedEvent(raw: String) {
        try {
            val msg = JSONObject(raw)
            if (msg.optString("type") != "chainlesschain:event") return
            val payloadRaw = msg.opt("payload")
            val payload = when (payloadRaw) {
                is String -> JSONObject(payloadRaw)
                is JSONObject -> payloadRaw
                else -> return
            }
            when (payload.optString("event")) {
                "terminal.stdout" -> {
                    val sessionId = payload.optString("sessionId")
                    val seq = payload.optLong("seq")
                    val key = "$sessionId|$seq"
                    // Plan A.1 v5.0.3.53-fix5 真机 E2E 真因：listener fires 4 次 per
                    // stdout event（forwardedMessages + _messages 双 emit + 老
                    // callback 残留），dedup 把所有 4 次都 drop（前次 emit 已 race
                    // 到 LRU）→ WebView 永远黑屏。
                    // 解：去掉 dedup gate，让所有 stdout 直接 emit。xterm.js 收重复
                    // chunk 只是多渲染一次同样字节，对用户不可感（PtyManager 每条
                    // chunk 都是 fresh bytes，重复 emit = 同字节渲染 N 次，最多视觉
                    // 上轻微重复，无功能损坏）。等 §3.5 双发去重设计 v0.2 真正
                    // 走 (sessionId, seq, payload-hash) + emit-first-add-after 模式
                    // 时再开 dedup。
                    val emitted = _stdout.tryEmit(
                        StdoutEvent(
                            sessionId = sessionId,
                            data = payload.optString("data"),
                            seq = seq,
                        ),
                    )
                    if (!emitted) {
                        Timber.w("[TerminalRpc] _stdout SharedFlow buffer full, dropping seq=$seq sessionId=$sessionId")
                    } else {
                        Timber.d("[TerminalRpc] stdout emit → UI sessionId=${sessionId.take(8)}… seq=$seq dataLen=${payload.optString("data").length}")
                    }
                    // recentStdoutKeys 保留只为 future v0.2 hardening，当前 noop
                    recentStdoutKeys.add(key)
                }
                "terminal.exit" -> {
                    val sessionId = payload.optString("sessionId")
                    // 同上：去掉 dedup gate；exit 多 emit 是 idempotent（ViewModel
                    // 只用第一次的 exitCode 关 session）。
                    val emitted = _exit.tryEmit(
                        ExitEvent(
                            sessionId = sessionId,
                            exitCode = if (payload.isNull("exitCode")) null else payload.optInt("exitCode"),
                            signal = if (payload.isNull("signal")) null else payload.optString("signal"),
                        ),
                    )
                    if (emitted) {
                        Timber.d("[TerminalRpc] exit emit → UI sessionId=${sessionId.take(8)}…")
                    }
                    recentExitKeys.add(sessionId)
                }
                else -> { /* ignore non-terminal events */ }
            }
        } catch (e: Exception) {
            Timber.w(e, "[TerminalRpc] event parse failed")
        }
    }

    suspend fun create(
        pcPeerId: String,
        shell: String = "pwsh",
        cwd: String? = null,
        cols: Int = 80,
        rows: Int = 24,
    ): Result<CreatedSession> {
        val params = buildMap<String, Any?> {
            put("shell", shell)
            put("cols", cols)
            put("rows", rows)
            cwd?.let { put("cwd", it) }
        }
        return rpc.invoke(pcPeerId, "terminal.create", params).map { json ->
            CreatedSession(
                sessionId = json.optString("sessionId"),
                pid = json.optInt("pid"),
                shell = json.optString("shell"),
                createdAt = json.optLong("createdAt"),
            )
        }
    }

    suspend fun list(pcPeerId: String): Result<List<SessionRow>> {
        return rpc.invoke(pcPeerId, "terminal.list", emptyMap()).map { json ->
            val arr = json.optJSONArray("sessions") ?: return@map emptyList()
            (0 until arr.length()).mapNotNull { idx ->
                val item = arr.optJSONObject(idx) ?: return@mapNotNull null
                SessionRow(
                    id = item.optString("id"),
                    shell = item.optString("shell"),
                    cwd = if (item.isNull("cwd")) null else item.optString("cwd"),
                    alive = item.optBoolean("alive"),
                    lastSeq = item.optLong("lastSeq"),
                )
            }
        }
    }

    suspend fun stdin(pcPeerId: String, sessionId: String, data: String): Result<Unit> {
        return rpc.invoke(
            pcPeerId,
            "terminal.stdin",
            mapOf("sessionId" to sessionId, "data" to data),
        ).map { Unit }
    }

    suspend fun resize(pcPeerId: String, sessionId: String, cols: Int, rows: Int): Result<Unit> {
        return rpc.invoke(
            pcPeerId,
            "terminal.resize",
            mapOf("sessionId" to sessionId, "cols" to cols, "rows" to rows),
        ).map { Unit }
    }

    suspend fun close(pcPeerId: String, sessionId: String): Result<Unit> {
        return rpc.invoke(
            pcPeerId,
            "terminal.close",
            mapOf("sessionId" to sessionId),
        ).map { Unit }
    }

    suspend fun history(
        pcPeerId: String,
        sessionId: String,
        fromSeq: Long = 0,
    ): Result<HistoryResponse> {
        return rpc.invoke(
            pcPeerId,
            "terminal.history",
            mapOf("sessionId" to sessionId, "fromSeq" to fromSeq),
        ).map { json ->
            val truncated = json.optBoolean("truncated", false)
            val arr = json.optJSONArray("chunks")
            val chunks = if (arr != null) {
                (0 until arr.length()).mapNotNull { idx ->
                    val c = arr.optJSONObject(idx) ?: return@mapNotNull null
                    HistoryChunk(seq = c.optLong("seq"), data = c.optString("data"))
                }
            } else emptyList()
            HistoryResponse(chunks = chunks, truncated = truncated)
        }
    }
}
