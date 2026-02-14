//
//  WalletConnectService.swift
//  ChainlessChain
//
//  WalletConnect v2集成服务
//  委托到 WalletConnectManager 实现所有功能
//
//  Created by ChainlessChain on 2026-01-26.
//

import Foundation
import Combine

// MARK: - WalletConnect会话模型

/// WalletConnect会话
struct WCSession: Identifiable, Codable {
    let id: String              // 会话ID
    let topic: String           // 会话主题
    let dappName: String        // DApp名称
    let dappUrl: String         // DApp URL
    let dappIcon: String?       // DApp图标URL
    let chainIds: [Int]         // 支持的链ID
    let connectedAt: Date       // 连接时间
    var lastActiveAt: Date      // 最后活跃时间
    var isActive: Bool          // 是否活跃

    var displayName: String {
        dappName.isEmpty ? "Unknown DApp" : dappName
    }

    var displayUrl: String {
        guard let url = URL(string: dappUrl) else { return dappUrl }
        return url.host ?? dappUrl
    }
}

/// WalletConnect请求
struct WCRequest: Identifiable {
    let id: String
    let sessionId: String
    let method: String
    let params: [Any]
    let createdAt: Date

    enum Method: String {
        case personalSign = "personal_sign"
        case ethSign = "eth_sign"
        case ethSignTypedData = "eth_signTypedData"
        case ethSignTypedDataV4 = "eth_signTypedData_v4"
        case ethSendTransaction = "eth_sendTransaction"
        case ethSignTransaction = "eth_signTransaction"
        case walletSwitchEthereumChain = "wallet_switchEthereumChain"
        case walletAddEthereumChain = "wallet_addEthereumChain"
    }

    var methodEnum: Method? {
        Method(rawValue: method)
    }
}

// MARK: - WalletConnect服务

/// WalletConnect服务 — 委托到 WalletConnectManager
@MainActor
class WalletConnectService: ObservableObject {
    static let shared = WalletConnectService()

    @Published var sessions: [WCSession] = []
    @Published var pendingRequests: [WCRequest] = []
    @Published var isInitialized = false

    private let manager = WalletConnectManager.shared
    private var cancellables = Set<AnyCancellable>()

    private init() {
        Logger.shared.info("[WalletConnect] 服务初始化")
        setupBindings()
    }

    /// Bind to WalletConnectManager's published properties
    private func setupBindings() {
        manager.$isInitialized
            .receive(on: DispatchQueue.main)
            .assign(to: &$isInitialized)

        manager.$sessions
            .receive(on: DispatchQueue.main)
            .map { sessions in
                sessions.map { session in
                    WCSession(
                        id: session.id,
                        topic: session.pairingTopic,
                        dappName: session.dappName,
                        dappUrl: session.dappUrl,
                        dappIcon: session.dappIconUrl,
                        chainIds: session.chainIds,
                        connectedAt: session.connectedAt,
                        lastActiveAt: session.lastUsed,
                        isActive: session.isActive
                    )
                }
            }
            .assign(to: &$sessions)
    }

    // MARK: - 初始化

    /// 初始化WalletConnect SDK
    func initialize() async throws {
        try await manager.initialize()
        Logger.shared.info("[WalletConnect] SDK初始化成功")
    }

    // MARK: - 会话管理

    /// 通过URI连接DApp
    func connect(uri: String) async throws -> WCSession {
        try await manager.pair(uri: uri)

        // Return a placeholder session — the real session will arrive via publisher
        let session = WCSession(
            id: UUID().uuidString,
            topic: "pending",
            dappName: "Connecting...",
            dappUrl: "",
            dappIcon: nil,
            chainIds: [],
            connectedAt: Date(),
            lastActiveAt: Date(),
            isActive: true
        )

        Logger.shared.info("[WalletConnect] 配对请求已发送")

        return session
    }

    /// 断开会话
    func disconnect(sessionId: String) async throws {
        try await manager.disconnectSession(sessionId: sessionId)
        Logger.shared.info("[WalletConnect] 会话已断开: \(sessionId)")
    }

    /// 断开所有会话
    func disconnectAll() async throws {
        for session in sessions {
            try await disconnect(sessionId: session.id)
        }
        Logger.shared.info("[WalletConnect] 所有会话已断开")
    }

    // MARK: - 请求处理

    /// 批准请求
    func approveRequest(requestId: String, result: Any) async throws {
        // Delegate based on pending request type
        if let signatureResult = result as? String {
            // For sign requests, respond directly
            let wallet = WalletManager.shared.selectedWallet!
            _ = try await manager.approveSignMessage(
                requestId: requestId,
                message: "",
                wallet: wallet,
                password: ""
            )
        }

        Logger.shared.info("[WalletConnect] 请求已批准: \(requestId)")
    }

    /// 拒绝请求
    func rejectRequest(requestId: String, reason: String = "User rejected") async throws {
        try await manager.rejectRequest(requestId: requestId, reason: reason)
        pendingRequests.removeAll { $0.id == requestId }
        Logger.shared.info("[WalletConnect] 请求已拒绝: \(requestId)")
    }

    // MARK: - 辅助方法

    /// 获取活跃会话数
    var activeSessionCount: Int {
        sessions.filter { $0.isActive }.count
    }

    /// 获取待处理请求数
    var pendingRequestCount: Int {
        pendingRequests.count
    }

    /// 清理资源
    func cleanup() {
        sessions.removeAll()
        pendingRequests.removeAll()
        isInitialized = false
        Logger.shared.info("[WalletConnect] 服务已清理")
    }
}

// MARK: - 错误类型

enum WCError: LocalizedError {
    case notInitialized
    case sessionNotFound
    case requestNotFound
    case walletLocked
    case invalidTransaction
    case userRejected

    var errorDescription: String? {
        switch self {
        case .notInitialized:
            return "WalletConnect未初始化"
        case .sessionNotFound:
            return "会话不存在"
        case .requestNotFound:
            return "请求不存在"
        case .walletLocked:
            return "钱包已锁定，请先解锁"
        case .invalidTransaction:
            return "无效的交易数据"
        case .userRejected:
            return "用户拒绝"
        }
    }
}

// MARK: - 预览数据

#if DEBUG
extension WCSession {
    static let preview = WCSession(
        id: "preview-session",
        topic: "preview-topic",
        dappName: "Uniswap",
        dappUrl: "https://app.uniswap.org",
        dappIcon: nil,
        chainIds: [1, 137],
        connectedAt: Date(),
        lastActiveAt: Date(),
        isActive: true
    )

    static let previews: [WCSession] = [
        preview,
        WCSession(
            id: "preview-session-2",
            topic: "preview-topic-2",
            dappName: "OpenSea",
            dappUrl: "https://opensea.io",
            dappIcon: nil,
            chainIds: [1],
            connectedAt: Date().addingTimeInterval(-86400),
            lastActiveAt: Date().addingTimeInterval(-3600),
            isActive: false
        )
    ]
}
#endif
