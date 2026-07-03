package com.chainlesschain.android.remote.session

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.OkHttpClient
import org.json.JSONObject

data class RemoteSessionUiState(
    val status: RemoteSessionStatus = RemoteSessionStatus.IDLE,
    val events: List<JSONObject> = emptyList(),
    val error: String? = null,
)

class RemoteSessionViewModel(application: Application) : AndroidViewModel(application) {
    private val client = RemoteSessionClient(OkHttpClient.Builder().build())
    private val store = RemoteSessionStore(application)
    private val notifier = RemoteSessionNotifier(application)
    private val fcmTokenProvider = FcmTokenProvider()
    private val _uiState = MutableStateFlow(RemoteSessionUiState())
    val uiState: StateFlow<RemoteSessionUiState> = _uiState

    init {
        viewModelScope.launch {
            client.status.collect { status ->
                if (status == RemoteSessionStatus.CONNECTED) {
                    val pairing = client.currentPairing
                    val peerId = client.localPeerId
                    if (pairing != null && peerId != null) store.saveMetadata(pairing, peerId)
                }
                if (status == RemoteSessionStatus.REVOKED) store.clear()
                _uiState.update { it.copy(status = status) }
            }
        }
        viewModelScope.launch {
            client.events.collect { event ->
                if (event.optString("type").contains("approval")) {
                    notifier.notifyApproval(event)
                }
                _uiState.update { it.copy(events = (it.events + event).takeLast(200)) }
            }
        }
        viewModelScope.launch {
            client.errors.collect { error -> _uiState.update { it.copy(error = error) } }
        }
    }

    fun pair(uri: String) {
        viewModelScope.launch {
            runCatching {
                store.savePendingPairing(uri)
                // Best-effort: attach an FCM token BEFORE connecting so it rides
                // in the encrypted pair.join and the host can wake this device
                // for approvals while backgrounded. Times out fast; a null token
                // (Firebase absent / slow) degrades to relay + local notice.
                val token = withTimeoutOrNull(TOKEN_TIMEOUT_MS) {
                    fcmTokenProvider.getToken()
                }
                if (!token.isNullOrBlank()) {
                    client.setPushCredentials(token, FcmTokenProvider.PROVIDER)
                }
                client.connect(uri)
            }.onFailure { cause ->
                _uiState.update { state -> state.copy(error = cause.message) }
            }
        }
    }

    fun sendPrompt(content: String) {
        if (content.isNotBlank() && !client.sendPrompt(content.trim())) {
            _uiState.update { it.copy(error = "Remote Session is not connected") }
        }
    }

    fun approve(requestId: String, approved: Boolean) {
        client.resolveApproval(requestId, approved)
        notifier.cancel(requestId)
    }

    fun interrupt() {
        client.interrupt()
    }

    fun disconnect() {
        client.disconnect()
        store.clear()
    }

    override fun onCleared() {
        client.disconnect()
        super.onCleared()
    }

    private companion object {
        // FCM token fetch is normally cached + instant; cap it so pairing is
        // never blocked on a slow network.
        const val TOKEN_TIMEOUT_MS = 3_000L
    }
}
