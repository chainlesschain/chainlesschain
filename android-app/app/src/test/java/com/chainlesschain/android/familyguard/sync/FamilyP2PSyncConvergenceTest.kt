package com.chainlesschain.android.familyguard.sync

import com.chainlesschain.android.feature.familyguard.data.entity.FamilyRelationshipEntity
import com.chainlesschain.android.feature.familyguard.domain.repository.FamilyRelationshipRepository
import com.chainlesschain.android.feature.familyguard.domain.repository.FamilyTaskRepository
import com.chainlesschain.android.feature.familyguard.domain.task.AiCallLogEntry
import com.chainlesschain.android.feature.familyguard.domain.task.FamilyTask
import com.chainlesschain.android.feature.familyguard.domain.task.FamilyTaskStatus
import com.chainlesschain.android.presentation.aistudy.InMemoryPointsLedger
import com.chainlesschain.android.presentation.aistudy.PointsEvent
import com.chainlesschain.android.presentation.aistudy.PointsEventSyncData
import com.chainlesschain.android.presentation.aistudy.PointsEventType
import com.chainlesschain.android.presentation.aistudy.PointsLedgerSyncApplierImpl
import io.mockk.coEvery
import io.mockk.mockk
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * FAMILY-67 Phase 1d 收尾（进程内）：两台设备的 **完整同步往返 + 收敛** 集成测试。
 *
 * 不依赖 SyncManager/真传输——直接把发端 codec 编码出的线串喂给对端 applier，验证
 * 编码→鉴权→合并→落库 这条跨设备契约在两端都收敛、幂等、合并确定。真机 E2E 之前的最后一道
 * 进程内闸（真机阻塞 Win 不可跑）。
 */
class FamilyP2PSyncConvergenceTest {

    private val parentDid = "did:key:parent"
    private val childDid = "did:key:child"

    /** 极简内存任务库：upsert/upsertFromSync 都直接落内存 (本测试不区分上行)。 */
    private class FakeTaskRepo : FamilyTaskRepository {
        val all = MutableStateFlow<List<FamilyTask>>(emptyList())
        private fun put(t: FamilyTask) { all.value = all.value.filterNot { it.id == t.id } + t }
        private fun find(id: String) = all.value.firstOrNull { it.id == id }
        override suspend fun upsert(task: FamilyTask) = put(task)
        override suspend fun upsertFromSync(task: FamilyTask) = put(task)
        override suspend fun deleteFromSync(id: String): Boolean {
            val had = find(id) != null; all.value = all.value.filterNot { it.id == id }; return had
        }
        override suspend fun getById(id: String) = find(id)
        override fun observeForChild(childDid: String): Flow<List<FamilyTask>> =
            all.map { l -> l.filter { it.childDid == childDid } }
        override fun observeForChild(childDid: String, status: FamilyTaskStatus) =
            all.map { l -> l.filter { it.childDid == childDid && it.status == status } }
        override suspend fun activeTasksForChild(childDid: String) =
            all.value.filter { it.childDid == childDid && it.status == FamilyTaskStatus.IN_PROGRESS }
        override suspend fun transition(id: String, to: FamilyTaskStatus): Boolean {
            val t = find(id) ?: return false
            if (!t.status.canTransitionTo(to)) return false
            put(t.copy(status = to)); return true
        }
        override suspend fun recordSubmission(id: String, submission: String): Boolean {
            val t = find(id) ?: return false
            put(t.copy(submission = submission, status = FamilyTaskStatus.SUBMITTED)); return true
        }
        override suspend fun recordAiGrade(id: String, aiGrade: String): Boolean {
            val t = find(id) ?: return false; put(t.copy(aiGrade = aiGrade)); return true
        }
        override suspend fun recordParentReview(id: String, review: String): Boolean {
            val t = find(id) ?: return false; put(t.copy(parentReview = review)); return true
        }
        override suspend fun appendAiCall(id: String, entry: AiCallLogEntry) = find(id) != null
        override suspend fun delete(id: String) = deleteFromSync(id)
        override suspend fun deleteTerminalOlderThan(cutoffMs: Long) = 0
    }

    private fun activeFamilyRelRepo(): FamilyRelationshipRepository {
        val rel = mockk<FamilyRelationshipRepository>(relaxed = true)
        coEvery { rel.findByFriendDid(any()) } answers {
            FamilyRelationshipEntity(
                id = 1L, familyGroupId = "fg", friendDid = firstArg(),
                roleSelf = "parent", roleOther = "parent", boundAt = 1L,
                permissions = "{}", status = "active", createdAt = 1L, updatedAt = 1L,
            )
        }
        return rel
    }

