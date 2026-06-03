import Foundation

/// 网络接口（NIC）信息 — 嵌套于 NetworkInterfacesResponse。
public struct NetworkInterface: Sendable, Equatable {
    public let name: String
    public let type: String?              // wifi / ethernet / loopback / virtual
    public let mac: String?
    public let ipv4: String?
    public let ipv6: String?
    public let netmask: String?
    public let mtu: Int?
    public let up: Bool?

    public init(name: String, type: String? = nil, mac: String? = nil,
                ipv4: String? = nil, ipv6: String? = nil, netmask: String? = nil,
                mtu: Int? = nil, up: Bool? = nil) {
        self.name = name; self.type = type; self.mac = mac
        self.ipv4 = ipv4; self.ipv6 = ipv6; self.netmask = netmask
        self.mtu = mtu; self.up = up
    }

    internal static func from(_ d: [String: Any]) -> NetworkInterface {
        return NetworkInterface(
            name: (d["name"] as? String) ?? "",
            type: d["type"] as? String,
            mac: d["mac"] as? String,
            ipv4: d["ipv4"] as? String,
            ipv6: d["ipv6"] as? String,
            netmask: d["netmask"] as? String,
            mtu: d["mtu"] as? Int,
            up: d["up"] as? Bool
        )
    }
}

public struct NetworkInterfacesResponse: Sendable, Equatable {
    public let success: Bool
    public let interfaces: [NetworkInterface]

    public init(success: Bool, interfaces: [NetworkInterface]) {
        self.success = success; self.interfaces = interfaces
    }

    public static func decode(_ json: String) throws -> NetworkInterfacesResponse {
        let d = try parseDict(json)
        let arr = (d["interfaces"] as? [[String: Any]]) ?? []
        return NetworkInterfacesResponse(
            success: (d["success"] as? Bool) ?? false,
            interfaces: arr.map { NetworkInterface.from($0) }
        )
    }
}

/// `network.getStatus` 响应（总体网络状态）。
public struct NetworkStatusResponse: Sendable, Equatable {
    public let success: Bool
    public let online: Bool
    public let primaryInterface: String?
    public let gateway: String?
    public let dns: [String]

    public init(success: Bool, online: Bool, primaryInterface: String? = nil,
                gateway: String? = nil, dns: [String] = []) {
        self.success = success; self.online = online
        self.primaryInterface = primaryInterface; self.gateway = gateway; self.dns = dns
    }

    public static func decode(_ json: String) throws -> NetworkStatusResponse {
        let d = try parseDict(json)
        return NetworkStatusResponse(
            success: (d["success"] as? Bool) ?? false,
            online: (d["online"] as? Bool) ?? false,
            primaryInterface: d["primaryInterface"] as? String,
            gateway: d["gateway"] as? String,
            dns: (d["dns"] as? [String]) ?? []
        )
    }
}

/// `network.getPublicIP` 响应。
public struct PublicIPResponse: Sendable, Equatable {
    public let success: Bool
    public let ip: String
    public let ipv4: String?
    public let ipv6: String?

    public init(success: Bool, ip: String, ipv4: String? = nil, ipv6: String? = nil) {
        self.success = success; self.ip = ip; self.ipv4 = ipv4; self.ipv6 = ipv6
    }

    public static func decode(_ json: String) throws -> PublicIPResponse {
        let d = try parseDict(json)
        return PublicIPResponse(
            success: (d["success"] as? Bool) ?? false,
            ip: (d["ip"] as? String) ?? "",
            ipv4: d["ipv4"] as? String,
            ipv6: d["ipv6"] as? String
        )
    }
}

/// `network.getDNS` 响应。
public struct NetworkDNSResponse: Sendable, Equatable {
    public let success: Bool
    public let servers: [String]

    public init(success: Bool, servers: [String]) {
        self.success = success; self.servers = servers
    }

    public static func decode(_ json: String) throws -> NetworkDNSResponse {
        let d = try parseDict(json)
        return NetworkDNSResponse(
            success: (d["success"] as? Bool) ?? false,
            servers: (d["servers"] as? [String]) ?? []
        )
    }
}

/// Wi-Fi 信息。
public struct WifiInfo: Sendable, Equatable {
    public let connected: Bool
    public let ssid: String?
    public let bssid: String?
    public let signal: Int?           // dBm or 0-100 percent
    public let channel: Int?
    public let frequency: Int?         // MHz
    public let security: String?

