package com.chainlesschain.android.remote.session

import android.content.Context

/**
 * Sources the device's Xiaomi (MIUI) push regId for Remote Session push wake-ups.
 *
 * Mirrors [FcmTokenProvider] / [VivoTokenProvider] / [OppoTokenProvider]: uses
 * reflection so the app compiles and runs WITHOUT the Xiaomi Push SDK (MiPush, a
 * manual AAR — see
 * [com.chainlesschain.android.push.vendor.XiaomiPushService]). Like vivo (and
 * unlike OPPO's no-arg static), `MiPushClient.getRegId(context)` is a static
 * method that takes a Context, so a Context is required. When the SDK is absent,
 * or registration has not completed yet, [getToken] returns null and the host
 * falls back to relay / local notifications — no crash, no hard dependency.
 * Injectable so the resolution can be faked in tests.
 */
class XiaomiTokenProvider(
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
        const val PROVIDER = "xiaomi"

        private fun fetchViaReflection(context: Context): String? {
            val clazz = try {
                Class.forName("com.xiaomi.mipush.sdk.MiPushClient")
            } catch (_: ReflectiveOperationException) {
                return null // Xiaomi MiPush SDK not on the classpath.
            }
            // getRegId(Context) is static and returns null until registration lands.
            return clazz.getMethod("getRegId", Context::class.java)
                .invoke(null, context) as? String
        }
    }
}
