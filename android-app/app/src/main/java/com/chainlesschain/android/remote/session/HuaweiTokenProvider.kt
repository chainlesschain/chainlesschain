package com.chainlesschain.android.remote.session

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Sources the device's Huawei (HMS) push token for Remote Session push wake-ups.
 *
 * Mirrors the other providers but with two HMS-specific twists:
 *  1. `HmsInstanceId.getToken(appId, "HCM")` is a **blocking network call** that
 *     must not run on the main thread — the reflection path is offloaded to
 *     [Dispatchers.IO].
 *  2. The appId is read from `AGConnectServicesConfig` (`client/app_id`), which
 *     comes from agconnect-services.json; without it (Huawei not configured)
 *     resolution yields null.
 *
 * Uses reflection so the app compiles and runs WITHOUT the HMS SDK
 * (`com.huawei.hms:push` — see
 * [com.chainlesschain.android.push.vendor.HuaweiPushService]). Absent SDK /
 * config, or a getToken that throws (ApiException, no network) → null, and the
 * host falls back to relay / local notifications. Injectable for tests.
 */
class HuaweiTokenProvider(
    private val context: Context,
    private val fetcher: (suspend () -> String?)? = null,
) : RemoteSessionPushTokenProvider {

    override val provider: String get() = PROVIDER

    /** Best-effort token fetch; any failure (SDK/config absent, network) → null. */
    override suspend fun getToken(): String? =
        runCatching {
            val fetch = fetcher
            if (fetch != null) fetch()
            else withContext(Dispatchers.IO) { fetchViaReflection(context) }
        }.getOrNull()?.takeIf { it.isNotBlank() }

    companion object {
        /** Provider tag stored alongside the token and echoed to the host. */
        const val PROVIDER = "huawei"

        /** Blocking — call off the main thread. */
        private fun fetchViaReflection(context: Context): String? {
            val configClass = try {
                Class.forName("com.huawei.agconnect.config.AGConnectServicesConfig")
            } catch (_: ReflectiveOperationException) {
                return null // HMS / AGConnect not on the classpath.
            }
            val config = configClass.getMethod("fromContext", Context::class.java)
                .invoke(null, context)
            val appId = configClass.getMethod("getString", String::class.java)
                .invoke(config, "client/app_id") as? String
            if (appId.isNullOrBlank()) return null // agconnect-services.json missing.
            val hmsClass = Class.forName("com.huawei.hms.aaid.HmsInstanceId")
            val instance = hmsClass.getMethod("getInstance", Context::class.java)
                .invoke(null, context)
            // getToken(appId, "HCM") blocks; may return "" when delivered async.
            return hmsClass.getMethod("getToken", String::class.java, String::class.java)
                .invoke(instance, appId, "HCM") as? String
        }
    }
}
