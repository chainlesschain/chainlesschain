package com.chainlesschain.android.feature.familyguard.data.entity

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * 家庭成员 (FAMILY-02 placeholder schema, populated in FAMILY-11).
 *
 * 主文档 §3.1 v0.2: 一个孩子可绑多设备 → UNIQUE 含 device_id; 一个 group 内可有
 * 多 parent / guardian (含 tier) + 多 child (家庭组支持多孩子)。
 *
 * @property role 'parent' | 'child' | 'guardian'
 * @property guardianTier 'primary' | 'secondary' | null (child 为 null)
 * @property status 'active' | 'inactive'
 */
@Entity(
    tableName = "family_membership",
    indices = [
        Index(
            value = ["family_group_id", "member_did", "device_id"],
            unique = true,
            name = "ux_family_membership_group_member_device",
        ),
        Index(value = ["family_group_id"]),
        Index(value = ["member_did"]),
    ],
)
data class FamilyMembershipEntity(
    @PrimaryKey(autoGenerate = true)
    @ColumnInfo(name = "id")
    val id: Long = 0L,

    @ColumnInfo(name = "family_group_id")
    val familyGroupId: String,

    @ColumnInfo(name = "member_did")
    val memberDid: String,

    @ColumnInfo(name = "role")
    val role: String,

    @ColumnInfo(name = "guardian_tier")
    val guardianTier: String? = null,

    @ColumnInfo(name = "device_id")
    val deviceId: String,

    @ColumnInfo(name = "joined_at")
    val joinedAt: Long,

    @ColumnInfo(name = "status")
    val status: String = "active",
)
