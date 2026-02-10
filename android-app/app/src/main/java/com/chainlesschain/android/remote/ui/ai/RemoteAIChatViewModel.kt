package com.chainlesschain.android.remote.ui.ai

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.remote.commands.AICommands
import com.chainlesschain.android.remote.commands.TokenUsage
import com.chainlesschain.android.remote.model.ChatMessageType
import com.chainlesschain.android.remote.model.ConfirmStatus
import com.chainlesschain.android.remote.model.ContextMode
import com.chainlesschain.android.remote.model.CreationProgress
import com.chainlesschain.android.remote.model.CreationStep
import com.chainlesschain.android.remote.model.EnhancedChatMessage
import com.chainlesschain.android.remote.model.FileReference
import com.chainlesschain.android.remote.model.FileReferenceParser
import com.chainlesschain.android.remote.model.MessageRole
import com.chainlesschain.android.remote.model.PlanningState
import com.chainlesschain.android.remote.model.ProgressInfo
import com.chainlesschain.android.remote.model.StepStatus
import com.chainlesschain.android.remote.model.TaskPlan
import com.chainlesschain.android.remote.model.ThinkingStage
import com.chainlesschain.android.remote.p2p.ConnectionState
import com.chainlesschain.android.remote.p2p.P2PClient
import com.chainlesschain.android.remote.task.TaskPlanManager
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import timber.log.Timber
import javax.inject.Inject

