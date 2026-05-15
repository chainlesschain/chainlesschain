import Foundation

/// 抽象设备信息提供，方便测试注入 fake。
///
/// **iOS 实现要点（Q4 决策）**：`deviceId()` 必须用 Keychain 持久化的 UUID，
/// **不能**直接用 `UIDevice.identifierForVendor`（重装 app 会变 → 桌面把同一台
/// iPhone 当成两台设备）。Keychain 持久化的 UUID 重装不变，是 iOS 行业标准做法。
///
/// 生产实现在 `Features/Pairing/Services/IOSPairingDeviceInfoProvider.swift`
/// （Phase 1.3 实现）。
public protocol PairingDeviceInfoProvider: Sendable {
    /// 设备稳定 ID — Keychain 持久化的 UUID，重装 app 不变。
    func deviceId() -> String

    /// 用户可读设备名 — `UIDevice.current.name` (e.g. "Xiaolong's iPhone")。
    func name() -> String

    /// 平台标识，恒为 "ios"。
    func platform() -> String
}
