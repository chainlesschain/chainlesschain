package com.chainlesschain.android.feature.familyguard.domain.repository

import com.chainlesschain.android.feature.familyguard.data.entity.AnomalyEntity
import com.chainlesschain.android.feature.familyguard.domain.anomaly.DetectedAnomaly
import kotlinx.coroutines.flow.Flow

/**
 * 异常事件仓储 (FAMILY-27). [com.chainlesschain.android.feature.familyguard.domain.anomaly.AnomalyDetector]
 * 检出 → [record] 落库 (去重) → 家长端 dashboard ([observeRecent]) 展示。
 */
interface AnomalyRepository {

    /**
     * 落一条检出的异常。anomaly 表对 dedup_key 建 UNIQUE INDEX + insert OnConflict
     * IGNORE → 同 key 重复检出不重复落库。
     *
     * @return 新行 rowId (> 0); 去重命中 (已存在同 dedup_key) 返 ≤ 0。调用方据此决定是否推送。
     */
    suspend fun record(anomaly: DetectedAnomaly): Long

    /** UI 观察某 child 最近 N 条异常 (按检出时间倒序)。 */
    fun observeRecent(childDid: String, limit: Int = 50): Flow<List<AnomalyEntity>>

    /** 标记一条异常已读 (家长查看后)。 */
    suspend fun acknowledge(id: Long): Boolean

    /** 数据生命周期清理 (主文档 §4.6); 删 [cutoffMs] 之前检出的异常。 */
    suspend fun deleteOlderThan(cutoffMs: Long): Int
}
