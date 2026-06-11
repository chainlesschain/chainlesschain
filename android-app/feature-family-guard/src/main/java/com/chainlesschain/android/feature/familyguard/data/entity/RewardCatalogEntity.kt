package com.chainlesschain.android.feature.familyguard.data.entity

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * M9 兑换目录 (主文档 §3.9 `reward_catalog`).
 *
 * id 为 TEXT PK (调用方生成, 便于 P2P 同步与种子目录固定 id 幂等)。
 * deliverable 拆平为 kind/value/target_apps 三列 (kind 与 :app DeliverableKind.name
 * 对齐; target_apps 逗号分隔包名 — 包名不含逗号, 不需 JSON)。下架走 active=0 软删
 * (历史流水 related_reward_id 仍可回查)。
 */
@Entity(
    tableName = "reward_catalog",
    indices = [
        Index(value = ["family_group_id"], name = "idx_reward_catalog_group"),
        Index(value = ["active"], name = "idx_reward_catalog_active"),
    ],
)
data class RewardCatalogEntity(
    @PrimaryKey
    @ColumnInfo(name = "id")
    val id: String,

    @ColumnInfo(name = "family_group_id")
    val familyGroupId: String,

    @ColumnInfo(name = "name")
    val name: String,

    @ColumnInfo(name = "description")
    val description: String,

    @ColumnInfo(name = "cost")
    val cost: Int,

    /** DeliverableKind.name (SCREEN_TIME_MIN / APP_UNLOCK / ...)。 */
    @ColumnInfo(name = "deliverable_kind")
    val deliverableKind: String,

    /** 分钟数 / 金额, 按 kind 解释 (与 RewardTempException 契约一致: 时长一律分钟)。 */
    @ColumnInfo(name = "deliverable_value")
    val deliverableValue: Int,

    /** 逗号分隔目标包名; 空串 = 无。 */
    @ColumnInfo(name = "target_apps")
    val targetApps: String,

    /** 单日兑换上限; 0 = 无限。 */
    @ColumnInfo(name = "max_per_day")
    val maxPerDay: Int,

    @ColumnInfo(name = "active")
    val active: Boolean = true,

    @ColumnInfo(name = "created_by")
    val createdBy: String,

    @ColumnInfo(name = "created_at")
    val createdAt: Long,
)
