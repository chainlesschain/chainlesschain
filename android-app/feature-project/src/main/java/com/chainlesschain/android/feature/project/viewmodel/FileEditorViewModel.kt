package com.chainlesschain.android.feature.project.viewmodel

import timber.log.Timber
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.core.database.entity.ProjectFileEntity
import com.chainlesschain.android.feature.ai.data.llm.LLMAdapter
import com.chainlesschain.android.feature.ai.domain.model.Message
import com.chainlesschain.android.feature.ai.domain.model.MessageRole
import com.chainlesschain.android.feature.project.repository.ProjectRepository
import com.chainlesschain.android.feature.project.ui.components.AIAssistAction
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * UI events for file editor
 */
sealed class FileEditorUiEvent {
    data class ShowMessage(val message: String) : FileEditorUiEvent()
    data class ShowError(val error: String) : FileEditorUiEvent()
    object NavigateBack : FileEditorUiEvent()
    object FileSaved : FileEditorUiEvent()
    data class AIResultReady(val result: String) : FileEditorUiEvent()
}

/**
 * ViewModel for file editing
 */
@HiltViewModel
class FileEditorViewModel @Inject constructor(
    private val projectRepository: ProjectRepository,
    private val llmAdapter: LLMAdapter
) : ViewModel() {

    companion object {
        private const val AUTO_SAVE_DELAY_MS = 2000L // 2 seconds
    }

    // Auto-save job for debouncing
    private var autoSaveJob: Job? = null

    // Auto-save enabled flag
    private val _isAutoSaveEnabled = MutableStateFlow(true)
    val isAutoSaveEnabled: StateFlow<Boolean> = _isAutoSaveEnabled.asStateFlow()

    // Last auto-save time
    private val _lastSaveTime = MutableStateFlow<Long?>(null)
    val lastSaveTime: StateFlow<Long?> = _lastSaveTime.asStateFlow()

    // Current file being edited
    private val _currentFile = MutableStateFlow<ProjectFileEntity?>(null)
    val currentFile: StateFlow<ProjectFileEntity?> = _currentFile.asStateFlow()

    // File content
    private val _fileContent = MutableStateFlow("")
    val fileContent: StateFlow<String> = _fileContent.asStateFlow()

    // Original content for dirty tracking
    private var originalContent: String = ""

    // Dirty state
    private val _isDirty = MutableStateFlow(false)
    val isDirty: StateFlow<Boolean> = _isDirty.asStateFlow()

    // Loading state
    private val _isLoading = MutableStateFlow(false)
    val isLoading: StateFlow<Boolean> = _isLoading.asStateFlow()

    // Saving state
    private val _isSaving = MutableStateFlow(false)
    val isSaving: StateFlow<Boolean> = _isSaving.asStateFlow()

    // Current project and file IDs
    private var currentProjectId: String? = null
    private var currentFileId: String? = null

    // UI events
    private val _uiEvents = MutableSharedFlow<FileEditorUiEvent>()
    val uiEvents: SharedFlow<FileEditorUiEvent> = _uiEvents.asSharedFlow()

    // AI processing state
    private val _isAIProcessing = MutableStateFlow(false)
    val isAIProcessing: StateFlow<Boolean> = _isAIProcessing.asStateFlow()

    // AI result
    private val _aiResult = MutableStateFlow<String?>(null)
    val aiResult: StateFlow<String?> = _aiResult.asStateFlow()

    // Find and replace state
    private val _showFindReplace = MutableStateFlow(false)
    val showFindReplace: StateFlow<Boolean> = _showFindReplace.asStateFlow()

    private val _findMatchIndex = MutableStateFlow(0)
    val findMatchIndex: StateFlow<Int> = _findMatchIndex.asStateFlow()

    private val _findTotalMatches = MutableStateFlow(0)
    val findTotalMatches: StateFlow<Int> = _findTotalMatches.asStateFlow()

    // Autocomplete state
    private val _showAutocomplete = MutableStateFlow(false)
    val showAutocomplete: StateFlow<Boolean> = _showAutocomplete.asStateFlow()

    private val _cursorPosition = MutableStateFlow(0)
    val cursorPosition: StateFlow<Int> = _cursorPosition.asStateFlow()

    /**
     * Toggle find and replace dialog
     */
    fun toggleFindReplace() {
        _showFindReplace.value = !_showFindReplace.value
    }

    /**
     * Update find result
     */
    fun updateFindResult(matchIndex: Int, totalMatches: Int) {
        _findMatchIndex.value = matchIndex
        _findTotalMatches.value = totalMatches
    }

    /**
     * Update cursor position for autocomplete
     */
    fun updateCursorPosition(position: Int) {
        _cursorPosition.value = position
    }

    /**
     * Toggle autocomplete
     */
    fun toggleAutocomplete(show: Boolean) {
        _showAutocomplete.value = show
    }

    /**
     * Load file content
     */
    fun loadFile(projectId: String, fileId: String) {
        currentProjectId = projectId
        currentFileId = fileId
        _isLoading.value = true

        viewModelScope.launch {
            try {
                val file = projectRepository.getFile(fileId)
                if (file != null) {
                    _currentFile.value = file
                    _fileContent.value = file.content ?: ""
                    originalContent = file.content ?: ""
                    _isDirty.value = false

                    // Mark file as open
                    projectRepository.openFile(fileId)
                } else {
                    _uiEvents.emit(FileEditorUiEvent.ShowError("File not found"))
                }
            } catch (e: Exception) {
                Timber.e(e, "Error loading file")
                _uiEvents.emit(FileEditorUiEvent.ShowError(e.message ?: "Failed to load file"))
            } finally {
                _isLoading.value = false
            }
        }
    }

    /**
     * Update file content
     */
    fun updateContent(newContent: String) {
        _fileContent.value = newContent
        _isDirty.value = newContent != originalContent

        // Update dirty status in database
        currentFileId?.let { fileId ->
            viewModelScope.launch {
                projectRepository.updateFileContent(fileId, newContent)
            }
        }

        // Trigger auto-save with debounce
        if (_isAutoSaveEnabled.value && _isDirty.value) {
            scheduleAutoSave()
        }
    }

    /**
     * Schedule auto-save with debounce
     */
    private fun scheduleAutoSave() {
        // Cancel previous auto-save job
        autoSaveJob?.cancel()

        // Schedule new auto-save
        autoSaveJob = viewModelScope.launch {
            delay(AUTO_SAVE_DELAY_MS)
            if (_isDirty.value) {
                saveFile(isAutoSave = true)
            }
        }
    }

    /**
     * Toggle auto-save
     */
    fun toggleAutoSave() {
        _isAutoSaveEnabled.value = !_isAutoSaveEnabled.value
        if (!_isAutoSaveEnabled.value) {
            autoSaveJob?.cancel()
        }
    }

    /**
     * Set auto-save enabled state
     */
    fun setAutoSaveEnabled(enabled: Boolean) {
        _isAutoSaveEnabled.value = enabled
        if (!enabled) {
            autoSaveJob?.cancel()
        }
    }

    /**
     * Save file
     */
    fun saveFile(isAutoSave: Boolean = false) {
        val fileId = currentFileId ?: return
        if (!_isDirty.value) return

        _isSaving.value = true

        viewModelScope.launch {
            try {
                val result = projectRepository.saveFile(fileId)
                result.fold(
                    onSuccess = {
                        originalContent = _fileContent.value
                        _isDirty.value = false
                        _lastSaveTime.value = System.currentTimeMillis()

                        // Only show snackbar for manual saves
                        if (!isAutoSave) {
                            _uiEvents.emit(FileEditorUiEvent.FileSaved)
                        }

                        Timber.d("File saved ${if (isAutoSave) "(auto)" else "(manual)"}")
                    },
                    onFailure = { error ->
                        _uiEvents.emit(FileEditorUiEvent.ShowError(error.message ?: "Save failed"))
                    }
                )
            } catch (e: Exception) {
                Timber.e(e, "Error saving file")
                _uiEvents.emit(FileEditorUiEvent.ShowError(e.message ?: "Save failed"))
            } finally {
                _isSaving.value = false
            }
        }
    }

    /**
     * Revert changes
     */
    fun revertChanges() {
        _fileContent.value = originalContent
        _isDirty.value = false
    }

    /**
     * Close file
     */
    fun closeFile() {
        currentFileId?.let { fileId ->
            viewModelScope.launch {
                projectRepository.closeFile(fileId)
            }
        }
    }

    /**
     * Process AI assist action
     */
    fun processAIAssist(action: AIAssistAction, model: String = "deepseek-chat") {
        val content = _fileContent.value
        val fileName = _currentFile.value?.name ?: "未命名文件"
        val fileExtension = _currentFile.value?.extension ?: "txt"

        if (content.isEmpty()) {
            viewModelScope.launch {
                _uiEvents.emit(FileEditorUiEvent.ShowError("文件内容为空"))
            }
            return
        }

        _isAIProcessing.value = true
        _aiResult.value = null

        viewModelScope.launch {
            try {
                val prompt = buildAIPrompt(action, content, fileName, fileExtension)
                val messages = listOf(
                    Message(
                        id = "system",
                        conversationId = "file-editor",
                        role = MessageRole.SYSTEM,
                        content = "你是一个专业的代码助手。请根据用户的要求分析和处理代码。",
                        createdAt = System.currentTimeMillis()
                    ),
                    Message(
                        id = "user",
                        conversationId = "file-editor",
                        role = MessageRole.USER,
                        content = prompt,
                        createdAt = System.currentTimeMillis()
                    )
                )

                val result = llmAdapter.chat(
                    messages = messages,
                    model = model,
                    temperature = 0.7f,
                    maxTokens = 4096
                )

                _aiResult.value = result
                _isAIProcessing.value = false
                _uiEvents.emit(FileEditorUiEvent.AIResultReady(result))

                // For certain actions, automatically apply the result
                when (action) {
                    AIAssistAction.ADD_COMMENTS,
                    AIAssistAction.IMPROVE_NAMING,
                    AIAssistAction.REFACTOR,
                    AIAssistAction.COMPLETE_CODE -> {
                        // These actions might want to modify the file content
                        // User can choose to apply or discard
                    }
                    else -> {
                        // Just show the result
                    }
                }

                Timber.d("AI assist completed: ${action.name}")
            } catch (e: Exception) {
                Timber.e(e, "AI assist error")
                _isAIProcessing.value = false
                _uiEvents.emit(
                    FileEditorUiEvent.ShowError("AI处理失败: ${e.message ?: "未知错误"}")
                )
            }
        }
    }

    /**
     * Build AI prompt based on action type
     */
    private fun buildAIPrompt(
        action: AIAssistAction,
        content: String,
        fileName: String,
        fileExtension: String
    ): String {
        return when (action) {
            AIAssistAction.EXPLAIN -> """
                请解释以下${fileExtension}代码的功能和工作原理：

                文件名: $fileName

                ```$fileExtension
                $content
                ```

                请包含：
                1. 代码的主要功能
                2. 关键逻辑和算法
                3. 重要的设计模式或架构
                4. 潜在的使用场景
            """.trimIndent()

            AIAssistAction.OPTIMIZE -> """
                请分析以下${fileExtension}代码并提供优化建议：

                文件名: $fileName

                ```$fileExtension
                $content
                ```

                请提供：
                1. 性能优化建议
                2. 代码结构优化
                3. 可读性改进
                4. 最佳实践建议
                5. 具体的优化代码示例（如果适用）
            """.trimIndent()

            AIAssistAction.FIX_BUGS -> """
                请检测以下${fileExtension}代码中可能存在的bug和问题：

                文件名: $fileName

                ```$fileExtension
                $content
                ```

                请分析：
                1. 潜在的运行时错误
                2. 逻辑错误
                3. 边界条件问题
                4. 资源泄漏风险
                5. 安全隐患
                6. 每个问题的修复建议
            """.trimIndent()

            AIAssistAction.ADD_COMMENTS -> """
                请为以下${fileExtension}代码添加详细的注释和文档：

                文件名: $fileName

                ```$fileExtension
                $content
                ```

                要求：
                1. 为函数/方法添加文档注释
                2. 为复杂逻辑添加行内注释
                3. 说明参数和返回值
                4. 注释应该清晰、准确、有帮助
                5. 使用该语言的标准注释格式

                请返回添加了注释的完整代码。
            """.trimIndent()

            AIAssistAction.REFACTOR -> """
                请为以下${fileExtension}代码提供重构建议：

                文件名: $fileName

                ```$fileExtension
                $content
                ```

                请提供：
                1. 代码结构改进建议
                2. 设计模式应用建议
                3. 函数/类的拆分建议
                4. 命名改进建议
                5. 重构后的代码示例
                6. 每个重构的理由和好处
            """.trimIndent()

            AIAssistAction.GENERATE_TESTS -> """
                请为以下${fileExtension}代码生成单元测试：

                文件名: $fileName

                ```$fileExtension
                $content
                ```

                要求：
                1. 覆盖主要功能和边界条件
                2. 使用该语言的标准测试框架
                3. 包含正常情况和异常情况
                4. 测试代码清晰易懂
                5. 添加适当的断言和验证

                请返回完整的测试代码。
            """.trimIndent()

            AIAssistAction.IMPROVE_NAMING -> """
                请分析以下${fileExtension}代码的命名，并提供改进建议：

                文件名: $fileName

                ```$fileExtension
                $content
                ```

                请：
                1. 识别命名不够清晰的变量、函数、类
                2. 提供更好的命名建议
                3. 解释为什么新名称更好
                4. 返回改进命名后的代码
                5. 遵循该语言的命名规范
            """.trimIndent()

            AIAssistAction.COMPLETE_CODE -> """
                请分析以下${fileExtension}代码，并智能补全未完成的部分：

                文件名: $fileName

                ```$fileExtension
                $content
                ```

                请：
                1. 识别未完成的函数或逻辑
                2. 基于上下文智能补全代码
                3. 保持代码风格一致
                4. 添加必要的错误处理
                5. 返回补全后的完整代码
                6. 解释补全的逻辑
            """.trimIndent()
        }
    }

    /**
     * Apply AI result to file content
     */
    fun applyAIResult() {
        val result = _aiResult.value
        if (result != null) {
            updateContent(result)
            _aiResult.value = null
        }
    }

    /**
     * Discard AI result
     */
    fun discardAIResult() {
        _aiResult.value = null
    }

    override fun onCleared() {
        super.onCleared()
        closeFile()
        Timber.d("FileEditorViewModel cleared")
    }
}
