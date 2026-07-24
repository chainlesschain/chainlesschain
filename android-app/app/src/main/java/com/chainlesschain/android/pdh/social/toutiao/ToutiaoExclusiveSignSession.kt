package com.chainlesschain.android.pdh.social.toutiao

import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

class ToutiaoSignSessionUnavailableException(
    message: String = "Toutiao signing bridge warm-up failed",
) : IllegalStateException(message)

/**
 * Pure-Kotlin lifecycle coordinator kept separate from WebView code so its
 * ordering and cancellation guarantees can be covered by JVM tests.
 */
internal class ToutiaoExclusiveSignSession {
    private val sessionMutex = Mutex()

    suspend fun <T> run(
        warmUp: suspend () -> Boolean,
        shutdown: suspend () -> Unit,
        block: suspend () -> T,
    ): T = sessionMutex.withLock {
        try {
            if (!warmUp()) throw ToutiaoSignSessionUnavailableException()
            block()
        } finally {
            withContext(NonCancellable) {
                shutdown()
            }
        }
    }
}
