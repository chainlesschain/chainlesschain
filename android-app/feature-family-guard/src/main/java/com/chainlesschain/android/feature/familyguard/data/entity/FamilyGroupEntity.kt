package com.chainlesschain.android.feature.familyguard.data.entity

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * 家庭组 (FAMILY-02 placeholder schema, populated in FAMILY-10).
 *
 * 主文档 §3.1 v0.2: 一组 family_membership 共享的容器, 支持多孩子家庭 +
 * 多家长共同监护。`primary_did` 是创建人 (默认 primary guardian)。
 *
 * @property id ULID
 * @property name 家庭显示名 (e.g. "陈家")
 * @property primaryDid 创建人 DID
 * @property createdAt 创建时间戳 (ms)
 * @property metadataJson 家庭照 / 约定 / 共同价值观, JSON 自由结构
 */
@Entity(tableName = "family_group")
data class FamilyGroupEntity(
    @PrimaryKey
    @ColumnInfo(name = "id")
    val id: String,

    @ColumnInfo(name = "name")
    val name: String,

    @ColumnInfo(name = "primary_did")
    val primaryDid: String,

    @ColumnInfo(name = "created_at")
    val createdAt: Long,

    @ColumnInfo(name = "metadata_json")
    val metadataJson: String? = null,
)