@HiltViewModel
class RemoteAIChatViewModel @Inject constructor(
    private val aiCommands: AICommands,
    private val p2pClient: P2PClient,
    private val taskPlanManager: TaskPlanManager
) : ViewModel() {

    private val _uiState = MutableStateFlow(RemoteAIChatUiState())
    val uiState: StateFlow<RemoteAIChatUiState> = _uiState.asStateFlow()

    val connectionState: StateFlow<ConnectionState> = p2pClient.connectionState

    private val _messages = MutableStateFlow<List<EnhancedChatMessage>>(emptyList())
    val messages: StateFlow<List<EnhancedChatMessage>> = _messages.asStateFlow()

    // Planning state from TaskPlanManager
    val planningState: StateFlow<PlanningState> = taskPlanManager.planningState
    val currentPlan: StateFlow<TaskPlan?> = taskPlanManager.currentPlan

    // Available files for @mention
    private val _availableFiles = MutableStateFlow<List<FileReference>>(emptyList())
    val availableFiles: StateFlow<List<FileReference>> = _availableFiles.asStateFlow()

    // File picker state
    private val _showFilePicker = MutableStateFlow(false)
    val showFilePicker: StateFlow<Boolean> = _showFilePicker.asStateFlow()

    private val _filePickerQuery = MutableStateFlow("")
    val filePickerQuery: StateFlow<String> = _filePickerQuery.asStateFlow()

    // Creation progress
    private val _creationProgress = MutableStateFlow<CreationProgress?>(null)
    val creationProgress: StateFlow<CreationProgress?> = _creationProgress.asStateFlow()

    private var thinkingJob: Job? = null

    init {
        loadModels()
        loadAvailableFiles()
    }

    private fun loadModels() {
        viewModelScope.launch {
            val result = aiCommands.getModels()
            if (result.isSuccess) {
                val models = result.getOrNull()?.models.orEmpty()
                _uiState.update {
                    it.copy(
                        availableModels = models.map { m -> m.name },
                        selectedModel = it.selectedModel ?: models.firstOrNull()?.name
                    )
                }
            }
        }
    }

    private fun loadAvailableFiles() {
        viewModelScope.launch {
            // Wait for P2P connection
            if (p2pClient.connectionState.value != ConnectionState.CONNECTED) {
                Timber.d("P2P not connected, skipping file load")
                _availableFiles.value = emptyList()
                return@launch
            }

            try {
                // Fetch available files from PC via P2P
                val result = p2pClient.sendCommand<Map<String, Any>>(
                    method = "file.list",
                    params = mapOf(
                        "path" to ".",
                        "recursive" to false,
                        "limit" to 100
                    )
                )

                if (result.isSuccess) {
                    val data = result.getOrNull()
                    @Suppress("UNCHECKED_CAST")
                    val files = (data?.get("files") as? List<Map<String, Any>>)?.map { fileMap ->
                        FileReference(
                            path = fileMap["path"] as? String ?: "",
                            name = fileMap["name"] as? String ?: "",
                            extension = fileMap["extension"] as? String,
                            size = (fileMap["size"] as? Number)?.toLong(),
                            isDirectory = fileMap["isDirectory"] as? Boolean ?: false
                        )
                    } ?: emptyList()

                    _availableFiles.value = files
                    Timber.d("Loaded ${files.size} files from PC")
                } else {
                    Timber.w("Failed to load files: ${result.exceptionOrNull()?.message}")
                    _availableFiles.value = emptyList()
                }
            } catch (e: Exception) {
                Timber.e(e, "Error loading files from PC")
                _availableFiles.value = emptyList()
            }
        }
    }

    /**
     * Refresh available files from PC
     */
    fun refreshAvailableFiles() {
        loadAvailableFiles()
    }

    /**
     * Set context mode
     */
    fun setContextMode(mode: ContextMode) {
        _uiState.update { it.copy(contextMode = mode) }
    }

    /**
     * Set current file for FILE context mode
     */
    fun setCurrentFile(file: FileReference?) {
        _uiState.update { it.copy(currentFile = file) }
        if (file != null && _uiState.value.contextMode != ContextMode.FILE) {
            setContextMode(ContextMode.FILE)
        }
    }

    /**
     * Handle input text change - check for @ trigger
     */
    fun onInputChanged(text: String, cursorPosition: Int) {
        if (FileReferenceParser.shouldShowFilePicker(text, cursorPosition)) {
            _showFilePicker.value = true
            _filePickerQuery.value = ""
        } else {
            val partial = FileReferenceParser.getPartialReference(text, cursorPosition)
            if (partial != null && _showFilePicker.value) {
                _filePickerQuery.value = partial
            } else if (_showFilePicker.value && partial == null) {
                _showFilePicker.value = false
            }
        }
    }

    /**
     * Select a file from the picker
     */
    fun selectFile(file: FileReference): Pair<String, Int> {
        _showFilePicker.value = false
        val currentInput = _uiState.value.inputText
        val cursorPos = _uiState.value.cursorPosition
        return FileReferenceParser.insertReference(currentInput, cursorPos, file)
    }

    /**
     * Dismiss file picker
     */
    fun dismissFilePicker() {
        _showFilePicker.value = false
    }

    /**
     * Update input text state
     */
    fun updateInputState(text: String, cursorPosition: Int) {
        _uiState.update { it.copy(inputText = text, cursorPosition = cursorPosition) }
    }

    /**
     * Send a message
     */
    fun sendMessage(message: String) {
        val text = message.trim()
        if (text.isEmpty()) return
        if (connectionState.value != ConnectionState.CONNECTED) {
            _uiState.update { it.copy(error = "Not connected to PC") }
            return
        }

        // Parse file references
        val fileRefs = FileReferenceParser.parse(text)

        // Create user message
        val userMessage = EnhancedChatMessage(
            id = System.currentTimeMillis().toString(),
            role = MessageRole.USER,
            content = text,
            messageType = ChatMessageType.User,
            contextMode = _uiState.value.contextMode,
            referencedFiles = fileRefs
        )
        _messages.update { it + userMessage }
        _uiState.update {
            it.copy(
                isLoading = true,
                error = null,
                lastFailedMessage = null,
                inputText = "",
                cursorPosition = 0
            )
        }

        // Start thinking animation
        startThinkingAnimation()

        viewModelScope.launch {
            // Build context for the message
            val contextInfo = buildContextInfo()
            val fileContext = if (fileRefs.isNotEmpty()) {
                "\n\nReferenced files: ${fileRefs.joinToString(", ") { it.path }}"
            } else ""

            val result = aiCommands.chat(
                message = text + fileContext,
                conversationId = _uiState.value.conversationId,
                model = _uiState.value.selectedModel,
                systemPrompt = contextInfo,
                temperature = _uiState.value.temperature
            )

            stopThinkingAnimation()

            if (result.isSuccess) {
                val response = result.getOrNull()
                if (response != null) {
                    val assistantMessage = EnhancedChatMessage(
                        id = "${System.currentTimeMillis()}-assistant",
                        role = MessageRole.ASSISTANT,
                        content = response.reply,
                        model = response.model,
                        tokenUsage = response.tokens,
                        messageType = ChatMessageType.Assistant,
                        contextMode = _uiState.value.contextMode
                    )
                    _messages.update { it + assistantMessage }
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            conversationId = response.conversationId,
                            totalTokens = (it.totalTokens ?: 0) + (response.tokens?.total ?: 0)
                        )
                    }
                } else {
                    _uiState.update { it.copy(isLoading = false, error = "Empty response") }
                }
            } else {
                val errorMsg = result.exceptionOrNull()?.message ?: "Send failed"
                Timber.e(result.exceptionOrNull(), "Chat failed")
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        error = errorMsg,
                        lastFailedMessage = text
                    )
                }
            }
        }
    }

    /**
     * Build context info based on current mode
     */
    private fun buildContextInfo(): String {
        return when (_uiState.value.contextMode) {
            ContextMode.PROJECT -> {
                "You are assisting with a software project. Provide helpful, context-aware responses."
            }
            ContextMode.FILE -> {
                val file = _uiState.value.currentFile
                if (file != null) {
                    "You are helping with the file: ${file.path}. Focus on this specific file."
                } else {
                    "You are helping with specific files. Focus on the referenced files."
                }
            }
            ContextMode.GLOBAL -> {
                "You are a general AI assistant. Provide helpful responses."
            }
        }
    }

    /**
     * Start task planning for a request
     */
    fun startTaskPlanning(request: String) {
        viewModelScope.launch {
            // Add system message about starting planning
            val systemMessage = EnhancedChatMessage(
                id = "${System.currentTimeMillis()}-system",
                role = MessageRole.SYSTEM,
                content = "Starting task analysis...",
                messageType = ChatMessageType.System
            )
            _messages.update { it + systemMessage }

            // Analyze intent
            val result = taskPlanManager.analyzeIntent(request)
            if (result.isSuccess) {
                val intent = result.getOrNull()
                if (intent != null) {
                    // Add intent recognition message
                    val intentMessage = EnhancedChatMessage(
                        id = "${System.currentTimeMillis()}-intent",
                        role = MessageRole.ASSISTANT,
                        content = "I understand you want to: ${intent.intent}",
                        messageType = ChatMessageType.IntentRecognition(
                            intent = intent.intent,
                            confidence = intent.confidence
                        )
                    )
                    _messages.update { it + intentMessage }
                }
            }
        }
    }

    /**
     * Confirm analyzed intent
     */
    fun confirmIntent(confirmed: Boolean) {
        taskPlanManager.confirmIntent(
            if (confirmed) ConfirmStatus.CONFIRMED else ConfirmStatus.REJECTED
        )

        if (confirmed) {
            // Add confirmation message
            val msg = EnhancedChatMessage(
                id = "${System.currentTimeMillis()}-confirm",
                role = MessageRole.USER,
                content = "Confirmed",
                messageType = ChatMessageType.User
            )
            _messages.update { it + msg }
        }
    }

    /**
     * Generate and display task plan
     */
    fun generateTaskPlan() {
        viewModelScope.launch {
            val result = taskPlanManager.generatePlan()
            if (result.isSuccess) {
                val plan = result.getOrNull()
                if (plan != null) {
                    // Add plan message
                    val planMessage = EnhancedChatMessage(
                        id = "${System.currentTimeMillis()}-plan",
                        role = MessageRole.ASSISTANT,
                        content = plan.summary,
                        messageType = ChatMessageType.TaskPlanType(
                            plan = plan,
                            status = PlanningState.CONFIRMING
                        ),
                        taskPlan = plan
                    )
                    _messages.update { it + planMessage }
                }
            }
        }
    }

    /**
     * Confirm and execute plan
     */
    fun confirmPlan() {
        taskPlanManager.confirmPlan()

        // Add execution start message
        val msg = EnhancedChatMessage(
            id = "${System.currentTimeMillis()}-exec-start",
            role = MessageRole.SYSTEM,
            content = "Starting plan execution...",
            messageType = ChatMessageType.System
        )
        _messages.update { it + msg }
    }

    /**
     * Start creation progress tracking
     */
    fun startCreationProgress(steps: List<CreationStep>) {
        _creationProgress.value = CreationProgress(steps = steps)
    }

    /**
     * Update creation step status
     */
    fun updateCreationStep(stepId: Int, status: StepStatus) {
        _creationProgress.update { progress ->
            progress?.copy(
                steps = progress.steps.map { step ->
                    if (step.id == stepId) step.copy(status = status) else step
                },
                currentStep = if (status == StepStatus.IN_PROGRESS) stepId else progress.currentStep
            )
        }
    }

    /**
     * Complete creation progress
     */
    fun completeCreationProgress() {
        _creationProgress.update { it?.copy(isComplete = true) }
    }

    /**
     * Dismiss creation progress
     */
    fun dismissCreationProgress() {
        _creationProgress.value = null
    }

    private fun startThinkingAnimation() {
        thinkingJob?.cancel()
        thinkingJob = viewModelScope.launch {
            val stages = listOf(
                ThinkingStage.ANALYZING,
                ThinkingStage.PLANNING,
                ThinkingStage.GENERATING,
                ThinkingStage.REVIEWING
            )
            var index = 0
            while (true) {
                _uiState.update { it.copy(thinkingStage = stages[index]) }
                delay(1500)
                index = (index + 1) % stages.size
            }
        }
    }

    private fun stopThinkingAnimation() {
        thinkingJob?.cancel()
        thinkingJob = null
        _uiState.update { it.copy(thinkingStage = null) }
    }

    fun retryLastMessage() {
        val last = _uiState.value.lastFailedMessage ?: return
        sendMessage(last)
    }

    fun selectModel(model: String) {
        _uiState.update { it.copy(selectedModel = model) }
    }

    fun setTemperature(temperature: Float) {
        _uiState.update { it.copy(temperature = temperature.coerceIn(0f, 2f)) }
    }

    fun clearConversation() {
        _messages.value = emptyList()
        taskPlanManager.reset()
        _uiState.update {
            it.copy(
                conversationId = null,
                totalTokens = null,
                error = null,
                lastFailedMessage = null,
                thinkingStage = null
            )
        }
    }

    fun clearError() {
        _uiState.update { it.copy(error = null) }
        taskPlanManager.clearError()
    }
}

/**
 * UI State for Remote AI Chat
 */
data class RemoteAIChatUiState(
    val isLoading: Boolean = false,
    val error: String? = null,
    val conversationId: String? = null,
    val availableModels: List<String> = emptyList(),
    val selectedModel: String? = null,
    val temperature: Float = 0.7f,
    val totalTokens: Int? = null,
    val lastFailedMessage: String? = null,
    // New fields for Phase 1
    val contextMode: ContextMode = ContextMode.PROJECT,
    val currentFile: FileReference? = null,
    val inputText: String = "",
    val cursorPosition: Int = 0,
    val thinkingStage: ThinkingStage? = null
)

// Legacy support - will be deprecated
@Deprecated("Use EnhancedChatMessage instead", ReplaceWith("EnhancedChatMessage"))
data class ChatMessage(
    val id: String,
    val role: MessageRole,
    val content: String,
    val timestamp: Long,
    val model: String? = null,
    val tokenUsage: TokenUsage? = null
) {
    fun toEnhanced(): EnhancedChatMessage = EnhancedChatMessage(
        id = id,
        role = role,
        content = content,
        timestamp = timestamp,
        model = model,
        tokenUsage = tokenUsage
    )
}
