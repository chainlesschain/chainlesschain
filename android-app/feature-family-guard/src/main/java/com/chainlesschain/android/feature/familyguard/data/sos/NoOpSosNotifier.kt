package com.chainlesschain.android.feature.familyguard.data.sos

import com.chainlesschain.android.feature.familyguard.domain.sos.SosNotifier
import javax.inject.Inject
import javax.inject.Singleton
import timber.log.Timber

/**
 * [SosNotifier] 默认 no-op (FAMILY-44). 仅记日志; 真实 P2P/PushVendor 推送由 :app 层
 * 适配器在 FAMILY-43/46 覆盖本绑定。
 */
@Singleton
class NoOpSosNotifier @Inject constructor() : SosNotifier {

    override suspend fun notifyFalseAlarm(
        sosEventId: String,
        childDid: String,
        familyGroupId: String,
        reason: String,
    ) {
        Timber.i("SOS false-alarm (no-op notifier): id=%s child=%s reason=%s", sosEventId, childDid, reason)
    }
}
