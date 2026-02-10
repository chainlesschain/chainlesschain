package com.chainlesschain.android.feature.ai.cowork

import com.chainlesschain.android.feature.ai.cowork.agent.*
import com.chainlesschain.android.feature.ai.cowork.team.*
import com.chainlesschain.android.feature.ai.cowork.task.*
import com.chainlesschain.android.feature.ai.cowork.sandbox.*
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import java.io.File

/**
 * CoworkSystem 单元测试
 *
 * 验证Agent管理、团队协作、任务调度、文件沙箱等功能
 */
class CoworkSystemTest {

    // ===== AgentStatus Tests =====

    @Test
    fun `Agent状态转换正确`() {
        // Given
        val validTransitions = mapOf(
            AgentStatus.IDLE to setOf(AgentStatus.WORKING, AgentStatus.PAUSED),
            AgentStatus.WORKING to setOf(AgentStatus.COMPLETED, AgentStatus.FAILED, AgentStatus.WAITING, AgentStatus.PAUSED),
            AgentStatus.WAITING to setOf(AgentStatus.WORKING, AgentStatus.FAILED),
            AgentStatus.PAUSED to setOf(AgentStatus.IDLE, AgentStatus.WORKING),
            AgentStatus.COMPLETED to setOf(AgentStatus.IDLE),
            AgentStatus.FAILED to setOf(AgentStatus.IDLE)
        )

        // Then
        validTransitions.forEach { (from, toSet) ->
            toSet.forEach { to ->
                assertTrue("$from -> $to 应该有效", from.canTransitionTo(to))
            }
        }
    }

    @Test
    fun `Agent无效状态转换应失败`() {
        // Then
        assertFalse("IDLE不能直接到COMPLETED", AgentStatus.IDLE.canTransitionTo(AgentStatus.COMPLETED))
        assertFalse("COMPLETED不能到WORKING", AgentStatus.COMPLETED.canTransitionTo(AgentStatus.WORKING))
    }

    // ===== AgentCapability Tests =====

    @Test
    fun `Agent能力列表完整`() {
        // Then
        val capabilities = AgentCapability.values()
        assertTrue("应有多个能力", capabilities.size >= 10)

        // 验证关键能力存在
        assertTrue("应有代码生成能力", capabilities.any { it.name == "CODE_GENERATION" })
        assertTrue("应有文件访问能力", capabilities.any { it.name == "FILE_ACCESS" })
        assertTrue("应有网络请求能力", capabilities.any { it.name == "NETWORK_REQUEST" })
    }

    // ===== CoworkAgent Tests =====

    @Test
    fun `创建Agent应成功`() {
        // When
        val agent = CoworkAgent(
            id = "agent-1",
            name = "Test Agent",
            capabilities = setOf(AgentCapability.CODE_GENERATION, AgentCapability.FILE_ACCESS)
        )

        // Then
        assertEquals("ID应正确", "agent-1", agent.id)
        assertEquals("名称应正确", "Test Agent", agent.name)
        assertEquals("初始状态应为IDLE", AgentStatus.IDLE, agent.status)
        assertEquals("应有2个能力", 2, agent.capabilities.size)
    }

    @Test
    fun `Agent状态更新应成功`() {
        // Given
        val agent = CoworkAgent(
            id = "agent-1",
            name = "Test Agent",
            capabilities = setOf(AgentCapability.CODE_GENERATION)
        )

        // When
        val updated = agent.copy(status = AgentStatus.WORKING, currentTaskId = "task-1")

        // Then
        assertEquals("状态应更新", AgentStatus.WORKING, updated.status)
        assertEquals("任务ID应更新", "task-1", updated.currentTaskId)
    }

