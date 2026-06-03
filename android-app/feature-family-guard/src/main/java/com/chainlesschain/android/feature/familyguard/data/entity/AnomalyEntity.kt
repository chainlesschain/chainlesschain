package com.chainlesschain.android.feature.familyguard.data.entity

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * 检出的异常事件 (FAMILY-27, Epic C M2, schema v4).
 *
 * 由 [com.chainlesschain.android.feature.familyguard.domain.anomaly.AnomalyDetector]
 * 检出 → [com.chainlesschain.android.feature.familyguard.data.repository.AnomalyRepositoryImpl]
 * 落库 → 家长端 dashboard 展示 (FAMILY-67)。
 *
 * [dedupKey] UNIQUE: 同一异常 (同 app 同日 / 同夜 / 同充值日) 每 15min 复扫生成同 key,
 * insert OnConflict IGNORE 去重 → 不重复落库, 家长只收一次推送。
 *
 * @property type [com.chainlesschain.android.feature.familyguard.domain.anomaly.AnomalyType] storageValue
 * @property severity [com.chainlesschain.android.feature.familyguard.domain.anomaly.AnomalySeverity] storageValue
 * @property acknowledged 家长是否已读
 */
@Entity(
    tableName = "anomaly",
    indices = [
        Index(value = ["dedup_key"], unique = true, name = "ux_anomaly_dedup_key"),
        Index(value = ["child_did", "detected_at"], name = "idx_anomaly_child_time"),
    ],
)
data class AnomalyEntity(
    @PrimaryKey(autoGenerate = true)
    @ColumnInfo(name = "id")
    val id: Long = 0L,

    @ColumnInfo(name = "child_did")
    val childDid: String,

    @ColumnInfo(name = "type")
    val type: String,

    @ColumnInfo(name = "severity")
    val severity: String,

    @ColumnInfo(name = "dedup_key")
    val dedupKey: String,

    @ColumnInfo(name = "summary")
    val summary: String,

    @ColumnInfo(name = "detail")
    val detail: String,

    @ColumnInfo(name = "detected_at")
    val detectedAt: Long,

    @ColumnInfo(name = "acknowledged")
    val acknowledged: Boolean = false,

    @ColumnInfo(name = "created_at")
    val createdAt: Long,
)
