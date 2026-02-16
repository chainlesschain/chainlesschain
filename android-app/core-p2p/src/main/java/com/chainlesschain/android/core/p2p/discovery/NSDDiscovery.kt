package com.chainlesschain.android.core.p2p.discovery

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.util.Log
import com.chainlesschain.android.core.p2p.model.ConnectionStatus
import com.chainlesschain.android.core.p2p.model.DeviceType
import com.chainlesschain.android.core.p2p.model.P2PDevice
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/**
 * NSD (Network Service Discovery) 设备发现实现
 *
 * 使用Android原生NSD API进行局域网设备发现
 */
@Singleton
class NSDDiscovery @Inject constructor(
    @ApplicationContext private val context: Context
) : DeviceDiscovery {

    companion object {
        private const val TAG = "NSDDiscovery"

        /** 服务类型 */
        const val SERVICE_TYPE = "_chainlesschain._tcp."

        /** 服务端口 */
        const val SERVICE_PORT = 8888

        /** 设备ID属性键 */
        const val ATTR_DEVICE_ID = "device_id"

        /** 设备类型属性键 */
        const val ATTR_DEVICE_TYPE = "device_type"

        /** 公钥属性键 */
        const val ATTR_PUBLIC_KEY = "public_key"
    }

    private val nsdManager: NsdManager by lazy {
        context.getSystemService(Context.NSD_SERVICE) as? NsdManager
            ?: error("NsdManager system service unavailable")
    }

    // 发现的设备列表
    private val _discoveredDevices = MutableStateFlow<List<P2PDevice>>(emptyList())

    // 发现事件流
    private val _discoveryEvents = MutableStateFlow<DiscoveryEvent>(DiscoveryEvent.DiscoveryStopped)

    // 是否正在发现 (accessed from NSD system threads)
    @Volatile
    private var discovering = false

    // 已注册的服务 (accessed from NSD registration callback thread)
    @Volatile
    private var registeredServiceName: String? = null

    // 发现监听器
    @Volatile
    private var discoveryListener: NsdManager.DiscoveryListener? = null

    // 注册监听器
    @Volatile
    private var registrationListener: NsdManager.RegistrationListener? = null

    override fun startDiscovery() {
        if (discovering) {
            Log.w(TAG, "Discovery already running")
            return
        }

        Log.i(TAG, "Starting NSD discovery for service type: $SERVICE_TYPE")

        discoveryListener = object : NsdManager.DiscoveryListener {

            override fun onDiscoveryStarted(regType: String) {
                Log.d(TAG, "Service discovery started: $regType")
                discovering = true
                _discoveryEvents.value = DiscoveryEvent.DiscoveryStarted
            }

            override fun onServiceFound(service: NsdServiceInfo) {
                Log.d(TAG, "Service found: ${service.serviceName}")

                // 解析服务信息
                nsdManager.resolveService(service, object : NsdManager.ResolveListener {
                    override fun onResolveFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {
                        Log.e(TAG, "Resolve failed: $errorCode")
                    }

                    override fun onServiceResolved(serviceInfo: NsdServiceInfo) {
                        Log.i(TAG, "Service resolved: ${serviceInfo.serviceName}")

                        val device = parseServiceInfo(serviceInfo)
                        if (device != null) {
                            addDiscoveredDevice(device)
                            _discoveryEvents.value = DiscoveryEvent.DeviceFound(device)
                        }
                    }
                })
            }

            override fun onServiceLost(service: NsdServiceInfo) {
                Log.d(TAG, "Service lost: ${service.serviceName}")

                val deviceId = extractDeviceId(service.serviceName)
                if (deviceId != null) {
                    removeDiscoveredDevice(deviceId)
                    _discoveryEvents.value = DiscoveryEvent.DeviceLost(deviceId)
                }
            }

            override fun onDiscoveryStopped(serviceType: String) {
                Log.d(TAG, "Discovery stopped")
                discovering = false
                _discoveryEvents.value = DiscoveryEvent.DiscoveryStopped
            }

            override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {
                Log.e(TAG, "Discovery failed to start: $errorCode")
                discovering = false
                _discoveryEvents.value = DiscoveryEvent.DiscoveryFailed("Error code: $errorCode")
            }

            override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {
                Log.e(TAG, "Discovery failed to stop: $errorCode")
                _discoveryEvents.value = DiscoveryEvent.DiscoveryFailed("Failed to stop: $errorCode")
            }
        }

        try {
            nsdManager.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, discoveryListener)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start discovery", e)
            discovering = false
            _discoveryEvents.value = DiscoveryEvent.DiscoveryFailed(e.message ?: "Unknown error")
        }
    }

    override fun stopDiscovery() {
        if (!discovering) {
            Log.w(TAG, "Discovery not running")
            return
        }

        try {
            discoveryListener?.let {
                nsdManager.stopServiceDiscovery(it)
                discoveryListener = null
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to stop discovery", e)
        }

        discovering = false
        _discoveryEvents.value = DiscoveryEvent.DiscoveryStopped
    }

    override fun registerService(deviceInfo: P2PDevice) {
        Log.i(TAG, "Registering service for device: ${deviceInfo.deviceName}")

        val serviceInfo = NsdServiceInfo().apply {
            serviceName = "${deviceInfo.deviceName}-${deviceInfo.deviceId.take(8)}"
            serviceType = SERVICE_TYPE
            port = SERVICE_PORT

            // 设置设备属性
            setAttribute(ATTR_DEVICE_ID, deviceInfo.deviceId)
            setAttribute(ATTR_DEVICE_TYPE, deviceInfo.deviceType.name)
            deviceInfo.publicKey?.let {
                setAttribute(ATTR_PUBLIC_KEY, it)
            }
        }

        registrationListener = object : NsdManager.RegistrationListener {

            override fun onServiceRegistered(nsdServiceInfo: NsdServiceInfo) {
                registeredServiceName = nsdServiceInfo.serviceName
                Log.i(TAG, "Service registered: ${nsdServiceInfo.serviceName}")
                _discoveryEvents.value = DiscoveryEvent.ServiceRegistered(nsdServiceInfo.serviceName)
            }

            override fun onRegistrationFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {
                Log.e(TAG, "Service registration failed: $errorCode")
                _discoveryEvents.value = DiscoveryEvent.ServiceRegistrationFailed("Error code: $errorCode")
            }

            override fun onServiceUnregistered(serviceInfo: NsdServiceInfo) {
                Log.i(TAG, "Service unregistered: ${serviceInfo.serviceName}")
                registeredServiceName = null
            }

            override fun onUnregistrationFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {
                Log.e(TAG, "Service unregistration failed: $errorCode")
            }
        }

        try {
            nsdManager.registerService(serviceInfo, NsdManager.PROTOCOL_DNS_SD, registrationListener)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to register service", e)
            _discoveryEvents.value = DiscoveryEvent.ServiceRegistrationFailed(e.message ?: "Unknown error")
        }
    }

    override fun unregisterService() {
        try {
            registrationListener?.let {
                nsdManager.unregisterService(it)
                registrationListener = null
            }
            registeredServiceName = null
        } catch (e: Exception) {
            Log.e(TAG, "Failed to unregister service", e)
        }
    }

    override fun observeDiscoveredDevices(): Flow<List<P2PDevice>> {
        return _discoveredDevices.asStateFlow()
    }

    override fun observeDiscoveryEvents(): Flow<DiscoveryEvent> {
        return _discoveryEvents.asStateFlow()
    }

    override fun isDiscovering(): Boolean = discovering

    /**
     * 解析NSD服务信息为P2P设备
     */
    private fun parseServiceInfo(serviceInfo: NsdServiceInfo): P2PDevice? {
        return try {
            val deviceId = serviceInfo.attributes?.get(ATTR_DEVICE_ID)?.decodeToString()
                ?: UUID.randomUUID().toString()

            val deviceTypeStr = serviceInfo.attributes?.get(ATTR_DEVICE_TYPE)?.decodeToString()
            val deviceType = deviceTypeStr?.let {
                try {
                    DeviceType.valueOf(it)
                } catch (e: Exception) {
                    DeviceType.OTHER
                }
            } ?: DeviceType.OTHER

            val publicKey = serviceInfo.attributes?.get(ATTR_PUBLIC_KEY)?.decodeToString()

            val address = "${serviceInfo.host?.hostAddress}:${serviceInfo.port}"

            P2PDevice(
                deviceId = deviceId,
                deviceName = serviceInfo.serviceName,
                deviceType = deviceType,
                status = ConnectionStatus.DISCOVERED,
                address = address,
                publicKey = publicKey,
                isTrusted = false
            )
        } catch (e: Exception) {
            Log.e(TAG, "Failed to parse service info", e)
            null
        }
    }

    /**
     * 从服务名称提取设备ID
     */
    private fun extractDeviceId(serviceName: String): String? {
        return try {
            // 服务名称格式: DeviceName-DeviceId
            serviceName.substringAfterLast("-", "")
                .takeIf { it.isNotEmpty() }
        } catch (e: Exception) {
            null
        }
    }

    /**
     * 添加发现的设备
     */
    private fun addDiscoveredDevice(device: P2PDevice) {
        val currentDevices = _discoveredDevices.value.toMutableList()

        // 检查是否已存在
        val existingIndex = currentDevices.indexOfFirst { it.deviceId == device.deviceId }
        if (existingIndex >= 0) {
            currentDevices[existingIndex] = device
        } else {
            currentDevices.add(device)
        }

        _discoveredDevices.value = currentDevices
    }

    /**
     * 移除发现的设备
     */
    private fun removeDiscoveredDevice(deviceId: String) {
        _discoveredDevices.value = _discoveredDevices.value.filter { it.deviceId != deviceId }
    }
}
