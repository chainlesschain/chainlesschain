package com.chainlesschain.android.presentation.aistudy

import kotlinx.coroutines.flow.Flow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * [PointsLedger] 同步装饰器 (FAMILY-67 上行)。
 *
 * 本机 [append] 一条流水后，除写底层真持久账本 ([RawPointsLedger] = [RoomPointsLedger])
 * 外，额外排入 [PointsLedgerOutbox] 上行同步给对端。其余读路径全透传底层。
 *
 * **无 echo**：收端 [PointsLedgerSyncApplierImpl] 注入 `@RawPointsLedger` 底层账本写库，
 * 不经本装饰器，故同步收到的流水不会再被上行回弹给发送方。无限定符的本装饰器只给 ViewModel
 * 等本机写入方 (DI 默认绑定)。
 */
@Singleton
class SyncingPointsLedger @Inject constructor(
    @RawPointsLedger private val delegate: PointsLedger,
    private val outbox: PointsLedgerOutbox,
) : PointsLedger {

    override val events: Flow<List<PointsEvent>> = delegate.events

    override suspend fun balanceOf(childDid: String, now: Long): PointsBalance =
        delegate.balanceOf(childDid, now)

    override suspend fun append(event: PointsEvent) {
        delegate.append(event)
        outbox.enqueue(event)
    }

    override suspend fun hasEarnedForTask(childDid: String, taskId: String): Boolean =
        delegate.hasEarnedForTask(childDid, taskId)

    override suspend fun earnedBetween(childDid: String, dayStart: Long, dayEnd: Long): Int =
        delegate.earnedBetween(childDid, dayStart, dayEnd)

    override suspend fun grantedBetween(
        granterDid: String,
        childDid: String,
        dayStart: Long,
        dayEnd: Long,
    ): Int = delegate.grantedBetween(granterDid, childDid, dayStart, dayEnd)

    override suspend fun redeemCountBetween(
        childDid: String,
        rewardId: String,
        dayStart: Long,
        dayEnd: Long,
    ): Int = delegate.redeemCountBetween(childDid, rewardId, dayStart, dayEnd)
}
