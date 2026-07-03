package com.chainlesschain.android.remote.session

import com.google.android.gms.tasks.Task
import kotlinx.coroutines.tasks.await

/**
 * Sources the device's FCM registration token for Remote Session push wake-ups.
 *
 * Uses reflection so the app compiles and runs WITHOUT the Firebase Messaging
 * SDK / google-services.json (matching AppInitializer's optional-Firebase
 * pattern for Crashlytics). When Firebase is unavailable it simply returns null,
 * and the host falls back to relay / local notifications — no crash, no hard
 * dependency. Injectable so the resolution can be faked in tests.
 */
class FcmTokenProvider(
    private val fetcher: (suspend () -> String?)? = null,
) {
    /** Best-effort token fetch; any failure (Firebase absent, network) → null. */
    suspend fun getToken(): String? =
        runCatching { (fetcher ?: ::fetchViaReflection)() }
            .getOrNull()
            ?.takeIf { it.isNotBlank() }

    companion object {
        /** Provider tag stored alongside the token and echoed to the host. */
        const val PROVIDER = "fcm"

        private suspend fun fetchViaReflection(): String? {
            val clazz = try {
                Class.forName("com.google.firebase.messaging.FirebaseMessaging")
            } catch (_: ReflectiveOperationException) {
                return null // Firebase Messaging not on the classpath.
            }
            val instance = clazz.getMethod("getInstance").invoke(null)
            val task = clazz.getMethod("getToken").invoke(instance) as? Task<*>
                ?: return null
            return task.await() as? String
        }
    }
}
