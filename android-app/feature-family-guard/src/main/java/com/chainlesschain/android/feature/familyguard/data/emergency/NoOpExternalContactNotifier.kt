package com.chainlesschain.android.feature.familyguard.data.emergency

import com.chainlesschain.android.feature.familyguard.domain.emergency.ExternalContactNotifier
import javax.inject.Inject
import javax.inject.Singleton
import timber.log.Timber

/**
 * v0.1 stub (FAMILY-16) — 仅 Timber.i 日志, 不真发送。FAMILY-45 落 SMS / API 实装。
 */
@Singleton
class NoOpExternalContactNotifier @Inject constructor() : ExternalContactNotifier {

    override suspend fun notify(
        payload: ExternalContactNotifier.EmergencyNotification,
    ): Int {
        Timber.i(
            "ExternalContactNotifier STUB: trigger=%s reason=%s relId=%s",
            payload.triggerKind,
            payload.reason,
            payload.familyRelationshipId,
        )
        return 0
    }
}
