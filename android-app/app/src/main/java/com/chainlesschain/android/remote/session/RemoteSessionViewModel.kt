package com.chainlesschain.android.remote.session

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.agent.protocol.generated.ApprovalDecision
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
    // Try FCM first (overseas / Pixel / Samsung), then domestic ROMs (vivo,
    // OPPO, Xiaomi, Huawei); the first channel that yields a token rides in the
    // encrypted pair.join. Huawei's blocking getToken is last (offloaded to IO).
    private val pushTokenResolver = RemoteSessionPushTokenResolver(
        listOf(
            FcmTokenProvider(),
            VivoTokenProvider(application),
            OppoTokenProvider(),
            XiaomiTokenProvider(application),
            HuaweiTokenProvider(application),
        ),
    )
    private val _uiState = MutableStateFlow(RemoteSessionUiState())
    val uiState: StateFlow<RemoteSessionUiState> = _uiState

    init {
        // Let a FirebaseMessagingService onNewToken reach this live client.
        RemoteSessionPushBridge.activeClient = client
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
                if (isRemoteApprovalRequest(event)) {
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
                // Best-effort: attach a vendor push token BEFORE connecting so it
                // rides in the encrypted pair.join and the host can wake this
                // device for approvals while backgrounded. Times out fast; no
                // token (all SDKs absent / slow) degrades to relay + local notice.
                val resolved = withTimeoutOrNull(TOKEN_TIMEOUT_MS) {
                    pushTokenResolver.resolve()
                }
                if (resolved != null) {
                    client.setPushCredentials(resolved.token, resolved.provider)
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

    fun approve(request: JSONObject, approved: Boolean) {
        respondToApproval(
            request,
            if (approved) ApprovalDecision.AcceptOnce else ApprovalDecision.Decline("user-declined"),
        )
    }

    fun isApprovalPending(request: JSONObject): Boolean =
        isRemoteApprovalRequest(request) &&
            client.isApprovalPending(remoteApprovalRequestId(request))

    fun approveForTurn(request: JSONObject) {
        val permissions = reviewedApprovalPermissions(request)
        if (permissions == null) {
            rejectUnreviewableGrant()
            return
        }
        respondToApproval(request, ApprovalDecision.AcceptForTurn(permissions), permissions)
    }

    fun approveForSession(request: JSONObject) {
        val permissions = reviewedApprovalPermissions(request)
        if (permissions == null) {
            rejectUnreviewableGrant()
            return
        }
        respondToApproval(request, ApprovalDecision.AcceptForSession(permissions), permissions)
    }

    private fun respondToApproval(
        request: JSONObject,
        decision: ApprovalDecision,
        reviewedPermissions: List<com.chainlesschain.agent.protocol.generated.PermissionGrant>? = null,
    ) {
        val requestId = remoteApprovalRequestId(request)
        if (requestId.isBlank()) return
        val fingerprint = request.optString("fingerprint").takeIf { it.isNotBlank() }
        val binding = request.optString("binding").takeIf { it.isNotBlank() }
        val revision = request.opt("revision").takeUnless { it == null || it == JSONObject.NULL }
        if (
            client.resolveApproval(
                requestId = requestId,
                decision = decision,
                fingerprint = fingerprint,
                binding = binding,
                revision = revision,
                reviewedPermissions = reviewedPermissions,
            )
        ) {
            notifier.cancel(requestId)
        } else {
            _uiState.update {
                it.copy(error = "Approval request binding is incomplete or the session is disconnected")
            }
        }
    }

    private fun rejectUnreviewableGrant() {
        _uiState.update {
            it.copy(error = "Persistent approval requires a valid, reviewable permission list")
        }
    }

    fun interrupt() {
        client.interrupt()
    }

    fun disconnect() {
        client.disconnect()
        store.clear()
    }

    override fun onCleared() {
        if (RemoteSessionPushBridge.activeClient === client) {
            RemoteSessionPushBridge.activeClient = null
        }
        client.disconnect()
        super.onCleared()
    }

    private companion object {
        // Vendor push token resolution is normally cached + instant; cap it so
        // pairing is never blocked on a slow network.
        const val TOKEN_TIMEOUT_MS = 3_000L
    }
}
