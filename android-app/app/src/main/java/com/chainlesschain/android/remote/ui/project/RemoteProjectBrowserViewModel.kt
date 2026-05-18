package com.chainlesschain.android.remote.ui.project

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.core.database.dao.ProjectDao
import com.chainlesschain.android.core.database.entity.ProjectEntity
import com.chainlesschain.android.core.database.entity.ProjectFileEntity
import com.chainlesschain.android.core.database.entity.ProjectStatus
import com.chainlesschain.android.core.database.entity.ProjectType
import com.chainlesschain.android.remote.commands.ProjectCommands
import com.chainlesschain.android.remote.commands.RemoteProjectItem
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import timber.log.Timber
import javax.inject.Inject

/**
 * RemoteProjectBrowserScreen 的 ViewModel — Sub-phase 10 (选项 C 单向 PC→Android)。
 *
 * 详见 docs/design/Android_Project_Remote_Terminal_Entry.md §6.10。
 *
 * 责任：
 *   - 调 ProjectCommands.list 拉桌面项目元数据
 *   - client-side dedup：与本地 ProjectDao 求交集，标 "已在本地" vs "未拉取"
 *   - tap "拉取" → pullSingle → 写本地 ProjectEntity（source=FROM_PC）+ 循环
 *     project.getFile 拉所有文件内容写 ProjectFileEntity（v2 2026-05-18）
 *   - 进度状态 + 错误处理（rate-limited / userId 不匹配 / 离线）
 *
 * v2 (2026-05-18): "全量项目内容拉取" — pullSingle 之后循环 getFile 把每个文件
 * 真内容存进 Room project_files 表，让 ProjectDetailScreenV2 离线也能看到文件。
 * v0.1 简化：单文件 size 上限走桌面默认 5000 row + 1000 preview-only；超大文件
 * (>1MB content) skip + 标 isEncrypted=false 占位 row 让用户后续从 PC 端编辑器
 * 直接操作。单文件失败不阻塞整体（log warn + continue next）。
 */
