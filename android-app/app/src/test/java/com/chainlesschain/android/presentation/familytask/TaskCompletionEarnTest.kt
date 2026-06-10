package com.chainlesschain.android.presentation.familytask

import com.chainlesschain.android.feature.familyguard.domain.task.AiCallLogCodec
import com.chainlesschain.android.feature.familyguard.domain.task.AiCallLogEntry
import com.chainlesschain.android.feature.familyguard.domain.task.FamilyTask
import com.chainlesschain.android.feature.familyguard.domain.task.FamilyTaskStatus
import com.chainlesschain.android.feature.familyguard.domain.task.FamilyTaskType
import com.chainlesschain.android.presentation.aistudy.AiCallKind
import com.chainlesschain.android.presentation.aistudy.Completion
import com.chainlesschain.android.presentation.aistudy.InMemoryPointsLedger
import com.chainlesschain.android.presentation.aistudy.PointsEventType
import com.chainlesschain.android.presentation.aistudy.TaskAiCall
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** M5→M9 联动纯逻辑 ([TaskCompletionEarn])。 */
class TaskCompletionEarnTest {

    private fun task(
        id: String = "t1",
        type: FamilyTaskType = FamilyTaskType.HOMEWORK,
        aiGrade: String? = null,
        aiCallLog: String? = null,
        rewardPoints: Int = 20,
    ) = FamilyTask(
        id = id,
        familyGroupId = "g1",
        assignerDid = "did:chain:parent",
        childDid = "did:chain:child",
        type = type,
        title = "数学第3页",
        rewardPoints = rewardPoints,
        status = FamilyTaskStatus.GRADED,
        aiGrade = aiGrade,
        aiCallLog = aiCallLog,
        createdAtMs = 1L,
        updatedAtMs = 1L,
    )

    // ---- parseScorePct ----

    @Test
    fun `parses score from formatted grade text`() {
        assertEquals(85, TaskCompletionEarn.parseScorePct("85 分 — 分数计算有进步"))
        assertEquals(100, TaskCompletionEarn.parseScorePct("100 分 — 全对"))
        assertEquals(0, TaskCompletionEarn.parseScorePct("0 分 — 没写"))
    }

    @Test
    fun `grading failure text (no leading score) yields null`() {
        assertNull(TaskCompletionEarn.parseScorePct("批改失败，请稍后重试"))
        assertNull(TaskCompletionEarn.parseScorePct(null))
        assertNull(TaskCompletionEarn.parseScorePct(""))
    }

    // ---- answerSeekingCount ----

    @Test
    fun `answer seeking merges persisted log and study context log`() {
        val persisted = AiCallLogCodec.append(
            AiCallLogCodec.append(null, AiCallLogEntry(1L, "answer_seeking")),
            AiCallLogEntry(2L, "grade"),
        )
        val contextCalls = listOf(
            TaskAiCall("t1", 3L, AiCallKind.ANSWER_SEEKING),
            TaskAiCall("t1", 4L, AiCallKind.NORMAL),
        )
        assertEquals(2, TaskCompletionEarn.answerSeekingCount(persisted, contextCalls))
        assertEquals(0, TaskCompletionEarn.answerSeekingCount(null, emptyList()))
    }

    // ---- completionFor ----

    @Test
    fun `homework with parsable score maps to Homework completion`() {
        val c = TaskCompletionEarn.completionFor(task(aiGrade = "85 分 — 不错"), answerSeekingAttempts = 1)
        assertEquals(Completion.Homework("t1", 85, 1), c)
    }

    @Test
    fun `homework without parsable score falls back to reward face value`() {
        val c = TaskCompletionEarn.completionFor(task(aiGrade = "批改失败"), answerSeekingAttempts = 0)
        assertEquals(Completion.Fixed("t1", 20), c)
    }

    @Test
    fun `non-homework task earns its face value`() {
        val c = TaskCompletionEarn.completionFor(
            task(type = FamilyTaskType.CHORE, rewardPoints = 15),
            answerSeekingAttempts = 0,
        )
        assertEquals(Completion.Fixed("t1", 15), c)
    }

    @Test
    fun `zero reward non-homework task does not participate`() {
        val c = TaskCompletionEarn.completionFor(
            task(type = FamilyTaskType.READING, rewardPoints = 0),
            answerSeekingAttempts = 0,
        )
        assertNull(c)
    }

    // ---- earnOnDone (端到端: 映射 → decideEarn → 入账) ----

    @Test
    fun `full-mark homework earns full tier and lands in the ledger`() {
        val ledger = InMemoryPointsLedger()
        val decision = TaskCompletionEarn.earnOnDone(
            task = task(aiGrade = "100 分 — 全对"),
            contextCalls = emptyList(),
            ledger = ledger,
            eventId = "e1",
            now = 1_000L,
        )
        assertEquals(30, decision?.approvedAmount)
        val events = ledger.events.value
        assertEquals(1, events.size)
        assertEquals(PointsEventType.EARN, events[0].type)
        assertEquals("t1", events[0].relatedTaskId)
        assertTrue(events[0].reason.contains("数学第3页"))
        assertTrue(events[0].reason.contains("100 分"))
    }

    @Test
    fun `same task cannot earn twice`() {
        val ledger = InMemoryPointsLedger()
        val t = task(aiGrade = "100 分 — 全对")
        TaskCompletionEarn.earnOnDone(t, emptyList(), ledger, "e1", 1_000L)
        val second = TaskCompletionEarn.earnOnDone(t, emptyList(), ledger, "e2", 2_000L)
        assertTrue(second!!.rejected)
        assertEquals(1, ledger.events.value.size)
    }

    @Test
    fun `full mark with repeated answer seeking is halved`() {
        val ledger = InMemoryPointsLedger()
        val contextCalls = (1..3).map { TaskAiCall("t1", it.toLong(), AiCallKind.ANSWER_SEEKING) }
        val decision = TaskCompletionEarn.earnOnDone(
            task = task(aiGrade = "100 分 — 全对"),
            contextCalls = contextCalls,
            ledger = ledger,
            eventId = "e1",
            now = 1_000L,
        )
        assertEquals(15, decision?.approvedAmount)
        assertTrue(decision!!.notes.any { it.contains("50%") })
    }

    @Test
    fun `chore completion earns face value via Fixed`() {
        val ledger = InMemoryPointsLedger()
        val decision = TaskCompletionEarn.earnOnDone(
            task = task(type = FamilyTaskType.CHORE, rewardPoints = 15),
            contextCalls = emptyList(),
            ledger = ledger,
            eventId = "e1",
            now = 1_000L,
        )
        assertEquals(15, decision?.approvedAmount)
        assertEquals(15, ledger.balanceOf("did:chain:child", 2_000L).balance)
    }

    @Test
    fun `task not participating returns null and touches nothing`() {
        val ledger = InMemoryPointsLedger()
        val decision = TaskCompletionEarn.earnOnDone(
            task = task(type = FamilyTaskType.CUSTOM, rewardPoints = 0),
            contextCalls = emptyList(),
            ledger = ledger,
            eventId = "e1",
            now = 1_000L,
        )
        assertNull(decision)
        assertTrue(ledger.events.value.isEmpty())
    }
}
