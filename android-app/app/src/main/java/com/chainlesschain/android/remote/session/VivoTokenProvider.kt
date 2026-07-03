package com.chainlesschain.android.remote.session

import android.content.Context

/**
 * Sources the device's vivo push regId for Remote Session push wake-ups.
 *
 * Mirrors [FcmTokenProvider]: uses reflection so the app compiles and runs
 * WITHOUT the vivo Push SDK (a manual AAR, not on Maven — see
 * [com.chainlesschain.android.push.vendor.VivoPushService]). When the SDK is
 * absent, or push has not been turned on yet (getRegId() returns ""), [getToken]
 * yields null and the host falls back to relay / local notifications — no crash,
 * no hard dependency. Injectable so the resolution can be faked in tests.
 *
 * Unlike FCM's static singleton, vivo's PushClient is Context-bound, so a
 * Context is required to reflect PushClient.getInstance(context).getRegId().
 */
class VivoTokenProvider(
    private val context: Context,
    private val fetcher: (suspend () -> String?)? = null,
) : RemoteSessionPushTokenProvider {

    override val provider: String get() = PROVIDER

    /** Best-effort regId fetch; any failure (SDK absent, not registered) → null. */
    override suspend fun getToken(): String? =
        runCatching { (fetcher ?: { fetchViaReflection(context) })() }
            .getOrNull()
            ?.takeIf { it.isNotBlank() }

    companion object {
        /** Provider tag stored alongside the token and echoed to the host. */
        const val PROVIDER = "vivo"

        private fun fetchViaReflection(context: Context): String? {
            val clazz = try {
                Class.forName("com.vivo.push.PushClient")
            } catch (_: ReflectiveOperationException) {
                return null // vivo Push SDK not on the classpath.
            }
            val instance = clazz
                .getMethod("getInstance", Context::class.java)
                .invoke(null, context) ?: return null
            // getRegId() returns "" until push has been turned on.
            return clazz.getMethod("getRegId").invoke(instance) as? String
        }
    }
}
