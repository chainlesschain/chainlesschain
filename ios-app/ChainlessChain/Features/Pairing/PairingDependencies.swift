import Foundation
import CoreP2P

/// DI container — Phase 1.1 决策 Q2：禁 `static let shared` 单例，所有 protocol
/// 实例显式注入。XCTest 注入 fake 干净，ViewModel 不依赖全局单例（与现有
/// `WebRTCManager.shared` 模式相反，已被实战吐槽过测试难）。
///
/// 本 struct 在 `ChainlessChainApp` 顶层 lazy-build 一次，经
/// `@EnvironmentObject` 透传给 `PairingHomeView` + 子视图。每个 ViewModel
/// `init(deps: PairingDependencies)` 拉取自己需要的字段。
///
/// **Phase 1.3 起**：所有 protocol 都接通生产实现：
/// - `signalClient` + `signalingGate`：`WebSocketSignalClient` + `DefaultPairingSignalingGate` (CoreP2P)
/// - `deviceInfoProvider`：`IOSPairingDeviceInfoProvider`（Keychain UUID）
/// - `currentDIDProvider`：closure 接 `AppState.currentDID`，由 `ChainlessChainApp` 顶层注入
public final class PairingDependencies: ObservableObject {
    public let signalClient: SignalClient
    public let signalingGate: PairingSignalingGate
    public let messageBus: PairingMessageBus
    public let pairedDesktopsStore: PairedDesktopsStore
    public let signalingConfig: SignalingConfig
    public let deviceInfoProvider: PairingDeviceInfoProvider?
    public let clock: PairingClock
    public let currentDIDProvider: () -> String?

    public init(
        signalClient: SignalClient? = nil,
        signalingGate: PairingSignalingGate? = nil,
        messageBus: PairingMessageBus = DefaultPairingMessageBus(),
        pairedDesktopsStore: PairedDesktopsStore = PairedDesktopsStore(),
        signalingConfig: SignalingConfig = SignalingConfig(),
        deviceInfoProvider: PairingDeviceInfoProvider? = IOSPairingDeviceInfoProvider(),
        clock: PairingClock = SystemPairingClock(),
        currentDIDProvider: @escaping () -> String? = { nil }
    ) {
        let resolvedClient: SignalClient = signalClient ?? WebSocketSignalClient(
            signalingConfig: signalingConfig,
            messageBus: messageBus
        )
        self.signalClient = resolvedClient
        self.signalingGate = signalingGate ?? DefaultPairingSignalingGate(signalClient: resolvedClient)
        self.messageBus = messageBus
        self.pairedDesktopsStore = pairedDesktopsStore
        self.signalingConfig = signalingConfig
        self.deviceInfoProvider = deviceInfoProvider
        self.clock = clock
        self.currentDIDProvider = currentDIDProvider
    }
}
