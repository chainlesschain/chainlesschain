package com.chainlesschain.android.remote.terminal

import com.chainlesschain.android.remote.client.SignalingRpcClient
import com.chainlesschain.android.remote.webrtc.SignalClient
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import org.json.JSONObject
import timber.log.Timber
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

    /**
     * 必须在使用 [observeStdout] 之前调用一次。安装 SignalClient 上的 forward
     * message 钩子，只 emit `terminal.stdout` / `terminal.exit` 事件，其余路过。
     */
    fun start() {
        if (pushListenerInstalled) return
        signalClient.setOnForwardedMessageReceived { raw ->
            try {
                val msg = JSONObject(raw)
                if (msg.optString("type") != "chainlesschain:event") return@setOnForwardedMessageReceived
                val payloadRaw = msg.opt("payload")
                val payload = when (payloadRaw) {
                    is String -> JSONObject(payloadRaw)
                    is JSONObject -> payloadRaw
                    else -> return@setOnForwardedMessageReceived
                }
                when (payload.optString("event")) {
                    "terminal.stdout" -> {
                        _stdout.tryEmit(
                            StdoutEvent(
                                sessionId = payload.optString("sessionId"),
                                data = payload.optString("data"),
                                seq = payload.optLong("seq"),
                            ),
                        )
                    }
                    "terminal.exit" -> {
                        _exit.tryEmit(
                            ExitEvent(
                                sessionId = payload.optString("sessionId"),
                                exitCode = if (payload.isNull("exitCode")) null else payload.optInt("exitCode"),
                                signal = if (payload.isNull("signal")) null else payload.optString("signal"),
                            ),
                        )
                    }
                    else -> { /* ignore non-terminal events */ }
                }
            } catch (e: Exception) {
                Timber.w(e, "[TerminalRpc] event parse failed")
            }
        }
        pushListenerInstalled = true
        Timber.i("[TerminalRpc] push listener installed")
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
