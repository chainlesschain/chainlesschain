package com.chainlesschain.android.feature.familyguard.data.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.chainlesschain.android.feature.familyguard.data.entity.PointsEventEntity
import kotlinx.coroutines.flow.Flow

/**
 * M9 points_event DAO (主文档 §3.9)。
 *
 * 流水 append-only: 只 INSERT (IGNORE 防 P2P 重放重复 id), 无 UPDATE/单行 DELETE。
 * 聚合查询 (今日 earn/grant 累计、同 task 去重) 直接下推 SQL, 供 :app PointsLedger 实现。
 */
@Dao
interface PointsEventDao {

    /** 追加一条流水; 重复 id (P2P 重放) 静默忽略。返回 rowId, -1 = 已存在。 */
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insert(entity: PointsEventEntity): Long

    @Query("SELECT * FROM points_event ORDER BY timestamp ASC, id ASC")
    fun observeAll(): Flow<List<PointsEventEntity>>

    @Query(
        """
        SELECT * FROM points_event
         WHERE child_did = :childDid
         ORDER BY timestamp ASC, id ASC
        """,
    )
    suspend fun listForChild(childDid: String): List<PointsEventEntity>

    /** 同 task 是否已 earn 过 (防重复发放)。 */
    @Query(
        """
        SELECT COUNT(*) FROM points_event
         WHERE child_did = :childDid AND type = 'earn' AND related_task_id = :taskId
        """,
    )
    suspend fun countEarnForTask(childDid: String, taskId: String): Int

    /** [dayStart, dayEnd) 区间内 earn 累计 (单日上限用)。 */
    @Query(
        """
        SELECT COALESCE(SUM(amount), 0) FROM points_event
         WHERE child_did = :childDid AND type = 'earn'
           AND timestamp >= :dayStart AND timestamp < :dayEnd
        """,
    )
    suspend fun sumEarnedBetween(childDid: String, dayStart: Long, dayEnd: Long): Int

    /** 区间内某 guardian 对某 child 的 grant 累计 (单日发放上限用)。 */
    @Query(
        """
        SELECT COALESCE(SUM(amount), 0) FROM points_event
         WHERE granter_did = :granterDid AND child_did = :childDid AND type = 'grant'
           AND timestamp >= :dayStart AND timestamp < :dayEnd
        """,
    )
    suspend fun sumGrantedBetween(
        granterDid: String,
        childDid: String,
        dayStart: Long,
        dayEnd: Long,
    ): Int

    /** 区间内某 reward 的兑换次数 (单日兑换上限用)。 */
    @Query(
        """
        SELECT COUNT(*) FROM points_event
         WHERE child_did = :childDid AND type = 'spend' AND related_reward_id = :rewardId
           AND timestamp >= :dayStart AND timestamp < :dayEnd
        """,
    )
    suspend fun countRedeemsBetween(
        childDid: String,
        rewardId: String,
        dayStart: Long,
        dayEnd: Long,
    ): Int

    @Query("SELECT COUNT(*) FROM points_event")
    suspend fun count(): Int
}
