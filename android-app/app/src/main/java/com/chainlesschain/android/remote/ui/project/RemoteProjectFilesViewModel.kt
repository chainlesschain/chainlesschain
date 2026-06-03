package com.chainlesschain.android.remote.ui.project

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.remote.commands.ProjectCommands
import com.chainlesschain.android.remote.commands.RemoteProjectFileFull
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import timber.log.Timber
import javax.inject.Inject

/**
 * Sub-phase 7.5 (2026-05-17): RemoteProjectFilesScreen 的 VM — PC 端项目文件 CRUD。
 *
 * 与 [com.chainlesschain.android.feature.project.viewmodel.ProjectViewModel]
 * 的本地 Room 路径独立：完全 RPC，所有操作直接打到桌面 SQLite。
 */
@HiltViewModel
class RemoteProjectFilesViewModel @Inject constructor(
    private val projectCommands: ProjectCommands,
) : ViewModel() {

    sealed class State {
        object Idle : State()
        object Loading : State()
        data class Loaded(val files: List<RemoteProjectFileFull>) : State()
        data class Error(val message: String) : State()
    }

    private val _state = MutableStateFlow<State>(State.Idle)
    val state: StateFlow<State> = _state.asStateFlow()

    private val _busy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = _busy.asStateFlow()

    fun load(projectId: String) {
        _state.value = State.Loading
        viewModelScope.launch {
            try {
                val r = projectCommands.listFiles(projectId).getOrNull()
                if (r == null) {
                    _state.value = State.Error("无法连接桌面端")
                } else {
                    _state.value = State.Loaded(r.files)
                }
            } catch (e: Exception) {
                Timber.e(e, "[RemoteFilesVM] load failed")
                _state.value = State.Error(e.message ?: "加载失败")
            }
        }
    }

    fun createFile(projectId: String, filePath: String, content: String, onSuccess: () -> Unit) {
        _busy.value = true
        viewModelScope.launch {
            try {
                val r = projectCommands.createFile(projectId, filePath, content).getOrNull()
                if (r?.id != null && r.error == null) {
                    onSuccess()
                    load(projectId)
                } else {
                    _state.value = State.Error(r?.error ?: "创建失败")
                }
            } finally {
                _busy.value = false
            }
        }
    }

    fun createFolder(projectId: String, folderPath: String, onSuccess: () -> Unit) {
        _busy.value = true
        viewModelScope.launch {
            try {
                val r = projectCommands.createFolder(projectId, folderPath).getOrNull()
                if (r?.id != null && r.error == null) {
                    onSuccess()
                    load(projectId)
                } else {
                    _state.value = State.Error(r?.error ?: "创建失败")
                }
            } finally {
                _busy.value = false
            }
        }
    }

    fun delete(projectId: String, fileId: String) {
        _busy.value = true
        viewModelScope.launch {
            try {
                projectCommands.deleteFile(fileId).getOrNull()
                load(projectId)
            } finally {
                _busy.value = false
            }
        }
    }

    suspend fun fetchContent(fileId: String): String? {
        return projectCommands.getFile(fileId).getOrNull()?.content
    }

    fun saveContent(projectId: String, fileId: String, content: String, onSuccess: () -> Unit) {
        _busy.value = true
        viewModelScope.launch {
            try {
                val r = projectCommands.writeFile(fileId, content).getOrNull()
                if (r?.id != null) {
                    onSuccess()
                    load(projectId)
                }
            } finally {
                _busy.value = false
            }
        }
    }
}
