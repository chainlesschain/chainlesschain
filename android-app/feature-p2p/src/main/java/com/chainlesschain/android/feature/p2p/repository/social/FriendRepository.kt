package com.chainlesschain.android.feature.p2p.repository.social

import timber.log.Timber
import com.chainlesschain.android.core.common.Result
import com.chainlesschain.android.core.common.asResult
import com.chainlesschain.android.core.database.dao.social.BlockedUserDao
import com.chainlesschain.android.core.database.dao.social.FriendDao
import com.chainlesschain.android.core.database.entity.social.FriendEntity
import com.chainlesschain.android.core.database.entity.social.FriendGroupEntity
import com.chainlesschain.android.core.database.entity.social.FriendStatus
import com.chainlesschain.android.core.database.entity.social.BlockedUserEntity
import com.chainlesschain.android.core.p2p.discovery.NSDDiscovery
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.Json
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 好友数据仓库
 *
 * 管理好友关系、分组和状态
 */
@Singleton
class FriendRepository @Inject constructor(
    private val friendDao: FriendDao,
    private val blockedUserDao: BlockedUserDao,
    private val nsdDiscovery: NSDDiscovery,
// TEMP DISABLED:     private val syncAdapter: Lazy<SocialSyncAdapter> // 使用 Lazy 避免循环依赖
) {

    // ===== 查询方法 =====

    /**
     * 获取所有好友
     */
    fun getAllFriends(): Flow<Result<List<FriendEntity>>> =
        friendDao.getAllFriends().asResult()

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
            .asResult()
    }

    /**
     * 获取待处理的好友请求
     */
    fun getPendingRequests(): Flow<Result<List<FriendEntity>>> {
        return friendDao.getPendingRequests()
            .asResult()
    }

    /**
     * 获取指定分组的好友
     */
    fun getFriendsByGroup(groupId: String): Flow<Result<List<FriendEntity>>> {
        return friendDao.getFriendsByGroup(groupId)
            .asResult()
    }

    /**
     * 搜索好友
     */
    fun searchFriends(query: String): Flow<Result<List<FriendEntity>>> {
        return friendDao.searchFriends(query)
            .asResult()
    }

    /**
     * 根据 DID 精确搜索用户（用于添加好友）
     *
     * @param did 用户DID
     * @return 用户搜索结果，如果未找到则返回 null
     */
    suspend fun searchUserByDid(did: String): Result<com.chainlesschain.android.feature.p2p.viewmodel.social.UserSearchResult?> {
        return try {
            // 先在本地好友中查找
            val friend = friendDao.getFriendByDid(did)
            if (friend != null) {
                val searchResult = com.chainlesschain.android.feature.p2p.viewmodel.social.UserSearchResult(
                    did = friend.did,
                    nickname = friend.nickname,
                    avatar = friend.avatar,
                    bio = friend.bio,
                    isFriend = friend.status == FriendStatus.ACCEPTED
                )
                return Result.Success(searchResult)
            }

            // P2P network or backend API query for non-local users not yet available
            Result.Success(null)
        } catch (e: Exception) {
            Result.Error(e)
        }
    }

    /**
     * 获取附近的人（通过 P2P 发现）
     *
     * @return 附近用户的列表
     */
    fun getNearbyUsers(): Flow<Result<List<com.chainlesschain.android.feature.p2p.viewmodel.social.UserSearchResult>>> {
        return nsdDiscovery.observeDiscoveredDevices()
            .map { devices ->
                val results = devices.mapNotNull { device ->
                    val isFriend = try {
                        friendDao.isFriend(device.deviceId)
                    } catch (e: Exception) {
                        Timber.w(e, "Failed to check friend status for ${device.deviceId}")
                        false
                    }
                    if (isFriend) return@mapNotNull null

                    com.chainlesschain.android.feature.p2p.viewmodel.social.UserSearchResult(
                        did = device.deviceId,
                        nickname = device.deviceName,
                        avatar = null,
                        bio = null,
                        isFriend = false,
                        mutualFriendCount = 0,
                        distance = null
                    )
                }
                Result.Success(results)
            }
            .catch { e ->
                Timber.e(e, "Error getting nearby users")
                emit(Result.Success(emptyList()))
            }
    }

    /**
     * 获取推荐好友（基于共同好友、兴趣等）
     *
     * @return 推荐好友列表
     */
    fun getRecommendedFriends(): Flow<Result<List<com.chainlesschain.android.feature.p2p.viewmodel.social.UserSearchResult>>> {
        return flow {
            try {
                // Get all current friends
                val friends = friendDao.getAllFriends().first()
                if (friends.isEmpty()) {
                    emit(Result.Success(emptyList()))
                    return@flow
                }

                // Combine nearby devices + recently active friends-of-friends as candidates
                val nearbyDevices = nsdDiscovery.observeDiscoveredDevices().first()
                val friendDids = friends.map { it.did }.toSet()

                // Score nearby non-friend users
                val scored = nearbyDevices
                    .filter { device -> device.deviceId !in friendDids }
                    .map { device ->
                        // Simple scoring: recently seen devices score higher
                        val recencyScore = if (System.currentTimeMillis() - device.lastSeen < 300_000L) 0.3f else 0.0f
                        val baseScore = 0.5f // nearby = base interest
                        val totalScore = baseScore + recencyScore

                        com.chainlesschain.android.feature.p2p.viewmodel.social.UserSearchResult(
                            did = device.deviceId,
                            nickname = device.deviceName,
                            avatar = null,
                            bio = null,
                            isFriend = false,
                            mutualFriendCount = 0,
                            distance = null
                        ) to totalScore
                    }
                    .sortedByDescending { it.second }
                    .take(20)
                    .map { it.first }

                emit(Result.Success(scored))
            } catch (e: Exception) {
                Timber.e(e, "Error getting recommended friends")
                emit(Result.Success(emptyList()))
            }
        }
    }

    /**
     * 获取被屏蔽的好友
     */
    fun getBlockedFriends(): Flow<Result<List<FriendEntity>>> {
        return friendDao.getBlockedFriends()
            .asResult()
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
            .asResult()
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
//             syncAdapter.value.syncFriendAdded(friend)
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
//             friends.forEach { syncAdapter.value.syncFriendAdded(it) }
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
//             syncAdapter.value.syncFriendUpdated(friend)
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
            // 获取更新后的好友信息并同步
            friendDao.getFriendByDid(did)?.let { friend ->
//                 syncAdapter.value.syncFriendUpdated(friend)
            }
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
            // 获取更新后的好友信息并同步
            friendDao.getFriendByDid(did)?.let { friend ->
//                 syncAdapter.value.syncFriendUpdated(friend)
            }
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
            // 获取更新后的好友信息并同步
            friendDao.getFriendByDid(did)?.let { friend ->
//                 syncAdapter.value.syncFriendUpdated(friend)
            }
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
            // 获取更新后的好友信息并同步
            friendDao.getFriendByDid(did)?.let { friend ->
//                 syncAdapter.value.syncFriendUpdated(friend)
            }
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
            // 获取更新后的好友信息并同步
            friendDao.getFriendByDid(did)?.let { friend ->
//                 syncAdapter.value.syncFriendUpdated(friend)
            }
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
            // 获取更新后的好友信息并同步
            friendDao.getFriendByDid(did)?.let { friend ->
//                 syncAdapter.value.syncFriendUpdated(friend)
            }
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
//             syncAdapter.value.syncFriendDeleted(did)
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
            .asResult()
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

    // ===== 屏蔽用户管理 =====

    /**
     * 屏蔽用户（创建屏蔽记录）
     *
     * @param myDid 当前用户DID
     * @param targetDid 要屏蔽的用户DID
     * @param reason 屏蔽原因
     */
    suspend fun blockUser(myDid: String, targetDid: String, reason: String? = null): Result<Unit> {
        return try {
            // 更新好友表的屏蔽状态
            blockFriend(targetDid)

            // 创建 BlockedUserEntity 记录
            val blockedUser = BlockedUserEntity(
                id = "block_${System.currentTimeMillis()}",
                blockerDid = myDid,
                blockedDid = targetDid,
                reason = reason,
                createdAt = System.currentTimeMillis()
            )
            blockedUserDao.insertBlockedUser(blockedUser)

            Result.Success(Unit)
        } catch (e: Exception) {
            Result.Error(e)
        }
    }

    /**
     * 取消屏蔽用户
     */
    suspend fun unblockUser(myDid: String, targetDid: String): Result<Unit> {
        return try {
            unblockFriend(targetDid)
            blockedUserDao.removeBlockedUser(myDid, targetDid)
            Result.Success(Unit)
        } catch (e: Exception) {
            Result.Error(e)
        }
    }

    /**
     * 获取屏蔽用户列表
     *
     * @param myDid 当前用户DID
     */
    fun getBlockedUsersList(myDid: String): Flow<Result<List<BlockedUserEntity>>> {
        return blockedUserDao.getBlockedUsers(myDid).asResult()
    }

    /**
     * 检查用户是否被屏蔽
     *
     * @param myDid 当前用户DID
     * @param targetDid 目标用户DID
     */
    suspend fun isUserBlocked(myDid: String, targetDid: String): Result<Boolean> {
        return try {
            Result.Success(blockedUserDao.isBlocked(myDid, targetDid))
        } catch (e: Exception) {
            Result.Error(e)
        }
    }

    // ===== 同步接口 =====

    private val syncJson = Json { ignoreUnknownKeys = true }

    suspend fun saveFriendFromSync(resourceId: String, data: String) {
        try {
            val entity = syncJson.decodeFromString<FriendEntity>(data)
            friendDao.insert(entity)
            Timber.d("Friend saved from sync: $resourceId")
        } catch (e: Exception) {
            Timber.e(e, "Failed to save friend from sync: $resourceId")
        }
    }

    suspend fun updateFriendFromSync(resourceId: String, data: String) {
        try {
            val entity = syncJson.decodeFromString<FriendEntity>(data)
            friendDao.insert(entity)
            Timber.d("Friend updated from sync: $resourceId")
        } catch (e: Exception) {
            Timber.e(e, "Failed to update friend from sync: $resourceId")
        }
    }

    suspend fun deleteFriendFromSync(resourceId: String) {
        try {
            friendDao.deleteByDid(resourceId)
            Timber.d("Friend deleted from sync: $resourceId")
        } catch (e: Exception) {
            Timber.e(e, "Failed to delete friend from sync: $resourceId")
        }
    }
}
