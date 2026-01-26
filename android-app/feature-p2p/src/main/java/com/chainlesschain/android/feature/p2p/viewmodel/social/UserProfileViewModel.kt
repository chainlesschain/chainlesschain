package com.chainlesschain.android.feature.p2p.viewmodel.social

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.core.common.error.onFailure
import com.chainlesschain.android.core.common.error.onSuccess
import com.chainlesschain.android.core.common.viewmodel.BaseViewModel
import com.chainlesschain.android.core.common.viewmodel.UiEvent
import com.chainlesschain.android.core.common.viewmodel.UiState
import com.chainlesschain.android.core.database.entity.social.FriendEntity
import com.chainlesschain.android.core.database.entity.social.FriendStatus
import com.chainlesschain.android.core.database.entity.social.PostEntity
import com.chainlesschain.android.core.p2p.realtime.RealtimeEventManager
import com.chainlesschain.android.feature.p2p.repository.social.FriendRepository
import com.chainlesschain.android.feature.p2p.repository.social.PostRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * 用户资料 ViewModel
 *
 * 显示用户的个人信息、关系状态和动态列表
 */
@HiltViewModel
class UserProfileViewModel @Inject constructor(
    private val friendRepository: FriendRepository,
    private val postRepository: PostRepository,
    private val realtimeEventManager: RealtimeEventManager,
    savedStateHandle: SavedStateHandle
) : BaseViewModel<UserProfileUiState, UserProfileEvent>(
    initialState = UserProfileUiState()
) {

    private val userDid: String = savedStateHandle.get<String>("did") ?: ""

    init {
        if (userDid.isNotBlank()) {
            updateState { copy(userDid = userDid) }
            loadUserInfo()
            loadUserPosts()
            checkRelationship()
        }
    }

    /**
     * 加载用户信息
     */
    private fun loadUserInfo() {
        viewModelScope.launch(exceptionHandler) {
            // 先从本地好友中查找
            friendRepository.getFriendByDid(userDid).onSuccess { friend ->
                if (friend != null) {
                    val userInfo = UserInfo(
                        did = friend.did,
                        nickname = friend.nickname,
                        avatar = friend.avatar,
                        bio = friend.bio
                    )
                    updateState { copy(userInfo = userInfo, isLoadingUser = false) }
                } else {
                    // TODO: 从网络获取用户信息
                    // 暂时创建一个临时用户信息
                    val userInfo = UserInfo(
                        did = userDid,
                        nickname = "用户 ${userDid.take(8)}",
                        avatar = null,
                        bio = null
                    )
                    updateState { copy(userInfo = userInfo, isLoadingUser = false) }
                }
            }.onFailure { error ->
                updateState { copy(isLoadingUser = false) }
                handleError(error)
            }
        }
    }

    /**
     * 加载用户动态
     */
    private fun loadUserPosts() {
        viewModelScope.launch(exceptionHandler) {
            postRepository.getUserPosts(userDid).collectLatest { result ->
                result.onSuccess { posts ->
                    updateState { copy(posts = posts, isLoadingPosts = false) }
                }.onFailure { error ->
                    updateState { copy(isLoadingPosts = false) }
                    handleError(error)
                }
            }
        }
    }

    /**
     * 检查好友关系状态
     */
    private fun checkRelationship() {
        viewModelScope.launch(exceptionHandler) {
            friendRepository.getFriendByDid(userDid).onSuccess { friend ->
                val relationship = when {
                    friend == null -> FriendshipStatus.STRANGER
                    friend.isBlocked -> FriendshipStatus.BLOCKED
                    friend.status == FriendStatus.ACCEPTED -> FriendshipStatus.FRIEND
                    friend.status == FriendStatus.PENDING -> {
                        // TODO: 区分是发送方还是接收方
                        FriendshipStatus.PENDING_SENT
                    }
                    else -> FriendshipStatus.STRANGER
                }
                updateState { copy(relationship = relationship) }
            }
        }
    }

    /**
     * 发送好友请求
     */
    fun sendFriendRequest() = launchSafely {
        val friend = FriendEntity(
            did = userDid,
            nickname = uiState.value.userInfo?.nickname ?: "用户 ${userDid.take(8)}",
            avatar = uiState.value.userInfo?.avatar,
            bio = uiState.value.userInfo?.bio,
            status = FriendStatus.PENDING,
            addedAt = System.currentTimeMillis()
        )

        friendRepository.addFriend(friend)
            .onSuccess {
                realtimeEventManager.sendFriendRequest(userDid, null)
                updateState { copy(relationship = FriendshipStatus.PENDING_SENT) }
                sendEvent(UserProfileEvent.ShowToast("好友请求已发送"))
            }.onFailure { error ->
                handleError(error)
            }
    }

    /**
     * 发送消息
     */
    fun sendMessage() {
        sendEvent(UserProfileEvent.NavigateToChat(userDid))
    }

    /**
     * 切换Tab
     */
    fun selectTab(index: Int) {
        updateState { copy(selectedTab = index) }
    }

    /**
     * 显示更多菜单
     */
    fun showMenu() {
        updateState { copy(showMenu = true) }
    }

    /**
     * 隐藏更多菜单
     */
    fun hideMenu() {
        updateState { copy(showMenu = false) }
    }

    /**
     * 举报用户
     */
    fun reportUser(reason: String) = launchSafely {
        // TODO: 实现举报功能
        sendEvent(UserProfileEvent.ShowToast("举报已提交"))
        hideMenu()
    }

    /**
     * 屏蔽用户
     */
    fun blockUser() = launchSafely {
        friendRepository.blockFriend(userDid)
            .onSuccess {
                updateState { copy(relationship = FriendshipStatus.BLOCKED) }
                sendEvent(UserProfileEvent.ShowToast("已屏蔽该用户"))
                hideMenu()
            }.onFailure { error ->
                handleError(error)
            }
    }

    /**
     * 取消屏蔽
     */
    fun unblockUser() = launchSafely {
        friendRepository.unblockFriend(userDid)
            .onSuccess {
                checkRelationship()
                sendEvent(UserProfileEvent.ShowToast("已取消屏蔽"))
            }.onFailure { error ->
                handleError(error)
            }
    }
}

/**
 * 用户资料 UI 状态
 */
data class UserProfileUiState(
    val userDid: String = "",
    val userInfo: UserInfo? = null,
    val relationship: FriendshipStatus = FriendshipStatus.STRANGER,
    val posts: List<PostEntity> = emptyList(),
    val selectedTab: Int = 0,
    val isLoadingUser: Boolean = true,
    val isLoadingPosts: Boolean = true,
    val showMenu: Boolean = false
) : UiState

/**
 * 用户信息
 */
data class UserInfo(
    val did: String,
    val nickname: String,
    val avatar: String?,
    val bio: String?
)

/**
 * 好友关系状态
 */
enum class FriendshipStatus {
    /** 陌生人 */
    STRANGER,
    /** 已是好友 */
    FRIEND,
    /** 已发送请求，待对方接受 */
    PENDING_SENT,
    /** 收到对方请求，待自己接受 */
    PENDING_RECEIVED,
    /** 已屏蔽 */
    BLOCKED
}

/**
 * 用户资料事件
 */
sealed class UserProfileEvent : UiEvent {
    data class ShowToast(val message: String) : UserProfileEvent()
    data class NavigateToChat(val did: String) : UserProfileEvent()
}
