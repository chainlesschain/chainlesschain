package com.chainlesschain.android.feature.familyguard.data.repository

import com.chainlesschain.android.feature.familyguard.data.dao.FamilyTaskDao
import com.chainlesschain.android.feature.familyguard.data.entity.FamilyTaskEntity
import com.chainlesschain.android.feature.familyguard.domain.repository.FamilyTaskRepository
import com.chainlesschain.android.feature.familyguard.domain.sync.FamilyTaskOutbox
import com.chainlesschain.android.feature.familyguard.domain.task.AiCallLogCodec
import com.chainlesschain.android.feature.familyguard.domain.task.AiCallLogEntry
import com.chainlesschain.android.feature.familyguard.domain.task.FamilyTask
import com.chainlesschain.android.feature.familyguard.domain.task.FamilyTaskSource
import com.chainlesschain.android.feature.familyguard.domain.task.FamilyTaskStatus
import com.chainlesschain.android.feature.familyguard.domain.task.FamilyTaskType
import java.time.Clock
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

/**
 * M5 [FamilyTaskRepository] 实装 (主文档 §3.5)。
 *
 * status 流转经 [FamilyTaskStatus.canTransitionTo] 校验; updated_at 由注入的 [clock] 打戳
 * (JVM 单测可固定时钟)。entity↔domain 映射集中在本类。
 */
@Singleton
class FamilyTaskRepositoryImpl @Inject constructor(
    private val dao: FamilyTaskDao,
    private val clock: Clock,
    private val outbox: FamilyTaskOutbox,
) : FamilyTaskRepository {

    override suspend fun upsert(task: FamilyTask) {
        dao.upsert(task.toEntity())
        outbox.enqueue(task) // 本地变更 → 上行同步给对端
    }

    // 收端同步写入：不触发 outbox，避免把刚收到的任务回弹给发送方 (FAMILY-67)。
    override suspend fun upsertFromSync(task: FamilyTask) = dao.upsert(task.toEntity())

    override suspend fun deleteFromSync(id: String): Boolean = dao.delete(id) > 0

    override suspend fun getById(id: String): FamilyTask? = dao.getById(id)?.toDomain()

    /** 本地变更后读最新快照排上行 (best-effort：任务已不在则跳过)。 */
    private suspend fun emitSync(id: String) {
        getById(id)?.let { outbox.enqueue(it) }
    }

    override fun observeForChild(childDid: String): Flow<List<FamilyTask>> =
        dao.observeForChild(childDid).map { list -> list.map { it.toDomain() } }

    override fun observeForChild(
        childDid: String,
        status: FamilyTaskStatus,
    ): Flow<List<FamilyTask>> =
        dao.observeForChildByStatus(childDid, status.storageValue)
            .map { list -> list.map { it.toDomain() } }

    override suspend fun activeTasksForChild(childDid: String): List<FamilyTask> =
        dao.listForChildByStatus(childDid, FamilyTaskStatus.IN_PROGRESS.storageValue)
            .map { it.toDomain() }

    override suspend fun transition(id: String, to: FamilyTaskStatus): Boolean {
        val current = dao.getById(id) ?: return false
        val from = FamilyTaskStatus.fromStorage(current.status)
        if (!from.canTransitionTo(to)) return false
        val ok = dao.updateStatus(id, to.storageValue, clock.millis()) > 0
        if (ok) emitSync(id)
        return ok
    }

    override suspend fun recordSubmission(id: String, submission: String): Boolean {
        val current = dao.getById(id) ?: return false
        val from = FamilyTaskStatus.fromStorage(current.status)
        // 提交即 IN_PROGRESS → SUBMITTED; 非进行中不允许提交。
        if (!from.canTransitionTo(FamilyTaskStatus.SUBMITTED)) return false
        val now = clock.millis()
        val ok = dao.recordSubmission(
            id = id,
            submission = submission,
            submittedAt = now,
            status = FamilyTaskStatus.SUBMITTED.storageValue,
            updatedAt = now,
        ) > 0
        if (ok) emitSync(id)
        return ok
    }

    override suspend fun recordAiGrade(id: String, aiGrade: String): Boolean {
        val ok = dao.updateAiGrade(id, aiGrade, clock.millis()) > 0
        if (ok) emitSync(id)
        return ok
    }

    override suspend fun recordParentReview(id: String, review: String): Boolean {
        val ok = dao.updateParentReview(id, review, clock.millis()) > 0
        if (ok) emitSync(id)
        return ok
    }

    override suspend fun appendAiCall(id: String, entry: AiCallLogEntry): Boolean {
        // 任务必须存在 (getAiCallLog 对不存在 id 返 null, 与"空 log"无法区分, 故先查存在性)。
        if (dao.getById(id) == null) return false
        val updated = AiCallLogCodec.append(dao.getAiCallLog(id), entry)
        val ok = dao.updateAiCallLog(id, updated, clock.millis()) > 0
        if (ok) emitSync(id)
        return ok
    }

    override suspend fun delete(id: String): Boolean {
        val ok = dao.delete(id) > 0
        if (ok) outbox.enqueueDelete(id)
        return ok
    }

    override suspend fun deleteTerminalOlderThan(cutoffMs: Long): Int =
        dao.deleteTerminalOlderThan(cutoffMs)

    private fun FamilyTask.toEntity() = FamilyTaskEntity(
        id = id,
        familyGroupId = familyGroupId,
        assignerDid = assignerDid,
        childDid = childDid,
        source = source.storageValue,
        type = type.storageValue,
        title = title,
        description = description,
        subject = subject,
        gradeLevel = gradeLevel,
        attachments = attachments,
        dueAt = dueAtMs,
        reminderAt = reminderAtMs,
        hardConstraint = hardConstraint,
        rewardPoints = rewardPoints,
        status = status.storageValue,
        submittedAt = submittedAtMs,
        submission = submission,
        aiGrade = aiGrade,
        parentReview = parentReview,
        aiCallLog = aiCallLog,
        createdAt = createdAtMs,
        updatedAt = updatedAtMs,
    )

    private fun FamilyTaskEntity.toDomain() = FamilyTask(
        id = id,
        familyGroupId = familyGroupId,
        assignerDid = assignerDid,
        childDid = childDid,
        source = FamilyTaskSource.fromStorage(source),
        type = FamilyTaskType.fromStorage(type),
        title = title,
        description = description,
        subject = subject,
        gradeLevel = gradeLevel,
        attachments = attachments,
        dueAtMs = dueAt,
        reminderAtMs = reminderAt,
        hardConstraint = hardConstraint,
        rewardPoints = rewardPoints,
        status = FamilyTaskStatus.fromStorage(status),
        submittedAtMs = submittedAt,
        submission = submission,
        aiGrade = aiGrade,
        parentReview = parentReview,
        aiCallLog = aiCallLog,
        createdAtMs = createdAt,
        updatedAtMs = updatedAt,
    )
}
