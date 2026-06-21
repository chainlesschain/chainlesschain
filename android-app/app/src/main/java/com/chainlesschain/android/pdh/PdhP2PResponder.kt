package com.chainlesschain.android.pdh

import com.chainlesschain.android.core.p2p.model.P2PMessage
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import java.util.Base64
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * §8.3 P2P 请求-响应关联(实现 [PdhBackupBlockChannel.P2PResponder])—— module 101 Phase 7.
 *
 * 把 [PdhBackupBlockChannel] 的"发请求-等相关响应"落到真实 P2P 消息上:每个请求生成
 * requestId,以信封(`requestId|type|isResp|dataB64`)塞进 P2P 消息 payload 发给对端,
 * 本端按 requestId await;对端回带同 requestId 的响应信封 → 关联完成。同一实例对称服务两端:
 *  - 作请求方:[request] 发请求、按 requestId 等响应(超时返 null);
 *  - 作应答方([onRequest] 不为空时):收到请求信封 → 调 [onRequest](路由到
 *    [PdhBackupRequestHandler])→ 回响应信封。
 *
 * 底层收发是 [P2PMessenger] seam(真实现包 core-p2p `P2PConnectionManager`:
 * receivedMessages 作 [P2PMessenger.incoming]、sendMessage 作 [P2PMessenger.send],
 * MessageType 选 KNOWLEDGE_SYNC——协议在信封里、不靠 MessageType)。关联/超时/对称应答
 * 是**纯逻辑、可单测**(两个配对 messenger + runTest 端到端)。
 */
class PdhP2PResponder(
    private val messenger: P2PMessenger,
    private val scope: CoroutineScope,
    private val timeoutMs: Long = 30_000L,
    private val genRequestId: () -> String = { UUID.randomUUID().toString() },
    private val onRequest: (suspend (type: String, data: ByteArray) -> ByteArray)? = null,
) : PdhBackupBlockChannel.P2PResponder {

    /** P2P 收发 seam。真实现包 core-p2p P2PConnectionManager(receivedMessages / sendMessage)。 */
    interface P2PMessenger {
        val incoming: Flow<P2PMessage>
        suspend fun send(toDeviceId: String, payload: String)
    }

    private val pending = ConcurrentHashMap<String, CompletableDeferred<ByteArray?>>()
    private var job: Job? = null

    /** 开始收集 incoming:响应 → 完成对应 pending;请求 → 路由 onRequest 后回响应。 */
    fun start() {
        if (job != null) return
        job = scope.launch {
            messenger.incoming.collect { msg ->
                val env = Envelope.parse(msg.payload) ?: return@collect
                if (env.isResponse) {
                    pending.remove(env.requestId)?.complete(env.data)
                } else {
                    val handler = onRequest ?: return@collect
                    val respData = runCatching { handler(env.type, env.data) }.getOrNull() ?: return@collect
                    messenger.send(msg.fromDeviceId, Envelope(env.requestId, env.type, true, respData).encode())
                }
            }
        }
    }

    /** 停止收集并完成所有挂起请求为 null(避免泄漏)。 */
    fun stop() {
        job?.cancel()
        job = null
        pending.values.forEach { it.complete(null) }
        pending.clear()
    }

    override suspend fun request(peerId: String, type: String, payload: ByteArray): ByteArray? {
        val rid = genRequestId()
        val deferred = CompletableDeferred<ByteArray?>()
        pending[rid] = deferred
        return try {
            messenger.send(peerId, Envelope(rid, type, false, payload).encode())
            withTimeoutOrNull(timeoutMs) { deferred.await() }
        } finally {
            pending.remove(rid)
        }
    }

    /** 关联信封:requestId|type|isResp(0/1)|dataB64(url-safe base64;requestId/type 无 '|')。 */
    internal data class Envelope(
        val requestId: String,
        val type: String,
        val isResponse: Boolean,
        val data: ByteArray,
    ) {
        fun encode(): String =
            "$requestId|$type|${if (isResponse) "1" else "0"}|${ENC.encodeToString(data)}"

        companion object {
            private val ENC: Base64.Encoder = Base64.getUrlEncoder().withoutPadding()
            private val DEC: Base64.Decoder = Base64.getUrlDecoder()

            fun parse(s: String): Envelope? {
                val p = s.split("|", limit = 4)
                if (p.size != 4) return null
                val data = runCatching { DEC.decode(p[3]) }.getOrNull() ?: return null
                return Envelope(p[0], p[1], p[2] == "1", data)
            }
        }
    }
}
