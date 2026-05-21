package com.chainlesschain.android.remote.ui.personalDataHub

import androidx.compose.runtime.Immutable
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.pdh.LocalCcRunner
import com.chainlesschain.android.pdh.LocalSystemDataSnapshotter
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import timber.log.Timber
import javax.inject.Inject

/**
 * Plan A v0.1 — driver for the "本机数据" tab inside PersonalDataHubScreen.
 *
 * Two-step pipeline:
 *  1. [LocalSystemDataSnapshotter] reads ContentResolver (contacts) +
 *     PackageManager (apps) in-process (the Android JVM owns these APIs)
 *     and writes a snapshot JSON to filesDir/.chainlesschain/staging/.
 *  2. [LocalCcRunner] spawns `cc hub sync-adapter system-data-android
 *     --input <path> --json` and parses the structured report.
 *
 * The UI surfaces a single "刷新" button that runs both steps and shows
 * the resulting counts. Permission requesting (READ_CONTACTS) is delegated
 * to the screen — the VM only reports whether permission was granted at
 * snapshot time.
 */
@HiltViewModel
class HubLocalViewModel @Inject constructor(
    private val snapshotter: LocalSystemDataSnapshotter,
    private val ccRunner: LocalCcRunner,
) : ViewModel() {

    @Immutable
    data class UiState(
        val isLoading: Boolean = false,
        val phase: String? = null,
        val lastSnapshotAt: Long? = null,
        val contactsCount: Int = 0,
        val appsCount: Int = 0,
        val ingested: Int = 0,
        val contactsPermissionGranted: Boolean = false,
        val errorMessage: String? = null,
    )

    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state.asStateFlow()

    init {
        _state.update { it.copy(contactsPermissionGranted = snapshotter.hasContactsPermission()) }
    }

    /**
     * Re-read the runtime permission grant from system settings. Called by
     * the screen after [androidx.activity.compose.rememberLauncherForActivityResult]
     * completes — the launcher result is also surfaced to us via [refresh]
     * but if the user changes the grant in Settings and comes back, we want
     * to see that without taking a sync action.
     */
    fun refreshPermissionState() {
        _state.update { it.copy(contactsPermissionGranted = snapshotter.hasContactsPermission()) }
    }

    fun refresh() {
        if (_state.value.isLoading) return
        viewModelScope.launch {
            _state.update {
                it.copy(
                    isLoading = true,
                    phase = "正在读取通讯录与已装应用…",
                    errorMessage = null,
                )
            }
            val snapshot = try {
                snapshotter.snapshotAll()
            } catch (e: Exception) {
                Timber.w(e, "HubLocalViewModel: snapshot failed")
                _state.update {
                    it.copy(
                        isLoading = false,
                        phase = null,
                        errorMessage = "快照失败: ${e.message ?: e.javaClass.simpleName}",
                    )
                }
                return@launch
            }

            _state.update {
                it.copy(
                    phase = "正在写入本地数据库…",
                    contactsCount = snapshot.contactsCount,
                    appsCount = snapshot.appsCount,
                    lastSnapshotAt = snapshot.snapshottedAt,
                    contactsPermissionGranted = snapshot.contactsPermissionGranted,
                )
            }

            when (val r = ccRunner.syncAdapter(
                adapterName = "system-data-android",
                inputPath = snapshot.snapshotPath,
            )) {
                is LocalCcRunner.CcResult.Ok -> {
                    _state.update {
                        it.copy(
                            isLoading = false,
                            phase = null,
                            ingested = r.report.ingested,
                            errorMessage = if (r.report.status != "ok" && r.report.error != null) {
                                "同步状态: ${r.report.status} (${r.report.error})"
                            } else null,
                        )
                    }
                }
                is LocalCcRunner.CcResult.Failed -> {
                    Timber.w(
                        "HubLocalViewModel: cc syncAdapter failed: %s (exit=%s)",
                        r.reason,
                        r.exitCode,
                    )
                    _state.update {
                        it.copy(
                            isLoading = false,
                            phase = null,
                            errorMessage = "写入本地数据库失败: ${r.reason}",
                        )
                    }
                }
            }
        }
    }
}
