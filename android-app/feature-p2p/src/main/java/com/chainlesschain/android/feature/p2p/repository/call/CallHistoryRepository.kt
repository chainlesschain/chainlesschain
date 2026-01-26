package com.chainlesschain.android.feature.p2p.repository.call

import com.chainlesschain.android.core.common.Result
import com.chainlesschain.android.core.common.asResult
import com.chainlesschain.android.core.database.dao.call.CallHistoryDao
import com.chainlesschain.android.core.database.entity.call.CallHistoryEntity
import com.chainlesschain.android.core.database.entity.call.CallType
import com.chainlesschain.android.core.database.entity.call.MediaType
import kotlinx.coroutines.flow.Flow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 通话历史记录数据仓库
 *
 * 管理通话历史的增删改查操作
 *
 * 功能：
 * - 通话记录的CRUD操作
 * - 通话历史查询（按联系人、类型、时间等）
 * - 统计数据查询（未接来电数、总时长等）
 * - 历史记录清理
 *
 * @since v0.32.0
 */
@Singleton
class CallHistoryRepository @Inject constructor(
    private val callHistoryDao: CallHistoryDao
) {

    // ===== 通话记录管理 =====

    /**
     * 保存通话记录
     *
     * @param callHistory 通话记录实体
     */
    suspend fun saveCallHistory(callHistory: CallHistoryEntity): Result<Unit> {
        return try {
            callHistoryDao.insert(callHistory)
            Result.Success(Unit)
        } catch (e: Exception) {
            Result.Error(e)
        }
    }

    /**
     * 批量保存通话记录
     *
     * @param callHistories 通话记录列表
     */
    suspend fun saveCallHistories(callHistories: List<CallHistoryEntity>): Result<Unit> {
        return try {
            callHistoryDao.insertAll(callHistories)
            Result.Success(Unit)
        } catch (e: Exception) {
            Result.Error(e)
        }
    }

    /**
     * 更新通话记录
     *
     * @param callHistory 通话记录实体
     */
    suspend fun updateCallHistory(callHistory: CallHistoryEntity): Result<Unit> {
        return try {
            callHistoryDao.update(callHistory)
            Result.Success(Unit)
        } catch (e: Exception) {
            Result.Error(e)
        }
    }

    /**
     * 删除通话记录
     *
     * @param id 通话记录ID
     */
    suspend fun deleteCallHistory(id: String): Result<Unit> {
        return try {
            callHistoryDao.deleteById(id)
            Result.Success(Unit)
        } catch (e: Exception) {
            Result.Error(e)
        }
    }

    /**
     * 删除指定联系人的所有通话记录
     *
     * @param peerDid 对方DID
     */
    suspend fun deleteByPeerDid(peerDid: String): Result<Unit> {
        return try {
            callHistoryDao.deleteByPeerDid(peerDid)
            Result.Success(Unit)
        } catch (e: Exception) {
            Result.Error(e)
        }
    }

    /**
     * 清空所有通话记录
     */
    suspend fun deleteAll(): Result<Unit> {
        return try {
            callHistoryDao.deleteAll()
            Result.Success(Unit)
        } catch (e: Exception) {
            Result.Error(e)
        }
    }

    // ===== 通话记录查询 =====

    /**
     * 根据ID获取通话记录
     *
     * @param id 通话记录ID
     * @return 通话记录Flow
     */
    fun getCallHistoryById(id: String): Flow<Result<CallHistoryEntity?>> {
        return callHistoryDao.getById(id).asResult()
    }

    /**
     * 获取所有通话记录（按时间倒序）
     *
     * @return 通话记录列表Flow
     */
    fun getAllCallHistory(): Flow<Result<List<CallHistoryEntity>>> {
        return callHistoryDao.getAll().asResult()
    }

    /**
     * 获取指定联系人的通话记录
     *
     * @param peerDid 对方DID
     * @return 通话记录列表Flow
     */
    fun getCallHistoryByPeerDid(peerDid: String): Flow<Result<List<CallHistoryEntity>>> {
        return callHistoryDao.getByPeerDid(peerDid).asResult()
    }

    /**
     * 获取指定类型的通话记录
     *
     * @param callType 通话类型
     * @return 通话记录列表Flow
     */
    fun getCallHistoryByType(callType: CallType): Flow<Result<List<CallHistoryEntity>>> {
        return callHistoryDao.getByCallType(callType).asResult()
    }

    /**
     * 获取未接来电
     *
     * @return 未接来电列表Flow
     */
    fun getMissedCalls(): Flow<Result<List<CallHistoryEntity>>> {
        return callHistoryDao.getMissedCalls().asResult()
    }

    /**
     * 获取指定媒体类型的通话记录
     *
     * @param mediaType 媒体类型
     * @return 通话记录列表Flow
     */
    fun getCallHistoryByMediaType(mediaType: MediaType): Flow<Result<List<CallHistoryEntity>>> {
        return callHistoryDao.getByMediaType(mediaType).asResult()
    }

    /**
     * 获取指定时间范围的通话记录
     *
     * @param startTime 开始时间
     * @param endTime 结束时间
     * @return 通话记录列表Flow
     */
    fun getCallHistoryByTimeRange(
        startTime: Long,
        endTime: Long
    ): Flow<Result<List<CallHistoryEntity>>> {
        return callHistoryDao.getByTimeRange(startTime, endTime).asResult()
    }

    /**
     * 获取最近N条通话记录
     *
     * @param limit 记录数量
     * @return 通话记录列表Flow
     */
    fun getRecentCallHistory(limit: Int = 20): Flow<Result<List<CallHistoryEntity>>> {
        return callHistoryDao.getRecent(limit).asResult()
    }

    /**
     * 搜索通话记录
     *
     * @param query 搜索关键词
     * @return 通话记录列表Flow
     */
    fun searchCallHistory(query: String): Flow<Result<List<CallHistoryEntity>>> {
        return callHistoryDao.search(query).asResult()
    }

    /**
     * 获取今日通话记录
     *
     * @return 通话记录列表Flow
     */
    fun getTodayCallHistory(): Flow<Result<List<CallHistoryEntity>>> {
        val todayStart = getTodayStartTime()
        return callHistoryDao.getTodayCalls(todayStart).asResult()
    }

    /**
     * 获取本周通话记录
     *
     * @return 通话记录列表Flow
     */
    fun getWeekCallHistory(): Flow<Result<List<CallHistoryEntity>>> {
        val weekStart = getWeekStartTime()
        return callHistoryDao.getWeekCalls(weekStart).asResult()
    }

    /**
     * 获取本月通话记录
     *
     * @return 通话记录列表Flow
     */
    fun getMonthCallHistory(): Flow<Result<List<CallHistoryEntity>>> {
        val monthStart = getMonthStartTime()
        return callHistoryDao.getMonthCalls(monthStart).asResult()
    }

    // ===== 统计数据 =====

    /**
     * 获取通话记录总数
     *
     * @return 记录总数Flow
     */
    fun getCallHistoryCount(): Flow<Result<Int>> {
        return callHistoryDao.getCount().asResult()
    }

    /**
     * 获取未接来电数量
     *
     * @return 未接来电数量Flow
     */
    fun getMissedCallCount(): Flow<Result<Int>> {
        return callHistoryDao.getMissedCallCount().asResult()
    }

    /**
     * 获取指定联系人的通话总时长（秒）
     *
     * @param peerDid 对方DID
     * @return 总时长Flow
     */
    fun getTotalDurationByPeerDid(peerDid: String): Flow<Result<Long>> {
        return callHistoryDao.getTotalDurationByPeerDid(peerDid)
            .map { it ?: 0L }
            .asResult()
    }

    // ===== 历史记录清理 =====

    /**
     * 删除指定天数之前的通话记录
     *
     * @param daysAgo 天数
     */
    suspend fun deleteOlderThan(daysAgo: Int): Result<Unit> {
        return try {
            val timestampMillis = System.currentTimeMillis() - (daysAgo * 24 * 60 * 60 * 1000L)
            callHistoryDao.deleteOlderThan(timestampMillis)
            Result.Success(Unit)
        } catch (e: Exception) {
            Result.Error(e)
        }
    }

    // ===== 辅助方法 =====

    /**
     * 获取今日开始时间戳
     */
    private fun getTodayStartTime(): Long {
        val calendar = java.util.Calendar.getInstance().apply {
            set(java.util.Calendar.HOUR_OF_DAY, 0)
            set(java.util.Calendar.MINUTE, 0)
            set(java.util.Calendar.SECOND, 0)
            set(java.util.Calendar.MILLISECOND, 0)
        }
        return calendar.timeInMillis
    }

    /**
     * 获取本周开始时间戳（周一）
     */
    private fun getWeekStartTime(): Long {
        val calendar = java.util.Calendar.getInstance().apply {
            set(java.util.Calendar.DAY_OF_WEEK, java.util.Calendar.MONDAY)
            set(java.util.Calendar.HOUR_OF_DAY, 0)
            set(java.util.Calendar.MINUTE, 0)
            set(java.util.Calendar.SECOND, 0)
            set(java.util.Calendar.MILLISECOND, 0)
        }
        return calendar.timeInMillis
    }

    /**
     * 获取本月开始时间戳
     */
    private fun getMonthStartTime(): Long {
        val calendar = java.util.Calendar.getInstance().apply {
            set(java.util.Calendar.DAY_OF_MONTH, 1)
            set(java.util.Calendar.HOUR_OF_DAY, 0)
            set(java.util.Calendar.MINUTE, 0)
            set(java.util.Calendar.SECOND, 0)
            set(java.util.Calendar.MILLISECOND, 0)
        }
        return calendar.timeInMillis
    }
}
