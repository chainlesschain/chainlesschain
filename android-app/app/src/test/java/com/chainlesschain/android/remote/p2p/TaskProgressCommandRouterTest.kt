package com.chainlesschain.android.remote.p2p

import com.chainlesschain.android.task.LongRunningTask
import com.chainlesschain.android.task.LongTaskRegistry
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runTest
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.test.fail

@OptIn(ExperimentalCoroutinesApi::class)
class TaskProgressCommandRouterTest {

    private fun newRouter(): Pair<TaskProgressCommandRouter, LongTaskRegistry> {
        val reg = LongTaskRegistry()
        return TaskProgressCommandRouter(reg) to reg
    }

    @Test
    fun `task_update creates new task in registry`() = runTest {
        val (router, reg) = newRouter()
        val r = router.route("task.update", mapOf(
            "id" to "task-1",
            "title" to "Crawl docs",
            "progress" to 0.25,
        )) as Map<*, *>
        assertEquals(true, r["ok"])
        val t = reg.get("task-1")!!
        assertEquals("Crawl docs", t.title)
        assertEquals(0.25f, t.progress)
        assertEquals(LongRunningTask.State.Running, t.state)
    }

    @Test
    fun `task_update missing id throws`() = runTest {
        val (router, _) = newRouter()
        try {
            router.route("task.update", mapOf("title" to "x"))
            fail("expected throw")
        } catch (_: IllegalArgumentException) { /* ok */ }
    }

    @Test
    fun `task_update missing title throws`() = runTest {
        val (router, _) = newRouter()
        try {
            router.route("task.update", mapOf("id" to "t-1"))
            fail("expected throw")
        } catch (_: IllegalArgumentException) { /* ok */ }
    }

    @Test
    fun `task_update parses progress from Number`() = runTest {
        val (router, reg) = newRouter()
        router.route("task.update", mapOf("id" to "t", "title" to "t", "progress" to 0.7))
        assertEquals(0.7f, reg.get("t")!!.progress)
    }

    @Test
    fun `task_update parses progress from String`() = runTest {
        val (router, reg) = newRouter()
        router.route("task.update", mapOf("id" to "t", "title" to "t", "progress" to "0.42"))
        assertEquals(0.42f, reg.get("t")!!.progress)
    }

    @Test
    fun `task_update bad progress string falls back to null`() = runTest {
        val (router, reg) = newRouter()
        router.route("task.update", mapOf("id" to "t", "title" to "t", "progress" to "abc"))
        assertNull(reg.get("t")!!.progress)
    }

    @Test
    fun `task_update clamps progress to 0_1 range`() = runTest {
        val (router, reg) = newRouter()
        router.route("task.update", mapOf("id" to "a", "title" to "a", "progress" to -1.0))
        assertEquals(0f, reg.get("a")!!.progress)
        router.route("task.update", mapOf("id" to "b", "title" to "b", "progress" to 2.5))
        assertEquals(1f, reg.get("b")!!.progress)
    }

    @Test
    fun `task_update parses state string case-insensitively`() = runTest {
        val (router, reg) = newRouter()
        router.route("task.update", mapOf("id" to "t1", "title" to "t1", "state" to "RUNNING"))
        assertEquals(LongRunningTask.State.Running, reg.get("t1")!!.state)
        router.route("task.update", mapOf("id" to "t2", "title" to "t2", "state" to "completed"))
        assertEquals(LongRunningTask.State.Completed, reg.get("t2")!!.state)
        router.route("task.update", mapOf("id" to "t3", "title" to "t3", "state" to "Canceled"))
        assertEquals(LongRunningTask.State.Cancelled, reg.get("t3")!!.state)
    }

    @Test
    fun `task_update preserves createdAt across subsequent updates`() = runTest {
        val (router, reg) = newRouter()
        router.route("task.update", mapOf("id" to "t", "title" to "t"))
        val firstCreatedAt = reg.get("t")!!.createdAt
        Thread.sleep(5)  // small wait so updatedAt differs
        router.route("task.update", mapOf("id" to "t", "title" to "t", "progress" to 0.5))
        val second = reg.get("t")!!
        assertEquals(firstCreatedAt, second.createdAt)
        assertTrue(second.updatedAt >= firstCreatedAt)
    }

    @Test
    fun `task_complete marks Completed and returns found=true`() = runTest {
        val (router, reg) = newRouter()
        router.route("task.update", mapOf("id" to "t", "title" to "t"))
        val r = router.route("task.complete", mapOf("id" to "t")) as Map<*, *>
        assertEquals(true, r["ok"])
        assertEquals(true, r["found"])
        assertEquals(LongRunningTask.State.Completed, reg.get("t")!!.state)
    }

    @Test
    fun `task_complete unknown id returns found=false`() = runTest {
        val (router, _) = newRouter()
        val r = router.route("task.complete", mapOf("id" to "ghost")) as Map<*, *>
        assertEquals(false, r["found"])
    }

    @Test
    fun `task_fail sets errorMessage`() = runTest {
        val (router, reg) = newRouter()
        router.route("task.update", mapOf("id" to "t", "title" to "t"))
        router.route("task.fail", mapOf("id" to "t", "errorMessage" to "ENOENT"))
        val t = reg.get("t")!!
        assertEquals(LongRunningTask.State.Failed, t.state)
        assertEquals("ENOENT", t.errorMessage)
    }

    @Test
    fun `task_fail without errorMessage uses default`() = runTest {
        val (router, reg) = newRouter()
        router.route("task.update", mapOf("id" to "t", "title" to "t"))
        router.route("task.fail", mapOf("id" to "t"))
        assertEquals("unknown error", reg.get("t")!!.errorMessage)
    }

    @Test
    fun `task_cancel sets state and reason`() = runTest {
        val (router, reg) = newRouter()
        router.route("task.update", mapOf("id" to "t", "title" to "t"))
        router.route("task.cancel", mapOf("id" to "t", "reason" to "user"))
        assertEquals(LongRunningTask.State.Cancelled, reg.get("t")!!.state)
        assertEquals("user", reg.get("t")!!.errorMessage)
    }

    @Test
    fun `task_remove deletes entry and returns found=true`() = runTest {
        val (router, reg) = newRouter()
        router.route("task.update", mapOf("id" to "t", "title" to "t"))
        val r = router.route("task.remove", mapOf("id" to "t")) as Map<*, *>
        assertEquals(true, r["found"])
        assertNull(reg.get("t"))
    }

    @Test
    fun `unknown task method throws IllegalArgumentException`() = runTest {
        val (router, _) = newRouter()
        try {
            router.route("task.bogus", mapOf("id" to "t"))
            fail("expected throw")
        } catch (_: IllegalArgumentException) { /* ok */ }
    }

    @Test
    fun `non-task namespace throws Method namespace not handled`() = runTest {
        val (router, _) = newRouter()
        try {
            router.route("sync.pull", mapOf<String, Any>())
            fail("expected throw")
        } catch (e: IllegalArgumentException) {
            assertTrue(e.message!!.contains("Method namespace not handled"))
        }
    }

    @Test
    fun `category param defaults to generic`() = runTest {
        val (router, reg) = newRouter()
        router.route("task.update", mapOf("id" to "t", "title" to "t"))
        assertEquals("generic", reg.get("t")!!.category)
    }

    @Test
    fun `category param overrides default`() = runTest {
        val (router, reg) = newRouter()
        router.route("task.update", mapOf("id" to "t", "title" to "t", "category" to "cowork"))
        assertEquals("cowork", reg.get("t")!!.category)
    }
}
