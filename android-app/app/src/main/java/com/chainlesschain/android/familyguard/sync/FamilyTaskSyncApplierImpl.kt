package com.chainlesschain.android.familyguard.sync

import com.chainlesschain.android.core.p2p.sync.FamilyTaskSyncApplier
import com.chainlesschain.android.feature.familyguard.domain.repository.FamilyRelationshipRepository
import com.chainlesschain.android.feature.familyguard.domain.repository.FamilyTaskRepository
import com.chainlesschain.android.feature.familyguard.domain.task.FamilyTask
import com.chainlesschain.android.feature.familyguard.domain.task.FamilyTaskMerge
import javax.inject.Inject
import javax.inject.Singleton
import timber.log.Timber

/**
 * [FamilyTaskSyncApplier] 的 :app 实装 (FAMILY-67 任务下行落库)。
 *
 * 收到对端 [com.chainlesschain.android.core.p2p.sync.ResourceType.FAMILY_TASK] sync item →
 * [FamilyTaskSyncRecord.decode] 解码 → 业务级鉴权 → 若本机已有同 id 任务跑
 * [FamilyTaskMerge.merge] 解冲突 → [FamilyTaskRepository.upsert] 落库。
 *
 * **业务鉴权 (传输层 SyncAuthVerifier 已验签发送 DID 之上的二道闸)**：任务必须属于本机参与的
 * **活跃家庭**——布置者 (assignerDid) 或孩子 (childDid) 至少一方是活跃 family_relationship 好友。
 * 这同时覆盖双向：孩子端收布置时 assignerDid=家长(好友)，家长端收提交回传时 childDid=孩子(好友)。
 * 非家庭的已连 peer 注入的任务被丢弃。具体「只有 PARENT 能布置」由发端 outbox 保证 (孩子端无布置
 * 入口)，此处不做 role 细分以免误拒合法的孩子→家长回传。
 *
 * 鲁棒：坏 JSON / 未知枚举 (fromStorage 兜底) / 落库异常 → 记日志丢弃，不抛 (避免一条坏数据
 * 阻断整条同步管线)。
 */
@Singleton
class FamilyTaskSyncApplierImpl @Inject constructor(
    private val taskRepository: FamilyTaskRepository,
    private val relationshipRepository: FamilyRelationshipRepository,
) : FamilyTaskSyncApplier {

    override suspend fun saveTaskFromSync(resourceId: String, data: String) = applyUpsert(resourceId, data)

    override suspend fun updateTaskFromSync(resourceId: String, data: String) = applyUpsert(resourceId, data)

    override suspend fun deleteTaskFromSync(resourceId: String) {
        val id = taskIdFromResourceId(resourceId) ?: run {
            Timber.w("[FamilyTaskSync] delete: bad resourceId %s", resourceId)
            return
        }
        // 只删本机已存在且属活跃家庭的任务 (防止已连非家庭 peer 用任意 id 触发删除)。
        val local = runCatching { taskRepository.getById(id) }.getOrNull() ?: return
        if (!belongsToActiveFamily(local)) {
            Timber.w("[FamilyTaskSync] delete rejected — not an active family task: %s", resourceId)
            return
        }
        runCatching { taskRepository.delete(id) }
            .onFailure { Timber.e(it, "[FamilyTaskSync] delete failed: %s", resourceId) }
    }

    private suspend fun applyUpsert(resourceId: String, data: String) {
        val incoming = runCatching { FamilyTaskSyncRecord.decode(data) }.getOrElse {
            Timber.w(it, "[FamilyTaskSync] malformed task sync data: %s", resourceId)
            return
        }
        if (!belongsToActiveFamily(incoming)) {
            Timber.w(
                "[FamilyTaskSync] rejected — assigner/child not active family member: %s",
                resourceId,
            )
            return
        }
        val local = runCatching { taskRepository.getById(incoming.id) }.getOrNull()
        val merged = if (local != null) FamilyTaskMerge.merge(local, incoming) else incoming
        runCatching { taskRepository.upsert(merged) }
            .onFailure { Timber.e(it, "[FamilyTaskSync] upsert failed: %s", incoming.id) }
    }

    /** 任务必须属于本机参与的活跃家庭 (布置者或孩子是活跃 family_relationship 好友)。 */
    private suspend fun belongsToActiveFamily(task: FamilyTask): Boolean =
        isActiveFamilyFriend(task.assignerDid) || isActiveFamilyFriend(task.childDid)

    private suspend fun isActiveFamilyFriend(did: String): Boolean {
        if (did.isBlank()) return false
        val rel = runCatching { relationshipRepository.findByFriendDid(did) }.getOrNull() ?: return false
        return rel.status == ACTIVE_STATUS
    }

    private fun taskIdFromResourceId(resourceId: String): String? =
        resourceId.substringAfter("$RESOURCE_PREFIX|", "").ifBlank { null }

    private companion object {
        const val RESOURCE_PREFIX = "family_task"
        const val ACTIVE_STATUS = "active"
    }
}
