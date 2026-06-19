package com.chainlesschain.android.familyguard.sync

import com.chainlesschain.android.feature.familyguard.domain.task.FamilyTask
import com.chainlesschain.android.feature.familyguard.domain.task.FamilyTaskSource
import com.chainlesschain.android.feature.familyguard.domain.task.FamilyTaskStatus
import com.chainlesschain.android.feature.familyguard.domain.task.FamilyTaskType
import kotlinx.serialization.SerializationException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class FamilyTaskSyncRecordTest {

    private fun fullTask() = FamilyTask(
        id = "t-1",
        familyGroupId = "fg-1",
        assignerDid = "did:key:parent",
        childDid = "did:key:child",
        source = FamilyTaskSource.SCHOOL_WECHAT_GROUP,
        type = FamilyTaskType.HOMEWORK,
        title = "数学第3页",
        description = "完成 1-10 题",
        subject = "math",
        gradeLevel = "P5",
        attachments = "[\"img1.png\"]",
        dueAtMs = 1_700_000_000_000L,
        reminderAtMs = 1_699_000_000_000L,
        hardConstraint = "{\"blockApps\":[\"com.game\"]}",
        rewardPoints = 30,
        status = FamilyTaskStatus.SUBMITTED,
        submittedAtMs = 1_700_100_000_000L,
        submission = "我的答案",
        aiGrade = "{\"score\":90}",
        parentReview = "做得不错",
        aiCallLog = "[{\"kind\":\"NORMAL\"}]",
        createdAtMs = 1_698_000_000_000L,
        updatedAtMs = 1_700_200_000_000L,
    )

    @Test
    fun `full task round-trips losslessly through encode-decode`() {
        val original = fullTask()
        val decoded = FamilyTaskSyncRecord.decode(FamilyTaskSyncRecord.encode(original))
        assertEquals(original, decoded)
    }

    @Test
    fun `minimal task with nullable defaults round-trips`() {
        val minimal = FamilyTask(
            id = "t-2",
            familyGroupId = "fg-1",
            assignerDid = "did:key:parent",
            childDid = "did:key:child",
            title = "倒垃圾",
            type = FamilyTaskType.CHORE,
            status = FamilyTaskStatus.ASSIGNED,
            createdAtMs = 1L,
            updatedAtMs = 2L,
        )
        val decoded = FamilyTaskSyncRecord.decode(FamilyTaskSyncRecord.encode(minimal))
        assertEquals(minimal, decoded)
        assertEquals(null, decoded.subject)
        assertEquals(0, decoded.rewardPoints)
    }

    @Test
    fun `enums survive via storage values not ordinal`() {
        // 线格式存 storageValue 字符串而非 ordinal，新增枚举值不会错位旧端解码。
        val json = FamilyTaskSyncRecord.encode(fullTask())
        assertTrue(json.contains("school_wechat_group"))
        assertTrue(json.contains("submitted"))
        assertTrue(json.contains("homework"))
    }

    @Test
    fun `unknown enum storage value falls back rather than crashing`() {
        // 旧端收到新端新增的 source/status，fromStorage 兜底回落 (任务宁可降级也不丢)。
        val record = FamilyTaskSyncRecord.fromTask(fullTask()).copy(
            source = "brand_new_source",
            status = "brand_new_status",
            type = "brand_new_type",
        )
        val task = record.toTask()
        assertEquals(FamilyTaskSource.PARENT, task.source)     // fromStorage 默认
        assertEquals(FamilyTaskStatus.ASSIGNED, task.status)   // fromStorage 默认
        assertEquals(FamilyTaskType.CUSTOM, task.type)         // fromStorage 默认
    }

    @Test
    fun `unknown extra json keys are ignored not fatal`() {
        val good = FamilyTaskSyncRecord.encode(fullTask())
        val withExtra = good.dropLast(1) + ",\"futureField\":\"x\"}"
        val decoded = FamilyTaskSyncRecord.decode(withExtra)
        assertEquals("t-1", decoded.id)
    }

    @Test
    fun `malformed json throws SerializationException`() {
        assertThrows(SerializationException::class.java) {
            FamilyTaskSyncRecord.decode("{not valid json")
        }
    }
}
