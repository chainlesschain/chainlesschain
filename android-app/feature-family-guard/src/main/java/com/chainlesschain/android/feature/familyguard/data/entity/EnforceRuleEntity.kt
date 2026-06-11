package com.chainlesschain.android.feature.familyguard.data.entity

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * M4 管控规则 (FAMILY-02 placeholder schema, populated alongside Epic Enforce
 * in v0.2; FAMILY-01..67 v0.1 仅落 schema + Repo skeleton)。
 *
 * 主文档 §3.4. rule_type ∈
 *   { 'app_time_limit', 'app_blocklist', 'time_window',
 *     'payment_cap', 'website_blocklist' }
 *
 * enforce_level ∈ {1=提示, 2=DPC, 3=VPN, 4=root}; 对应 4 档防御。
 *
 * source_priority (v0.2 多家长冲突解决): primary=1 / secondary=2; 解析在
 * RuleMerger (主文档 §3.4 v0.2 "多家长规则冲突解决")。
 *
 * v8 (M9→M4): 加 expires_at — NULL = 永久规则; 非 NULL = 到期自动失效
 * (积分兑换下发的 'temp_exception' 临时白名单, 见 RewardTempException)。
 */
@Entity(
    tableName = "enforce_rules",
    indices = [
        Index(value = ["rule_type"]),
        Index(value = ["target"]),
        Index(value = ["source_did"]),
        Index(value = ["active"]),
        Index(value = ["active", "expires_at"]),
    ],
)
data class EnforceRuleEntity(
    @PrimaryKey(autoGenerate = true)
    @ColumnInfo(name = "id")
    val id: Long = 0L,

    @ColumnInfo(name = "rule_type")
    val ruleType: String,

    @ColumnInfo(name = "target")
    val target: String,

    @ColumnInfo(name = "config")
    val config: String,

    @ColumnInfo(name = "enforce_level")
    val enforceLevel: Int,

    @ColumnInfo(name = "active")
    val active: Boolean = true,

    @ColumnInfo(name = "source_did")
    val sourceDid: String,

    @ColumnInfo(name = "source_priority")
    val sourcePriority: Int = 2,

    @ColumnInfo(name = "created_at")
    val createdAt: Long,

    /** 到期时间 (ms); NULL = 永久。到期规则查询时过滤 + deactivateExpired 批量下线。 */
    @ColumnInfo(name = "expires_at")
    val expiresAt: Long? = null,
)
