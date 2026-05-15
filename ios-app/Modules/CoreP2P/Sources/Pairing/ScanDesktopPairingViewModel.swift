import Foundation
import Combine

/// Mobile 端扫描桌面 QR ViewModel — Phase 1.3 完整实现 (Flow B)。
///
/// 镜像 Android `feature-p2p/.../ScanDesktopPairingViewModel.kt` 1:1（除 iOS HIG
/// 偏离白名单），状态机 4 态、错误文案分类、LAN→relay fallback 逻辑全照抄。已
/// Xiaomi 24115RA8EC 真机 E2E 验证（commit `c47cbc649`）。
///
/// **位置**：本类在 CoreP2P 模块（不是 Features/Pairing/ViewModels/）—— 纯
/// Foundation + Combine，无 UIKit 依赖，可在 SwiftPM 测目标直接 unit 测。SwiftUI
/// 视图 `Features/Pairing/Views/ScanDesktopPairingView` 通过 @StateObject 持有本类。
@MainActor
public final class ScanDesktopPairingViewModel: ObservableObject {

    public enum State: Equatable {
        case scanning
        case sending(desktopName: String)
        case success(desktopName: String)
        case failed(reason: String)
    }

    @Published public private(set) var state: State = .scanning

    private let signalingGate: PairingSignalingGate
    private let signalingConfig: SignalingConfig
    private let pairedDesktopsStore: PairedDesktopsStore
    private let deviceInfoProvider: PairingDeviceInfoProvider
    private let clock: PairingClock
    /// 注入当前活跃 DID（接 AppState.currentDID）。Closure 让 ViewModel 不耦合 app 层。
    private let currentDIDProvider: () -> String?

    private static let pairingTimeoutMs: Int64 = 5 * 60 * 1000

    public init(
        signalingGate: PairingSignalingGate,
        signalingConfig: SignalingConfig,
        pairedDesktopsStore: PairedDesktopsStore,
        deviceInfoProvider: PairingDeviceInfoProvider,
        clock: PairingClock = SystemPairingClock(),
        currentDIDProvider: @escaping () -> String?
    ) {
        self.signalingGate = signalingGate
        self.signalingConfig = signalingConfig
        self.pairedDesktopsStore = pairedDesktopsStore
        self.deviceInfoProvider = deviceInfoProvider
        self.clock = clock
        self.currentDIDProvider = currentDIDProvider
    }

    /// 扫到 QR 时回调。重复扫同 QR 是 idempotent — 第二次直接走 success 路径，
    /// 不发重复 ack（与 Android 行 58-62 一致）。
    public func onQrScanned(_ rawJson: String) {
        guard case .scanning = state else { return }
        Task { await processScannedJson(rawJson) }
    }

    public func retry() {
        state = .scanning
    }

    // MARK: - Internal

    private func processScannedJson(_ rawJson: String) async {
        do {
            let payload = try parsePayload(rawJson)
            try validate(payload: payload)
            // validate() guarantees pcPeerId is non-nil; bind to local for downstream uses.
            guard let peerId = payload.pcPeerId else {
                state = .failed(reason: "缺少 pcPeerId")
                return
            }

            // v1.3+ 零配置：QR 含 signalingUrl 时立刻持久化（修 #21 「Connect timeout」复现）
            if let url = payload.signalingUrl, url.hasPrefix("ws") {
                signalingConfig.setCustomSignalingUrl(url)
            }
            if let url = payload.relayUrl, url.hasPrefix("ws") {
                signalingConfig.setRelayUrl(url)
            }

            guard let did = currentDIDProvider(), !did.isEmpty else {
                state = .failed(reason: "本地未找到 DID，请先创建身份")
                return
            }

            state = .sending(desktopName: payload.desktopName)

            let ackPayload: [String: Any] = [
                "type": "pair-ack",
                "pairingCode": payload.code,
                "mobileDid": did,
                "deviceInfo": [
                    "deviceId": deviceInfoProvider.deviceId(),
                    "name": deviceInfoProvider.name(),
                    "platform": deviceInfoProvider.platform()
                ],
                "timestamp": clock.nowMillis()
            ]

            do {
                try await signalingGate.sendAck(toPeerId: peerId, ackPayload: ackPayload)
            } catch {
                let lanErr = (error as NSError).localizedDescription
                // LAN 失败 → 切到 relay 重试一次（与 Android 行 142-161 一致）
                await signalingGate.reset()
                let relayUrl = signalingConfig.getRelayUrl()
                signalingConfig.setCustomSignalingUrl(relayUrl)
                do {
                    try await signalingGate.sendAck(toPeerId: peerId, ackPayload: ackPayload)
                } catch {
                    let relayErr = (error as NSError).localizedDescription
                    state = .failed(reason: "通知桌面失败 (LAN: \(lanErr); 中继: \(relayErr))")
                    return
                }
            }

            // 持久化已配对桌面（v1.3+，让首页 PairedDevicesListView 不再依赖 live WS）
            let now = clock.nowMillis()
            let paired = PairedDesktop(
                pcPeerId: peerId,
                deviceName: payload.desktopName,
                platform: payload.desktopPlatform ?? "desktop",
                lanSignalingUrl: payload.signalingUrl,
                relayUrl: payload.relayUrl,
                iceServersJson: payload.iceServersJson,
                iceExpiry: payload.iceExpiry,
                pairedAt: now,
                lastSeenAt: now
            )
            await pairedDesktopsStore.upsert(paired)

            state = .success(desktopName: payload.desktopName)
        } catch let err as ScanFailure {
            state = .failed(reason: err.message)
        } catch {
            state = .failed(reason: error.localizedDescription)
        }
    }

