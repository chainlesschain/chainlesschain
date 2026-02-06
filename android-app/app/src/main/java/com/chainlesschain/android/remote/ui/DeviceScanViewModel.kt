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
            val normalized = devices.map { it.copy(isRegistered = repository.isRegistered(it.peerId)) }
            _uiState.update { it.copy(discoveredDevices = normalized) }
        }
    }

    fun discoverDevices(fallbackDevices: List<DiscoveredDevice> = emptyList()) {
        viewModelScope.launch {
            val discovered = discoveryService.discoverPeers().getOrDefault(emptyList()).map {
                DiscoveredDevice(
                    peerId = it.peerId,
                    deviceName = it.deviceName,
                    ipAddress = if (it.ipAddress.isBlank()) "unknown" else it.ipAddress,
                    isRegistered = false
                )
            }
            when {
                discovered.isNotEmpty() -> setDiscovered(discovered)
                fallbackDevices.isNotEmpty() -> setDiscovered(fallbackDevices)
                else -> setDiscovered(emptyList())
            }
        }
    }

    fun registerDevice(device: DiscoveredDevice, deviceName: String, onDone: () -> Unit) {
        viewModelScope.launch {
            repository.registerOrUpdate(
                peerId = device.peerId,
                did = "did:key:${device.peerId}",
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
        }
    }
}

data class DeviceScanUiState(
    val discoveredDevices: List<DiscoveredDevice> = emptyList()
)
