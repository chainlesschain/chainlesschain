package com.chainlesschain.android.feature.familyguard.data.sync

import com.chainlesschain.android.feature.familyguard.domain.sync.FamilyTaskOutbox
import com.chainlesschain.android.feature.familyguard.domain.task.FamilyTask
import javax.inject.Inject
import javax.inject.Singleton
import timber.log.Timber

/**
 * [FamilyTaskOutbox] 默认 no-op 实装。
 *
 * 任务已落本地 family_task 表，但**不上行** —— :feature-family-guard 不依赖 :core-p2p。
 * FAMILY-67 在 :app 层提供把任务包成 SyncItem 并 `SyncManager.recordChange` 的真实适配器，
 * 在 Hilt 图中覆盖本绑定 (同 NoOpFamilyGroupOutbox 模式，供无 sync 宿主可选 fallback)。
 */
@Singleton
class NoOpFamilyTaskOutbox @Inject constructor() : FamilyTaskOutbox {

    override suspend fun enqueue(task: FamilyTask) {
        Timber.d("FamilyTaskOutbox no-op: enqueue task=%s (FAMILY-67 上行未接通)", task.id)
    }

    override suspend fun enqueueDelete(taskId: String) {
        Timber.d("FamilyTaskOutbox no-op: delete task=%s (FAMILY-67 上行未接通)", taskId)
    }
}
