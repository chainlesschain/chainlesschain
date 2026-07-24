package com.chainlesschain.android.pdh.social

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

class WebSignSessionUnavailableException(
    val platform: String,
    cause: Throwable? = null,
) : IllegalStateException("$platform signing bridge warm-up failed", cause)

/**
 * Pure-Kotlin lifecycle coordinator for singleton WebView signers.
 *
 * The mutex covers warm-up, every signed source request, and awaited cleanup.
 * Cleanup is non-cancellable and finishes before the next session can warm a
 * fresh WebView, so a delayed destroy from one caller cannot tear down another
 * caller's signing state.
 */
internal class ExclusiveWebSignSession(
    private val platform: String,
) {
    private val sessionMutex = Mutex()

    suspend fun <T> run(
        requireWarmUp: Boolean,
        warmUp: suspend () -> Boolean,
        shutdown: suspend () -> Unit,
        block: suspend () -> T,
    ): T = sessionMutex.withLock {
        try {
            val warmed = try {
                warmUp()
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (failure: Throwable) {
                if (requireWarmUp) {
                    throw WebSignSessionUnavailableException(platform, failure)
                }
                false
            }
            if (!warmed && requireWarmUp) {
                throw WebSignSessionUnavailableException(platform)
            }
            block()
        } finally {
            withContext(NonCancellable) {
                shutdown()
            }
        }
    }
}