    @Test
    fun `Agent能力检查应正确`() {
        // Given
        val agent = CoworkAgent(
            id = "agent-1",
            name = "Test Agent",
            capabilities = setOf(AgentCapability.CODE_GENERATION, AgentCapability.FILE_ACCESS)
        )

        // Then
        assertTrue("应有CODE_GENERATION", agent.hasCapability(AgentCapability.CODE_GENERATION))
        assertTrue("应有FILE_ACCESS", agent.hasCapability(AgentCapability.FILE_ACCESS))
        assertFalse("不应有NETWORK_REQUEST", agent.hasCapability(AgentCapability.NETWORK_REQUEST))
    }

    // ===== AgentPool Tests =====

    @Test
    fun `AgentPool注册Agent应成功`() {
        // Given
        val pool = AgentPool()
        val agent = CoworkAgent(
            id = "agent-1",
            name = "Test Agent",
            capabilities = setOf(AgentCapability.CODE_GENERATION)
        )

        // When
        pool.register(agent)

        // Then
        val retrieved = pool.getAgent("agent-1")
        assertNotNull("应找到Agent", retrieved)
        assertEquals("Agent应匹配", agent.id, retrieved?.id)
    }

    @Test
    fun `AgentPool按能力查找应正确`() {
        // Given
        val pool = AgentPool()
        pool.register(CoworkAgent("a1", "Agent 1", setOf(AgentCapability.CODE_GENERATION)))
        pool.register(CoworkAgent("a2", "Agent 2", setOf(AgentCapability.FILE_ACCESS)))
        pool.register(CoworkAgent("a3", "Agent 3", setOf(AgentCapability.CODE_GENERATION, AgentCapability.FILE_ACCESS)))

        // When
        val codeAgents = pool.findByCapability(AgentCapability.CODE_GENERATION)

        // Then
        assertEquals("应找到2个有代码生成能力的Agent", 2, codeAgents.size)
    }

    @Test
    fun `AgentPool分配任务应正确`() {
        // Given
        val pool = AgentPool()
        pool.register(CoworkAgent("a1", "Agent 1", setOf(AgentCapability.CODE_GENERATION)))

        // When
        val assigned = pool.assignTask("a1", "task-1")

        // Then
        assertTrue("分配应成功", assigned)
        val agent = pool.getAgent("a1")
        assertEquals("状态应为WORKING", AgentStatus.WORKING, agent?.status)
        assertEquals("任务ID应设置", "task-1", agent?.currentTaskId)
    }

    @Test
    fun `AgentPool完成任务应正确`() {
        // Given
        val pool = AgentPool()
        pool.register(CoworkAgent("a1", "Agent 1", setOf(AgentCapability.CODE_GENERATION)))
        pool.assignTask("a1", "task-1")

        // When
        val completed = pool.completeTask("a1")

        // Then
        assertTrue("完成应成功", completed)
        val agent = pool.getAgent("a1")
        assertEquals("状态应为COMPLETED", AgentStatus.COMPLETED, agent?.status)
    }

    @Test
    fun `AgentPool统计应正确`() {
        // Given
        val pool = AgentPool()
        pool.register(CoworkAgent("a1", "Agent 1", setOf(AgentCapability.CODE_GENERATION)))
        pool.register(CoworkAgent("a2", "Agent 2", setOf(AgentCapability.FILE_ACCESS)))
        pool.assignTask("a1", "task-1")

        // When
        val stats = pool.getStatistics()

        // Then
        assertEquals("总数应为2", 2, stats.totalAgents)
        assertEquals("工作中应为1", 1, stats.workingAgents)
        assertEquals("空闲应为1", 1, stats.idleAgents)
    }

    // ===== TeamStatus Tests =====

    @Test
    fun `团队状态正确`() {
        // Then
        val statuses = TeamStatus.values()
        assertTrue("应有FORMING", statuses.any { it.name == "FORMING" })
        assertTrue("应有ACTIVE", statuses.any { it.name == "ACTIVE" })
        assertTrue("应有DISBANDED", statuses.any { it.name == "DISBANDED" })
    }

    // ===== CoworkTeam Tests =====

