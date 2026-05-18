package com.chainlesschain.android.update

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * APK 更新流程协调 ViewModel
 *
 * 状态机：Idle → Checking → (Available | UpToDate | Error) → (用户确认) → Downloading → Done
 */
@HiltViewModel
class UpdateViewModel @Inject constructor(
    private val checker: UpdateChecker,
    private val installer: UpdateInstaller
) : ViewModel() {

    private val _state = MutableStateFlow<UpdateState>(UpdateState.Idle)
    val state: StateFlow<UpdateState> = _state.asStateFlow()

    val installerProgress: StateFlow<UpdateInstaller.DownloadProgress> = installer.progress

    /** 用户主动点"检查更新" */
    fun checkForUpdates(silent: Boolean = false) {
        if (_state.value is UpdateState.Checking) return
        viewModelScope.launch {
            if (!silent) _state.value = UpdateState.Checking
            val result = checker.check()
            _state.value = if (result == null) {
                UpdateState.UpToDate(silent)
            } else {
                UpdateState.Available(result)
            }
        }
    }

    /** 用户在 dialog 上点"下载安装" */
    fun confirmDownload() {
        val avail = (_state.value as? UpdateState.Available)?.update ?: return
        installer.startDownload(avail)
    }

    /** MainActivity 收到 DOWNLOAD_COMPLETE broadcast 时调 */
    fun onDownloadComplete(downloadId: Long) {
        installer.installCompletedApk(downloadId)
    }

    fun installerCanInstall(): Boolean = installer.canInstallApks()

    fun dismiss() {
        _state.value = UpdateState.Idle
        installer.reset()
    }

    sealed class UpdateState {
        data object Idle : UpdateState()
        data object Checking : UpdateState()
        data class Available(val update: UpdateChecker.AvailableUpdate) : UpdateState()
        data class UpToDate(val silent: Boolean) : UpdateState()
        data class Error(val message: String) : UpdateState()
    }
}
