package com.chainlesschain.android.presentation.screens

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.pdh.LocalCcRunner
import com.chainlesschain.android.pdh.llm.LlmPreferences
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import timber.log.Timber
import javax.inject.Inject

/**
 * §2.1 A3.5 — drives the "AI 后端" Settings section toggle for "Use Android
 * local model as default for cc ask".
 *
 * Source of truth: [LlmPreferences] (EncryptedSharedPreferences). On toggle
 * change we also fire-and-forget `cc config set llm.preferAndroidLocal <bool>`
 * via [LocalCcRunner] so the cc-side persistent config matches — covers
 * terminal-side `cc ask` invocations and future cc subprocess calls.
 *
 * Sync status surfaces as [SyncState] for the UI (so a failed cc-config push
 * is visible to the user rather than silently dropping). The in-memory flag
 * is updated optimistically; reconciliation is best-effort.
 */
@HiltViewModel
class AiBackendSettingsViewModel @Inject constructor(
    private val llmPreferences: LlmPreferences,
    private val ccRunner: LocalCcRunner,
) : ViewModel() {

    enum class SyncState { IDLE, SYNCING, OK, FAILED }

    data class UiState(
        val preferAndroidLocal: Boolean,
        val lanLlmBaseUrl: String?,
        val lanLlmUrlError: String?,
        val syncState: SyncState,
        val syncErrorMessage: String?,
    )

    private val _syncState = MutableStateFlow(SyncState.IDLE)
    private val _syncErrorMessage = MutableStateFlow<String?>(null)
    private val _lanLlmUrlError = MutableStateFlow<String?>(null)

    val uiState: StateFlow<UiState> = combine(
        llmPreferences.preferAndroidLocal,
        llmPreferences.lanLlmBaseUrl,
        _syncState,
        _syncErrorMessage,
        _lanLlmUrlError,
    ) { prefer, lanUrl, sync, syncErr, urlErr ->
        UiState(
            preferAndroidLocal = prefer,
            lanLlmBaseUrl = lanUrl,
            lanLlmUrlError = urlErr,
            syncState = sync,
            syncErrorMessage = syncErr,
        )
    }.stateIn(
        viewModelScope,
        SharingStarted.WhileSubscribed(5_000L),
        UiState(
            preferAndroidLocal = llmPreferences.getPreferAndroidLocal(),
            lanLlmBaseUrl = llmPreferences.getLanLlmBaseUrl(),
            lanLlmUrlError = null,
            syncState = SyncState.IDLE,
            syncErrorMessage = null,
        ),
    )

    /**
     * User flipped the toggle. Updates the local flag immediately (so the UI
     * Switch reflects the new state without lag) and kicks off a background
     * cc-config sync. If the sync fails the syncState transitions to FAILED
     * with a human-readable message; the local flag stays at the new value
     * (the user's choice wins; the cc-side config is best-effort).
     */
    fun setPreferAndroidLocal(value: Boolean) {
        llmPreferences.setPreferAndroidLocal(value)
        _syncErrorMessage.value = null
        _syncState.value = SyncState.SYNCING
        viewModelScope.launch {
            val result = ccRunner.setCcConfigValue(
                key = "llm.preferAndroidLocal",
                value = if (value) "true" else "false",
            )
            if (result.isSuccess) {
                _syncState.value = SyncState.OK
            } else {
                val err = result.exceptionOrNull()
                Timber.w(err, "AiBackendSettingsViewModel: cc config sync failed")
                _syncErrorMessage.value = err?.message ?: "unknown"
                _syncState.value = SyncState.FAILED
            }
        }
    }

    /**
     * Update the LAN Ollama base URL. Validates http(s)://host[:port] shape and
     * surfaces a UI-friendly error if invalid. Empty string clears the value.
     * No cc-config sync — LAN URL is consumed by the in-APK ask flow only.
     */
    fun setLanLlmBaseUrl(raw: String) {
        val trimmed = raw.trim()
        if (trimmed.isEmpty()) {
            _lanLlmUrlError.value = null
            llmPreferences.setLanLlmBaseUrl(null)
            return
        }
        if (!LAN_URL_PATTERN.matches(trimmed)) {
            _lanLlmUrlError.value = "格式：http(s)://host[:port]"
            return
        }
        _lanLlmUrlError.value = null
        llmPreferences.setLanLlmBaseUrl(trimmed)
    }

    companion object {
        // Permissive shape check: scheme + host (letters/digits/dots/dashes) +
        // optional :port + optional /path. cc OllamaClient does the real reach
        // test at first ask; this is just to catch obvious typos like missing scheme.
        private val LAN_URL_PATTERN =
            Regex("^https?://[A-Za-z0-9.\\-]+(:\\d{1,5})?(/.*)?$")
    }
}
