package com.chainlesschain.android.core.p2p.discovery

import android.content.Context
import android.util.Log
import com.chainlesschain.android.core.p2p.model.P2PDevice
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 组合设备发现
 *
 * 同时使用 NSD (mDNS) 和信令服务器两种方式发现设备
 */
@Singleton
class CompositeDeviceDiscovery @Inject constructor(
    @ApplicationContext private val context: Context,
    private val nsdDiscovery: NSDDiscovery,
    private val signalingDiscovery: SignalingDeviceDiscovery
) : DeviceDiscovery {

    companion object {
        private const val TAG = "CompositeDeviceDiscovery"
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    // 合并后的设备列表
    private val _discoveredDevices = MutableStateFlow<List<P2PDevice>>(emptyList())

    // 发现事件流
    private val _discoveryEvents = MutableSharedFlow<DiscoveryEvent>(
        extraBufferCapacity = 32
    )

    // 是否正在发现
    private var discovering = false

    // 收集任务
    private var collectionJob: Job? = null

    init {
        // 合并两个来源的设备列表
        scope.launch {
            combine(
                nsdDiscovery.observeDiscoveredDevices(),
                signalingDiscovery.observeDiscoveredDevices()
            ) { nsdDevices, signalingDevices ->
                mergeDevices(nsdDevices, signalingDevices)
            }.collect { mergedDevices ->
                _discoveredDevices.value = mergedDevices
            }
        }
    }

    /**
     * 合并来自不同来源的设备列表
     * 以 deviceId 为主键去重，优先保留 NSD 发现的设备（因为有地址信息）
     */
    private fun mergeDevices(
        nsdDevices: List<P2PDevice>,
        signalingDevices: List<P2PDevice>
    ): List<P2PDevice> {
        val deviceMap = mutableMapOf<String, P2PDevice>()

        // 先添加信令服务器发现的设备
        signalingDevices.forEach { device ->
            deviceMap[device.deviceId] = device.copy(
                deviceName = "${device.deviceName} (信令)"
            )
        }

        // 再添加 NSD 发现的设备（会覆盖信令服务器的，因为 NSD 有地址信息）
        nsdDevices.forEach { device ->
            deviceMap[device.deviceId] = device.copy(
                deviceName = "${device.deviceName} (局域网)"
            )
        }

        return deviceMap.values.toList()
    }

    override fun startDiscovery() {
        if (discovering) {
            Log.w(TAG, "Discovery already running")
            return
        }

        Log.i(TAG, "Starting composite discovery (NSD + Signaling)")
        discovering = true

        // 启动 NSD 发现
        try {
            nsdDiscovery.startDiscovery()
            Log.i(TAG, "NSD discovery started")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start NSD discovery", e)
        }

        // 启动信令服务器发现
        try {
            signalingDiscovery.startDiscovery()
            Log.i(TAG, "Signaling discovery started")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start signaling discovery", e)
        }

        // 收集发现事件
        collectionJob = scope.launch {
            launch {
                nsdDiscovery.observeDiscoveryEvents().collect { event ->
                    _discoveryEvents.emit(event)
                }
            }
            launch {
                signalingDiscovery.observeDiscoveryEvents().collect { event ->
                    _discoveryEvents.emit(event)
                }
            }
        }

        // 发送开始事件
        scope.launch {
            _discoveryEvents.emit(DiscoveryEvent.DiscoveryStarted)
        }
    }

    override fun stopDiscovery() {
        if (!discovering) {
            Log.w(TAG, "Discovery not running")
            return
        }

        Log.i(TAG, "Stopping composite discovery")
        discovering = false

        collectionJob?.cancel()
        collectionJob = null

        try {
            nsdDiscovery.stopDiscovery()
        } catch (e: Exception) {
            Log.e(TAG, "Failed to stop NSD discovery", e)
        }

        try {
            signalingDiscovery.stopDiscovery()
        } catch (e: Exception) {
            Log.e(TAG, "Failed to stop signaling discovery", e)
        }

        scope.launch {
            _discoveryEvents.emit(DiscoveryEvent.DiscoveryStopped)
        }
    }

    override fun registerService(deviceInfo: P2PDevice) {
        Log.i(TAG, "Registering service for device: ${deviceInfo.deviceName}")

        // 同时注册到 NSD 和信令服务器
        try {
            nsdDiscovery.registerService(deviceInfo)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to register NSD service", e)
        }

        try {
            signalingDiscovery.registerService(deviceInfo)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to register with signaling server", e)
        }
    }

    override fun unregisterService() {
        nsdDiscovery.unregisterService()
        signalingDiscovery.unregisterService()
    }

    override fun observeDiscoveredDevices(): Flow<List<P2PDevice>> {
        return _discoveredDevices.asStateFlow()
    }

    override fun observeDiscoveryEvents(): Flow<DiscoveryEvent> {
        return _discoveryEvents.asSharedFlow()
    }

    override fun isDiscovering(): Boolean = discovering

    /**
     * 手动刷新设备列表
     */
    fun refreshDeviceList() {
        signalingDiscovery.refreshDeviceList()
    }
}
