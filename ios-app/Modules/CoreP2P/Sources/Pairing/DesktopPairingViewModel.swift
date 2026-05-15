import Foundation
import Combine

/// 桌面配对 ViewModel — Phase 1.5 完整实现 (Flow A)。
///
/// 镜像 Android `feature-p2p/.../viewmodel/DesktopPairingViewModel.kt` 1:1
/// （除 iOS HIG 偏离白名单），状态机 5 态、5min 过期、PairingMessageBus 订阅
/// 全照抄。已 Xiaomi 24115RA8EC 真机 E2E 验证（W3.2-W3.6）。
///
/// **架构**：mobile 显示 QR + 6 位 code，desktop 用摄像头扫，扫到后桌面经
/// 信令服务器发 `pairing:confirmation` 回 mobile（routed 到 mobile DID
/// peer-id）。`WebSocketSignalClient` 收到 type=="message" 且
/// `payload.type=="pairing:confirmation"` 时投递到 [PairingMessageBus]，本
/// ViewModel 在 init 起订阅、匹配 code 后 transit 到 .completed。
@MainActor
public final class DesktopPairingViewModel: ObservableObject {

    public enum State: Equatable {
        case idle
        case displaying(payloadJson: String, code: String, expiresAtMillis: Int64)
        case completed
        case expired
        case failed(reason: String)
    }

    @Published public private(set) var state: State = .idle

    private let signalingGate: PairingSignalingGate
    private let messageBus: PairingMessageBus
    private let deviceInfoProvider: PairingDeviceInfoProvider
    private let clock: PairingClock
    private let currentDIDProvider: () -> String?
    private let codeGenerator: () -> String

    private var expiryTask: Task<Void, Never>?
    private var subscriberTask: Task<Void, Never>?

    public static let pairingTimeoutMs: Int64 = 5 * 60 * 1000

    public init(
        signalingGate: PairingSignalingGate,
        messageBus: PairingMessageBus,
        deviceInfoProvider: PairingDeviceInfoProvider,
        clock: PairingClock = SystemPairingClock(),
        currentDIDProvider: @escaping () -> String?,
        codeGenerator: @escaping () -> String = DesktopPairingViewModel.defaultCodeGenerator
    ) {
        self.signalingGate = signalingGate
        self.messageBus = messageBus
        self.deviceInfoProvider = deviceInfoProvider
        self.clock = clock
        self.currentDIDProvider = currentDIDProvider
        self.codeGenerator = codeGenerator

        // 长存订阅 — bus 是 AsyncStream（缓冲 8 条），早到的 confirmation 会被丢弃；
        // 时序上 desktop 不可能在 mobile init 前发 confirmation，丢弃是安全的
        // （与 Android line 62-68 一致）。
        let stream = messageBus.confirmations
        self.subscriberTask = Task { [weak self] in
            for await confirmation in stream {
                await self?.handleConfirmation(confirmation)
            }
        }
    }

    deinit {
        expiryTask?.cancel()
        subscriberTask?.cancel()
    }

    /// 开始配对：生成 code + payload 进 .displaying。Idempotent — 反复调用
    /// 会重置 code/timestamp（与 Android `startPairing` 行为一致）。
    public func startPairing() {
        guard let did = currentDIDProvider(), !did.isEmpty else {
            state = .failed(reason: "未找到活跃 DID，请先创建或导入身份")
            return
        }
        let code = codeGenerator()
        let timestamp = clock.nowMillis()
        let payload = PairingQrPayload(
            code: code,
            did: did,
            deviceInfo: PairingDeviceInfo(
                deviceId: deviceInfoProvider.deviceId(),
                name: deviceInfoProvider.name(),
                platform: deviceInfoProvider.platform()
            ),
            timestamp: timestamp
        )
        guard let json = try? Self.encodeJSON(payload) else {
            state = .failed(reason: "QR payload 序列化失败")
            return
        }
        state = .displaying(payloadJson: json, code: code, expiresAtMillis: timestamp + Self.pairingTimeoutMs)

        scheduleExpiry()

        // 触发 signaling connect + register 让 mobile 收 desktop 经信令发的
        // pairing:confirmation。peer-id **必须用 DID** 因为 desktop sendConfirmation
        // 用 `to: qrPayload.did` 路由——mobile 注册的 peer-id 必须匹配，否则信令
        // 服务器找不到目标 drop 消息。失败不阻断 UI（与 Android line 110-117 一致）。
        Task { [weak self] in
            guard let self = self else { return }
            try? await self.signalingGate.ensureRegistered(localPeerId: did)
        }
    }

    public func cancelPairing() {
        expiryTask?.cancel()
        expiryTask = nil
        state = .idle
    }

    // MARK: - Internals

    private func scheduleExpiry() {
        expiryTask?.cancel()
        let timeoutNanos = UInt64(Self.pairingTimeoutMs) * 1_000_000
        expiryTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: timeoutNanos)
            await self?.maybeTransitToExpired()
        }
    }

    private func maybeTransitToExpired() {
        if case .displaying = state {
            state = .expired
        }
    }

    private func handleConfirmation(_ c: PairingConfirmation) {
        guard case .displaying(_, let code, _) = state else { return }
        guard code == c.pairingCode else { return }  // 不匹配 → 静默丢弃
        expiryTask?.cancel()
        expiryTask = nil
        state = .completed
    }

    /// 内部触发 expiry — **仅供测试**。生产由 [scheduleExpiry] 内 Task.sleep 触发。
    internal func _testTriggerExpiry() {
        maybeTransitToExpired()
    }

    // MARK: Helpers

    public static let defaultCodeGenerator: () -> String = {
        String(format: "%06d", Int.random(in: 100_000...999_999))
    }

    private static func encodeJSON(_ payload: PairingQrPayload) throws -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let data = try encoder.encode(payload)
        return String(data: data, encoding: .utf8) ?? ""
    }
}
