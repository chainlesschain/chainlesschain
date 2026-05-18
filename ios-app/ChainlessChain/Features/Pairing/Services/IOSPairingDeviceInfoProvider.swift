import Foundation
import UIKit
import CoreP2P
import CoreSecurity

/// 生产 `PairingDeviceInfoProvider` 实现 — Phase 1.3 (Q4 决策)。
///
/// **关键**：deviceId 用 Keychain 持久化的 UUID，**不**直接用
/// `UIDevice.identifierForVendor`。后者重装 app 会变 → 桌面把同一台 iPhone
/// 当成两台设备，已配对列表脏数据。Keychain UUID 重装不变是 iOS 行业标准。
///
/// Keychain 写入用 `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`（KeychainManager
/// 默认），不会跨设备 iCloud 同步（避免同账号多 iPhone 共享一个 deviceId）。
public final class IOSPairingDeviceInfoProvider: PairingDeviceInfoProvider {
    private let keychain: KeychainManager
    private let keychainKey: String
    private let lock = NSLock()
    private var cachedDeviceId: String?

    public init(
        keychain: KeychainManager = .shared,
        keychainKey: String = "pairing.device_id"
    ) {
        self.keychain = keychain
        self.keychainKey = keychainKey
    }

    public func deviceId() -> String {
        lock.lock(); defer { lock.unlock() }
        if let cached = cachedDeviceId { return cached }
        if let stored = try? keychain.loadString(forKey: keychainKey), !stored.isEmpty {
            cachedDeviceId = stored
            return stored
        }
        let fresh = UUID().uuidString
        // 写失败不致命 —— 退化为 process-lifetime ID（重启 app 会变）。Phase 2 加 retry。
        try? keychain.save(fresh, forKey: keychainKey)
        cachedDeviceId = fresh
        return fresh
    }

    public func name() -> String {
        // UIDevice.current.name 在 iOS 16+ 默认返「iPhone」(隐私限制)，
        // 17+ 用户可在 Settings → Privacy → Device Name 显式授权返真名。
        // 这里直接用即可，对配对场景足够。
        return UIDevice.current.name
    }

    public func platform() -> String {
        "ios"
    }
}
