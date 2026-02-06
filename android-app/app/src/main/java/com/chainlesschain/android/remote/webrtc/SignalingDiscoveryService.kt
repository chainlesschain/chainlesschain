package com.chainlesschain.android.remote.webrtc

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
    suspend fun discoverPeers(timeoutMs: Long = 2500): Result<List<DiscoveredPeer>> = withContext(Dispatchers.IO) {
        val deferred = CompletableDeferred<List<DiscoveredPeer>>()
        val request = Request.Builder().url(signalingConfig.getSignalingUrl()).build()
        var ws: WebSocket? = null
        try {
            ws = okHttpClient.newWebSocket(request, object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    val msg = JSONObject().apply {
                        put("type", "list-peers")
                        put("requestId", System.currentTimeMillis())
                    }
                    webSocket.send(msg.toString())
                }

                override fun onMessage(webSocket: WebSocket, text: String) {
                    val peers = parsePeerPayload(text) ?: return
                    if (!deferred.isCompleted) {
                        deferred.complete(peers)
                    }
                }

                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
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
            if (type != "peer-list" && type != "peers" && type != "list-peers-result") return null
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
                    val did = item.optString("did").trim().ifEmpty { "did:key:$peerId" }
                    val name = item.optString("deviceName", item.optString("name", peerId)).ifBlank { peerId }
                    val ip = item.optString("ipAddress", item.optString("ip", "")).trim()
                    add(
                        DiscoveredPeer(
                            peerId = peerId,
                            deviceName = name,
                            ipAddress = ip,
                            did = did
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
    val did: String
)
