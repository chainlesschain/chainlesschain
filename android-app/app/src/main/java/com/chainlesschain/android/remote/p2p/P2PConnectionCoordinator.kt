package com.chainlesschain.android.remote.p2p

import com.chainlesschain.android.R
import com.chainlesschain.android.remote.webrtc.DiscoveredPeer
import com.chainlesschain.android.remote.webrtc.P2PConnectionState
import com.chainlesschain.android.remote.webrtc.SignalingDiscoveryService
import com.chainlesschain.android.remote.webrtc.WebRTCClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
import timber.log.Timber
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Overall P2P connection lifecycle state
 */
enum class P2PState {
    IDLE,
    DISCOVERING,
    CONNECTING,
    CONNECTED,
    ERROR
}

/**
 * Lightweight coordinator that encapsulates the full P2P connection lifecycle:
 * discover → connect → message send/receive → disconnect.
 */
@Singleton
class P2PConnectionCoordinator @Inject constructor(
    @dagger.hilt.android.qualifiers.ApplicationContext private val context: android.content.Context,
    private val webRTCClient: WebRTCClient,
    private val discoveryService: SignalingDiscoveryService
) {
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    private val _state = MutableStateFlow(P2PState.IDLE)
    val state: StateFlow<P2PState> = _state.asStateFlow()

    /** Detailed WebRTC-level connection state */
    val webrtcConnectionState: StateFlow<P2PConnectionState> = webRTCClient.connectionState

    /** Messages received from the data channel */
    val messages: SharedFlow<String> = webRTCClient.messages

    private val _connectedPeerId = MutableStateFlow<String?>(null)
    val connectedPeerId: StateFlow<String?> = _connectedPeerId.asStateFlow()

    private var localPeerId: String = generateLocalPeerId()

    /**
     * Discover desktop peers via the signaling server.
     */
    suspend fun discoverDesktopPeers(timeoutMs: Long = 3000): List<DiscoveredPeer> = withContext(Dispatchers.IO) {
        _state.value = P2PState.DISCOVERING
        try {
            val result = discoveryService.discoverPeers(timeoutMs)
            _state.value = P2PState.IDLE
            result.getOrDefault(emptyList())
        } catch (e: Exception) {
            Timber.e(e, "Discovery failed")
            _state.value = P2PState.ERROR
            emptyList()
        }
    }

    /**
     * Connect to a specific peer via WebRTC.
     */
    suspend fun connectToPeer(targetPeerId: String): Result<Unit> = withContext(Dispatchers.IO) {
        Timber.i("========================================")
        Timber.i("[Coordinator] connectToPeer 开始")
        Timber.i("[Coordinator] 目标 peerId: $targetPeerId")
        Timber.i("[Coordinator] 本地 peerId: $localPeerId")
        Timber.i("========================================")

        _state.value = P2PState.CONNECTING
        try {
            Timber.i("[Coordinator] 正在初始化 WebRTC...")
            webRTCClient.initialize()
            Timber.i("[Coordinator] ✓ WebRTC 初始化完成")

            Timber.i("[Coordinator] 正在连接到 $targetPeerId...")
            val result = webRTCClient.connect(targetPeerId, localPeerId)

            if (result.isSuccess) {
                _state.value = P2PState.CONNECTED
                _connectedPeerId.value = targetPeerId
                Timber.i("[Coordinator] ✓ 连接成功: $targetPeerId")
            } else {
                _state.value = P2PState.ERROR
                val error = result.exceptionOrNull()?.message ?: context.getString(R.string.error_unknown)
                Timber.e("[Coordinator] ✗ 连接失败: $error")
            }
            result
        } catch (e: Exception) {
            Timber.e(e, "[Coordinator] ✗ connectToPeer 异常: ${e.message}")
            _state.value = P2PState.ERROR
            Result.failure(e)
        }
    }

    /**
     * Send a message via the WebRTC data channel.
     */
    fun sendMessage(message: String): Result<Unit> {
        return try {
            webRTCClient.sendMessage(message)
            Result.success(Unit)
        } catch (e: Exception) {
            Timber.e(e, "Send message failed")
            Result.failure(e)
        }
    }

    /**
     * Disconnect from the current peer.
     */
    fun disconnect() {
        webRTCClient.disconnect()
        _connectedPeerId.value = null
        _state.value = P2PState.IDLE
        Timber.d("Disconnected")
    }

    /**
     * Reset local peerId (e.g., for a fresh connection attempt).
     */
    fun resetLocalPeerId() {
        localPeerId = generateLocalPeerId()
    }

    fun getLocalPeerId(): String = localPeerId

    private fun generateLocalPeerId(): String {
        return "mobile-${UUID.randomUUID().toString().take(8)}"
    }
}