    @Test
    fun `创建团队应成功`() {
        // When
        val team = CoworkTeam(
            id = "team-1",
            name = "Dev Team",
            goal = "Build feature X"
        )

        // Then
        assertEquals("ID应正确", "team-1", team.id)
        assertEquals("名称应正确", "Dev Team", team.name)
        assertEquals("目标应正确", "Build feature X", team.goal)
        assertTrue("成员应为空", team.memberIds.isEmpty())
    }

    @Test
    fun `团队添加成员应成功`() {
        // Given
        val team = CoworkTeam(
            id = "team-1",
            name = "Dev Team",
            goal = "Build feature X"
        )

        // When
        val updated = team.addMember("agent-1")

        // Then
        assertEquals("应有1个成员", 1, updated.memberIds.size)
        assertTrue("应包含agent-1", updated.memberIds.contains("agent-1"))
    }

    @Test
    fun `团队移除成员应成功`() {
        // Given
        val team = CoworkTeam(
            id = "team-1",
            name = "Dev Team",
            goal = "Build feature X",
            memberIds = setOf("agent-1", "agent-2")
        )

        // When
        val updated = team.removeMember("agent-1")

        // Then
        assertEquals("应有1个成员", 1, updated.memberIds.size)
        assertFalse("不应包含agent-1", updated.memberIds.contains("agent-1"))
    }

    // ===== TaskStatus Tests =====

    @Test
    fun `任务状态正确`() {
        // Then
        val statuses = TaskStatus.values()
        assertTrue("应有PENDING", statuses.any { it.name == "PENDING" })
        assertTrue("应有RUNNING", statuses.any { it.name == "RUNNING" })
        assertTrue("应有COMPLETED", statuses.any { it.name == "COMPLETED" })
        assertTrue("应有FAILED", statuses.any { it.name == "FAILED" })
    }

    // ===== TaskCheckpoint Tests =====

    @Test
    fun `检查点创建应成功`() {
        // When
        val checkpoint = TaskCheckpoint(
            taskId = "task-1",
            step = 5,
            data = mapOf("progress" to 50, "lastFile" to "file.txt"),
            createdAt = System.currentTimeMillis()
        )

        // Then
        assertEquals("任务ID应正确", "task-1", checkpoint.taskId)
        assertEquals("步骤应正确", 5, checkpoint.step)
        assertEquals("进度应正确", 50, checkpoint.data["progress"])
    }

    // ===== LongRunningTask Tests =====

    @Test
    fun `长任务创建应成功`() {
        // When
        val task = LongRunningTask(
            id = "task-1",
            name = "Long Task",
            totalSteps = 100
        )

        // Then
        assertEquals("ID应正确", "task-1", task.id)
        assertEquals("名称应正确", "Long Task", task.name)
        assertEquals("总步骤应正确", 100, task.totalSteps)
        assertEquals("初始状态应为PENDING", TaskStatus.PENDING, task.status)
        assertEquals("当前步骤应为0", 0, task.currentStep)
    }

    @Test
    fun `长任务进度更新应正确`() {
        // Given
        val task = LongRunningTask(
            id = "task-1",
            name = "Long Task",
            totalSteps = 100
        )

        // When
        val updated = task.copy(currentStep = 50, status = TaskStatus.RUNNING)

        // Then
        assertEquals("当前步骤应更新", 50, updated.currentStep)
        assertEquals("进度应为50%", 50.0, updated.progressPercent, 0.01)
    }

    // ===== LongRunningTaskManager Tests =====

    @Test
    fun `TaskManager创建任务应成功`() {
        // Given
        val manager = LongRunningTaskManager()

        // When
        val task = manager.createTask("Test Task", 10)

        // Then
        assertNotNull("任务不应为空", task)
        assertEquals("名称应正确", "Test Task", task.name)
        assertEquals("总步骤应正确", 10, task.totalSteps)
    }

    @Test
    fun `TaskManager获取任务应正确`() {
        // Given
        val manager = LongRunningTaskManager()
        val created = manager.createTask("Test Task", 10)

        // When
        val retrieved = manager.getTask(created.id)

        // Then
        assertNotNull("应找到任务", retrieved)
        assertEquals("任务应匹配", created.id, retrieved?.id)
    }

