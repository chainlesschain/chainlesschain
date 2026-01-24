package com.chainlesschain.android.feature.project.viewmodel

import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.core.database.entity.ProjectFileEntity
import com.chainlesschain.android.feature.project.repository.ProjectRepository
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
}

/**
 * ViewModel for file editing
 */
@HiltViewModel
class FileEditorViewModel @Inject constructor(
    private val projectRepository: ProjectRepository
) : ViewModel() {

    companion object {
        private const val TAG = "FileEditorViewModel"
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
                Log.e(TAG, "Error loading file", e)
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

                        Log.d(TAG, "File saved ${if (isAutoSave) "(auto)" else "(manual)"}")
                    },
                    onFailure = { error ->
                        _uiEvents.emit(FileEditorUiEvent.ShowError(error.message ?: "Save failed"))
                    }
                )
            } catch (e: Exception) {
                Log.e(TAG, "Error saving file", e)
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

    override fun onCleared() {
        super.onCleared()
        closeFile()
        Log.d(TAG, "FileEditorViewModel cleared")
    }
}
