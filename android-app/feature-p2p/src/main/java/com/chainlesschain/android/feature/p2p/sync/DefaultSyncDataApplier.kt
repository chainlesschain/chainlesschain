package com.chainlesschain.android.feature.p2p.sync

import android.util.Log
import com.chainlesschain.android.core.p2p.sync.ResourceType
import com.chainlesschain.android.core.p2p.sync.SyncDataApplier
import com.chainlesschain.android.feature.p2p.repository.P2PMessageRepository
import com.chainlesschain.android.feature.p2p.repository.social.FriendRepository
import com.chainlesschain.android.feature.p2p.repository.social.NotificationRepository
import com.chainlesschain.android.feature.p2p.repository.social.PostRepository
import javax.inject.Inject
import javax.inject.Singleton

/**
 * SyncDataApplier的默认实现
 *
 * 将同步数据分发到对应的Repository进行数据库持久化。
 * 根据 ResourceType 路由到不同的Repository。
 */
@Singleton
class DefaultSyncDataApplier @Inject constructor(
    private val messageRepository: P2PMessageRepository,
    private val friendRepository: FriendRepository,
    private val postRepository: PostRepository,
    private val notificationRepository: NotificationRepository
) : SyncDataApplier {

    companion object {
        private const val TAG = "DefaultSyncDataApplier"
    }

    override suspend fun create(resourceType: ResourceType, resourceId: String, data: String) {
        Log.d(TAG, "Creating $resourceType: $resourceId")
        when (resourceType) {
            ResourceType.MESSAGE -> messageRepository.saveMessageFromSync(resourceId, data)
            ResourceType.CONTACT, ResourceType.FRIEND -> friendRepository.saveFriendFromSync(resourceId, data)
            ResourceType.POST -> postRepository.savePostFromSync(resourceId, data)
            ResourceType.POST_COMMENT -> postRepository.saveCommentFromSync(resourceId, data)
            ResourceType.NOTIFICATION -> notificationRepository.saveNotificationFromSync(resourceId, data)
            else -> Log.w(TAG, "Unsupported resource type for create: $resourceType")
        }
    }

    override suspend fun update(resourceType: ResourceType, resourceId: String, data: String) {
        Log.d(TAG, "Updating $resourceType: $resourceId")
        when (resourceType) {
            ResourceType.MESSAGE -> messageRepository.updateMessageFromSync(resourceId, data)
            ResourceType.CONTACT, ResourceType.FRIEND -> friendRepository.updateFriendFromSync(resourceId, data)
            ResourceType.POST -> postRepository.updatePostFromSync(resourceId, data)
            ResourceType.POST_COMMENT -> postRepository.updateCommentFromSync(resourceId, data)
            ResourceType.NOTIFICATION -> notificationRepository.updateNotificationFromSync(resourceId, data)
            else -> Log.w(TAG, "Unsupported resource type for update: $resourceType")
        }
    }

    override suspend fun delete(resourceType: ResourceType, resourceId: String) {
        Log.d(TAG, "Deleting $resourceType: $resourceId")
        when (resourceType) {
            ResourceType.MESSAGE -> messageRepository.deleteMessageFromSync(resourceId)
            ResourceType.CONTACT, ResourceType.FRIEND -> friendRepository.deleteFriendFromSync(resourceId)
            ResourceType.POST -> postRepository.deletePostFromSync(resourceId)
            ResourceType.POST_COMMENT -> postRepository.deleteCommentFromSync(resourceId)
            ResourceType.NOTIFICATION -> notificationRepository.deleteNotificationFromSync(resourceId)
            else -> Log.w(TAG, "Unsupported resource type for delete: $resourceType")
        }
    }
}
