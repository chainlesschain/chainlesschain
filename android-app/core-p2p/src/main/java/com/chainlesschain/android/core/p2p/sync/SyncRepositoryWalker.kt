package com.chainlesschain.android.core.p2p.sync

/**
 * Repository walker — 服务 SyncManager.handlePullRpc 的真实数据枚举接口
 * （Phase 3d v1.1）。
 *
 * v1 SyncManager.handlePullRpc 只能拉 in-memory pendingChanges，离线/历史
 * 数据全部不可恢复。v1.1 通过这层接口让 desktop 端 sync.pull 真正能拿到
 * Android 上的 Friend / Post / Notification / MESSAGE 历史。
 *
 * 实现 SocialSyncWalker 在 feature-p2p（注入 4 个 DAO），通过 dagger.Lazy
 * 注入 SyncManager 避免 core-p2p 直接依赖 feature-p2p。
 *
 * 设计取舍（与 desktop sync-external-store / mobile-bridge-sync.js 的 walker
 * 对齐）：
 *   - 每张表用 (timestamp, id) lex 序 cursor
 *   - 4 张表的 walker 在 enumerate() 内串行拉，依次填到 limit
 *   - resourceTypes filter 让 desktop 可以只拉感兴趣的子集
 *   - 不去重 pendingChanges — desktop LWW 算法天然幂等，重复推一次无伤
 */
interface SyncRepositoryWalker {
    /**
     * Enumerate items 大于 cursor，按时间 lex 序，受 limit 限制。
     *
     * @param cursor 从此 cursor 之后开始
     * @param resourceTypes null = 全部类型；否则只返指定类型
     * @param limit 返回上限
     * @return List<SyncItem> + nextCursor 信息（需要调用方算）
     */
    suspend fun enumerate(
        cursor: PullCursor,
        resourceTypes: List<ResourceType>?,
        limit: Int
    ): List<SyncItem>
}
