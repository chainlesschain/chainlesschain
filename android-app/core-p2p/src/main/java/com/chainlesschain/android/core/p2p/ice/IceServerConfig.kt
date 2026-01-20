package com.chainlesschain.android.core.p2p.ice

import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.webrtc.PeerConnection
import javax.inject.Inject
import javax.inject.Singleton

/**
 * ICE 服务器配置管理器
 *
 * 管理 STUN/TURN 服务器配置，支持：
 * - 多 STUN 服务器（用于 NAT 类型检测和地址映射）
 * - 多 TURN 服务器（用于对称 NAT 穿透中继）
 * - 动态服务器切换
 * - 连接质量优化
 */
@Singleton
class IceServerConfig @Inject constructor() {

    companion object {
        private const val TAG = "IceServerConfig"

        // 公共 STUN 服务器列表（免费）
        val DEFAULT_STUN_SERVERS = listOf(
            "stun:stun.l.google.com:19302",
            "stun:stun1.l.google.com:19302",
            "stun:stun2.l.google.com:19302",
            "stun:stun3.l.google.com:19302",
            "stun:stun4.l.google.com:19302",
            "stun:stun.cloudflare.com:3478",
            "stun:stun.nextcloud.com:443",
            "stun:stun.sipgate.net:3478"
        )

        // 默认 ICE 传输策略
        val DEFAULT_ICE_TRANSPORT_POLICY = PeerConnection.IceTransportsType.ALL

        // ICE 候选池大小
        const val DEFAULT_ICE_CANDIDATE_POOL_SIZE = 2
    }

    // 自定义 STUN 服务器
    private val customStunServers = mutableListOf<String>()

    // TURN 服务器配置
    private val turnServers = mutableListOf<TurnServerCredentials>()

    // 当前使用的 ICE 传输策略
    private var iceTransportPolicy = DEFAULT_ICE_TRANSPORT_POLICY

    // ICE 候选池大小
    private var iceCandidatePoolSize = DEFAULT_ICE_CANDIDATE_POOL_SIZE

    /**
     * 获取 ICE 服务器列表
     */
    fun getIceServers(): List<PeerConnection.IceServer> {
        val servers = mutableListOf<PeerConnection.IceServer>()

        // 添加 STUN 服务器
        val stunServers = if (customStunServers.isNotEmpty()) {
            customStunServers
        } else {
            DEFAULT_STUN_SERVERS
        }

        for (url in stunServers) {
            try {
                servers.add(
                    PeerConnection.IceServer.builder(url)
                        .createIceServer()
                )
            } catch (e: Exception) {
                Log.w(TAG, "Invalid STUN server URL: $url", e)
            }
        }

        // 添加 TURN 服务器
        for (turn in turnServers) {
            try {
                servers.add(
                    PeerConnection.IceServer.builder(turn.url)
                        .setUsername(turn.username)
                        .setPassword(turn.password)
                        .createIceServer()
                )
            } catch (e: Exception) {
                Log.w(TAG, "Invalid TURN server config: ${turn.url}", e)
            }
        }

        Log.d(TAG, "ICE servers configured: ${servers.size} (${stunServers.size} STUN, ${turnServers.size} TURN)")

        return servers
    }

    /**
     * 获取 RTC 配置
     */
    fun getRtcConfiguration(): PeerConnection.RTCConfiguration {
        return PeerConnection.RTCConfiguration(getIceServers()).apply {
            // 传输策略
            iceTransportsType = iceTransportPolicy

            // Bundle 策略 - 最大化复用
            bundlePolicy = PeerConnection.BundlePolicy.MAXBUNDLE

            // RTCP 复用策略
            rtcpMuxPolicy = PeerConnection.RtcpMuxPolicy.REQUIRE

            // TCP 候选策略
            tcpCandidatePolicy = PeerConnection.TcpCandidatePolicy.ENABLED

            // ICE 候选池大小
            iceCandidatePoolSize = this@IceServerConfig.iceCandidatePoolSize

            // 持续收集候选
            continualGatheringPolicy = PeerConnection.ContinualGatheringPolicy.GATHER_CONTINUALLY

            // 启用 ICE 候选 trickle（边收集边发送）
            // 注意：这是 WebRTC 默认行为
        }
    }

    /**
     * 添加自定义 STUN 服务器
     */
    fun addStunServer(url: String) {
        if (!customStunServers.contains(url)) {
            customStunServers.add(url)
            Log.i(TAG, "Added custom STUN server: $url")
        }
    }

    /**
     * 添加 TURN 服务器
     */
    fun addTurnServer(url: String, username: String, password: String) {
        val credentials = TurnServerCredentials(url, username, password)
        if (!turnServers.any { it.url == url }) {
            turnServers.add(credentials)
            Log.i(TAG, "Added TURN server: $url")
        }
    }

    /**
     * 移除 TURN 服务器
     */
    fun removeTurnServer(url: String) {
        turnServers.removeAll { it.url == url }
        Log.i(TAG, "Removed TURN server: $url")
    }

