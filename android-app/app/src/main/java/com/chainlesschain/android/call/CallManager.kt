package com.chainlesschain.android.call

import com.chainlesschain.android.core.did.manager.DIDManager
import com.chainlesschain.android.sync.FamilyGuardSyncConnector
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * FAMILY-67 好友 P2P 通话状态机编排（信令层）。
 *
 * 复用 [CallSignalingClient]（call:* 中继）+ `electOfferer`（角色选举，沿用消息握手）。媒体经
 * [CallMediaController] seam 解耦（P0 用 NOOP 纯信令，P1 接 WebRTC 媒体）。状态见 [CallState]，
 * 设计 docs/design/FAMILY-67_Friend_P2P_AudioVideo_Call_Design.md §10.2。
 *
 * 单连接语义：同一时刻只一通话；已在通话中收到新 invite → busy 拒接（glare 例外，见 [onInvite]）。
 */
@Singleton
class CallManager @Inject constructor(
    private val signaling: CallSignalingClient,
    private val didManager: DIDManager,
) : CallMediaListener {

    private val scope = CoroutineScope(Dispatchers.Default + SupervisorJob())

    private val _callState = MutableStateFlow<CallSession?>(null)
    /** 当前通话（null = 无）。UI collect 之渲染来电/去电/通话中。 */
    val callState: StateFlow<CallSession?> = _callState.asStateFlow()

    /** 媒体控制器（P1 注入 WebRtcCallMediaController；P0 默认 NOOP）。 */
    @Volatile var media: CallMediaController = CallMediaController.NOOP

    /** 前台服务 + 来电全屏通知 seam（P3 注入 AndroidCallServiceLauncher；默认 NOOP，保单测纯净）。 */
    @Volatile var serviceLauncher: CallServiceLauncher = CallServiceLauncher.NOOP

    /** 通话历史落库 seam（注入 RoomCallHistoryRecorder；默认 NOOP）。 */
    @Volatile var historyRecorder: CallHistoryRecorder = CallHistoryRecorder.NOOP

    // ---- 可注入 seam（单测替换）----
    internal var clock: () -> Long = { System.currentTimeMillis() }
    internal var genCallId: () -> String = { "call-" + java.util.UUID.randomUUID().toString().take(12) }
    internal var elect: (String, String) -> Boolean = { a, b -> FamilyGuardSyncConnector.electOfferer(a, b) }

    @Volatile private var started = false
    @Volatile private var timeoutJob: Job? = null
    @Volatile private var reconnectJob: Job? = null // 断网重连宽限计时（ACTIVE 中 ICE 断开）

    fun start() {
        if (started) return
        started = true
        signaling.start()
        scope.launch { signaling.incoming.collect { runCatching { onSignal(it) } } }
        // P3: 把状态转发给前台服务/通知 seam（来电全屏通知、通话中前台服务、结束清理）。
        scope.launch {
            _callState.collect { s ->
                runCatching { if (s == null) serviceLauncher.clear() else serviceLauncher.onCall(s) }
            }
        }
    }

    // ============ 用户动作 ============

    /** 主叫发起呼叫。已在通话中则忽略。 */
    fun startCall(peerDid: String, mediaType: CallMediaType = CallMediaType.AUDIO) {
        if (_callState.value?.state?.inProgress == true) {
            Timber.w("[Call] startCall ignored — already in a call")
            return
        }
        val callId = genCallId()
        _callState.value = CallSession(callId, peerDid, CallDirection.OUTGOING, mediaType, CallState.OUTGOING, startedAtMs = clock())
        scope.launch { signaling.send(peerDid, CallSignalTypes.INVITE, callId, mediaType) }
        armTimeout(callId, NO_ANSWER_TIMEOUT_MS, CallEndReason.TIMEOUT_NO_ANSWER)
        Timber.i("[Call] outgoing $callId → ${peerDid.take(16)} ($mediaType)")
    }

    /** 被叫接听。 */
    fun accept() {
        val s = _callState.value ?: return
        if (s.state != CallState.INCOMING) return
        transition(s.copy(state = CallState.CONNECTING))
        scope.launch {
            signaling.send(s.peerDid, CallSignalTypes.ACCEPT, s.callId, s.media)
            // 媒体：接听方按角色准备（offerer 由 electOfferer 决定，答 offer 或发 offer）
            startMedia(s.callId, s.peerDid, s.media)
        }
        armTimeout(s.callId, MEDIA_TIMEOUT_MS, CallEndReason.TIMEOUT_MEDIA)
    }

    /** 被叫拒接 / 主叫取消（统一挂断）。 */
    fun reject(reason: String = "declined") {
        val s = _callState.value ?: return
        scope.launch { signaling.send(s.peerDid, CallSignalTypes.REJECT, s.callId, s.media, reason = reason) }
        end(CallEndReason.REJECTED)
    }

    /** 挂断（任意进行中状态）。 */
    fun hangup() {
        val s = _callState.value ?: return
        if (!s.state.inProgress) return
        scope.launch { signaling.send(s.peerDid, CallSignalTypes.HANGUP, s.callId, s.media) }
        end(CallEndReason.LOCAL_HANGUP)
    }

    fun setMuted(muted: Boolean) {
        _callState.update { it?.copy(muted = muted) }
        media.setMuted(muted)
    }

    fun setSpeaker(on: Boolean) {
        _callState.update { it?.copy(speakerOn = on) }
        media.setSpeakerphone(on)
    }

    // ============ 入向信令 ============

    internal suspend fun onSignal(sig: CallSignal) {
        when (sig.type) {
            CallSignalTypes.INVITE -> onInvite(sig)
            CallSignalTypes.RINGING -> onRinging(sig)
            CallSignalTypes.ACCEPT -> onAccept(sig)
            CallSignalTypes.REJECT -> onRemoteReject(sig)
            CallSignalTypes.HANGUP -> onRemoteHangup(sig)
            CallSignalTypes.OFFER -> if (matches(sig)) media.onRemoteOffer(sig.callId, sig.sdp ?: return)
            CallSignalTypes.ANSWER -> if (matches(sig)) media.onRemoteAnswer(sig.callId, sig.sdp ?: return)
            CallSignalTypes.ICE -> if (matches(sig)) media.onRemoteIce(sig.callId, sig.candidate ?: return)
        }
    }

    private fun matches(sig: CallSignal): Boolean = _callState.value?.callId == sig.callId

    private suspend fun onInvite(sig: CallSignal) {
        val cur = _callState.value
        if (cur != null && cur.state.inProgress) {
            // Glare：双方互呼（我在 OUTGOING/RINGING 呼对方，又收到对方的 invite）
            val isGlare = cur.direction == CallDirection.OUTGOING &&
                cur.peerDid == sig.fromDid &&
                (cur.state == CallState.OUTGOING || cur.state == CallState.OUTGOING_RINGING)
            if (isGlare) {
                if (resolveGlareKeepMine(cur.callId, sig.callId)) {
                    // 保留己方呼叫，拒对端
                    signaling.send(sig.fromDid, CallSignalTypes.REJECT, sig.callId, sig.media, reason = "glare")
                } else {
                    // 让步：撤己方，转为接受对端来电
                    signaling.send(cur.peerDid, CallSignalTypes.HANGUP, cur.callId, cur.media)
                    cancelTimeout()
                    _callState.value = CallSession(sig.callId, sig.fromDid, CallDirection.INCOMING, sig.media, CallState.INCOMING, startedAtMs = clock())
                    signaling.send(sig.fromDid, CallSignalTypes.RINGING, sig.callId, sig.media)
                    armTimeout(sig.callId, NO_ANSWER_TIMEOUT_MS, CallEndReason.TIMEOUT_NO_ANSWER)
                }
                return
            }
            // 忙
            signaling.send(sig.fromDid, CallSignalTypes.REJECT, sig.callId, sig.media, reason = "busy")
            return
        }
        // 空闲 → 来电响铃
        _callState.value = CallSession(sig.callId, sig.fromDid, CallDirection.INCOMING, sig.media, CallState.INCOMING, startedAtMs = clock())
        signaling.send(sig.fromDid, CallSignalTypes.RINGING, sig.callId, sig.media)
        armTimeout(sig.callId, NO_ANSWER_TIMEOUT_MS, CallEndReason.TIMEOUT_NO_ANSWER)
        Timber.i("[Call] incoming ${sig.callId} from ${sig.fromDid.take(16)} (${sig.media})")
    }

    private fun onRinging(sig: CallSignal) {
        val s = _callState.value ?: return
        if (s.callId == sig.callId && s.state == CallState.OUTGOING) {
            transition(s.copy(state = CallState.OUTGOING_RINGING))
        }
    }

    private suspend fun onAccept(sig: CallSignal) {
        val s = _callState.value ?: return
        if (s.callId != sig.callId || s.direction != CallDirection.OUTGOING) return
        transition(s.copy(state = CallState.CONNECTING))
        startMedia(s.callId, s.peerDid, s.media)
        armTimeout(s.callId, MEDIA_TIMEOUT_MS, CallEndReason.TIMEOUT_MEDIA)
    }

    private fun onRemoteReject(sig: CallSignal) {
        val s = _callState.value ?: return
        if (s.callId != sig.callId) return
        end(if (sig.reason == "busy") CallEndReason.BUSY else CallEndReason.REJECTED)
    }

    private fun onRemoteHangup(sig: CallSignal) {
        val s = _callState.value ?: return
        if (s.callId != sig.callId) return
        end(CallEndReason.REMOTE_HANGUP)
    }

    // ============ 媒体回调（CallMediaListener）============

    override fun onLocalSdp(callId: String, type: String, sdp: String) {
        val s = _callState.value ?: return
        if (s.callId != callId) return
        scope.launch { signaling.send(s.peerDid, type, callId, s.media, sdp = sdp) }
    }

    override fun onLocalIce(callId: String, candidate: String) {
        val s = _callState.value ?: return
        if (s.callId != callId) return
        scope.launch { signaling.send(s.peerDid, CallSignalTypes.ICE, callId, s.media, candidate = candidate) }
    }

    override fun onMediaConnected(callId: String) {
        val s = _callState.value ?: return
        if (s.callId != callId) return
        // 重连成功（或首次连通）→ 清掉断网重连宽限计时
        reconnectJob?.cancel(); reconnectJob = null
        if (s.state == CallState.ACTIVE) {
            Timber.i("[Call] media reconnected $callId")
            return
        }
        cancelTimeout()
        transition(s.copy(state = CallState.ACTIVE, connectedAtMs = clock()))
        Timber.i("[Call] active $callId")
    }

    override fun onMediaFailed(callId: String) {
        if (_callState.value?.callId == callId) end(CallEndReason.MEDIA_FAILED)
    }

    override fun onMediaDisconnected(callId: String) {
        val s = _callState.value ?: return
        if (s.callId != callId || s.state != CallState.ACTIVE) return
        if (reconnectJob != null) return // 已在宽限期
        Timber.w("[Call] media disconnected $callId — reconnect grace ${RECONNECT_GRACE_MS}ms")
        reconnectJob = scope.launch {
            delay(RECONNECT_GRACE_MS)
            val cur = _callState.value
            if (cur != null && cur.callId == callId && cur.state == CallState.ACTIVE) {
                Timber.w("[Call] reconnect grace expired $callId — ending NETWORK_LOST")
                end(CallEndReason.NETWORK_LOST)
            }
        }
    }

    // ============ 内部 ============

    private suspend fun startMedia(callId: String, peerDid: String, mediaType: CallMediaType) {
        val myDid = runCatching { didManager.getCurrentDID() }.getOrNull() ?: return
        if (elect(myDid, peerDid)) media.startAsOfferer(callId, peerDid, mediaType)
        else media.startAsAnswerer(callId, peerDid, mediaType)
    }

    private fun transition(next: CallSession) { _callState.value = next }

    private fun end(reason: CallEndReason) {
        cancelTimeout()
        reconnectJob?.cancel(); reconnectJob = null
        runCatching { media.close() }
        val s = _callState.value
        if (s != null && !s.state.isTerminal) {
            val ended = s.copy(state = CallState.ENDED, endedAtMs = clock(), endReason = reason)
            _callState.value = ended
            runCatching { historyRecorder.record(ended) }
        }
        // 短暂保留 ENDED 供 UI 显示结束态，随后清空
        scope.launch {
            delay(END_LINGER_MS)
            if (_callState.value?.state == CallState.ENDED) _callState.value = null
        }
        Timber.i("[Call] ended reason=$reason")
    }

    private fun armTimeout(callId: String, ms: Long, reason: CallEndReason) {
        cancelTimeout()
        timeoutJob = scope.launch {
            delay(ms)
            val s = _callState.value
            if (s != null && s.callId == callId && !s.state.isTerminal && s.state != CallState.ACTIVE) {
                Timber.w("[Call] timeout $callId reason=$reason")
                // 通知对端我方放弃
                runCatching { signaling.send(s.peerDid, CallSignalTypes.HANGUP, callId, s.media) }
                end(reason)
            }
        }
    }

    private fun cancelTimeout() {
        timeoutJob?.cancel()
        timeoutJob = null
    }

    companion object {
        const val NO_ANSWER_TIMEOUT_MS = 60_000L
        const val MEDIA_TIMEOUT_MS = 30_000L
        const val END_LINGER_MS = 2_500L
        const val RECONNECT_GRACE_MS = 20_000L // 通话中 ICE 断开后等待恢复的宽限期
    }
}
