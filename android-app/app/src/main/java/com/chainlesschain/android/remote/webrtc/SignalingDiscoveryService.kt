package com.chainlesschain.android.remote.webrtc

import com.chainlesschain.android.remote.config.SignalingConfig
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
    suspend fun discoverPeers(timeoutMs: Long = 2500): Result<List<DiscoveredPeer>> = withContext(Dispatchers.IO) {
        val deferred = CompletableDeferred<List<DiscoveredPeer>>()
        val request = Request.Builder().url(signalingConfig.getSignalingUrl()).build()
        var ws: WebSocket? = null
        try {
            ws = okHttpClient.newWebSocket(request, object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    val msg = JSONObject().apply { put("type", "list-peers") }
                    webSocket.send(msg.toString())
                }

                override fun onMessage(webSocket: WebSocket, text: String) {
                    val peers = parsePeerPayload(text)
                    if (peers != null) {
                        deferred.complete(peers)
                    }
                }

                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    if (!deferred.isCompleted) deferred.complete(emptyList())
                }
            })

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
                else -> null
            } ?: return emptyList()

            buildList {
                for (i in 0 until array.length()) {
                    val item = array.optJSONObject(i) ?: continue
                    val peerId = item.optString("peerId", item.optString("id"))
                    if (peerId.isBlank()) continue
                    add(
                        DiscoveredPeer(
                            peerId = peerId,
                            deviceName = item.optString("deviceName", item.optString("name", peerId)),
                            ipAddress = item.optString("ipAddress", item.optString("ip", "")),
                            did = item.optString("did", "did:key:$peerId")
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
