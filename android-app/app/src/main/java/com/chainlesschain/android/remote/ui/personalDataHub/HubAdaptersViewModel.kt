package com.chainlesschain.android.remote.ui.personalDataHub

import androidx.compose.runtime.Immutable
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.remote.commands.AdapterMeta
import com.chainlesschain.android.remote.commands.PersonalDataHubCommands
import com.chainlesschain.android.remote.commands.SyncReport
import com.chainlesschain.android.remote.events.HubSyncEvent
import com.chainlesschain.android.remote.events.HubSyncEventDispatcher
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import timber.log.Timber
import javax.inject.Inject

@Immutable
data class HubAdaptersUiState(
    val adapters: List<AdapterMeta> = emptyList(),
    val isLoading: Boolean = false,
    val syncingAdapter: String? = null,
    val errorMessage: String? = null,
    val lastReport: SyncReport? = null,
    // Phase 14.3 — streaming progress state.
    val syncProgressKind: String? = null,
    val syncProgressPartition: String? = null,
    val syncProgressDetail: Map<String, Long>? = null,
)

sealed class HubAdaptersEvent {
    data class ShowToast(val message: String) : HubAdaptersEvent()
}

@HiltViewModel
class HubAdaptersViewModel @Inject constructor(
    private val hub: PersonalDataHubCommands,
    private val syncDispatcher: HubSyncEventDispatcher,
    private val systemDataCollector: SystemDataLocalCollector,
) : ViewModel() {

    private val _uiState = MutableStateFlow(HubAdaptersUiState())
    val uiState: StateFlow<HubAdaptersUiState> = _uiState.asStateFlow()

    private val _events = MutableSharedFlow<HubAdaptersEvent>()
    val events: SharedFlow<HubAdaptersEvent> = _events.asSharedFlow()

    init {
        reload()
        listenSyncProgress()
    }

    fun reload() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, errorMessage = null) }
            hub.listAdapters()
                .onSuccess { resp ->
                    _uiState.update { it.copy(adapters = resp.adapters, isLoading = false) }
                }
                .onFailure { err ->
                    Timber.w(err, "HubAdaptersViewModel: listAdapters failed")
                    _uiState.update { it.copy(isLoading = false, errorMessage = err.message) }
                }
        }
    }

    /** v0.1 非流式同步 — 一次性 await SyncReport，syncing 期间无中间进度。 */
    fun sync(name: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(syncingAdapter = name, errorMessage = null) }
            hub.syncAdapter(name = name)
                .onSuccess { report ->
                    if (report.isSkipped) {
                        _uiState.update {
                            it.copy(
                                syncingAdapter = null,
                                lastReport = report,
                                errorMessage = null,
                            )
                        }
                        _events.emit(
                            HubAdaptersEvent.ShowToast(
                                "$name 未同步: ${report.failureMessage}"
                            )
                        )
                    } else if (report.isSuccessful) {
                        _uiState.update {
                            it.copy(syncingAdapter = null, lastReport = report)
                        }
                        _events.emit(
                            HubAdaptersEvent.ShowToast(
                                "$name 同步完成 (+${report.totalEntities} 条)"
                            )
                        )
                    } else {
                        _uiState.update {
                            it.copy(
                                syncingAdapter = null,
                                lastReport = report,
                                errorMessage = report.failureMessage,
                            )
                        }
                        _events.emit(
                            HubAdaptersEvent.ShowToast("同步失败: ${report.failureMessage}")
                        )
                    }
                }
                .onFailure { err ->
                    Timber.w(err, "HubAdaptersViewModel: syncAdapter($name) failed")
                    _uiState.update { it.copy(syncingAdapter = null, errorMessage = err.message) }
                    _events.emit(HubAdaptersEvent.ShowToast("同步失败: ${err.message ?: "?"}"))
                }
        }
    }

    /**
     * Phase 14.3 — 流式同步路径。触发 syncAdapterStream + 订阅
     * [HubSyncEventDispatcher] 进度事件，过滤当前 adapter 后更新 UI 文字
     * （connecting → fetching → normalizing → done/error）。
     *
     * 注意：desktop 侧 `route-mobile.js` 中 `sync-adapter-stream` 当前仍 throw
     * "Phase 14.3 will add HubSyncEventDispatcher"。本 ViewModel 是 Android
     * 侧准备好的接收端 — 待 desktop push-to-mobile event 真接通后即可联调。
     */
    fun syncStream(name: String) {
        viewModelScope.launch {
            _uiState.update {
                it.copy(
                    syncingAdapter = name,
                    errorMessage = null,
                    syncProgressKind = "connecting",
                    syncProgressPartition = null,
                    syncProgressDetail = null,
                )
            }
            hub.syncAdapterStream(name = name)
                .onFailure { err ->
                    Timber.w(err, "HubAdaptersViewModel: syncAdapterStream($name) failed")
                    _uiState.update {
                        it.copy(
                            syncingAdapter = null,
                            errorMessage = err.message,
                            syncProgressKind = null,
                        )
                    }
                    _events.emit(HubAdaptersEvent.ShowToast("启动同步失败: ${err.message ?: "?"}"))
                }
        }
    }

    /**
     * Path C — 本机采集 system-data-android 数据并推给桌面入 vault。
     * 与流式 sync 互斥（设 syncingAdapter = "system-data-android"），UI 显示
     * 与既有 streaming 一致的 progress 文案，但走的是单 RPC 一次性 await 模式
     * (snapshot 一般 100KB-2MB，桌面 syncAdapter 同步走完才回，几秒内完成)。
     *
     * 前置：调用方应在屏上完成 READ_CONTACTS runtime permission gate；
     * 这里不再二次 check —— collector 自身在权限缺失时返回空通讯录列表。
     */
    fun collectAndIngestSystemDataAndroid() {
        val name = "system-data-android"
        viewModelScope.launch {
            _uiState.update {
                it.copy(
                    syncingAdapter = name,
                    errorMessage = null,
                    syncProgressKind = "fetching",
                    syncProgressPartition = "采集本机数据",
                    syncProgressDetail = null,
                )
            }
            val snapshot = try {
                systemDataCollector.snapshot()
            } catch (e: Throwable) {
                Timber.w(e, "HubAdaptersViewModel: collector.snapshot() failed")
                _uiState.update {
                    it.copy(
                        syncingAdapter = null,
                        syncProgressKind = null,
                        syncProgressPartition = null,
                        errorMessage = "采集失败: ${e.message ?: "?"}",
                    )
                }
                _events.emit(HubAdaptersEvent.ShowToast("采集失败: ${e.message ?: "?"}"))
                return@launch
            }

            _uiState.update {
                it.copy(
                    syncProgressKind = "normalizing",
                    syncProgressPartition = "上传桌面",
                    syncProgressDetail = mapOf(
                        "contacts" to snapshot.contacts.size.toLong(),
                        "apps" to snapshot.apps.size.toLong(),
                    ),
                )
            }

            hub.ingestSystemDataAndroid(snapshot.toMap())
                .onSuccess { report ->
                    if (report.isSkipped) {
                        _uiState.update {
                            it.copy(
                                syncingAdapter = null,
                                syncProgressKind = null,
                                syncProgressPartition = null,
                                syncProgressDetail = null,
                                lastReport = report,
                                errorMessage = null,
                            )
                        }
                        _events.emit(
                            HubAdaptersEvent.ShowToast(
                                "$name 未同步: ${report.failureMessage}"
                            )
                        )
                    } else if (report.isSuccessful) {
                        _uiState.update {
                            it.copy(
                                syncingAdapter = null,
                                syncProgressKind = null,
                                syncProgressPartition = null,
                                syncProgressDetail = null,
                                lastReport = report,
                            )
                        }
                        _events.emit(
                            HubAdaptersEvent.ShowToast(
                                "$name 同步完成 (+${report.totalEntities} 条)"
                            )
                        )
                    } else {
                        _uiState.update {
                            it.copy(
                                syncingAdapter = null,
                                syncProgressKind = null,
                                syncProgressPartition = null,
                                syncProgressDetail = null,
                                lastReport = report,
                                errorMessage = report.failureMessage,
                            )
                        }
                        _events.emit(
                            HubAdaptersEvent.ShowToast(
                                "同步失败: ${report.failureMessage}"
                            )
                        )
                    }
                }
                .onFailure { err ->
                    Timber.w(err, "HubAdaptersViewModel: ingestSystemDataAndroid failed")
                    _uiState.update {
                        it.copy(
                            syncingAdapter = null,
                            syncProgressKind = null,
                            syncProgressPartition = null,
                            errorMessage = err.message,
                        )
                    }
                    _events.emit(HubAdaptersEvent.ShowToast("同步失败: ${err.message ?: "?"}"))
                }
        }
    }

    private fun listenSyncProgress() {
        viewModelScope.launch {
            syncDispatcher.events.collect { applyProgress(it) }
        }
    }

    private suspend fun applyProgress(ev: HubSyncEvent) {
        // 只处理当前正在 sync 的 adapter（design §5.4 多 adapter 并发场景的隔离）。
        val syncing = _uiState.value.syncingAdapter
        if (syncing != null && syncing != ev.adapter) {
            return
        }
        when (ev.kind) {
            "connecting", "fetching", "normalizing" -> {
                _uiState.update {
                    it.copy(
                        syncProgressKind = ev.kind,
                        syncProgressPartition = ev.partition ?: it.syncProgressPartition,
                        syncProgressDetail = ev.detail ?: it.syncProgressDetail,
                    )
                }
            }
            "sync.retry" -> {
                _uiState.update {
                    it.copy(
                        syncProgressKind = "retrying",
                        syncProgressPartition = ev.error,
                        syncProgressDetail =
                            mapOf(
                                "nextAttempt" to (ev.nextAttempt ?: 0L),
                                "retryCount" to (ev.retryCount ?: 0L),
                                "delayMs" to (ev.delayMs ?: 0L),
                            ),
                    )
                }
            }
            "sync.request_throttled" -> {
                _uiState.update {
                    it.copy(
                        syncProgressKind = "request_throttled",
                        syncProgressPartition = ev.operation ?: ev.reason,
                        syncProgressDetail =
                            mapOf(
                                "delayMs" to (ev.delayMs ?: 0L),
                                "sourceRequestCount" to (ev.sourceRequestCount ?: 0L),
                                "page" to (ev.page ?: 0L),
                            ),
                    )
                }
            }
            "sync.rate_limited" -> {
                _uiState.update {
                    it.copy(
                        syncProgressKind = "rate_limited",
                        syncProgressPartition = ev.reason,
                        syncProgressDetail =
                            mapOf("retryAfterMs" to (ev.retryAfterMs ?: 0L)),
                    )
                }
            }
            "done" -> {
                val report = ev.report
                if (report?.isSkipped == true) {
                    _uiState.update {
                        it.copy(
                            syncingAdapter = null,
                            syncProgressKind = null,
                            syncProgressPartition = null,
                            syncProgressDetail = null,
                            lastReport = report,
                            errorMessage = null,
                        )
                    }
                    _events.emit(
                        HubAdaptersEvent.ShowToast(
                            "${ev.adapter} 未同步: ${report.failureMessage}"
                        )
                    )
                } else if (report != null && !report.isSuccessful) {
                    _uiState.update {
                        it.copy(
                            syncingAdapter = null,
                            syncProgressKind = null,
                            syncProgressPartition = null,
                            syncProgressDetail = null,
                            lastReport = report,
                            errorMessage = report.failureMessage,
                        )
                    }
                    _events.emit(
                        HubAdaptersEvent.ShowToast("同步失败: ${report.failureMessage}")
                    )
                } else {
                    _uiState.update {
                        it.copy(
                            syncingAdapter = null,
                            syncProgressKind = null,
                            syncProgressPartition = null,
                            syncProgressDetail = null,
                            lastReport = report ?: it.lastReport,
                        )
                    }
                    val ingested = report?.totalEntities ?: 0L
                    _events.emit(
                        HubAdaptersEvent.ShowToast(
                            "${ev.adapter} 同步完成 (+$ingested 条)"
                        )
                    )
                }
            }
            "error" -> {
                _uiState.update {
                    it.copy(
                        syncingAdapter = null,
                        syncProgressKind = null,
                        syncProgressPartition = null,
                        syncProgressDetail = null,
                        errorMessage = ev.message ?: "未知错误",
                    )
                }
                _events.emit(HubAdaptersEvent.ShowToast("同步失败: ${ev.message ?: "?"}"))
            }
        }
    }
}
