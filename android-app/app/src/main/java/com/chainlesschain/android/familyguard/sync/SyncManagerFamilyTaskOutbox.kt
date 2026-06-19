package com.chainlesschain.android.familyguard.sync

import com.chainlesschain.android.core.p2p.sync.ResourceType
import com.chainlesschain.android.core.p2p.sync.SyncItem
import com.chainlesschain.android.core.p2p.sync.SyncManager
import com.chainlesschain.android.core.p2p.sync.SyncOperation
import com.chainlesschain.android.feature.familyguard.domain.sync.FamilyTaskOutbox
import com.chainlesschain.android.feature.familyguard.domain.task.FamilyTask
import dagger.Lazy
import java.time.Clock
import javax.inject.Inject
import javax.inject.Singleton
import timber.log.Timber

/**
 * [FamilyTaskOutbox] 的 :app 真实实装 (FAMILY-67 任务上行)。
 *
 * 把本机变更后的 [FamilyTask] 包成 [ResourceType.FAMILY_TASK] 的 [SyncItem] 排入
 * [SyncManager] pendingChanges；SyncCoordinator 推到已配对对端。覆盖 feature-family-guard 的
 * NoOpFamilyTaskOutbox 默认 (feature 不依赖 core-p2p)。镜像 `SyncManagerFamilyGroupOutbox`。
 *
 * resourceId 稳定 (`family_task|id`) → 同一任务多次变更只在队列保留最新快照 (recordChange 以
 * resourceId 为 key，last-write-wins)。task 可变，故 operation 用 UPDATE (收端 CREATE/UPDATE
 * 同走合并 upsert，语义等价)；删除用 DELETE。
 *
 * [SyncManager] 用 [Lazy] 注入打破依赖环：收端 applier 经 FamilyTaskRepository 写库，而 repo
 * 又依赖本 outbox → SyncManager；SyncManager 自身又依赖 SyncDataApplier→applier。Lazy 把
 * SyncManager 的实例化推迟到首次 enqueue (运行时已构造完毕)，破环且不改语义。
 */
@Singleton
class SyncManagerFamilyTaskOutbox @Inject constructor(
    private val syncManager: Lazy<SyncManager>,
    private val clock: Clock,
) : FamilyTaskOutbox {

    override suspend fun enqueue(task: FamilyTask) {
        val item = SyncItem(
            resourceId = "family_task|${task.id}",
            resourceType = ResourceType.FAMILY_TASK,
            operation = SyncOperation.UPDATE,
            data = FamilyTaskSyncRecord.encode(task),
            timestamp = task.updatedAtMs,
        )
        syncManager.get().recordChange(item)
        Timber.d("family_task → sync queue: %s", item.resourceId)
    }

    override suspend fun enqueueDelete(taskId: String) {
        val item = SyncItem(
            resourceId = "family_task|$taskId",
            resourceType = ResourceType.FAMILY_TASK,
            operation = SyncOperation.DELETE,
            data = "",
            timestamp = clock.millis(),
        )
        syncManager.get().recordChange(item)
        Timber.d("family_task DELETE → sync queue: %s", item.resourceId)
    }
}
