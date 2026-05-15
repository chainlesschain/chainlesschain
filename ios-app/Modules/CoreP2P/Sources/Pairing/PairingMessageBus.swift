import Foundation

/// Pairing 信令消息总线 — Phase 1.5 (Flow A) 接通。
///
/// 对应 Android `core-p2p/.../pairing/PairingMessageBus.kt`。Flow A 路径：
/// desktop 扫 mobile QR 后经信令发 `pairing:confirmation`，本 bus 把消息从
/// `WebSocketSignalClient` 异步投递给 `DesktopPairingViewModel`。
///
/// `AsyncStream` 而非 Combine `PassthroughSubject` 是因为：(1) 与 Kotlin
/// `SharedFlow` 语义最近（事件流，无 latest value）；(2) ViewModel `init`
/// 里 `Task { for await c in bus.confirmations { ... } }` 自然取消；
/// (3) Combine cancellables bag 在 ViewModel 生命周期管理上更繁琐。
public protocol PairingMessageBus: AnyObject, Sendable {
    var confirmations: AsyncStream<PairingConfirmation> { get }
    func emit(_ confirmation: PairingConfirmation)
}

public final class DefaultPairingMessageBus: PairingMessageBus, @unchecked Sendable {
    private var continuation: AsyncStream<PairingConfirmation>.Continuation?
    public let confirmations: AsyncStream<PairingConfirmation>

    public init() {
        var local: AsyncStream<PairingConfirmation>.Continuation!
        self.confirmations = AsyncStream(bufferingPolicy: .bufferingNewest(8)) { cont in
            local = cont
        }
        self.continuation = local
    }

    public func emit(_ confirmation: PairingConfirmation) {
        continuation?.yield(confirmation)
    }
}
