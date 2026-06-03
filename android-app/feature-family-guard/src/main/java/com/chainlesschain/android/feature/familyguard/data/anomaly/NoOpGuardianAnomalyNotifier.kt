package com.chainlesschain.android.feature.familyguard.data.anomaly

import com.chainlesschain.android.feature.familyguard.domain.anomaly.DetectedAnomaly
import com.chainlesschain.android.feature.familyguard.domain.anomaly.GuardianAnomalyNotifier
import javax.inject.Inject
import javax.inject.Singleton
import timber.log.Timber

/**
 * [GuardianAnomalyNotifier] 默认 no-op (FAMILY-27). 仅记日志; 真实推送 (PushVendor +
 * 上行高优) 由 :app 层适配器在 FAMILY-61 覆盖本绑定。无 sync 宿主可保留此 fallback。
 */
@Singleton
class NoOpGuardianAnomalyNotifier @Inject constructor() : GuardianAnomalyNotifier {

    override suspend fun notifyGuardians(anomaly: DetectedAnomaly) {
        Timber.i(
            "anomaly detected (no-op notifier): type=%s severity=%s key=%s",
            anomaly.type.storageValue,
            anomaly.severity.storageValue,
            anomaly.dedupKey,
        )
    }
}
