package com.chainlesschain.android.remote.webrtc

import android.util.Log
import com.chainlesschain.android.remote.config.SignalingConfig
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
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
    companion object {
        private const val TAG = "SignalingDiscoveryService"
    }

    suspend fun discoverPeers(timeoutMs: Long = 2500): Result<List<DiscoveredPeer>> = withContext(Dispatchers.IO) {
        val deferred = CompletableDeferred<List<DiscoveredPeer>>()
        val signalingUrl = signalingConfig.getSignalingUrl()
        Log.i(TAG, "========================================")
        Log.i(TAG, "Starting peer discovery")
        Log.i(TAG, "Signaling URL: $signalingUrl")
        Log.i(TAG, "========================================")
        val request = Request.Builder().url(signalingUrl).build()
        var ws: WebSocket? = null
        try {
            ws = okHttpClient.newWebSocket(request, object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    Log.i(TAG, "WebSocket connected to $signalingUrl")
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
                    Log.d(TAG, "Received message: $text")
                    val peers = parsePeerPayload(text) ?: return
                    Log.i(TAG, "Parsed ${peers.size} peers: ${peers.map { it.deviceName }}")
                    if (!deferred.isCompleted) {
                        deferred.complete(peers)
                    }
                }

                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    Log.e(TAG, "WebSocket failure: ${t.message}", t)
                    if (!deferred.isCompleted) deferred.complete(emptyList())
                }
            })

            CoroutineScope(Dispatchers.IO).launch {
                delay(timeoutMs)
                if (!deferred.isCompleted) deferred.complete(emptyList())
            }

            val result = withTimeout(timeoutMs) { deferred.await() }
            Result.success(result)
        } catch (e: Exception) {
            Timber.w(e, "discoverPeers timeout/failure")
            Result.success(emptyList())
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
        } catch (_: Exception) {
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
