package com.chainlesschain.android.feature.project.model

import com.chainlesschain.android.core.database.entity.TaskEntity
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * [TaskMapper] 单测：TaskEntity（DB）↔ Task（UI）映射，此前无直测。
 * 重点：往返字段保真（枚举↔字符串、labels/steps JSON）、未知枚举名回落、损坏 JSON 韧性（DB 脏数据不崩）。
 */
class TaskMapperTest {

    @Test
    fun `Task to Entity to Task round-trips all fields including labels and steps`() {
        val task = Task(
            id = "t1",
            userId = "u1",
            projectId = "p1",
            title = "Title",
            description = "desc",
            status = TaskStatus.IN_PROGRESS,
            priority = TaskPriority.HIGH,
            assignedTo = "a1",
            labels = listOf("urgent", "home"),
            dueDate = 1000L,
            reminderAt = 900L,
            estimateHours = 2.5f,
            actualHours = 1.5f,
            steps = listOf(
                TodoStep(id = "s1", content = "step1", isCompleted = true, completedAt = 500L),
                TodoStep(id = "s2", content = "step2"),
            ),
            createdAt = 100L,
            updatedAt = 200L,
            completedAt = null,
        )

        val roundTripped = TaskMapper.toTask(TaskMapper.toEntity(task))
        assertEquals(task, roundTripped) // data class 等值含所有构造字段（含 steps，回归 fix 前会丢失）
    }

    @Test
    fun `empty labels and steps round-trip to empty lists not null`() {
        val task = Task(id = "t2", userId = "u", title = "t") // labels/steps 默认空
        val entity = TaskMapper.toEntity(task)
        // 空集合序列化为 null 存库
        assertEquals(null, entity.labels)
        assertEquals(null, entity.steps)
        val back = TaskMapper.toTask(entity)
        assertEquals(emptyList<String>(), back.labels)
        assertEquals(emptyList<TodoStep>(), back.steps)
        assertEquals(task, back)
    }

    @Test
    fun `toTask maps status and priority strings and labels json`() {
        val entity = TaskEntity(
            id = "1", userId = "u", title = "t",
            status = "completed", priority = "urgent",
            labels = """["x","y"]""",
        )
        val task = TaskMapper.toTask(entity)
        assertEquals(TaskStatus.COMPLETED, task.status)
        assertEquals(TaskPriority.URGENT, task.priority)
        assertEquals(listOf("x", "y"), task.labels)
    }

    @Test
    fun `toTask falls back to PENDING and MEDIUM on unknown enum strings`() {
        val entity = TaskEntity(id = "2", userId = "u", title = "t", status = "bogus", priority = "bogus")
        val task = TaskMapper.toTask(entity)
        assertEquals(TaskStatus.PENDING, task.status)
        assertEquals(TaskPriority.MEDIUM, task.priority)
    }

    @Test
    fun `toTask survives malformed labels and steps JSON returning empty lists`() {
        val entity = TaskEntity(
            id = "3", userId = "u", title = "t",
            labels = "not valid json [",
            steps = "also bad {",
        )
        val task = TaskMapper.toTask(entity)
        assertEquals(emptyList<String>(), task.labels)
        assertEquals(emptyList<TodoStep>(), task.steps)
    }

    @Test
    fun `batch list conversions round-trip`() {
        val tasks = listOf(
            Task(id = "a", userId = "u", title = "A", createdAt = 1L, updatedAt = 1L),
            Task(id = "b", userId = "u", title = "B", createdAt = 2L, updatedAt = 2L),
        )
        val back = TaskMapper.toTaskList(TaskMapper.toEntityList(tasks))
        assertEquals(tasks, back)
    }
}