    /**
     * 清除所有自定义服务器
     */
    fun clearCustomServers() {
        customStunServers.clear()
        turnServers.clear()
        Log.i(TAG, "Cleared all custom servers")
    }

    /**
     * 设置 ICE 传输策略
     *
     * @param policy ICE 传输策略
     *   - ALL: 使用所有候选（STUN + TURN）
     *   - RELAY: 仅使用 TURN 中继（更隐私但更慢）
     *   - NOHOST: 不使用本地主机候选
     */
    fun setIceTransportPolicy(policy: PeerConnection.IceTransportsType) {
        iceTransportPolicy = policy
        Log.i(TAG, "ICE transport policy set to: $policy")
    }

    /**
     * 设置 ICE 候选池大小
     *
     * 较大的池可以加快连接建立，但会消耗更多资源
     */
    fun setIceCandidatePoolSize(size: Int) {
        iceCandidatePoolSize = size.coerceIn(0, 10)
        Log.i(TAG, "ICE candidate pool size set to: $iceCandidatePoolSize")
    }

    /**
     * 强制使用 TURN 中继
     *
     * 在某些严格的 NAT 环境下有用
     */
    fun forceRelay() {
        if (turnServers.isEmpty()) {
            Log.w(TAG, "No TURN servers configured, cannot force relay")
            return
        }
        setIceTransportPolicy(PeerConnection.IceTransportsType.RELAY)
    }

    /**
     * 恢复正常 ICE 策略
     */
    fun useNormalPolicy() {
        setIceTransportPolicy(PeerConnection.IceTransportsType.ALL)
    }

    /**
     * 测试 STUN 服务器可达性
     */
    suspend fun testStunServer(url: String): StunTestResult = withContext(Dispatchers.IO) {
        try {
            // 简单的 DNS 解析测试
            val host = url.removePrefix("stun:").substringBefore(":")
            val port = url.substringAfter(":", "3478").toIntOrNull() ?: 3478

            val address = java.net.InetAddress.getByName(host)
            val socket = java.net.DatagramSocket()
            socket.soTimeout = 5000

            // 发送 STUN Binding Request
            val request = createStunBindingRequest()
            val packet = java.net.DatagramPacket(
                request,
                request.size,
                address,
                port
            )

            val startTime = System.currentTimeMillis()
            socket.send(packet)

            // 接收响应
            val response = ByteArray(512)
            val responsePacket = java.net.DatagramPacket(response, response.size)
            socket.receive(responsePacket)

            val latency = System.currentTimeMillis() - startTime
            socket.close()

            Log.i(TAG, "STUN server $url responded in ${latency}ms")
            StunTestResult.Success(url, latency)

        } catch (e: java.net.SocketTimeoutException) {
            Log.w(TAG, "STUN server $url timeout")
            StunTestResult.Timeout(url)
        } catch (e: Exception) {
            Log.e(TAG, "STUN server $url failed", e)
            StunTestResult.Failed(url, e.message ?: "Unknown error")
        }
    }

    /**
     * 创建 STUN Binding Request
     *
     * 简化的 STUN 请求（RFC 5389）
     */
    private fun createStunBindingRequest(): ByteArray {
        val request = ByteArray(20)

        // Message Type: Binding Request (0x0001)
        request[0] = 0x00
        request[1] = 0x01

        // Message Length: 0
        request[2] = 0x00
        request[3] = 0x00

        // Magic Cookie: 0x2112A442
        request[4] = 0x21
        request[5] = 0x12
        request[6] = 0xA4.toByte()
        request[7] = 0x42

        // Transaction ID: 12 random bytes
        val random = java.security.SecureRandom()
        random.nextBytes(request.sliceArray(8..19).also {
            System.arraycopy(it, 0, request, 8, 12)
        })

        return request
    }

    /**
     * 获取配置摘要
     */
    fun getConfigSummary(): IceConfigSummary {
        return IceConfigSummary(
            stunServerCount = if (customStunServers.isNotEmpty()) {
                customStunServers.size
            } else {
                DEFAULT_STUN_SERVERS.size
            },
            turnServerCount = turnServers.size,
            transportPolicy = iceTransportPolicy.name,
            candidatePoolSize = iceCandidatePoolSize
        )
    }
}

/**
 * TURN 服务器凭据
 */
data class TurnServerCredentials(
    val url: String,
    val username: String,
    val password: String
)

/**
 * STUN 测试结果
 */
sealed class StunTestResult {
    /** 成功 */
    data class Success(val url: String, val latencyMs: Long) : StunTestResult()

    /** 超时 */
    data class Timeout(val url: String) : StunTestResult()

    /** 失败 */
    data class Failed(val url: String, val error: String) : StunTestResult()
}

/**
 * ICE 配置摘要
 */
data class IceConfigSummary(
    val stunServerCount: Int,
    val turnServerCount: Int,
    val transportPolicy: String,
    val candidatePoolSize: Int
)
