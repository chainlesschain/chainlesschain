package com.chainlesschain.android.core.p2p.sync

/**
 * KNOWLEDGE_ITEM 同步入口 — Android v1.1 W1 (2026-05-12)。
 *
 * 跨模块 DI 翻转：DefaultSyncDataApplier 在 feature-p2p，KnowledgeRepository
 * 在 feature-knowledge；feature-p2p 不能依赖 feature-knowledge（避免 feature
 * 横向耦合）。本接口落在 core-p2p（feature-p2p 已依赖），feature-knowledge 实
 * 现并通过 Hilt @Binds 绑定，DefaultSyncDataApplier 注入接口。
 *
 * 字段语义：data JSON 由 desktop `mobile-bridge-sync.js::_fetchKnowledgeItems`
 * 产生，含 id / title / type / content / createdAt / updatedAt（不含 folderId /
 * tags / isFavorite / isPinned 等 Android 独有 / 桌面独有列）。type 走桌面端
 * `_normalizeKnowledgeType` 兜底，永远是 'note' | 'document' | 'conversation'
 * | 'web_clip' 之一。
 */
interface KnowledgeSyncApplier {

    /**
     * 创建本地不存在的 KnowledgeItem。
     *
     * @param resourceId knowledge_items.id（与桌面端共享）
     * @param data JSON 字符串，键见上文
     */
    suspend fun saveFromSync(resourceId: String, data: String)

    /**
     * 更新已存在的 KnowledgeItem。本地独有列（folderId / tags / isFavorite /
     * isPinned）不被覆盖；只覆写来自对端的字段。
     */
    suspend fun updateFromSync(resourceId: String, data: String)

    /**
     * 桌面侧 tombstone 下推时触发。走软删（Android KnowledgeItemDao.softDelete）
     * 而非硬删，与本地 deleteItem 路径一致，保留 7d 撤销窗口。
     */
    suspend fun deleteFromSync(resourceId: String)
}