    public init(connected: Bool, ssid: String? = nil, bssid: String? = nil,
                signal: Int? = nil, channel: Int? = nil, frequency: Int? = nil,
                security: String? = nil) {
        self.connected = connected; self.ssid = ssid; self.bssid = bssid
        self.signal = signal; self.channel = channel
        self.frequency = frequency; self.security = security
    }
}

public struct WifiResponse: Sendable, Equatable {
    public let success: Bool
    public let wifi: WifiInfo

    public init(success: Bool, wifi: WifiInfo) {
        self.success = success; self.wifi = wifi
    }

    public static func decode(_ json: String) throws -> WifiResponse {
        let d = try parseDict(json)
        let w = (d["wifi"] as? [String: Any]) ?? [:]
        return WifiResponse(
            success: (d["success"] as? Bool) ?? false,
            wifi: WifiInfo(
                connected: (w["connected"] as? Bool) ?? false,
                ssid: w["ssid"] as? String,
                bssid: w["bssid"] as? String,
                signal: w["signal"] as? Int,
                channel: w["channel"] as? Int,
                frequency: w["frequency"] as? Int,
                security: w["security"] as? String
            )
        )
    }
}

/// `network.getBandwidth` 响应（实时带宽）。
public struct BandwidthResponse: Sendable, Equatable {
    public let success: Bool
    public let downloadBytesPerSec: Int64
    public let uploadBytesPerSec: Int64
    public let interface: String?

    public init(success: Bool, downloadBytesPerSec: Int64, uploadBytesPerSec: Int64,
                interface: String? = nil) {
        self.success = success
        self.downloadBytesPerSec = downloadBytesPerSec
        self.uploadBytesPerSec = uploadBytesPerSec
        self.interface = interface
    }

    public static func decode(_ json: String) throws -> BandwidthResponse {
        let d = try parseDict(json)
        let dn: Int64
        let up: Int64
        if let n = d["downloadBytesPerSec"] as? Int64 { dn = n }
        else if let n = d["downloadBytesPerSec"] as? Int { dn = Int64(n) }
        else { dn = 0 }
        if let n = d["uploadBytesPerSec"] as? Int64 { up = n }
        else if let n = d["uploadBytesPerSec"] as? Int { up = Int64(n) }
        else { up = 0 }
        return BandwidthResponse(
            success: (d["success"] as? Bool) ?? false,
            downloadBytesPerSec: dn,
            uploadBytesPerSec: up,
            interface: d["interface"] as? String
        )
    }
}

/// `network.getSpeed` 响应（网速测试结果）。
public struct SpeedTestResponse: Sendable, Equatable {
    public let success: Bool
    public let downloadMbps: Double
    public let uploadMbps: Double
    public let pingMs: Int?
    public let server: String?

    public init(success: Bool, downloadMbps: Double, uploadMbps: Double,
                pingMs: Int? = nil, server: String? = nil) {
        self.success = success
        self.downloadMbps = downloadMbps; self.uploadMbps = uploadMbps
        self.pingMs = pingMs; self.server = server
    }

    public static func decode(_ json: String) throws -> SpeedTestResponse {
        let d = try parseDict(json)
        return SpeedTestResponse(
            success: (d["success"] as? Bool) ?? false,
            downloadMbps: (d["downloadMbps"] as? Double) ?? 0.0,
            uploadMbps: (d["uploadMbps"] as? Double) ?? 0.0,
            pingMs: d["pingMs"] as? Int,
            server: d["server"] as? String
        )
    }
}

/// `network.ping` 响应（含分组统计）。
public struct PingResponse: Sendable, Equatable {
    public let success: Bool
    public let host: String
    public let packetsSent: Int
    public let packetsReceived: Int
    public let packetLoss: Double            // percentage 0-100
    public let avgRttMs: Double

    public init(success: Bool, host: String, packetsSent: Int, packetsReceived: Int,
                packetLoss: Double, avgRttMs: Double) {
        self.success = success; self.host = host
        self.packetsSent = packetsSent; self.packetsReceived = packetsReceived
        self.packetLoss = packetLoss; self.avgRttMs = avgRttMs
    }

