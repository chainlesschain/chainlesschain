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
    private lateinit var taskRouter: TaskProgressCommandRouter
    private lateinit var e2eeRouter: E2EEHandshakeCommandRouter
    private lateinit var composite: CompositeCommandRouter

    @Before
    fun setup() {
        syncRouter = mockk(relaxed = true)
        approvalRouter = mockk(relaxed = true)
        taskRouter = mockk(relaxed = true)
        e2eeRouter = mockk(relaxed = true)
        composite = CompositeCommandRouter(syncRouter, approvalRouter, taskRouter, e2eeRouter)
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

    @Test
    fun `task_update routes to TaskProgressCommandRouter`() = runTest {
        coEvery { taskRouter.route("task.update", any()) } returns mapOf("ok" to true)

        val result = composite.route("task.update", mapOf("id" to "t", "title" to "x"))

        assertEquals(mapOf("ok" to true), result)
        coVerify(exactly = 1) { taskRouter.route("task.update", any()) }
        coVerify(exactly = 0) { syncRouter.route(any(), any()) }
        coVerify(exactly = 0) { approvalRouter.route(any(), any()) }
    }

    @Test
    fun `task_complete routes to TaskProgressCommandRouter`() = runTest {
        coEvery { taskRouter.route("task.complete", any()) } returns mapOf("ok" to true, "found" to true)

        composite.route("task.complete", mapOf("id" to "t"))

        coVerify(exactly = 1) { taskRouter.route("task.complete", mapOf("id" to "t")) }
    }

    @Test
    fun `e2ee_getBundle routes to E2EEHandshakeCommandRouter`() = runTest {
        coEvery { e2eeRouter.route("e2ee.getBundle", any()) } returns mapOf("bundle" to "{}")

        val result = composite.route("e2ee.getBundle", mapOf("fromDid" to "did:key:zA"))

        assertEquals(mapOf("bundle" to "{}"), result)
        coVerify(exactly = 1) { e2eeRouter.route("e2ee.getBundle", mapOf("fromDid" to "did:key:zA")) }
        coVerify(exactly = 0) { syncRouter.route(any(), any()) }
    }

    @Test
    fun `e2ee_init routes to E2EEHandshakeCommandRouter`() = runTest {
        coEvery { e2eeRouter.route("e2ee.init", any()) } returns mapOf("ok" to true)

        composite.route("e2ee.init", mapOf("fromDid" to "did:key:zA", "initialMessage" to "{}"))

        coVerify(exactly = 1) { e2eeRouter.route("e2ee.init", any()) }
    }
}
