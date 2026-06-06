package com.chainlesschain.android.feature.familyguard.domain.task

import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import org.junit.Test

/** M5 状态机 + 枚举存储值 + ai_call_log codec 纯逻辑 (主文档 §3.5)。 */
class FamilyTaskStatusTest {

    @Test
    fun `happy path transitions are allowed`() {
        assertTrue(FamilyTaskStatus.SUGGESTED.canTransitionTo(FamilyTaskStatus.ASSIGNED))
        assertTrue(FamilyTaskStatus.ASSIGNED.canTransitionTo(FamilyTaskStatus.IN_PROGRESS))
        assertTrue(FamilyTaskStatus.IN_PROGRESS.canTransitionTo(FamilyTaskStatus.SUBMITTED))
        assertTrue(FamilyTaskStatus.SUBMITTED.canTransitionTo(FamilyTaskStatus.GRADED))
        assertTrue(FamilyTaskStatus.GRADED.canTransitionTo(FamilyTaskStatus.DONE))
    }

    @Test
    fun `skipping states is rejected`() {
        assertFalse(FamilyTaskStatus.ASSIGNED.canTransitionTo(FamilyTaskStatus.DONE))
        assertFalse(FamilyTaskStatus.ASSIGNED.canTransitionTo(FamilyTaskStatus.SUBMITTED))
        assertFalse(FamilyTaskStatus.IN_PROGRESS.canTransitionTo(FamilyTaskStatus.GRADED))
    }

    @Test
    fun `graded and submitted can be bounced back to in_progress`() {
        assertTrue(FamilyTaskStatus.SUBMITTED.canTransitionTo(FamilyTaskStatus.IN_PROGRESS))
        assertTrue(FamilyTaskStatus.GRADED.canTransitionTo(FamilyTaskStatus.IN_PROGRESS))
    }

    @Test
    fun `terminal states allow no transition`() {
        FamilyTaskStatus.entries.forEach {
            assertFalse(FamilyTaskStatus.DONE.canTransitionTo(it))
            assertFalse(FamilyTaskStatus.CANCELLED.canTransitionTo(it))
        }
    }

    @Test
    fun `most states can be cancelled`() {
        listOf(
            FamilyTaskStatus.SUGGESTED, FamilyTaskStatus.ASSIGNED,
            FamilyTaskStatus.IN_PROGRESS, FamilyTaskStatus.SUBMITTED, FamilyTaskStatus.GRADED,
        ).forEach { assertTrue(it.canTransitionTo(FamilyTaskStatus.CANCELLED)) }
    }

    @Test
    fun `storage values round-trip and unknown falls back`() {
        FamilyTaskStatus.entries.forEach {
            assertEquals(it, FamilyTaskStatus.fromStorage(it.storageValue))
        }
        assertEquals(FamilyTaskStatus.ASSIGNED, FamilyTaskStatus.fromStorage("???"))
        assertEquals(FamilyTaskType.CUSTOM, FamilyTaskType.fromStorage("???"))
        assertEquals(FamilyTaskSource.PARENT, FamilyTaskSource.fromStorage("???"))
    }

    @Test
    fun `ai call log codec appends and survives corruption`() {
        val a = AiCallLogCodec.append(null, AiCallLogEntry(1L, "normal"))
        val b = AiCallLogCodec.append(a, AiCallLogEntry(2L, "answer_seeking", "hash"))
        val decoded = AiCallLogCodec.decode(b)
        assertEquals(2, decoded.size)
        assertEquals("answer_seeking", decoded[1].kind)
        assertEquals("hash", decoded[1].promptHash)

        // 损坏旧值不丢新条目
        val recovered = AiCallLogCodec.append("not-json{", AiCallLogEntry(3L, "normal"))
        assertEquals(1, AiCallLogCodec.decode(recovered).size)
        assertTrue(AiCallLogCodec.decode(null).isEmpty())
    }
}
