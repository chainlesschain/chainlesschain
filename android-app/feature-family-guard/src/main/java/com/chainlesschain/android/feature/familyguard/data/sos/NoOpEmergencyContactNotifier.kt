package com.chainlesschain.android.feature.familyguard.data.sos

import com.chainlesschain.android.feature.familyguard.domain.sos.EmergencyContact
import com.chainlesschain.android.feature.familyguard.domain.sos.EmergencyContactNotifier
import javax.inject.Inject
import javax.inject.Singleton
import timber.log.Timber

/**
 * [EmergencyContactNotifier] 默认 no-op (FAMILY-45). 仅记日志; 真实 SMS 推送由 :app 层
 * 适配器接云厂商短信 API 覆盖本绑定。
 */
@Singleton
class NoOpEmergencyContactNotifier @Inject constructor() : EmergencyContactNotifier {

    override suspend fun notifyEmergencyContacts(
        sosEventId: String,
        childDid: String,
        contacts: List<EmergencyContact>,
        locationSnapshot: String?,
    ) {
        Timber.i(
            "SOS escalation (no-op notifier): id=%s child=%s contacts=%d hasLocation=%s",
            sosEventId,
            childDid,
            contacts.size,
            locationSnapshot != null,
        )
    }
}
