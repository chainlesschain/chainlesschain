package com.chainlesschain.android.remote.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.remote.p2p.P2PConnectionCoordinator
import com.chainlesschain.android.remote.p2p.P2PState
import com.chainlesschain.android.remote.webrtc.DiscoveredPeer
import com.chainlesschain.android.remote.webrtc.P2PConnectionState
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

@HiltViewModel
class P2PConnectionViewModel @Inject constructor(
    private val coordinator: P2PConnectionCoordinator
) : ViewModel() {

    /** High-level coordinator state */
    val coordinatorState: StateFlow<P2PState> = coordinator.state

    /** Detailed WebRTC connection state */
    val webrtcState: StateFlow<P2PConnectionState> = coordinator.webrtcConnectionState

    /** Currently connected peer ID */
    val connectedPeerId: StateFlow<String?> = coordinator.connectedPeerId

    private val _discoveredPeers = MutableStateFlow<List<DiscoveredPeer>>(emptyList())
    val discoveredPeers: StateFlow<List<DiscoveredPeer>> = _discoveredPeers.asStateFlow()

    private val _isScanning = MutableStateFlow(false)
    val isScanning: StateFlow<Boolean> = _isScanning.asStateFlow()

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()

    private val _events = MutableSharedFlow<P2PEvent>()
    val events: SharedFlow<P2PEvent> = _events.asSharedFlow()

    /** Messages received via the data channel */
    val messages: SharedFlow<String> = coordinator.messages

    fun discover() {
        viewModelScope.launch {
            _isScanning.value = true
            _error.value = null
            try {
                val peers = coordinator.discoverDesktopPeers()
                _discoveredPeers.value = peers
                if (peers.isEmpty()) {
                    _events.emit(P2PEvent.NoPeersFound)
                }
            } catch (e: Exception) {
                Timber.e(e, "Discovery failed")
                _error.value = e.message ?: "Discovery failed"
            } finally {
                _isScanning.value = false
            }
        }
    }

    fun connect(peer: DiscoveredPeer) {
        viewModelScope.launch {
            _error.value = null
            try {
                val result = coordinator.connectToPeer(peer.peerId)
                if (result.isSuccess) {
                    _events.emit(P2PEvent.Connected(peer.peerId))
                } else {
                    val msg = result.exceptionOrNull()?.message ?: "Connection failed"
                    _error.value = msg
                    _events.emit(P2PEvent.ConnectionFailed(msg))
                }
            } catch (e: Exception) {
                Timber.e(e, "Connect failed")
                _error.value = e.message ?: "Connection failed"
                _events.emit(P2PEvent.ConnectionFailed(e.message ?: "Connection failed"))
            }
        }
    }

    fun send(text: String) {
        val result = coordinator.sendMessage(text)
        if (result.isFailure) {
            _error.value = result.exceptionOrNull()?.message ?: "Send failed"
        }
    }

    fun disconnect() {
        coordinator.disconnect()
        viewModelScope.launch {
            _events.emit(P2PEvent.Disconnected)
        }
    }

    fun clearError() {
        _error.value = null
    }
}

sealed class P2PEvent {
    data class Connected(val peerId: String) : P2PEvent()
    data class ConnectionFailed(val reason: String) : P2PEvent()
    data object Disconnected : P2PEvent()
    data object NoPeersFound : P2PEvent()
}
