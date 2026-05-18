import Foundation

/// Signaling URL 配置 — Phase 1.2 完整实现，1.1 仅占位。
///
/// 维护两个独立 URL：
/// - `customSignalingUrl`：当前实际使用的（LAN 直连 / 或扫码后切到的中继）
/// - `relayUrl`：公网中继 fallback URL（默认 `wss://signaling.chainlesschain.com`）
///
/// LAN 不通时 `ScanDesktopPairingViewModel` 会调 `setCustomSignalingUrl(relayUrl)`
/// 切到中继重试。
public final class SignalingConfig: @unchecked Sendable {
    public static let defaultRelayUrl = "wss://signaling.chainlesschain.com"

    private let userDefaults: UserDefaults
    private let customUrlKey = "signaling_custom_url"
    private let relayUrlKey = "signaling_relay_url"
    private let lock = NSLock()

    public init(userDefaults: UserDefaults = .standard) {
        self.userDefaults = userDefaults
    }

    public func getCustomSignalingUrl() -> String? {
        lock.lock(); defer { lock.unlock() }
        return userDefaults.string(forKey: customUrlKey)
    }

    public func setCustomSignalingUrl(_ url: String) {
        lock.lock(); defer { lock.unlock() }
        userDefaults.set(url, forKey: customUrlKey)
    }

    public func getRelayUrl() -> String {
        lock.lock(); defer { lock.unlock() }
        return userDefaults.string(forKey: relayUrlKey) ?? Self.defaultRelayUrl
    }

    public func setRelayUrl(_ url: String) {
        lock.lock(); defer { lock.unlock() }
        userDefaults.set(url, forKey: relayUrlKey)
    }
}
