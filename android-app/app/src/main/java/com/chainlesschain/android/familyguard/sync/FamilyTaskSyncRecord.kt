package com.chainlesschain.android.familyguard.sync

import com.chainlesschain.android.feature.familyguard.domain.task.FamilyTask
import com.chainlesschain.android.feature.familyguard.domain.task.FamilyTaskSource
import com.chainlesschain.android.feature.familyguard.domain.task.FamilyTaskStatus
import com.chainlesschain.android.feature.familyguard.domain.task.FamilyTaskType
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

/**
 * [FamilyTask] 的 P2P 同步线格式 (FAMILY-67 任务同步)。
 *
 * 镜像 telemetry 的 `TelemetrySyncData` 模式：feature 层领域模型 [FamilyTask] ↔ :app 层
 * `@Serializable` 线记录。枚举一律用各自 `storageValue` 字符串落线 (跨版本稳定，新增枚举值
 * 在旧端 `fromStorage` 兜底回落而非崩溃)。23 字段全量投影，round-trip 无损。
 *
 * 任务是**可变**资源 (parent→child 布置，child→parent 提交/AI 批改/家长打回)，冲突由
 * [com.chainlesschain.android.feature.familyguard.domain.task.FamilyTaskMerge] 解析；本类只管
 * 编解码，不含合并/鉴权逻辑 (那在 applier 侧)。
 */
@Serializable
data class FamilyTaskSyncRecord(
    val id: String,
    val familyGroupId: String,
    val assignerDid: String,
    val childDid: String,
    val source: String,
    val type: String,
    val title: String,
    val description: String = "",
    val subject: String? = null,
    val gradeLevel: String? = null,
    val attachments: String? = null,
    val dueAtMs: Long? = null,
    val reminderAtMs: Long? = null,
    val hardConstraint: String? = null,
    val rewardPoints: Int = 0,
    val status: String,
    val submittedAtMs: Long? = null,
    val submission: String? = null,
    val aiGrade: String? = null,
    val parentReview: String? = null,
    val aiCallLog: String? = null,
    val createdAtMs: Long,
    val updatedAtMs: Long,
) {
    fun toTask(): FamilyTask = FamilyTask(
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
        dueAtMs = dueAtMs,
        reminderAtMs = reminderAtMs,
        hardConstraint = hardConstraint,
        rewardPoints = rewardPoints,
        status = FamilyTaskStatus.fromStorage(status),
        submittedAtMs = submittedAtMs,
        submission = submission,
        aiGrade = aiGrade,
        parentReview = parentReview,
        aiCallLog = aiCallLog,
        createdAtMs = createdAtMs,
        updatedAtMs = updatedAtMs,
    )

    companion object {
        // ignoreUnknownKeys: 旧端收到新端多出的字段不崩 (镜像 TelemetryIngest 的容错取向)。
        private val json = Json { ignoreUnknownKeys = true }

        fun fromTask(task: FamilyTask): FamilyTaskSyncRecord = FamilyTaskSyncRecord(
            id = task.id,
            familyGroupId = task.familyGroupId,
            assignerDid = task.assignerDid,
            childDid = task.childDid,
            source = task.source.storageValue,
            type = task.type.storageValue,
            title = task.title,
            description = task.description,
            subject = task.subject,
            gradeLevel = task.gradeLevel,
            attachments = task.attachments,
            dueAtMs = task.dueAtMs,
            reminderAtMs = task.reminderAtMs,
            hardConstraint = task.hardConstraint,
            rewardPoints = task.rewardPoints,
            status = task.status.storageValue,
            submittedAtMs = task.submittedAtMs,
            submission = task.submission,
            aiGrade = task.aiGrade,
            parentReview = task.parentReview,
            aiCallLog = task.aiCallLog,
            createdAtMs = task.createdAtMs,
            updatedAtMs = task.updatedAtMs,
        )

        fun encode(task: FamilyTask): String = json.encodeToString(fromTask(task))

        /** 解码线格式 → 领域模型；malformed JSON 抛 [kotlinx.serialization.SerializationException]。 */
        fun decode(data: String): FamilyTask = json.decodeFromString<FamilyTaskSyncRecord>(data).toTask()
    }
}