    public static func decode(_ json: String) throws -> PingResponse {
        let d = try parseDict(json)
        return PingResponse(
            success: (d["success"] as? Bool) ?? false,
            host: (d["host"] as? String) ?? "",
            packetsSent: (d["packetsSent"] as? Int) ?? 0,
            packetsReceived: (d["packetsReceived"] as? Int) ?? 0,
            packetLoss: (d["packetLoss"] as? Double) ?? 0.0,
            avgRttMs: (d["avgRttMs"] as? Double) ?? 0.0
        )
    }
}

/// `network.resolve` 响应（DNS 查询）。
public struct DNSResolveResponse: Sendable, Equatable {
    public let success: Bool
    public let host: String
    public let addresses: [String]
    public let error: String?

    public init(success: Bool, host: String, addresses: [String], error: String? = nil) {
        self.success = success; self.host = host
        self.addresses = addresses; self.error = error
    }

    public static func decode(_ json: String) throws -> DNSResolveResponse {
        let d = try parseDict(json)
        return DNSResolveResponse(
            success: (d["success"] as? Bool) ?? false,
            host: (d["host"] as? String) ?? "",
            addresses: (d["addresses"] as? [String]) ?? [],
            error: d["error"] as? String
        )
    }
}

/// `network.traceroute` 响应（路由跳数列表）。
public struct TracerouteHop: Sendable, Equatable {
    public let hop: Int
    public let host: String?
    public let ip: String?
    public let rttMs: Double?

    public init(hop: Int, host: String? = nil, ip: String? = nil, rttMs: Double? = nil) {
        self.hop = hop; self.host = host; self.ip = ip; self.rttMs = rttMs
    }
}

public struct TracerouteResponse: Sendable, Equatable {
    public let success: Bool
    public let host: String
    public let hops: [TracerouteHop]

    public init(success: Bool, host: String, hops: [TracerouteHop]) {
        self.success = success; self.host = host; self.hops = hops
    }

    public static func decode(_ json: String) throws -> TracerouteResponse {
        let d = try parseDict(json)
        let arr = (d["hops"] as? [[String: Any]]) ?? []
        return TracerouteResponse(
            success: (d["success"] as? Bool) ?? false,
            host: (d["host"] as? String) ?? "",
            hops: arr.map {
                TracerouteHop(
                    hop: ($0["hop"] as? Int) ?? 0,
                    host: $0["host"] as? String,
                    ip: $0["ip"] as? String,
                    rttMs: $0["rttMs"] as? Double
                )
            }
        )
    }
}

/// 网络连接（socket）信息 — 嵌套于 NetworkConnectionsResponse。
public struct NetworkConnection: Sendable, Equatable {
    public let protocolName: String       // tcp / udp / tcp6 / udp6
    public let localAddress: String
    public let localPort: Int
    public let remoteAddress: String?
    public let remotePort: Int?
    public let state: String?
    public let pid: Int?

    public init(protocolName: String, localAddress: String, localPort: Int,
                remoteAddress: String? = nil, remotePort: Int? = nil,
                state: String? = nil, pid: Int? = nil) {
        self.protocolName = protocolName
        self.localAddress = localAddress; self.localPort = localPort
        self.remoteAddress = remoteAddress; self.remotePort = remotePort
        self.state = state; self.pid = pid
    }

    internal static func from(_ d: [String: Any]) -> NetworkConnection {
        return NetworkConnection(
            protocolName: (d["protocol"] as? String) ?? "",
            localAddress: (d["localAddress"] as? String) ?? "",
            localPort: (d["localPort"] as? Int) ?? 0,
            remoteAddress: d["remoteAddress"] as? String,
            remotePort: d["remotePort"] as? Int,
            state: d["state"] as? String,
            pid: d["pid"] as? Int
        )
    }
}

public struct NetworkConnectionsResponse: Sendable, Equatable {
    public let success: Bool
    public let connections: [NetworkConnection]
    public let total: Int

    public init(success: Bool, connections: [NetworkConnection], total: Int) {
        self.success = success; self.connections = connections; self.total = total
    }

    public static func decode(_ json: String) throws -> NetworkConnectionsResponse {
        let d = try parseDict(json)
        let arr = (d["connections"] as? [[String: Any]]) ?? []
        return NetworkConnectionsResponse(
            success: (d["success"] as? Bool) ?? false,
            connections: arr.map { NetworkConnection.from($0) },
            total: (d["total"] as? Int) ?? arr.count
        )
    }
}
