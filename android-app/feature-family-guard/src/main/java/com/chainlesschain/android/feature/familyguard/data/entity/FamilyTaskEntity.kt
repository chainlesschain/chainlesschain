package com.chainlesschain.android.feature.familyguard.data.entity

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * M5 任务/作业 (FAMILY-? Epic, 主文档 §3.5 `family_task`).
 *
 * 23 字段全落地。id 为 TEXT PK (调用方生成 UUID, 便于 P2P 同步跨设备一致)。
 * status / type / source 存枚举 storageValue 字符串。ai_call_log 存 JSON 数组 (防作弊)。
 */
@Entity(
    tableName = "family_task",
    indices = [
        Index(value = ["child_did", "status"], name = "idx_family_task_child_status"),
        Index(value = ["family_group_id"], name = "idx_family_task_group"),
        Index(value = ["due_at"], name = "idx_family_task_due"),
    ],
)
data class FamilyTaskEntity(
    @PrimaryKey
    @ColumnInfo(name = "id")
    val id: String,

    @ColumnInfo(name = "family_group_id")
    val familyGroupId: String,

    @ColumnInfo(name = "assigner_did")
    val assignerDid: String,

    @ColumnInfo(name = "child_did")
    val childDid: String,

    @ColumnInfo(name = "source")
    val source: String,

    @ColumnInfo(name = "type")
    val type: String,

    @ColumnInfo(name = "title")
    val title: String,

    @ColumnInfo(name = "description")
    val description: String,

    @ColumnInfo(name = "subject")
    val subject: String?,

    @ColumnInfo(name = "grade_level")
    val gradeLevel: String?,

    @ColumnInfo(name = "attachments")
    val attachments: String?,

    @ColumnInfo(name = "due_at")
    val dueAt: Long?,

    @ColumnInfo(name = "reminder_at")
    val reminderAt: Long?,

    @ColumnInfo(name = "hard_constraint")
    val hardConstraint: String?,

    @ColumnInfo(name = "reward_points")
    val rewardPoints: Int = 0,

    @ColumnInfo(name = "status")
    val status: String,

    @ColumnInfo(name = "submitted_at")
    val submittedAt: Long?,

    @ColumnInfo(name = "submission")
    val submission: String?,

    @ColumnInfo(name = "ai_grade")
    val aiGrade: String?,

    @ColumnInfo(name = "parent_review")
    val parentReview: String?,

    @ColumnInfo(name = "ai_call_log")
    val aiCallLog: String?,

    @ColumnInfo(name = "created_at")
    val createdAt: Long,

    @ColumnInfo(name = "updated_at")
    val updatedAt: Long,
)
