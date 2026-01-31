package com.chainlesschain.android.core.database.dao.call

import androidx.room.*
import com.chainlesschain.android.core.database.entity.call.CallHistoryEntity
import com.chainlesschain.android.core.database.entity.call.CallType
import com.chainlesschain.android.core.database.entity.call.MediaType
import kotlinx.coroutines.flow.Flow

/**
 * 通话历史记录DAO
 *
 * 提供通话记录的增删改查操作
 *
 * @since v0.32.0
 */
@Dao
interface CallHistoryDao {

    /**
     * 插入通话记录
     *
     * @param callHistory 通话记录实体
     */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(callHistory: CallHistoryEntity)

    /**
     * 批量插入通话记录
     *
     * @param callHistories 通话记录列表
     */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(callHistories: List<CallHistoryEntity>)

    /**
     * 更新通话记录
     *
     * @param callHistory 通话记录实体
     */
    @Update
    suspend fun update(callHistory: CallHistoryEntity)

    /**
     * 删除通话记录
     *
     * @param callHistory 通话记录实体
     */
    @Delete
    suspend fun delete(callHistory: CallHistoryEntity)

    /**
     * 根据ID删除通话记录
     *
     * @param id 通话记录ID
     */
    @Query("DELETE FROM call_history WHERE id = :id")
    suspend fun deleteById(id: String)

    /**
     * 删除指定联系人的所有通话记录
     *
     * @param peerDid 对方DID
     */
    @Query("DELETE FROM call_history WHERE peer_did = :peerDid")
    suspend fun deleteByPeerDid(peerDid: String)

    /**
     * 清空所有通话记录
     */
    @Query("DELETE FROM call_history")
    suspend fun deleteAll()

    /**
     * 根据ID获取通话记录
     *
     * @param id 通话记录ID
     * @return 通话记录Flow
     */
    @Query("SELECT * FROM call_history WHERE id = :id")
    fun getById(id: String): Flow<CallHistoryEntity?>

    /**
     * 获取所有通话记录（按时间倒序）
     *
     * @return 通话记录列表Flow
     */
    @Query("SELECT * FROM call_history ORDER BY start_time DESC")
    fun getAll(): Flow<List<CallHistoryEntity>>

    /**
     * 获取指定联系人的通话记录
     *
     * @param peerDid 对方DID
     * @return 通话记录列表Flow
     */
    @Query("SELECT * FROM call_history WHERE peer_did = :peerDid ORDER BY start_time DESC")
    fun getByPeerDid(peerDid: String): Flow<List<CallHistoryEntity>>

    /**
     * 获取指定类型的通话记录
     *
     * @param callType 通话类型
     * @return 通话记录列表Flow
     */
    @Query("SELECT * FROM call_history WHERE call_type = :callType ORDER BY start_time DESC")
    fun getByCallType(callType: CallType): Flow<List<CallHistoryEntity>>

    /**
     * 获取未接来电
     *
     * @return 未接来电列表Flow
     */
    @Query("SELECT * FROM call_history WHERE call_type = 'MISSED' ORDER BY start_time DESC")
    fun getMissedCalls(): Flow<List<CallHistoryEntity>>

    /**
     * 获取指定媒体类型的通话记录
     *
     * @param mediaType 媒体类型
     * @return 通话记录列表Flow
     */
    @Query("SELECT * FROM call_history WHERE media_type = :mediaType ORDER BY start_time DESC")
    fun getByMediaType(mediaType: MediaType): Flow<List<CallHistoryEntity>>

    /**
     * 获取指定时间范围的通话记录
     *
     * @param startTime 开始时间
     * @param endTime 结束时间
     * @return 通话记录列表Flow
     */
    @Query("SELECT * FROM call_history WHERE start_time BETWEEN :startTime AND :endTime ORDER BY start_time DESC")
    fun getByTimeRange(startTime: Long, endTime: Long): Flow<List<CallHistoryEntity>>

    /**
     * 获取最近N条通话记录
     *
     * @param limit 记录数量
     * @return 通话记录列表Flow
     */
    @Query("SELECT * FROM call_history ORDER BY start_time DESC LIMIT :limit")
    fun getRecent(limit: Int): Flow<List<CallHistoryEntity>>

    /**
     * 获取通话记录总数
     *
     * @return 记录总数Flow
     */
    @Query("SELECT COUNT(*) FROM call_history")
    fun getCount(): Flow<Int>

    /**
     * 获取未接来电数量
     *
     * @return 未接来电数量Flow
     */
    @Query("SELECT COUNT(*) FROM call_history WHERE call_type = 'MISSED'")
    fun getMissedCallCount(): Flow<Int>

    /**
     * 获取指定联系人的通话总时长（秒）
     *
     * @param peerDid 对方DID
     * @return 总时长Flow
     */
    @Query("SELECT SUM(duration) FROM call_history WHERE peer_did = :peerDid AND call_type != 'MISSED'")
    fun getTotalDurationByPeerDid(peerDid: String): Flow<Long?>

    /**
     * 搜索通话记录
     *
     * @param query 搜索关键词
     * @return 通话记录列表Flow
     */
    @Query("SELECT * FROM call_history WHERE peer_name LIKE '%' || :query || '%' OR peer_did LIKE '%' || :query || '%' ORDER BY start_time DESC")
    fun search(query: String): Flow<List<CallHistoryEntity>>

    /**
     * 删除指定天数之前的通话记录
     *
     * @param daysAgo 天数
     */
    @Query("DELETE FROM call_history WHERE start_time < :timestampMillis")
    suspend fun deleteOlderThan(timestampMillis: Long)

    /**
     * 获取今日通话记录
     *
     * @param todayStart 今日开始时间戳
     * @return 通话记录列表Flow
     */
    @Query("SELECT * FROM call_history WHERE start_time >= :todayStart ORDER BY start_time DESC")
    fun getTodayCalls(todayStart: Long): Flow<List<CallHistoryEntity>>

    /**
     * 获取本周通话记录
     *
     * @param weekStart 本周开始时间戳
     * @return 通话记录列表Flow
     */
    @Query("SELECT * FROM call_history WHERE start_time >= :weekStart ORDER BY start_time DESC")
    fun getWeekCalls(weekStart: Long): Flow<List<CallHistoryEntity>>

    /**
     * 获取本月通话记录
     *
     * @param monthStart 本月开始时间戳
     * @return 通话记录列表Flow
     */
    @Query("SELECT * FROM call_history WHERE start_time >= :monthStart ORDER BY start_time DESC")
    fun getMonthCalls(monthStart: Long): Flow<List<CallHistoryEntity>>
}
