package com.chainlesschain.android.presentation.aistudy

import com.chainlesschain.android.feature.ai.domain.model.Message
import com.chainlesschain.android.feature.ai.domain.model.MessageRole
import com.chainlesschain.android.feature.ai.domain.model.StreamChunk
import com.chainlesschain.android.feature.familyguard.data.entity.AnomalyEntity
import com.chainlesschain.android.feature.familyguard.data.entity.ChildEventEntity
import com.chainlesschain.android.feature.familyguard.domain.anomaly.AnomalyType
import com.chainlesschain.android.feature.familyguard.domain.anomaly.DetectedAnomaly
import com.chainlesschain.android.feature.familyguard.domain.repository.AnomalyRepository
import com.chainlesschain.android.feature.familyguard.domain.repository.ChildEventRepository
import com.chainlesschain.android.feature.familyguard.domain.telemetry.ForegroundAppRun
import com.chainlesschain.android.feature.familyguard.domain.telemetry.TelemetryEvent
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

    /** 内存 fake：替掉 Keystore/文件 I/O，验证 ViewModel 的金库读写接线。 */
    private class FakeCompanionVault(initial: List<CompanionChatRecord> = emptyList()) : CompanionVault {
        val records = initial.toMutableList()
        override suspend fun load(): List<CompanionChatRecord> = records.toList()
        override suspend fun append(record: CompanionChatRecord) { records += record }
        override suspend fun clear() { records.clear() }
        override suspend fun pruneOlderThan(cutoffMs: Long): Int {
            val before = records.size
            records.retainAll { it.timestamp >= cutoffMs }
            return before - records.size
        }
    }

    /** 内存 fake：querySince 返回可设事件，其余 no-op/空。 */
    private class FakeChildEventRepository : ChildEventRepository {
        var events: List<ChildEventEntity> = emptyList()
        override suspend fun saveForegroundAppRun(childDid: String, run: ForegroundAppRun): Long = 0
        override suspend fun saveEvent(event: ChildEventEntity): Long = 0
        override suspend fun saveTelemetryEvent(event: TelemetryEvent): Long = 0
        override suspend fun querySince(childDid: String, sinceMs: Long): List<ChildEventEntity> = events
        override fun observeRecent(childDid: String, limit: Int): Flow<List<ChildEventEntity>> = flowOf(emptyList())
        override fun observeRecentAnyChild(limit: Int): Flow<List<ChildEventEntity>> = flowOf(emptyList())
        override suspend fun deleteOlderThan(cutoffMs: Long): Int = 0
    }

    /** 内存 fake：observeRecent 返回可设异常，其余 no-op。 */
    private class FakeAnomalyRepository : AnomalyRepository {
        var anomalies: List<AnomalyEntity> = emptyList()
        override suspend fun record(anomaly: DetectedAnomaly): Long = 0
        override fun observeRecent(childDid: String, limit: Int): Flow<List<AnomalyEntity>> = flowOf(anomalies)
        override suspend fun acknowledge(id: Long): Boolean = true
        override suspend fun deleteOlderThan(cutoffMs: Long): Int = 0
    }

    private lateinit var llm: FakeAiStudyLlm
    private lateinit var store: FakeStudyProfileStore
    private lateinit var mistakeBook: InMemoryMistakeBook
    private lateinit var guardrailSink: InMemoryGuardrailEventSink
    private lateinit var taskContext: InMemoryStudyTaskContext
    private lateinit var companionVault: FakeCompanionVault
    private lateinit var ledger: InMemoryPointsLedger
    private lateinit var childEventRepo: FakeChildEventRepository
    private lateinit var anomalyRepo: FakeAnomalyRepository
    private val studyContext = object : com.chainlesschain.android.presentation.familytask.FamilyStudyContext {
        override suspend fun childDid() = TEST_CHILD_DID
    }

    @Before
    fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        llm = FakeAiStudyLlm()
        store = FakeStudyProfileStore(StudyProfile(grade = GradeLevel.P5, subject = Subject.MATH, nickname = "小明"))
        mistakeBook = InMemoryMistakeBook()
        guardrailSink = InMemoryGuardrailEventSink()
        taskContext = InMemoryStudyTaskContext()
        companionVault = FakeCompanionVault()
        ledger = InMemoryPointsLedger()
        childEventRepo = FakeChildEventRepository()
        anomalyRepo = FakeAnomalyRepository()
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun vm() = AiStudyViewModel(
        llm, store, mistakeBook, KeywordGuardrailClassifier(), guardrailSink, taskContext, companionVault,
        ledger, studyContext, childEventRepo, anomalyRepo,
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
    fun `companion tab keeps separate history and persists to TEE vault not profile store`() = runTest {
        val viewModel = vm()
        viewModel.selectTab(AiStudyTab.COMPANION)
        viewModel.send("今天有点累")

        assertEquals(2, viewModel.uiState.value.companionMessages.size)
        assertTrue(viewModel.uiState.value.learningMessages.isEmpty())
        // 陪伴 system prompt = 护栏模板
        assertTrue(llm.lastMessages.first().content.contains("自伤"))
        // 聊天不写 profile store；而是加密落 TEE 金库 (user + assistant 两条)。
        assertEquals(0, store.updateCount)
        assertEquals(2, companionVault.records.size)
        assertTrue(companionVault.records[0].isUser)
        assertEquals("今天有点累", companionVault.records[0].content)
        assertTrue(!companionVault.records[1].isUser)
    }

    @Test
    fun `companion history is hydrated from vault on init`() = runTest {
        companionVault = FakeCompanionVault(
            listOf(
                CompanionChatRecord(true, "昨天的悄悄话", 1L),
                CompanionChatRecord(false, "我记得呀", 2L),
            ),
        )
        val viewModel = vm()

        val msgs = viewModel.uiState.value.companionMessages
        assertEquals(2, msgs.size)
        assertEquals("昨天的悄悄话", msgs[0].content)
        assertEquals(MessageRole.USER, msgs[0].role)
        assertEquals(MessageRole.ASSISTANT, msgs[1].role)
    }

    @Test
    fun `clearCompanionHistory wipes vault and memory`() = runTest {
        val viewModel = vm()
        viewModel.selectTab(AiStudyTab.COMPANION)
        viewModel.send("秘密")
        viewModel.clearCompanionHistory()

        assertTrue(viewModel.uiState.value.companionMessages.isEmpty())
        assertTrue(companionVault.records.isEmpty())
    }

    @Test
    fun `learning tab does not write companion vault`() = runTest {
        val viewModel = vm()
        viewModel.send("讲讲分数")
        assertTrue(companionVault.records.isEmpty())
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
            erroringLlm, store, mistakeBook, KeywordGuardrailClassifier(), guardrailSink, taskContext, companionVault,
            ledger, studyContext, childEventRepo, anomalyRepo,
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
    fun `homework-like query without task actually enters guided mode in prompt`() = runTest {
        val viewModel = vm()
        // 没有进行中任务，但内容像作业 (多个题号) → 应真正进引导模式 (修正 v0.1 只计数不引导的缺口)。
        viewModel.send("帮我做这几题：第1题 1/2+1/3  第2题 2/3-1/6")

        val system = llm.lastMessages.first()
        assertEquals(MessageRole.SYSTEM, system.role)
        assertTrue(system.content.contains("作业模式"))
        assertTrue(system.content.contains("绝不直接给出最终答案"))
        // 不是任务级引导，不应出现"任务进行中"。
        assertTrue(!system.content.contains("任务进行中"))
    }

    @Test
    fun `plain non-homework query without task stays in normal mode`() = runTest {
        val viewModel = vm()
        viewModel.send("老师，分数是什么意思呀")

        val system = llm.lastMessages.first()
        // 普通提问不进强制引导块 (基础 prompt 仍含"作业模式"软提示，但无强制引导块标志句)。
        assertTrue(!system.content.contains("绝不直接给出最终答案"))
        assertTrue(!system.content.contains("任务进行中"))
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

    @Test
    fun `report shows M9 positive-reinforcement block from persisted points (FAMILY-67 Phase 2)`() = runTest {
        // 任务侧赚的分 (同 childDid) → 报告正向激励块出现，含今日赚分 + 余额真值。
        val now = System.currentTimeMillis()
        ledger.append(
            PointsEvent(
                id = "e1", childDid = TEST_CHILD_DID, type = PointsEventType.EARN,
                amount = 30, reason = "作业满分", timestamp = now,
            ),
        )
        val text = vm().generateReport().render()
        assertTrue(text.contains("正向激励"))
        assertTrue(text.contains("赚 30 分"))
        assertTrue(text.contains("余额 30 分"))
    }

    @Test
    fun `report with no points still shows balance block at zero`() = runTest {
        val text = vm().generateReport().render()
        assertTrue(text.contains("正向激励"))
        assertTrue(text.contains("余额 0 分"))
    }

    @Test
    fun `report shows today-usage block from telemetry foreground-app runs`() = runTest {
        // 真 telemetry: 微信 45min + 王者 30min 的前台 run。
        childEventRepo.events = listOf(
            childEvent("com.tencent.mm", 45 * 60_000L),
            childEvent("com.tencent.tmgp.sgame", 30 * 60_000L),
            childEvent("com.unknown.app", 5 * 60_000L),
        )
        val text = vm().generateReport().render()
        assertTrue(text.contains("今日使用"))
        assertTrue(text.contains("1 小时 20 分钟")) // 总时长 80min
        assertTrue(text.contains("微信 45 分钟"))
        assertTrue(text.contains("王者荣耀 30 分钟"))
    }

    @Test
    fun `no telemetry means no today-usage block`() = runTest {
        childEventRepo.events = emptyList()
        assertTrue(!vm().generateReport().render().contains("今日使用"))
    }

    @Test
    fun `report shows behavior-alert block from detected anomalies (类别+次数, no app detail)`() = runTest {
        val now = System.currentTimeMillis()
        anomalyRepo.anomalies = listOf(
            anomaly(AnomalyType.SINGLE_APP_OVERUSE, now),
            anomaly(AnomalyType.SINGLE_APP_OVERUSE, now), // 同类 2 次 → 计数
            anomaly(AnomalyType.LATE_NIGHT_SCREEN, now),
        )
        val text = vm().generateReport().render()
        assertTrue(text.contains("行为提醒"))
        assertTrue(text.contains("今日 2 次「单个应用使用偏久」"))
        assertTrue(text.contains("今日 1 次「凌晨时段使用」"))
        // 隐私：不泄露具体 app 包名/明细
        assertTrue(!text.contains("com."))
    }

    @Test
    fun `no anomalies means no behavior-alert block`() = runTest {
        anomalyRepo.anomalies = emptyList()
        assertTrue(!vm().generateReport().render().contains("行为提醒"))
    }

    private fun anomaly(type: AnomalyType, detectedAt: Long) = AnomalyEntity(
        childDid = TEST_CHILD_DID, type = type.storageValue, severity = "medium",
        dedupKey = "${type.storageValue}-$detectedAt-${(detectedAt % 1000)}", summary = "应用 com.foo 连续使用约 95 分钟",
        detail = "", detectedAt = detectedAt, createdAt = detectedAt,
    )

    private fun childEvent(pkg: String, durationMs: Long) = ChildEventEntity(
        childDid = TEST_CHILD_DID, source = "foreground_app", kind = "run",
        payload = """{"package":"$pkg","duration_ms":$durationMs}""",
        timestamp = 1L, durationMs = durationMs, level = "L1",
    )

    private companion object {
        const val TEST_CHILD_DID = "did:test-child"
    }
}
