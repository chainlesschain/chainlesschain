package com.chainlesschain.android.sync

import com.chainlesschain.android.core.did.manager.DIDManager
import com.chainlesschain.android.core.p2p.pairing.PairingSignalingGate
import com.chainlesschain.android.feature.familyguard.domain.repository.FamilyRelationshipRepository
import com.chainlesschain.android.remote.p2p.P2PClient
import com.chainlesschain.android.remote.webrtc.DiscoveredPeer
import com.chainlesschain.android.remote.webrtc.SignalingDiscoveryService
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
 * 家庭守护 P2P 自动接通器 (FAMILY-67 cross-device sync wiring).
 *
 * **背景**：家庭配对 ([com.chainlesschain.android.presentation.familypairing.FamilyPairingViewModel])
 * 只写本地 family_relationship 记录，**从不建立两台手机间的 P2P 连接**。而
 * [SyncCoordinator] 只往 [P2PClient.connectedPeers] 里已连的 peer 推队列（遥测 outbox 等），
 * 于是孩子端采集的遥测进了 SyncManager 队列却永远推不到家长端 —— 跨设备「孩子活动」恒空。
 *
 * 本类补上缺失的那一环：把已配对的监护人/孩子 DID，经信令服务器发现 + 拨号建成 WebRTC peer，
 * 进 [P2PClient.connectedPeers] 后 [SyncCoordinator] 30s 内自动把排队的变更推过去。
 *
 * 触发点：
 *   1. 配对接受/生成成功后 (FamilyPairingViewModel 调 [onPairingEstablished])
 *   2. 应用启动且存在 active relationship (AppInitializer 调 [ensureConnected])
 *
 * 机制：
 *   - **presence**：用本机真实 DID 作 stable peerId 注册到信令服务器
 *     ([PairingSignalingGate.ensureRegistered])，使本机**可被对端按 DID 发现**
 *     ([SignalingDiscoveryService] 返回的 [DiscoveredPeer.did])。WebSocketSignalClient
 *     reconnect 时自动重发 register，故 presence 跨断线保持。
 *   - **glare 规避**：双方都跑本器，但只有 DID 字典序较小的一方主动拨号
 *     ([electOfferer])，另一方仅保持 presence 等待入向 offer。避免两端同时 offer 撞车。
 *   - **discover + connect**：[connectOnce] 拉 active relationship 的 friendDid 集合，
 *     在信令 peer 列表里按 DID 匹配在线 peer，对「该我拨号」且尚未连上的，调
 *     [P2PClient.connect]。
 *
 * **设备阻塞 follow-up（本类未覆盖）**：被拨号的一方需要一个常驻 responder 循环
 * (WebRTCClient.waitForOffer → answer → connectedPeers) 才能应答入向 offer 把连接建成；
 * 该 WebRTC 应答管线是设备阻塞项，需真机联调。本类提供发现+拨号侧 + presence + glare 选举，
 * 纯逻辑 ([electOfferer]/[matchPeersToConnect]) 已单测覆盖。
 */
/**
 * VM-facing seam：配对成功后触发自动接通。抽成接口只为让
 * [com.chainlesschain.android.presentation.familypairing.FamilyPairingViewModel] 可纯单测
 * （同 LocalDidProvider 的做法）。
 */
interface FamilyPairingConnector {
    fun onPairingEstablished()
}

@Singleton
class FamilyGuardSyncConnector @Inject constructor(
    private val p2pClient: P2PClient,
    private val discoveryService: SignalingDiscoveryService,
    private val pairingGate: PairingSignalingGate,
    private val didManager: DIDManager,
    private val relationshipRepository: FamilyRelationshipRepository,
) : FamilyPairingConnector {
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    @Volatile
    private var loopJob: Job? = null

    /**
     * 启动持续接通循环（幂等）。存在 active relationship 时才真正干活；否则注册 presence 后空转，
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
            // presence：把自己以 DID 为 peerId 注册到信令服务器，供对端按 DID 发现。
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

    /** 单趟：发现 + 与尚未连上的已配对 peer 建连（按选举角色 offerer/responder）。 */
    private suspend fun connectOnce(myDid: String) {
        val peerDids = relationshipRepository.observeAllActive().first()
            .map { it.friendDid }
            .distinct()
        if (peerDids.isEmpty()) return

        val alreadyConnected = p2pClient.connectedPeers.value.values.map { it.did }.toSet()
        val targets = matchPeersToConnect(
            myDid = myDid,
            peerDids = peerDids,
            discovered = discoveryService.discoverPeers().getOrDefault(emptyList()),
            alreadyConnected = alreadyConnected,
        )
        for (t in targets) {
            Timber.i(
                "[FamilyGuardSyncConnector] connecting family peer did=${t.did.take(20)}… " +
                    "role=${if (t.isInitiator) "offerer" else "responder"}",
            )
            runCatching { p2pClient.connectFamilyPeer(t.did, myDid, t.isInitiator) }
                .onFailure { Timber.w(it, "[FamilyGuardSyncConnector] connect to ${t.did} failed") }
        }
    }

    data class ConnectTarget(val peerId: String, val did: String, val isInitiator: Boolean)

    companion object {
        /** 重连/重发现间隔；与 SyncCoordinator 推送节奏 (30s) 同量级。 */
        const val RECONNECT_INTERVAL_MS = 30_000L

        /**
         * Glare 规避：DID 字典序较小的一方做 offerer（主动拨号），另一方等待入向 offer。
         * 纯函数、确定性，两端对同一对 DID 必得相反结论。
         */
        fun electOfferer(myDid: String, peerDid: String): Boolean = myDid < peerDid

        /**
         * 纯函数：从信令发现的 peer 列表里，挑出尚未连上的已配对 peer 作为建连目标，
         * 并按 [electOfferer] 标注本机在该连接中是 offerer 还是 responder。
         *
         * 过滤条件：在线 + DID 属于已配对集合 + 非本机自身 + peerId 非空 + 尚未连上。
         * 按 DID 去重（同一 DID 多 peerId 取首个）。**双方都会发现对方并各自建连**，
         * 由 [electOfferer] 保证一方 offer、另一方 answer，规避 glare。
         */
        fun matchPeersToConnect(
            myDid: String,
            peerDids: Collection<String>,
            discovered: List<DiscoveredPeer>,
            alreadyConnected: Set<String> = emptySet(),
        ): List<ConnectTarget> {
            val wanted = peerDids.toSet()
            val seen = HashSet<String>()
            val out = ArrayList<ConnectTarget>()
            for (p in discovered) {
                if (!p.isOnline) continue
                if (p.peerId.isBlank()) continue
                if (p.did == myDid) continue
                if (p.did !in wanted) continue
                if (p.did in alreadyConnected) continue
                if (!seen.add(p.did)) continue
                out.add(
                    ConnectTarget(
                        peerId = p.peerId,
                        did = p.did,
                        isInitiator = electOfferer(myDid, p.did),
                    ),
                )
            }
            return out
        }
    }
}
