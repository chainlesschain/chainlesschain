package com.chainlesschain.android.remote.commands

import com.chainlesschain.android.remote.client.RemoteCommandClient
import kotlinx.serialization.Serializable
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 网络信息命令 API
 *
 * 提供类型安全的网络相关命令
 */
@Singleton
class NetworkCommands @Inject constructor(
    private val client: RemoteCommandClient
) {
    /**
     * 获取网络状态
     */
    suspend fun getStatus(): Result<NetworkStatusResponse> {
        return client.invoke("network.getStatus", emptyMap())
    }

    /**
     * 获取网络接口列表
     *
     * @param includeInternal 是否包含内部接口
     */
    suspend fun getInterfaces(
        includeInternal: Boolean = false
    ): Result<NetworkInterfacesResponse> {
        val params = mapOf("includeInternal" to includeInternal)
        return client.invoke("network.getInterfaces", params)
    }

    /**
     * 获取活动网络连接
     *
     * @param protocol 协议过滤：all, tcp, udp
     * @param state 状态过滤：all, ESTABLISHED, LISTEN, etc.
     * @param limit 返回数量限制
     */
    suspend fun getConnections(
        protocol: String = "all",
        state: String = "all",
        limit: Int = 100
    ): Result<ConnectionsResponse> {
        val params = mapOf(
            "protocol" to protocol,
            "state" to state,
            "limit" to limit
        )
        return client.invoke("network.getConnections", params)
    }

    /**
     * 获取带宽使用情况
     */
    suspend fun getBandwidth(): Result<BandwidthResponse> {
        return client.invoke("network.getBandwidth", emptyMap())
    }

    /**
     * Ping 测试
     *
     * @param host 目标主机
     * @param count Ping 次数
     * @param timeout 超时时间（毫秒）
     */
    suspend fun ping(
        host: String,
        count: Int = 4,
        timeout: Int = 5000
    ): Result<PingResponse> {
        val params = mapOf(
            "host" to host,
            "count" to count,
            "timeout" to timeout
        )
        return client.invoke("network.ping", params)
    }

    /**
     * 获取公网 IP
     */
    suspend fun getPublicIP(): Result<PublicIPResponse> {
        return client.invoke("network.getPublicIP", emptyMap())
    }

    /**
     * 获取 DNS 配置
     */
    suspend fun getDNS(): Result<DNSResponse> {
        return client.invoke("network.getDNS", emptyMap())
    }

    /**
     * DNS 解析
     *
     * @param hostname 主机名
     * @param type 记录类型：A, AAAA, MX, etc.
     */
    suspend fun resolve(
        hostname: String,
        type: String = "A"
    ): Result<DNSResolveResponse> {
        val params = mapOf(
            "hostname" to hostname,
            "type" to type
        )
        return client.invoke("network.resolve", params)
    }

    /**
     * 路由追踪
     *
     * @param host 目标主机
     * @param maxHops 最大跳数
     */
    suspend fun traceroute(
        host: String,
        maxHops: Int = 30
    ): Result<TracerouteResponse> {
        val params = mapOf(
            "host" to host,
            "maxHops" to maxHops
        )
        return client.invoke("network.traceroute", params)
    }

    /**
     * 获取 WiFi 信息
     */
    suspend fun getWifi(): Result<WifiResponse> {
        return client.invoke("network.getWifi", emptyMap())
    }

    /**
     * 网络速度测试
     *
     * @param testUrl 测试 URL（可选）
     */
    suspend fun getSpeed(testUrl: String? = null): Result<SpeedTestResponse> {
        val params = mutableMapOf<String, Any>()
        testUrl?.let { params["testUrl"] = it }

        return client.invoke("network.getSpeed", params)
    }
}

// 响应数据类

@Serializable
data class NetworkStatusResponse(
    val success: Boolean,
    val status: NetworkStatus
)

@Serializable
data class NetworkStatus(
    val online: Boolean,
    val hasIPv4: Boolean,
    val hasIPv6: Boolean,
    val primaryInterface: PrimaryInterface? = null,
    val interfaceCount: Int,
    val timestamp: Long
)

@Serializable
data class PrimaryInterface(
    val name: String,
    val address: String
)

@Serializable
data class NetworkInterfacesResponse(
    val success: Boolean,
    val interfaces: List<NetworkInterface>,
    val total: Int
)

@Serializable
data class NetworkInterface(
    val name: String,
    val addresses: List<InterfaceAddress>
)

@Serializable
data class InterfaceAddress(
    val address: String,
    val netmask: String? = null,
    val family: String,
    val mac: String? = null,
    val internal: Boolean,
    val cidr: String? = null
)

@Serializable
data class ConnectionsResponse(
    val success: Boolean,
    val connections: List<NetworkConnection>,
    val total: Int,
    val returned: Int
)

@Serializable
data class NetworkConnection(
    val protocol: String,
    val localAddress: String,
    val localPort: Int,
    val remoteAddress: String,
    val remotePort: Int,
    val state: String,
    val pid: Int? = null
)

@Serializable
data class BandwidthResponse(
    val success: Boolean,
    val bandwidth: BandwidthInfo
)

@Serializable
data class BandwidthInfo(
    val bytesReceived: Long,
    val bytesSent: Long,
    val bytesReceivedFormatted: String,
    val bytesSentFormatted: String,
    val rxRate: Long,
    val txRate: Long,
    val rxRateFormatted: String,
    val txRateFormatted: String,
    val timestamp: Long
)

@Serializable
data class PingResponse(
    val success: Boolean,
    val host: String,
    val reachable: Boolean,
    val packetsTransmitted: Int? = null,
    val packetsReceived: Int? = null,
    val packetLoss: Double? = null,
    val minTime: Double? = null,
    val maxTime: Double? = null,
    val avgTime: Double? = null,
    val totalDuration: Long? = null,
    val error: String? = null
)

@Serializable
data class PublicIPResponse(
    val success: Boolean,
    val ip: String,
    val location: String? = null,
    val isp: String? = null,
    val source: String
)

@Serializable
data class DNSResponse(
    val success: Boolean,
    val dns: DNSConfig
)

@Serializable
data class DNSConfig(
    val nodeServers: List<String>,
    val systemServers: List<String>
)

@Serializable
data class DNSResolveResponse(
    val success: Boolean,
    val hostname: String,
    val type: String,
    val records: List<String>
)

@Serializable
data class TracerouteResponse(
    val success: Boolean,
    val host: String,
    val hops: List<TracerouteHop>,
    val totalHops: Int
)

@Serializable
data class TracerouteHop(
    val hop: Int,
    val ip: String? = null,
    val times: List<Double>,
    val timeout: Boolean
)

@Serializable
data class WifiResponse(
    val success: Boolean,
    val wifi: WifiInfo? = null,
    val error: String? = null
)

@Serializable
data class WifiInfo(
    val ssid: String? = null,
    val bssid: String? = null,
    val signal: Int? = null,
    val noise: Int? = null,
    val channel: Int? = null,
    val frequency: Double? = null,
    val connectionType: String? = null,
    val authentication: String? = null
)

@Serializable
data class SpeedTestResponse(
    val success: Boolean,
    val download: SpeedTestResult
)

@Serializable
data class SpeedTestResult(
    val bytes: Long,
    val duration: Double,
    val speedBps: Long,
    val speedMbps: Double,
    val speedFormatted: String
)
