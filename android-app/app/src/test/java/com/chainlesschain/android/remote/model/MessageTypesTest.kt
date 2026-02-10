package com.chainlesschain.android.remote.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Unit tests for MessageTypes
 */
class MessageTypesTest {

    // ===== ContextMode Tests =====

    @Test
    fun `ContextMode has three values`() {
        val values = ContextMode.entries
        assertEquals(3, values.size)
        assertTrue(values.contains(ContextMode.PROJECT))
        assertTrue(values.contains(ContextMode.FILE))
        assertTrue(values.contains(ContextMode.GLOBAL))
    }

    // ===== FileReference Tests =====

    @Test
    fun `FileReference fromPath parses correctly`() {
        val ref = FileReference.fromPath("src/main/App.kt")

        assertEquals("src/main/App.kt", ref.path)
        assertEquals("App.kt", ref.name)
        assertEquals("kt", ref.extension)
    }

    @Test
    fun `FileReference fromPath handles Windows paths`() {
        val ref = FileReference.fromPath("src\\main\\App.kt")

        assertEquals("App.kt", ref.name)
        assertEquals("kt", ref.extension)
    }

    @Test
    fun `FileReference fromPath handles no extension`() {
        val ref = FileReference.fromPath("Dockerfile")

        assertEquals("Dockerfile", ref.name)
        assertNull(ref.extension)
    }

    // ===== TaskPlan Tests =====

    @Test
    fun `TaskPlan creates with default values`() {
        val plan = TaskPlan(
            title = "Test Plan",
            summary = "A test plan",
            tasks = emptyList()
        )

        assertNotNull(plan.id)
        assertEquals("Test Plan", plan.title)
        assertEquals("A test plan", plan.summary)
        assertTrue(plan.tasks.isEmpty())
        assertNull(plan.estimatedDuration)
        assertTrue(plan.outputs.isEmpty())
        assertTrue(plan.createdAt > 0)
    }

    @Test
    fun `TaskItem has correct default status`() {
        val task = TaskItem(
            id = 1,
            name = "Task 1",
            description = "Do something",
            action = "execute",
            output = "result"
        )

        assertEquals(TaskStatus.PENDING, task.status)
        assertEquals(0, task.progress)
        assertNull(task.error)
    }

    // ===== TaskStatus Tests =====

    @Test
    fun `TaskStatus has all expected values`() {
        val values = TaskStatus.entries
        assertEquals(5, values.size)
        assertTrue(values.contains(TaskStatus.PENDING))
        assertTrue(values.contains(TaskStatus.IN_PROGRESS))
        assertTrue(values.contains(TaskStatus.COMPLETED))
        assertTrue(values.contains(TaskStatus.FAILED))
        assertTrue(values.contains(TaskStatus.SKIPPED))
    }

    // ===== PlanningState Tests =====

    @Test
    fun `PlanningState has all expected values`() {
        val values = PlanningState.entries
        assertEquals(8, values.size)
        assertTrue(values.contains(PlanningState.IDLE))
        assertTrue(values.contains(PlanningState.ANALYZING))
        assertTrue(values.contains(PlanningState.INTERVIEWING))
        assertTrue(values.contains(PlanningState.PLANNING))
        assertTrue(values.contains(PlanningState.CONFIRMING))
        assertTrue(values.contains(PlanningState.EXECUTING))
        assertTrue(values.contains(PlanningState.COMPLETED))
        assertTrue(values.contains(PlanningState.CANCELLED))
    }

    // ===== ThinkingStage Tests =====

    @Test
    fun `ThinkingStage has all expected values`() {
        val values = ThinkingStage.entries
        assertEquals(5, values.size)
        assertTrue(values.contains(ThinkingStage.ANALYZING))
        assertTrue(values.contains(ThinkingStage.PLANNING))
        assertTrue(values.contains(ThinkingStage.GENERATING))
        assertTrue(values.contains(ThinkingStage.REVIEWING))
        assertTrue(values.contains(ThinkingStage.EXECUTING))
    }

    // ===== ProgressInfo Tests =====

    @Test
    fun `ProgressInfo calculates percentage correctly`() {
        val info = ProgressInfo(step = 3, total = 10, message = "Processing")

        assertEquals(30, info.percentage)
    }

    @Test
    fun `ProgressInfo handles zero total`() {
        val info = ProgressInfo(step = 0, total = 0, message = "Empty")

        assertEquals(0, info.percentage)
    }

    // ===== ChatMessageType Tests =====

    @Test
    fun `ChatMessageType User is singleton`() {
        val user1 = ChatMessageType.User
        val user2 = ChatMessageType.User

        assertEquals(user1, user2)
    }

    @Test
    fun `ChatMessageType IntentRecognition stores data`() {
        val intentType = ChatMessageType.IntentRecognition(
            intent = "Create a new project",
            confidence = 0.95f
        )

        assertEquals("Create a new project", intentType.intent)
        assertEquals(0.95f, intentType.confidence, 0.001f)
    }

    @Test
    fun `ChatMessageType TaskPlanType stores plan and status`() {
        val plan = TaskPlan(
            title = "Test",
            summary = "Summary",
            tasks = listOf(
                TaskItem(1, "Task 1", "Desc", "action", "output")
            )
        )

        val planType = ChatMessageType.TaskPlanType(
            plan = plan,
            status = PlanningState.CONFIRMING
        )

        assertEquals("Test", planType.plan.title)
        assertEquals(PlanningState.CONFIRMING, planType.status)
    }

