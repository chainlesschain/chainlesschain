package com.chainlesschain.android.feature.p2p.viewmodel.social

import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.core.common.error.onFailure
import com.chainlesschain.android.core.common.error.onSuccess
import com.chainlesschain.android.core.common.viewmodel.BaseViewModel
import com.chainlesschain.android.core.common.viewmodel.UiEvent
import com.chainlesschain.android.core.common.viewmodel.UiState
import com.chainlesschain.android.core.database.entity.social.FriendEntity
import com.chainlesschain.android.core.database.entity.social.FriendGroupEntity
import com.chainlesschain.android.core.database.entity.social.FriendStatus
import com.chainlesschain.android.core.p2p.realtime.PresenceInfo
import com.chainlesschain.android.core.p2p.realtime.PresenceManager
import com.chainlesschain.android.core.p2p.realtime.RealtimeEventManager
import com.chainlesschain.android.feature.p2p.repository.social.FriendRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import java.util.concurrent.ConcurrentHashMap
import javax.inject.Inject

/**
 * 好友 ViewModel
 *
 * 管理好友列表、好友请求、分组等状态
 */
@HiltViewModel
class FriendViewModel @Inject constructor(
    private val friendRepository: FriendRepository,
    private val realtimeEventManager: RealtimeEventManager,
    private val presenceManager: PresenceManager
) : BaseViewModel<FriendUiState, FriendEvent>(
    initialState = FriendUiState()
) {

    // 在线状态缓存
    private val presenceCache = ConcurrentHashMap<String, PresenceInfo>()

    init {
        loadFriends()
        loadGroups()
        loadPendingRequests()
        observePendingRequestCount()

        // 启动实时事件监听
        startRealtimeListening()
    }

    // ===== 实时事件监听 =====

    /**
     * 启动实时事件监听
     */
    private fun startRealtimeListening() {
        // 监听好友请求
        viewModelScope.launch(exceptionHandler) {
            realtimeEventManager.friendRequestEvents.collect { event ->
                handleFriendRequest(event.fromDid, event.message)
            }
        }

        // 监听在线状态更新
        viewModelScope.launch(exceptionHandler) {
            presenceManager.presenceUpdates.collect { event ->
                presenceCache[event.did] = PresenceInfo(
                    did = event.did,
                    status = event.status,
                    lastActiveAt = event.lastActiveAt,
                    receivedAt = System.currentTimeMillis()
                )
                // 刷新好友列表显示
                updateState { copy() }
            }
        }
    }

    /**
     * 处理收到的好友请求
     */
    private suspend fun handleFriendRequest(fromDid: String, message: String?) {
        // 检查是否已存在该好友
        friendRepository.getFriendByDid(fromDid).onSuccess { existingFriend ->
            if (existingFriend == null) {
                // 创建新的好友请求记录
                val friend = FriendEntity(
                    did = fromDid,
                    nickname = "用户 ${fromDid.take(8)}", // 临时昵称
                    avatar = null,
                    bio = message,
                    status = FriendStatus.PENDING,
                    addedAt = System.currentTimeMillis()
                )
                friendRepository.addFriend(friend)
                sendEvent(FriendEvent.ShowToast("收到新的好友请求"))
            }
        }
    }

    /**
     * 获取好友的在线状态
     */
    fun getFriendPresence(did: String): PresenceInfo? {
        return presenceCache[did]
    }

    /**
     * 发送好友请求
     */
    fun sendFriendRequest(targetDid: String, message: String?) = launchSafely {
        realtimeEventManager.sendFriendRequest(targetDid, message)
        sendEvent(FriendEvent.ShowToast("好友请求已发送"))
    }

    // ===== 数据加载 =====

    /**
     * 加载所有好友
     */
    fun loadFriends() {
        viewModelScope.launch(exceptionHandler) {
            friendRepository.getAllFriends().collectLatest { result ->
                result.onSuccess { friends ->
                    updateState { copy(friends = friends, isLoadingFriends = false) }
                }.onFailure { error ->
                    updateState { copy(isLoadingFriends = false) }
                    handleError(error)
                }
            }
        }
    }

    /**
     * 加载好友分组
     */
    fun loadGroups() {
        viewModelScope.launch(exceptionHandler) {
            friendRepository.getAllGroups().collectLatest { result ->
                result.onSuccess { groups ->
                    updateState { copy(groups = groups) }
                }.onFailure { error ->
                    handleError(error)
                }
            }
        }
    }

    /**
     * 加载待处理的好友请求
     */
    fun loadPendingRequests() {
        viewModelScope.launch(exceptionHandler) {
            friendRepository.getPendingRequests().collectLatest { result ->
                result.onSuccess { requests ->
                    updateState { copy(pendingRequests = requests, isLoadingRequests = false) }
                }.onFailure { error ->
                    updateState { copy(isLoadingRequests = false) }
                    handleError(error)
                }
            }
        }
    }

    /**
     * 观察待处理请求数量
     */
    private fun observePendingRequestCount() {
        viewModelScope.launch(exceptionHandler) {
            friendRepository.getPendingRequestCount().collectLatest { result ->
                result.onSuccess { count ->
                    updateState { copy(pendingRequestCount = count) }
                }
            }
        }
    }

    /**
     * 加载指定分组的好友
     */
    fun loadFriendsByGroup(groupId: String) {
        viewModelScope.launch(exceptionHandler) {
            updateState { copy(isLoadingFriends = true) }
            friendRepository.getFriendsByGroup(groupId).collectLatest { result ->
                result.onSuccess { friends ->
                    updateState { copy(friends = friends, isLoadingFriends = false) }
                }.onFailure { error ->
                    updateState { copy(isLoadingFriends = false) }
                    handleError(error)
                }
            }
        }
    }

    /**
     * 搜索好友
     */
    fun searchFriends(query: String) {
        if (query.isBlank()) {
            loadFriends()
            return
        }

        viewModelScope.launch(exceptionHandler) {
            updateState { copy(isSearching = true, searchQuery = query) }
            friendRepository.searchFriends(query).collectLatest { result ->
                result.onSuccess { friends ->
                    updateState { copy(friends = friends, isSearching = false) }
                }.onFailure { error ->
                    updateState { copy(isSearching = false) }
                    handleError(error)
                }
            }
        }
    }

    // ===== 好友管理 =====

    /**
     * 添加好友
     */
    fun addFriend(friend: FriendEntity) = launchSafely {
        friendRepository.addFriend(friend)
            .onSuccess {
                sendEvent(FriendEvent.ShowToast("好友请求已发送"))
            }.onFailure { error ->
                handleError(error)
            }
    }

    /**
     * 接受好友请求
     */
    fun acceptFriendRequest(did: String) = launchSafely {
        friendRepository.acceptFriendRequest(did)
            .onSuccess {
                // 发送实时响应
                realtimeEventManager.respondToFriendRequest(did, accepted = true)
                sendEvent(FriendEvent.ShowToast("已接受好友请求"))
                sendEvent(FriendEvent.FriendRequestAccepted(did))
            }.onFailure { error ->
                handleError(error)
            }
    }

    /**
     * 拒绝好友请求
     */
    fun rejectFriendRequest(did: String) = launchSafely {
        friendRepository.rejectFriendRequest(did)
            .onSuccess {
                // 发送实时响应
                realtimeEventManager.respondToFriendRequest(did, accepted = false)
                sendEvent(FriendEvent.ShowToast("已拒绝好友请求"))
            }.onFailure { error ->
                handleError(error)
            }
    }

    /**
     * 删除好友
     */
    fun deleteFriend(did: String) = launchSafely {
        friendRepository.deleteFriend(did)
            .onSuccess {
                sendEvent(FriendEvent.ShowToast("已删除好友"))
            }.onFailure { error ->
                handleError(error)
            }
    }

    /**
     * 更新备注名
     */
    fun updateRemarkName(did: String, remarkName: String?) = launchSafely {
        friendRepository.updateRemarkName(did, remarkName)
            .onSuccess {
                sendEvent(FriendEvent.ShowToast("备注名已更新"))
            }.onFailure { error ->
                handleError(error)
            }
    }

    /**
     * 移动好友到分组
     */
    fun moveFriendToGroup(did: String, groupId: String?) = launchSafely {
        friendRepository.updateGroup(did, groupId)
            .onSuccess {
                sendEvent(FriendEvent.ShowToast("已移动到分组"))
            }.onFailure { error ->
                handleError(error)
            }
    }

    /**
     * 屏蔽好友
     */
    fun blockFriend(did: String) = launchSafely {
        friendRepository.blockFriend(did)
            .onSuccess {
                sendEvent(FriendEvent.ShowToast("已屏蔽好友"))
            }.onFailure { error ->
                handleError(error)
            }
    }

    /**
     * 取消屏蔽
     */
    fun unblockFriend(did: String) = launchSafely {
        friendRepository.unblockFriend(did)
            .onSuccess {
                sendEvent(FriendEvent.ShowToast("已取消屏蔽"))
            }.onFailure { error ->
                handleError(error)
            }
    }

    // ===== 分组管理 =====

    /**
     * 创建分组
     */
    fun createGroup(name: String) = launchSafely {
        val group = FriendGroupEntity(
            id = "group_${System.currentTimeMillis()}",
            name = name,
            createdAt = System.currentTimeMillis()
        )
        friendRepository.createGroup(group)
            .onSuccess {
                sendEvent(FriendEvent.ShowToast("分组创建成功"))
            }.onFailure { error ->
                handleError(error)
            }
    }

    /**
     * 删除分组
     */
    fun deleteGroup(groupId: String) = launchSafely {
        friendRepository.deleteGroup(groupId)
            .onSuccess {
                sendEvent(FriendEvent.ShowToast("分组已删除"))
            }.onFailure { error ->
                handleError(error)
            }
    }

    /**
     * 重命名分组
     */
    fun renameGroup(groupId: String, newName: String) = launchSafely {
        friendRepository.getGroupById(groupId)
            .onSuccess { group ->
                group?.let {
                    friendRepository.updateGroup(it.copy(name = newName))
                        .onSuccess {
                            sendEvent(FriendEvent.ShowToast("分组已重命名"))
                        }
                }
            }.onFailure { error ->
                handleError(error)
            }
    }

    // ===== UI 交互 =====

    /**
     * 选择好友
     */
    fun selectFriend(friend: FriendEntity) {
        updateState { copy(selectedFriend = friend) }
        sendEvent(FriendEvent.NavigateToFriendDetail(friend.did))
    }

    /**
     * 清除选择
     */
    fun clearSelection() {
        updateState { copy(selectedFriend = null) }
    }

    /**
     * 显示好友操作菜单
     */
    fun showFriendMenu(friend: FriendEntity) {
        updateState { copy(selectedFriend = friend, showFriendMenu = true) }
    }

    /**
     * 隐藏好友操作菜单
     */
    fun hideFriendMenu() {
        updateState { copy(showFriendMenu = false) }
    }

    /**
     * 显示分组选择器
     */
    fun showGroupSelector(friend: FriendEntity) {
        updateState { copy(selectedFriend = friend, showGroupSelector = true) }
    }

    /**
     * 隐藏分组选择器
     */
    fun hideGroupSelector() {
        updateState { copy(showGroupSelector = false) }
    }

    /**
     * 切换视图模式（列表/网格）
     */
    fun toggleViewMode() {
        updateState {
            copy(isGridView = !isGridView)
        }
    }
}

/**
 * 好友 UI 状态
 */
data class FriendUiState(
    val friends: List<FriendEntity> = emptyList(),
    val groups: List<FriendGroupEntity> = emptyList(),
    val pendingRequests: List<FriendEntity> = emptyList(),
    val pendingRequestCount: Int = 0,
    val selectedFriend: FriendEntity? = null,
    val isLoadingFriends: Boolean = true,
    val isLoadingRequests: Boolean = true,
    val isSearching: Boolean = false,
    val searchQuery: String = "",
    val showFriendMenu: Boolean = false,
    val showGroupSelector: Boolean = false,
    val isGridView: Boolean = false,
    // 在线好友数量
    val onlineFriendCount: Int = 0
) : UiState

/**
 * 好友事件
 */
sealed class FriendEvent : UiEvent {
    data class NavigateToFriendDetail(val did: String) : FriendEvent()
    data class ShowToast(val message: String) : FriendEvent()
    data class FriendRequestAccepted(val did: String) : FriendEvent()
}
