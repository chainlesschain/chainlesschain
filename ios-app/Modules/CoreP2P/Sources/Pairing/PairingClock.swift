import Foundation

/// 抽象时钟。生产用 [SystemPairingClock]，测试可注入确定性 fake。
public protocol PairingClock: Sendable {
    func nowMillis() -> Int64
}

public struct SystemPairingClock: PairingClock {
    public init() {}

    public func nowMillis() -> Int64 {
        Int64(Date().timeIntervalSince1970 * 1000)
    }
}
