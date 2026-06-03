import Foundation

/// 已配对桌面设备的持久化记录。与 Android `PairedDesktop` 字段严格对齐，禁止
/// 改字段名（schema 漂移会让跨平台同一台设备被识别为两台）。
///
/// `iceServersJson` 原样存 String 而非 `[IceServer]` struct 是 Phase 1 决策：
/// 保持与 Android schema 一致，避免任一端改字段时 silent 不兼容。Phase 2 真接
/// WebRTC 时由 `WebRTCClient.iceServers(fromJson:)` 解析。
public struct PairedDesktop: Codable, Identifiable, Equatable, Hashable {
    public let pcPeerId: String
    public let deviceName: String
    public let platform: String
    public let lanSignalingUrl: String?
    public let relayUrl: String?
    public let iceServersJson: String?
    public let iceExpiry: Int64
    public let pairedAt: Int64
    public let lastSeenAt: Int64

    public var id: String { pcPeerId }

    public init(
        pcPeerId: String,
        deviceName: String,
        platform: String = "desktop",
        lanSignalingUrl: String? = nil,
        relayUrl: String? = nil,
        iceServersJson: String? = nil,
        iceExpiry: Int64 = 0,
        pairedAt: Int64,
        lastSeenAt: Int64
    ) {
        self.pcPeerId = pcPeerId
        self.deviceName = deviceName
        self.platform = platform
        self.lanSignalingUrl = lanSignalingUrl
        self.relayUrl = relayUrl
        self.iceServersJson = iceServersJson
        self.iceExpiry = iceExpiry
        self.pairedAt = pairedAt
        self.lastSeenAt = lastSeenAt
    }
}
