package com.chainlesschain.android.presentation.aistudy

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class StudyTaskContextTest {

    private val ctx = InMemoryStudyTaskContext()

    @Test
    fun `only in_progress task becomes active`() {
        ctx.setActiveTask(StudyTask(id = "a", title = "作业", status = StudyTaskStatus.ASSIGNED))
        assertNull(ctx.activeTask.value)

        ctx.setActiveTask(StudyTask(id = "b", title = "作业", status = StudyTaskStatus.IN_PROGRESS))
        assertEquals("b", ctx.activeTask.value?.id)
    }

    @Test
    fun `null clears active task`() {
        ctx.setActiveTask(StudyTask(id = "b", title = "x", status = StudyTaskStatus.IN_PROGRESS))
        ctx.setActiveTask(null)
        assertNull(ctx.activeTask.value)
    }

    @Test
    fun `call log is partitioned by task id`() {
        ctx.logAiCall(TaskAiCall("t1", 1L, AiCallKind.NORMAL))
        ctx.logAiCall(TaskAiCall("t1", 2L, AiCallKind.ANSWER_SEEKING))
        ctx.logAiCall(TaskAiCall("t2", 3L, AiCallKind.NORMAL))

        assertEquals(2, ctx.callLogFor("t1").size)
        assertEquals(1, ctx.callLogFor("t2").size)
        assertTrue(ctx.callLogFor("none").isEmpty())
    }
}
