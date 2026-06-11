package com.chainlesschain.android.feature.familyguard.domain.task

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** M5 family_task P2P 冲突解决核 ([FamilyTaskMerge])。 */
class FamilyTaskMergeTest {

    private fun task(
        status: FamilyTaskStatus = FamilyTaskStatus.ASSIGNED,
        updatedAt: Long = 1_000L,
        title: String = "数学第3页",
        submission: String? = null,
        aiGrade: String? = null,
        parentReview: String? = null,
        aiCallLog: String? = null,
    ) = FamilyTask(
        id = "t1",
        familyGroupId = "g1",
        assignerDid = "did:chain:parent",
        childDid = "did:chain:child",
        title = title,
        status = status,
        submission = submission,
        aiGrade = aiGrade,
        parentReview = parentReview,
        aiCallLog = aiCallLog,
        createdAtMs = 100L,
        updatedAtMs = updatedAt,
    )

    @Test
    fun `merge is commutative`() {
        val childSide = task(
            status = FamilyTaskStatus.SUBMITTED,
            updatedAt = 2_000L,
            submission = "我的作答",
        )
        val parentSide = task(
            status = FamilyTaskStatus.ASSIGNED,
            updatedAt = 3_000L,
            title = "数学第3页（改：只做 1-5 题）",
        )
        assertEquals(
            FamilyTaskMerge.merge(childSide, parentSide),
            FamilyTaskMerge.merge(parentSide, childSide),
        )
    }

    @Test
    fun `child progress survives a later parent edit (rank beats recency)`() {
        val childSide = task(status = FamilyTaskStatus.SUBMITTED, updatedAt = 2_000L, submission = "我的作答")
        val parentSide = task(status = FamilyTaskStatus.ASSIGNED, updatedAt = 3_000L, title = "改标题")

        val merged = FamilyTaskMerge.merge(childSide, parentSide)
        assertEquals(FamilyTaskStatus.SUBMITTED, merged.status) // 进度不回退
        assertEquals("我的作答", merged.submission) // 作答不丢
        assertEquals("改标题", merged.title) // 布置侧字段取晚更新者
        assertEquals(3_000L, merged.updatedAtMs)
    }

    @Test
    fun `terminal conflict DONE vs CANCELLED resolves by later update on both sides`() {
        val done = task(status = FamilyTaskStatus.DONE, updatedAt = 5_000L)
        val cancelled = task(status = FamilyTaskStatus.CANCELLED, updatedAt = 4_000L)

        assertEquals(FamilyTaskStatus.DONE, FamilyTaskMerge.merge(done, cancelled).status)
        assertEquals(FamilyTaskStatus.DONE, FamilyTaskMerge.merge(cancelled, done).status)
    }

    @Test
    fun `ai call log unions and dedups across replicas`() {
        val logA = AiCallLogCodec.append(
            AiCallLogCodec.append(null, AiCallLogEntry(1L, "answer_seeking")),
            AiCallLogEntry(2L, "normal"),
        )
        val logB = AiCallLogCodec.append(
            AiCallLogCodec.append(null, AiCallLogEntry(2L, "normal")), // 与 A 重叠
            AiCallLogEntry(3L, "grade"),
        )
        val merged = FamilyTaskMerge.merge(
            task(aiCallLog = logA, updatedAt = 1_000L),
            task(aiCallLog = logB, updatedAt = 2_000L),
        )
        val entries = AiCallLogCodec.decode(merged.aiCallLog)
        assertEquals(3, entries.size)
        assertEquals(listOf(1L, 2L, 3L), entries.map { it.timestampMs })
    }

    @Test
    fun `grades and reviews prefer non-null regardless of recency`() {
        val graded = task(status = FamilyTaskStatus.GRADED, updatedAt = 1_000L, aiGrade = "85 分 — 不错")
        val reviewed = task(status = FamilyTaskStatus.GRADED, updatedAt = 2_000L, parentReview = "再练一遍")

        val merged = FamilyTaskMerge.merge(graded, reviewed)
        assertEquals("85 分 — 不错", merged.aiGrade)
        assertEquals("再练一遍", merged.parentReview)
    }

    @Test
    fun `merge is idempotent`() {
        val t = task(status = FamilyTaskStatus.SUBMITTED, updatedAt = 2_000L, submission = "ans")
        assertEquals(t, FamilyTaskMerge.merge(t, t))
    }

    @Test
    fun `different ids are rejected`() {
        val other = task().copy(id = "t2")
        assertTrue(runCatching { FamilyTaskMerge.merge(task(), other) }.isFailure)
    }
}
