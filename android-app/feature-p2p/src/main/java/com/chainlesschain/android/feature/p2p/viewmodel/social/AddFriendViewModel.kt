package com.chainlesschain.android.feature.p2p.viewmodel.social

import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.core.common.Result
import com.chainlesschain.android.core.common.onSuccess
import com.chainlesschain.android.core.common.onError
import com.chainlesschain.android.core.common.viewmodel.BaseViewModel
import com.chainlesschain.android.core.common.viewmodel.UiEvent
import com.chainlesschain.android.core.common.viewmodel.UiState
import com.chainlesschain.android.core.database.entity.social.FriendEntity
import com.chainlesschain.android.core.database.entity.social.FriendStatus
import com.chainlesschain.android.core.p2p.realtime.RealtimeEventManager
import com.chainlesschain.android.feature.p2p.repository.social.FriendRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * 添加好友 ViewModel
 *
 * 管理用户搜索、附近的人、好友推荐等功能
 */
@OptIn(FlowPreview::class)
@HiltViewModel
class AddFriendViewModel @Inject constructor(
    private val friendRepository: FriendRepository,
    private val realtimeEventManager: RealtimeEventManager
) : BaseViewModel<AddFriendUiState, AddFriendEvent>(
    initialState = AddFriendUiState()
) {

    private val searchQueryFlow = MutableStateFlow("")

    init {
        loadNearbyUsers()
        loadRecommendations()
        observeSearchQuery()
    }

    /**
     * 观察搜索查询（带防抖）
     */
    private fun observeSearchQuery() {
        viewModelScope.launch(exceptionHandler) {
            searchQueryFlow
                .debounce(300) // 300ms 防抖
                .collectLatest { query ->
                    if (query.isBlank()) {
                        updateState { copy(searchResults = emptyList(), isSearching = false) }
                    } else {
                        performSearch(query)
                    }
                }
        }
    }

    /**
     * 更新搜索查询
     */
    fun updateSearchQuery(query: String) {
        updateState { copy(searchQuery = query) }
        searchQueryFlow.value = query
        if (query.isNotBlank()) {
            updateState { copy(isSearching = true) }
        }
    }

    /**
     * 执行搜索
     */
    private suspend fun performSearch(query: String) {
        // 先尝试按 DID 精确搜索
        friendRepository.searchUserByDid(query).onSuccess { user ->
            if (user != null) {
                updateState {
                    copy(
                        searchResults = listOf(user),
                        isSearching = false
                    )
                }
                return
            }
        }

        // 如果精确搜索无结果，则模糊搜索（本地好友）
        friendRepository.searchFriends(query).collectLatest { result ->
            result.onSuccess { friends ->
                // 转换为搜索结果格式
                val searchResults = friends.map { friend ->
                    UserSearchResult(
                        did = friend.did,
                        nickname = friend.nickname,
                        avatar = friend.avatar,
                        bio = friend.bio,
                        isFriend = true,
                        mutualFriendCount = 0 // TODO: 计算共同好友数
                    )
                }
                updateState { copy(searchResults = searchResults, isSearching = false) }
            }.onError { error ->
                updateState { copy(isSearching = false) }
                handleError(error)
            }
        }
    }

    /**
     * 加载附近的人
     */
    fun loadNearbyUsers() {
        viewModelScope.launch(exceptionHandler) {
            friendRepository.getNearbyUsers().collectLatest { result ->
                result.onSuccess { users ->
                    updateState { copy(nearbyUsers = users) }
                }.onError { error ->
                    handleError(error)
                }
            }
        }
    }

    /**
     * 加载好友推荐
     */
    fun loadRecommendations() {
        viewModelScope.launch(exceptionHandler) {
            friendRepository.getRecommendedFriends().collectLatest { result ->
                result.onSuccess { users ->
                    updateState { copy(recommendations = users) }
                }.onError { error ->
                    handleError(error)
                }
            }
        }
    }

    /**
     * 发送好友请求
     */
    fun sendFriendRequest(targetDid: String, message: String? = null) = launchSafely {
        // 检查是否已经是好友
        friendRepository.isFriend(targetDid).onSuccess { isFriend ->
            if (isFriend) {
                sendEvent(AddFriendEvent.ShowToast("对方已经是你的好友"))
                return@onSuccess
            }

            // 创建好友请求记录
            val friend = FriendEntity(
                did = targetDid,
                nickname = "用户 ${targetDid.take(8)}", // 临时昵称，后续会更新
                avatar = null,
                bio = message,
                status = FriendStatus.PENDING,
                addedAt = System.currentTimeMillis()
            )

            friendRepository.addFriend(friend)
                .onSuccess {
                    // 发送实时好友请求
                    realtimeEventManager.sendFriendRequest(targetDid, message)
                    sendEvent(AddFriendEvent.ShowToast("好友请求已发送"))
                    sendEvent(AddFriendEvent.FriendRequestSent(targetDid))
                }.onError { error ->
                    handleError(error)
                }
        }
    }

    /**
     * 显示好友请求对话框
     */
    fun showFriendRequestDialog(user: UserSearchResult) {
        updateState {
            copy(
                showRequestDialog = true,
                selectedUser = user
            )
        }
    }

    /**
     * 隐藏好友请求对话框
     */
    fun hideRequestDialog() {
        updateState {
            copy(
                showRequestDialog = false,
                selectedUser = null
            )
        }
    }

    /**
     * 扫描二维码
     */
    fun scanQRCode() {
        sendEvent(AddFriendEvent.NavigateToQRScanner)
    }
}

/**
 * 添加好友 UI 状态
 */
data class AddFriendUiState(
    val searchQuery: String = "",
    val searchResults: List<UserSearchResult> = emptyList(),
    val nearbyUsers: List<UserSearchResult> = emptyList(),
    val recommendations: List<UserSearchResult> = emptyList(),
    val isSearching: Boolean = false,
    val showRequestDialog: Boolean = false,
    val selectedUser: UserSearchResult? = null
) : UiState

/**
 * 用户搜索结果
 */
data class UserSearchResult(
    val did: String,
    val nickname: String,
    val avatar: String? = null,
    val bio: String? = null,
    val isFriend: Boolean = false,
    val mutualFriendCount: Int = 0,
    val distance: Double? = null // 附近的人的距离（米）
)

/**
 * 添加好友事件
 */
sealed class AddFriendEvent : UiEvent {
    data class ShowToast(val message: String) : AddFriendEvent()
    data class FriendRequestSent(val did: String) : AddFriendEvent()
    data object NavigateToQRScanner : AddFriendEvent()
}
