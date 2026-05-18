package com.chainlesschain.android.task

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class LongTaskRegistryTest {

    private fun task(
        id: String,
        state: LongRunningTask.State = LongRunningTask.State.Running,
        progress: Float? = 0.5f,
        now: Long = System.currentTimeMillis(),
    ) = LongRunningTask(
        id = id,
        title = "t-$id",
        progress = progress,
        state = state,
        createdAt = now,
        updatedAt = now,
    )

    @Test
    fun `initial registry is empty`() {
        assertTrue(LongTaskRegistry().tasks.value.isEmpty())
    }

    @Test
    fun `upsert new task adds to list`() {
        val reg = LongTaskRegistry()
        reg.upsert(task("a"))
        assertEquals(1, reg.tasks.value.size)
        assertNotNull(reg.get("a"))
    }

    @Test
    fun `upsert existing task replaces in place`() {
        val reg = LongTaskRegistry()
        reg.upsert(task("a", progress = 0.1f))
        reg.upsert(task("a", progress = 0.7f))
        assertEquals(1, reg.tasks.value.size)
        assertEquals(0.7f, reg.get("a")!!.progress)
    }

    @Test
    fun `upsert clamps progress to 0_to_1 range`() {
        val reg = LongTaskRegistry()
        reg.upsert(task("a", progress = -0.5f))
        assertEquals(0f, reg.get("a")!!.progress)
        reg.upsert(task("b", progress = 1.5f))
        assertEquals(1f, reg.get("b")!!.progress)
    }

    @Test
    fun `upsert with null progress is preserved`() {
        val reg = LongTaskRegistry()
        reg.upsert(task("a", progress = null))
        assertNull(reg.get("a")!!.progress)
    }

    @Test
    fun `markCompleted transitions and sets progress 1`() {
        val reg = LongTaskRegistry()
        reg.upsert(task("a", progress = 0.3f))
        val ok = reg.markCompleted("a")
        assertTrue(ok)
        val t = reg.get("a")!!
        assertEquals(LongRunningTask.State.Completed, t.state)
        assertEquals(1f, t.progress)
    }

    @Test
    fun `markCompleted with unknown id returns false`() {
        assertFalse(LongTaskRegistry().markCompleted("nope"))
    }

    @Test
    fun `markFailed sets state and errorMessage`() {
        val reg = LongTaskRegistry()
        reg.upsert(task("a"))
        reg.markFailed("a", "kaboom")
        val t = reg.get("a")!!
        assertEquals(LongRunningTask.State.Failed, t.state)
        assertEquals("kaboom", t.errorMessage)
    }

    @Test
    fun `markCancelled sets state and reason`() {
        val reg = LongTaskRegistry()
        reg.upsert(task("a"))
        reg.markCancelled("a", "user cancelled")
        assertEquals(LongRunningTask.State.Cancelled, reg.get("a")!!.state)
        assertEquals("user cancelled", reg.get("a")!!.errorMessage)
    }

    @Test
    fun `remove deletes existing entry and returns true`() {
        val reg = LongTaskRegistry()
        reg.upsert(task("a"))
        assertTrue(reg.remove("a"))
        assertNull(reg.get("a"))
    }

    @Test
    fun `remove returns false on unknown id`() {
        assertFalse(LongTaskRegistry().remove("nope"))
    }

    @Test
    fun `clearTerminal removes only terminal tasks`() {
        val reg = LongTaskRegistry()
        reg.upsert(task("running", state = LongRunningTask.State.Running))
        reg.upsert(task("completed", state = LongRunningTask.State.Completed))
        reg.upsert(task("failed", state = LongRunningTask.State.Failed))
        reg.upsert(task("cancelled", state = LongRunningTask.State.Cancelled))
        val removed = reg.clearTerminal()
        assertEquals(3, removed)
        assertEquals(1, reg.tasks.value.size)
        assertEquals("running", reg.tasks.value.first().id)
    }

    @Test
    fun `clear empties everything`() {
        val reg = LongTaskRegistry()
        reg.upsert(task("a"))
        reg.upsert(task("b"))
        reg.clear()
        assertTrue(reg.tasks.value.isEmpty())
    }

    @Test
    fun `isTerminal true only for end states`() {
        assertFalse(task("a", state = LongRunningTask.State.Pending).isTerminal())
        assertFalse(task("a", state = LongRunningTask.State.Running).isTerminal())
        assertTrue(task("a", state = LongRunningTask.State.Completed).isTerminal())
        assertTrue(task("a", state = LongRunningTask.State.Failed).isTerminal())
        assertTrue(task("a", state = LongRunningTask.State.Cancelled).isTerminal())
    }

    @Test
    fun `MAX_TASKS cap drops oldest terminal first`() {
        val reg = LongTaskRegistry()
        // Fill to MAX_TASKS with mix of running/terminal
        val now = System.currentTimeMillis()
        for (i in 0 until LongTaskRegistry.MAX_TASKS) {
            val s = if (i % 3 == 0) LongRunningTask.State.Completed else LongRunningTask.State.Running
            reg.upsert(task("t$i", state = s, now = now + i))
        }
        assertEquals(LongTaskRegistry.MAX_TASKS, reg.tasks.value.size)
        // Add one more — should drop a terminal task
        reg.upsert(task("overflow", state = LongRunningTask.State.Running, now = now + 9999))
        assertEquals(LongTaskRegistry.MAX_TASKS, reg.tasks.value.size)
        assertNotNull(reg.get("overflow"))
    }
}
