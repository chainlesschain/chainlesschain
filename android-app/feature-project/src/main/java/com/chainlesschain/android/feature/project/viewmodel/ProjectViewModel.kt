package com.chainlesschain.android.feature.project.viewmodel

import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.core.database.entity.ProjectActivityEntity
import com.chainlesschain.android.core.database.entity.ProjectEntity
import com.chainlesschain.android.core.database.entity.ProjectFileEntity
import com.chainlesschain.android.core.database.entity.ProjectStatus
import com.chainlesschain.android.core.database.entity.ProjectType
import com.chainlesschain.android.feature.project.model.CreateProjectRequest
import com.chainlesschain.android.feature.project.model.FileTreeNode
import com.chainlesschain.android.feature.project.model.ProjectDetailState
import com.chainlesschain.android.feature.project.model.ProjectFilter
import com.chainlesschain.android.feature.project.model.ProjectListState
import com.chainlesschain.android.feature.project.model.ProjectSortBy
import com.chainlesschain.android.feature.project.model.ProjectWithStats
import com.chainlesschain.android.feature.project.model.SortDirection
import com.chainlesschain.android.feature.project.model.UpdateProjectRequest
import com.chainlesschain.android.feature.project.repository.ProjectRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * UI 事件
 */
sealed class ProjectUiEvent {
    data class ShowMessage(val message: String) : ProjectUiEvent()
    data class NavigateToProject(val projectId: String) : ProjectUiEvent()
    data class NavigateToFile(val projectId: String, val fileId: String) : ProjectUiEvent()
    object NavigateBack : ProjectUiEvent()
    data class ShowError(val error: String) : ProjectUiEvent()
}

/**
 * 项目 ViewModel
 *
 * 管理项目列表、详情、文件操作的 UI 状态
 */
