package com.chainlesschain.android.familyguard.time

import com.chainlesschain.android.core.p2p.pairing.PairedPeersStore
import com.chainlesschain.android.feature.familyguard.domain.time.ParentTimeSource
import com.chainlesschain.android.remote.webrtc.FamilyTimeRpcClient
import javax.inject.Inject
import javax.inject.Singleton
import timber.log.Timber

/**
 * :app 层 [ParentTimeSource] 真实实装（FAMILY-60）—— 经 [FamilyTimeRpcClient] P2P 拉
 * 家长端 epoch。覆盖 feature 默认 NoOpParentTimeSource（绑定在 :app
 * [com.chainlesschain.android.di.ParentTimeModule]，不在 feature；同
 * SyncManagerTelemetryOutbox 的 seam 模式——feature 不依赖 :core-p2p 传输）。
 *
 * 家长 peer 解析: 取第一个已配对对端（v0.1 以常驻桌面为权威授时源；mobile↔mobile
 * 家长选择留后续细化）。无已配对对端 / 对端不可达 → 返 null →
 * [com.chainlesschain.android.feature.familyguard.data.time.CristianTimeAuthority]
 * 保持 NEVER_SYNCED（不可信，降温和档，不锁死）。
 */
@Singleton
class P2PParentTimeSource @Inject constructor(
    private val rpcClient: FamilyTimeRpcClient,
    private val pairedPeersStore: PairedPeersStore,
) : ParentTimeSource {

    override suspend fun fetchParentEpochMs(): Long? {
        val parentPeerId = pairedPeersStore.devices.value.firstOrNull()?.pcPeerId
        if (parentPeerId.isNullOrEmpty()) {
            Timber.d("[FamilyTime] no paired parent peer; time unsynced")
            return null
        }
        return rpcClient.fetchParentEpochMs(parentPeerId)
    }
}
