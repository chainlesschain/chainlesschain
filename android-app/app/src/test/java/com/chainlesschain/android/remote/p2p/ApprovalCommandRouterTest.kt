package com.chainlesschain.android.remote.p2p

import com.chainlesschain.android.sign.ApprovalGate
import com.chainlesschain.android.sign.ApprovalResult
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ApprovalCommandRouterTest {

    /** 测试用 ApprovalGate：手动 scripted 决策，不弹 dialog。 */
    private class FakeGate(
        var nextResult: ApprovalResult = ApprovalResult(approved = true, deniedReason = null),
    ) : ApprovalGate {
        var lastDescription: String? = null
        var lastHash: String? = null
        var lastRequireBio: Boolean? = null

        override suspend fun requestApproval(
            payloadDescription: String,
            payloadHash: String,
            requireBiometric: Boolean,
        ): ApprovalResult {
            lastDescription = payloadDescription
            lastHash = payloadHash
            lastRequireBio = requireBiometric
            return nextResult
        }
    }

    @Test
    fun `approval_request with full payload routes to gate and returns approved`() = runTest {
        val gate = FakeGate(nextResult = ApprovalResult(approved = true))
        val router = ApprovalCommandRouter(gate)

        val result = router.route(
            method = "approval.request",
            params = mapOf(
                "requestId" to "apr-001",
                "peerId" to "desktop-pc",
                "method" to "marketplace.purchase",
                "params" to mapOf("amount" to 25),
                "payloadDescription" to "购买 X 商品，金额 25",
                "payloadHash" to "a".repeat(64),
                "requireBiometric" to true,
            ),
        ) as Map<*, *>

        assertEquals("apr-001", result["requestId"])
        assertEquals(true, result["approved"])
        assertNull(result["deniedReason"])
        assertEquals("购买 X 商品，金额 25", gate.lastDescription)
        assertEquals("a".repeat(64), gate.lastHash)
        assertEquals(true, gate.lastRequireBio)
    }

    @Test
    fun `approval_request denied by user passes deniedReason through`() = runTest {
        val gate = FakeGate(nextResult = ApprovalResult(approved = false, deniedReason = "user-declined"))
        val router = ApprovalCommandRouter(gate)

        val result = router.route(
            method = "approval.request",
            params = mapOf(
                "requestId" to "apr-002",
                "payloadDescription" to "X",
                "payloadHash" to "b".repeat(64),
            ),
        ) as Map<*, *>

        assertEquals(false, result["approved"])
        assertEquals("user-declined", result["deniedReason"])
    }

    @Test
    fun `approval_request with no payloadDescription falls back to method`() = runTest {
        val gate = FakeGate()
        val router = ApprovalCommandRouter(gate)

        router.route(
            method = "approval.request",
            params = mapOf(
                "requestId" to "apr-003",
                "method" to "cowork.spawnTeam",
            ),
        )

        assertEquals("cowork.spawnTeam", gate.lastDescription)
    }

    @Test
    fun `approval_request without requestId throws IllegalArgumentException`() = runTest {
        val gate = FakeGate()
        val router = ApprovalCommandRouter(gate)

        val ex = assertThrows(IllegalArgumentException::class.java) {
            kotlinx.coroutines.runBlocking {
                router.route(
                    method = "approval.request",
                    params = mapOf("method" to "x"),
                )
            }
        }
        assertTrue(ex.message!!.contains("requestId"))
    }

    @Test
    fun `approval_request without description and method throws`() = runTest {
        val gate = FakeGate()
        val router = ApprovalCommandRouter(gate)

        val ex = assertThrows(IllegalArgumentException::class.java) {
            kotlinx.coroutines.runBlocking {
                router.route(
                    method = "approval.request",
                    params = mapOf("requestId" to "apr-004"),
                )
            }
        }
        assertTrue(ex.message!!.contains("payloadDescription") || ex.message!!.contains("method"))
    }

    @Test
    fun `approval_request defaults requireBiometric to true when missing`() = runTest {
        val gate = FakeGate()
        val router = ApprovalCommandRouter(gate)

        router.route(
            method = "approval.request",
            params = mapOf(
                "requestId" to "apr-005",
                "payloadDescription" to "X",
            ),
        )

        assertEquals(true, gate.lastRequireBio)
    }

    @Test
    fun `approval_request defaults payloadHash to empty string when missing`() = runTest {
        val gate = FakeGate()
        val router = ApprovalCommandRouter(gate)

        router.route(
            method = "approval.request",
            params = mapOf(
                "requestId" to "apr-006",
                "payloadDescription" to "X",
            ),
        )

        assertEquals("", gate.lastHash)
    }

    @Test
    fun `unknown approval_method throws IllegalArgumentException`() = runTest {
        val router = ApprovalCommandRouter(FakeGate())

        val ex = assertThrows(IllegalArgumentException::class.java) {
            kotlinx.coroutines.runBlocking {
                router.route("approval.cancel", emptyMap())
            }
        }
        assertTrue(ex.message!!.contains("Unknown approval method"))
    }

    @Test
    fun `non_approval_namespace throws Method namespace not handled`() = runTest {
        val router = ApprovalCommandRouter(FakeGate())

        val ex = assertThrows(IllegalArgumentException::class.java) {
            kotlinx.coroutines.runBlocking {
                router.route("sync.push", emptyMap())
            }
        }
        assertTrue(ex.message!!.contains("Method namespace not handled"))
    }

    @Test
    fun `suspend semantics — gate suspension does not block other coroutines`() = runTest {
        // 一个会真正 suspend 的 gate：等待外部 signal
        val signal = kotlinx.coroutines.CompletableDeferred<ApprovalResult>()
        val gate = object : ApprovalGate {
            override suspend fun requestApproval(
                payloadDescription: String,
                payloadHash: String,
                requireBiometric: Boolean,
            ): ApprovalResult = signal.await()
        }
        val router = ApprovalCommandRouter(gate)

        val deferred = async {
            router.route(
                method = "approval.request",
                params = mapOf(
                    "requestId" to "apr-suspend",
                    "payloadDescription" to "X",
                ),
            )
        }
        advanceUntilIdle()
        assertFalse("router should suspend until gate responds", deferred.isCompleted)

        signal.complete(ApprovalResult(approved = true))
        val result = deferred.await() as Map<*, *>
        assertEquals("apr-suspend", result["requestId"])
        assertEquals(true, result["approved"])
    }
}
