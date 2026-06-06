package com.chainlesschain.android.feature.familyguard.domain.task

/**
 * M5 任务/作业领域模型 (主文档 §3.5 `family_task`).
 *
 * 完整 23 字段持久层投影; 由 [com.chainlesschain.android.feature.familyguard.domain.repository.FamilyTaskRepository]
 * 与 entity 互转。AI 陪学 (aistudy) 侧只消费 status / 引导模式, 见 :app StudyTaskContext。
 */
data class FamilyTask(
    val id: String,
    val familyGroupId: String,
    /** v0.2: 布置者 DID (家长/爷爷辅导作业都算)。 */
    val assignerDid: String,
    val childDid: String,
    val source: FamilyTaskSource = FamilyTaskSource.PARENT,
    val type: FamilyTaskType = FamilyTaskType.HOMEWORK,
    val title: String,
    val description: String = "",
    /** 13 学科 code (主文档 §3.6); null = 非学科任务 (如 chore)。 */
    val subject: String? = null,
    /** 学段 code P1-P6/M1-M3/H1-H3; null = 不限。 */
    val gradeLevel: String? = null,
    val attachments: String? = null,
    val dueAtMs: Long? = null,
    val reminderAtMs: Long? = null,
    /** 硬约束 JSON (M4 联动: 完成前禁某 app 等)。 */
    val hardConstraint: String? = null,
    val rewardPoints: Int = 0,
    val status: FamilyTaskStatus = FamilyTaskStatus.ASSIGNED,
    val submittedAtMs: Long? = null,
    val submission: String? = null,
    val aiGrade: String? = null,
    val parentReview: String? = null,
    /** 防作弊 AI 调用 log JSON 数组 (主文档 §3.5 ai_call_log)。 */
    val aiCallLog: String? = null,
    val createdAtMs: Long,
    val updatedAtMs: Long,
)

/** 任务类型 (主文档 §3.5 表)。 */
enum class FamilyTaskType(val storageValue: String) {
    HOMEWORK("homework"),
    CHORE("chore"),
    EXERCISE("exercise"),
    READING("reading"),
    CUSTOM("custom"),
    ;

    companion object {
        fun fromStorage(value: String): FamilyTaskType =
            entries.firstOrNull { it.storageValue == value } ?: CUSTOM
    }
}

/** 任务来源 (主文档 §3.5 v0.2 source enum)。 */
enum class FamilyTaskSource(val storageValue: String) {
    PARENT("parent"),
    SCHOOL_WECHAT_GROUP("school_wechat_group"),
    SCHOOL_QQ_GROUP("school_qq_group"),
    APP_HOMEWORK_HELPER("app_homework_helper"),
    AI_SUGGESTED("ai_suggested"),
    ;

    companion object {
        fun fromStorage(value: String): FamilyTaskSource =
            entries.firstOrNull { it.storageValue == value } ?: PARENT
    }
}

/**
 * 任务状态机 (主文档 §3.5)。合法流转:
 *
 * ```
 * SUGGESTED ─▶ ASSIGNED ─▶ IN_PROGRESS ─▶ SUBMITTED ─▶ GRADED ─▶ DONE
 *     │            │             │             │
 *     └────────────┴─────────────┴─────────────┴──────────▶ CANCELLED
 * ```
 *
 * 群作业自动导入先落 [SUGGESTED] 待家长确认 → [ASSIGNED]。
 */
enum class FamilyTaskStatus(val storageValue: String) {
    /** 群作业自动识别, 待家长确认 (主文档 §3.5 suggested_pending_parent_review)。 */
    SUGGESTED("suggested_pending_parent_review"),
    ASSIGNED("assigned"),
    IN_PROGRESS("in_progress"),
    SUBMITTED("submitted"),
    GRADED("graded"),
    DONE("done"),
    CANCELLED("cancelled"),
    ;

    /** 是否可流转到 [next] (非法流转被 repository 拒绝)。 */
    fun canTransitionTo(next: FamilyTaskStatus): Boolean = next in allowedNext()

    private fun allowedNext(): Set<FamilyTaskStatus> = when (this) {
        SUGGESTED -> setOf(ASSIGNED, CANCELLED)
        ASSIGNED -> setOf(IN_PROGRESS, CANCELLED)
        IN_PROGRESS -> setOf(SUBMITTED, CANCELLED)
        SUBMITTED -> setOf(GRADED, IN_PROGRESS, CANCELLED) // 打回重做 → IN_PROGRESS
        GRADED -> setOf(DONE, IN_PROGRESS, CANCELLED) // 家长不满意可打回
        DONE -> emptySet()
        CANCELLED -> emptySet()
    }

    companion object {
        fun fromStorage(value: String): FamilyTaskStatus =
            entries.firstOrNull { it.storageValue == value } ?: ASSIGNED
    }
}
