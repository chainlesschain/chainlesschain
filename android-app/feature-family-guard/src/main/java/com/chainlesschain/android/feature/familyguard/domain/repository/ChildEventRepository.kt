package com.chainlesschain.android.feature.familyguard.domain.repository

import com.chainlesschain.android.feature.familyguard.data.entity.ChildEventEntity
import com.chainlesschain.android.feature.familyguard.domain.telemetry.ForegroundAppRun
import com.chainlesschain.android.feature.familyguard.domain.telemetry.TelemetryEvent
import kotlinx.coroutines.flow.Flow

/**
 * Child telemetry events repo (FAMILY-20).
 *
 * 接所有 telemetry 上游 (PDH collector / ForegroundAppTimer / Snapshot writer);
 * 上行权限过滤 + 加密 sync 留 FAMILY-25 (FamilyPermissionChecker 接通 +
 * Sync engine backpressure).
 *
 * 主文档 §3.2 v0.2 数据级别:
 *   - L0: 聚合 ('今天用了 X 小时游戏')
 *   - L1: app + 时长 (本 ticket 的 ForegroundAppRun)
 *   - L2: 内容 (聊天 / 订单, 默认关; 需家长申请 + 孩子同意)
 *   - L3: 屏幕 (截图 / 录屏, 仅触发开)
 */
interface ChildEventRepository {

    /** 写一条已 finalized 的前台 app run; level 固定 'L1'. */
    suspend fun saveForegroundAppRun(childDid: String, run: ForegroundAppRun): Long

    /** 通用写入入口; 其他 source (PDH, snapshot, etc.) 调本接口. */
    suspend fun saveEvent(event: ChildEventEntity): Long

    /**
     * 类型化 TelemetryEvent 入口 (FAMILY-21). 走 [TelemetryEventConverter] 转
     * ChildEventEntity 后插库; 是 [TelemetrySource] 实装的标准写入路径。
     */
    suspend fun saveTelemetryEvent(event: TelemetryEvent): Long

    suspend fun querySince(childDid: String, sinceMs: Long): List<ChildEventEntity>

    /** UI 观察最近 N 条事件. */
    fun observeRecent(childDid: String, limit: Int = 50): Flow<List<ChildEventEntity>>

    /** 数据生命周期清理 (主文档 §4.6); 默认 90d 前的删. */
    suspend fun deleteOlderThan(cutoffMs: Long): Int
}
