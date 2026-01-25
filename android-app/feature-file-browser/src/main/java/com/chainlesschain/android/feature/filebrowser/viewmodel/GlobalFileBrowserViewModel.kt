package com.chainlesschain.android.feature.filebrowser.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.feature.filebrowser.data.repository.ExternalFileRepository
import com.chainlesschain.android.feature.filebrowser.data.repository.FileImportRepository
import com.chainlesschain.android.feature.filebrowser.data.scanner.MediaStoreScanner
import com.chainlesschain.android.core.database.entity.ExternalFileEntity
import com.chainlesschain.android.core.database.entity.FileCategory
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Global File Browser ViewModel
 *
 * Manages the file browser UI state, permissions, scanning, and file operations.
 *
 * Features:
 * - Permission checking and management
 * - MediaStore scanning with progress tracking
 * - File listing with search, filtering, and sorting
 * - Category-based filtering
 * - Statistics and analytics
 * - File import to knowledge base
 */
@HiltViewModel
class GlobalFileBrowserViewModel @Inject constructor(
    private val mediaStoreScanner: MediaStoreScanner,
    private val externalFileRepository: ExternalFileRepository,
    private val fileImportRepository: FileImportRepository
) : ViewModel() {

    companion object {
        private const val TAG = "GlobalFileBrowserViewModel"
    }

    // Permission state
    private val _permissionGranted = MutableStateFlow(false)
    val permissionGranted: StateFlow<Boolean> = _permissionGranted.asStateFlow()

    // Scan progress
    private val _scanProgress = MutableStateFlow<MediaStoreScanner.ScanProgress>(
        MediaStoreScanner.ScanProgress.Idle
    )
    val scanProgress: StateFlow<MediaStoreScanner.ScanProgress> = _scanProgress.asStateFlow()

    // UI state
    private val _uiState = MutableStateFlow<FileBrowserUiState>(FileBrowserUiState.Loading)
    val uiState: StateFlow<FileBrowserUiState> = _uiState.asStateFlow()

    // Files list
    private val _files = MutableStateFlow<List<ExternalFileEntity>>(emptyList())
    val files: StateFlow<List<ExternalFileEntity>> = _files.asStateFlow()

    // Search query
    private val _searchQuery = MutableStateFlow("")
    val searchQuery: StateFlow<String> = _searchQuery.asStateFlow()

    // Selected category
    private val _selectedCategory = MutableStateFlow<FileCategory?>(null)
    val selectedCategory: StateFlow<FileCategory?> = _selectedCategory.asStateFlow()

    // Sort options
    private val _sortBy = MutableStateFlow(SortBy.DATE)
    val sortBy: StateFlow<SortBy> = _sortBy.asStateFlow()

    private val _sortDirection = MutableStateFlow(SortDirection.DESC)
    val sortDirection: StateFlow<SortDirection> = _sortDirection.asStateFlow()

    // Statistics
    private val _statistics = MutableStateFlow<FileBrowserStatistics?>(null)
    val statistics: StateFlow<FileBrowserStatistics?> = _statistics.asStateFlow()

    private var loadFilesJob: Job? = null

    init {
        checkPermissions()
        observeScanProgress()
        observeFilters()
    }

    /**
     * UI State sealed class
     */
    sealed class FileBrowserUiState {
        object Loading : FileBrowserUiState()
        data class Success(val fileCount: Int) : FileBrowserUiState()
        object Empty : FileBrowserUiState()
        data class Error(val message: String) : FileBrowserUiState()
    }

    /**
     * Sort options
     */
    enum class SortBy {
        NAME,
        SIZE,
        DATE,
        TYPE
    }

    /**
     * Sort direction
     */
    enum class SortDirection {
        ASC,
        DESC
    }

    /**
     * File browser statistics
     */
    data class FileBrowserStatistics(
        val totalFiles: Int,
        val totalSize: Long,
        val categories: List<CategoryStats>,
        val favoriteCount: Int,
        val importedCount: Int
    )

    /**
     * Category statistics
     */
    data class CategoryStats(
        val category: String,
        val count: Int,
        val totalSize: Long
    )

    /**
     * Check storage permissions
     *
     * Note: Permission checking should be handled by the UI layer
     * This method is retained for API compatibility
     */
    fun checkPermissions() {
        // Permission checking delegated to UI layer
        // UI should call onPermissionsGranted() after checking permissions
    }

    /**
     * Called when permissions are granted
     */
    fun onPermissionsGranted() {
        _permissionGranted.value = true
        startScan()
    }

    /**
     * Start MediaStore scan
     */
    fun startScan() {
        viewModelScope.launch {
            _uiState.value = FileBrowserUiState.Loading
            mediaStoreScanner.scanAllFiles()
        }
    }

    /**
     * Observe scan progress from MediaStoreScanner
     */
    private fun observeScanProgress() {
        mediaStoreScanner.scanProgress
            .onEach { progress ->
                _scanProgress.value = progress
                when (progress) {
                    is MediaStoreScanner.ScanProgress.Completed -> {
                        loadFiles()
                        loadStatistics()
                    }
                    is MediaStoreScanner.ScanProgress.Error -> {
                        _uiState.value = FileBrowserUiState.Error(progress.message)
                    }
                    else -> {}
                }
            }
            .launchIn(viewModelScope)
    }

    /**
     * Observe filters and reload files when they change
     */
    private fun observeFilters() {
        combine(
            _searchQuery,
            _selectedCategory,
            _sortBy,
            _sortDirection
        ) { query, category, sort, direction ->
            FilterState(query, category, sort, direction)
        }
            .onEach {
                loadFiles()
            }
            .launchIn(viewModelScope)
    }

    /**
     * Load files based on current filters
     */
    private fun loadFiles() {
        loadFilesJob?.cancel()
        loadFilesJob = viewModelScope.launch {
            _uiState.value = FileBrowserUiState.Loading

            val query = _searchQuery.value
            val category = _selectedCategory.value
            val ascending = _sortDirection.value == SortDirection.ASC

            val flow = when {
                query.isNotEmpty() -> externalFileRepository.searchFiles(query)
                category != null -> externalFileRepository.getFilesByCategory(category)
                else -> externalFileRepository.getAllFiles()
            }

            flow
                .catch { e ->
                    _uiState.value = FileBrowserUiState.Error(
                        e.message ?: "Failed to load files"
                    )
                }
                .collect { fileList ->
                    val sortedFiles = sortFiles(fileList, _sortBy.value, ascending)
                    _files.value = sortedFiles

                    _uiState.value = if (sortedFiles.isEmpty()) {
                        FileBrowserUiState.Empty
                    } else {
                        FileBrowserUiState.Success(sortedFiles.size)
                    }
                }
        }
    }

    /**
     * Sort files based on criteria
     */
    private fun sortFiles(
        files: List<ExternalFileEntity>,
        sortBy: SortBy,
        ascending: Boolean
    ): List<ExternalFileEntity> {
        val sorted = when (sortBy) {
            SortBy.NAME -> files.sortedBy { it.displayName.lowercase() }
            SortBy.SIZE -> files.sortedBy { it.size }
            SortBy.DATE -> files.sortedBy { it.lastModified }
            SortBy.TYPE -> files.sortedBy { it.mimeType }
        }
        return if (ascending) sorted else sorted.reversed()
    }

    /**
     * Load file statistics
     */
    private fun loadStatistics() {
        viewModelScope.launch {
            try {
                val totalFiles = externalFileRepository.getFilesCount()
                val totalSize = externalFileRepository.getTotalSize()

                // Calculate category stats
                val categoryStats = FileCategory.values().map { category ->
                    CategoryStats(
                        category = category.name,
                        count = externalFileRepository.getFileCountByCategory(category),
                        totalSize = 0L // TODO: implement getTotalSizeByCategory if needed
                    )
                }

                _statistics.value = FileBrowserStatistics(
                    totalFiles = totalFiles,
                    totalSize = totalSize,
                    categories = categoryStats,
                    favoriteCount = 0, // TODO: implement if needed
                    importedCount = 0  // TODO: implement if needed
                )
            } catch (e: Exception) {
                android.util.Log.e(TAG, "Error loading statistics", e)
            }
        }
    }

    /**
     * Search files by query
     */
    fun searchFiles(query: String) {
        _searchQuery.value = query
    }

    /**
     * Select category filter
     */
    fun selectCategory(category: FileCategory?) {
        _selectedCategory.value = category
    }

    /**
     * Set sort criteria
     */
    fun setSortBy(sortBy: SortBy) {
        _sortBy.value = sortBy
    }

    /**
     * Toggle sort direction
     */
    fun toggleSortDirection() {
        _sortDirection.update { currentDirection ->
            when (currentDirection) {
                SortDirection.ASC -> SortDirection.DESC
                SortDirection.DESC -> SortDirection.ASC
            }
        }
    }

    /**
     * Toggle favorite status of a file
     */
    fun toggleFavorite(fileId: String) {
        viewModelScope.launch {
            externalFileRepository.toggleFavorite(fileId)
        }
    }

    /**
     * Import file to project
     *
     * @param fileId External file ID
     * @param projectId Target project ID
     */
    fun importFile(fileId: String, projectId: String) {
        viewModelScope.launch {
            val file = _files.value.find { it.id == fileId } ?: return@launch

            val result = fileImportRepository.importFileToProject(
                externalFile = file,
                targetProjectId = projectId
            )

            when (result) {
                is FileImportRepository.ImportResult.Success -> {
                    // TODO: implement markAsImported in repository
                    // externalFileRepository.markAsImported(fileId)
                    android.util.Log.d(TAG, "File imported successfully: ${result.projectFile.id}")
                }
                is FileImportRepository.ImportResult.Failure -> {
                    android.util.Log.e(TAG, "Error importing file", result.error.cause)
                }
            }
        }
    }

    /**
     * Refresh file list and statistics
     */
    fun refresh() {
        if (_permissionGranted.value) {
            startScan()
        } else {
            checkPermissions()
        }
    }

    /**
     * Clear search and filters
     */
    fun clearFilters() {
        _searchQuery.value = ""
        _selectedCategory.value = null
    }

    /**
     * Internal filter state for combining flows
     */
    private data class FilterState(
        val query: String,
        val category: FileCategory?,
        val sortBy: SortBy,
        val sortDirection: SortDirection
    )
}
