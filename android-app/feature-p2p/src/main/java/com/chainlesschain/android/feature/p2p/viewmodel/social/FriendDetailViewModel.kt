package com.chainlesschain.android.feature.p2p.viewmodel.social
import com.chainlesschain.android.core.common.Result

import com.chainlesschain.android.core.common.onError
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.core.common.onSuccess
import com.chainlesschain.android.core.common.viewmodel.BaseViewModel
import com.chainlesschain.android.core.common.viewmodel.UiEvent
import com.chainlesschain.android.core.common.viewmodel.UiState
import com.chainlesschain.android.core.database.entity.social.FriendEntity
import com.chainlesschain.android.core.database.entity.social.PostEntity
import com.chainlesschain.android.core.p2p.realtime.PresenceInfo
import com.chainlesschain.android.core.p2p.realtime.PresenceManager
import com.chainlesschain.android.feature.p2p.repository.social.FriendRepository
import com.chainlesschain.android.feature.p2p.repository.social.PostRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * 好友详情 ViewModel
 *
 * 显示好友的个人信息、在线状态和动态列表
 */
@HiltViewModel
class FriendDetailViewModel @Inject constructor(
    private val friendRepository: FriendRepository,
    private val postRepository: PostRepository,
    private val presenceManager: PresenceManager,
    savedStateHandle: SavedStateHandle
) : BaseViewModel<FriendDetailUiState, FriendDetailEvent>(
    initialState = FriendDetailUiState()
) {

    private val friendDid: String = savedStateHandle.get<String>("did") ?: ""

    init {
        if (friendDid.isNotBlank()) {
            loadFriendInfo()
            loadFriendPosts()
            observePresence()
        }
    }

    /**
     * 加载好友信息
     */
    private fun loadFriendInfo() {
        viewModelScope.launch(exceptionHandler) {
            friendRepository.observeFriendByDid(friendDid).collectLatest { result ->
                result.onSuccess { friend ->
                    updateState { copy(friend = friend, isLoadingFriend = false) }
                }.onError { error ->
                    updateState { copy(isLoadingFriend = false) }
                    handleError(error)
                }
            }
        }
    }

    /**
     * 加载好友动态
     */
    private fun loadFriendPosts() {
        viewModelScope.launch(exceptionHandler) {
            postRepository.getUserPosts(friendDid).collectLatest { result ->
                result.onSuccess { posts ->
                    updateState { copy(posts = posts, isLoadingPosts = false) }
                }.onError { error ->
                    updateState { copy(isLoadingPosts = false) }
                    handleError(error)
                }
            }
        }
    }

    /**
     * 观察好友在线状态
     */
    private fun observePresence() {
        viewModelScope.launch(exceptionHandler) {
            presenceManager.presenceUpdates.collect { event ->
                if (event.did == friendDid) {
                    val presenceInfo = PresenceInfo(
                        did = event.did,
                        status = event.status,
                        lastActiveAt = event.lastActiveAt,
                        receivedAt = System.currentTimeMillis()
                    )
                    updateState { copy(presenceInfo = presenceInfo) }
                }
            }
        }
    }

    /**
     * 刷新数据
     */
    fun refresh() {
        updateState { copy(isLoadingFriend = true, isLoadingPosts = true) }
        loadFriendInfo()
        loadFriendPosts()
    }

    /**
     * 发送消息
     */
    fun sendMessage() {
        sendEvent(FriendDetailEvent.NavigateToChat(friendDid))
    }

    /**
     * 语音通话
     */
    fun startVoiceCall() {
        sendEvent(FriendDetailEvent.StartVoiceCall(friendDid))
    }

    /**
     * 视频通话
     */
    fun startVideoCall() {
        sendEvent(FriendDetailEvent.StartVideoCall(friendDid))
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
     * 显示备注名对话框
     */
    fun showRemarkDialog() {
        updateState { copy(showRemarkDialog = true, showMenu = false) }
    }

    /**
     * 隐藏备注名对话框
     */
    fun hideRemarkDialog() {
        updateState { copy(showRemarkDialog = false) }
    }

    /**
     * 更新备注名
     */
    fun updateRemarkName(remarkName: String?) = launchSafely {
        friendRepository.updateRemarkName(friendDid, remarkName)
            .onSuccess {
                sendEvent(FriendDetailEvent.ShowToast("备注名已更新"))
                hideRemarkDialog()
            }.onError { error ->
                handleError(error)
            }
    }

    /**
     * 删除好友
     */
    fun deleteFriend() = launchSafely {
        friendRepository.deleteFriend(friendDid)
            .onSuccess {
                sendEvent(FriendDetailEvent.ShowToast("已删除好友"))
                sendEvent(FriendDetailEvent.NavigateBack)
            }.onError { error ->
                handleError(error)
            }
    }

    /**
     * 屏蔽好友
     */
    fun blockFriend() = launchSafely {
        friendRepository.blockFriend(friendDid)
            .onSuccess {
                sendEvent(FriendDetailEvent.ShowToast("已屏蔽好友"))
                hideMenu()
            }.onError { error ->
                handleError(error)
            }
    }
}

/**
 * 好友详情 UI 状态
 */
data class FriendDetailUiState(
    val friend: FriendEntity? = null,
    val posts: List<PostEntity> = emptyList(),
    val presenceInfo: PresenceInfo? = null,
    val isLoadingFriend: Boolean = true,
    val isLoadingPosts: Boolean = true,
    val showMenu: Boolean = false,
    val showRemarkDialog: Boolean = false
) : UiState

/**
 * 好友详情事件
 */
sealed class FriendDetailEvent : UiEvent {
    data class ShowToast(val message: String) : FriendDetailEvent()
    data class NavigateToChat(val did: String) : FriendDetailEvent()
    data class StartVoiceCall(val did: String) : FriendDetailEvent()
    data class StartVideoCall(val did: String) : FriendDetailEvent()
    data object NavigateBack : FriendDetailEvent()
}
