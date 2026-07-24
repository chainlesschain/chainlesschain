package com.chainlesschain.android.pdh.social

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

class ExclusiveWebSignSessionTest {

    @Test
    fun `concurrent sessions serialize awaited cleanup before next warmup`() = runTest {
        val session = ExclusiveWebSignSession("test")
        val events = Collections.synchronizedList(mutableListOf<String>())
        val firstEntered = CompletableDeferred<Unit>()
        val releaseFirst = CompletableDeferred<Unit>()
        val secondWarmed = CompletableDeferred<Unit>()

        val first = async {
            session.run(
                requireWarmUp = true,
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
                requireWarmUp = true,
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
    fun `required warm failure and cancellation clean up before successor`() = runTest {
        val session = ExclusiveWebSignSession("test")
        val events = Collections.synchronizedList(mutableListOf<String>())

        val failure = assertFailsWith<WebSignSessionUnavailableException> {
            session.run(
                requireWarmUp = true,
                warmUp = {
                    events += "warm-failed"
                    false
                },
                shutdown = { events += "shutdown-failed" },
            ) {
                events += "unreachable"
            }
        }
        assertEquals("test", failure.platform)

        val entered = CompletableDeferred<Unit>()
        val never = CompletableDeferred<Unit>()
        val cancelled = launch {
            session.run(
                requireWarmUp = true,
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
                requireWarmUp = true,
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

    @Test
    fun `optional warm failure still runs fallback block under the session lock`() = runTest {
        val events = mutableListOf<String>()
        val result = ExclusiveWebSignSession("test").run(
            requireWarmUp = false,
            warmUp = {
                events += "warm"
                false
            },
            shutdown = { events += "shutdown" },
        ) {
            events += "fallback"
            7
        }

        assertEquals(7, result)
        assertEquals(listOf("warm", "fallback", "shutdown"), events)
    }
}
