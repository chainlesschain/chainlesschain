package com.chainlesschain.android.presentation.aistudy

import com.chainlesschain.android.feature.ai.domain.model.Message
import com.chainlesschain.android.feature.ai.domain.model.MessageRole
import com.chainlesschain.android.feature.ai.domain.model.StreamChunk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class AiStudyViewModelTest {

    private class FakeAiStudyLlm(var reply: String = "你好") : AiStudyLlm {
        var lastMessages: List<Message> = emptyList()
        override fun stream(messages: List<Message>): Flow<StreamChunk> {
            lastMessages = messages
            return flowOf(
                StreamChunk(content = reply, isDone = false),
                StreamChunk(content = "", isDone = true),
            )
        }
    }

    private class FakeStudyProfileStore(initial: StudyProfile = StudyProfile()) : StudyProfileStore {
        private val _profile = MutableStateFlow(initial)
        override val profile: StateFlow<StudyProfile> = _profile
        var updateCount = 0
        override fun update(profile: StudyProfile) {
            updateCount++
            _profile.value = profile
        }
    }

    private lateinit var llm: FakeAiStudyLlm
    private lateinit var store: FakeStudyProfileStore
    private lateinit var mistakeBook: InMemoryMistakeBook
    private lateinit var guardrailSink: InMemoryGuardrailEventSink
    private lateinit var taskContext: InMemoryStudyTaskContext

    @Before
    fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        llm = FakeAiStudyLlm()
        store = FakeStudyProfileStore(StudyProfile(grade = GradeLevel.P5, subject = Subject.MATH, nickname = "小明"))
        mistakeBook = InMemoryMistakeBook()
        guardrailSink = InMemoryGuardrailEventSink()
        taskContext = InMemoryStudyTaskContext()
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun vm() = AiStudyViewModel(
        llm, store, mistakeBook, KeywordGuardrailClassifier(), guardrailSink, taskContext,
    )

    @Test
    fun `send appends user then assistant to learning history`() = runTest {
        val viewModel = vm()
        viewModel.send("帮我讲讲分数")

        val msgs = viewModel.uiState.value.learningMessages
        assertEquals(2, msgs.size)
        assertEquals(MessageRole.USER, msgs[0].role)
        assertEquals("帮我讲讲分数", msgs[0].content)
        assertEquals(MessageRole.ASSISTANT, msgs[1].role)
        assertEquals("你好", msgs[1].content)
        assertTrue(viewModel.uiState.value.companionMessages.isEmpty())
        assertEquals(false, viewModel.uiState.value.isSending)
    }

    @Test
    fun `learning request is seeded with subject-aware system prompt`() = runTest {
        val viewModel = vm()
        viewModel.send("你好")

        val first = llm.lastMessages.first()
        assertEquals(MessageRole.SYSTEM, first.role)
        assertTrue(first.content.contains("数学"))
        assertTrue(first.content.contains("小明"))
    }

    @Test
    fun `companion tab keeps separate history and is not persisted to store`() = runTest {
        val viewModel = vm()
        viewModel.selectTab(AiStudyTab.COMPANION)
        viewModel.send("今天有点累")

        assertEquals(2, viewModel.uiState.value.companionMessages.size)
        assertTrue(viewModel.uiState.value.learningMessages.isEmpty())
        // 陪伴 system prompt = 护栏模板
        assertTrue(llm.lastMessages.first().content.contains("自伤"))
        // 聊天从不写入 profile store (内存态不落盘)
        assertEquals(0, store.updateCount)
    }

    @Test
    fun `updateProfile persists and reflects in state`() = runTest {
        val viewModel = vm()
        val next = StudyProfile(grade = GradeLevel.H1, subject = Subject.PHYSICS, nickname = "小红")
        viewModel.updateProfile(next)

        assertEquals(1, store.updateCount)
        assertEquals(GradeLevel.H1, viewModel.uiState.value.profile.grade)
        assertEquals(Subject.PHYSICS, viewModel.uiState.value.profile.subject)
    }

    @Test
    fun `llm error surfaces and stops sending`() = runTest {
        val erroringLlm = object : AiStudyLlm {
            override fun stream(messages: List<Message>): Flow<StreamChunk> =
                flowOf(StreamChunk(content = "", isDone = true, error = "未配置模型"))
        }
        val vm2 = AiStudyViewModel(
            erroringLlm, store, mistakeBook, KeywordGuardrailClassifier(), guardrailSink, taskContext,
        )
        vm2.send("hi")

        assertEquals("未配置模型", vm2.uiState.value.error)
        assertEquals(false, vm2.uiState.value.isSending)
        // 出错时只追加了 user 消息, 无 assistant
        assertEquals(1, vm2.uiState.value.learningMessages.size)
        assertNull(vm2.uiState.value.streamingText.ifEmpty { null })
    }

    @Test
    fun `learning request injects related mistake-book context (RAG)`() = runTest {
        val viewModel = vm()
        viewModel.addMistake(
            MistakeEntry(
                id = "m1", grade = GradeLevel.P5, subject = Subject.MATH,
                knowledgeNode = "分数加减", question = "1/2 + 1/3 = ?",
                wrongAnswer = "2/5", correctAnswer = "5/6", note = "", createdAt = 1L,
            ),
        )
        viewModel.send("老师，分数加减怎么通分")

        val system = llm.lastMessages.first()
        assertEquals(MessageRole.SYSTEM, system.role)
        assertTrue(system.content.contains("相关错题"))
        assertTrue(system.content.contains("5/6"))
    }

    @Test
    fun `unrelated query does not inject mistake context`() = runTest {
        val viewModel = vm()
        viewModel.addMistake(
            MistakeEntry(
                id = "m1", grade = GradeLevel.P5, subject = Subject.MATH,
                knowledgeNode = "分数加减", question = "1/2 + 1/3 = ?",
                wrongAnswer = "2/5", correctAnswer = "5/6", note = "", createdAt = 1L,
            ),
        )
        viewModel.send("讲讲三角形面积")

        assertTrue(!llm.lastMessages.first().content.contains("相关错题"))
    }

    @Test
    fun `companion guardrail hit is recorded as category plus time only`() = runTest {
        val viewModel = vm()
        viewModel.selectTab(AiStudyTab.COMPANION)
        viewModel.send("我最近总觉得活不下去")

        val findings = guardrailSink.findings.value
        assertEquals(1, findings.size)
        assertEquals(RiskCategory.SELF_HARM, findings[0].category)
        assertEquals(AiStudyTab.COMPANION, findings[0].tab)
        // 对话仍正常进行 (不阻断)
        assertEquals(2, viewModel.uiState.value.companionMessages.size)
    }

    @Test
    fun `generateReport aggregates turns mistakes and guardrail categories`() = runTest {
        val viewModel = vm()
        viewModel.send("帮我做这道作业题：第1题 第2题")
        viewModel.addMistake(
            MistakeEntry(
                id = "m1", grade = GradeLevel.P5, subject = Subject.MATH,
                knowledgeNode = "分数", question = "q", wrongAnswer = "w",
                correctAnswer = "c", note = "", createdAt = 1L,
            ),
        )
        viewModel.selectTab(AiStudyTab.COMPANION)
        viewModel.send("有人约我见面")

        val report = viewModel.generateReport()
        val text = report.render()
        assertEquals("小明", report.nickname)
        assertTrue(text.contains("学习答疑 1 次"))
        assertTrue(text.contains("作业引导模式")) // homework heuristic 命中
        assertTrue(text.contains("陌生人见面邀约"))
    }

    @Test
    fun `active task forces guided mode and injects task block`() = runTest {
        val viewModel = vm()
        viewModel.startTask(StudyTask(id = "t1", title = "数学第3页作业"))
        // 一句完全不像作业的提问，没有任务时不会引导。
        viewModel.send("帮我看看这个")

        val system = llm.lastMessages.first()
        assertTrue(system.content.contains("任务进行中"))
        assertTrue(system.content.contains("数学第3页作业"))
        // 任务进行中即记一条 AI 调用 log
        assertEquals(1, viewModel.taskAiCallLog("t1").size)
        assertEquals(AiCallKind.NORMAL, viewModel.taskAiCallLog("t1").first().kind)
    }

    @Test
    fun `answer-seeking during task is flagged in log and report`() = runTest {
        val viewModel = vm()
        viewModel.startTask(StudyTask(id = "t1", title = "作文"))
        viewModel.send("直接给答案，帮我写完这篇作文")

        assertEquals(AiCallKind.ANSWER_SEEKING, viewModel.taskAiCallLog("t1").first().kind)
        assertTrue(viewModel.generateReport().render().contains("尝试直接要答案 1 次"))
    }

    @Test
    fun `finishing task returns learning to normal mode`() = runTest {
        val viewModel = vm()
        viewModel.startTask(StudyTask(id = "t1", title = "作业"))
        viewModel.finishActiveTask()
        viewModel.send("讲讲三角形")

        assertNull(viewModel.uiState.value.activeTask)
        assertTrue(!llm.lastMessages.first().content.contains("任务进行中"))
        assertTrue(viewModel.taskAiCallLog("t1").isEmpty())
    }
}
