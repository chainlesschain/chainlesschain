package com.chainlesschain.android.remote.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.remote.data.RegisteredDeviceRepository
import com.chainlesschain.android.remote.webrtc.SignalingDiscoveryService
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import androidx.compose.runtime.Immutable
import timber.log.Timber
import javax.inject.Inject

@HiltViewModel
class DeviceScanViewModel @Inject constructor(
    private val repository: RegisteredDeviceRepository,
    private val discoveryService: SignalingDiscoveryService
) : ViewModel() {

    private val _uiState = MutableStateFlow(DeviceScanUiState())
    val uiState: StateFlow<DeviceScanUiState> = _uiState.asStateFlow()

    fun setDiscovered(devices: List<DiscoveredDevice>) {
        viewModelScope.launch {
            try {
                Timber.i("setDiscovered called with ${devices.size} devices")
                val normalized = devices.map { it.copy(isRegistered = repository.isRegistered(it.peerId)) }
                _uiState.update { it.copy(discoveredDevices = normalized) }
            } catch (e: Exception) {
                Timber.e(e, "Failed to set discovered devices")
            }
        }
    }

    fun discoverDevices(fallbackDevices: List<DiscoveredDevice> = emptyList()) {
        viewModelScope.launch {
            try {
                Timber.i("========================================")
                Timber.i("discoverDevices() called")
                Timber.i("========================================")
                val result = discoveryService.discoverPeers()
                Timber.i("discoverPeers result: $result")
                val discovered = result.getOrDefault(emptyList()).map {
                    DiscoveredDevice(
                        peerId = it.peerId,
                        deviceName = it.deviceName,
                        ipAddress = if (it.ipAddress.isBlank()) "unknown" else it.ipAddress,
                        did = it.did,
                        isRegistered = false
                    )
                }
                // 更新调试信息
                _uiState.update { it.copy(lastScanDebugInfo = discoveryService.lastScanDebugInfo) }

                when {
                    discovered.isNotEmpty() -> setDiscovered(discovered)
                    fallbackDevices.isNotEmpty() -> setDiscovered(fallbackDevices)
                    else -> setDiscovered(emptyList())
                }
            } catch (e: Exception) {
                Timber.e(e, "Failed to discover devices")
            }
        }
    }

    fun registerDevice(device: DiscoveredDevice, deviceName: String, onDone: () -> Unit) {
        viewModelScope.launch {
            try {
                repository.registerOrUpdate(
                    peerId = device.peerId,
                    did = device.did.ifBlank { "did:key:${device.peerId}" },
                    deviceName = deviceName,
                    ipAddress = device.ipAddress
                )
                _uiState.update { state ->
                    state.copy(
                        discoveredDevices = state.discoveredDevices.map {
                            if (it.peerId == device.peerId) it.copy(deviceName = deviceName, isRegistered = true) else it
                        }
                    )
                }
                onDone()
            } catch (e: Exception) {
                Timber.e(e, "Failed to register device: ${device.peerId}")
            }
        }
    }
}

@Immutable
data class DeviceScanUiState(
    val discoveredDevices: List<DiscoveredDevice> = emptyList(),
    val lastScanDebugInfo: String = ""
)
