import Foundation
import Combine
import CoreP2P

public enum RemoteSessionApprovalChoice {
    case once
    case turn
    case session
    case decline
}

public struct RemoteSessionApprovalCard: Identifiable {
    public var id: String { requestId }
    public let requestId: String
    public let tool: String?
    public let detail: String?
    public let fingerprint: String?
    public let binding: String?
    public let revision: Any?
    public let requestedPermissions: [RemoteApprovalPermissionGrant]

    public var requestedPermissionDescriptions: [String] {
        requestedPermissions.map { grant in
            var description = "\(grant.capability) — \(grant.scope)"
            if let expiresAt = grant.expiresAt, case .string(let value) = expiresAt {
                description += " (until \(value))"
            }
            return description
        }
    }
}

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
    public let remoteSessionClient: RemoteSessionClient

    @Published public private(set) var remoteSessionStatus: RemoteSessionStatus = .idle
    @Published public private(set) var remoteSessionError: String?
    @Published public private(set) var remoteSessionApprovals: [RemoteSessionApprovalCard] = []

    public init(
        signalClient: SignalClient? = nil,
        signalingGate: PairingSignalingGate? = nil,
        messageBus: PairingMessageBus = DefaultPairingMessageBus(),
        pairedDesktopsStore: PairedDesktopsStore = PairedDesktopsStore(),
        signalingConfig: SignalingConfig = SignalingConfig(),
        deviceInfoProvider: PairingDeviceInfoProvider? = IOSPairingDeviceInfoProvider(),
        clock: PairingClock = SystemPairingClock(),
        remoteSessionClient: RemoteSessionClient? = nil,
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
        let resolvedRemoteSessionClient = remoteSessionClient ?? RemoteSessionClient(
            webSocketFactory: URLSessionRemoteSessionWebSocket.factory()
        )
        self.remoteSessionClient = resolvedRemoteSessionClient
        resolvedRemoteSessionClient.onStatusChange = { [weak self] status in
            DispatchQueue.main.async {
                self?.remoteSessionStatus = status
                if status == .connected { self?.remoteSessionError = nil }
                if status == .revoked { self?.remoteSessionApprovals = [] }
            }
        }
        resolvedRemoteSessionClient.onError = { [weak self] message in
            DispatchQueue.main.async { self?.remoteSessionError = message }
        }
        resolvedRemoteSessionClient.onEvent = { [weak self] event in
            DispatchQueue.main.async { self?.recordRemoteSessionEvent(event) }
        }
    }

    @discardableResult
    public func connectRemoteSession(uri: String) -> Bool {
        remoteSessionApprovals = []
        do {
            try remoteSessionClient.connect(uri)
            remoteSessionError = nil
            return true
        } catch {
            remoteSessionError = error.localizedDescription
            return false
        }
    }

    @discardableResult
    public func resumeRemoteSession() -> Bool {
        let resumed = remoteSessionClient.resumeAfterTransientFailure()
        if !resumed {
            remoteSessionError = "No recoverable Remote Session is available."
        }
        return resumed
    }

    public func disconnectRemoteSession() {
        remoteSessionClient.disconnect()
        remoteSessionApprovals = []
    }

    @discardableResult
    public func resolveRemoteApproval(
        _ card: RemoteSessionApprovalCard,
        choice: RemoteSessionApprovalChoice
    ) -> Bool {
        let decision: RemoteApprovalDecision
        let reviewedPermissions: [RemoteApprovalPermissionGrant]?
        switch choice {
        case .once:
            decision = .acceptOnce
            reviewedPermissions = nil
        case .decline:
            decision = .decline(reason: "user-declined")
            reviewedPermissions = nil
        case .turn:
            guard !card.requestedPermissions.isEmpty else {
                remoteSessionError = "Persistent approval requires reviewable permissions."
                return false
            }
            decision = .acceptForTurn(permissions: card.requestedPermissions)
            reviewedPermissions = card.requestedPermissions
        case .session:
            guard !card.requestedPermissions.isEmpty else {
                remoteSessionError = "Persistent approval requires reviewable permissions."
                return false
            }
            decision = .acceptForSession(permissions: card.requestedPermissions)
            reviewedPermissions = card.requestedPermissions
        }
        let sent = remoteSessionClient.resolveApproval(
            requestId: card.requestId,
            decision: decision,
            fingerprint: card.fingerprint,
            binding: card.binding,
            revision: card.revision,
            reviewedPermissions: reviewedPermissions
        )
        if sent {
            remoteSessionApprovals.removeAll { $0.requestId == card.requestId }
        } else {
            remoteSessionError = "Approval was already settled or could not be sent."
        }
        return sent
    }

    private func recordRemoteSessionEvent(_ event: RemoteSessionEvent) {
        guard let data = event.json.data(using: .utf8),
              let value = try? JSONSerialization.jsonObject(with: data),
              let json = value as? [String: Any]
        else { return }
        let requestId = (json["requestId"] as? String)
            ?? (json["approvalId"] as? String)
            ?? (json["id"] as? String)
            ?? ""
        guard !requestId.isEmpty else { return }
        switch event.type {
        case "permission.request", "approval.requested", "approval_request":
            guard remoteSessionClient.isApprovalPending(requestId),
                  !remoteSessionApprovals.contains(where: { $0.requestId == requestId })
            else { return }
            remoteSessionApprovals.append(RemoteSessionApprovalCard(
                requestId: requestId,
                tool: json["tool"] as? String,
                detail: (json["detail"] as? String) ?? (json["reason"] as? String),
                fingerprint: json["fingerprint"] as? String,
                binding: json["binding"] as? String,
                revision: json["revision"],
                requestedPermissions: parseReviewedPermissions(json) ?? []
            ))
        case "permission.resolved", "approval.resolved", "approval_resolved":
            remoteSessionApprovals.removeAll { $0.requestId == requestId }
        default:
            break
        }
    }

    private func parseReviewedPermissions(
        _ event: [String: Any]
    ) -> [RemoteApprovalPermissionGrant]? {
        let raw = event["requested_permissions"] ?? event["requestedPermissions"]
        guard let entries = raw as? [[String: Any]], (1...64).contains(entries.count) else {
            return nil
        }
        var grants: [RemoteApprovalPermissionGrant] = []
        for entry in entries {
            guard Set(entry.keys).isSubset(of: Set(["capability", "scope", "expiresAt"])),
                  let capability = entry["capability"] as? String,
                  (1...128).contains(capability.count),
                  let scope = entry["scope"] as? String,
                  (1...1_024).contains(scope.count)
            else { return nil }
            if let rawExpiry = entry["expiresAt"] {
                if rawExpiry is NSNull {
                    grants.append(RemoteApprovalPermissionGrant(
                        capability: capability,
                        scope: scope,
                        expiresAt: .null
                    ))
                } else if let value = rawExpiry as? String {
                    grants.append(RemoteApprovalPermissionGrant(
                        capability: capability,
                        scope: scope,
                        expiresAt: .string(value)
                    ))
                } else {
                    return nil
                }
            } else {
                grants.append(RemoteApprovalPermissionGrant(
                    capability: capability,
                    scope: scope
                ))
            }
        }
        return grants
    }
}
