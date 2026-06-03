package com.chainlesschain.android.feature.familyguard.data.entity

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * 亲子特殊好友关系 (FAMILY-02 placeholder schema, populated in FAMILY-12).
 *
 * 主文档 §3.1 v0.2 核心表。包含:
 * - 不对称权限 (permissions JSON, 解析 in FAMILY-12)
 * - 紧急联系人 (emergency_contacts JSON, 用于 SOS 兜底; M7)
 * - 24h 冷却解绑 (unbind_request / cooldown_until / requester; FAMILY-15)
 * - 紧急解绑通道 (emergency_unbind_at / reason; FAMILY-16)
 *
 * status 状态机:
 *   active → unbind_pending → unbound
 *   active → emergency_unbound (绕过冷却)
 *   active → frozen (无监护警报, 等 primary 指定接班人)
 */
@Entity(
    tableName = "family_relationship",
    indices = [
        Index(
            value = ["family_group_id", "friend_did", "role_self", "role_other"],
            unique = true,
            name = "ux_family_rel_group_friend_roles",
        ),
        Index(value = ["family_group_id"]),
        Index(value = ["status"]),
    ],
)
data class FamilyRelationshipEntity(
    @PrimaryKey(autoGenerate = true)
    @ColumnInfo(name = "id")
    val id: Long = 0L,

    @ColumnInfo(name = "family_group_id")
    val familyGroupId: String,

    @ColumnInfo(name = "friend_did")
    val friendDid: String,

    @ColumnInfo(name = "role_self")
    val roleSelf: String,

    @ColumnInfo(name = "role_other")
    val roleOther: String,

    @ColumnInfo(name = "guardian_tier_other")
    val guardianTierOther: String? = null,

    @ColumnInfo(name = "bound_at")
    val boundAt: Long,

    @ColumnInfo(name = "bound_evidence")
    val boundEvidence: String? = null,

    @ColumnInfo(name = "permissions")
    val permissions: String,

    @ColumnInfo(name = "emergency_contacts")
    val emergencyContacts: String? = null,

    @ColumnInfo(name = "unbind_request_at")
    val unbindRequestAt: Long? = null,

    @ColumnInfo(name = "unbind_cooldown_until")
    val unbindCooldownUntil: Long? = null,

    @ColumnInfo(name = "unbind_requester")
    val unbindRequester: String? = null,

    @ColumnInfo(name = "emergency_unbind_at")
    val emergencyUnbindAt: Long? = null,

    @ColumnInfo(name = "emergency_unbind_reason")
    val emergencyUnbindReason: String? = null,

    @ColumnInfo(name = "status")
    val status: String = "active",

    @ColumnInfo(name = "created_at")
    val createdAt: Long,

    @ColumnInfo(name = "updated_at")
    val updatedAt: Long,
)
