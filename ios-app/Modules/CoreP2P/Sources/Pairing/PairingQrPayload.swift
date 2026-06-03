import Foundation

/// Mobile 显示给桌面扫描的 QR JSON payload — Flow A。
///
/// 字段与桌面 `device-pairing-handler.js::validatePairingCode` 严格对齐
/// （memory `desktop_qr_pairing_flow_a.md`）。**禁止改字段名** — 改一处就 break
/// 桌面 + Android 兼容。
public struct PairingQrPayload: Codable, Equatable, Sendable {
    public let type: String          // 恒 "device-pairing"
    public let code: String          // ^\d{6}$
    public let did: String           // mobile DID
    public let deviceInfo: PairingDeviceInfo
    public let timestamp: Int64      // epoch-ms，桌面用此判 5min 过期

    public init(type: String = "device-pairing", code: String, did: String, deviceInfo: PairingDeviceInfo, timestamp: Int64) {
        self.type = type
        self.code = code
        self.did = did
        self.deviceInfo = deviceInfo
        self.timestamp = timestamp
    }
}

public struct PairingDeviceInfo: Codable, Equatable, Sendable {
    public let deviceId: String
    public let name: String
    public let platform: String

    public init(deviceId: String, name: String, platform: String) {
        self.deviceId = deviceId
        self.name = name
        self.platform = platform
    }
}