    private fun task(id: String, status: FamilyTaskStatus, updatedAtMs: Long) = FamilyTask(
        id = id, familyGroupId = "fg", assignerDid = parentDid, childDid = childDid,
        title = "数学第3页", status = status, createdAtMs = 10L, updatedAtMs = updatedAtMs,
    )

    @Test
    fun `task assignment syncs parent to child then submission syncs back (bidirectional converge)`() = runTest {
        val parentRepo = FakeTaskRepo()
        val childRepo = FakeTaskRepo()
        val parentApplier = FamilyTaskSyncApplierImpl(parentRepo, activeFamilyRelRepo())
        val childApplier = FamilyTaskSyncApplierImpl(childRepo, activeFamilyRelRepo())

        // 1) 家长布置 → 编码 → 孩子端收。
        val assigned = task("t1", FamilyTaskStatus.ASSIGNED, updatedAtMs = 100L)
        parentRepo.upsert(assigned)
        childApplier.saveTaskFromSync("family_task|t1", FamilyTaskSyncRecord.encode(assigned))
        assertEquals(FamilyTaskStatus.ASSIGNED, childRepo.getById("t1")?.status)

        // 2) 孩子提交 → 编码 → 家长端收 (合并后家长看到 SUBMITTED)。
        childRepo.transition("t1", FamilyTaskStatus.IN_PROGRESS)
        childRepo.recordSubmission("t1", "我的答案")
        val submitted = childRepo.getById("t1")!!.copy(updatedAtMs = 200L)
        parentApplier.updateTaskFromSync("family_task|t1", FamilyTaskSyncRecord.encode(submitted))
        assertEquals(FamilyTaskStatus.SUBMITTED, parentRepo.getById("t1")?.status)
        assertEquals("我的答案", parentRepo.getById("t1")?.submission)
    }

    @Test
    fun `merge is order-independent — both devices converge to same task`() = runTest {
        val repoA = FakeTaskRepo()
        val repoB = FakeTaskRepo()
        val applierA = FamilyTaskSyncApplierImpl(repoA, activeFamilyRelRepo())
        val applierB = FamilyTaskSyncApplierImpl(repoB, activeFamilyRelRepo())

        // 同 id 两个分叉副本 (A=GRADED 较新, B=SUBMITTED 较旧)。
        val graded = task("t9", FamilyTaskStatus.GRADED, updatedAtMs = 300L).copy(aiGrade = "90 分")
        val submitted = task("t9", FamilyTaskStatus.SUBMITTED, updatedAtMs = 250L).copy(submission = "答案")
        repoA.upsert(graded)
        repoB.upsert(submitted)

        // 交叉同步：A 收 B 的副本，B 收 A 的副本。
        applierA.updateTaskFromSync("family_task|t9", FamilyTaskSyncRecord.encode(submitted))
        applierB.updateTaskFromSync("family_task|t9", FamilyTaskSyncRecord.encode(graded))

        // 两端收敛到同一结果 (最进展 GRADED + 各自的 submission/aiGrade 并入)。
        val a = repoA.getById("t9")!!
        val b = repoB.getById("t9")!!
        assertEquals(a.status, b.status)
        assertEquals(FamilyTaskStatus.GRADED, a.status)
        assertEquals(a.submission, b.submission)
        assertEquals(a.aiGrade, b.aiGrade)
        assertEquals("答案", a.submission)
        assertEquals("90 分", a.aiGrade)
    }

    @Test
    fun `points earned on child converge to parent ledger, idempotent`() = runTest {
        val parentLedger = InMemoryPointsLedger()
        val parentApplier = PointsLedgerSyncApplierImpl(parentLedger, activeFamilyRelRepo())

        val earn = PointsEvent(
            id = "e1", childDid = childDid, type = PointsEventType.EARN,
            amount = 30, reason = "作业满分", relatedTaskId = "t1", timestamp = 1L,
        )
        val wire = PointsEventSyncData.encode(earn)

        // 家长端收两次 (重投递) → 只入账一次。
        parentApplier.savePointsEventFromSync("points_event|e1", wire)
        parentApplier.savePointsEventFromSync("points_event|e1", wire)

        assertEquals(1, parentLedger.events.value.size)
        assertEquals(30, parentLedger.balanceOf(childDid, now = 2L).balance)
    }
}
