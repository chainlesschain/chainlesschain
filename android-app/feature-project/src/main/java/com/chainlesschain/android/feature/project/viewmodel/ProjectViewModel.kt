package com.chainlesschain.android.feature.project.viewmodel

import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.core.database.entity.ProjectActivityEntity
import com.chainlesschain.android.core.database.entity.ProjectChatMessageEntity
import com.chainlesschain.android.core.database.entity.ProjectEntity
import com.chainlesschain.android.core.database.entity.ProjectFileEntity
import com.chainlesschain.android.core.database.entity.ProjectQuickAction
import com.chainlesschain.android.core.database.entity.ProjectStatus
import com.chainlesschain.android.core.database.entity.ProjectType
import com.chainlesschain.android.feature.ai.data.repository.ConversationRepository
import com.chainlesschain.android.feature.ai.data.repository.LLMAdapterFactory
import com.chainlesschain.android.feature.ai.domain.model.LLMProvider
import com.chainlesschain.android.feature.ai.domain.model.Message
import com.chainlesschain.android.feature.ai.domain.model.MessageRole
import com.chainlesschain.android.feature.project.model.ChatContextMode
import com.chainlesschain.android.feature.project.model.CreateProjectRequest
import com.chainlesschain.android.feature.project.model.FileTreeNode
import com.chainlesschain.android.feature.project.model.ProjectDetailState
import com.chainlesschain.android.feature.project.model.ProjectFilter
import com.chainlesschain.android.feature.project.model.ProjectListState
import com.chainlesschain.android.feature.project.model.ProjectSortBy
import com.chainlesschain.android.feature.project.model.ProjectWithStats
import com.chainlesschain.android.feature.project.model.SortDirection
import com.chainlesschain.android.feature.project.model.TaskPlan
import com.chainlesschain.android.feature.project.model.ThinkingStage
import com.chainlesschain.android.feature.project.model.UpdateProjectRequest
import com.chainlesschain.android.feature.project.repository.ProjectChatRepository
import com.chainlesschain.android.feature.project.repository.ProjectRepository
import com.chainlesschain.android.feature.project.util.ContextManager
import com.chainlesschain.android.feature.project.util.ContextResult
import com.chainlesschain.android.core.common.fold
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
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
    private val projectRepository: ProjectRepository,
    private val projectChatRepository: ProjectChatRepository,
    private val conversationRepository: ConversationRepository,
    private val llmAdapterFactory: LLMAdapterFactory
) : ViewModel() {

    companion object {
        private const val TAG = "ProjectViewModel"
        private const val DEFAULT_MODEL = "deepseek-chat"
        private const val DEFAULT_PROVIDER = "DEEPSEEK"
        private const val MAX_CONTEXT_TOKENS = 4000  // DeepSeek 默认上下文窗口
    }

    // Context Manager
    private val contextManager = ContextManager(maxContextTokens = MAX_CONTEXT_TOKENS)

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

    // ===== AI Chat State =====
    private val _chatMessages = MutableStateFlow<List<ProjectChatMessageEntity>>(emptyList())
    val chatMessages: StateFlow<List<ProjectChatMessageEntity>> = _chatMessages.asStateFlow()

    private val _chatInputText = MutableStateFlow("")
    val chatInputText: StateFlow<String> = _chatInputText.asStateFlow()

    private val _isAiResponding = MutableStateFlow(false)
    val isAiResponding: StateFlow<Boolean> = _isAiResponding.asStateFlow()

    private val _currentModel = MutableStateFlow(DEFAULT_MODEL)
    val currentModel: StateFlow<String> = _currentModel.asStateFlow()

    private val _currentProvider = MutableStateFlow(LLMProvider.DEEPSEEK)
    val currentProvider: StateFlow<LLMProvider> = _currentProvider.asStateFlow()

    // ===== Context Mode State =====
    private val _contextMode = MutableStateFlow(ChatContextMode.PROJECT)
    val contextMode: StateFlow<ChatContextMode> = _contextMode.asStateFlow()

    private val _selectedFileForContext = MutableStateFlow<ProjectFileEntity?>(null)
    val selectedFileForContext: StateFlow<ProjectFileEntity?> = _selectedFileForContext.asStateFlow()

    // ===== File Search State =====
    private val _fileSearchQuery = MutableStateFlow("")
    val fileSearchQuery: StateFlow<String> = _fileSearchQuery.asStateFlow()

    private val _isFileSearchExpanded = MutableStateFlow(false)
    val isFileSearchExpanded: StateFlow<Boolean> = _isFileSearchExpanded.asStateFlow()

    private val _filteredFiles = MutableStateFlow<List<ProjectFileEntity>>(emptyList())
    val filteredFiles: StateFlow<List<ProjectFileEntity>> = _filteredFiles.asStateFlow()

    // ===== File Mention State =====
    private val _isFileMentionVisible = MutableStateFlow(false)
    val isFileMentionVisible: StateFlow<Boolean> = _isFileMentionVisible.asStateFlow()

    private val _fileMentionSearchQuery = MutableStateFlow("")
    val fileMentionSearchQuery: StateFlow<String> = _fileMentionSearchQuery.asStateFlow()

    private val _mentionedFiles = MutableStateFlow<List<ProjectFileEntity>>(emptyList())
    val mentionedFiles: StateFlow<List<ProjectFileEntity>> = _mentionedFiles.asStateFlow()

    // ===== Thinking Stage State =====
    private val _currentThinkingStage = MutableStateFlow(ThinkingStage.UNDERSTANDING)
    val currentThinkingStage: StateFlow<ThinkingStage> = _currentThinkingStage.asStateFlow()

    // ===== Task Plan State =====
    private val _currentTaskPlan = MutableStateFlow<TaskPlan?>(null)
    val currentTaskPlan: StateFlow<TaskPlan?> = _currentTaskPlan.asStateFlow()

    // ===== Context Management State =====
    private val _contextStats = MutableStateFlow<ContextResult?>(null)
    val contextStats: StateFlow<ContextResult?> = _contextStats.asStateFlow()

    private val _totalContextTokens = MutableStateFlow(0)
    val totalContextTokens: StateFlow<Int> = _totalContextTokens.asStateFlow()

    private var currentStreamingJob: Job? = null
    private var lastUserMessage: String = ""

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

        // 加载AI聊天消息
        loadChatMessages(projectId)
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

    // ===== AI Chat Operations =====

    /**
     * Load chat messages for current project
     */
    private fun loadChatMessages(projectId: String) {
        viewModelScope.launch {
            projectChatRepository.getMessages(projectId)
                .catch { e ->
                    Log.e(TAG, "Error loading chat messages", e)
                }
                .collect { messages ->
                    _chatMessages.value = messages
                }
        }
    }

    /**
     * Update chat input text
     */
    fun updateChatInput(text: String) {
        _chatInputText.value = text
    }

    /**
     * Send chat message
     */
    fun sendChatMessage() {
        val projectId = _currentProjectId.value ?: return
        val content = _chatInputText.value.trim()
        if (content.isBlank()) return

        lastUserMessage = content
        _chatInputText.value = ""

        viewModelScope.launch {
            // Add user message
            val userMessageResult = projectChatRepository.addUserMessage(projectId, content)
            if (userMessageResult.isError) {
                _uiEvents.emit(ProjectUiEvent.ShowError("Failed to send message"))
                return@launch
            }

            // Get AI response
            sendToAi(projectId, content)
        }
    }

    /**
     * Execute quick action
     */
    fun executeQuickAction(actionType: String) {
        val projectId = _currentProjectId.value ?: return

        viewModelScope.launch {
            val prompt = when (actionType) {
                ProjectQuickAction.GENERATE_README -> "Generate a comprehensive README.md file for this project. Include sections for: project title, description, features, installation, usage, and license."
                ProjectQuickAction.EXPLAIN_CODE -> "Explain what this project does, its main components, and how they work together."
                ProjectQuickAction.REVIEW_CODE -> "Review this project's code structure and suggest improvements for code quality, organization, and best practices."
                ProjectQuickAction.SUGGEST_FILES -> "Based on this project's structure, suggest what additional files might be useful to add."
                "explain_project" -> "What does this project do? Explain its purpose and main functionality."
                "suggest_improvements" -> "Analyze this project and suggest specific improvements for code quality, performance, and maintainability."
                else -> actionType
            }

            // Add user message for the quick action
            projectChatRepository.addUserMessage(projectId, prompt)

            // Send to AI with quick action flag
            sendToAi(projectId, prompt, isQuickAction = true, quickActionType = actionType)
        }
    }

    /**
     * Send message to AI and handle streaming response
     */
    private suspend fun sendToAi(
        projectId: String,
        content: String,
        isQuickAction: Boolean = false,
        quickActionType: String? = null
    ) {
        _isAiResponding.value = true
        _currentThinkingStage.value = ThinkingStage.UNDERSTANDING
        currentStreamingJob?.cancel()

        try {
            // Build context based on context mode
            _currentThinkingStage.value = ThinkingStage.ANALYZING
            val systemPrompt = buildContextPrompt(projectId)

            // Get ALL messages for intelligent context selection
            val allMessages = projectChatRepository.getAllMessages(projectId)

            // Use ContextManager to intelligently select messages
            val contextResult = contextManager.selectMessagesForContext(
                allMessages = allMessages,
                systemPrompt = systemPrompt
            )

            // Update context stats
            _contextStats.value = contextResult
            _totalContextTokens.value = contextResult.totalTokens

            Log.d(TAG, contextManager.generateContextSummary(contextResult))

            // Build message list for LLM
            val messages = mutableListOf<Message>()

            // Add system message
            messages.add(Message(
                id = "system",
                conversationId = projectId,
                role = MessageRole.SYSTEM,
                content = systemPrompt,
                createdAt = System.currentTimeMillis(),
                tokenCount = contextManager.estimateTokens(systemPrompt)
            ))

            // Convert selected messages to LLM format
            val llmMessages = contextManager.convertToLLMMessages(
                messages = contextResult.messages,
                conversationId = projectId
            )
            messages.addAll(llmMessages)

            // Create placeholder for assistant response
            val placeholderResult = projectChatRepository.createAssistantMessagePlaceholder(
                projectId = projectId,
                model = _currentModel.value,
                isQuickAction = isQuickAction,
                quickActionType = quickActionType
            )

            if (placeholderResult.isError) {
                _uiEvents.emit(ProjectUiEvent.ShowError("Failed to create response placeholder"))
                _isAiResponding.value = false
                return
            }

            val placeholderMessage = placeholderResult.getOrNull()!!

            // Get API key for the provider
            val apiKey = conversationRepository.getApiKey(_currentProvider.value)

            // Create adapter and stream response
            val adapter = llmAdapterFactory.createAdapter(_currentProvider.value, apiKey)
            var fullResponse = StringBuilder()

            _currentThinkingStage.value = ThinkingStage.PLANNING

            currentStreamingJob = viewModelScope.launch {
                try {
                    _currentThinkingStage.value = ThinkingStage.GENERATING

                    adapter.streamChat(
                        messages = messages,
                        model = _currentModel.value
                    ).collect { chunk ->
                        val chunkError = chunk.error
                        if (chunkError != null) {
                            projectChatRepository.setMessageError(placeholderMessage.id, chunkError)
                            _uiEvents.emit(ProjectUiEvent.ShowError(chunkError))
                        } else {
                            fullResponse.append(chunk.content)
                            projectChatRepository.updateStreamingContent(
                                placeholderMessage.id,
                                fullResponse.toString()
                            )

                            // Check if response contains a task plan
                            checkForTaskPlan(fullResponse.toString(), projectId)
                        }

                        if (chunk.isDone) {
                            projectChatRepository.completeMessage(placeholderMessage.id, null)
                            // Clear mentioned files after successful send
                            clearFileMentions()
                        }
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Error streaming AI response", e)
                    projectChatRepository.setMessageError(placeholderMessage.id, e.message ?: "Unknown error")
                    _uiEvents.emit(ProjectUiEvent.ShowError(e.message ?: "AI response failed"))
                }
            }

            currentStreamingJob?.join()

        } catch (e: Exception) {
            Log.e(TAG, "Error sending to AI", e)
            _uiEvents.emit(ProjectUiEvent.ShowError(e.message ?: "Failed to get AI response"))
        } finally {
            _isAiResponding.value = false
            _currentThinkingStage.value = ThinkingStage.UNDERSTANDING
        }
    }

    /**
     * Build context prompt based on context mode
     */
    private suspend fun buildContextPrompt(projectId: String): String {
        val baseContext = projectChatRepository.buildProjectContext(projectId)

        return when (_contextMode.value) {
            ChatContextMode.PROJECT -> {
                baseContext
            }

            ChatContextMode.FILE -> {
                val file = _selectedFileForContext.value
                if (file != null) {
                    """
                    |$baseContext
                    |
                    |---
                    |当前聚焦文件: ${file.name}
                    |文件路径: ${file.path}
                    |文件内容:
                    |```${file.extension ?: ""}
                    |${file.content ?: "(文件内容不可用)"}
                    |```
                    |
                    |请专注于这个文件的分析和修改。
                    """.trimMargin()
                } else {
                    baseContext
                }
            }

            ChatContextMode.GLOBAL -> {
                """
                |你是一个通用的AI助手，可以帮助回答各种问题。
                |当前用户在一个项目管理应用中与你对话。
                |如果问题与当前项目相关，请告诉用户切换到"项目"模式以获得更好的上下文。
                """.trimMargin()
            }
        } + getMentionedFilesContext()
    }

    /**
     * Get context for mentioned files
     */
    private fun getMentionedFilesContext(): String {
        val mentionedFiles = _mentionedFiles.value
        if (mentionedFiles.isEmpty()) return ""

        val filesContent = mentionedFiles.joinToString("\n\n") { file ->
            """
            |--- @${file.name} ---
            |路径: ${file.path}
            |```${file.extension ?: ""}
            |${file.content ?: "(内容不可用)"}
            |```
            """.trimMargin()
        }

        return """
            |
            |---
            |用户引用的文件:
            |$filesContent
        """.trimMargin()
    }

    /**
     * Check if AI response contains a task plan
     */
    private fun checkForTaskPlan(response: String, projectId: String) {
        // Look for task plan markers in the response
        val taskPlanPatterns = listOf(
            "任务计划",
            "Task Plan",
            "执行步骤",
            "Implementation Steps"
        )

        val containsTaskPlan = taskPlanPatterns.any {
            response.contains(it, ignoreCase = true)
        }

        if (containsTaskPlan && _currentTaskPlan.value == null) {
            // Try to parse the task plan
            val plan = TaskPlan.fromAIResponse(response, projectId)
            if (plan != null) {
                _currentTaskPlan.value = plan
            }
        }
    }

    /**
     * Retry last message
     */
    fun retryChatMessage() {
        if (lastUserMessage.isNotBlank()) {
            val projectId = _currentProjectId.value ?: return
            viewModelScope.launch {
                sendToAi(projectId, lastUserMessage)
            }
        }
    }

    /**
     * Clear chat history for current project
     */
    fun clearChatHistory() {
        val projectId = _currentProjectId.value ?: return

        viewModelScope.launch {
            val result = projectChatRepository.clearChatHistory(projectId)
            result.fold(
                onSuccess = {
                    _uiEvents.emit(ProjectUiEvent.ShowMessage("Chat history cleared"))
                },
                onFailure = { error ->
                    _uiEvents.emit(ProjectUiEvent.ShowError(error.message ?: "Failed to clear chat"))
                }
            )
        }
    }

    /**
     * Set LLM model
     */
    fun setModel(model: String) {
        _currentModel.value = model
    }

    /**
     * Set LLM provider
     */
    fun setProvider(provider: LLMProvider) {
        _currentProvider.value = provider
    }

    // ===== Context Mode Operations =====

    /**
     * Set chat context mode
     */
    fun setContextMode(mode: ChatContextMode) {
        _contextMode.value = mode
        // If switching to FILE mode without a selected file, select the first open file
        if (mode == ChatContextMode.FILE && _selectedFileForContext.value == null) {
            _selectedFileForContext.value = _openFiles.value.firstOrNull()
        }
    }

    /**
     * Set the file to use for FILE context mode
     */
    fun setContextFile(file: ProjectFileEntity?) {
        _selectedFileForContext.value = file
        if (file != null) {
            _contextMode.value = ChatContextMode.FILE
        }
    }

    // ===== File Search Operations =====

    /**
     * Update file search query
     */
    fun updateFileSearchQuery(query: String) {
        _fileSearchQuery.value = query
        filterFiles(query)
    }

    /**
     * Toggle file search expansion
     */
    fun toggleFileSearchExpanded() {
        _isFileSearchExpanded.value = !_isFileSearchExpanded.value
        if (!_isFileSearchExpanded.value) {
            _fileSearchQuery.value = ""
            _filteredFiles.value = emptyList()
        }
    }

    /**
     * Set file search expanded state
     */
    fun setFileSearchExpanded(expanded: Boolean) {
        _isFileSearchExpanded.value = expanded
        if (!expanded) {
            _fileSearchQuery.value = ""
            _filteredFiles.value = emptyList()
        }
    }

    /**
     * Filter files by search query
     */
    private fun filterFiles(query: String) {
        if (query.isBlank()) {
            _filteredFiles.value = emptyList()
            return
        }

        _filteredFiles.value = _projectFiles.value.filter { file ->
            file.name.contains(query, ignoreCase = true) ||
            file.path.contains(query, ignoreCase = true)
        }
    }

    // ===== File Mention Operations =====

    /**
     * Show file mention popup
     */
    fun showFileMentionPopup() {
        _isFileMentionVisible.value = true
        _fileMentionSearchQuery.value = ""
    }

    /**
     * Hide file mention popup
     */
    fun hideFileMentionPopup() {
        _isFileMentionVisible.value = false
        _fileMentionSearchQuery.value = ""
    }

    /**
     * Update file mention search query
     */
    fun updateFileMentionSearchQuery(query: String) {
        _fileMentionSearchQuery.value = query
    }

    /**
     * Add file to mentions
     */
    fun addFileMention(file: ProjectFileEntity) {
        val current = _mentionedFiles.value.toMutableList()
        if (!current.any { it.id == file.id }) {
            current.add(file)
            _mentionedFiles.value = current
        }

        // Update chat input with @mention
        val currentInput = _chatInputText.value
        val mentionText = "@${file.name} "
        _chatInputText.value = currentInput + mentionText

        hideFileMentionPopup()
    }

    /**
     * Remove file from mentions
     */
    fun removeFileMention(file: ProjectFileEntity) {
        _mentionedFiles.value = _mentionedFiles.value.filter { it.id != file.id }
    }

    /**
     * Clear all file mentions
     */
    fun clearFileMentions() {
        _mentionedFiles.value = emptyList()
    }

    /**
     * Check if chat input has @ trigger for file mention
     */
    fun checkForFileMentionTrigger(text: String) {
        // Check if user just typed @ at the end
        if (text.endsWith("@")) {
            showFileMentionPopup()
        }
    }

    // ===== Task Plan Operations =====

    /**
     * Confirm and execute task plan
     */
    fun confirmTaskPlan() {
        val plan = _currentTaskPlan.value ?: return
        _currentTaskPlan.value = plan.copy(
            status = com.chainlesschain.android.feature.project.model.TaskPlanStatus.CONFIRMED
        )

        viewModelScope.launch {
            executeTaskPlan(plan)
        }
    }

    /**
     * Cancel task plan
     */
    fun cancelTaskPlan() {
        _currentTaskPlan.value = _currentTaskPlan.value?.copy(
            status = com.chainlesschain.android.feature.project.model.TaskPlanStatus.CANCELLED
        )
        _currentTaskPlan.value = null
    }

    /**
     * Modify task plan
     */
    fun modifyTaskPlan() {
        val plan = _currentTaskPlan.value ?: return
        // Add plan description to chat input for user to modify
        _chatInputText.value = "修改计划: ${plan.title}\n\n${plan.steps.joinToString("\n") { "- ${it.description}" }}\n\n请告诉我需要修改的内容:"
        _currentTaskPlan.value = null
    }

    /**
     * Retry a specific task step
     */
    fun retryTaskStep(step: com.chainlesschain.android.feature.project.model.TaskStep) {
        viewModelScope.launch {
            _uiEvents.emit(ProjectUiEvent.ShowMessage("重试步骤: ${step.description}"))
            // TODO: Implement actual step retry logic
        }
    }

    /**
     * Execute task plan steps
     */
    private suspend fun executeTaskPlan(plan: TaskPlan) {
        _currentTaskPlan.value = plan.copy(
            status = com.chainlesschain.android.feature.project.model.TaskPlanStatus.EXECUTING
        )

        try {
            plan.steps.forEachIndexed { index, step ->
                // Update step to in_progress
                updateStepStatus(index, com.chainlesschain.android.feature.project.model.StepStatus.IN_PROGRESS)

                // Simulate step execution (TODO: implement actual execution)
                kotlinx.coroutines.delay(1000)

                // Mark step as completed
                updateStepStatus(index, com.chainlesschain.android.feature.project.model.StepStatus.COMPLETED)
            }

            _currentTaskPlan.value = _currentTaskPlan.value?.copy(
                status = com.chainlesschain.android.feature.project.model.TaskPlanStatus.COMPLETED,
                completedAt = System.currentTimeMillis()
            )

            _uiEvents.emit(ProjectUiEvent.ShowMessage("任务计划执行完成"))
        } catch (e: Exception) {
            _currentTaskPlan.value = _currentTaskPlan.value?.copy(
                status = com.chainlesschain.android.feature.project.model.TaskPlanStatus.FAILED
            )
            _uiEvents.emit(ProjectUiEvent.ShowError("任务执行失败: ${e.message}"))
        }
    }

    /**
     * Update a step's status in the current task plan
     */
    private fun updateStepStatus(stepIndex: Int, status: com.chainlesschain.android.feature.project.model.StepStatus) {
        val currentPlan = _currentTaskPlan.value ?: return
        val updatedSteps = currentPlan.steps.mapIndexed { index, step ->
            if (index == stepIndex) {
                step.copy(
                    status = status,
                    startedAt = if (status == com.chainlesschain.android.feature.project.model.StepStatus.IN_PROGRESS)
                        System.currentTimeMillis() else step.startedAt,
                    completedAt = if (status == com.chainlesschain.android.feature.project.model.StepStatus.COMPLETED)
                        System.currentTimeMillis() else step.completedAt
                )
            } else {
                step
            }
        }
        _currentTaskPlan.value = currentPlan.copy(steps = updatedSteps)
    }

    /**
     * 清理资源
     */
    override fun onCleared() {
        super.onCleared()
        currentStreamingJob?.cancel()
        Log.d(TAG, "ProjectViewModel cleared")
    }
}
