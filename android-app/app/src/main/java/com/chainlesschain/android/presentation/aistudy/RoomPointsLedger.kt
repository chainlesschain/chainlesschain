package com.chainlesschain.android.presentation.aistudy

import com.chainlesschain.android.feature.familyguard.data.dao.PointsEventDao
import com.chainlesschain.android.feature.familyguard.data.entity.PointsEventEntity
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

/**
 * M9 积分账本真持久实现 (主文档 §3.9): family_guard.db `points_event` 表
 * (SQLCipher 加密, :feature-family-guard [PointsEventDao])。
 *
 * 账本 append-only, 聚合查询 (同 task 去重 / 今日累计) 下推 SQL。type 存小写
 * (earn/spend/...), 与 DAO 查询字面量对齐; 未知 type (未来版本 P2P 同步来的新枚举)
 * 解码时丢弃而非崩。
 */
@Singleton
class RoomPointsLedger @Inject constructor(
    private val dao: PointsEventDao,
) : PointsLedger {

    override val events: Flow<List<PointsEvent>> =
        dao.observeAll().map { list -> list.mapNotNull { it.toDomain() } }

    override suspend fun balanceOf(childDid: String, now: Long): PointsBalance =
        PointsEngine.computeBalance(
            childDid = childDid,
            events = dao.listForChild(childDid).mapNotNull { it.toDomain() },
            updatedAt = now,
        )

    override suspend fun append(event: PointsEvent) {
        dao.insert(event.toEntity())
    }

    override suspend fun hasEarnedForTask(childDid: String, taskId: String): Boolean =
        dao.countEarnForTask(childDid, taskId) > 0

    override suspend fun earnedBetween(childDid: String, dayStart: Long, dayEnd: Long): Int =
        dao.sumEarnedBetween(childDid, dayStart, dayEnd)

    override suspend fun grantedBetween(
        granterDid: String,
        childDid: String,
        dayStart: Long,
        dayEnd: Long,
    ): Int = dao.sumGrantedBetween(granterDid, childDid, dayStart, dayEnd)

    override suspend fun redeemCountBetween(
        childDid: String,
        rewardId: String,
        dayStart: Long,
        dayEnd: Long,
    ): Int = dao.countRedeemsBetween(childDid, rewardId, dayStart, dayEnd)

    private fun PointsEvent.toEntity() = PointsEventEntity(
        id = id,
        childDid = childDid,
        type = type.name.lowercase(),
        amount = amount,
        reason = reason,
        relatedTaskId = relatedTaskId,
        relatedRewardId = relatedRewardId,
        granterDid = granterDid,
        timestamp = timestamp,
    )

    private fun PointsEventEntity.toDomain(): PointsEvent? {
        val eventType = PointsEventType.entries.firstOrNull { it.name.equals(type, ignoreCase = true) }
            ?: return null
        return PointsEvent(
            id = id,
            childDid = childDid,
            type = eventType,
            amount = amount,
            reason = reason,
            relatedTaskId = relatedTaskId,
            relatedRewardId = relatedRewardId,
            granterDid = granterDid,
            timestamp = timestamp,
        )
    }
}