@HiltViewModel
class RemoteProjectBrowserViewModel @Inject constructor(
    private val projectCommands: ProjectCommands,
    private val projectDao: ProjectDao,
) : ViewModel() {

    private val _state = MutableStateFlow<BrowserState>(BrowserState.Idle)
    val state: StateFlow<BrowserState> = _state.asStateFlow()

    private val _pullingId = MutableStateFlow<String?>(null)
    val pullingId: StateFlow<String?> = _pullingId.asStateFlow()

    /** v2: 文件内容下载进度 (当前 idx / 总数 / 当前文件名)。pulling 时非 null。 */
    private val _pullProgress = MutableStateFlow<PullProgress?>(null)
    val pullProgress: StateFlow<PullProgress?> = _pullProgress.asStateFlow()

    /**
     * 加载桌面项目列表 + 本地 dedup。
     */
    fun loadProjects(userId: String, includeFileCount: Boolean = false) {
        _state.value = BrowserState.Loading
        viewModelScope.launch {
            try {
                val response = projectCommands.list(userId, includeFileCount).getOrNull()
                if (response == null) {
                    _state.value = BrowserState.Error("无法连接桌面端")
                    return@launch
                }
                if (response.reason != null) {
                    _state.value = when (response.reason) {
                        "PERMISSION_DENIED", "USER_MISMATCH" ->
                            BrowserState.Error("桌面端登录账号与手机不一致；请切换账号后重试")
                        "RATE_LIMITED" ->
                            BrowserState.Error("操作过于频繁，请稍后重试")
                        else -> BrowserState.Error("拉取失败: ${response.reason}")
                    }
                    return@launch
                }
                // client-side dedup — trap 7.16 用 active projects 排除 deleted/archived/orphan
                val localActiveIds = projectDao.getProjectsByUser(userId).first()
                    .filter {
                        it.status != ProjectStatus.DELETED &&
                            it.status != ProjectStatus.ARCHIVED &&
                            !isOrphanTagged(it)
                    }
                    .map { it.id }
                    .toSet()
                val items = response.projects.map { remote ->
                    BrowserItem(
                        remote = remote,
                        alreadyLocal = remote.id in localActiveIds,
                    )
                }
                _state.value = BrowserState.Loaded(items = items, total = response.total, hasMore = response.hasMore)
            } catch (e: Exception) {
                Timber.e(e, "[RemoteProjectBrowserVM] loadProjects failed")
                _state.value = BrowserState.Error(e.message ?: "未知错误")
            }
        }
    }

    /**
     * 触发拉取单项目元数据 + 文件清单。文件内容由 caller 跳 FileTransferScreen 拉。
     *
     * @return 拉取的 projectId（用于 navigation 跳 detail），失败 null
     */
    fun pullProject(projectId: String, userId: String, onPulled: (String) -> Unit) {
        if (_pullingId.value != null) {
            Timber.w("[RemoteProjectBrowserVM] pull already in progress, ignoring")
            return
        }
        _pullingId.value = projectId
        viewModelScope.launch {
            try {
                val response = projectCommands.pullSingle(
                    projectId = projectId,
                    userId = userId,
                    includeFileList = true,
                ).getOrNull()
                if (response == null || response.error != null) {
                    val reason = response?.error ?: "unknown"
                    Timber.w("[RemoteProjectBrowserVM] pull $projectId failed: $reason")
                    _state.value = BrowserState.Error("拉取失败: $reason")
                    return@launch
                }
                val remote = response.project ?: return@launch
                // 写本地 ProjectEntity；走 v1.3 字段策略 source=FROM_PC
                val entity = remoteToEntity(remote, userId)
                projectDao.insertProject(entity)
                Timber.i(
                    "[RemoteProjectBrowserVM] pulled project ${remote.id} (${response.filesCount} files)" +
                        if (response.filesPreviewOnly) " [preview-only, files require pagination]" else "",
                )

                // v2 (2026-05-18): 循环 getFile 真拉文件内容存 Room
                val files = response.files
                if (files.isNotEmpty()) {
                    _pullProgress.value = PullProgress(0, files.size, files.first().path)
                    var ok = 0
                    var skipped = 0
                    files.forEachIndexed { idx, file ->
                        _pullProgress.value = PullProgress(idx, files.size, file.path)
                        try {
                            val result = projectCommands.getFile(file.id)
                            val fileRes = result.getOrNull()
                            if (fileRes == null) {
                                Timber.w(
                                    result.exceptionOrNull(),
                                    "[RemoteProjectBrowserVM] getFile ${file.path} failed",
                                )
                                skipped++
                                return@forEachIndexed
                            }
                            // size 软上限 1 MB content（防 OOM 单文件拉巨型 binary）
                            val rawContent = fileRes.content
                            val safeContent = if (rawContent != null && rawContent.length > 1_048_576) {
                                Timber.w("[RemoteProjectBrowserVM] skip content ${file.path}: ${rawContent.length} chars > 1MB")
                                null
                            } else rawContent
                            projectDao.insertFile(remoteFileToEntity(file, remote.id, fileRes, safeContent))
                            ok++
                        } catch (e: Exception) {
                            Timber.w(e, "[RemoteProjectBrowserVM] getFile ${file.path} exception, continuing")
                            skipped++
                        }
                    }
                    Timber.i("[RemoteProjectBrowserVM] downloaded $ok/${files.size} files content (skipped $skipped)")
                    // 更新 metadata pullState 为 "files_downloaded"
                    projectDao.insertProject(
                        entity.copy(
                            metadata = buildMetadataWithPullState(remote.metadata, pullState = "files_downloaded"),
                        ),
                    )
                }
                _pullProgress.value = null

                onPulled(remote.id)
                // 刷新列表 dedup（"已拉取" badge 显示）
                loadProjects(userId)
            } catch (e: Exception) {
                Timber.e(e, "[RemoteProjectBrowserVM] pullProject failed")
                _state.value = BrowserState.Error(e.message ?: "未知错误")
            } finally {
                _pullingId.value = null
                _pullProgress.value = null
            }
        }
    }

    /**
     * v2 (2026-05-18): 把 pullSingle 返的 RemoteProjectFile + getFile 返的 content 合并
     * 成本地 ProjectFileEntity。
     *
     * - parentId=null（v0.1 不重建 folder 树；ProjectDetailScreenV2 用 path 渲染 flat 列表）
     * - extension 从 path 后缀推断
     * - hash 从 pullSingle 的 file.hash（content_hash 哈希值）
     */
    private fun remoteFileToEntity(
        file: com.chainlesschain.android.remote.commands.RemoteProjectFile,
        projectId: String,
        full: com.chainlesschain.android.remote.commands.RemoteFileFull,
        content: String?,
    ): ProjectFileEntity {
        val name = file.path.substringAfterLast('/').substringAfterLast('\\')
        val ext = name.substringAfterLast('.', "").takeIf { it.isNotBlank() }
        val now = System.currentTimeMillis()
        return ProjectFileEntity(
            id = file.id,
            projectId = projectId,
            parentId = null,
            name = name.ifBlank { file.path },
            path = file.path,
            type = "file",
            mimeType = null,
            size = file.size,
            extension = ext,
            content = content,
            isEncrypted = false,
            hash = file.hash,
            isOpen = false,
            isDirty = false,
            createdAt = full.createdAt.takeIf { it > 0 } ?: now,
            updatedAt = full.updatedAt.takeIf { it > 0 } ?: file.updatedAt.takeIf { it > 0 } ?: now,
            lastAccessedAt = null,
        )
    }

    /**
     * 把 RemoteProjectItem 转 ProjectEntity（FROM_PC source）。
     *
     * Sub-phase 1 字段：pcRootPath / sourcePeerId 必填；metadata 加 pullState 状态。
     */
    private fun remoteToEntity(remote: RemoteProjectItem, userId: String): ProjectEntity {
        return ProjectEntity(
            id = remote.id,
            name = remote.name,
            description = remote.description,
            type = normalizeType(remote.type),
            status = normalizeStatus(remote.status),
            userId = userId,
            rootPath = null, // Android 端 SAF URI；FROM_PC 拉的项目不走 SAF
            pcRootPath = remote.pcRootPath ?: remote.rootPath,
            sourcePeerId = remote.sourcePeerId,
            tags = remote.tags,
            metadata = buildMetadataWithPullState(remote.metadata, pullState = "metadata_only"),
            isSynced = true,
            lastSyncedAt = System.currentTimeMillis(),
            fileCount = remote.fileCount ?: 0,
            totalSize = remote.totalSize ?: 0L,
            createdAt = remote.createdAt.takeIf { it > 0 } ?: System.currentTimeMillis(),
            updatedAt = remote.updatedAt.takeIf { it > 0 } ?: System.currentTimeMillis(),
        )
    }

    private fun normalizeType(raw: String): String = when (raw.lowercase()) {
        in ProjectType.ALL_TYPES -> raw.lowercase()
        else -> ProjectType.OTHER
    }

    private fun normalizeStatus(raw: String): String = when (raw.lowercase()) {
        in ProjectStatus.ALL_STATUS -> raw.lowercase()
        "draft" -> ProjectStatus.ACTIVE
        else -> ProjectStatus.ACTIVE
    }

    /**
     * 检测 ProjectEntity.metadata 是否含 orphan tag (Sub-phase 2 §7.13)。
     */
    private fun isOrphanTagged(entity: ProjectEntity): Boolean {
        val md = entity.metadata ?: return false
        return md.contains("\"orphan\":true") || md.contains("\"orphan\": true")
    }

    /**
     * 构造 metadata JSON 含 pullState (trap 7.20)。简化版字符串拼接；正式应走 JSON
     * lib，但 v0.1 不引新 dep。
     */
    private fun buildMetadataWithPullState(existing: String?, pullState: String): String {
        // 极简策略：原 metadata 若有效 JSON 则保留，附 pullState；否则新建
        val now = System.currentTimeMillis()
        val pullFields = "\"pullState\":\"$pullState\",\"pulledAt\":$now"
        if (existing.isNullOrBlank() || !existing.trim().startsWith("{")) {
            return "{$pullFields}"
        }
        // existing 是 JSON object 形式：在结尾 } 前插入 pullFields
        val trimmed = existing.trim()
        return if (trimmed == "{}") {
            "{$pullFields}"
        } else {
            trimmed.substring(0, trimmed.length - 1) + ",$pullFields}"
        }
    }
}

/**
 * Browser 屏列表状态。
 */
sealed class BrowserState {
    object Idle : BrowserState()
    object Loading : BrowserState()
    data class Loaded(
        val items: List<BrowserItem>,
        val total: Int,
        val hasMore: Boolean,
    ) : BrowserState()
    data class Error(val message: String) : BrowserState()
}

/**
 * Browser 屏单 row 数据。
 */
data class BrowserItem(
    val remote: RemoteProjectItem,
    val alreadyLocal: Boolean,
)

/**
 * v2 (2026-05-18): 文件内容拉取进度。
 * - currentIdx 0-based；UI 显示用 currentIdx+1
 * - currentFile 当前正在下载的文件路径（用于 UI 显示）
 */
data class PullProgress(
    val currentIdx: Int,
    val total: Int,
    val currentFile: String,
)
