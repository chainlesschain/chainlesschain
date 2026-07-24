package com.chainlesschain.android.pdh.social.toutiao

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Test
import java.util.Collections
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse

class ToutiaoExclusiveSignSessionTest {

    @Test
    fun `concurrent sessions serialize shutdown before the next warmup`() = runTest {
        val session = ToutiaoExclusiveSignSession()
        val events = Collections.synchronizedList(mutableListOf<String>())
        val firstEntered = CompletableDeferred<Unit>()
        val releaseFirst = CompletableDeferred<Unit>()
        val secondWarmed = CompletableDeferred<Unit>()

        val first = async {
            session.run(
                warmUp = {
                    events += "warm-1"
                    true
                },
                shutdown = { events += "shutdown-1" },
            ) {
                events += "block-1-start"
                firstEntered.complete(Unit)
                releaseFirst.await()
                events += "block-1-end"
            }
        }
        firstEntered.await()
        val second = async {
            session.run(
                warmUp = {
                    events += "warm-2"
                    secondWarmed.complete(Unit)
                    true
                },
                shutdown = { events += "shutdown-2" },
            ) {
                events += "block-2"
            }
        }

        runCurrent()
        assertFalse(secondWarmed.isCompleted)
        releaseFirst.complete(Unit)
        awaitAll(first, second)

        assertEquals(
            listOf(
                "warm-1",
                "block-1-start",
                "block-1-end",
                "shutdown-1",
                "warm-2",
                "block-2",
                "shutdown-2",
            ),
            events,
        )
    }

    @Test
    fun `failed warmup and cancellation clean up before a queued session starts`() = runTest {
        val session = ToutiaoExclusiveSignSession()
        val events = Collections.synchronizedList(mutableListOf<String>())

        assertFailsWith<ToutiaoSignSessionUnavailableException> {
            session.run(
                warmUp = {
                    events += "warm-failed"
                    false
                },
                shutdown = { events += "shutdown-failed" },
            ) {
                events += "unreachable"
            }
        }

        val entered = CompletableDeferred<Unit>()
        val never = CompletableDeferred<Unit>()
        val cancelled = launch {
            session.run(
                warmUp = {
                    events += "warm-cancelled"
                    true
                },
                shutdown = { events += "shutdown-cancelled" },
            ) {
                entered.complete(Unit)
                never.await()
            }
        }
        entered.await()
        val successor = async {
            session.run(
                warmUp = {
                    events += "warm-successor"
                    true
                },
                shutdown = { events += "shutdown-successor" },
            ) {
                events += "block-successor"
            }
        }
        cancelled.cancelAndJoin()
        successor.await()

        assertEquals(
            listOf(
                "warm-failed",
                "shutdown-failed",
                "warm-cancelled",
                "shutdown-cancelled",
                "warm-successor",
                "block-successor",
                "shutdown-successor",
            ),
            events,
        )
    }
}
