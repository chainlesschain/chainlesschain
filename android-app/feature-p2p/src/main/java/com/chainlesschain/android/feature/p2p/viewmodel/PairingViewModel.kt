package com.chainlesschain.android.feature.p2p.viewmodel

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.core.e2ee.session.PersistentSessionManager
import com.chainlesschain.android.core.p2p.connection.P2PConnectionManager
import com.chainlesschain.android.core.p2p.model.P2PDevice
import com.chainlesschain.android.feature.p2p.ui.PairingState
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * 设备配对 ViewModel
 *
 * 管理设备配对的完整流程
 */
@HiltViewModel
class PairingViewModel @Inject constructor(
    private val sessionManager: PersistentSessionManager,
    private val connectionManager: P2PConnectionManager,
    private val savedStateHandle: SavedStateHandle
) : ViewModel() {

    private val _pairingState = MutableStateFlow<PairingState>(PairingState.Initializing)
    val pairingState: StateFlow<PairingState> = _pairingState.asStateFlow()

    private val _device = MutableStateFlow<P2PDevice?>(null)
    val device: StateFlow<P2PDevice?> = _device.asStateFlow()

    private var currentDeviceId: String? = null

    init {
        // Get deviceId from navigation arguments
        savedStateHandle.get<String>("deviceId")?.let { deviceId ->
            currentDeviceId = deviceId
            startPairing(deviceId)
        }
    }

    /**
     * 开始配对流程
     */
    fun startPairing(deviceId: String) {
        viewModelScope.launch {
            try {
                currentDeviceId = deviceId

                // Stage 1: Initializing
                _pairingState.value = PairingState.Initializing
                delay(1000) // Simulate initialization

                // Stage 2: Exchanging Keys
                exchangeKeys()

                // Stage 3: Verifying Identity
                _pairingState.value = PairingState.VerifyingIdentity(
                    onContinue = {
                        completeVerification()
                    }
                )

            } catch (e: Exception) {
                _pairingState.value = PairingState.Failed(
                    error = e.message ?: "未知错误"
                )
            }
        }
    }

    /**
     * 交换密钥
     */
    private suspend fun exchangeKeys() {
        try {
            val deviceId = currentDeviceId ?: throw IllegalStateException("Device ID is null")

            // Simulate key exchange with progress updates
            for (progress in 0..100 step 10) {
                _pairingState.value = PairingState.ExchangingKeys(progress / 100f)
                delay(200)
            }

            // Get the pre-key bundle from session manager
            val preKeyBundle = sessionManager.getPreKeyBundle()

            // Create session using the pre-key bundle
            // This is simplified - in practice would need peer's pre-key bundle
            // For now, just mark as complete after key exchange simulation

        } catch (e: Exception) {
            throw Exception("密钥交换失败: ${e.message}")
        }
    }

    /**
     * 完成验证
     */
    private fun completeVerification() {
        viewModelScope.launch {
            try {
                // Mark pairing as completed
                _pairingState.value = PairingState.Completed(
                    onDone = {
                        // Navigation handled by UI
                    }
                )
            } catch (e: Exception) {
                _pairingState.value = PairingState.Failed(
                    error = "验证失败: ${e.message}"
                )
            }
        }
    }

    /**
     * 取消配对
     */
    fun cancelPairing() {
        viewModelScope.launch {
            currentDeviceId?.let { deviceId ->
                try {
                    // Clean up any partial session
                    sessionManager.deleteSession(deviceId)
                    connectionManager.disconnectDevice(deviceId)
                } catch (e: Exception) {
                    // Ignore cleanup errors
                }
            }
        }
    }

    /**
     * 重试配对
     */
    fun retryPairing() {
        currentDeviceId?.let { deviceId ->
            startPairing(deviceId)
        }
    }

    override fun onCleared() {
        super.onCleared()
        // Clean up resources
        viewModelScope.launch {
            if (_pairingState.value is PairingState.Failed ||
                _pairingState.value is PairingState.Initializing
            ) {
                cancelPairing()
            }
        }
    }
}

/**
 * 会话密钥数据
 */
data class SessionKeys(
    val sharedSecret: ByteArray,
    val ephemeralKey: ByteArray,
    val associatedData: ByteArray
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (javaClass != other?.javaClass) return false

        other as SessionKeys

        if (!sharedSecret.contentEquals(other.sharedSecret)) return false
        if (!ephemeralKey.contentEquals(other.ephemeralKey)) return false
        if (!associatedData.contentEquals(other.associatedData)) return false

        return true
    }

    override fun hashCode(): Int {
        var result = sharedSecret.contentHashCode()
        result = 31 * result + ephemeralKey.contentHashCode()
        result = 31 * result + associatedData.contentHashCode()
        return result
    }
}
