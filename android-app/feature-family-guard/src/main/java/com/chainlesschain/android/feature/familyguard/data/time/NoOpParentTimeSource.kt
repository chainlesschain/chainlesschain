package com.chainlesschain.android.feature.familyguard.data.time

import com.chainlesschain.android.feature.familyguard.domain.time.ParentTimeSource
import javax.inject.Inject
import javax.inject.Singleton

/**
 * [ParentTimeSource] 默认 no-op (FAMILY-60): 总返 null (家长端不可达) → TimeAuthority
 * 保持 NEVER_SYNCED。真实 P2P 拉取 (family.time.* envelope) 由 :app 层适配器覆盖本绑定
 * (family-guard 库不依赖 :core-p2p 传输; 同 TelemetryOutbox / GuardianAnomalyNotifier seam)。
 */
@Singleton
class NoOpParentTimeSource @Inject constructor() : ParentTimeSource {
    override suspend fun fetchParentEpochMs(): Long? = null
}
