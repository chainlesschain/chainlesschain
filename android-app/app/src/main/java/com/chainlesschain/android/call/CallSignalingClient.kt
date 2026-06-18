package com.chainlesschain.android.call

import com.chainlesschain.android.core.did.manager.DIDManager
import com.chainlesschain.android.remote.webrtc.WebRTCClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.launch
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * FAMILY-67 通话信令客户端 —— 经信令服务器中继 `call:*` 信令。
 *
 * 复用消息链路的 [WebRTCClient.sendForwardedMessage]（出向）+ [WebRTCClient.forwardedMessages]
 * （入向，多订阅 SharedFlow，按 `type:"call:*"` 分流，与 p2p-rpc / WebRTC 信令订阅者互不干扰）。
 * 双方都稳连信令服务器（offer/answer/ICE 本就经它），故呼叫信令保证送达——即便 DataChannel 没建过。
 *
 * 仅做传输：解析/序列化 + 转发，状态机在 [CallManager]。
 */
@Singleton
class CallSignalingClient @Inject constructor(
    private val webRTCClient: WebRTCClient,
    private val didManager: DIDManager,
) {
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    private val _incoming = MutableSharedFlow<CallSignal>(extraBufferCapacity = 64)
    /** 入向 call:* 信令流（CallManager 收）。 */
    val incoming: SharedFlow<CallSignal> = _incoming.asSharedFlow()

    @Volatile private var started = false

    /** 启动订阅（幂等）。 */
    fun start() {
        if (started) return
        started = true
        scope.launch {
            webRTCClient.forwardedMessages.collect { raw ->
                val sig = CallSignal.fromRaw(raw) ?: return@collect // 非 call:* 跳过
                Timber.d("[CallSignaling] in ${sig.type} call=${sig.callId} from=${sig.fromDid.take(16)}")
                _incoming.tryEmit(sig)
            }
        }
    }

    /** 发一条 call:* 信令给对端（`from` 填本机 DID）。返回是否已发出。 */
    suspend fun send(
        peerDid: String,
        type: String,
        callId: String,
        media: CallMediaType = CallMediaType.AUDIO,
        sdp: String? = null,
        candidate: String? = null,
        reason: String? = null,
    ): Boolean {
        val from = runCatching { didManager.getCurrentDID() }.getOrNull()
        if (from.isNullOrBlank()) {
            Timber.w("[CallSignaling] no local DID — cannot send $type")
            return false
        }
        val sig = CallSignal(type, callId, from, media, sdp, candidate, reason)
        val ok = runCatching { webRTCClient.sendForwardedMessage(peerDid, sig.toPayload()).isSuccess }
            .getOrDefault(false)
        Timber.d("[CallSignaling] out $type call=$callId → ${peerDid.take(16)} ok=$ok")
        return ok
    }
}
