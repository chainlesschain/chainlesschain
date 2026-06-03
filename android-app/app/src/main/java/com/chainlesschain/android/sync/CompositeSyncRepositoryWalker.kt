package com.chainlesschain.android.sync

import com.chainlesschain.android.core.p2p.sync.PullCursor
import com.chainlesschain.android.core.p2p.sync.ResourceType
import com.chainlesschain.android.core.p2p.sync.SyncItem
import com.chainlesschain.android.core.p2p.sync.SyncRepositoryWalker
import com.chainlesschain.android.feature.p2p.sync.SocialSyncWalker
import com.chainlesschain.android.feature.project.sync.ProjectSyncWalker
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 跨 feature 聚合的 SyncRepositoryWalker — Phase 3d v1.2 (#21 P2)。
 *
 * 把 feature-p2p [SocialSyncWalker] 和 feature-project [ProjectSyncWalker]
 * 合并暴露为单一 walker，让 SyncManager 不感知具体 feature。
 *
 * feature-p2p 与 feature-project 互不依赖；唯有 :app 模块同时持有两者，
 * 所以聚合点放在 :app/sync。
 *
 * 合并策略：
 *   - 每个子 walker 各拉 limit 项（独立游标无干扰）
 *   - 全部 result 按 (timestamp, resourceId) lex 序合并
 *   - 截到 limit；调用方算 nextCursor（与 SocialSyncWalker 单独行为一致）
 *
 * 这种"每子 walker 拉满后再截"的策略会有 starve 风险（某类项目 timestamp
 * 极小时挤掉其它类型）。Phase 3d v1.1 SocialSyncWalker 已是同样模式 — 这
 * 里保持一致，避免引入新分配算法。v2 可改 round-robin。
 */
@Singleton
class CompositeSyncRepositoryWalker @Inject constructor(
    private val socialWalker: SocialSyncWalker,
    private val projectWalker: ProjectSyncWalker,
) : SyncRepositoryWalker {

    override suspend fun enumerate(
        cursor: PullCursor,
        resourceTypes: List<ResourceType>?,
        limit: Int,
    ): List<SyncItem> {
        val safeLimit = limit.coerceIn(1, 500)
        val social = socialWalker.enumerate(cursor, resourceTypes, safeLimit)
        val project = projectWalker.enumerate(cursor, resourceTypes, safeLimit)
        return (social + project)
            .sortedWith(compareBy({ it.timestamp }, { it.resourceId }))
            .take(safeLimit)
    }
}
