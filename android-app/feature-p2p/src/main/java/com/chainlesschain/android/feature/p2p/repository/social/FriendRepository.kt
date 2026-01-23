package com.chainlesschain.android.feature.p2p.repository.social

import com.chainlesschain.android.core.common.error.Result
import com.chainlesschain.android.core.database.dao.social.FriendDao
import com.chainlesschain.android.core.database.entity.social.FriendEntity
import com.chainlesschain.android.core.database.entity.social.FriendGroupEntity
import com.chainlesschain.android.core.database.entity.social.FriendStatus
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 好友数据仓库
 *
 * 管理好友关系、分组和状态
 */
@Singleton
class FriendRepository @Inject constructor(
    private val friendDao: FriendDao
) {

    // ===== 查询方法 =====

    /**
     * 获取所有好友
     */
    fun getAllFriends(): Flow<Result<List<FriendEntity>>> {
        return friendDao.getAllFriends()
            .map { Result.Success(it) }
            .catch { emit(Result.Error(it)) }
    }

    /**
     * 根据 DID 获取好友
     */
    suspend fun getFriendByDid(did: String): Result<FriendEntity?> {
        return try {
            Result.Success(friendDao.getFriendByDid(did))
        } catch (e: Exception) {
            Result.Error(e)
        }
    }

    /**
     * 观察好友信息
     */
    fun observeFriendByDid(did: String): Flow<Result<FriendEntity?>> {
        return friendDao.observeFriendByDid(did)
            .map { Result.Success(it) }
            .catch { emit(Result.Error(it)) }
    }

    /**
     * 获取待处理的好友请求
     */
    fun getPendingRequests(): Flow<Result<List<FriendEntity>>> {
        return friendDao.getPendingRequests()
            .map { Result.Success(it) }
            .catch { emit(Result.Error(it)) }
    }

    /**
     * 获取指定分组的好友
     */
    fun getFriendsByGroup(groupId: String): Flow<Result<List<FriendEntity>>> {
        return friendDao.getFriendsByGroup(groupId)
            .map { Result.Success(it) }
            .catch { emit(Result.Error(it)) }
    }

    /**
     * 搜索好友
     */
    fun searchFriends(query: String): Flow<Result<List<FriendEntity>>> {
        return friendDao.searchFriends(query)
            .map { Result.Success(it) }
            .catch { emit(Result.Error(it)) }
    }

    /**
     * 获取被屏蔽的好友
     */
    fun getBlockedFriends(): Flow<Result<List<FriendEntity>>> {
        return friendDao.getBlockedFriends()
            .map { Result.Success(it) }
            .catch { emit(Result.Error(it)) }
    }

    /**
     * 获取好友总数
     */
    suspend fun getFriendCount(): Result<Int> {
        return try {
            Result.Success(friendDao.getFriendCount())
        } catch (e: Exception) {
            Result.Error(e)
        }
    }

    /**
     * 获取待处理请求数
     */
    fun getPendingRequestCount(): Flow<Result<Int>> {
        return friendDao.getPendingRequestCount()
            .map { Result.Success(it) }
            .catch { emit(Result.Error(it)) }
    }

    /**
     * 检查是否为好友
     */
    suspend fun isFriend(did: String): Result<Boolean> {
        return try {
            Result.Success(friendDao.isFriend(did))
        } catch (e: Exception) {
            Result.Error(e)
        }
    }

    // ===== 插入/更新方法 =====

    /**
     * 添加好友
     */
    suspend fun addFriend(friend: FriendEntity): Result<Unit> {
        return try {
            friendDao.insert(friend)
            Result.Success(Unit)
        } catch (e: Exception) {
            Result.Error(e)
        }
    }

    /**
     * 批量添加好友
     */
    suspend fun addFriends(friends: List<FriendEntity>): Result<Unit> {
        return try {
            friendDao.insertAll(friends)
            Result.Success(Unit)
        } catch (e: Exception) {
            Result.Error(e)
        }
    }

    /**
     * 更新好友信息
     */
    suspend fun updateFriend(friend: FriendEntity): Result<Unit> {
        return try {
            friendDao.update(friend)
            Result.Success(Unit)
        } catch (e: Exception) {
            Result.Error(e)
        }
    }

    /**
     * 更新好友状态
     */
    suspend fun updateFriendStatus(did: String, status: FriendStatus): Result<Unit> {
        return try {
            friendDao.updateStatus(did, status)
            Result.Success(Unit)
        } catch (e: Exception) {
            Result.Error(e)
        }
    }

    /**
     * 接受好友请求
     */
    suspend fun acceptFriendRequest(did: String): Result<Unit> {
        return updateFriendStatus(did, FriendStatus.ACCEPTED)
    }

    /**
     * 拒绝好友请求
     */
    suspend fun rejectFriendRequest(did: String): Result<Unit> {
        return updateFriendStatus(did, FriendStatus.REJECTED)
    }

    /**
     * 更新备注名
     */
    suspend fun updateRemarkName(did: String, remarkName: String?): Result<Unit> {
        return try {
            friendDao.updateRemarkName(did, remarkName)
            Result.Success(Unit)
        } catch (e: Exception) {
            Result.Error(e)
        }
    }

    /**
     * 更新分组
     */
    suspend fun updateGroup(did: String, groupId: String?): Result<Unit> {
        return try {
            friendDao.updateGroup(did, groupId)
            Result.Success(Unit)
        } catch (e: Exception) {
            Result.Error(e)
        }
    }

    /**
     * 屏蔽好友
     */
    suspend fun blockFriend(did: String): Result<Unit> {
        return try {
            friendDao.updateBlockStatus(did, true)
            Result.Success(Unit)
        } catch (e: Exception) {
            Result.Error(e)
        }
    }

    /**
     * 取消屏蔽好友
     */
    suspend fun unblockFriend(did: String): Result<Unit> {
        return try {
            friendDao.updateBlockStatus(did, false)
            Result.Success(Unit)
        } catch (e: Exception) {
            Result.Error(e)
        }
    }

    /**
     * 更新最后活跃时间
     */
    suspend fun updateLastActiveAt(did: String, time: Long): Result<Unit> {
        return try {
            friendDao.updateLastActiveAt(did, time)
            Result.Success(Unit)
        } catch (e: Exception) {
            Result.Error(e)
        }
    }

    // ===== 删除方法 =====

    /**
     * 删除好友
     */
    suspend fun deleteFriend(did: String): Result<Unit> {
        return try {
            friendDao.deleteByDid(did)
            Result.Success(Unit)
        } catch (e: Exception) {
            Result.Error(e)
        }
    }

    /**
     * 清理旧记录
     */
    suspend fun cleanupOldRecords(cutoffTime: Long): Result<Unit> {
        return try {
            friendDao.cleanupOldRecords(cutoffTime)
            Result.Success(Unit)
        } catch (e: Exception) {
            Result.Error(e)
        }
    }

    // ===== 分组管理 =====

    /**
     * 获取所有分组
     */
    fun getAllGroups(): Flow<Result<List<FriendGroupEntity>>> {
        return friendDao.getAllGroups()
            .map { Result.Success(it) }
            .catch { emit(Result.Error(it)) }
    }

    /**
     * 根据 ID 获取分组
     */
    suspend fun getGroupById(id: String): Result<FriendGroupEntity?> {
        return try {
            Result.Success(friendDao.getGroupById(id))
        } catch (e: Exception) {
            Result.Error(e)
        }
    }

    /**
     * 创建分组
     */
    suspend fun createGroup(group: FriendGroupEntity): Result<Unit> {
        return try {
            friendDao.insertGroup(group)
            Result.Success(Unit)
        } catch (e: Exception) {
            Result.Error(e)
        }
    }

    /**
     * 更新分组
     */
    suspend fun updateGroup(group: FriendGroupEntity): Result<Unit> {
        return try {
            friendDao.updateGroup(group)
            Result.Success(Unit)
        } catch (e: Exception) {
            Result.Error(e)
        }
    }

    /**
     * 删除分组
     */
    suspend fun deleteGroup(id: String): Result<Unit> {
        return try {
            friendDao.deleteGroupById(id)
            Result.Success(Unit)
        } catch (e: Exception) {
            Result.Error(e)
        }
    }

    /**
     * 获取分组中的好友数量
     */
    suspend fun getFriendCountInGroup(groupId: String): Result<Int> {
        return try {
            Result.Success(friendDao.getFriendCountInGroup(groupId))
        } catch (e: Exception) {
            Result.Error(e)
        }
    }
}
