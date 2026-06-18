package com.chainlesschain.android.call

import com.chainlesschain.android.core.did.manager.DIDManager
import com.chainlesschain.android.remote.webrtc.WebRTCClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import org.json.JSONObject
import org.webrtc.AudioSource
import org.webrtc.AudioTrack
import org.webrtc.DataChannel
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.MediaStream
import org.webrtc.PeerConnection
import org.webrtc.RtpReceiver
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * FAMILY-67 通话媒体控制器（WebRTC 实现，P1 音频）。
 *
 * 独立媒体 PeerConnection（与消息 DataChannel PC 分开），复用 [WebRTCClient.sharedFactory]（避免重复
 * global init）+ [WebRTCClient.callIceServers]（ICE/TURN 配置）。call:offer/answer/ice 经 [CallManager]
 * （[CallMediaListener]）走信令中继；ICE 连通 → onMediaConnected → ACTIVE。DTLS-SRTP 端到端加密。
 *
 * 接线（[com.chainlesschain.android.initializer.AppInitializer]）：把本实例设给 `CallManager.media`，
 * 并把 `CallManager` 设为本实例 [listener]。
 */
@Singleton
class WebRtcCallMediaController @Inject constructor(
    private val webRTCClient: WebRTCClient,
    private val didManager: DIDManager,
    private val audioRoute: AudioRouteController,
) : CallMediaController {

    @Volatile var listener: CallMediaListener? = null

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    @Volatile private var pc: PeerConnection? = null
    @Volatile private var audioSource: AudioSource? = null
    @Volatile private var audioTrack: AudioTrack? = null
    @Volatile private var callId: String? = null
    @Volatile private var remoteDescSet = false
    private val pendingIce = mutableListOf<IceCandidate>()

    override suspend fun startAsOfferer(callId: String, peerDid: String, media: CallMediaType) {
        if (!prepare(callId, peerDid)) return
        val conn = pc ?: return
        runCatching {
            val offer = conn.createSdp(offer = true)
            conn.setLocal(offer)
            listener?.onLocalSdp(callId, CallSignalTypes.OFFER, offer.description)
        }.onFailure { Timber.e(it, "[CallMedia] offer failed"); listener?.onMediaFailed(callId) }
    }

    override suspend fun startAsAnswerer(callId: String, peerDid: String, media: CallMediaType) {
        // 仅建好 PC + 本地音轨，等对端 offer（onRemoteOffer）
        prepare(callId, peerDid)
    }

    override suspend fun onRemoteOffer(callId: String, sdp: String) {
        if (callId != this.callId) return
        val conn = pc ?: return
        runCatching {
            conn.setRemote(SessionDescription(SessionDescription.Type.OFFER, sdp))
            remoteDescSet = true
            drainPendingIce()
            val answer = conn.createSdp(offer = false)
            conn.setLocal(answer)
            listener?.onLocalSdp(callId, CallSignalTypes.ANSWER, answer.description)
        }.onFailure { Timber.e(it, "[CallMedia] answer failed"); listener?.onMediaFailed(callId) }
    }

    override suspend fun onRemoteAnswer(callId: String, sdp: String) {
        if (callId != this.callId) return
        val conn = pc ?: return
        runCatching {
            conn.setRemote(SessionDescription(SessionDescription.Type.ANSWER, sdp))
            remoteDescSet = true
            drainPendingIce()
        }.onFailure { Timber.e(it, "[CallMedia] setRemote answer failed"); listener?.onMediaFailed(callId) }
    }

    override suspend fun onRemoteIce(callId: String, candidate: String) {
        if (callId != this.callId) return
        val ice = parseIce(candidate) ?: return
        if (remoteDescSet) pc?.addIceCandidate(ice) else pendingIce.add(ice)
    }

    override fun setMuted(muted: Boolean) {
        audioTrack?.setEnabled(!muted)
    }

    override fun setSpeakerphone(on: Boolean) {
        audioRoute.setSpeaker(on)
    }

    override fun close() {
        runCatching { pc?.close() }
        runCatching { pc?.dispose() }
        runCatching { audioTrack?.dispose() }
        runCatching { audioSource?.dispose() }
        runCatching { audioRoute.stopCallAudio() }
        pc = null; audioTrack = null; audioSource = null
        callId = null; remoteDescSet = false; pendingIce.clear()
        Timber.i("[CallMedia] closed")
    }

    // ---- 内部 ----

    private suspend fun prepare(callId: String, peerDid: String): Boolean {
        this.callId = callId
        remoteDescSet = false
        pendingIce.clear()
        val factory = webRTCClient.sharedFactory()
        if (factory == null) {
            Timber.e("[CallMedia] shared PeerConnectionFactory null — message stack not initialized")
            listener?.onMediaFailed(callId)
            return false
        }
        val myDid = runCatching { didManager.getCurrentDID() }.getOrNull() ?: ""
        val iceServers = runCatching { webRTCClient.callIceServers(myDid, peerDid) }.getOrDefault(emptyList())
        val config = PeerConnection.RTCConfiguration(iceServers).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
        }
        val conn = factory.createPeerConnection(config, observer)
        if (conn == null) {
            listener?.onMediaFailed(callId)
            return false
        }
        pc = conn
        // 本地音轨（P1 仅音频）
        audioSource = factory.createAudioSource(MediaConstraints())
        audioTrack = factory.createAudioTrack("call-audio", audioSource).apply { setEnabled(true) }
        conn.addTrack(audioTrack, listOf("call-stream"))
        audioRoute.startCallAudio()
        Timber.i("[CallMedia] prepared PC + audio track (call=$callId, ice=${iceServers.size})")
        return true
    }

    private fun drainPendingIce() {
        if (pendingIce.isEmpty()) return
        pendingIce.forEach { pc?.addIceCandidate(it) }
        pendingIce.clear()
    }

    private val observer = object : PeerConnection.Observer {
        override fun onIceCandidate(c: IceCandidate) {
            val id = callId ?: return
            listener?.onLocalIce(id, serializeIce(c))
        }

        override fun onIceConnectionChange(state: PeerConnection.IceConnectionState) {
            Timber.d("[CallMedia] ICE state: $state")
            val id = callId ?: return
            when (state) {
                PeerConnection.IceConnectionState.CONNECTED,
                PeerConnection.IceConnectionState.COMPLETED -> listener?.onMediaConnected(id)
                PeerConnection.IceConnectionState.FAILED -> listener?.onMediaFailed(id)
                else -> {}
            }
        }

        override fun onAddTrack(receiver: RtpReceiver?, streams: Array<out MediaStream>?) {
            // 远端音轨：经 AudioDeviceModule 自动播放，无需手动处理。
            Timber.d("[CallMedia] remote track added: ${receiver?.track()?.kind()}")
        }

        // 其余回调无需处理。
        override fun onSignalingChange(s: PeerConnection.SignalingState?) {}
        override fun onIceConnectionReceivingChange(b: Boolean) {}
        override fun onIceGatheringChange(s: PeerConnection.IceGatheringState?) {}
        override fun onIceCandidatesRemoved(c: Array<out IceCandidate>?) {}
        override fun onAddStream(s: MediaStream?) {}
        override fun onRemoveStream(s: MediaStream?) {}
        override fun onDataChannel(d: DataChannel?) {}
        override fun onRenegotiationNeeded() {}
    }

    companion object {
        /** 音频 offer/answer 约束：收发音频，不收视频（P1）。 */
        private fun audioConstraints() = MediaConstraints().apply {
            mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveAudio", "true"))
            mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveVideo", "false"))
        }

        private fun serializeIce(c: IceCandidate): String = JSONObject().apply {
            put("sdpMid", c.sdpMid)
            put("sdpMLineIndex", c.sdpMLineIndex)
            put("candidate", c.sdp)
        }.toString()

        private fun parseIce(raw: String): IceCandidate? = runCatching {
            val o = JSONObject(raw)
            IceCandidate(o.optString("sdpMid"), o.optInt("sdpMLineIndex"), o.optString("candidate"))
        }.getOrNull()
    }

    // ---- suspend SDP 包装（WebRTC 回调 → suspend）----

    private suspend fun PeerConnection.createSdp(offer: Boolean): SessionDescription =
        suspendCancellableCoroutine { cont ->
            val obs = object : SdpObserver {
                override fun onCreateSuccess(sdp: SessionDescription) { if (cont.isActive) cont.resume(sdp) }
                override fun onCreateFailure(err: String?) { if (cont.isActive) cont.resumeWithException(RuntimeException("createSdp: $err")) }
                override fun onSetSuccess() {}
                override fun onSetFailure(err: String?) {}
            }
            if (offer) createOffer(obs, audioConstraints()) else createAnswer(obs, audioConstraints())
        }

    private suspend fun PeerConnection.setLocal(sdp: SessionDescription) =
        suspendCancellableCoroutine<Unit> { cont ->
            setLocalDescription(object : SdpObserver {
                override fun onCreateSuccess(d: SessionDescription?) {}
                override fun onCreateFailure(e: String?) {}
                override fun onSetSuccess() { if (cont.isActive) cont.resume(Unit) }
                override fun onSetFailure(e: String?) { if (cont.isActive) cont.resumeWithException(RuntimeException("setLocal: $e")) }
            }, sdp)
        }

    private suspend fun PeerConnection.setRemote(sdp: SessionDescription) =
        suspendCancellableCoroutine<Unit> { cont ->
            setRemoteDescription(object : SdpObserver {
                override fun onCreateSuccess(d: SessionDescription?) {}
                override fun onCreateFailure(e: String?) {}
                override fun onSetSuccess() { if (cont.isActive) cont.resume(Unit) }
                override fun onSetFailure(e: String?) { if (cont.isActive) cont.resumeWithException(RuntimeException("setRemote: $e")) }
            }, sdp)
        }
}