    @Test
    fun `TaskManager更新进度应正确`() {
        // Given
        val manager = LongRunningTaskManager()
        val task = manager.createTask("Test Task", 10)

        // When
        manager.updateProgress(task.id, 5)

        // Then
        val updated = manager.getTask(task.id)
        assertEquals("进度应更新", 5, updated?.currentStep)
    }

    @Test
    fun `TaskManager保存检查点应正确`() {
        // Given
        val manager = LongRunningTaskManager()
        val task = manager.createTask("Test Task", 10)
        manager.updateProgress(task.id, 5)

        // When
        val checkpoint = manager.saveCheckpoint(task.id, mapOf("key" to "value"))

        // Then
        assertNotNull("检查点不应为空", checkpoint)
        assertEquals("步骤应正确", 5, checkpoint?.step)
    }

    @Test
    fun `TaskManager恢复检查点应正确`() {
        // Given
        val manager = LongRunningTaskManager()
        val task = manager.createTask("Test Task", 10)
        manager.updateProgress(task.id, 5)
        manager.saveCheckpoint(task.id, mapOf("key" to "value"))

        // When
        val restored = manager.restoreFromCheckpoint(task.id)

        // Then
        assertTrue("恢复应成功", restored)
    }

    // ===== SandboxPermission Tests =====

    @Test
    fun `沙箱权限级别正确`() {
        // Then
        assertTrue("NONE < READ", SandboxPermission.NONE.ordinal < SandboxPermission.READ.ordinal)
        assertTrue("READ < WRITE", SandboxPermission.READ.ordinal < SandboxPermission.WRITE.ordinal)
        assertTrue("WRITE < EXECUTE", SandboxPermission.EXECUTE.ordinal > SandboxPermission.READ.ordinal)
    }

    @Test
    fun `权限包含关系正确`() {
        // Then
        assertTrue("FULL应包含READ", SandboxPermission.FULL.includes(SandboxPermission.READ))
        assertTrue("FULL应包含WRITE", SandboxPermission.FULL.includes(SandboxPermission.WRITE))
        assertFalse("READ不应包含WRITE", SandboxPermission.READ.includes(SandboxPermission.WRITE))
    }

    // ===== AuditEntry Tests =====

    @Test
    fun `审计条目创建应成功`() {
        // When
        val entry = AuditEntry(
            agentId = "agent-1",
            path = "/path/to/file.txt",
            operation = "READ",
            permission = SandboxPermission.READ,
            allowed = true,
            timestamp = System.currentTimeMillis()
        )

        // Then
        assertEquals("AgentID应正确", "agent-1", entry.agentId)
        assertEquals("路径应正确", "/path/to/file.txt", entry.path)
        assertEquals("操作应正确", "READ", entry.operation)
        assertTrue("应允许", entry.allowed)
    }

    // ===== FileSandbox Tests =====

    @Test
    fun `FileSandbox授权应成功`() {
        // Given
        val sandbox = FileSandbox()

        // When
        sandbox.grantAccess("agent-1", "/workspace", SandboxPermission.READ)

        // Then
        val hasAccess = sandbox.checkAccess("agent-1", "/workspace/file.txt", SandboxPermission.READ)
        assertTrue("应有读权限", hasAccess)
    }

    @Test
    fun `FileSandbox应拒绝未授权访问`() {
        // Given
        val sandbox = FileSandbox()
        sandbox.grantAccess("agent-1", "/workspace", SandboxPermission.READ)

        // Then
        val hasWriteAccess = sandbox.checkAccess("agent-1", "/workspace/file.txt", SandboxPermission.WRITE)
        assertFalse("不应有写权限", hasWriteAccess)
    }

