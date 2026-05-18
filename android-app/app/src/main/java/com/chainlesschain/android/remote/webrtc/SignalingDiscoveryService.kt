package com.chainlesschain.android.remote.webrtc

import com.chainlesschain.android.core.p2p.config.SignalingConfig
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class SignalingDiscoveryService @Inject constructor(
    private val okHttpClient: OkHttpClient,
    private val signalingConfig: SignalingConfig
) {
    // 最后一次扫描的调试信息
    var lastScanDebugInfo: String = ""
        private set

    suspend fun discoverPeers(timeoutMs: Long = 2500): Result<List<DiscoveredPeer>> = withContext(Dispatchers.IO) {
        val deferred = CompletableDeferred<List<DiscoveredPeer>>()
        val signalingUrl = signalingConfig.getSignalingUrl()
        val debugBuilder = StringBuilder()
        debugBuilder.appendLine("========== 设备扫描调试信息 ==========")
        debugBuilder.appendLine("信令服务器: $signalingUrl")
        debugBuilder.appendLine("开始时间: ${java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.getDefault()).format(java.util.Date())}")
        Timber.i("========================================")
        Timber.i("Starting peer discovery")
        Timber.i("Signaling URL: $signalingUrl")
        Timber.i("========================================")
        val request = Request.Builder().url(signalingUrl).build()
        var ws: WebSocket? = null
        try {
            ws = okHttpClient.newWebSocket(request, object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    Timber.i("WebSocket connected to $signalingUrl")
                    debugBuilder.appendLine("✓ WebSocket 连接成功")
                    // Register first so the server accepts our get-peers request
                    val registerMsg = JSONObject().apply {
                        put("type", "register")
                        put("peerId", "discovery-${System.currentTimeMillis()}")
                        put("deviceType", "mobile")
                        put("deviceInfo", JSONObject().apply {
                            put("name", android.os.Build.MODEL)
                            put("platform", "android")
                            put("version", android.os.Build.VERSION.RELEASE)
                        })
                    }
                    webSocket.send(registerMsg.toString())

                    // Then request peer list
                    val msg = JSONObject().apply {
                        put("type", "get-peers")
                    }
                    webSocket.send(msg.toString())
                }

                override fun onMessage(webSocket: WebSocket, text: String) {
                    Timber.d("Received message: $text")
                    debugBuilder.appendLine("收到消息: ${text.take(200)}${if (text.length > 200) "..." else ""}")
                    val peers = parsePeerPayload(text)
                    if (peers == null) {
                        debugBuilder.appendLine("  → 非 peers-list 消息，忽略")
                        return
                    }
                    debugBuilder.appendLine("  → 解析到 ${peers.size} 个设备")
                    peers.forEach { peer ->
                        debugBuilder.appendLine("    - ${peer.deviceName} (${peer.deviceType}) [${peer.peerId.take(8)}...]")
                    }
                    Timber.i("Parsed ${peers.size} peers: ${peers.map { it.deviceName }}")
                    if (!deferred.isCompleted) {
                        deferred.complete(peers)
                    }
                }

                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    Timber.e(t, "WebSocket failure: ${t.message}")
                    debugBuilder.appendLine("✗ WebSocket 连接失败: ${t.message}")
                    if (!deferred.isCompleted) deferred.complete(emptyList())
                }
            })

            val result = withTimeout(timeoutMs) { deferred.await() }
            debugBuilder.appendLine("========== 扫描完成 ==========")
            debugBuilder.appendLine("发现设备数: ${result.size}")
            lastScanDebugInfo = debugBuilder.toString()
            Result.success(result)
        } catch (e: Exception) {
            Timber.w(e, "discoverPeers timeout/failure")
            debugBuilder.appendLine("✗ 扫描超时或失败: ${e.message}")
            debugBuilder.appendLine("========== 扫描结束 ==========")
            lastScanDebugInfo = debugBuilder.toString()
            Result.failure(e)
        } finally {
            ws?.close(1000, "done")
        }
    }

    private fun parsePeerPayload(text: String): List<DiscoveredPeer>? {
        return try {
            val json = JSONObject(text)
            val type = json.optString("type")
            // Server may respond with "peers-list" (signaling-handlers.js) or other variants
            if (type != "peer-list" && type != "peers-list" && type != "peers" && type != "list-peers-result") return null
            val array = when {
                json.has("peers") -> json.optJSONArray("peers")
                json.has("data") -> json.optJSONArray("data")
                json.has("result") -> json.optJSONArray("result")
                else -> null
            } ?: return emptyList()

            buildList {
                for (i in 0 until array.length()) {
                    val item = array.optJSONObject(i) ?: continue
                    val peerId = item.optString("peerId", item.optString("id")).trim()
                    if (peerId.isBlank()) continue

                    // Extract device info from nested object or flat fields
                    val deviceInfo = item.optJSONObject("deviceInfo")
                    val name = deviceInfo?.optString("name", "")?.ifBlank { null }
                        ?: item.optString("deviceName", item.optString("name", peerId)).ifBlank { peerId }
                    val platform = deviceInfo?.optString("platform", "") ?: ""
                    val deviceType = item.optString("deviceType", "")
                    val isOnline = item.optBoolean("isOnline", true)

                    val did = item.optString("did").trim().ifEmpty { "did:key:$peerId" }
                    val ip = item.optString("ipAddress", item.optString("ip", "")).trim()

                    add(
                        DiscoveredPeer(
                            peerId = peerId,
                            deviceName = name,
                            ipAddress = ip,
                            did = did,
                            deviceType = deviceType,
                            platform = platform,
                            isOnline = isOnline
                        )
                    )
                }
            }
        } catch (e: Exception) {
            Timber.w(e, "Failed to parse peer payload")
            null
        }
    }
}

data class DiscoveredPeer(
    val peerId: String,
    val deviceName: String,
    val ipAddress: String,
    val did: String,
    val deviceType: String = "",
    val platform: String = "",
    val isOnline: Boolean = true
)
