import Foundation
import Combine

/// 持久化已配对桌面列表 — Phase 1.3 提前完成 1.4 范围（VM 写库依赖）。
///
/// `actor` 天然串行化 upsert/remove/devices 访问，避免 SwiftUI 多线程 race
/// （对应 Android 用 SharedFlow + atomic value reset 的隐式串行化）。
///
/// 持久层 = UserDefaults JSON（与 Android SharedPreferences 1:1 对应）。数据量
/// 小（一个用户预期 < 10 台桌面），不值得引入 SQLite。
///
/// `devicesPublisher()` 是 nonisolated 的 Combine source — SwiftUI 视图直接
/// `.onReceive` 订阅；actor 内部 upsert/remove 用 [updateSubject] 写。
public actor PairedDesktopsStore {
    private let userDefaults: UserDefaults
    private let key: String
    nonisolated private let subject: CurrentValueSubject<[PairedDesktop], Never>

    public init(
        userDefaults: UserDefaults = .standard,
        key: String = "paired_desktops"
    ) {
        self.userDefaults = userDefaults
        self.key = key
        let initial = Self.loadFromDefaults(userDefaults: userDefaults, key: key)
        self.subject = CurrentValueSubject<[PairedDesktop], Never>(initial)
    }

    public func devices() async -> [PairedDesktop] {
        subject.value
    }

    public nonisolated func devicesPublisher() -> AnyPublisher<[PairedDesktop], Never> {
        subject.eraseToAnyPublisher()
    }

    /// upsert by pcPeerId 去重 — 已存在则保留原 pairedAt 仅更其它字段，新增则 append。
    public func upsert(_ desktop: PairedDesktop) async {
        var current = subject.value
        if let idx = current.firstIndex(where: { $0.pcPeerId == desktop.pcPeerId }) {
            // 保留原 pairedAt（首次配对时间不变），其它字段（含 lastSeenAt / iceServers）覆盖
            let originalPairedAt = current[idx].pairedAt
            current[idx] = PairedDesktop(
                pcPeerId: desktop.pcPeerId,
                deviceName: desktop.deviceName,
                platform: desktop.platform,
                lanSignalingUrl: desktop.lanSignalingUrl,
                relayUrl: desktop.relayUrl,
                iceServersJson: desktop.iceServersJson,
                iceExpiry: desktop.iceExpiry,
                pairedAt: originalPairedAt,
                lastSeenAt: desktop.lastSeenAt
            )
        } else {
            current.append(desktop)
        }
        persist(current)
    }

    public func remove(pcPeerId: String) async {
        let filtered = subject.value.filter { $0.pcPeerId != pcPeerId }
        persist(filtered)
    }

    public func clear() async {
        userDefaults.removeObject(forKey: key)
        subject.send([])
    }

    // MARK: Private

    private func persist(_ devices: [PairedDesktop]) {
        do {
            let data = try JSONEncoder().encode(devices)
            userDefaults.set(data, forKey: key)
        } catch {
            // 编码失败仅 best-effort — in-memory state 仍准
        }
        subject.send(devices)
    }

    private static func loadFromDefaults(userDefaults: UserDefaults, key: String) -> [PairedDesktop] {
        guard let data = userDefaults.data(forKey: key),
              let decoded = try? JSONDecoder().decode([PairedDesktop].self, from: data) else {
            return []
        }
        return decoded
    }
}