    private func parsePayload(_ rawJson: String) throws -> ParsedQRPayload {
        guard let data = rawJson.data(using: .utf8),
              let raw = try? JSONSerialization.jsonObject(with: data) else {
            throw ScanFailure(message: "扫到的 QR 不是桌面配对码，请扫桌面 → 设置 → 移动桥 → 重新生成的 QR\n收到: \(String(rawJson.prefix(60)))")
        }
        guard let json = raw as? [String: Any] else {
            throw ScanFailure(message: "扫到的 QR 不是桌面配对码 (JSON 不是 object)")
        }
        let type = json["type"] as? String
        let code = json["code"] as? String
        let pcPeerId = json["pcPeerId"] as? String
        let timestamp = (json["timestamp"] as? Int64)
            ?? Int64(json["timestamp"] as? Int ?? 0)
        let deviceInfo = json["deviceInfo"] as? [String: Any]
        let desktopName = (deviceInfo?["name"] as? String) ?? "Desktop"
        let desktopPlatform = deviceInfo?["platform"] as? String

        let signalingUrl = json["signalingUrl"] as? String
        let relayUrl = json["relayUrl"] as? String

        // iceServers 原样存 JSON 字符串（与 Android 对齐 + Q4ICE-storage 决策）
        var iceServersJson: String?
        if let iceServers = json["iceServers"],
           let data = try? JSONSerialization.data(withJSONObject: iceServers, options: []) {
            iceServersJson = String(data: data, encoding: .utf8)
        }
        let iceExpiry = (json["iceExpiry"] as? Int64)
            ?? Int64(json["iceExpiry"] as? Int ?? 0)

        return ParsedQRPayload(
            type: type,
            code: code,
            pcPeerId: pcPeerId,
            timestamp: timestamp,
            desktopName: desktopName,
            desktopPlatform: desktopPlatform,
            signalingUrl: signalingUrl,
            relayUrl: relayUrl,
            iceServersJson: iceServersJson,
            iceExpiry: iceExpiry
        )
    }

    private func validate(payload: ParsedQRPayload) throws {
        guard payload.type == "desktop-pairing" else {
            throw ScanFailure(message: "不是桌面配对 QR (type=\(payload.type ?? "nil"))")
        }
        guard let code = payload.code,
              let regex = try? NSRegularExpression(pattern: "^\\d{6}$"),
              regex.firstMatch(in: code, options: [], range: NSRange(location: 0, length: code.utf16.count)) != nil else {
            throw ScanFailure(message: "配对码必须是 6 位数字")
        }
        guard let pcPeerId = payload.pcPeerId, !pcPeerId.isEmpty else {
            throw ScanFailure(message: "缺少 pcPeerId")
        }
        let age = clock.nowMillis() - payload.timestamp
        if age > Self.pairingTimeoutMs {
            throw ScanFailure(message: "QR 已过期 (\(age / 1000)s > 300s)，请桌面重新生成")
        }
    }
}

// MARK: - Helpers

private struct ParsedQRPayload {
    let type: String?
    let code: String?
    let pcPeerId: String?
    let timestamp: Int64
    let desktopName: String
    let desktopPlatform: String?
    let signalingUrl: String?
    let relayUrl: String?
    let iceServersJson: String?
    let iceExpiry: Int64
}

private struct ScanFailure: Error {
    let message: String
}
