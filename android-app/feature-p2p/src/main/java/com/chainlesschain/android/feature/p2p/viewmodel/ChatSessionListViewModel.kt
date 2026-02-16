package com.chainlesschain.android.feature.p2p.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.core.common.Result
import com.chainlesschain.android.core.database.dao.P2PMessageDao
import com.chainlesschain.android.core.database.entity.P2PMessageEntity
import com.chainlesschain.android.feature.p2p.repository.social.FriendRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import androidx.compose.runtime.Immutable
import javax.inject.Inject

/**
 * Chat session data model for the session list
 */
data class ChatSession(
    val peerId: String,
    val displayName: String,
    val avatar: String?,
    val lastMessage: String,
    val lastMessageTime: Long,
    val unreadCount: Int,
    val isOutgoing: Boolean
)

/**
 * UI state for the chat session list screen
 */
@Immutable
data class ChatSessionListUiState(
    val isLoading: Boolean = true,
    val sessions: List<ChatSession> = emptyList()
)

/**
 * ViewModel for the chat session list screen.
 *
 * Combines last messages per peer with friend info and unread counts
 * to produce a sorted list of chat sessions.
 */
@HiltViewModel
class ChatSessionListViewModel @Inject constructor(
    private val p2pMessageDao: P2PMessageDao,
    private val friendRepository: FriendRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(ChatSessionListUiState())
    val uiState: StateFlow<ChatSessionListUiState> = _uiState.asStateFlow()

    init {
        loadSessions()
    }

    private fun loadSessions() {
        viewModelScope.launch {
            p2pMessageDao.getLastMessagePerPeer()
                .collect { lastMessages ->
                    val sessions = lastMessages.map { message ->
                        buildSession(message)
                    }.sortedByDescending { it.lastMessageTime }

                    _uiState.value = ChatSessionListUiState(
                        isLoading = false,
                        sessions = sessions
                    )
                }
        }
    }

    private suspend fun buildSession(message: P2PMessageEntity): ChatSession {
        // Look up friend info for display name / avatar
        val friendResult = friendRepository.getFriendByDid(message.peerId)
        val friend = (friendResult as? Result.Success)?.data

        // Get unread count (collect first value)
        val unreadCount = p2pMessageDao.getUnreadCount(message.peerId).firstOrNull() ?: 0

        return ChatSession(
            peerId = message.peerId,
            displayName = friend?.remarkName
                ?: friend?.nickname
                ?: message.peerId.takeLast(8),
            avatar = friend?.avatar,
            lastMessage = message.content,
            lastMessageTime = message.timestamp,
            unreadCount = unreadCount,
            isOutgoing = message.isOutgoing
        )
    }
}
