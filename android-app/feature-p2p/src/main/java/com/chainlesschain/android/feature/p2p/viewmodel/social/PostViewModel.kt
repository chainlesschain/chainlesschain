package com.chainlesschain.android.feature.p2p.viewmodel.social
import com.chainlesschain.android.core.common.Result

import com.chainlesschain.android.core.common.onError
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.core.common.onSuccess
import com.chainlesschain.android.core.common.viewmodel.BaseViewModel
import com.chainlesschain.android.core.common.viewmodel.UiEvent
import com.chainlesschain.android.core.common.viewmodel.UiState
import com.chainlesschain.android.core.database.entity.social.PostEntity
import com.chainlesschain.android.core.database.entity.social.PostCommentEntity
import com.chainlesschain.android.core.database.entity.social.PostVisibility
import com.chainlesschain.android.core.database.entity.social.ReportReason
import com.chainlesschain.android.core.p2p.realtime.NotificationType
import com.chainlesschain.android.core.p2p.realtime.RealtimeEventManager
import com.chainlesschain.android.feature.p2p.repository.social.FriendRepository
import com.chainlesschain.android.feature.p2p.repository.social.PostRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * 动态 ViewModel
 *
 * 管理时间流、用户动态、点赞、评论等
 */
@HiltViewModel
class PostViewModel @Inject constructor(
    private val postRepository: PostRepository,
    private val friendRepository: FriendRepository,
    private val realtimeEventManager: RealtimeEventManager
) : BaseViewModel<PostUiState, PostEvent>(
    initialState = PostUiState()
) {

    private var currentMyDid: String = ""
    private var currentFriendDids: List<String> = emptyList()

    /**
     * 初始化（设置当前用户 DID 和好友列表）
     */
    fun initialize(myDid: String, friendDids: List<String>) {
        currentMyDid = myDid
        currentFriendDids = friendDids
        loadTimeline()
    }

    // ===== 时间流 =====

    /**
     * 加载时间流
     */
    fun loadTimeline(refresh: Boolean = false) {
        if (refresh) {
            updateState { copy(isRefreshing = true) }
        }

        viewModelScope.launch(exceptionHandler) {
            postRepository.getTimeline(
                friendDids = currentFriendDids,
                myDid = currentMyDid,
                limit = 20,
                offset = currentState.timelinePosts.size
            ).collectLatest { result ->
                result.onSuccess { posts ->
                    updateState {
                        copy(
                            timelinePosts = if (refresh) posts else timelinePosts + posts,
                            isLoadingTimeline = false,
                            isRefreshing = false,
                            hasMoreTimeline = posts.isNotEmpty()
                        )
                    }
                }.onError { error ->
                    updateState { copy(isLoadingTimeline = false, isRefreshing = false) }
                    handleError(error)
                }
            }
        }
    }

    /**
     * 刷新时间流
     */
    fun refreshTimeline() {
        updateState { copy(timelinePosts = emptyList()) }
        loadTimeline(refresh = true)
    }

    /**
     * 加载更多
     */
    fun loadMoreTimeline() {
        if (!currentState.isLoadingTimeline && currentState.hasMoreTimeline) {
            loadTimeline()
        }
    }

    // ===== 用户动态 =====

    /**
     * 加载用户动态
     */
    fun loadUserPosts(did: String) {
        viewModelScope.launch(exceptionHandler) {
            updateState { copy(isLoadingUserPosts = true) }
            postRepository.getUserPosts(did).collectLatest { result ->
                result.onSuccess { posts ->
                    updateState { copy(userPosts = posts, isLoadingUserPosts = false) }
                }.onError { error ->
                    updateState { copy(isLoadingUserPosts = false) }
                    handleError(error)
                }
            }
        }
    }

    /**
     * 加载动态详情
     */
    fun loadPostDetail(postId: String) {
        viewModelScope.launch(exceptionHandler) {
            postRepository.observePostById(postId).collectLatest { result ->
                result.onSuccess { post ->
                    updateState { copy(currentPost = post) }
                }.onError { error ->
                    handleError(error)
                }
            }
        }
    }

    // ===== 发布/编辑动态 =====

    /**
     * 发布动态
     */
    fun publishPost(
        content: String,
        images: List<String> = emptyList(),
        tags: List<String> = emptyList(),
        mentions: List<String> = emptyList(),
        visibility: PostVisibility = PostVisibility.PUBLIC,
        linkUrl: String? = null,
        linkPreview: String? = null
    ) = launchSafely {
        val post = PostEntity(
            id = "post_${System.currentTimeMillis()}",
            authorDid = currentMyDid,
            content = content,
            images = images,
            tags = tags,
            mentions = mentions,
            visibility = visibility,
            linkUrl = linkUrl,
            linkPreview = linkPreview,
            createdAt = System.currentTimeMillis()
        )

        postRepository.createPost(post)
            .onSuccess {
                sendEvent(PostEvent.ShowToast("动态已发布"))
                sendEvent(PostEvent.PostPublished)
                refreshTimeline()
            }.onError { error ->
                handleError(error)
            }
    }

    /**
     * 编辑动态
     */
    fun editPost(postId: String, newContent: String) = launchSafely {
        postRepository.updatePostContent(postId, newContent, System.currentTimeMillis())
            .onSuccess {
                sendEvent(PostEvent.ShowToast("动态已更新"))
            }.onError { error ->
                handleError(error)
            }
    }

    /**
     * 删除动态
     */
    fun deletePost(postId: String) = launchSafely {
        postRepository.deletePost(postId)
            .onSuccess {
                sendEvent(PostEvent.ShowToast("动态已删除"))
                refreshTimeline()
            }.onError { error ->
                handleError(error)
            }
    }

    /**
     * 置顶动态
     */
    fun pinPost(postId: String) = launchSafely {
        postRepository.pinPost(postId, currentMyDid)
            .onSuccess {
                sendEvent(PostEvent.ShowToast("动态已置顶"))
            }.onError { error ->
                handleError(error)
            }
    }

    /**
     * 取消置顶
     */
    fun unpinPost(postId: String) = launchSafely {
        postRepository.unpinPost(postId)
            .onSuccess {
                sendEvent(PostEvent.ShowToast("已取消置顶"))
            }.onError { error ->
                handleError(error)
            }
    }

    // ===== 点赞 =====

    /**
     * 切换点赞状态
     */
    fun toggleLike(postId: String, currentlyLiked: Boolean, authorDid: String) = launchSafely {
        if (currentlyLiked) {
            postRepository.unlikePost(postId, currentMyDid)
        } else {
            postRepository.likePost(postId, currentMyDid)
                .onSuccess {
                    // 发送实时通知给动态作者
                    if (authorDid != currentMyDid) {
                        realtimeEventManager.sendNotification(
                            targetDid = authorDid,
                            notificationType = NotificationType.LIKE,
                            title = "收到新的点赞",
                            content = "有人赞了你的动态",
                            targetId = postId
                        )
                    }
                }
        }.onSuccess {
            // 点赞状态会通过 Flow 自动更新
        }.onError { error ->
            handleError(error)
        }
    }

    /**
     * 分享动态
     */
    fun sharePost(postId: String, authorDid: String) = launchSafely {
        // 创建分享记录
        val share = com.chainlesschain.android.core.database.entity.social.PostShareEntity(
            id = "share_${System.currentTimeMillis()}",
            postId = postId,
            userDid = currentMyDid,
            createdAt = System.currentTimeMillis()
        )

        postRepository.sharePost(share)
            .onSuccess {
                sendEvent(PostEvent.ShowToast("分享成功"))
                sendEvent(PostEvent.PostShared(postId))

                // 发送实时通知给动态作者
                if (authorDid != currentMyDid) {
                    realtimeEventManager.sendNotification(
                        targetDid = authorDid,
                        notificationType = NotificationType.POST,
                        title = "动态被分享",
                        content = "有人分享了你的动态",
                        targetId = postId
                    )
                }
            }.onError { error ->
                handleError(error)
            }
    }

    /**
     * 切换收藏状态
     *
     * @since v0.32.0
     */
    fun toggleBookmark(postId: String, currentlyBookmarked: Boolean) = launchSafely {
        if (currentlyBookmarked) {
            postRepository.unbookmarkPost(postId, currentMyDid)
                .onSuccess {
                    sendEvent(PostEvent.ShowToast("已取消收藏"))
                }
        } else {
            postRepository.bookmarkPost(postId, currentMyDid)
                .onSuccess {
                    sendEvent(PostEvent.ShowToast("收藏成功"))
                }
        }.onError { error ->
            handleError(error)
        }
    }

    // ===== 评论 =====

    /**
     * 加载评论列表
     */
    fun loadComments(postId: String) {
        viewModelScope.launch(exceptionHandler) {
            updateState { copy(isLoadingComments = true) }
            postRepository.getPostComments(postId).collectLatest { result ->
                result.onSuccess { comments ->
                    updateState { copy(comments = comments, isLoadingComments = false) }
                }.onError { error ->
                    updateState { copy(isLoadingComments = false) }
                    handleError(error)
                }
            }
        }
    }

    /**
     * 加载评论的回复
     */
    fun loadCommentReplies(commentId: String) {
        viewModelScope.launch(exceptionHandler) {
            postRepository.getCommentReplies(commentId).collectLatest { result ->
                result.onSuccess { replies ->
                    updateState {
                        copy(commentReplies = commentReplies + (commentId to replies))
                    }
                }
            }
        }
    }

    /**
     * 发表评论
     */
    fun addComment(postId: String, content: String, authorDid: String, parentCommentId: String? = null) = launchSafely {
        val comment = PostCommentEntity(
            id = "comment_${System.currentTimeMillis()}",
            postId = postId,
            authorDid = currentMyDid,
            content = content,
            parentCommentId = parentCommentId,
            createdAt = System.currentTimeMillis()
        )

        postRepository.addComment(comment)
            .onSuccess {
                // 发送实时通知给动态作者
                if (authorDid != currentMyDid) {
                    realtimeEventManager.sendNotification(
                        targetDid = authorDid,
                        notificationType = NotificationType.COMMENT,
                        title = "收到新评论",
                        content = content.take(50),
                        targetId = postId
                    )
                }
                sendEvent(PostEvent.ShowToast("评论已发布"))
                sendEvent(PostEvent.CommentAdded)
            }.onError { error ->
                handleError(error)
            }
    }

    /**
     * 删除评论
     */
    fun deleteComment(comment: PostCommentEntity) = launchSafely {
        postRepository.deleteComment(comment)
            .onSuccess {
                sendEvent(PostEvent.ShowToast("评论已删除"))
            }.onError { error ->
                handleError(error)
            }
    }

    /**
     * 切换评论点赞状态
     */
    fun toggleCommentLike(commentId: String, currentlyLiked: Boolean) = launchSafely {
        if (currentlyLiked) {
            postRepository.unlikeComment(commentId)
        } else {
            postRepository.likeComment(commentId)
        }.onSuccess {
            // 状态会通过 Flow 自动更新
        }.onError { error ->
            handleError(error)
        }
    }

    // ===== 搜索和筛选 =====

    /**
     * 搜索动态
     */
    fun searchPosts(query: String) {
        if (query.isBlank()) {
            loadTimeline()
            return
        }

        viewModelScope.launch(exceptionHandler) {
            updateState { copy(isSearching = true, searchQuery = query) }
            postRepository.searchPosts(query, null, currentMyDid, currentFriendDids).collectLatest { result ->
                result.onSuccess { posts ->
                    updateState { copy(timelinePosts = posts, isSearching = false) }
                }.onError { error ->
                    updateState { copy(isSearching = false) }
                    handleError(error)
                }
            }
        }
    }

    /**
     * 按标签筛选
     */
    fun filterByTag(tag: String) {
        viewModelScope.launch(exceptionHandler) {
            updateState { copy(isLoadingTimeline = true, selectedTag = tag) }
            postRepository.getPostsByTag(tag, currentMyDid, currentFriendDids).collectLatest { result ->
                result.onSuccess { posts ->
                    updateState { copy(timelinePosts = posts, isLoadingTimeline = false) }
                }.onError { error ->
                    updateState { copy(isLoadingTimeline = false) }
                    handleError(error)
                }
            }
        }
    }

    /**
     * 清除标签筛选
     */
    fun clearTagFilter() {
        updateState { copy(selectedTag = null) }
        refreshTimeline()
    }

    // ===== 举报和屏蔽 =====

    /**
     * 举报动态
     */
    fun reportPost(postId: String, reporterDid: String, reason: ReportReason, description: String?) = launchSafely {
        postRepository.reportPost(postId, reporterDid, reason, description)
            .onSuccess {
                sendEvent(PostEvent.ShowToast("举报已提交，感谢您的反馈"))
            }.onError { error ->
                handleError(error)
            }
    }

    /**
     * 屏蔽动态作者
     */
    fun blockUserFromPost(authorDid: String) = launchSafely {
        friendRepository.blockUser(currentMyDid, authorDid, "从动态屏蔽")
            .onSuccess {
                sendEvent(PostEvent.ShowToast("已屏蔽该用户"))
                refreshTimeline() // 刷新时间流以隐藏被屏蔽用户的内容
            }.onError { error ->
                handleError(error)
            }
    }

    // ===== 编辑历史 =====

    /**
     * 获取动态的编辑历史
     *
     * @param postId 动态ID
     * @return 编辑历史Flow
     * @since v0.31.0
     */
    fun getPostEditHistory(postId: String) = postRepository.getPostEditHistory(postId)

    // ===== UI 交互 =====

    /**
     * 显示评论输入框
     */
    fun showCommentInput(postId: String, parentCommentId: String? = null) {
        updateState {
            copy(
                showCommentInput = true,
                commentPostId = postId,
                commentParentId = parentCommentId
            )
        }
    }

    /**
     * 隐藏评论输入框
     */
    fun hideCommentInput() {
        updateState {
            copy(
                showCommentInput = false,
                commentPostId = null,
                commentParentId = null
            )
        }
    }

    /**
     * 显示动态操作菜单
     */
    fun showPostMenu(post: PostEntity) {
        updateState { copy(currentPost = post, showPostMenu = true) }
    }

    /**
     * 隐藏动态操作菜单
     */
    fun hidePostMenu() {
        updateState { copy(showPostMenu = false) }
    }
}

