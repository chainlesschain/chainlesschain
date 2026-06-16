package com.chainlesschain.android.sync

import com.chainlesschain.android.core.did.manager.DIDManager
import com.chainlesschain.android.core.p2p.pairing.PairingSignalingGate
import com.chainlesschain.android.feature.familyguard.domain.repository.FamilyRelationshipRepository
import com.chainlesschain.android.remote.p2p.P2PClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton
import timber.log.Timber

/**
 * VM-facing seam：配对成功后触发自动接通。抽成接口只为让
 * [com.chainlesschain.android.presentation.familypairing.FamilyPairingViewModel] 可纯单测
 * （同 LocalDidProvider 的做法）。
 */
interface FamilyPairingConnector {
    fun onPairingEstablished()
}

/**
 * 家庭守护 P2P 自动接通器 (FAMILY-67 cross-device sync wiring).
 *
 * **背景**：家庭配对 ([com.chainlesschain.android.presentation.familypairing.FamilyPairingViewModel])
 * 只写本地 family_relationship 记录，**从不建立两台手机间的 P2P 连接**。而
 * [SyncCoordinator] 只往 [P2PClient.connectedPeers] 里已连的 peer 推队列（遥测 outbox 等），
 * 于是孩子端采集的遥测进了 SyncManager 队列却永远推不到家长端 —— 跨设备「孩子活动」恒空。
 *
 * 本类补上缺失的那一环：把已配对的监护人/孩子 DID 直接经信令服务器拨号建成 WebRTC peer，
 * 进 [P2PClient.connectedPeers] 后 [SyncCoordinator] 30s 内自动把排队的变更推过去。
 *
 * 触发点：
 *   1. 配对接受/生成成功后 (FamilyPairingViewModel 调 [onPairingEstablished])
 *   2. 应用启动且存在 active relationship (MainActivity 调 [ensureConnected])
 *
 * 机制：
 *   - **presence**：用本机真实 DID 作 stable peerId 注册到信令服务器
 *     ([PairingSignalingGate.ensureRegistered])。WebSocketSignalClient reconnect 时自动重发
 *     register，故 presence 跨断线保持。**双方都以 DID 注册** → 对端的注册 peerId == 其 DID。
 *   - **直接按 DID 拨号（不枚举）**：生产信令服务器只做 register + 按 peerId 转发，**不支持
 *     get-peers 枚举**（真机实测 discoverPeers 2.5s 超时无 peers-list）。但本机已从
 *     family_relationship 知道对端 DID，而对端注册 peerId == 其 DID，故无需枚举，直接对每个
 *     friendDid 调 [P2PClient.connectFamilyPeer]（offer/answer 经信令按 peerId 转发，同 phone↔PC）。
 *   - **glare 规避**：双方都跑本器并互相拨号，由 [electOfferer]（DID 字典序）令一方 offer、
 *     另一方 responder 等 offer，避免两端同时 offer 撞车。
 *   - 对端离线时该次 WebRTC 连接超时，下一轮 (30s) 重试；已连则幂等早返。
 *
 * 纯逻辑 ([electOfferer]/[targetsFor]) 单测覆盖；真机联调验证 presence 注册 + 建连 + 推送。
 */
@Singleton
class FamilyGuardSyncConnector @Inject constructor(
    private val p2pClient: P2PClient,
    private val pairingGate: PairingSignalingGate,
    private val didManager: DIDManager,
    private val relationshipRepository: FamilyRelationshipRepository,
) : FamilyPairingConnector {
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    @Volatile
    private var loopJob: Job? = null

    /**
     * 启动持续接通循环（幂等）。存在 active relationship 时才真正拨号；否则注册 presence 后空转，
     * 一旦后续配对建立即被 [onPairingEstablished] 唤醒（其实就是已在跑，下一轮自然拨号）。
     */
    fun ensureConnected() {
        if (loopJob?.isActive == true) return
        loopJob = scope.launch {
            val myDid = runCatching { didManager.getCurrentDID() }.getOrNull()
            if (myDid.isNullOrBlank()) {
                Timber.d("[FamilyGuardSyncConnector] no local DID yet — skip (will retry on next pairing)")
                return@launch
            }
            // presence：把自己以 DID 为 peerId 注册到信令服务器，对端 offer/answer 经此转发。
            runCatching { pairingGate.ensureRegistered(myDid) }
                .onFailure { Timber.w(it, "[FamilyGuardSyncConnector] ensureRegistered failed (will retry)") }

            while (isActive) {
                runCatching { connectOnce(myDid) }
                    .onFailure { Timber.w(it, "[FamilyGuardSyncConnector] connect pass failed") }
                delay(RECONNECT_INTERVAL_MS)
            }
        }
    }

    /** 配对成功后调；确保循环在跑（首次配对前 ensureConnected 可能因无 DID 早退）。 */
    override fun onPairingEstablished() = ensureConnected()

    /** 单趟：对尚未连上的已配对 peer 直接按 DID 建连（按选举角色 offerer/responder）。 */
    private suspend fun connectOnce(myDid: String) {
        val peerDids = relationshipRepository.observeAllActive().first()
            .map { it.friendDid }
            .distinct()
        val alreadyConnected = p2pClient.connectedPeers.value.values.map { it.did }.toSet()
        val targets = targetsFor(myDid = myDid, peerDids = peerDids, alreadyConnected = alreadyConnected)
        for (t in targets) {
            Timber.i(
                "[FamilyGuardSyncConnector] connecting family peer did=${t.did.take(20)}… " +
                    "role=${if (t.isInitiator) "offerer" else "responder"}",
            )
            runCatching { p2pClient.connectFamilyPeer(t.did, myDid, t.isInitiator) }
                .onFailure { Timber.w(it, "[FamilyGuardSyncConnector] connect to ${t.did} failed") }
        }
    }

    data class ConnectTarget(val did: String, val isInitiator: Boolean)

    companion object {
        /** 重连/重发现间隔；与 SyncCoordinator 推送节奏 (30s) 同量级。 */
        const val RECONNECT_INTERVAL_MS = 30_000L

        /**
         * Glare 规避：DID 字典序较小的一方做 offerer（主动发 offer），另一方做 responder
         * （等入向 offer 回 answer）。纯函数、确定性，两端对同一对 DID 必得相反结论。
         */
        fun electOfferer(myDid: String, peerDid: String): Boolean = myDid < peerDid

        /**
         * 纯函数：从已配对的 peer DID 集合里，挑出尚未连上的作为建连目标，并按 [electOfferer]
         * 标注本机在该连接中是 offerer 还是 responder。
         *
         * 过滤：非本机自身 + 非空 + 尚未连上；去重。不依赖信令枚举（生产服务器不支持 get-peers），
         * 直接用 family_relationship 里的对端 DID 作 target（对端注册 peerId == 其 DID）。
         */
        fun targetsFor(
            myDid: String,
            peerDids: Collection<String>,
            alreadyConnected: Set<String> = emptySet(),
        ): List<ConnectTarget> {
            val seen = HashSet<String>()
            val out = ArrayList<ConnectTarget>()
            for (did in peerDids) {
                if (did.isBlank()) continue
                if (did == myDid) continue
                if (did in alreadyConnected) continue
                if (!seen.add(did)) continue
                out.add(ConnectTarget(did = did, isInitiator = electOfferer(myDid, did)))
            }
            return out
        }
    }
}
