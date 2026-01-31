package com.chainlesschain.android.feature.p2p.viewmodel.social

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.core.common.Result
import com.chainlesschain.android.core.database.entity.social.PostEntity
import com.chainlesschain.android.core.database.entity.social.PostEditHistoryEntity
import com.chainlesschain.android.core.database.entity.social.PostVisibility
import com.chainlesschain.android.feature.p2p.repository.social.PostRepository
import com.chainlesschain.android.feature.p2p.util.EditPermission
import com.chainlesschain.android.feature.p2p.util.EditWarning
import com.chainlesschain.android.feature.p2p.util.PostEditPolicy
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import timber.log.Timber
import javax.inject.Inject

/**
 * 编辑动态ViewModel
 *
 * 功能：
 * - 加载动态数据
 * - 检查编辑权限
 * - 管理编辑状态
 * - 保存修改
 * - 记录编辑历史
 *
 * @since v0.31.0
 */
@HiltViewModel
class EditPostViewModel @Inject constructor(
    private val postRepository: PostRepository,
    savedStateHandle: SavedStateHandle
) : ViewModel() {

    private val postId: String = savedStateHandle["postId"] ?: ""

    /**
     * UI状态
     */
    data class EditPostUiState(
        val originalPost: PostEntity? = null,
        val content: String = "",
        val images: List<String> = emptyList(),
        val hasChanges: Boolean = false,
        val isLoading: Boolean = false,
        val isSaving: Boolean = false,
        val editPermission: EditPermission? = null,
        val warning: EditWarning? = null,
        val canAddImages: Boolean = false,
        val errorMessage: String? = null
    )

    private val _uiState = MutableStateFlow(EditPostUiState())
    val uiState: StateFlow<EditPostUiState> = _uiState.asStateFlow()

    private val _events = MutableSharedFlow<EditPostEvent>()
    val events: SharedFlow<EditPostEvent> = _events.asSharedFlow()

    /**
     * 加载动态
     */
    fun loadPost(postId: String) = viewModelScope.launch {
        _uiState.update { it.copy(isLoading = true, errorMessage = null) }

        try {
            // 从PostRepository获取动态
            val result = postRepository.getPostById(postId)
            val post = when (result) {
                is Result.Success -> result.data
                is Result.Error -> {
                    _events.emit(EditPostEvent.LoadError(result.exception.message ?: "加载失败"))
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            errorMessage = result.exception.message ?: "加载失败"
                        )
                    }
                    return@launch
                }
                is Result.Loading -> null
            }

            if (post == null) {
                _events.emit(EditPostEvent.LoadError("动态不存在"))
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        errorMessage = "动态不存在"
                    )
                }
                return@launch
            }

            // TODO: 从DIDManager获取当前用户DID
            val currentUserDid = "did:key:current_user"

            // 检查编辑权限
            val permission = PostEditPolicy.canEdit(post, currentUserDid)
            when (permission) {
                is EditPermission.Denied -> {
                    _events.emit(EditPostEvent.LoadError(permission.reason))
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            errorMessage = permission.reason
                        )
                    }
                    return@launch
                }
                is EditPermission.Allowed -> {
                    // 检查是否需要警告
                    val warning = PostEditPolicy.shouldWarnBeforeEdit(post)

                    _uiState.update {
                        it.copy(
                            originalPost = post,
                            content = post.content,
                            images = post.images ?: emptyList(),
                            editPermission = permission,
                            warning = warning,
                            canAddImages = (post.images?.size ?: 0) < 9,
                            isLoading = false,
                            hasChanges = false
                        )
                    }

                    Timber.d("Post loaded successfully: $postId")
                }
            }
        } catch (e: Exception) {
            Timber.e(e, "Failed to load post")
            _events.emit(EditPostEvent.LoadError(e.message ?: "加载失败"))
            _uiState.update {
                it.copy(
                    isLoading = false,
                    errorMessage = e.message ?: "加载失败"
                )
            }
        }
    }

    /**
     * 更新内容
     */
    fun updateContent(newContent: String) {
        _uiState.update {
            val hasChanges = newContent != it.originalPost?.content ||
                    it.images != it.originalPost?.images

            it.copy(
                content = newContent,
                hasChanges = hasChanges
            )
        }
    }

    /**
     * 删除图片
     */
    fun removeImage(imageUrl: String) {
        _uiState.update {
            val newImages = it.images.filter { url -> url != imageUrl }
            val hasChanges = newImages != it.originalPost?.images ||
                    it.content != it.originalPost?.content

            it.copy(
                images = newImages,
                hasChanges = hasChanges,
                canAddImages = newImages.size < 9
            )
        }
    }

    /**
     * 添加图片
     */
    fun addImages(imageUrls: List<String>) {
        _uiState.update {
            val currentImages = it.images
            val newImages = (currentImages + imageUrls).take(9) // 最多9张
            val hasChanges = newImages != it.originalPost?.images ||
                    it.content != it.originalPost?.content

            it.copy(
                images = newImages,
                hasChanges = hasChanges,
                canAddImages = newImages.size < 9
            )
        }
    }

    /**
     * 保存修改
     */
    fun saveChanges() = viewModelScope.launch {
        val state = _uiState.value
        val originalPost = state.originalPost ?: return@launch

        if (!state.hasChanges) {
            _events.emit(EditPostEvent.SaveError("没有修改"))
            return@launch
        }

        _uiState.update { it.copy(isSaving = true) }

        try {
            // 创建编辑历史记录
            val editHistory = PostEditHistoryEntity(
                id = java.util.UUID.randomUUID().toString(),
                postId = originalPost.id,
                previousContent = originalPost.content,
                previousImages = originalPost.images,
                previousLinkUrl = originalPost.linkUrl,
                previousLinkPreview = originalPost.linkPreview,
                previousTags = originalPost.tags,
                editedAt = System.currentTimeMillis(),
                editReason = "用户编辑",
                metadata = null
            )

            // 更新动态
            val updatedPost = originalPost.copy(
                content = state.content,
                images = state.images,
                updatedAt = System.currentTimeMillis()
            )

            // 保存到数据库
            val result = postRepository.updatePostWithHistory(updatedPost, editHistory)

            when (result) {
                is Result.Success -> {
                    Timber.d("Post updated successfully: ${originalPost.id}")
                    _events.emit(EditPostEvent.SaveSuccess)
                }
                is Result.Error -> {
                    Timber.e(result.exception, "Failed to save post")
                    _events.emit(EditPostEvent.SaveError(result.exception.message ?: "保存失败"))
                    _uiState.update { it.copy(isSaving = false) }
                }
                is Result.Loading -> {}
            }
        } catch (e: Exception) {
            Timber.e(e, "Failed to save post")
            _events.emit(EditPostEvent.SaveError(e.message ?: "保存失败"))
            _uiState.update { it.copy(isSaving = false) }
        }
    }
}

/**
 * 编辑事件
 */
sealed class EditPostEvent {
    /** 保存成功 */
    object SaveSuccess : EditPostEvent()

    /** 保存失败 */
    data class SaveError(val message: String) : EditPostEvent()

    /** 加载失败 */
    data class LoadError(val message: String) : EditPostEvent()
}
