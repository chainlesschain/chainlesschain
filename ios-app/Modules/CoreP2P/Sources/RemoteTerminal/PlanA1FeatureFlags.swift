import Foundation

/// Plan A.1 Feature flags — Phase 2.2。
///
/// 与 Android 端 `SharedPreferences("plan_a1_flags")` 同 key。两端独立可配，
/// 调试时改一边不需另一边同步（详见 design doc §5.4）。
///
/// **持久层**：UserDefaults（与 Phase 1 SignalingConfig 同模式）。第一次读
/// 返默认值（true / 5000 / true），写后立即生效。
///
/// **使用**：`TerminalRpcClient.invoke()` 检查 `preferDataChannel` 决定是否
/// 试 DC 路径；`dcSendTimeoutMs` 控 DC send 单次超时；`fallbackOnDcFailure`
/// 决定 DC 抛错时是否 fallback signaling（false = 直接报错给 UI，便于诊断）。
public final class PlanA1FeatureFlags: @unchecked Sendable {
    private let defaults: UserDefaults

    private let keyPreferDataChannel = "terminal.preferDataChannel"
    private let keyDcSendTimeoutMs = "terminal.dcSendTimeoutMs"
    private let keyFallbackOnDcFailure = "terminal.fallbackOnDcFailure"

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    public var preferDataChannel: Bool {
        get {
            // 用 object(forKey:) 区分 "未设置" vs "设置为 false"
            (defaults.object(forKey: keyPreferDataChannel) as? Bool) ?? true
        }
        set { defaults.set(newValue, forKey: keyPreferDataChannel) }
    }

    public var dcSendTimeoutMs: Int {
        get {
            let stored = defaults.integer(forKey: keyDcSendTimeoutMs)
            return stored > 0 ? stored : 5000
        }
        set { defaults.set(max(100, newValue), forKey: keyDcSendTimeoutMs) }
    }

    public var fallbackOnDcFailure: Bool {
        get {
            (defaults.object(forKey: keyFallbackOnDcFailure) as? Bool) ?? true
        }
        set { defaults.set(newValue, forKey: keyFallbackOnDcFailure) }
    }
}
