package com.chainlesschain.android.remote.session

/**
 * Sources the device's OPPO (HeyTap) push regId for Remote Session push wake-ups.
 *
 * Mirrors [FcmTokenProvider] / [VivoTokenProvider]: uses reflection so the app
 * compiles and runs WITHOUT the OPPO Push SDK (`com.heytap.msp:push`, an
 * OPPO-Maven artifact — see
 * [com.chainlesschain.android.push.vendor.OppoPushService]). Unlike vivo's
 * Context-bound client, `HeytapPushManager.getRegisterID()` is static, so no
 * Context is needed. When the SDK is absent, or registration has not completed
 * yet, [getToken] returns null and the host falls back to relay / local
 * notifications — no crash, no hard dependency. Injectable so the resolution can
 * be faked in tests.
 */
class OppoTokenProvider(
    private val fetcher: (suspend () -> String?)? = null,
) : RemoteSessionPushTokenProvider {

    override val provider: String get() = PROVIDER

    /** Best-effort regId fetch; any failure (SDK absent, not registered) → null. */
    override suspend fun getToken(): String? =
        runCatching { (fetcher ?: { fetchViaReflection() })() }
            .getOrNull()
            ?.takeIf { it.isNotBlank() }

    companion object {
        /** Provider tag stored alongside the token and echoed to the host. */
        const val PROVIDER = "oppo"

        private fun fetchViaReflection(): String? {
            val clazz = try {
                Class.forName("com.heytap.msp.push.HeytapPushManager")
            } catch (_: ReflectiveOperationException) {
                return null // OPPO Push SDK not on the classpath.
            }
            // getRegisterID() is static and returns "" until registration lands.
            return clazz.getMethod("getRegisterID").invoke(null) as? String
        }
    }
}
