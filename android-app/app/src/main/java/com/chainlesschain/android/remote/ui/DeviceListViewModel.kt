package com.chainlesschain.android.remote.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.remote.data.RegisteredDeviceEntity
import com.chainlesschain.android.remote.data.RegisteredDeviceRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class DeviceListViewModel @Inject constructor(
    private val repository: RegisteredDeviceRepository
) : ViewModel() {

    private val _devices = MutableStateFlow<List<RegisteredDeviceEntity>>(emptyList())
    val devices: StateFlow<List<RegisteredDeviceEntity>> = _devices.asStateFlow()

    init {
        viewModelScope.launch {
            repository.getDevicesFlow().collect { _devices.value = it }
        }
    }

    fun remove(peerId: String) {
        viewModelScope.launch {
            repository.remove(peerId)
        }
    }
}