    @Test
    fun `FileSandbox应阻止敏感文件访问`() {
        // Given
        val sandbox = FileSandbox()
        sandbox.grantAccess("agent-1", "/", SandboxPermission.FULL)

        // Then
        val canAccessEnv = sandbox.checkAccess("agent-1", "/project/.env", SandboxPermission.READ)
        assertFalse("不应访问.env文件", canAccessEnv)

        val canAccessKey = sandbox.checkAccess("agent-1", "/keys/private.key", SandboxPermission.READ)
        assertFalse("不应访问私钥文件", canAccessKey)
    }

    @Test
    fun `FileSandbox撤销权限应成功`() {
        // Given
        val sandbox = FileSandbox()
        sandbox.grantAccess("agent-1", "/workspace", SandboxPermission.FULL)

        // When
        sandbox.revokeAccess("agent-1", "/workspace")

        // Then
        val hasAccess = sandbox.checkAccess("agent-1", "/workspace/file.txt", SandboxPermission.READ)
        assertFalse("权限应被撤销", hasAccess)
    }

    @Test
    fun `FileSandbox审计日志应记录`() {
        // Given
        val sandbox = FileSandbox()
        sandbox.grantAccess("agent-1", "/workspace", SandboxPermission.READ)

        // When
        sandbox.checkAccess("agent-1", "/workspace/file1.txt", SandboxPermission.READ)
        sandbox.checkAccess("agent-1", "/workspace/file2.txt", SandboxPermission.WRITE)

        // Then
        val logs = sandbox.getAuditLog("agent-1")
        assertEquals("应有2条审计记录", 2, logs.size)
    }

    // ===== CoworkError Tests =====

    @Test
    fun `错误类型创建正确`() {
        // Given/When
        val agentError = CoworkError.AgentError("agent-1", "Agent failed")
        val taskError = CoworkError.TaskError("task-1", "Task timeout")
        val permissionError = CoworkError.PermissionError("agent-1", "/path", SandboxPermission.WRITE)

        // Then
        assertTrue("AgentError消息应包含agent-1", agentError.message.contains("agent-1"))
        assertTrue("TaskError消息应包含task-1", taskError.message.contains("task-1"))
        assertTrue("PermissionError消息应包含path", permissionError.message.contains("/path"))
    }

    // ===== CoworkOrchestrator Tests =====

    @Test
    fun `Orchestrator初始化应成功`() {
        // Given
        val agentPool = AgentPool()
        val taskManager = LongRunningTaskManager()
        val sandbox = FileSandbox()

        // When
        val orchestrator = CoworkOrchestrator(agentPool, taskManager, sandbox)

        // Then
        assertNotNull("Orchestrator不应为空", orchestrator)
    }

    // ===== Performance Tests =====

    @Test
    fun `AgentPool大规模操作性能`() {
        // Given
        val pool = AgentPool()

        // When
        val startTime = System.nanoTime()
        repeat(1000) { i ->
            pool.register(CoworkAgent(
                id = "agent-$i",
                name = "Agent $i",
                capabilities = setOf(AgentCapability.CODE_GENERATION)
            ))
        }
        val duration = (System.nanoTime() - startTime) / 1_000_000.0

        // Then
        val stats = pool.getStatistics()
        assertEquals("应注册1000个Agent", 1000, stats.totalAgents)
        println("注册1000个Agent耗时: ${String.format("%.2f", duration)} ms")
        assertTrue("注册应在合理时间内完成", duration < 1000)
    }

    @Test
    fun `FileSandbox大量权限检查性能`() {
        // Given
        val sandbox = FileSandbox()
        sandbox.grantAccess("agent-1", "/workspace", SandboxPermission.READ)

        // When
        val startTime = System.nanoTime()
        repeat(10000) { i ->
            sandbox.checkAccess("agent-1", "/workspace/file$i.txt", SandboxPermission.READ)
        }
        val duration = (System.nanoTime() - startTime) / 1_000_000.0

        // Then
        println("10000次权限检查耗时: ${String.format("%.2f", duration)} ms")
        assertTrue("权限检查应在合理时间内完成", duration < 500)
    }
}
