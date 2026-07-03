package com.chainlesschain.android.remote.session

/**
 * A source of a vendor push token for Remote Session wake-ups. Each provider
 * knows its own [provider] tag (echoed to the host in pair.join) and resolves a
 * token best-effort — returning null when its SDK is absent or unregistered.
 */
interface RemoteSessionPushTokenProvider {
    /** Tag stored alongside the token and sent to the host (e.g. "fcm", "vivo"). */
    val provider: String

    /** Best-effort token fetch; any failure or absent SDK → null. */
    suspend fun getToken(): String?
}

/**
 * Resolves the first available push token across an ordered provider list.
 *
 * Order matters: put the device's most-likely channel first (FCM for overseas /
 * Pixel / Samsung, a domestic vendor for Xiaomi/Huawei/OPPO/vivo ROMs). The
 * first provider that yields a non-blank token wins; a provider that throws or
 * returns null is skipped so one absent SDK never blocks the others. Returns
 * null only when EVERY provider is unavailable, in which case the host falls
 * back to relay + local notifications. Kept plain (no Android types) so it is
 * fully unit-testable.
 */
class RemoteSessionPushTokenResolver(
    private val providers: List<RemoteSessionPushTokenProvider>,
) {
    data class Resolved(val token: String, val provider: String)

    suspend fun resolve(): Resolved? {
        for (source in providers) {
            val token = runCatching { source.getToken() }
                .getOrNull()
                ?.takeIf { it.isNotBlank() }
            if (token != null) return Resolved(token, source.provider)
        }
        return null
    }
}
