package com.chainlesschain.android.feature.familyguard.data.entity

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * 不可删审计日志 (FAMILY-63, schema v5). 主文档 §4.6: 所有家庭动作 (配对/解绑/规则/SOS/
 * 强接通/静音旁观/暂停) 写此表; 2y 保留, **不可删** (法律要求)。
 *
 * **append-only**: [com.chainlesschain.android.feature.familyguard.data.dao.AuditLogDao]
 * 只暴露 insert + query, **无 update/delete** —— API 层面强制不可变。
 * [com.chainlesschain.android.feature.familyguard.data.lifecycle.DataLifecycleCleaner]
 * (FAMILY-28) 也**不碰**本表 (§4.6 不可删)。
 *
 * @property actorDid 动作发起方 DID; 系统动作 (如清理) 用 "system"
 * @property action [com.chainlesschain.android.feature.familyguard.domain.audit.AuditAction] storageValue
 * @property targetDid 受影响方 DID (如被解绑的 child); 可空
 * @property timestamp 动作发生时刻 epoch ms
 */
@Entity(
    tableName = "audit_log",
    indices = [
        Index(value = ["timestamp"], name = "idx_audit_log_timestamp"),
        Index(value = ["family_group_id", "timestamp"], name = "idx_audit_log_group_time"),
        Index(value = ["action"], name = "idx_audit_log_action"),
    ],
)
data class AuditLogEntity(
    @PrimaryKey(autoGenerate = true)
    @ColumnInfo(name = "id")
    val id: Long = 0L,

    @ColumnInfo(name = "actor_did")
    val actorDid: String,

    @ColumnInfo(name = "action")
    val action: String,

    @ColumnInfo(name = "target_did")
    val targetDid: String? = null,

    @ColumnInfo(name = "family_group_id")
    val familyGroupId: String? = null,

    @ColumnInfo(name = "detail")
    val detail: String = "",

    @ColumnInfo(name = "timestamp")
    val timestamp: Long,

    @ColumnInfo(name = "created_at")
    val createdAt: Long,
)
