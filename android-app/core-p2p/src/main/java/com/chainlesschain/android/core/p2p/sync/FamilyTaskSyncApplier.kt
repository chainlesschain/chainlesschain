package com.chainlesschain.android.core.p2p.sync

/**
 * 家庭 task/作业 接收落库端口 (FAMILY-67 任务同步下行侧)。
 *
 * 对称于上行 `SyncManagerFamilyTaskOutbox`（:app，把本机 FamilyTask 编码成
 * [ResourceType.FAMILY_TASK] 的 SyncItem 入队）：对端 [SyncManager] 收到该 item 后，
 * [SyncDataApplier] 按 ResourceType 路由到本端口，由 :app 的实装解码
 * (`FamilyTaskSyncRecord`)、跑 `FamilyTaskMerge` 解冲突、落 family_task 表。
 *
 * 同 [TelemetrySyncApplier] / [FamilyGuardSyncApplier] 模式：接口在 core-p2p、实装在 :app
 * (:app 同时依赖 core-p2p + feature-family-guard)，feature-p2p 的路由器经本端口调用，
 * 避免横向模块依赖。
 *
 * task 是**可变**资源 (parent→child 布置；child→parent 提交/AI 批改/家长打回)，故 CREATE
 * 与 UPDATE 都映射到「解码→合并→upsert」(幂等)；DELETE 仅删本机已存在且属活跃家庭的任务。
 */
interface FamilyTaskSyncApplier {

    /** 收到一条 task (CREATE)。鉴权 + 合并 + upsert。 */
    suspend fun saveTaskFromSync(resourceId: String, data: String)

    /** 收到一条 task 更新 (UPDATE)。与 [saveTaskFromSync] 同语义 (合并幂等)。 */
    suspend fun updateTaskFromSync(resourceId: String, data: String)

    /** 收到一条 task 删除 (DELETE)。resourceId 形如 `family_task|<id>`。 */
    suspend fun deleteTaskFromSync(resourceId: String)
}
