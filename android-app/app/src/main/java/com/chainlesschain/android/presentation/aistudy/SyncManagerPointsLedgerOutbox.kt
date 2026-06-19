package com.chainlesschain.android.presentation.aistudy

import com.chainlesschain.android.core.p2p.sync.ResourceType
import com.chainlesschain.android.core.p2p.sync.SyncItem
import com.chainlesschain.android.core.p2p.sync.SyncManager
import com.chainlesschain.android.core.p2p.sync.SyncOperation
import javax.inject.Inject
import javax.inject.Singleton
import timber.log.Timber

/**
 * [PointsLedgerOutbox] 的 :app 真实实装 (FAMILY-67 积分上行)。
 *
 * 把本机新增的 [PointsEvent] 包成 [ResourceType.POINTS_EVENT] 的 [SyncItem] 排入
 * [SyncManager] pendingChanges；SyncCoordinator 推到已配对对端。镜像
 * `SyncManagerFamilyGroupOutbox` 模式。
 *
 * resourceId 稳定 (`points_event|id`) → 同一流水重复 enqueue 不重复入队 (recordChange 以
 * resourceId 为 key)。append-only，故 operation 恒 CREATE。
 */
@Singleton
class SyncManagerPointsLedgerOutbox @Inject constructor(
    private val syncManager: SyncManager,
) : PointsLedgerOutbox {

    override suspend fun enqueue(event: PointsEvent) {
        val item = SyncItem(
            resourceId = "points_event|${event.id}",
            resourceType = ResourceType.POINTS_EVENT,
            operation = SyncOperation.CREATE,
            data = PointsEventSyncData.encode(event),
            timestamp = event.timestamp,
        )
        syncManager.recordChange(item)
        Timber.d("points_event → sync queue: %s", item.resourceId)
    }
}