@HiltViewModel
class ProjectViewModel @Inject constructor(
    private val projectRepository: ProjectRepository
) : ViewModel() {

    companion object {
        private const val TAG = "ProjectViewModel"
    }

    // ===== 当前用户 =====
    private val _currentUserId = MutableStateFlow<String?>(null)
    val currentUserId: StateFlow<String?> = _currentUserId.asStateFlow()

    // ===== 项目列表状态 =====
    private val _projectListState = MutableStateFlow<ProjectListState>(ProjectListState.Loading)
    val projectListState: StateFlow<ProjectListState> = _projectListState.asStateFlow()

    // ===== 筛选和排序 =====
    private val _filter = MutableStateFlow(ProjectFilter())
    val filter: StateFlow<ProjectFilter> = _filter.asStateFlow()

    private val _sortBy = MutableStateFlow(ProjectSortBy.UPDATED_AT)
    val sortBy: StateFlow<ProjectSortBy> = _sortBy.asStateFlow()

    private val _sortDirection = MutableStateFlow(SortDirection.DESC)
    val sortDirection: StateFlow<SortDirection> = _sortDirection.asStateFlow()

    // ===== 当前项目详情 =====
    private val _currentProjectId = MutableStateFlow<String?>(null)
    val currentProjectId: StateFlow<String?> = _currentProjectId.asStateFlow()

    private val _projectDetailState = MutableStateFlow<ProjectDetailState>(ProjectDetailState.Loading)
    val projectDetailState: StateFlow<ProjectDetailState> = _projectDetailState.asStateFlow()

    // ===== 项目文件 =====
    private val _projectFiles = MutableStateFlow<List<ProjectFileEntity>>(emptyList())
    val projectFiles: StateFlow<List<ProjectFileEntity>> = _projectFiles.asStateFlow()

    private val _fileTree = MutableStateFlow<List<FileTreeNode>>(emptyList())
    val fileTree: StateFlow<List<FileTreeNode>> = _fileTree.asStateFlow()

    private val _currentParentId = MutableStateFlow<String?>(null)
    val currentParentId: StateFlow<String?> = _currentParentId.asStateFlow()

    private val _openFiles = MutableStateFlow<List<ProjectFileEntity>>(emptyList())
    val openFiles: StateFlow<List<ProjectFileEntity>> = _openFiles.asStateFlow()

    // ===== 项目活动 =====
    private val _projectActivities = MutableStateFlow<List<ProjectActivityEntity>>(emptyList())
    val projectActivities: StateFlow<List<ProjectActivityEntity>> = _projectActivities.asStateFlow()

    // ===== UI 事件 =====
    private val _uiEvents = MutableSharedFlow<ProjectUiEvent>()
    val uiEvents: SharedFlow<ProjectUiEvent> = _uiEvents.asSharedFlow()

    // ===== 加载状态 =====
    private val _isLoading = MutableStateFlow(false)
    val isLoading: StateFlow<Boolean> = _isLoading.asStateFlow()

    // ===== 统计信息 =====
    private val _projectCount = MutableStateFlow(0)
    val projectCount: StateFlow<Int> = _projectCount.asStateFlow()

    private val _projectCountByType = MutableStateFlow<Map<String, Int>>(emptyMap())
    val projectCountByType: StateFlow<Map<String, Int>> = _projectCountByType.asStateFlow()

    /**
     * 设置当前用户
     */
    fun setCurrentUser(userId: String) {
        _currentUserId.value = userId
        loadProjects()
        loadStatistics()
    }

    /**
     * 加载项目列表
     */
    fun loadProjects() {
        val userId = _currentUserId.value ?: return

        viewModelScope.launch {
            _projectListState.value = ProjectListState.Loading

            try {
                val filter = _filter.value

                // 根据筛选条件选择数据流
                val projectsFlow = when {
                    !filter.searchQuery.isNullOrBlank() ->
                        projectRepository.searchProjects(userId, filter.searchQuery)
                    filter.isFavorite == true ->
                        projectRepository.getFavoriteProjects(userId)
                    filter.isArchived == true ->
                        projectRepository.getArchivedProjects(userId)
                    filter.status != null ->
                        projectRepository.getProjectsByStatus(userId, filter.status)
                    filter.type != null ->
                        projectRepository.getProjectsByType(userId, filter.type)
                    else ->
                        projectRepository.getProjectsByUser(userId)
                }

                projectsFlow
                    .map { projects ->
                        // 转换为带统计信息的项目
                        projects.map { ProjectWithStats(it) }
                    }
                    .map { projects ->
                        // 排序
                        sortProjects(projects)
                    }
                    .catch { e ->
                        Log.e(TAG, "Error loading projects", e)
                        _projectListState.value = ProjectListState.Error(e.message ?: "加载失败")
                    }
                    .collect { projects ->
                        _projectListState.value = if (projects.isEmpty()) {
                            ProjectListState.Empty
                        } else {
                            ProjectListState.Success(
                                projects = projects,
                                filter = _filter.value,
                                sortBy = _sortBy.value,
                                sortDirection = _sortDirection.value
                            )
                        }
                    }
            } catch (e: Exception) {
                Log.e(TAG, "Error loading projects", e)
                _projectListState.value = ProjectListState.Error(e.message ?: "加载失败")
            }
        }
    }

    /**
     * 排序项目
     */
    private fun sortProjects(projects: List<ProjectWithStats>): List<ProjectWithStats> {
        val sortBy = _sortBy.value
        val isDesc = _sortDirection.value == SortDirection.DESC

        val sorted = when (sortBy) {
            ProjectSortBy.UPDATED_AT -> projects.sortedBy { it.project.updatedAt }
            ProjectSortBy.CREATED_AT -> projects.sortedBy { it.project.createdAt }
            ProjectSortBy.NAME -> projects.sortedBy { it.project.name.lowercase() }
            ProjectSortBy.ACCESS_COUNT -> projects.sortedBy { it.project.accessCount }
            ProjectSortBy.FILE_COUNT -> projects.sortedBy { it.project.fileCount }
            ProjectSortBy.TOTAL_SIZE -> projects.sortedBy { it.project.totalSize }
        }

        return if (isDesc) sorted.reversed() else sorted
    }

    /**
     * 设置筛选条件
     */
    fun setFilter(filter: ProjectFilter) {
        _filter.value = filter
        loadProjects()
    }

    /**
     * 设置排序
     */
    fun setSorting(sortBy: ProjectSortBy, direction: SortDirection = SortDirection.DESC) {
        _sortBy.value = sortBy
        _sortDirection.value = direction
        loadProjects()
    }

    /**
     * 搜索项目
     */
    fun search(query: String) {
        _filter.value = _filter.value.copy(searchQuery = query.takeIf { it.isNotBlank() })
        loadProjects()
    }

    /**
     * 清除筛选
     */
    fun clearFilter() {
        _filter.value = ProjectFilter()
        loadProjects()
    }

    /**
     * 加载统计信息
     */
    private fun loadStatistics() {
        val userId = _currentUserId.value ?: return

        viewModelScope.launch {
            try {
                _projectCount.value = projectRepository.getProjectCount(userId)
                _projectCountByType.value = projectRepository.getProjectCountByType(userId)
            } catch (e: Exception) {
                Log.e(TAG, "Error loading statistics", e)
            }
        }
    }

    // ===== 项目操作 =====

    /**
     * 创建项目
     */
    fun createProject(
        name: String,
        description: String? = null,
        type: String = ProjectType.OTHER,
        tags: List<String>? = null
    ) {
        val userId = _currentUserId.value ?: return

        viewModelScope.launch {
            _isLoading.value = true

            val result = projectRepository.createProject(
                CreateProjectRequest(
                    name = name,
                    description = description,
                    type = type,
                    userId = userId,
                    tags = tags
                )
            )

            result.fold(
                onSuccess = { project ->
                    _uiEvents.emit(ProjectUiEvent.ShowMessage("项目创建成功"))
                    _uiEvents.emit(ProjectUiEvent.NavigateToProject(project.id))
                    loadStatistics()
                },
                onFailure = { error ->
                    _uiEvents.emit(ProjectUiEvent.ShowError(error.message ?: "创建失败"))
                }
            )

            _isLoading.value = false
        }
    }

    /**
     * 更新项目
     */
    fun updateProject(projectId: String, request: UpdateProjectRequest) {
        viewModelScope.launch {
            _isLoading.value = true

            val result = projectRepository.updateProject(projectId, request)

            result.fold(
                onSuccess = {
                    _uiEvents.emit(ProjectUiEvent.ShowMessage("项目已更新"))
                },
                onFailure = { error ->
                    _uiEvents.emit(ProjectUiEvent.ShowError(error.message ?: "更新失败"))
                }
            )

            _isLoading.value = false
        }
    }

    /**
     * 删除项目
     */
    fun deleteProject(projectId: String, hard: Boolean = false) {
        viewModelScope.launch {
            _isLoading.value = true

            val result = projectRepository.deleteProject(projectId, hard)

            result.fold(
                onSuccess = {
                    _uiEvents.emit(ProjectUiEvent.ShowMessage("项目已删除"))
                    _uiEvents.emit(ProjectUiEvent.NavigateBack)
                    loadStatistics()
                },
                onFailure = { error ->
                    _uiEvents.emit(ProjectUiEvent.ShowError(error.message ?: "删除失败"))
                }
            )

            _isLoading.value = false
        }
    }

    /**
     * 更新项目状态
     */
    fun updateProjectStatus(projectId: String, status: String) {
        viewModelScope.launch {
            val result = projectRepository.updateProjectStatus(projectId, status)

            result.fold(
                onSuccess = {
                    val statusName = when (status) {
                        ProjectStatus.ACTIVE -> "进行中"
                        ProjectStatus.PAUSED -> "已暂停"
                        ProjectStatus.COMPLETED -> "已完成"
                        else -> status
                    }
                    _uiEvents.emit(ProjectUiEvent.ShowMessage("状态已更新为: $statusName"))
                },
                onFailure = { error ->
                    _uiEvents.emit(ProjectUiEvent.ShowError(error.message ?: "更新失败"))
                }
            )
        }
    }

    /**
     * 切换收藏
     */
    fun toggleFavorite(projectId: String) {
        viewModelScope.launch {
            val result = projectRepository.toggleFavorite(projectId)

            result.fold(
                onSuccess = { isFavorite ->
                    val message = if (isFavorite) "已添加到收藏" else "已取消收藏"
                    _uiEvents.emit(ProjectUiEvent.ShowMessage(message))
                },
                onFailure = { error ->
                    _uiEvents.emit(ProjectUiEvent.ShowError(error.message ?: "操作失败"))
                }
            )
        }
    }

    /**
     * 切换归档
     */
    fun toggleArchive(projectId: String) {
        viewModelScope.launch {
            val result = projectRepository.toggleArchive(projectId)

            result.fold(
                onSuccess = { isArchived ->
                    val message = if (isArchived) "项目已归档" else "项目已取消归档"
                    _uiEvents.emit(ProjectUiEvent.ShowMessage(message))
                },
                onFailure = { error ->
                    _uiEvents.emit(ProjectUiEvent.ShowError(error.message ?: "操作失败"))
                }
            )
        }
    }

    // ===== 项目详情 =====

    /**
     * 加载项目详情
     */
    fun loadProjectDetail(projectId: String) {
        _currentProjectId.value = projectId
        _projectDetailState.value = ProjectDetailState.Loading

        viewModelScope.launch {
            try {
                // 记录访问
                projectRepository.recordAccess(projectId)

                // 观察项目
                projectRepository.observeProject(projectId)
                    .catch { e ->
                        Log.e(TAG, "Error loading project detail", e)
                        _projectDetailState.value = ProjectDetailState.Error(e.message ?: "加载失败")
                    }
                    .collect { project ->
                        if (project != null) {
                            _projectDetailState.value = ProjectDetailState.Success(project)
                        } else {
                            _projectDetailState.value = ProjectDetailState.Error("项目不存在")
                        }
                    }
            } catch (e: Exception) {
                Log.e(TAG, "Error loading project detail", e)
                _projectDetailState.value = ProjectDetailState.Error(e.message ?: "加载失败")
            }
        }

        // 加载文件
        loadProjectFiles(projectId)

        // 加载活动
        loadProjectActivities(projectId)
    }

    /**
     * 加载项目文件
     */
    private fun loadProjectFiles(projectId: String) {
        viewModelScope.launch {
            projectRepository.getProjectFiles(projectId)
                .catch { e ->
                    Log.e(TAG, "Error loading project files", e)
                }
                .collect { files ->
                    _projectFiles.value = files
                    _fileTree.value = buildFileTree(files)
                }
        }

        viewModelScope.launch {
            projectRepository.getOpenFiles(projectId)
                .catch { e ->
                    Log.e(TAG, "Error loading open files", e)
                }
                .collect { files ->
                    _openFiles.value = files
                }
        }
    }

    /**
     * 构建文件树
     */
    private fun buildFileTree(files: List<ProjectFileEntity>): List<FileTreeNode> {
        val nodeMap = files.associate { file ->
            file.id to FileTreeNode(
                id = file.id,
                name = file.name,
                path = file.path,
                type = file.type,
                extension = file.extension,
                size = file.size,
                isDirty = file.isDirty,
                isOpen = file.isOpen
            )
        }

        val rootNodes = mutableListOf<FileTreeNode>()

        files.forEach { file ->
            val node = nodeMap[file.id] ?: return@forEach

            if (file.parentId == null) {
                rootNodes.add(node)
            } else {
                nodeMap[file.parentId]?.children?.add(node)
            }
        }

        // 排序：文件夹在前，文件在后，按名称排序
        fun sortNodes(nodes: MutableList<FileTreeNode>) {
            nodes.sortWith(compareBy({ !it.isFolder() }, { it.name.lowercase() }))
            nodes.forEach { if (it.children.isNotEmpty()) sortNodes(it.children) }
        }

        sortNodes(rootNodes)
        return rootNodes
    }

    /**
     * 加载项目活动
     */
    private fun loadProjectActivities(projectId: String) {
        viewModelScope.launch {
            projectRepository.getProjectActivities(projectId)
                .catch { e ->
                    Log.e(TAG, "Error loading project activities", e)
                }
                .collect { activities ->
                    _projectActivities.value = activities
                }
        }
    }

    // ===== 文件操作 =====

    /**
     * 添加文件
     */
    fun addFile(
        name: String,
        type: String = "file",
        parentId: String? = null,
        content: String? = null
    ) {
        val projectId = _currentProjectId.value ?: return

        viewModelScope.launch {
            val currentParent = parentId ?: _currentParentId.value
            val path = buildFilePath(name, currentParent)

            val result = projectRepository.addFile(
                projectId = projectId,
                name = name,
                path = path,
                type = type,
                parentId = currentParent,
                content = content
            )

            result.fold(
                onSuccess = { file ->
                    val typeText = if (type == "folder") "文件夹" else "文件"
                    _uiEvents.emit(ProjectUiEvent.ShowMessage("${typeText}已创建"))
                },
                onFailure = { error ->
                    _uiEvents.emit(ProjectUiEvent.ShowError(error.message ?: "创建失败"))
                }
            )
        }
    }

    /**
     * 构建文件路径
     */
    private suspend fun buildFilePath(name: String, parentId: String?): String {
        if (parentId == null) return name

        val parent = projectRepository.getFile(parentId) ?: return name
        return "${parent.path}/$name"
    }

    /**
     * 打开文件
     */
    fun openFile(fileId: String) {
        viewModelScope.launch {
            val result = projectRepository.openFile(fileId)

            result.fold(
                onSuccess = {
                    val projectId = _currentProjectId.value ?: return@fold
                    _uiEvents.emit(ProjectUiEvent.NavigateToFile(projectId, fileId))
                },
                onFailure = { error ->
                    _uiEvents.emit(ProjectUiEvent.ShowError(error.message ?: "打开失败"))
                }
            )
        }
    }

    /**
     * 关闭文件
     */
    fun closeFile(fileId: String) {
        viewModelScope.launch {
            projectRepository.closeFile(fileId)
        }
    }

    /**
     * 更新文件内容
     */
    fun updateFileContent(fileId: String, content: String) {
        viewModelScope.launch {
            projectRepository.updateFileContent(fileId, content)
        }
    }

    /**
     * 保存文件
     */
    fun saveFile(fileId: String) {
        viewModelScope.launch {
            val result = projectRepository.saveFile(fileId)

            result.fold(
                onSuccess = {
                    _uiEvents.emit(ProjectUiEvent.ShowMessage("文件已保存"))
                },
                onFailure = { error ->
                    _uiEvents.emit(ProjectUiEvent.ShowError(error.message ?: "保存失败"))
                }
            )
        }
    }

    /**
     * 删除文件
     */
    fun deleteFile(fileId: String) {
        viewModelScope.launch {
            val result = projectRepository.deleteFile(fileId)

            result.fold(
                onSuccess = {
                    _uiEvents.emit(ProjectUiEvent.ShowMessage("文件已删除"))
                },
                onFailure = { error ->
                    _uiEvents.emit(ProjectUiEvent.ShowError(error.message ?: "删除失败"))
                }
            )
        }
    }

    /**
     * 导航到文件夹
     */
    fun navigateToFolder(folderId: String?) {
        _currentParentId.value = folderId
    }

    /**
     * 展开/折叠文件树节点
     */
    fun toggleFileTreeNode(nodeId: String) {
        _fileTree.value = _fileTree.value.map { node ->
            toggleNodeRecursive(node, nodeId)
        }
    }

    private fun toggleNodeRecursive(node: FileTreeNode, targetId: String): FileTreeNode {
        return if (node.id == targetId) {
            node.copy(isExpanded = !node.isExpanded)
        } else {
            node.copy(children = node.children.map { toggleNodeRecursive(it, targetId) }.toMutableList())
        }
    }

    /**
     * 获取未保存的文件
     */
    suspend fun getDirtyFiles(): List<ProjectFileEntity> {
        val projectId = _currentProjectId.value ?: return emptyList()
        return projectRepository.getDirtyFiles(projectId)
    }

    /**
     * 清理资源
     */
    override fun onCleared() {
        super.onCleared()
        Log.d(TAG, "ProjectViewModel cleared")
    }
}
