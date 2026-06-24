package com.chainlesschain.android.remote.p2p

import com.chainlesschain.android.core.did.manager.DIDManager
import com.chainlesschain.android.core.e2ee.session.PersistentSessionManager
import com.chainlesschain.android.feature.p2p.recovery.SessionRecovery
import com.chainlesschain.android.remote.webrtc.WebRTCClient
import com.chainlesschain.android.sync.FriendSessionHandshake
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import org.json.JSONObject
import timber.log.Timber
import java.util.concurrent.ConcurrentHashMap
import javax.inject.Inject
import javax.inject.Singleton

/**
 * [SessionRecovery] 生产实现 —— 解密失败时**无 glare 的**自愈式重建 E2EE 会话。
 *
 * **glare 问题（真机实测）**：双向互发时两端都会收到 MAC 失败，若**两端都 initiate** 重握手 →
 * 两个全新会话互相覆盖 → 立刻再发散 → 无尽 recover 循环（"不经得起测试"）。
 *
 * **解法：单边发起 + resync 信号**（X3DH re-key 标准 tiebreak）：
 * - **offerer**（DID 字典序较小方，与 `FamilyGuardSyncConnector.electOfferer` 一致）才 deleteSession +
 *   `FriendSessionHandshake.initiate` 重跑 X3DH。
 * - **非 offerer** 收到 MAC 失败时**不自己 initiate**（避免 glare），而是经
 *   [WebRTCClient.sendForwardedMessage] 发一个 `e2ee-resync` 信号给 offerer，请它重握手。不删本地
 *   会话——offerer 的 `e2ee.init` 到达时 `E2EEHandshakeCommandRouter.handleInit` 会 acceptSession 覆盖它。
 * - [start] 订阅 [WebRTCClient.forwardedMessages]，offerer 收到 `e2ee-resync` → [recover]（它是 offerer →
 *   走 initiate 分支）。**不碰握手协议层 / E2EEHandshakeCommandRouter**（并行 session 域）。
 *
 * 去抖：同 peer [DEBOUNCE_MS] 内只触发一次（限制 MAC 失败风暴 → 一次握手；也限 resync 频率）。
 *
 * 设计 `docs/internal/p2p-self-healing-e2ee-sessions.md` §6.0。
 */
@Singleton
class WebRtcSessionRecovery @Inject constructor(
    private val sessionManager: PersistentSessionManager,
    private val handshake: FriendSessionHandshake,
    private val didManager: DIDManager,
    private val webRTCClient: WebRTCClient,
) : SessionRecovery {

    /** 去抖：peerId → 上次重建/请求时刻(ms)。 */
    private val lastAttempt = ConcurrentHashMap<String, Long>()

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private var listenJob: Job? = null

    /** 订阅 forwardedMessages：offerer 收到非 offerer 发来的 `e2ee-resync` → 触发自己重握手。 */
    fun start() {
        if (listenJob != null) return
        listenJob = scope.launch {
            webRTCClient.forwardedMessages.collect { raw ->
                val from = parseResyncFrom(raw) ?: return@collect
                Timber.i("[SessionRecovery] 收到 e2ee-resync ← ${from.take(20)}… → 作为 offerer 重握手")
                recover(from)
            }
        }
    }

    override suspend fun recover(peerId: String): Boolean {
        if (!claimAttempt(peerId)) {
            Timber.d("[SessionRecovery] 去抖跳过 ${peerId.take(20)}…")
            return false
        }
        val myDid = runCatching { didManager.getCurrentDID() }.getOrNull()
        if (myDid.isNullOrBlank()) {
            Timber.w("[SessionRecovery] 无本机 DID，跳过恢复")
            return false
        }
        return if (isOfferer(myDid, peerId)) {
            // offerer：删发散会话 + 重跑 X3DH（对端 handleInit 会 acceptSession 覆盖）。
            runCatching {
                Timber.w("[SessionRecovery] (offerer) 会话发散 → 重建与 ${peerId.take(20)}…")
                sessionManager.deleteSession(peerId)
                val ok = handshake.initiate(peerId)
                Timber.i("[SessionRecovery] 重建握手 ${if (ok) "成功" else "未完成(后台重试)"}: ${peerId.take(20)}…")
                ok
            }.onFailure { Timber.w(it, "[SessionRecovery] 重建失败 ${peerId.take(20)}…") }
                .getOrDefault(false)
        } else {
            // 非 offerer：不自己 initiate（避免 glare），请 offerer 重握手。本地会话留着，等 offerer
            // 的 e2ee.init 到达时被 acceptSession 覆盖。
            Timber.w("[SessionRecovery] (非 offerer) 会话发散 → 请 offerer ${peerId.take(20)}… 重握手")
            sendResyncRequest(peerId, myDid)
            false
        }
    }

    /** offerer = DID 字典序较小方（与 electOfferer 一致），保证双方对「谁发起」达成一致 → 无 glare。 */
    private fun isOfferer(myDid: String, peerDid: String): Boolean = myDid < peerDid

    private suspend fun sendResyncRequest(offererPeerId: String, myDid: String) {
        val payload = JSONObject()
            .put("type", RESYNC_TYPE)
            .put("from", myDid)
            .put("to", offererPeerId)
        runCatching { webRTCClient.sendForwardedMessage(offererPeerId, payload) }
            .onFailure { Timber.w(it, "[SessionRecovery] 发送 e2ee-resync 失败 → ${offererPeerId.take(20)}…") }
    }

    /** 解析对端发来的 `e2ee-resync` → 返回发起方 DID；非本协议返回 null。 */
    private fun parseResyncFrom(raw: String): String? = runCatching {
        val o = JSONObject(raw)
        if (o.optString("type") != RESYNC_TYPE) null else o.optString("from").ifBlank { null }
    }.getOrNull()

    /** 去抖闸：返回 true=本次放行（并记录时刻）；false=在窗口内被去抖。 */
    private fun claimAttempt(peerId: String): Boolean {
        val now = System.currentTimeMillis()
        val last = lastAttempt[peerId] ?: 0L
        if (now - last < DEBOUNCE_MS) return false
        lastAttempt[peerId] = now
        return true
    }

    companion object {
        /** 同 peer 重建/请求去抖窗口。 */
        private const val DEBOUNCE_MS = 10_000L

        /** 非 offerer → offerer 的重握手请求信号 type（经 forwardedMessages）。 */
        const val RESYNC_TYPE = "e2ee-resync"
    }
}
