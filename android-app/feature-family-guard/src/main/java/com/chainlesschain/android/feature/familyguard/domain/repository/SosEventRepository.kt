package com.chainlesschain.android.feature.familyguard.domain.repository

import com.chainlesschain.android.feature.familyguard.data.entity.SosEventEntity
import com.chainlesschain.android.feature.familyguard.domain.sos.SosTransitionResult
import com.chainlesschain.android.feature.familyguard.domain.sos.SosTriggerSource

/**
 * SOS 事件仓储 (FAMILY-40, M7). 触发 + 状态机转换 + 查询。时刻走 TimeAuthority 权威时间
 * (防改钟误记紧急事件时序)。
 *
 * 状态机 (主文档 §3.7): PENDING → ACKNOWLEDGED → RESOLVED; PENDING → RESOLVED;
 * PENDING → FALSE_ALARM。转换均带 WHERE status 守卫, 并发 race 安全。
 *
 * 不在本 ticket: 5min 误触撤销窗口 + 60s 兜底升级 (FAMILY-44/45)、broadcast call
 * (FAMILY-43)、设备触发硬件 (FAMILY-41)、录音/位置采集 (FAMILY-42)。
 */
interface SosEventRepository {

    /**
     * 触发一条 SOS (status=pending)。生成 ULID id, triggeredAt = 权威时间。
     * @return 落库后的事件实体。
     */
    suspend fun trigger(
        childDid: String,
        familyGroupId: String,
        source: SosTriggerSource,
        locationSnapshot: String? = null,
        audioRecordingRef: String? = null,
    ): SosEventEntity

    /** PENDING → ACKNOWLEDGED (某 guardian 接通/确认)。 */
    suspend fun acknowledge(id: String, guardianDid: String): SosTransitionResult

    /** PENDING / ACKNOWLEDGED → RESOLVED (处理结束)。 */
    suspend fun resolve(id: String, note: String? = null): SosTransitionResult

    /** PENDING → FALSE_ALARM (误触撤销)。 */
    suspend fun cancelAsFalseAlarm(id: String, reason: String): SosTransitionResult

    /** 观察所有 pending SOS (家长端待处理列表)。 */
    fun observePending(): kotlinx.coroutines.flow.Flow<List<SosEventEntity>>

    /** 观察某 child 最近 N 条 SOS (历史)。 */
    fun observeRecentForChild(
        childDid: String,
        limit: Int = 50,
    ): kotlinx.coroutines.flow.Flow<List<SosEventEntity>>

    suspend fun findById(id: String): SosEventEntity?
}
