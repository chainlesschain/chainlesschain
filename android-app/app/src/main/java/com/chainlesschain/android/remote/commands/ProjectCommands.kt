package com.chainlesschain.android.remote.commands

import com.chainlesschain.android.remote.client.RemoteCommandClient
import com.google.gson.annotations.SerializedName
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 项目命令 API — Android 项目管理 → 远程终端入口 Sub-phase 10
 *
 * 详见 docs/design/Android_Project_Remote_Terminal_Entry.md §6.10。
 *
 * 选项 C 单向：v0.1 仅 Android → PC 调用（从 PC 选择性拉项目）。
 * PC → Android 反向 v0.2 follow-up。
 */
@Singleton
class ProjectCommands @Inject constructor(
    private val client: RemoteCommandClient,
) {
    /**
     * 拉桌面端项目列表（不含文件内容）。
     *
     * @param userId 必须匹配桌面端登录的 userId；不匹配返空列表 + reason="USER_MISMATCH"
     * @param includeFileCount true 时附带 fileCount/totalSize（慢，但 UI 显大小时需要）
     * @param limit 单次拉取数量，默认 100，上限 500
     * @param offset 分页起点
     */
    suspend fun list(
        userId: String,
        includeFileCount: Boolean = false,
        limit: Int = 100,
        offset: Int = 0,
    ): Result<ProjectListResponse> {
        val params = mapOf(
            "userId" to userId,
            "includeFileCount" to includeFileCount,
            "limit" to limit,
            "offset" to offset,
        )
        return client.invoke("project.list", params)
    }

    /**
     * 拉单个项目元数据 + 文件清单（不含文件内容）。
     *
     * 文件内容走既有 [FileCommands] file.download chunked 通道（Sub-phase 7 复用）。
     *
     * @param projectId PC 端项目 ID（从 list 拿到）
     * @param userId 安全校验：传则要求 PC 端项目 owner 匹配
     * @param includeFileList true 时返完整文件清单；false 仅元数据（快）
     */
    suspend fun pullSingle(
        projectId: String,
        userId: String? = null,
        includeFileList: Boolean = true,
    ): Result<ProjectPullSingleResponse> {
        val params = mutableMapOf<String, Any>(
            "projectId" to projectId,
            "includeFileList" to includeFileList,
        )
        if (userId != null) {
            params["userId"] = userId
        }
        return client.invoke("project.pullSingle", params)
    }
}

/**
 * project.list 响应模型。
 *
 * - reason 非 null 时表示拉取被拒：USER_MISMATCH / PERMISSION_DENIED / RATE_LIMITED
 * - 正常情况 projects 列表 + 分页字段
 */
data class ProjectListResponse(
    val projects: List<RemoteProjectItem> = emptyList(),
    val total: Int = 0,
    val hasMore: Boolean = false,
    val reason: String? = null,
)

/**
 * project.pullSingle 响应模型。
 *
 * - error 非 null 时拉取失败：MISSING_PROJECT_ID / PROJECT_NOT_FOUND / PERMISSION_DENIED / RATE_LIMITED
 * - filesPreviewOnly=true 表示项目 > 1000 文件，仅返前 50 项；UI 需提示用户分批拉取
 */
data class ProjectPullSingleResponse(
    val project: RemoteProjectItem? = null,
    val files: List<RemoteProjectFile> = emptyList(),
    val filesCount: Int = 0,
    val filesPreviewOnly: Boolean = false,
    val error: String? = null,
)

/**
 * 远程项目项 — list / pullSingle 共用。
 *
 * 字段映射桌面端 mobile-bridge-sync.js handleProjectList/handleProjectPullSingle 返回值。
 * sourcePeerId / pcRootPath 是 Sub-phase 1 新增字段；fileCount / totalSize 在
 * includeFileCount=false 时为 null。
 */
data class RemoteProjectItem(
    val id: String,
    val name: String,
    val description: String? = null,
    val type: String,
    val status: String,
    val rootPath: String? = null,
    val sourcePeerId: String? = null,
    val pcRootPath: String? = null,
    val fileCount: Int? = null,
    val totalSize: Long? = null,
    val tags: String? = null,
    val metadata: String? = null,
    @SerializedName("createdAt") val createdAt: Long = 0,
    @SerializedName("updatedAt") val updatedAt: Long = 0,
    val userId: String? = null,  // 仅 pullSingle 返
)

/**
 * 远程项目文件项（pullSingle 文件清单）。
 *
 * - path 相对 pcRootPath
 * - hash SHA-256 hex；用于 client 端 dedup（已下载文件不重传）
 * - 不含文件内容；内容用 file.download chunked 拉
 */
data class RemoteProjectFile(
    val id: String,
    val path: String,
    val size: Long,
    val hash: String? = null,
    val mimeType: String? = null,
    val updatedAt: Long = 0,
)
