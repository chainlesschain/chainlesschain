package com.chainlesschain.android.remote.session

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
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
        runCatching {
            store.savePendingPairing(uri)
            client.connect(uri)
        }.onFailure { _uiState.update { state -> state.copy(error = it.message) } }
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
}
