package com.chainlesschain.android.feature.p2p.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.core.e2ee.session.PersistentSessionManager
import com.chainlesschain.android.core.e2ee.session.SessionInfo
import com.chainlesschain.android.core.e2ee.verification.CompleteVerificationInfo
import com.chainlesschain.android.core.e2ee.verification.VerificationManager
import com.chainlesschain.android.core.p2p.discovery.NSDDeviceDiscovery
import com.chainlesschain.android.core.p2p.model.P2PDevice
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * P2P 设备 ViewModel
 *
 * 管理设备发现、会话和验证
 */
@HiltViewModel
class P2PDeviceViewModel @Inject constructor(
    private val deviceDiscovery: NSDDeviceDiscovery,
    private val sessionManager: PersistentSessionManager,
    private val verificationManager: VerificationManager
) : ViewModel() {

    // 发现的设备
    private val _discoveredDevices = MutableStateFlow<List<P2PDevice>>(emptyList())
    val discoveredDevices: StateFlow<List<P2PDevice>> = _discoveredDevices.asStateFlow()

    // 已连接的设备（有活跃会话）
    private val _connectedDevices = MutableStateFlow<List<DeviceWithSession>>(emptyList())
    val connectedDevices: StateFlow<List<DeviceWithSession>> = _connectedDevices.asStateFlow()

    // UI 状态
    private val _uiState = MutableStateFlow<DeviceUiState>(DeviceUiState.Idle)
    val uiState: StateFlow<DeviceUiState> = _uiState.asStateFlow()

    // 是否正在扫描
    private val _isScanning = MutableStateFlow(false)
    val isScanning: StateFlow<Boolean> = _isScanning.asStateFlow()

    init {
        // 监听活跃会话
        viewModelScope.launch {
            sessionManager.activeSessions.collect { sessions ->
                updateConnectedDevices(sessions)
            }
        }

        // 监听设备发现
        viewModelScope.launch {
            deviceDiscovery.discoveredDevices.collect { devices ->
                _discoveredDevices.value = devices
            }
        }
    }

    /**
     * 开始扫描设备
     */
    fun startScanning() {
        viewModelScope.launch {
            try {
                _isScanning.value = true
                _uiState.value = DeviceUiState.Scanning
                deviceDiscovery.startDiscovery()
            } catch (e: Exception) {
                _uiState.value = DeviceUiState.Error("启动扫描失败: ${e.message}")
                _isScanning.value = false
            }
        }
    }

    /**
     * 停止扫描设备
     */
    fun stopScanning() {
        viewModelScope.launch {
            try {
                deviceDiscovery.stopDiscovery()
                _isScanning.value = false
                _uiState.value = DeviceUiState.Idle
            } catch (e: Exception) {
                _uiState.value = DeviceUiState.Error("停止扫描失败: ${e.message}")
            }
        }
    }

    /**
     * 连接设备
     */
    fun connectDevice(device: P2PDevice) {
        viewModelScope.launch {
            try {
                _uiState.value = DeviceUiState.Connecting(device.deviceId)

                // 这里应该触发实际的连接逻辑
                // 包括交换预密钥包和建立会话
                // 简化版：直接创建会话

                _uiState.value = DeviceUiState.Connected(device.deviceId)
            } catch (e: Exception) {
                _uiState.value = DeviceUiState.Error("连接失败: ${e.message}")
            }
        }
    }

    /**
     * 断开设备连接
     */
    fun disconnectDevice(peerId: String) {
        viewModelScope.launch {
            try {
                sessionManager.deleteSession(peerId)
                _uiState.value = DeviceUiState.Disconnected(peerId)
            } catch (e: Exception) {
                _uiState.value = DeviceUiState.Error("断开连接失败: ${e.message}")
            }
        }
    }

    /**
     * 获取设备的验证信息
     */
    suspend fun getVerificationInfo(peerId: String): CompleteVerificationInfo? {
        return try {
            // 获取会话
            val session = sessionManager.getSession(peerId)
            if (session == null) {
                android.util.Log.w("P2PDeviceViewModel", "No session found for peer: $peerId")
                return null
            }

            // 获取本地和远程身份公钥
            val localPublicKey = sessionManager.getLocalIdentityPublicKey()
            val remotePublicKey = sessionManager.getPeerIdentityPublicKey(peerId)
            if (remotePublicKey == null) {
                android.util.Log.w("P2PDeviceViewModel", "No peer identity key found for: $peerId")
                return null
            }

            // 获取会话关联数据
            val associatedData = session.getAssociatedData()

            // 使用 peerId 作为标识符（简化版，实际应该使用 DID）
            val localIdentifier = "local" // TODO: 从 DID 管理器获取
            val remoteIdentifier = peerId

            // 生成完整验证信息
            val verificationInfo = verificationManager.generateVerificationInfo(
                peerId = peerId,
                localIdentifier = localIdentifier,
                localPublicKey = localPublicKey,
                remoteIdentifier = remoteIdentifier,
                remotePublicKey = remotePublicKey,
                associatedData = associatedData
            )

            // 检查是否已验证
            val isVerified = verificationManager.isVerified(peerId)

            // 返回更新后的验证信息
            verificationInfo.copy(
                isVerified = isVerified,
                verifiedAt = if (isVerified) {
                    verificationManager.getVerificationInfo(peerId)?.verifiedAt
                } else {
                    null
                }
            )
        } catch (e: Exception) {
            android.util.Log.e("P2PDeviceViewModel", "Failed to get verification info", e)
            null
        }
    }

    /**
     * 检查设备是否已验证
     */
    suspend fun isDeviceVerified(peerId: String): Boolean {
        return verificationManager.isVerified(peerId)
    }

    /**
     * 更新已连接设备列表
     */
    private fun updateConnectedDevices(sessions: List<SessionInfo>) {
        val devices = sessions.map { sessionInfo ->
            DeviceWithSession(
                deviceId = sessionInfo.peerId,
                deviceName = sessionInfo.peerId, // 应该从设备信息中获取
                isVerified = false, // 应该从验证管理器中获取
                sessionInfo = sessionInfo
            )
        }
        _connectedDevices.value = devices
    }

    /**
     * 清除错误状态
     */
    fun clearError() {
        if (_uiState.value is DeviceUiState.Error) {
            _uiState.value = DeviceUiState.Idle
        }
    }

    override fun onCleared() {
        super.onCleared()
        viewModelScope.launch {
            stopScanning()
        }
    }
}

/**
 * 带会话的设备
 */
data class DeviceWithSession(
    val deviceId: String,
    val deviceName: String,
    val isVerified: Boolean,
    val sessionInfo: SessionInfo
)

/**
 * 设备 UI 状态
 */
sealed class DeviceUiState {
    object Idle : DeviceUiState()
    object Scanning : DeviceUiState()
    data class Connecting(val deviceId: String) : DeviceUiState()
    data class Connected(val deviceId: String) : DeviceUiState()
    data class Disconnected(val deviceId: String) : DeviceUiState()
    data class Error(val message: String) : DeviceUiState()
}
