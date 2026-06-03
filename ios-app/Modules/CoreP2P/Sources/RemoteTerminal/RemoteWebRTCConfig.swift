import Foundation

/// WebRTC 连接配置 — Phase 2.1。
///
/// `iceServers` 来源 = `PairedDesktopsStore.iceServersJson`（Phase 1 持久化的
/// 24h coturn 凭证）。Phase 2 客户端创建时从 store 读 + 解析 JSON 注入本配置。
///
/// **JSON 格式**（与桌面 `desktop-pair-handlers.signIceCredentials` 输出对齐）：
/// ```json
/// [
///   {"urls": ["stun:turn.chainlesschain.com:3478"]},
///   {
///     "urls": ["turn:turn.chainlesschain.com:3478?transport=udp", ...],
///     "username": "<expiry>:<peerId>",
///     "credential": "<base64 hmac>"
///   }
/// ]
/// ```
///
/// 解析失败 → 降级到 Google STUN-only fallback（与 Phase 1 `WebRTCManager`
/// 默认行为一致），UI 应显示 "TURN 不可用" 警告，跨 NAT 场景可能不通。
public struct RemoteWebRTCConfig: Sendable, Equatable {
    public let iceServers: [IceServer]

    public init(iceServers: [IceServer]) {
        self.iceServers = iceServers
    }

    /// 默认 fallback — 仅 Google STUN，跨 NAT 场景可能不通。
    public static let stunOnlyFallback = RemoteWebRTCConfig(iceServers: [
        IceServer(urls: ["stun:stun.l.google.com:19302"], username: nil, credential: nil),
        IceServer(urls: ["stun:stun1.l.google.com:19302"], username: nil, credential: nil),
    ])

    /// 从 PairedDesktopsStore.iceServersJson 解析。失败返 fallback。
    public static func parse(jsonString: String?) -> RemoteWebRTCConfig {
        guard let jsonString = jsonString,
              let data = jsonString.data(using: .utf8) else {
            return .stunOnlyFallback
        }
        do {
            let raw = try JSONSerialization.jsonObject(with: data)
            guard let array = raw as? [[String: Any]] else {
                return .stunOnlyFallback
            }
            let parsed = array.compactMap { dict -> IceServer? in
                let urls: [String]
                if let strs = dict["urls"] as? [String] {
                    urls = strs
                } else if let str = dict["urls"] as? String {
                    urls = [str]
                } else {
                    return nil
                }
                return IceServer(
                    urls: urls,
                    username: dict["username"] as? String,
                    credential: dict["credential"] as? String
                )
            }
            return parsed.isEmpty ? .stunOnlyFallback : RemoteWebRTCConfig(iceServers: parsed)
        } catch {
            return .stunOnlyFallback
        }
    }
}

public struct IceServer: Sendable, Equatable {
    public let urls: [String]
    public let username: String?
    public let credential: String?

    public init(urls: [String], username: String?, credential: String?) {
        self.urls = urls
        self.username = username
        self.credential = credential
    }
}
