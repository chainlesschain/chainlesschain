//
//  WalletConnectService.swift
//  ChainlessChain
//
//  WalletConnect v2集成服务（基础框架）
//  支持DApp连接和交互
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

/// WalletConnect服务（基础框架）
@MainActor
class WalletConnectService: ObservableObject {
    static let shared = WalletConnectService()

    @Published var sessions: [WCSession] = []
    @Published var pendingRequests: [WCRequest] = []
    @Published var isInitialized = false

    private let walletManager = WalletManager.shared
    private let chainManager = ChainManager.shared
    private var cancellables = Set<AnyCancellable>()

    private init() {
        Logger.shared.info("[WalletConnect] 服务初始化")
    }

    // MARK: - 初始化

    /// 初始化WalletConnect SDK
    func initialize() async throws {
        guard !isInitialized else { return }

        // TODO: 实际初始化WalletConnect SDK
        // 需要添加 WalletConnectSwiftV2 依赖
        /*
        import WalletConnectSign

        let metadata = AppMetadata(
            name: "ChainlessChain",
            description: "Decentralized Personal AI Management System",
            url: "https://chainlesschain.app",
            icons: ["https://chainlesschain.app/icon.png"]
        )

        Sign.configure(crypto: DefaultCryptoProvider())
        */

        isInitialized = true
        Logger.shared.info("[WalletConnect] SDK初始化成功")

        // 加载已保存的会话
        await loadSessions()
    }

    // MARK: - 会话管理

    /// 通过URI连接DApp
    /// - Parameter uri: WalletConnect URI (wc:...)
    func connect(uri: String) async throws -> WCSession {
        guard isInitialized else {
            throw WCError.notInitialized
        }

        // TODO: 实际配对流程
        /*
        try await Sign.instance.pair(uri: uri)
        */

        // 模拟会话创建
        let session = WCSession(
            id: UUID().uuidString,
            topic: "mock-topic",
            dappName: "Mock DApp",
            dappUrl: "https://example.com",
            dappIcon: nil,
            chainIds: [1, 137],  // Ethereum, Polygon
            connectedAt: Date(),
            lastActiveAt: Date(),
            isActive: true
        )

        sessions.append(session)
        await saveSession(session)

        Logger.shared.info("[WalletConnect] 连接成功: \(session.dappName)")

        return session
    }

    /// 断开会话
    /// - Parameter sessionId: 会话ID
    func disconnect(sessionId: String) async throws {
        guard let index = sessions.firstIndex(where: { $0.id == sessionId }) else {
            throw WCError.sessionNotFound
        }

        // TODO: 实际断开流程
        /*
        let topic = sessions[index].topic
        try await Sign.instance.disconnect(topic: topic)
        */

        sessions.remove(at: index)
        await deleteSession(sessionId: sessionId)

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
    /// - Parameters:
    ///   - requestId: 请求ID
    ///   - result: 结果数据
    func approveRequest(requestId: String, result: Any) async throws {
        guard let request = pendingRequests.first(where: { $0.id == requestId }) else {
            throw WCError.requestNotFound
        }

        // TODO: 实际响应
        /*
        try await Sign.instance.respond(
            topic: request.sessionId,
            requestId: RequestId(requestId),
            response: .response(AnyCodable(result))
        )
        */

        // 从待处理列表移除
        pendingRequests.removeAll { $0.id == requestId }

        Logger.shared.info("[WalletConnect] 请求已批准: \(request.method)")
    }

    /// 拒绝请求
    /// - Parameters:
    ///   - requestId: 请求ID
    ///   - reason: 拒绝原因
    func rejectRequest(requestId: String, reason: String = "User rejected") async throws {
        guard let request = pendingRequests.first(where: { $0.id == requestId }) else {
            throw WCError.requestNotFound
        }

        // TODO: 实际拒绝
        /*
        try await Sign.instance.respond(
            topic: request.sessionId,
            requestId: RequestId(requestId),
            response: .error(.init(code: 5000, message: reason))
        )
        */

        pendingRequests.removeAll { $0.id == requestId }

        Logger.shared.info("[WalletConnect] 请求已拒绝: \(request.method)")
    }

    // MARK: - 签名方法

    /// 处理个人签名请求
    /// - Parameters:
    ///   - message: 消息
    ///   - wallet: 钱包
    /// - Returns: 签名
    private func personalSign(message: String, wallet: Wallet) async throws -> String {
        guard let privateKey = walletManager.getUnlockedPrivateKey(walletId: wallet.id) else {
            throw WCError.walletLocked
        }

        // 使用WalletCoreAdapter签名
        let signature = try WalletCoreAdapter.signMessage(message, privateKey: privateKey)

        return signature
    }

    /// 处理交易签名请求
    /// - Parameters:
    ///   - transaction: 交易数据
    ///   - wallet: 钱包
    /// - Returns: 签名的交易
    private func signTransaction(transaction: [String: Any], wallet: Wallet) async throws -> String {
        guard let privateKey = walletManager.getUnlockedPrivateKey(walletId: wallet.id) else {
            throw WCError.walletLocked
        }

        // 提取交易参数
        guard let to = transaction["to"] as? String,
              let value = transaction["value"] as? String,
              let gasLimit = transaction["gas"] as? String,
              let gasPrice = transaction["gasPrice"] as? String,
              let nonceHex = transaction["nonce"] as? String,
              let nonce = Int(nonceHex.dropFirst(2), radix: 16) else {
            throw WCError.invalidTransaction
        }

        let data = transaction["data"] as? String
        let chainId = (transaction["chainId"] as? String).flatMap { Int($0.dropFirst(2), radix: 16) } ?? 1

        // 签名交易
        let signedTx = try WalletCoreAdapter.signTransaction(
            privateKey: privateKey,
            to: to,
            amount: value,
            gasLimit: gasLimit,
            gasPrice: gasPrice,
            nonce: nonce,
            data: data,
            chainId: chainId
        )

        return signedTx
    }

    // MARK: - 数据持久化

    /// 保存会话
    private func saveSession(_ session: WCSession) async {
        // TODO: 保存到数据库或UserDefaults
        Logger.shared.debug("[WalletConnect] 会话已保存: \(session.id)")
    }

    /// 加载会话
    private func loadSessions() async {
        // TODO: 从数据库或UserDefaults加载
        Logger.shared.debug("[WalletConnect] 会话已加载")
    }

    /// 删除会话
    private func deleteSession(sessionId: String) async {
        // TODO: 从数据库删除
        Logger.shared.debug("[WalletConnect] 会话已删除: \(sessionId)")
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
