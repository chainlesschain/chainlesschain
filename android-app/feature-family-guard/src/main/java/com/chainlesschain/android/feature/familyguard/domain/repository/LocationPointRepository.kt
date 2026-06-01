package com.chainlesschain.android.feature.familyguard.domain.repository

import com.chainlesschain.android.feature.familyguard.data.entity.LocationPointEntity

/**
 * 位置点仓库 (FAMILY-50，主文档 §3.8)。
 *
 * 采集/调频/省电策略在 FAMILY-51/56；本仓库只管落库 + 查询 + 过期清理。
 */
interface LocationPointRepository {

    /** 批量记录位置点；返回插入行 id（IGNORE 冲突时该项为负）。 */
    suspend fun record(points: List<LocationPointEntity>): List<Long>

    /** 某孩子自 [sinceMs] 起的位置点（时间倒序）。 */
    suspend fun querySince(childDid: String, sinceMs: Long): List<LocationPointEntity>

    /** 删除早于 [cutoffMs] 的点（§4.6 生命周期）。@return 删除行数。 */
    suspend fun deleteOlderThan(cutoffMs: Long): Int
}
