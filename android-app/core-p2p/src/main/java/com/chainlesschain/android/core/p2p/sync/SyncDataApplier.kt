package com.chainlesschain.android.core.p2p.sync

/**
 * 同步数据持久化接口
 *
 * 由上层模块（如 feature-p2p）实现，将同步数据写入数据库。
 * SyncManager 在 core-p2p 模块中，无法直接依赖 feature 层的 Repository，
 * 因此使用此接口实现依赖反转。
 */
interface SyncDataApplier {

    /**
     * 创建资源
     *
     * @param resourceType 资源类型
     * @param resourceId 资源ID
     * @param data JSON格式的资源数据
     */
    suspend fun create(resourceType: ResourceType, resourceId: String, data: String)

    /**
     * 更新资源
     *
     * @param resourceType 资源类型
     * @param resourceId 资源ID
     * @param data JSON格式的资源数据
     */
    suspend fun update(resourceType: ResourceType, resourceId: String, data: String)

    /**
     * 删除资源
     *
     * @param resourceType 资源类型
     * @param resourceId 资源ID
     */
    suspend fun delete(resourceType: ResourceType, resourceId: String)
}
