import Foundation

/// Desktop 经信令服务器发回的配对确认（Flow A）。字段与 desktop
/// `device-pairing-handler.js::sendConfirmation` 对齐。
public struct PairingConfirmation: Equatable, Hashable, Sendable {
    /// 6 位 pairing code，与 mobile QR 里的 [PairingQrPayload.code] 匹配
    public let pairingCode: String
    /// Desktop 的 peer-id，供 mobile 后续 WebRTC connect 用
    public let pcPeerId: String
    /// Desktop 端机器名 / platform 等元数据，可空
    public let deviceInfo: [String: String]?
    /// Desktop 发送时戳 epoch-ms
    public let timestamp: Int64

    public init(
        pairingCode: String,
        pcPeerId: String,
        deviceInfo: [String: String]?,
        timestamp: Int64
    ) {
        self.pairingCode = pairingCode
        self.pcPeerId = pcPeerId
        self.deviceInfo = deviceInfo
        self.timestamp = timestamp
    }
}
