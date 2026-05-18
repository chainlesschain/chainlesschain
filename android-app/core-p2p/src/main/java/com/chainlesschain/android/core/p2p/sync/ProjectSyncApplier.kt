package com.chainlesschain.android.core.p2p.sync

/**
 * PROJECT 同步入口 — Android v1.2 (2026-05-12)。
 *
 * 跨模块 DI 翻转，模式与 KnowledgeSyncApplier 一致：DefaultSyncDataApplier 在
 * feature-p2p，ProjectRepository 在 feature-project；feature-p2p 不能直接依赖
 * feature-project。本接口落在 core-p2p（feature-p2p 已依赖），feature-project
 * 提供 @Binds 实现，DefaultSyncDataApplier 注入接口。
 *
 * 字段语义：data JSON 由桌面 `mobile-bridge-sync.js::_fetchProjects` 产生。
 * 字段名走桌面端 snake_case（id / user_id / name / description / project_type /
 * status / root_path / file_count / total_size / tags / metadata / created_at /
 * updated_at），实现侧负责 normalize 到 Android `ProjectEntity` 的 camelCase 字段。
 *
 * Type 归一：桌面允许 (web / document / data / app / presentation / spreadsheet /
 * design / code / workflow / knowledge)，Android 允许 (document / web / app / data /
 * design / research / android / backend / data_science / multiplatform / flutter /
 * other)。共同子集：web / document / data / app / design。其余映射 OTHER。
 *
 * Status 归一：桌面 (draft / active / completed / archived)，Android (active /
 * paused / completed / archived / deleted)。draft → ACTIVE，其余直通。
 *
 * v1 只同步元数据，project_files 子表不走，等 v2。
 */
interface ProjectSyncApplier {

    /**
     * 创建本地不存在的 Project。
     *
     * @param resourceId projects.id（与桌面端共享）
     * @param data JSON 字符串，键见上文
     */
    suspend fun saveFromSync(resourceId: String, data: String)

    /**
     * 更新已存在的 Project。本地独有列（isFavorite / isArchived / gitEnabled / git*
     * / lastAccessedAt / accessCount）不被覆盖；只覆写来自对端的字段。
     */
    suspend fun updateFromSync(resourceId: String, data: String)

    /**
     * 桌面侧 tombstone 下推时触发。走软删（status → DELETED）而非硬删，
     * 与本地 deleteProject(hard=false) 一致，保留撤销窗口。
     */
    suspend fun deleteFromSync(resourceId: String)
}
