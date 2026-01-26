package com.chainlesschain.android.feature.p2p.viewmodel.social

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.core.common.error.onFailure
import com.chainlesschain.android.core.common.error.onSuccess
import com.chainlesschain.android.core.common.viewmodel.BaseViewModel
import com.chainlesschain.android.core.common.viewmodel.UiEvent
import com.chainlesschain.android.core.common.viewmodel.UiState
import com.chainlesschain.android.core.database.entity.social.PostCommentEntity
import com.chainlesschain.android.feature.p2p.repository.social.FriendRepository
import com.chainlesschain.android.feature.p2p.repository.social.PostRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * 评论详情 ViewModel
 *
 * 显示评论的详细信息和回复列表
 */
@HiltViewModel
class CommentDetailViewModel @Inject constructor(
    private val postRepository: PostRepository,
    private val friendRepository: FriendRepository,
    savedStateHandle: SavedStateHandle
) : BaseViewModel<CommentDetailUiState, CommentDetailEvent>(
    initialState = CommentDetailUiState()
) {

    private val commentId: String = savedStateHandle.get<String>("commentId") ?: ""
    private var myDid: String = "" // TODO: Get from DID service

    init {
        if (commentId.isNotBlank()) {
            loadComment()
            loadReplies()
        }
    }

    /**
     * 加载评论
     */
    private fun loadComment() {
        viewModelScope.launch(exceptionHandler) {
            postRepository.observeCommentById(commentId).collectLatest { result ->
                result.onSuccess { comment ->
                    updateState { copy(comment = comment, isLoadingComment = false) }
                    // 加载作者信息
                    comment?.let { loadAuthorInfo(it.authorDid) }
                }.onFailure { error ->
                    updateState { copy(isLoadingComment = false) }
                    handleError(error)
                }
            }
        }
    }

    /**
     * 加载回复列表
     */
    private fun loadReplies() {
        viewModelScope.launch(exceptionHandler) {
            postRepository.getCommentReplies(commentId).collectLatest { result ->
                result.onSuccess { replies ->
                    updateState { copy(replies = replies) }
                    // 加载所有回复作者的信息
                    replies.forEach { reply ->
                        loadAuthorInfo(reply.authorDid)
                    }
                }.onFailure { error ->
                    handleError(error)
                }
            }
        }
    }

    /**
     * 加载作者信息
     */
    private fun loadAuthorInfo(did: String) {
        viewModelScope.launch(exceptionHandler) {
            friendRepository.getFriendByDid(did).onSuccess { friend ->
                val authorInfo = friend?.let {
                    UserInfo(
                        did = it.did,
                        nickname = it.remarkName ?: it.nickname,
                        avatar = it.avatar,
                        bio = it.bio
                    )
                } ?: UserInfo(
                    did = did,
                    nickname = "用户 ${did.take(8)}",
                    avatar = null,
                    bio = null
                )

                updateState {
                    copy(authorInfo = authorInfo + (did to authorInfo))
                }
            }
        }
    }

    /**
     * 发表回复
     */
    fun addReply(content: String) = launchSafely {
        if (content.isBlank()) {
            sendEvent(CommentDetailEvent.ShowToast("回复内容不能为空"))
            return@launchSafely
        }

        val comment = uiState.value.comment ?: return@launchSafely

        val reply = PostCommentEntity(
            id = "comment_${System.currentTimeMillis()}_${myDid}",
            postId = comment.postId,
            authorDid = myDid,
            content = content,
            parentCommentId = commentId,
            createdAt = System.currentTimeMillis()
        )

        postRepository.addComment(reply)
            .onSuccess {
                sendEvent(CommentDetailEvent.ShowToast("回复成功"))
                sendEvent(CommentDetailEvent.ReplyAdded)
            }.onFailure { error ->
                handleError(error)
            }
    }

    /**
     * 点赞评论
     */
    fun likeComment() = launchSafely {
        postRepository.likeComment(commentId)
            .onSuccess {
                sendEvent(CommentDetailEvent.ShowToast("点赞成功"))
            }.onFailure { error ->
                handleError(error)
            }
    }

    /**
     * 点赞回复
     */
    fun likeReply(replyId: String) = launchSafely {
        postRepository.likeComment(replyId)
            .onSuccess {
                sendEvent(CommentDetailEvent.ShowToast("点赞成功"))
            }.onFailure { error ->
                handleError(error)
            }
    }
}

/**
 * 评论详情 UI 状态
 */
data class CommentDetailUiState(
    val comment: PostCommentEntity? = null,
    val replies: List<PostCommentEntity> = emptyList(),
    val authorInfo: Map<String, UserInfo> = emptyMap(),
    val isLoadingComment: Boolean = true
) : UiState

/**
 * 评论详情事件
 */
sealed class CommentDetailEvent : UiEvent {
    data class ShowToast(val message: String) : CommentDetailEvent()
    data object ReplyAdded : CommentDetailEvent()
}
