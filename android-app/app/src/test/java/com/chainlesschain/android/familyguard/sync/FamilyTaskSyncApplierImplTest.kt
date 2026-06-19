package com.chainlesschain.android.familyguard.sync

import com.chainlesschain.android.feature.familyguard.data.entity.FamilyRelationshipEntity
import com.chainlesschain.android.feature.familyguard.domain.repository.FamilyRelationshipRepository
import com.chainlesschain.android.feature.familyguard.domain.repository.FamilyTaskRepository
import com.chainlesschain.android.feature.familyguard.domain.task.FamilyTask
import com.chainlesschain.android.feature.familyguard.domain.task.FamilyTaskStatus
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import io.mockk.slot
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

class FamilyTaskSyncApplierImplTest {

    private val taskRepo = mockk<FamilyTaskRepository>(relaxed = true)
    private val relRepo = mockk<FamilyRelationshipRepository>(relaxed = true)
    private val applier = FamilyTaskSyncApplierImpl(taskRepo, relRepo)

    private val parentDid = "did:key:parent"
    private val childDid = "did:key:child"

    private fun activeRel(friendDid: String, roleOther: String = "parent") = FamilyRelationshipEntity(
        id = 1L, familyGroupId = "fg", friendDid = friendDid,
        roleSelf = "child", roleOther = roleOther, boundAt = 1L,
        permissions = "{}", status = "active", createdAt = 1L, updatedAt = 1L,
    )

    private fun task(
        id: String = "t-1",
        status: FamilyTaskStatus = FamilyTaskStatus.ASSIGNED,
        updatedAtMs: Long = 100L,
    ) = FamilyTask(
        id = id, familyGroupId = "fg", assignerDid = parentDid, childDid = childDid,
        title = "数学作业", status = status, createdAtMs = 10L, updatedAtMs = updatedAtMs,
    )

    @Test
    fun `accepts task from active family parent and upserts`() = runTest {
        coEvery { relRepo.findByFriendDid(parentDid) } returns activeRel(parentDid)
        coEvery { relRepo.findByFriendDid(childDid) } returns null
        coEvery { taskRepo.getById("t-1") } returns null
        val slot = slot<FamilyTask>()
        coEvery { taskRepo.upsert(capture(slot)) } returns Unit

        applier.saveTaskFromSync("family_task|t-1", FamilyTaskSyncRecord.encode(task()))

        coVerify(exactly = 1) { taskRepo.upsert(any()) }
        assertEquals("t-1", slot.captured.id)
    }

    @Test
    fun `rejects task when neither assigner nor child is active family`() = runTest {
        coEvery { relRepo.findByFriendDid(any()) } returns null

        applier.saveTaskFromSync("family_task|t-1", FamilyTaskSyncRecord.encode(task()))

        coVerify(exactly = 0) { taskRepo.upsert(any()) }
    }

    @Test
    fun `child-side submission (child is the family friend) is accepted`() = runTest {
        // 家长端收孩子回传：assignerDid=自己(非好友)，childDid=孩子(活跃好友) → 仍接受。
        coEvery { relRepo.findByFriendDid(parentDid) } returns null
        coEvery { relRepo.findByFriendDid(childDid) } returns activeRel(childDid, roleOther = "child")
        coEvery { taskRepo.getById(any()) } returns null

        applier.saveTaskFromSync("family_task|t-1", FamilyTaskSyncRecord.encode(task()))

        coVerify(exactly = 1) { taskRepo.upsert(any()) }
    }

    @Test
    fun `merges with local when same id exists (most-progressed wins)`() = runTest {
        coEvery { relRepo.findByFriendDid(parentDid) } returns activeRel(parentDid)
        // 本机已有 ASSIGNED；收到 SUBMITTED → merge 取更进展的 SUBMITTED。
        val local = task(status = FamilyTaskStatus.ASSIGNED, updatedAtMs = 50L)
        coEvery { taskRepo.getById("t-1") } returns local
        val slot = slot<FamilyTask>()
        coEvery { taskRepo.upsert(capture(slot)) } returns Unit

        val incoming = task(status = FamilyTaskStatus.SUBMITTED, updatedAtMs = 200L)
        applier.saveTaskFromSync("family_task|t-1", FamilyTaskSyncRecord.encode(incoming))

        assertEquals(FamilyTaskStatus.SUBMITTED, slot.captured.status)
    }

    @Test
    fun `malformed data does not crash and does not upsert`() = runTest {
        coEvery { relRepo.findByFriendDid(any()) } returns activeRel(parentDid)

        applier.saveTaskFromSync("family_task|t-1", "{not json")

        coVerify(exactly = 0) { taskRepo.upsert(any()) }
    }

    @Test
    fun `delete only removes existing active-family task`() = runTest {
        coEvery { taskRepo.getById("t-1") } returns task()
        coEvery { relRepo.findByFriendDid(parentDid) } returns activeRel(parentDid)
        coEvery { taskRepo.delete("t-1") } returns true

        applier.deleteTaskFromSync("family_task|t-1")

        coVerify(exactly = 1) { taskRepo.delete("t-1") }
    }

    @Test
    fun `delete of unknown task is a no-op`() = runTest {
        coEvery { taskRepo.getById(any()) } returns null

        applier.deleteTaskFromSync("family_task|ghost")

        coVerify(exactly = 0) { taskRepo.delete(any()) }
    }
}
