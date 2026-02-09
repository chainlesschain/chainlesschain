package com.chainlesschain.android.core.p2p.discovery

import android.content.Context
import android.util.Log
import com.chainlesschain.android.core.p2p.model.ConnectionStatus
import com.chainlesschain.android.core.p2p.model.DeviceType
import com.chainlesschain.android.core.p2p.model.P2PDevice
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import okhttp3.*
import okio.ByteString
import java.util.UUID
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 基于信令服务器的设备发现
 *
 * 通过 WebSocket 连接到信令服务器来发现其他设备
 */
@Singleton
class SignalingDeviceDiscovery @Inject constructor(
    @ApplicationContext private val context: Context
) : DeviceDiscovery {

    companion object {
        private const val TAG = "SignalingDeviceDiscovery"
        private const val PREFS_NAME = "signaling_prefs"
        private const val KEY_CUSTOM_URL = "custom_signaling_url"
        // 默认使用局域网 PC 地址
        private const val DEFAULT_URL = "ws://192.168.3.59:9001"
        private const val RECONNECT_DELAY_MS = 5000L
        private const val HEARTBEAT_INTERVAL_MS = 30000L
    }

    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
    }

    private val okHttpClient = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(10, TimeUnit.SECONDS)
        .pingInterval(30, TimeUnit.SECONDS)
        .build()

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    // 发现的设备列表
    private val _discoveredDevices = MutableStateFlow<List<P2PDevice>>(emptyList())

    // 发现事件流
    private val _discoveryEvents = MutableStateFlow<DiscoveryEvent>(DiscoveryEvent.DiscoveryStopped)

    // WebSocket 连接
    private var webSocket: WebSocket? = null

    // 是否正在发现
    private var discovering = false

    // 本设备 ID
    private var localDeviceId: String = UUID.randomUUID().toString()

    // 心跳任务
    private var heartbeatJob: Job? = null

    // 重连任务
    private var reconnectJob: Job? = null

    private val prefs by lazy {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    }

    /**
     * 获取信令服务器地址
     */
    private fun getSignalingUrl(): String {
        return prefs.getString(KEY_CUSTOM_URL, DEFAULT_URL) ?: DEFAULT_URL
    }

    override fun startDiscovery() {
        if (discovering) {
            Log.w(TAG, "Discovery already running")
            return
        }

        discovering = true
        _discoveryEvents.value = DiscoveryEvent.DiscoveryStarted

        val signalingUrl = getSignalingUrl()
        Log.i(TAG, "========================================")
        Log.i(TAG, "Starting signaling discovery")
        Log.i(TAG, "Signaling URL: $signalingUrl")
        Log.i(TAG, "========================================")

        connectToSignalingServer(signalingUrl)
    }

    private fun connectToSignalingServer(url: String) {
        try {
            val request = Request.Builder()
                .url(url)
                .build()

            webSocket = okHttpClient.newWebSocket(request, object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    Log.i(TAG, "WebSocket connected to signaling server")
                    _discoveryEvents.value = DiscoveryEvent.DiscoveryStarted

                    // 注册本设备
                    registerDevice(webSocket)

                    // 启动心跳
                    startHeartbeat(webSocket)

                    // 请求在线设备列表
                    requestPeersList(webSocket)
                }

                override fun onMessage(webSocket: WebSocket, text: String) {
                    Log.d(TAG, "Received message: $text")
                    handleMessage(text)
                }

                override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                    onMessage(webSocket, bytes.utf8())
                }

                override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                    Log.w(TAG, "WebSocket closing: $code - $reason")
                    webSocket.close(1000, null)
                }

                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                    Log.i(TAG, "WebSocket closed: $code - $reason")
                    handleDisconnection()
                }

                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    Log.e(TAG, "WebSocket failure: ${t.message}", t)
                    _discoveryEvents.value = DiscoveryEvent.DiscoveryFailed(t.message ?: "Connection failed")
                    handleDisconnection()
                }
            })
        } catch (e: Exception) {
            Log.e(TAG, "Failed to connect to signaling server", e)
            _discoveryEvents.value = DiscoveryEvent.DiscoveryFailed(e.message ?: "Unknown error")
            discovering = false
        }
    }

    private fun registerDevice(ws: WebSocket) {
        val registerMessage = mapOf(
            "type" to "register",
            "peerId" to localDeviceId,
            "deviceType" to "ANDROID",
            "deviceInfo" to mapOf(
                "name" to android.os.Build.MODEL,
                "platform" to "Android ${android.os.Build.VERSION.RELEASE}"
            ),
            "timestamp" to System.currentTimeMillis()
        )

        val jsonStr = json.encodeToString(registerMessage)
        ws.send(jsonStr)
        Log.d(TAG, "Sent register message: $jsonStr")
    }

    private fun requestPeersList(ws: WebSocket) {
        val message = mapOf(
            "type" to "get-peers",
            "timestamp" to System.currentTimeMillis()
        )

        val jsonStr = json.encodeToString(message)
        ws.send(jsonStr)
        Log.d(TAG, "Sent get-peers request")
    }

    private fun startHeartbeat(ws: WebSocket) {
        heartbeatJob?.cancel()
        heartbeatJob = scope.launch {
            while (isActive && discovering) {
                delay(HEARTBEAT_INTERVAL_MS)
                try {
                    val pingMessage = mapOf(
                        "type" to "ping",
                        "timestamp" to System.currentTimeMillis()
                    )
                    ws.send(json.encodeToString(pingMessage))

                    // 同时刷新设备列表
                    requestPeersList(ws)
                } catch (e: Exception) {
                    Log.e(TAG, "Heartbeat failed", e)
                }
            }
        }
    }

    private fun handleMessage(text: String) {
        try {
            val message = json.decodeFromString<Map<String, kotlinx.serialization.json.JsonElement>>(text)
            val type = message["type"]?.toString()?.trim('"')

            when (type) {
                "registered" -> {
                    Log.i(TAG, "Successfully registered with signaling server")
                }
                "peers-list" -> {
                    handlePeersList(message)
                }
                "peer-status" -> {
                    handlePeerStatus(message)
                }
                "pong" -> {
                    Log.v(TAG, "Received pong")
                }
                "error" -> {
                    val error = message["error"]?.toString()?.trim('"') ?: "Unknown error"
                    Log.e(TAG, "Signaling server error: $error")
                }
                else -> {
                    Log.d(TAG, "Unhandled message type: $type")
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to parse message: $text", e)
        }
    }

    private fun handlePeersList(message: Map<String, kotlinx.serialization.json.JsonElement>) {
        try {
            val peersArray = message["peers"]
            if (peersArray != null) {
                val peersJson = peersArray.toString()
                val peers = json.decodeFromString<List<PeerInfo>>(peersJson)

                val devices = peers.mapNotNull { peer ->
                    if (peer.peerId != localDeviceId) {
                        P2PDevice(
                            deviceId = peer.peerId,
                            deviceName = peer.deviceInfo?.name ?: peer.deviceType ?: "Unknown Device",
                            deviceType = parseDeviceType(peer.deviceType),
                            status = ConnectionStatus.DISCOVERED,
                            address = "", // 信令服务器模式不需要直接地址
                            publicKey = null,
                            isTrusted = false
                        )
                    } else null
                }

                _discoveredDevices.value = devices
                Log.i(TAG, "Updated device list: ${devices.size} devices found")

                devices.forEach { device ->
                    _discoveryEvents.value = DiscoveryEvent.DeviceFound(device)
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to parse peers list", e)
        }
    }

    private fun handlePeerStatus(message: Map<String, kotlinx.serialization.json.JsonElement>) {
        try {
            val peerId = message["peerId"]?.toString()?.trim('"') ?: return
            val status = message["status"]?.toString()?.trim('"') ?: return
            val deviceType = message["deviceType"]?.toString()?.trim('"')

            if (peerId == localDeviceId) return

            when (status) {
                "online" -> {
                    val device = P2PDevice(
                        deviceId = peerId,
                        deviceName = deviceType ?: "Unknown Device",
                        deviceType = parseDeviceType(deviceType),
                        status = ConnectionStatus.DISCOVERED,
                        address = "",
                        publicKey = null,
                        isTrusted = false
                    )
                    addDiscoveredDevice(device)
                    _discoveryEvents.value = DiscoveryEvent.DeviceFound(device)
                    Log.i(TAG, "Device came online: $peerId")
                }
                "offline" -> {
                    removeDiscoveredDevice(peerId)
                    _discoveryEvents.value = DiscoveryEvent.DeviceLost(peerId)
                    Log.i(TAG, "Device went offline: $peerId")
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to handle peer status", e)
        }
    }

    private fun parseDeviceType(type: String?): DeviceType {
        return when (type?.uppercase()) {
            "DESKTOP", "PC", "WINDOWS", "MACOS", "LINUX" -> DeviceType.DESKTOP
            "ANDROID" -> DeviceType.MOBILE
            "IOS", "IPHONE", "IPAD" -> DeviceType.MOBILE
            "TABLET" -> DeviceType.MOBILE
            "WEB" -> DeviceType.WEB
            else -> DeviceType.OTHER
        }
    }

    private fun handleDisconnection() {
        heartbeatJob?.cancel()
        heartbeatJob = null

        if (discovering) {
            // 尝试重连
            reconnectJob?.cancel()
            reconnectJob = scope.launch {
                delay(RECONNECT_DELAY_MS)
                if (discovering) {
                    Log.i(TAG, "Attempting to reconnect...")
                    connectToSignalingServer(getSignalingUrl())
                }
            }
        }
    }

    override fun stopDiscovery() {
        if (!discovering) {
            Log.w(TAG, "Discovery not running")
            return
        }

        discovering = false
        heartbeatJob?.cancel()
        heartbeatJob = null
        reconnectJob?.cancel()
        reconnectJob = null

        try {
            webSocket?.close(1000, "Discovery stopped")
            webSocket = null
        } catch (e: Exception) {
            Log.e(TAG, "Failed to close WebSocket", e)
        }

        _discoveryEvents.value = DiscoveryEvent.DiscoveryStopped
        Log.i(TAG, "Discovery stopped")
    }

    override fun registerService(deviceInfo: P2PDevice) {
        localDeviceId = deviceInfo.deviceId
        Log.i(TAG, "Local device ID set to: $localDeviceId")
    }

    override fun unregisterService() {
        stopDiscovery()
    }

    override fun observeDiscoveredDevices(): Flow<List<P2PDevice>> {
        return _discoveredDevices.asStateFlow()
    }

    override fun observeDiscoveryEvents(): Flow<DiscoveryEvent> {
        return _discoveryEvents.asStateFlow()
    }

    override fun isDiscovering(): Boolean = discovering

    private fun addDiscoveredDevice(device: P2PDevice) {
        val currentDevices = _discoveredDevices.value.toMutableList()
        val existingIndex = currentDevices.indexOfFirst { it.deviceId == device.deviceId }
        if (existingIndex >= 0) {
            currentDevices[existingIndex] = device
        } else {
            currentDevices.add(device)
        }
        _discoveredDevices.value = currentDevices
    }

    private fun removeDiscoveredDevice(deviceId: String) {
        _discoveredDevices.value = _discoveredDevices.value.filter { it.deviceId != deviceId }
    }

    /**
     * 手动刷新设备列表
     */
    fun refreshDeviceList() {
        webSocket?.let { ws ->
            requestPeersList(ws)
        }
    }
}

@Serializable
private data class PeerInfo(
    val peerId: String,
    val deviceType: String? = null,
    val deviceInfo: DeviceInfoData? = null,
    val lastSeen: Long? = null
)

@Serializable
private data class DeviceInfoData(
    val name: String? = null,
    val platform: String? = null
)
