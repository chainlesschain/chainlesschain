package com.chainlesschain.android.remote.ui.personalDataHub

import androidx.compose.runtime.Immutable
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.remote.commands.AuditRow
import com.chainlesschain.android.remote.commands.EventDetailResponse
import com.chainlesschain.android.remote.commands.PersonalDataHubCommands
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import timber.log.Timber
import javax.inject.Inject

@Immutable
data class HubAuditUiState(
    val rows: List<AuditRow> = emptyList(),
    val isLoading: Boolean = false,
    val errorMessage: String? = null,
    val actionFilter: String? = null,
    // Plan A v0.1 — bumped 50 → 500 (a single adapter sync can emit 1300+
    // audit rows in seconds; 50 buries everything else). `loadMore()` adds
    // PAGE_SIZE on each tap so power-users can drill back without RPC limit
    // explosion.
    val limit: Int = DEFAULT_AUDIT_LIMIT,
    // Phase 14.3.3.b — eventId deep-link state.
    // `activeEventId` is the row clicked (set on tap, cleared on dismiss);
    // `activeEventDetail` is the resolved fetch result (lags by 1 RPC).
    // `isEventDetailLoading` lets the sheet show a spinner while invoke is
    // in-flight. Stale fetch protection (per parent Phase 14 design doc
    // §7 T12): `currentDetailRequestId` keeps only the latest invoke's
    // response —— faster click on a 2nd row cancels the 1st silently.
    val activeEventId: String? = null,
    val activeEventDetail: EventDetailResponse? = null,
    val isEventDetailLoading: Boolean = false,
    val eventDetailError: String? = null,
    val currentDetailRequestId: Long = 0L,
)

internal const val DEFAULT_AUDIT_LIMIT = 500
internal const val AUDIT_LIMIT_PAGE_SIZE = 500
internal const val MAX_AUDIT_LIMIT = 5000

@HiltViewModel
class HubAuditViewModel @Inject constructor(
    private val hub: PersonalDataHubCommands
) : ViewModel() {

    private val _uiState = MutableStateFlow(HubAuditUiState())
    val uiState: StateFlow<HubAuditUiState> = _uiState.asStateFlow()

    init { reload() }

    fun setActionFilter(action: String?) {
        _uiState.update { it.copy(actionFilter = action, limit = DEFAULT_AUDIT_LIMIT) }
        reload()
    }

    /**
     * Plan A v0.1 — bump the per-fetch limit by [AUDIT_LIMIT_PAGE_SIZE] up to
     * [MAX_AUDIT_LIMIT], then refetch. UI surfaces a 加载更多 button under
     * the list while `rows.size >= limit` (a heuristic that the source has
     * more — the desktop side has no explicit total). Clamps at
     * MAX_AUDIT_LIMIT so a malicious sync flood can't OOM the RPC.
     */
    fun loadMore() {
        val s = _uiState.value
        if (s.isLoading) return
        val nextLimit = (s.limit + AUDIT_LIMIT_PAGE_SIZE).coerceAtMost(MAX_AUDIT_LIMIT)
        if (nextLimit == s.limit) return
        _uiState.update { it.copy(limit = nextLimit) }
        reload()
    }

    fun reload() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, errorMessage = null) }
            val s = _uiState.value
            hub.recentAudit(action = s.actionFilter, limit = s.limit)
                .onSuccess { resp ->
                    _uiState.update { it.copy(rows = resp.rows, isLoading = false) }
                }
                .onFailure { err ->
                    Timber.w(err, "HubAuditViewModel: recentAudit failed")
                    _uiState.update { it.copy(isLoading = false, errorMessage = err.message) }
                }
        }
    }

    /**
     * Phase 14.3.3.b — 点击 audit row 上的 eventId 触发详情查询。
     *
     * 行为：
     *  - 立即把 `activeEventId` 置为 tapped id（sheet 出现 + spinner）
     *  - 异步 invoke `eventDetail(eventId)`
     *  - 用 `nextRequestId()` 防止用户连点 2 个 eventId 时第 1 个 RPC 回响
     *    覆盖第 2 个的状态（per design §7 T12）
     */
    fun openEventDetail(eventId: String) {
        if (eventId.isBlank()) return
        val requestId = _uiState.value.currentDetailRequestId + 1
        _uiState.update {
            it.copy(
                activeEventId = eventId,
                activeEventDetail = null,
                isEventDetailLoading = true,
                eventDetailError = null,
                currentDetailRequestId = requestId,
            )
        }
        viewModelScope.launch {
            hub.eventDetail(eventId)
                .onSuccess { resp ->
                    if (_uiState.value.currentDetailRequestId != requestId) return@onSuccess
                    _uiState.update {
                        it.copy(
                            activeEventDetail = resp,
                            isEventDetailLoading = false,
                        )
                    }
                }
                .onFailure { err ->
                    Timber.w(err, "HubAuditViewModel: eventDetail($eventId) failed")
                    if (_uiState.value.currentDetailRequestId != requestId) return@onFailure
                    _uiState.update {
                        it.copy(
                            isEventDetailLoading = false,
                            eventDetailError = err.message,
                        )
                    }
                }
        }
    }

    fun closeEventDetail() {
        _uiState.update {
            it.copy(
                activeEventId = null,
                activeEventDetail = null,
                isEventDetailLoading = false,
                eventDetailError = null,
            )
        }
    }
}
