package com.chainlesschain.android.sync

import com.chainlesschain.android.core.common.Result
import com.chainlesschain.android.core.database.entity.social.FriendStatus
import com.chainlesschain.android.core.did.manager.DIDManager
import com.chainlesschain.android.core.p2p.pairing.PairingSignalingGate
import com.chainlesschain.android.feature.p2p.repository.social.FriendRepository
import com.chainlesschain.android.feature.p2p.social.FriendConnector
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
 * 社交好友 P2P 自动接通器 (FAMILY-67 对称件)。
 *
 * **背景**：加好友 ([com.chainlesschain.android.feature.p2p.viewmodel.social.AddFriendViewModel])
 * 只写本地 FriendEntity（status=ACCEPTED）+ best-effort 通知，**从不建立两台手机间的 P2P 连接**。
 * 而好友/社交数据（[SocialSyncAdapter] 把 friend/post 记成 [ResourceType.FRIEND] 等 SyncItem）和
 * 家庭遥测一样经 [SyncManager] 队列 + [SyncCoordinator] 往 [P2PClient.connectedPeers] 里已连 peer 推。
 * 没有接通器 → connectedPeers 永远不含好友 → 加完好友数据/消息推不过去。
 *
 * 本类是 [FamilyGuardSyncConnector] 的好友版镜像：把已接受好友的 DID（core-did `did:key`，与社交
 * 用的同一身份体系）注册 presence + 按 DID 直连，进 connectedPeers 后 SyncCoordinator 自动推社交变更。
 * 复用 [FamilyGuardSyncConnector] 的纯逻辑（[FamilyGuardSyncConnector.targetsFor]/`electOfferer`）+
 * [P2PClient.connectFamilyPeer]（其 core-did auth 对 core-did 好友同样正确，"family" 命名仅 cosmetic）。
 *
 * **单连接约束（与家庭共享）**：底层 WebRTCClient 当前单连接。为避免与家庭遥测连接互相拆（两个
 * connector 抢同一条连接），本器在已有任何 P2P 连接占用时**让位不拨**（家庭遥测优先）；好友仅在连接
 * 空闲时接通。多 peer 并存待 W2.2。
 *
 * 触发：加好友成功（AddFriendViewModel 调 [onFriendAdded]）+ 应用启动有好友（MainActivity 调 [ensureConnected]）。
 */
@Singleton
class FriendSyncConnector @Inject constructor(
    private val p2pClient: P2PClient,
    private val pairingGate: PairingSignalingGate,
    private val didManager: DIDManager,
    private val friendRepository: FriendRepository,
) : FriendConnector {
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    @Volatile
    private var loopJob: Job? = null

    fun ensureConnected() {
        if (loopJob?.isActive == true) return
        loopJob = scope.launch {
            val myDid = runCatching { didManager.getCurrentDID() }.getOrNull()
            if (myDid.isNullOrBlank()) {
                Timber.d("[FriendSyncConnector] no local DID yet — skip (will retry on next add)")
                return@launch
            }
            runCatching { pairingGate.ensureRegistered(myDid) }
                .onFailure { Timber.w(it, "[FriendSyncConnector] ensureRegistered failed (will retry)") }

            while (isActive) {
                val pending = runCatching { connectOnce(myDid) }
                    .onFailure { Timber.w(it, "[FriendSyncConnector] connect pass failed") }
                    .getOrDefault(0)
                delay(
                    if (pending > 0) FamilyGuardSyncConnector.RETRY_INTERVAL_MS
                    else FamilyGuardSyncConnector.IDLE_INTERVAL_MS,
                )
            }
        }
    }

    override fun onFriendAdded() = ensureConnected()

    private suspend fun connectOnce(myDid: String): Int {
        val friendDids = acceptedFriendDids()
        if (friendDids.isEmpty()) return 0
        val connected = p2pClient.connectedPeers.value.values.map { it.did }.toSet()
        // 已与某好友连上 → 单连接保持，不再拨。
        if (friendDids.any { it in connected }) return 0
        // 单连接：已有其他 P2P 连接（如家庭遥测，优先）占用 → 本轮让位不拨，避免互相拆；下轮再看。
        if (connected.isNotEmpty()) return 0
        val targets = FamilyGuardSyncConnector.targetsFor(myDid = myDid, peerDids = friendDids, alreadyConnected = connected)
        for (t in targets) {
            Timber.i(
                "[FriendSyncConnector] connecting friend did=${t.did.take(20)}… " +
                    "role=${if (t.isInitiator) "offerer" else "responder"}",
            )
            runCatching { p2pClient.connectFamilyPeer(t.did, myDid, t.isInitiator) }
                .onFailure { Timber.w(it, "[FriendSyncConnector] connect to ${t.did} failed") }
            // 连上即停（单连接），不再拨别的好友把刚建好的连接拆掉。
            if (p2pClient.connectedPeers.value.values.any { it.did in friendDids }) break
        }
        return targets.size
    }

    /** 已接受好友的 DID 集合（core-did did:key）。getAllFriends 首发可能是 Loading → 视为空，下轮再取。 */
    private suspend fun acceptedFriendDids(): List<String> {
        val res = runCatching { friendRepository.getAllFriends().first() }.getOrNull()
        return (res as? Result.Success)?.data
            ?.filter { it.status == FriendStatus.ACCEPTED }
            ?.map { it.did }
            ?.distinct()
            ?: emptyList()
    }
}
