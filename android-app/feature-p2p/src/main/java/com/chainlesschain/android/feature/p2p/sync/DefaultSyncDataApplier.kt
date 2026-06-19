package com.chainlesschain.android.feature.p2p.sync

import timber.log.Timber
import com.chainlesschain.android.core.p2p.sync.FamilyGuardSyncApplier
import com.chainlesschain.android.core.p2p.sync.FamilyTaskSyncApplier
import com.chainlesschain.android.core.p2p.sync.KnowledgeSyncApplier
import com.chainlesschain.android.core.p2p.sync.PointsLedgerSyncApplier
import com.chainlesschain.android.core.p2p.sync.ProjectSyncApplier
import com.chainlesschain.android.core.p2p.sync.ResourceType
import com.chainlesschain.android.core.p2p.sync.SyncDataApplier
import com.chainlesschain.android.core.p2p.sync.TelemetrySyncApplier
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
 *
 * v1.1 W1 (2026-05-12)：增 KNOWLEDGE_ITEM 路径。跨模块走 core-p2p
 * `KnowledgeSyncApplier` 接口（feature-knowledge 实现），避免 feature-p2p →
 * feature-knowledge 横向依赖。
 */
@Singleton
class DefaultSyncDataApplier @Inject constructor(
    private val messageRepository: P2PMessageRepository,
    private val friendRepository: FriendRepository,
    private val postRepository: PostRepository,
    private val notificationRepository: NotificationRepository,
    private val knowledgeSyncApplier: KnowledgeSyncApplier,
    private val projectSyncApplier: ProjectSyncApplier,
    private val familyGuardSyncApplier: FamilyGuardSyncApplier,
    private val telemetrySyncApplier: TelemetrySyncApplier,
    private val familyTaskSyncApplier: FamilyTaskSyncApplier,
    private val pointsLedgerSyncApplier: PointsLedgerSyncApplier,
) : SyncDataApplier {

    override suspend fun create(resourceType: ResourceType, resourceId: String, data: String) {
        Timber.d("Creating $resourceType: $resourceId")
        when (resourceType) {
            ResourceType.KNOWLEDGE_ITEM -> knowledgeSyncApplier.saveFromSync(resourceId, data)
            ResourceType.PROJECT -> projectSyncApplier.saveFromSync(resourceId, data)
            ResourceType.MESSAGE -> messageRepository.saveMessageFromSync(resourceId, data)
            ResourceType.CONTACT, ResourceType.FRIEND -> friendRepository.saveFriendFromSync(resourceId, data)
            ResourceType.POST -> postRepository.savePostFromSync(resourceId, data)
            ResourceType.POST_COMMENT -> postRepository.saveCommentFromSync(resourceId, data)
            ResourceType.NOTIFICATION -> notificationRepository.saveNotificationFromSync(resourceId, data)
            ResourceType.FAMILY_GROUP -> familyGuardSyncApplier.saveFamilyGroupFromSync(resourceId, data)
            ResourceType.FAMILY_MEMBERSHIP -> familyGuardSyncApplier.saveFamilyMembershipFromSync(resourceId, data)
            ResourceType.TELEMETRY -> telemetrySyncApplier.saveTelemetryFromSync(resourceId, data)
            ResourceType.FAMILY_TASK -> familyTaskSyncApplier.saveTaskFromSync(resourceId, data)
            ResourceType.POINTS_EVENT -> pointsLedgerSyncApplier.savePointsEventFromSync(resourceId, data)
            else -> Timber.w("Unsupported resource type for create: $resourceType")
        }
    }

    override suspend fun update(resourceType: ResourceType, resourceId: String, data: String) {
        Timber.d("Updating $resourceType: $resourceId")
        when (resourceType) {
            ResourceType.KNOWLEDGE_ITEM -> knowledgeSyncApplier.updateFromSync(resourceId, data)
            ResourceType.PROJECT -> projectSyncApplier.updateFromSync(resourceId, data)
            ResourceType.MESSAGE -> messageRepository.updateMessageFromSync(resourceId, data)
            ResourceType.CONTACT, ResourceType.FRIEND -> friendRepository.updateFriendFromSync(resourceId, data)
            ResourceType.POST -> postRepository.updatePostFromSync(resourceId, data)
            ResourceType.POST_COMMENT -> postRepository.updateCommentFromSync(resourceId, data)
            ResourceType.NOTIFICATION -> notificationRepository.updateNotificationFromSync(resourceId, data)
            ResourceType.FAMILY_GROUP -> familyGuardSyncApplier.updateFamilyGroupFromSync(resourceId, data)
            ResourceType.FAMILY_MEMBERSHIP -> familyGuardSyncApplier.updateFamilyMembershipFromSync(resourceId, data)
            // telemetry append-only：UPDATE 复用保存（幂等），无独立更新语义
            ResourceType.TELEMETRY -> telemetrySyncApplier.saveTelemetryFromSync(resourceId, data)
            ResourceType.FAMILY_TASK -> familyTaskSyncApplier.updateTaskFromSync(resourceId, data)
            // points append-only：UPDATE 复用保存（幂等），无独立更新语义
            ResourceType.POINTS_EVENT -> pointsLedgerSyncApplier.savePointsEventFromSync(resourceId, data)
            else -> Timber.w("Unsupported resource type for update: $resourceType")
        }
    }

    override suspend fun delete(resourceType: ResourceType, resourceId: String) {
        Timber.d("Deleting $resourceType: $resourceId")
        when (resourceType) {
            ResourceType.KNOWLEDGE_ITEM -> knowledgeSyncApplier.deleteFromSync(resourceId)
            ResourceType.PROJECT -> projectSyncApplier.deleteFromSync(resourceId)
            ResourceType.MESSAGE -> messageRepository.deleteMessageFromSync(resourceId)
            ResourceType.CONTACT, ResourceType.FRIEND -> friendRepository.deleteFriendFromSync(resourceId)
            ResourceType.POST -> postRepository.deletePostFromSync(resourceId)
            ResourceType.POST_COMMENT -> postRepository.deleteCommentFromSync(resourceId)
            ResourceType.NOTIFICATION -> notificationRepository.deleteNotificationFromSync(resourceId)
            ResourceType.FAMILY_TASK -> familyTaskSyncApplier.deleteTaskFromSync(resourceId)
            // points append-only：无 DELETE 语义
            else -> Timber.w("Unsupported resource type for delete: $resourceType")
        }
    }
}
