import Foundation
import Combine

/// 手输 6 位 code 配对 ViewModel — Phase 1.6 完整实现。
///
/// **wire 方案**（design doc §6.5 修订版）：复用 signaling 基础设施，桌面端
/// 在 Flow B QR active 时额外 register `pairing-code:<6digit>` 别名 peer-id；
/// iOS 手输 code 时直接 `sendAck(toPeerId: "pairing-code:<code>", envelope)`，
/// 信令服务器路由到桌面 → 走完全相同的 `recordPairAck` 路径。
///
/// **forward-compat**：桌面端 follow-up 未到位时，iOS 发往 `pairing-code:<code>`
/// 找不到 peer，signaling-server 返 `peer-offline` 通知 → 本类目前**不监听**
/// inbound peer-offline（Phase 2 上 request-response 时再加），所以会停留在
/// `.waitingForConfirm` 直到 60s 超时。UI 文案明确告知用户。
///
/// **状态机**：
///   .entering → .submitting → .waitingForConfirm → .completed | .failed(timeout/network)
///
/// 与 [DesktopPairingViewModel] 共享 PairingMessageBus 订阅模式 — 桌面端
/// `recordPairAck` 接受后会经信令发回 `pairing:confirmation`，本 VM 与 Flow A
/// 用同一 bus 路径接收。
@MainActor
public final class ManualPairingViewModel: ObservableObject {

    public enum State: Equatable {
        case entering
        case submitting(code: String)
        case waitingForConfirm(code: String, expiresAtMillis: Int64)
        case completed
        case failed(reason: String)
    }

    @Published public private(set) var state: State = .entering
    /// 用户输入 — View 双向绑定。
    @Published public var code: String = ""

    private let signalingGate: PairingSignalingGate
    private let messageBus: PairingMessageBus
    private let deviceInfoProvider: PairingDeviceInfoProvider
    private let clock: PairingClock
    private let currentDIDProvider: () -> String?

    private var subscriberTask: Task<Void, Never>?
    private var expiryTask: Task<Void, Never>?

    public static let confirmTimeoutMs: Int64 = 60 * 1000  // 60s — 比 Flow A 的 5min 短，桌面端已就位

    public init(
        signalingGate: PairingSignalingGate,
        messageBus: PairingMessageBus,
        deviceInfoProvider: PairingDeviceInfoProvider,
        clock: PairingClock = SystemPairingClock(),
        currentDIDProvider: @escaping () -> String?
    ) {
        self.signalingGate = signalingGate
        self.messageBus = messageBus
        self.deviceInfoProvider = deviceInfoProvider
        self.clock = clock
        self.currentDIDProvider = currentDIDProvider

        // 长存订阅 PairingMessageBus.confirmations — 与 DesktopPairingViewModel 同模式。
        let stream = messageBus.confirmations
        self.subscriberTask = Task { [weak self] in
            for await confirmation in stream {
                await self?.handleConfirmation(confirmation)
            }
        }
    }

    deinit {
        subscriberTask?.cancel()
        expiryTask?.cancel()
    }

    /// 提交手输 code。本方法是 main-thread sync — 实际网络 IO 在 Task 里。
    public func submit() {
        let trimmed = code.filter { $0.isNumber }
        guard trimmed.count == 6 else {
            state = .failed(reason: "请输入 6 位数字配对码")
            return
        }
        guard let did = currentDIDProvider(), !did.isEmpty else {
            state = .failed(reason: "未找到活跃 DID，请先创建身份")
            return
        }
        state = .submitting(code: trimmed)
        Task { [weak self] in
            await self?.performSubmit(code: trimmed, did: did)
        }
    }

    public func reset() {
        expiryTask?.cancel()
        expiryTask = nil
        code = ""
        state = .entering
    }

    // MARK: - Internals

    private func performSubmit(code: String, did: String) async {
        let now = clock.nowMillis()
        let envelope: [String: Any] = [
            "type": "pair-ack",
            "pairingCode": code,
            "mobileDid": did,
            "deviceInfo": [
                "deviceId": deviceInfoProvider.deviceId(),
                "name": deviceInfoProvider.name(),
                "platform": deviceInfoProvider.platform()
            ],
            "timestamp": now
        ]
        do {
            try await signalingGate.sendAck(
                toPeerId: "pairing-code:\(code)",
                ackPayload: envelope
            )
            let expiresAt = now + Self.confirmTimeoutMs
            state = .waitingForConfirm(code: code, expiresAtMillis: expiresAt)
            scheduleExpiry()
        } catch {
            let msg = (error as NSError).localizedDescription
            state = .failed(reason: """
                通知桌面失败：\(msg)

                请确认桌面已打开「设置 → 移动桥」，并启用了手动输入通道。\
                如长时间无效，建议改用「扫描桌面」方式。
                """)
        }
    }

    private func scheduleExpiry() {
        expiryTask?.cancel()
        let nanos = UInt64(Self.confirmTimeoutMs) * 1_000_000
        expiryTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: nanos)
            await self?.maybeTransitToTimeout()
        }
    }

    private func maybeTransitToTimeout() {
        guard case .waitingForConfirm(let code, _) = state else { return }
        state = .failed(reason: """
            桌面未在 60 秒内确认配对码 \(code)。

            可能原因：(1) 桌面端未启用手动输入通道（需 desktop follow-up 接通 `pairing-code:<code>` signaling 别名）；\
            (2) code 输入错误；(3) 网络问题。

            建议改用「扫描桌面」方式。
            """)
    }

    private func handleConfirmation(_ c: PairingConfirmation) {
        guard case .waitingForConfirm(let code, _) = state else { return }
        guard code == c.pairingCode else { return }  // 不匹配 → 静默丢弃
        expiryTask?.cancel()
        expiryTask = nil
        state = .completed
    }

    /// 仅供测试 — 直接触发 timeout，不等真 60s。
    internal func _testTriggerTimeout() {
        maybeTransitToTimeout()
    }
}