    @Test
    fun `ChatMessageType Progress stores info`() {
        val info = ProgressInfo(5, 10, "Halfway there")
        val progressType = ChatMessageType.Progress(info)

        assertEquals(5, progressType.info.step)
        assertEquals(10, progressType.info.total)
        assertEquals(50, progressType.info.percentage)
    }

    @Test
    fun `ChatMessageType Error has defaults`() {
        val error = ChatMessageType.Error(message = "Something went wrong")

        assertEquals("Something went wrong", error.message)
        assertNull(error.code)
        assertTrue(error.recoverable)
    }

    // ===== EnhancedChatMessage Tests =====

    @Test
    fun `EnhancedChatMessage creates with defaults`() {
        val message = EnhancedChatMessage(
            role = MessageRole.USER,
            content = "Hello"
        )

        assertNotNull(message.id)
        assertEquals(MessageRole.USER, message.role)
        assertEquals("Hello", message.content)
        assertTrue(message.timestamp > 0)
        assertNull(message.model)
        assertNull(message.tokenUsage)
        assertEquals(ChatMessageType.User, message.messageType)
        assertEquals(ContextMode.PROJECT, message.contextMode)
        assertTrue(message.referencedFiles.isEmpty())
        assertNull(message.taskPlan)
        assertNull(message.thinkingStage)
        assertFalse(message.isStreaming)
        assertNull(message.error)
        assertNull(message.parentMessageId)
        assertTrue(message.metadata.isEmpty())
    }

    @Test
    fun `EnhancedChatMessage auto-assigns messageType based on role`() {
        val userMessage = EnhancedChatMessage(
            role = MessageRole.USER,
            content = "Hi"
        )
        assertEquals(ChatMessageType.User, userMessage.messageType)

        val assistantMessage = EnhancedChatMessage(
            role = MessageRole.ASSISTANT,
            content = "Hello"
        )
        assertEquals(ChatMessageType.Assistant, assistantMessage.messageType)

        val systemMessage = EnhancedChatMessage(
            role = MessageRole.SYSTEM,
            content = "System"
        )
        assertEquals(ChatMessageType.System, systemMessage.messageType)
    }

    // ===== CreationProgress Tests =====

    @Test
    fun `CreationProgress creates with steps`() {
        val steps = listOf(
            CreationStep(1, "Init", "Initialize project", StepStatus.COMPLETED),
            CreationStep(2, "Setup", "Setup dependencies", StepStatus.IN_PROGRESS),
            CreationStep(3, "Build", "Build project", StepStatus.PENDING)
        )

        val progress = CreationProgress(steps = steps, currentStep = 1)

        assertEquals(3, progress.steps.size)
        assertEquals(1, progress.currentStep)
        assertFalse(progress.isComplete)
        assertNull(progress.error)
    }

    @Test
    fun `StepStatus has all values`() {
        val values = StepStatus.entries
        assertEquals(4, values.size)
        assertTrue(values.contains(StepStatus.PENDING))
        assertTrue(values.contains(StepStatus.IN_PROGRESS))
        assertTrue(values.contains(StepStatus.COMPLETED))
        assertTrue(values.contains(StepStatus.FAILED))
    }

    // ===== IntentUnderstanding Tests =====

    @Test
    fun `IntentUnderstanding creates with defaults`() {
        val intent = IntentUnderstanding(
            intent = "Create project",
            confidence = 0.9f
        )

        assertEquals("Create project", intent.intent)
        assertEquals(0.9f, intent.confidence, 0.001f)
        assertTrue(intent.entities.isEmpty())
        assertTrue(intent.suggestedActions.isEmpty())
    }

    @Test
    fun `IntentUnderstanding can have entities and actions`() {
        val intent = IntentUnderstanding(
            intent = "Create Kotlin project",
            confidence = 0.95f,
            entities = mapOf("language" to "kotlin", "type" to "library"),
            suggestedActions = listOf("init", "setup", "build")
        )

        assertEquals(2, intent.entities.size)
        assertEquals("kotlin", intent.entities["language"])
        assertEquals(3, intent.suggestedActions.size)
    }

    // ===== ConfirmStatus Tests =====

    @Test
    fun `ConfirmStatus has all values`() {
        val values = ConfirmStatus.entries
        assertEquals(4, values.size)
        assertTrue(values.contains(ConfirmStatus.PENDING))
        assertTrue(values.contains(ConfirmStatus.CONFIRMED))
        assertTrue(values.contains(ConfirmStatus.REJECTED))
        assertTrue(values.contains(ConfirmStatus.MODIFIED))
    }

    // ===== InterviewQuestion Tests =====

    @Test
    fun `InterviewQuestion creates correctly`() {
        val question = InterviewQuestion(
            id = 1,
            question = "What language?",
            options = listOf("Kotlin", "Java", "Python"),
            required = true,
            answer = null
        )

        assertEquals(1, question.id)
        assertEquals("What language?", question.question)
        assertEquals(3, question.options?.size)
        assertTrue(question.required)
        assertNull(question.answer)
    }

    @Test
    fun `InterviewQuestion can have answer`() {
        val question = InterviewQuestion(
            id = 1,
            question = "What language?",
            options = listOf("Kotlin", "Java"),
            required = true,
            answer = "Kotlin"
        )

        assertEquals("Kotlin", question.answer)
    }
}
