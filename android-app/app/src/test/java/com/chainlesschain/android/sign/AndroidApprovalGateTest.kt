package com.chainlesschain.android.sign

import app.cash.turbine.test
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class AndroidApprovalGateTest {

    private lateinit var gate: AndroidApprovalGate

    @Before
    fun setup() {
        gate = AndroidApprovalGate()
    }

    @Test
    fun `requestApproval suspends and resolves with approved=true`() = runTest {
        val deferred = async {
            gate.requestApproval(
                payloadDescription = "Test sign",
                payloadHash = "a".repeat(64),
                requireBiometric = false,
            )
        }
        advanceUntilIdle()

        // pending exposed via StateFlow
        val pending = gate.pendingRequest.value
        assertNotNull(pending)
        assertEquals("Test sign", pending!!.payloadDescription)

        gate.respondToApproval(pending.requestId, approved = true)
        val result = deferred.await()

        assertTrue(result.approved)
        assertNull(result.deniedReason)
        assertNull(gate.pendingRequest.value) // cleared
    }

    @Test
    fun `respondToApproval with approved=false sets deniedReason`() = runTest {
        val deferred = async {
            gate.requestApproval("Pay 100", "f".repeat(64), requireBiometric = true)
        }
        advanceUntilIdle()
        val pending = gate.pendingRequest.value!!

        gate.respondToApproval(pending.requestId, approved = false, deniedReason = "user-declined")
        val result = deferred.await()

        assertFalse(result.approved)
        assertEquals("user-declined", result.deniedReason)
    }

    @Test
    fun `denied with missing reason defaults to user-declined`() = runTest {
        val deferred = async {
            gate.requestApproval("X", "0".repeat(64), false)
        }
        advanceUntilIdle()
        val pending = gate.pendingRequest.value!!

        gate.respondToApproval(pending.requestId, approved = false, deniedReason = null)
        val result = deferred.await()

        assertEquals("user-declined", result.deniedReason)
    }

    @Test
    fun `respondToApproval with mismatched requestId is ignored`() = runTest {
        val deferred = async {
            gate.requestApproval("X", "0".repeat(64), false)
        }
        advanceUntilIdle()
        val original = gate.pendingRequest.value!!

        // Wrong ID → should return false + not resolve deferred
        val handled = gate.respondToApproval("apr-fake", approved = true)
        assertFalse(handled)
        assertFalse(deferred.isCompleted)

        // Correct ID still works
        gate.respondToApproval(original.requestId, approved = true)
        val result = deferred.await()
        assertTrue(result.approved)
    }

    @Test
    fun `cancelPending resolves pending as dismissed`() = runTest {
        val deferred = async {
            gate.requestApproval("X", "0".repeat(64), false)
        }
        advanceUntilIdle()
        assertNotNull(gate.pendingRequest.value)

        val cancelled = gate.cancelPending()
        val result = deferred.await()

        assertTrue(cancelled)
        assertFalse(result.approved)
        assertEquals("dismissed", result.deniedReason)
    }

    @Test
    fun `cancelPending with no pending returns false`() = runTest {
        val handled = gate.cancelPending()

        assertFalse(handled)
    }

    @Test
    fun `cancelPending with custom reason propagates`() = runTest {
        val deferred = async {
            gate.requestApproval("X", "0".repeat(64), false)
        }
        advanceUntilIdle()

        gate.cancelPending(reason = "screen-locked")
        val result = deferred.await()

        assertEquals("screen-locked", result.deniedReason)
    }

    @Test
    fun `pendingRequest StateFlow emits in sequence`() = runTest {
        gate.pendingRequest.test {
            assertNull(awaitItem()) // initial null

            val deferred = async {
                gate.requestApproval("X", "0".repeat(64), false)
            }

            val req = awaitItem()!! // pending emitted
            assertEquals("X", req.payloadDescription)

            gate.respondToApproval(req.requestId, approved = true)
            deferred.await()

            assertNull(awaitItem()) // back to null
        }
    }

    @Test
    fun `requestApproval propagates multisig state to PendingRequest`() = runTest {
        val ms = MultisigState(
            m = 2,
            n = 2,
            collected = 1,
            signerDids = listOf("did:cc:phone", "did:cc:desktop-ukey"),
            pendingSigners = listOf("did:cc:phone"),
        )
        val deferred = async {
            gate.requestApproval(
                category = ApprovalCategory.Marketplace,
                payloadDescription = "Buy item 25",
                payloadHash = "a".repeat(64),
                requireBiometric = true,
                multisig = ms,
            )
        }
        advanceUntilIdle()

        val pending = gate.pendingRequest.value!!
        assertEquals(ms, pending.multisig)
        assertEquals(ApprovalCategory.Marketplace, pending.category)

        gate.respondToApproval(pending.requestId, approved = true)
        val result = deferred.await()
        assertTrue(result.approved)
    }

    @Test
    fun `requestApproval without multisig leaves PendingRequest multisig null`() = runTest {
        val deferred = async {
            gate.requestApproval(
                category = ApprovalCategory.Sign,
                payloadDescription = "non-multisig sign",
                payloadHash = "b".repeat(64),
                requireBiometric = false,
            )
        }
        advanceUntilIdle()

        val pending = gate.pendingRequest.value!!
        assertNull(pending.multisig)
        gate.respondToApproval(pending.requestId, approved = true)
        deferred.await()
    }

    @Test
    fun `concurrent requestApproval calls serialize via mutex`() = runTest(StandardTestDispatcher()) {
        val deferred1 = async { gate.requestApproval("Op 1", "1".repeat(64), false) }
        val deferred2 = async { gate.requestApproval("Op 2", "2".repeat(64), false) }
        advanceUntilIdle()

        // Only first should be pending (mutex blocks second)
        val first = gate.pendingRequest.value
        assertNotNull(first)
        assertEquals("Op 1", first!!.payloadDescription)

        gate.respondToApproval(first.requestId, approved = true)
        advanceUntilIdle()

        // After first resolves, second becomes pending
        val second = gate.pendingRequest.value
        assertNotNull(second)
        assertEquals("Op 2", second!!.payloadDescription)

        gate.respondToApproval(second.requestId, approved = false, deniedReason = "second-decline")
        advanceUntilIdle()

        val r1 = deferred1.await()
        val r2 = deferred2.await()
        assertTrue(r1.approved)
        assertFalse(r2.approved)
        assertEquals("second-decline", r2.deniedReason)
    }
}
