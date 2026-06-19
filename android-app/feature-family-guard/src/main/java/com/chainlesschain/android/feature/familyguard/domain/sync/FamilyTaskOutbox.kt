package com.chainlesschain.android.feature.familyguard.domain.sync

import com.chainlesschain.android.feature.familyguard.domain.task.FamilyTask

/**
 * family_task 上行 outbox 端口 (FAMILY-67 seam)。
 *
 * 本机对任务的每次**本地**变更 (布置/提交/批改/打回/取消…) 经 [FamilyTaskRepository] 落库后
 * 调 [enqueue]，把任务快照排入同步 outbox，由 sync engine 推到对端 (家长↔孩子)，使两端任务
 * 状态收敛。删除走 [enqueueDelete]。
 *
 * :feature-family-guard **不依赖** :core-p2p (SyncManager 在那边)，故此处只定义端口；真实
 * SyncManager 适配器 (SyncManagerFamilyTaskOutbox) 在 :app 层绑定 (同 [FamilyGroupOutbox] /
 * [com.chainlesschain.android.feature.familyguard.domain.telemetry.TelemetryOutbox] 模式)。
 *
 * **无 echo**：收端 applier 经 [FamilyTaskRepository.upsertFromSync] /
 * [FamilyTaskRepository.deleteFromSync] 落库 (不触发本 outbox)，故同步收到的任务不回弹上行。
 */
interface FamilyTaskOutbox {

    /** 把一条本机变更后的任务快照排入上行同步队列。 */
    suspend fun enqueue(task: FamilyTask)

    /** 把一条本机任务删除排入上行同步队列。 */
    suspend fun enqueueDelete(taskId: String)
}
