package com.chainlesschain.android.remote.p2p

import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class CompositeCommandRouterTest {

    private lateinit var syncRouter: SyncCommandRouter
    private lateinit var approvalRouter: ApprovalCommandRouter
    private lateinit var composite: CompositeCommandRouter

    @Before
    fun setup() {
        syncRouter = mockk(relaxed = true)
        approvalRouter = mockk(relaxed = true)
        composite = CompositeCommandRouter(syncRouter, approvalRouter)
    }

    @Test
    fun `sync_push routes to SyncCommandRouter`() = runTest {
        coEvery { syncRouter.route("sync.push", any()) } returns mapOf("ok" to true)

        val result = composite.route("sync.push", mapOf("item" to "x"))

        assertEquals(mapOf("ok" to true), result)
        coVerify(exactly = 1) { syncRouter.route("sync.push", mapOf("item" to "x")) }
        coVerify(exactly = 0) { approvalRouter.route(any(), any()) }
    }

    @Test
    fun `sync_pull routes to SyncCommandRouter`() = runTest {
        coEvery { syncRouter.route("sync.pull", any()) } returns emptyMap<String, Any>()

        composite.route("sync.pull", emptyMap())

        coVerify(exactly = 1) { syncRouter.route("sync.pull", emptyMap()) }
    }

    @Test
    fun `approval_request routes to ApprovalCommandRouter`() = runTest {
        coEvery { approvalRouter.route("approval.request", any()) } returns
            mapOf("requestId" to "apr-1", "approved" to true)

        val result = composite.route(
            "approval.request",
            mapOf("requestId" to "apr-1", "payloadDescription" to "X"),
        ) as Map<*, *>

        assertEquals("apr-1", result["requestId"])
        assertEquals(true, result["approved"])
        coVerify(exactly = 1) { approvalRouter.route("approval.request", any()) }
        coVerify(exactly = 0) { syncRouter.route(any(), any()) }
    }

    @Test
    fun `unknown namespace throws IllegalArgumentException`() = runTest {
        val ex = assertThrows(IllegalArgumentException::class.java) {
            kotlinx.coroutines.runBlocking {
                composite.route("system.shutdown", emptyMap())
            }
        }
        assertTrue(ex.message!!.contains("Method namespace not handled"))
    }

    @Test
    fun `empty method name throws Method namespace not handled`() = runTest {
        val ex = assertThrows(IllegalArgumentException::class.java) {
            kotlinx.coroutines.runBlocking {
                composite.route("", emptyMap())
            }
        }
        assertTrue(ex.message!!.contains("Method namespace not handled"))
    }

    @Test
    fun `sync prefix without dot does not match sync namespace`() = runTest {
        // "sync_push" 不带点，不应被认作 sync.* 命名空间
        val ex = assertThrows(IllegalArgumentException::class.java) {
            kotlinx.coroutines.runBlocking {
                composite.route("syncpush", emptyMap())
            }
        }
        assertTrue(ex.message!!.contains("Method namespace not handled"))
    }
}
