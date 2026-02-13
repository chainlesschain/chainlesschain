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

    // ==================== WiFi 管理 ====================

    /**
     * 扫描 WiFi 网络
     */
    suspend fun scanWifi(): Result<WifiScanResponse> {
        return client.invoke("network.scanWifi", emptyMap())
    }

    /**
     * 连接到 WiFi 网络
     *
     * @param ssid 网络名称
     * @param password 密码
     * @param security 安全类型 (WPA2, WPA3, WEP, Open)
     */
    suspend fun connectWifi(
        ssid: String,
        password: String? = null,
        security: String = "WPA2"
    ): Result<WifiConnectResponse> {
        val params = mutableMapOf<String, Any>(
            "ssid" to ssid,
            "security" to security
        )
        password?.let { params["password"] = it }
        return client.invoke("network.connectWifi", params)
    }

    /**
     * 断开 WiFi 连接
     */
    suspend fun disconnectWifi(): Result<WifiDisconnectResponse> {
        return client.invoke("network.disconnectWifi", emptyMap())
    }

    /**
     * 获取已保存的 WiFi 网络
     */
    suspend fun getSavedWifiNetworks(): Result<SavedWifiResponse> {
        return client.invoke("network.getSavedWifiNetworks", emptyMap())
    }

    /**
     * 删除已保存的 WiFi 网络
     *
     * @param ssid 网络名称
     */
    suspend fun forgetWifiNetwork(ssid: String): Result<ForgetWifiResponse> {
        return client.invoke("network.forgetWifiNetwork", mapOf("ssid" to ssid))
    }

    /**
     * 启用/禁用 WiFi
     *
     * @param enabled 是否启用
     */
    suspend fun setWifiEnabled(enabled: Boolean): Result<WifiToggleResponse> {
        return client.invoke("network.setWifiEnabled", mapOf("enabled" to enabled))
    }

    // ==================== 端口操作 ====================

    /**
     * 检查端口是否开放
     *
     * @param host 主机
     * @param port 端口
     * @param timeout 超时（毫秒）
     */
    suspend fun checkPort(
        host: String,
        port: Int,
        timeout: Int = 5000
    ): Result<PortCheckResponse> {
        return client.invoke("network.checkPort", mapOf(
            "host" to host,
            "port" to port,
            "timeout" to timeout
        ))
    }

    /**
     * 扫描端口范围
     *
     * @param host 主机
     * @param startPort 起始端口
     * @param endPort 结束端口
     * @param timeout 超时（毫秒）
     */
    suspend fun scanPorts(
        host: String,
        startPort: Int = 1,
        endPort: Int = 1024,
        timeout: Int = 1000
    ): Result<PortScanResponse> {
        return client.invoke("network.scanPorts", mapOf(
            "host" to host,
            "startPort" to startPort,
            "endPort" to endPort,
            "timeout" to timeout
        ))
    }

    /**
     * 获取监听端口列表
     */
    suspend fun getListeningPorts(): Result<ListeningPortsResponse> {
        return client.invoke("network.getListeningPorts", emptyMap())
    }

    // ==================== 代理设置 ====================

    /**
     * 获取代理设置
     */
    suspend fun getProxySettings(): Result<ProxySettingsResponse> {
        return client.invoke("network.getProxySettings", emptyMap())
    }

    /**
     * 设置系统代理
     *
     * @param type 代理类型 (http, https, socks4, socks5)
     * @param host 代理主机
     * @param port 代理端口
     * @param username 用户名（可选）
     * @param password 密码（可选）
     * @param bypassList 绕过列表
     */
    suspend fun setProxy(
        type: String,
        host: String,
        port: Int,
        username: String? = null,
        password: String? = null,
        bypassList: List<String>? = null
    ): Result<SetProxyResponse> {
        val params = mutableMapOf<String, Any>(
            "type" to type,
            "host" to host,
            "port" to port
        )
        username?.let { params["username"] = it }
        password?.let { params["password"] = it }
        bypassList?.let { params["bypassList"] = it }
        return client.invoke("network.setProxy", params)
    }

    /**
     * 清除代理设置
     */
    suspend fun clearProxy(): Result<ClearProxyResponse> {
        return client.invoke("network.clearProxy", emptyMap())
    }

    /**
     * 测试代理连接
     *
     * @param type 代理类型
     * @param host 代理主机
     * @param port 代理端口
     * @param testUrl 测试 URL
     */
    suspend fun testProxy(
        type: String,
        host: String,
        port: Int,
        testUrl: String = "https://www.google.com"
    ): Result<TestProxyResponse> {
        return client.invoke("network.testProxy", mapOf(
            "type" to type,
            "host" to host,
            "port" to port,
            "testUrl" to testUrl
        ))
    }

    // ==================== VPN 管理 ====================

    /**
     * 获取 VPN 状态
     */
    suspend fun getVpnStatus(): Result<VpnStatusResponse> {
        return client.invoke("network.getVpnStatus", emptyMap())
    }

    /**
     * 获取 VPN 配置列表
     */
    suspend fun getVpnConfigs(): Result<VpnConfigsResponse> {
        return client.invoke("network.getVpnConfigs", emptyMap())
    }

    /**
     * 连接 VPN
     *
     * @param configId VPN 配置 ID
     */
    suspend fun connectVpn(configId: String): Result<VpnConnectResponse> {
        return client.invoke("network.connectVpn", mapOf("configId" to configId))
    }

    /**
     * 断开 VPN
     */
    suspend fun disconnectVpn(): Result<VpnDisconnectResponse> {
        return client.invoke("network.disconnectVpn", emptyMap())
    }

    // ==================== 防火墙 ====================

    /**
     * 获取防火墙状态
     */
    suspend fun getFirewallStatus(): Result<FirewallStatusResponse> {
        return client.invoke("network.getFirewallStatus", emptyMap())
    }

    /**
     * 启用/禁用防火墙
     *
     * @param enabled 是否启用
     */
    suspend fun setFirewallEnabled(enabled: Boolean): Result<FirewallToggleResponse> {
        return client.invoke("network.setFirewallEnabled", mapOf("enabled" to enabled))
    }

    /**
     * 获取防火墙规则
     */
    suspend fun getFirewallRules(): Result<FirewallRulesResponse> {
        return client.invoke("network.getFirewallRules", emptyMap())
    }

    /**
     * 添加防火墙规则
     *
     * @param name 规则名称
     * @param direction 方向 (inbound, outbound)
     * @param action 动作 (allow, block)
     * @param protocol 协议 (tcp, udp, any)
     * @param port 端口
     * @param remoteAddress 远程地址
     */
    suspend fun addFirewallRule(
        name: String,
        direction: String,
        action: String,
        protocol: String = "tcp",
        port: Int? = null,
        remoteAddress: String? = null
    ): Result<AddFirewallRuleResponse> {
        val params = mutableMapOf<String, Any>(
            "name" to name,
            "direction" to direction,
            "action" to action,
            "protocol" to protocol
        )
        port?.let { params["port"] = it }
        remoteAddress?.let { params["remoteAddress"] = it }
        return client.invoke("network.addFirewallRule", params)
    }

    /**
     * 删除防火墙规则
     *
     * @param ruleId 规则 ID
     */
    suspend fun removeFirewallRule(ruleId: String): Result<RemoveFirewallRuleResponse> {
        return client.invoke("network.removeFirewallRule", mapOf("ruleId" to ruleId))
    }

    // ==================== 路由和 ARP ====================

    /**
     * 获取路由表
     */
    suspend fun getRouteTable(): Result<RouteTableResponse> {
        return client.invoke("network.getRouteTable", emptyMap())
    }

    /**
     * 获取 ARP 表
     */
    suspend fun getArpTable(): Result<ArpTableResponse> {
        return client.invoke("network.getArpTable", emptyMap())
    }

    /**
     * 添加静态路由
     *
     * @param destination 目标网络
     * @param gateway 网关
     * @param metric 度量值
     */
    suspend fun addRoute(
        destination: String,
        gateway: String,
        metric: Int = 1
    ): Result<AddRouteResponse> {
        return client.invoke("network.addRoute", mapOf(
            "destination" to destination,
            "gateway" to gateway,
            "metric" to metric
        ))
    }

    /**
     * 删除路由
     *
     * @param destination 目标网络
     */
    suspend fun removeRoute(destination: String): Result<RemoveRouteResponse> {
        return client.invoke("network.removeRoute", mapOf("destination" to destination))
    }

    // ==================== HTTP 请求 ====================

    /**
     * 发送 HTTP 请求
     *
     * @param url URL
     * @param method 方法 (GET, POST, PUT, DELETE, etc.)
     * @param headers 请求头
     * @param body 请求体
     * @param timeout 超时（毫秒）
     */
    suspend fun httpRequest(
        url: String,
        method: String = "GET",
        headers: Map<String, String>? = null,
        body: String? = null,
        timeout: Int = 30000
    ): Result<HttpRequestResponse> {
        val params = mutableMapOf<String, Any>(
            "url" to url,
            "method" to method,
            "timeout" to timeout
        )
        headers?.let { params["headers"] = it }
        body?.let { params["body"] = it }
        return client.invoke("network.httpRequest", params)
    }

    /**
     * 获取 URL 头信息
     *
     * @param url URL
     */
    suspend fun getUrlHeaders(url: String): Result<UrlHeadersResponse> {
        return client.invoke("network.getUrlHeaders", mapOf("url" to url))
    }

    /**
     * 下载文件
     *
     * @param url 文件 URL
     * @param savePath 保存路径
     */
    suspend fun downloadFile(
        url: String,
        savePath: String
    ): Result<DownloadFileResponse> {
        return client.invoke("network.downloadFile", mapOf(
            "url" to url,
            "savePath" to savePath
        ))
    }

    // ==================== SSL/TLS ====================

    /**
     * 获取 SSL 证书信息
     *
     * @param host 主机
     * @param port 端口
     */
    suspend fun getSslCertificate(
        host: String,
        port: Int = 443
    ): Result<SslCertificateResponse> {
        return client.invoke("network.getSslCertificate", mapOf(
            "host" to host,
            "port" to port
        ))
    }

    /**
     * 验证 SSL 证书
     *
     * @param host 主机
     */
    suspend fun verifySslCertificate(host: String): Result<SslVerifyResponse> {
        return client.invoke("network.verifySslCertificate", mapOf("host" to host))
    }

    // ==================== 网络诊断 ====================

    /**
     * 综合网络诊断
     *
     * @param host 目标主机
     */
    suspend fun diagnose(host: String? = null): Result<NetworkDiagnoseResponse> {
        val params = mutableMapOf<String, Any>()
        host?.let { params["host"] = it }
        return client.invoke("network.diagnose", params)
    }

    /**
     * MTU 测试
     *
     * @param host 目标主机
     */
    suspend fun testMtu(host: String): Result<MtuTestResponse> {
        return client.invoke("network.testMtu", mapOf("host" to host))
    }

    // ==================== Wake-on-LAN ====================

    /**
     * 发送 Wake-on-LAN 魔术包
     *
     * @param macAddress MAC 地址
     * @param broadcastAddress 广播地址
     * @param port 端口
     */
    suspend fun wakeOnLan(
        macAddress: String,
        broadcastAddress: String = "255.255.255.255",
        port: Int = 9
    ): Result<WakeOnLanResponse> {
        return client.invoke("network.wakeOnLan", mapOf(
            "macAddress" to macAddress,
            "broadcastAddress" to broadcastAddress,
            "port" to port
        ))
    }

    // ==================== 服务发现 ====================

    /**
     * 扫描局域网设备
     *
     * @param subnet 子网（如 192.168.1.0/24）
     */
    suspend fun scanLan(subnet: String? = null): Result<LanScanResponse> {
        val params = mutableMapOf<String, Any>()
        subnet?.let { params["subnet"] = it }
        return client.invoke("network.scanLan", params)
    }

    /**
     * mDNS 服务发现
     *
     * @param serviceType 服务类型（如 _http._tcp）
     * @param timeout 超时（毫秒）
     */
    suspend fun discoverServices(
        serviceType: String = "_http._tcp",
        timeout: Int = 5000
    ): Result<ServiceDiscoveryResponse> {
        return client.invoke("network.discoverServices", mapOf(
            "serviceType" to serviceType,
            "timeout" to timeout
        ))
    }

    // ==================== 端口转发 ====================

    /**
     * 获取端口转发列表
     */
    suspend fun getPortForwards(): Result<PortForwardsResponse> {
        return client.invoke("network.getPortForwards", emptyMap())
    }

    /**
     * 添加端口转发
     *
     * @param localPort 本地端口
     * @param remoteHost 远程主机
     * @param remotePort 远程端口
     * @param protocol 协议
     */
    suspend fun addPortForward(
        localPort: Int,
        remoteHost: String,
        remotePort: Int,
        protocol: String = "tcp"
    ): Result<AddPortForwardResponse> {
        return client.invoke("network.addPortForward", mapOf(
            "localPort" to localPort,
            "remoteHost" to remoteHost,
            "remotePort" to remotePort,
            "protocol" to protocol
        ))
    }

    /**
     * 删除端口转发
     *
     * @param forwardId 转发 ID
     */
    suspend fun removePortForward(forwardId: String): Result<RemovePortForwardResponse> {
        return client.invoke("network.removePortForward", mapOf("forwardId" to forwardId))
    }

    // ==================== 网络统计 ====================

    /**
     * 获取网络统计
     *
     * @param interfaceName 接口名称
     */
    suspend fun getNetworkStats(interfaceName: String? = null): Result<NetworkStatsResponse> {
        val params = mutableMapOf<String, Any>()
        interfaceName?.let { params["interface"] = it }
        return client.invoke("network.getNetworkStats", params)
    }

    /**
     * 重置网络统计
     */
    suspend fun resetNetworkStats(): Result<ResetStatsResponse> {
        return client.invoke("network.resetNetworkStats", emptyMap())
    }

    /**
     * 获取每个应用的网络使用
     */
    suspend fun getAppNetworkUsage(): Result<AppNetworkUsageResponse> {
        return client.invoke("network.getAppNetworkUsage", emptyMap())
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

// ==================== WiFi 管理响应 ====================

@Serializable
data class WifiScanResponse(
    val success: Boolean,
    val networks: List<WifiNetwork>,
    val total: Int
)

@Serializable
data class WifiNetwork(
    val ssid: String,
    val bssid: String,
    val signal: Int,
    val frequency: Int,
    val channel: Int,
    val security: String,
    val connected: Boolean = false
)

@Serializable
data class WifiConnectResponse(
    val success: Boolean,
    val ssid: String,
    val message: String
)

@Serializable
data class WifiDisconnectResponse(
    val success: Boolean,
    val message: String
)

@Serializable
data class SavedWifiResponse(
    val success: Boolean,
    val networks: List<SavedWifiNetwork>,
    val total: Int
)

@Serializable
data class SavedWifiNetwork(
    val ssid: String,
    val security: String,
    val autoConnect: Boolean
)

@Serializable
data class ForgetWifiResponse(
    val success: Boolean,
    val ssid: String,
    val message: String
)

@Serializable
data class WifiToggleResponse(
    val success: Boolean,
    val enabled: Boolean,
    val message: String
)

// ==================== 端口操作响应 ====================

@Serializable
data class PortCheckResponse(
    val success: Boolean,
    val host: String,
    val port: Int,
    val open: Boolean,
    val latency: Long? = null,
    val service: String? = null
)

@Serializable
data class PortScanResponse(
    val success: Boolean,
    val host: String,
    val openPorts: List<OpenPort>,
    val scannedRange: String,
    val duration: Long
)

@Serializable
data class OpenPort(
    val port: Int,
    val service: String? = null,
    val protocol: String
)

@Serializable
data class ListeningPortsResponse(
    val success: Boolean,
    val ports: List<ListeningPort>,
    val total: Int
)

@Serializable
data class ListeningPort(
    val port: Int,
    val protocol: String,
    val address: String,
    val pid: Int? = null,
    val process: String? = null
)

// ==================== 代理响应 ====================

@Serializable
data class ProxySettingsResponse(
    val success: Boolean,
    val enabled: Boolean,
    val type: String? = null,
    val host: String? = null,
    val port: Int? = null,
    val bypassList: List<String>? = null
)

@Serializable
data class SetProxyResponse(
    val success: Boolean,
    val type: String,
    val host: String,
    val port: Int,
    val message: String
)

@Serializable
data class ClearProxyResponse(
    val success: Boolean,
    val message: String
)

@Serializable
data class TestProxyResponse(
    val success: Boolean,
    val reachable: Boolean,
    val latency: Long? = null,
    val externalIp: String? = null,
    val message: String
)

// ==================== VPN 响应 ====================

@Serializable
data class VpnStatusResponse(
    val success: Boolean,
    val connected: Boolean,
    val configName: String? = null,
    val serverAddress: String? = null,
    val connectedSince: Long? = null,
    val bytesIn: Long? = null,
    val bytesOut: Long? = null
)

@Serializable
data class VpnConfigsResponse(
    val success: Boolean,
    val configs: List<VpnConfig>,
    val total: Int
)

@Serializable
data class VpnConfig(
    val id: String,
    val name: String,
    val type: String,
    val server: String,
    val port: Int
)

@Serializable
data class VpnConnectResponse(
    val success: Boolean,
    val configId: String,
    val message: String
)

@Serializable
data class VpnDisconnectResponse(
    val success: Boolean,
    val message: String
)

// ==================== 防火墙响应 ====================

@Serializable
data class FirewallStatusResponse(
    val success: Boolean,
    val enabled: Boolean,
    val defaultInbound: String,
    val defaultOutbound: String,
    val ruleCount: Int
)

@Serializable
data class FirewallToggleResponse(
    val success: Boolean,
    val enabled: Boolean,
    val message: String
)

@Serializable
data class FirewallRulesResponse(
    val success: Boolean,
    val rules: List<FirewallRule>,
    val total: Int
)

@Serializable
data class FirewallRule(
    val id: String,
    val name: String,
    val direction: String,
    val action: String,
    val protocol: String,
    val port: Int? = null,
    val remoteAddress: String? = null,
    val enabled: Boolean
)

@Serializable
data class AddFirewallRuleResponse(
    val success: Boolean,
    val ruleId: String,
    val name: String,
    val message: String
)

@Serializable
data class RemoveFirewallRuleResponse(
    val success: Boolean,
    val ruleId: String,
    val message: String
)

// ==================== 路由和 ARP 响应 ====================

@Serializable
data class RouteTableResponse(
    val success: Boolean,
    val routes: List<RouteEntry>,
    val total: Int
)

@Serializable
data class RouteEntry(
    val destination: String,
    val gateway: String,
    val netmask: String,
    val interfaceName: String,
    val metric: Int,
    val flags: String? = null
)

@Serializable
data class ArpTableResponse(
    val success: Boolean,
    val entries: List<ArpEntry>,
    val total: Int
)

@Serializable
data class ArpEntry(
    val ipAddress: String,
    val macAddress: String,
    val interfaceName: String,
    val type: String
)

@Serializable
data class AddRouteResponse(
    val success: Boolean,
    val destination: String,
    val gateway: String,
    val message: String
)

@Serializable
data class RemoveRouteResponse(
    val success: Boolean,
    val destination: String,
    val message: String
)

// ==================== HTTP 请求响应 ====================

@Serializable
data class HttpRequestResponse(
    val success: Boolean,
    val statusCode: Int,
    val statusText: String,
    val headers: Map<String, String>,
    val body: String? = null,
    val contentType: String? = null,
    val contentLength: Long? = null,
    val duration: Long
)

@Serializable
data class UrlHeadersResponse(
    val success: Boolean,
    val url: String,
    val statusCode: Int,
    val headers: Map<String, String>
)

@Serializable
data class DownloadFileResponse(
    val success: Boolean,
    val url: String,
    val savePath: String,
    val fileSize: Long,
    val duration: Long,
    val message: String
)

// ==================== SSL/TLS 响应 ====================

@Serializable
data class SslCertificateResponse(
    val success: Boolean,
    val host: String,
    val certificate: SslCertificate
)

@Serializable
data class SslCertificate(
    val subject: String,
    val issuer: String,
    val validFrom: Long,
    val validTo: Long,
    val serialNumber: String,
    val fingerprint: String,
    val signatureAlgorithm: String,
    val subjectAltNames: List<String>? = null,
    val isValid: Boolean
)

@Serializable
data class SslVerifyResponse(
    val success: Boolean,
    val host: String,
    val valid: Boolean,
    val issues: List<String>,
    val expiresIn: Long? = null  // days
)

// ==================== 网络诊断响应 ====================

@Serializable
data class NetworkDiagnoseResponse(
    val success: Boolean,
    val results: DiagnoseResults
)

@Serializable
data class DiagnoseResults(
    val internetConnectivity: Boolean,
    val dnsResolution: Boolean,
    val gatewayReachable: Boolean,
    val latency: Long? = null,
    val publicIp: String? = null,
    val issues: List<String>,
    val suggestions: List<String>
)

@Serializable
data class MtuTestResponse(
    val success: Boolean,
    val host: String,
    val mtu: Int,
    val message: String
)

// ==================== Wake-on-LAN 响应 ====================

@Serializable
data class WakeOnLanResponse(
    val success: Boolean,
    val macAddress: String,
    val packetsSent: Int,
    val message: String
)

// ==================== 服务发现响应 ====================

@Serializable
data class LanScanResponse(
    val success: Boolean,
    val devices: List<LanDevice>,
    val total: Int,
    val scanDuration: Long
)

@Serializable
data class LanDevice(
    val ipAddress: String,
    val macAddress: String? = null,
    val hostname: String? = null,
    val manufacturer: String? = null,
    val openPorts: List<Int>? = null
)

@Serializable
data class ServiceDiscoveryResponse(
    val success: Boolean,
    val services: List<DiscoveredService>,
    val total: Int
)

@Serializable
data class DiscoveredService(
    val name: String,
    val type: String,
    val host: String,
    val port: Int,
    val txt: Map<String, String>? = null
)

// ==================== 端口转发响应 ====================

@Serializable
data class PortForwardsResponse(
    val success: Boolean,
    val forwards: List<PortForward>,
    val total: Int
)

@Serializable
data class PortForward(
    val id: String,
    val localPort: Int,
    val remoteHost: String,
    val remotePort: Int,
    val protocol: String,
    val active: Boolean,
    val bytesForwarded: Long? = null
)

@Serializable
data class AddPortForwardResponse(
    val success: Boolean,
    val forwardId: String,
    val localPort: Int,
    val message: String
)

@Serializable
data class RemovePortForwardResponse(
    val success: Boolean,
    val forwardId: String,
    val message: String
)

// ==================== 网络统计响应 ====================

@Serializable
data class NetworkStatsResponse(
    val success: Boolean,
    val bytesReceived: Long,
    val bytesSent: Long,
    val packetsReceived: Long,
    val packetsSent: Long,
    val errorsIn: Long,
    val errorsOut: Long,
    val dropsIn: Long,
    val dropsOut: Long,
    val uptime: Long
)

@Serializable
data class ResetStatsResponse(
    val success: Boolean,
    val message: String
)

@Serializable
data class AppNetworkUsageResponse(
    val success: Boolean,
    val apps: List<AppNetworkUsage>,
    val total: Int
)

@Serializable
data class AppNetworkUsage(
    val appId: String,
    val appName: String,
    val bytesReceived: Long,
    val bytesSent: Long,
    val connections: Int
)