/**
 * 动态 UI 状态
 */
data class PostUiState(
    val timelinePosts: List<PostEntity> = emptyList(),
    val userPosts: List<PostEntity> = emptyList(),
    val currentPost: PostEntity? = null,
    val comments: List<PostCommentEntity> = emptyList(),
    val commentReplies: Map<String, List<PostCommentEntity>> = emptyMap(),
    val isLoadingTimeline: Boolean = true,
    val isLoadingUserPosts: Boolean = false,
    val isLoadingComments: Boolean = false,
    val isRefreshing: Boolean = false,
    val hasMoreTimeline: Boolean = true,
    val isSearching: Boolean = false,
    val searchQuery: String = "",
    val selectedTag: String? = null,
    val showCommentInput: Boolean = false,
    val commentPostId: String? = null,
    val commentParentId: String? = null,
    val showPostMenu: Boolean = false
) : UiState

/**
 * 动态事件
 */
sealed class PostEvent : UiEvent {
    data class ShowToast(val message: String) : PostEvent()
    object PostPublished : PostEvent()
    object CommentAdded : PostEvent()
    data class PostShared(val postId: String) : PostEvent()
    data class NavigateToPostDetail(val postId: String) : PostEvent()
    data class NavigateToUserProfile(val did: String) : PostEvent()
}
