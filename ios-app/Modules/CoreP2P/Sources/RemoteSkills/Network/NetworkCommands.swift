import Foundation

/// 网络信息 typed RPC wrapper — Phase 6.1B3。
///
/// 镜像 Android `app/src/main/java/.../remote/commands/NetworkCommands.kt` 桌面已支持 11 method 子集
/// （桌面 case ⊂ Android 53 method invoke；Android 多 42 method 缺桌面 impl 留 Phase 7+ debt
///  — 含 VPN / 防火墙规则 / 端口扫描 / 蓝牙 / HTTP request / SSL 验证等）。
///
/// **wire 协议**（与桌面 `network-handler.js` 对齐）：
/// - 只读查询：getStatus / getInterfaces / getDNS / getPublicIP / getWifi / getConnections
/// - 实时监测：getBandwidth / getSpeed
/// - 网络诊断：ping / resolve / traceroute
public actor NetworkCommands {

    private let client: RemoteCommandClient

    public init(client: RemoteCommandClient) {
        self.client = client
    }

    /// 总体网络状态（online + primary interface + gateway + DNS）。
    public func getStatus(
        pcPeerId: String,
        mobileDid: String? = nil
    ) async throws -> NetworkStatusResponse {
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "network.getStatus",
            params: [:],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, NetworkStatusResponse.decode)
    }

    /// 列所有网卡信息（NIC）。
    public func getInterfaces(
        pcPeerId: String,
        mobileDid: String? = nil
    ) async throws -> NetworkInterfacesResponse {
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "network.getInterfaces",
            params: [:],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, NetworkInterfacesResponse.decode)
    }

    /// DNS 服务器列表。
    public func getDNS(
        pcPeerId: String,
        mobileDid: String? = nil
    ) async throws -> NetworkDNSResponse {
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "network.getDNS",
            params: [:],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, NetworkDNSResponse.decode)
    }

    /// 公网 IP（通过 3rd party 服务查询，可能慢）。
    public func getPublicIP(
        pcPeerId: String,
        mobileDid: String? = nil
    ) async throws -> PublicIPResponse {
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "network.getPublicIP",
            params: [:],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, PublicIPResponse.decode)
    }

    /// 当前 Wi-Fi 连接信息（ssid / 信号强度 / 频段等）。
    public func getWifi(
        pcPeerId: String,
        mobileDid: String? = nil
    ) async throws -> WifiResponse {
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "network.getWifi",
            params: [:],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, WifiResponse.decode)
    }

    /// 实时上下行带宽（bytes/s）。
    public func getBandwidth(
        pcPeerId: String,
        interfaceName: String? = nil,
        mobileDid: String? = nil
    ) async throws -> BandwidthResponse {
        var params: [String: Any] = [:]
        if let i = interfaceName { params["interface"] = i }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "network.getBandwidth",
            params: params,
            mobileDid: mobileDid
        )
        return try Self.decode(resp, BandwidthResponse.decode)
    }

    /// 网速测试（Mbps 上下行 + ping）。注意：耗时操作（10-30s）。
    public func getSpeed(
        pcPeerId: String,
        mobileDid: String? = nil
    ) async throws -> SpeedTestResponse {
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "network.getSpeed",
            params: [:],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, SpeedTestResponse.decode)
    }

    /// Ping 目标主机（默认 4 包，与系统 ping 类似）。
    public func ping(
        pcPeerId: String,
        host: String,
        count: Int = 4,
        timeoutMs: Int = 5000,
        mobileDid: String? = nil
    ) async throws -> PingResponse {
        guard !host.isEmpty else {
            throw RemoteSkillError.invalidArgument("network.ping: host empty")
        }
        guard count > 0 && count <= 100 else {
            throw RemoteSkillError.invalidArgument("network.ping: count must be 1-100")
        }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "network.ping",
            params: ["host": host, "count": count, "timeoutMs": timeoutMs],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, PingResponse.decode)
    }

    /// DNS 解析（host → IP 列表）。
    public func resolve(
        pcPeerId: String,
        host: String,
        mobileDid: String? = nil
    ) async throws -> DNSResolveResponse {
        guard !host.isEmpty else {
            throw RemoteSkillError.invalidArgument("network.resolve: host empty")
        }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "network.resolve",
            params: ["host": host],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, DNSResolveResponse.decode)
    }

    /// 路由追踪。注意：耗时操作（30-60s）。
    public func traceroute(
        pcPeerId: String,
        host: String,
        maxHops: Int = 30,
        mobileDid: String? = nil
    ) async throws -> TracerouteResponse {
        guard !host.isEmpty else {
            throw RemoteSkillError.invalidArgument("network.traceroute: host empty")
        }
        guard maxHops > 0 && maxHops <= 64 else {
            throw RemoteSkillError.invalidArgument("network.traceroute: maxHops must be 1-64")
        }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "network.traceroute",
            params: ["host": host, "maxHops": maxHops],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, TracerouteResponse.decode)
    }

    /// 当前网络连接列表（socket 表）。
    public func getConnections(
        pcPeerId: String,
        protocolFilter: String? = nil,  // tcp / udp / all (default)
        mobileDid: String? = nil
    ) async throws -> NetworkConnectionsResponse {
        var params: [String: Any] = [:]
        if let p = protocolFilter { params["protocol"] = p }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "network.getConnections",
            params: params,
            mobileDid: mobileDid
        )
        return try Self.decode(resp, NetworkConnectionsResponse.decode)
    }

    private static func decode<T>(
        _ resp: TerminalRpcResponse,
        _ decoder: (String) throws -> T
    ) throws -> T {
        switch resp {
        case .success(_, let resultJson):  return try decoder(resultJson)
        case .failure(let reqId, let msg): throw RemoteSkillError.remoteError(reqId: reqId, message: msg)
        }
    }
}
