package com.chainlesschain.android.core.p2p.pairing

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.take
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.junit.Test
import kotlin.test.assertEquals

/**
 * PairingMessageBus 单元测试 — Android v1.1 W3.3b (issue #19)。
 */
@OptIn(ExperimentalCoroutinesApi::class)
class PairingMessageBusTest {

    @Test
    fun `emit publishes confirmation to subscriber`() = runTest {
        val bus = DefaultPairingMessageBus()
        val subscriberStarted = kotlinx.coroutines.CompletableDeferred<Unit>()

        val collected = async {
            subscriberStarted.complete(Unit)
            bus.confirmations.first()
        }

        subscriberStarted.await()
        // 让 collect 真正起来（cold start of SharedFlow)
        runCurrent()
        bus.emit(
            PairingConfirmation(
                pairingCode = "123456",
                pcPeerId = "pc-1",
                deviceInfo = mapOf("name" to "host-1"),
                timestamp = 100L,
            )
        )

        val result = collected.await()
        assertEquals("123456", result.pairingCode)
        assertEquals("pc-1", result.pcPeerId)
        assertEquals("host-1", result.deviceInfo?.get("name"))
        assertEquals(100L, result.timestamp)
    }

    @Test
    fun `multiple emits broadcast to all subscribers`() = runTest {
        val bus = DefaultPairingMessageBus()
        val received = mutableListOf<PairingConfirmation>()

        val job = launch {
            bus.confirmations.take(2).toList(received)
        }
        runCurrent()

        bus.emit(PairingConfirmation("aaaaaa", "pc-1", null, 1L))
        bus.emit(PairingConfirmation("bbbbbb", "pc-2", null, 2L))
        job.join()

        assertEquals(2, received.size)
        assertEquals("aaaaaa", received[0].pairingCode)
        assertEquals("bbbbbb", received[1].pairingCode)
    }

    @Test
    fun `confirmations is hot SharedFlow (replay=0) — late subscriber misses earlier emits`() = runTest {
        val bus = DefaultPairingMessageBus()

        bus.emit(PairingConfirmation("早到的", "pc-x", null, 1L))
        runCurrent()

        // 后订阅 — 不会拿到 replay
        val received = mutableListOf<PairingConfirmation>()
        val job = launch {
            bus.confirmations.take(1).toList(received)
        }
        runCurrent()

        bus.emit(PairingConfirmation("后到的", "pc-y", null, 2L))
        job.join()

        assertEquals(1, received.size)
        assertEquals("后到的", received[0].pairingCode)
    }
}

// runCurrent helper for test scope
@OptIn(ExperimentalCoroutinesApi::class)
private fun kotlinx.coroutines.test.TestScope.runCurrent() {
    testScheduler.runCurrent()
}
