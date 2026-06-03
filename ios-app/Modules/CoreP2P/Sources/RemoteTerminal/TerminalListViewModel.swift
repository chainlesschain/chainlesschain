import Foundation
import Combine

/// 远程终端 session 列表 ViewModel — Phase 2.4。
///
/// 镜像 Android `TerminalListViewModel`（设计 doc §6 Phase 2.4）：
/// - 进入 view 时 lazy 触发 `RemoteWebRTCClient.connect()` (DC handshake)
/// - 订阅 `webRTCClient.dataChannelReady` 流更新 `handshakeState`
/// - 通过 `terminalRpc.list/create/close` 管理 session 列表
/// - DC 还没握成时 `terminalRpc` 自动 fallback signaling，UI 显式标识 "中继路径"
///
/// **位置**：在 CoreP2P 模块（同 Phase 1.3 ScanDesktopPairingViewModel 等模式），
/// SwiftPM 单测可直接 import。SwiftUI 视图在 Features/RemoteTerminal/Views/。
@MainActor
public final class TerminalListViewModel: ObservableObject {

    public enum HandshakeState: Sendable, Equatable {
        case idle                          // 未触发
        case connecting                    // webRTCClient.connect 进行中
        case connectedDataChannel          // DC 握成 → 命令走 1 跳直连
        case connectedSignalingFallback    // DC 没成 / 失败 → 命令走 4 跳信令
        case failed(reason: String)
    }

    @Published public private(set) var sessions: [SessionRow] = []
    @Published public private(set) var handshakeState: HandshakeState = .idle
    @Published public private(set) var lastError: String?
    @Published public private(set) var isLoading: Bool = false

    public let pcPeerId: String
    private let webRTCClient: RemoteWebRTCClient
    private let terminalRpc: TerminalRpcClient
    private let currentDIDProvider: () -> String?

    private var dcReadinessTask: Task<Void, Never>?
    private var startedRpc = false

    public init(
        pcPeerId: String,
        webRTCClient: RemoteWebRTCClient,
        terminalRpc: TerminalRpcClient,
        currentDIDProvider: @escaping () -> String?
    ) {
        self.pcPeerId = pcPeerId
        self.webRTCClient = webRTCClient
        self.terminalRpc = terminalRpc
        self.currentDIDProvider = currentDIDProvider
    }

    deinit {
        dcReadinessTask?.cancel()
    }

    /// 视图 onAppear 时调用。Idempotent。
    public func onAppear() async {
        if !startedRpc {
            await terminalRpc.start()
            startedRpc = true
        }
        if dcReadinessTask == nil {
            subscribeToDataChannelReady()
        }
        await triggerHandshake()
        await refresh()
    }

    /// 重新拉 session 列表。
    public func refresh() async {
        isLoading = true
        defer { isLoading = false }
        let did = currentDIDProvider()
        do {
            let list = try await terminalRpc.list(pcPeerId: pcPeerId, mobileDid: did)
            sessions = list
            lastError = nil
        } catch {
            lastError = (error as NSError).localizedDescription
        }
    }

    /// 创建 session。成功返 [CreatedSession]（caller navigation 到 SessionView）。
    @discardableResult
    public func createSession(shell: String) async -> CreatedSession? {
        let did = currentDIDProvider()
        do {
            let created = try await terminalRpc.create(pcPeerId: pcPeerId, shell: shell, mobileDid: did)
            await refresh()
            return created
        } catch {
            lastError = "创建终端失败：\((error as NSError).localizedDescription)"
            return nil
        }
    }

    /// 关闭已存在的 session。
    public func closeSession(sessionId: String) async {
        let did = currentDIDProvider()
        do {
            try await terminalRpc.close(pcPeerId: pcPeerId, sessionId: sessionId, mobileDid: did)
            await refresh()
        } catch {
            lastError = "关闭终端失败：\((error as NSError).localizedDescription)"
        }
    }

    // MARK: - Private

    private func subscribeToDataChannelReady() {
        let stream = webRTCClient.dataChannelReady
        dcReadinessTask = Task { [weak self] in
            for await ready in stream {
                guard let self = self else { return }
                await MainActor.run {
                    if ready {
                        self.handshakeState = .connectedDataChannel
                    } else if case .connectedDataChannel = self.handshakeState {
                        // DC 之前 ready 现在丢了 → 降级到 signaling fallback
                        self.handshakeState = .connectedSignalingFallback
                    }
                }
            }
        }
    }

    private func triggerHandshake() async {
        let state = await webRTCClient.currentState
        if state == .ready {
            handshakeState = .connectedDataChannel
            return
        }
        guard let did = currentDIDProvider(), !did.isEmpty else {
            handshakeState = .failed(reason: "未找到本地 DID，请先在「桌面配对」创建身份")
            return
        }
        handshakeState = .connecting
        do {
            try await webRTCClient.connect(pcPeerId: pcPeerId, localPeerId: did)
            // 握成 → state 已被 webRTCClient 内部 transit 到 .ready；
            // dataChannelReady 流订阅会更新 handshakeState 为 .connectedDataChannel
        } catch {
            // DC 握手失败：signaling 仍可工作，命令走 4 跳兜底
            handshakeState = .connectedSignalingFallback
            lastError = "DC 握手失败 (\((error as NSError).localizedDescription))；命令将走中继路径"
        }
    }
}
