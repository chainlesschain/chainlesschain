import Foundation
import Combine
import WalletConnectSign
import WalletConnectPairing
import WalletConnectNetworking

/// WalletConnectManager - WalletConnect v2 Integration
/// Phase 2.0: DApp Browser
/// Handles WalletConnect sessions, requests, and DApp connections

public class WalletConnectManager: ObservableObject {
    public static let shared = WalletConnectManager()

    // MARK: - Published Properties

    @Published public var sessions: [WalletConnectSession] = []
    @Published public var pendingRequests: [WalletConnectRequest] = []
    @Published public var isInitialized = false

    // MARK: - Event Publishers

    public let sessionProposal = PassthroughSubject<SessionProposal, Never>()
    public let sessionConnected = PassthroughSubject<WalletConnectSession, Never>()
    public let sessionDisconnected = PassthroughSubject<String, Never>()
    public let requestReceived = PassthroughSubject<WalletConnectRequest, Never>()

    // MARK: - Dependencies

    private let walletManager = WalletManager.shared
    private let transactionManager = TransactionManager.shared
    private let database: Database

    // MARK: - Private Properties

    private var cancellables = Set<AnyCancellable>()
    private let projectId: String
    private let wcMetadata: WalletConnectSign.AppMetadata

    // Map SDK session topics to our request IDs for responses
    private var requestTopicMap: [String: String] = [:]  // requestId -> sessionTopic

    // MARK: - Session Proposal (bridging type)

    public struct SessionProposal {
        public let id: String
        public let proposer: ProposerMetadata
        public let requiredNamespaces: [String: RequiredNamespace]
        public let optionalNamespaces: [String: RequiredNamespace]?

        public struct ProposerMetadata {
            public let name: String
            public let description: String
            public let url: String
            public let icons: [String]
        }

        public struct RequiredNamespace {
            public let chains: [String]
            public let methods: [String]
            public let events: [String]
        }
    }

    // MARK: - App Metadata (internal bridging type)

    public struct AppMetadataInfo {
        public let name: String
        public let description: String
        public let url: String
        public let icons: [String]
    }

    // MARK: - Initialization

    private init() {
        self.database = Database.shared
        self.projectId = "YOUR_WALLETCONNECT_PROJECT_ID" // Configure in production
        self.wcMetadata = WalletConnectSign.AppMetadata(
            name: "ChainlessChain",
            description: "Decentralized Personal AI Management System",
            url: "chainlesschain.com",
            icons: ["https://chainlesschain.com/icon.png"],
            redirect: try? .init(native: "chainlesschain://", universal: nil)
        )
    }

    // MARK: - Public Methods

    /// Initialize WalletConnect SDK
    @MainActor
    public func initialize() async throws {
        guard !isInitialized else { return }

        Networking.configure(projectId: projectId, socketFactory: DefaultSocketFactory())

        Pair.configure(metadata: wcMetadata)

        // Subscribe to session proposals
        Sign.instance.sessionProposalPublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] context in
                self?.handleSDKSessionProposal(context)
            }
            .store(in: &cancellables)

        // Subscribe to session requests
        Sign.instance.sessionRequestPublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] context in
                self?.handleSDKSessionRequest(context)
            }
            .store(in: &cancellables)

        // Subscribe to session deletions
        Sign.instance.sessionDeletePublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] (topic, _) in
                self?.handleSDKSessionDelete(topic: topic)
            }
            .store(in: &cancellables)

        // Subscribe to session settlements
        Sign.instance.sessionSettlePublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] session in
                self?.handleSDKSessionSettle(session)
            }
            .store(in: &cancellables)

        // Load existing sessions from database
        try await loadSessions()

        isInitialized = true
    }

    /// Pair with DApp using URI
    @MainActor
    public func pair(uri: String) async throws {
        guard isInitialized else {
            throw WalletConnectError.notInitialized
        }

        guard let wcUri = WalletConnectURI(string: uri) else {
            throw WalletConnectError.invalidUri
        }

        try await Pair.instance.pair(uri: wcUri)
    }

    /// Approve session proposal
    @MainActor
    public func approveSession(
        proposalId: String,
        accounts: [String],
        chainIds: [Int]
    ) async throws -> WalletConnectSession {
        guard isInitialized else {
            throw WalletConnectError.notInitialized
        }

        // Build namespaces for SDK
        let namespaces = buildNamespaces(accounts: accounts, chainIds: chainIds)

        try await Sign.instance.approve(
            proposalId: proposalId,
            namespaces: namespaces
        )

        // Create local session record (will be updated when sessionSettlePublisher fires)
        let session = WalletConnectSession(
            id: proposalId,
            pairingTopic: proposalId,
            dappName: "DApp",
            dappUrl: "",
            accounts: accounts,
            chainIds: chainIds,
            methods: WCMethod.allMethods,
            events: ["chainChanged", "accountsChanged"],
            expiryDate: Date().addingTimeInterval(604800) // 7 days
        )

        // Save to database
        try await saveSession(session)

        // Emit event
        sessionConnected.send(session)

        return session
    }

    /// Reject session proposal
    @MainActor
    public func rejectSession(proposalId: String, reason: String) async throws {
        guard isInitialized else {
            throw WalletConnectError.notInitialized
        }

        try await Sign.instance.rejectSession(
            proposalId: proposalId,
            reason: .userRejected
        )
    }

    /// Disconnect session
    @MainActor
    public func disconnectSession(sessionId: String) async throws {
        guard isInitialized else {
            throw WalletConnectError.notInitialized
        }

        // Find the session topic
        if let session = sessions.first(where: { $0.id == sessionId }) {
            try await Sign.instance.disconnect(topic: session.pairingTopic)
        }

        // Update database
        try await updateSessionStatus(sessionId: sessionId, isActive: false)

        // Remove from memory
        sessions.removeAll { $0.id == sessionId }

        // Emit event
        sessionDisconnected.send(sessionId)
    }

    /// Get active sessions
    public func getActiveSessions() -> [WalletConnectSession] {
        sessions.filter { $0.isActive && !$0.isExpired }
    }

    /// Get session by ID
    public func getSession(id: String) -> WalletConnectSession? {
        sessions.first { $0.id == id }
    }

    // MARK: - Request Handling

    /// Approve sign message request
    @MainActor
    public func approveSignMessage(
        requestId: String,
        message: String,
        wallet: Wallet,
        password: String
    ) async throws -> String {
        // Sign message
        let signature = try await walletManager.signMessage(
            wallet: wallet,
            message: message,
            password: password
        )

        // Respond to WalletConnect SDK
        if let sessionTopic = requestTopicMap[requestId] {
            let response = RPCResult.response(AnyCodable(signature))
            try await Sign.instance.respond(
                topic: sessionTopic,
                requestId: .init(value: requestId)!,
                response: response
            )
            requestTopicMap.removeValue(forKey: requestId)
        }

        // Update request status
        try await updateRequestStatus(requestId: requestId, status: .approved)

        return signature
    }

    /// Approve send transaction request
    @MainActor
    public func approveSendTransaction(
        requestId: String,
        transaction: TransactionParams,
        wallet: Wallet,
        password: String
    ) async throws -> String {
        // Send transaction
        let record = try await transactionManager.sendTransaction(
            wallet: wallet,
            to: transaction.to ?? "",
            value: transaction.value ?? "0",
            data: transaction.data,
            gasLimit: transaction.gas,
            gasPrice: transaction.gasPrice
        )

        // Respond to WalletConnect SDK
        if let sessionTopic = requestTopicMap[requestId] {
            let response = RPCResult.response(AnyCodable(record.hash))
            try await Sign.instance.respond(
                topic: sessionTopic,
                requestId: .init(value: requestId)!,
                response: response
            )
            requestTopicMap.removeValue(forKey: requestId)
        }

        // Update request status
        try await updateRequestStatus(requestId: requestId, status: .approved)

        return record.hash
    }

    /// Reject request
    @MainActor
    public func rejectRequest(requestId: String, reason: String) async throws {
        // Respond to WalletConnect SDK with error
        if let sessionTopic = requestTopicMap[requestId] {
            let response = RPCResult.error(.init(code: 4001, message: reason))
            try await Sign.instance.respond(
                topic: sessionTopic,
                requestId: .init(value: requestId)!,
                response: response
            )
            requestTopicMap.removeValue(forKey: requestId)
        }

        // Update request status
        try await updateRequestStatus(requestId: requestId, status: .rejected)
    }

    // MARK: - SDK Event Handlers

    private func handleSDKSessionProposal(_ context: Session.Proposal) {
        let proposal = SessionProposal(
            id: context.id,
            proposer: SessionProposal.ProposerMetadata(
                name: context.proposer.name,
                description: context.proposer.description,
                url: context.proposer.url,
                icons: context.proposer.icons
            ),
            requiredNamespaces: context.requiredNamespaces.mapValues { ns in
                SessionProposal.RequiredNamespace(
                    chains: ns.chains?.map { $0.absoluteString } ?? [],
                    methods: Array(ns.methods),
                    events: Array(ns.events)
                )
            },
            optionalNamespaces: context.optionalNamespaces?.mapValues { ns in
                SessionProposal.RequiredNamespace(
                    chains: ns.chains?.map { $0.absoluteString } ?? [],
                    methods: Array(ns.methods),
                    events: Array(ns.events)
                )
            }
        )

        sessionProposal.send(proposal)
    }

    private func handleSDKSessionRequest(_ context: Request) {
        // Store the topic mapping for later response
        let requestId = context.id.string
        requestTopicMap[requestId] = context.topic

        // Convert SDK request to our internal model
        handleSessionRequest(
            requestId: requestId,
            topic: context.topic,
            method: context.method,
            params: context.params,
            chainId: context.chainId.absoluteString
        )
    }

    private func handleSDKSessionDelete(topic: String) {
        Task { @MainActor in
            if let session = sessions.first(where: { $0.pairingTopic == topic }) {
                sessions.removeAll { $0.pairingTopic == topic }
                try? await updateSessionStatus(sessionId: session.id, isActive: false)
                sessionDisconnected.send(session.id)
            }
        }
    }

    private func handleSDKSessionSettle(_ session: Session) {
        Task { @MainActor in
            let wcSession = WalletConnectSession(
                id: session.topic,
                pairingTopic: session.pairingTopic,
                dappName: session.peer.name,
                dappUrl: session.peer.url,
                dappDescription: session.peer.description,
                dappIconUrl: session.peer.icons.first,
                accounts: session.namespaces.values.flatMap { $0.accounts.map { $0.address } },
                chainIds: session.namespaces.values.flatMap { ns in
                    ns.accounts.compactMap { account in
                        Int(account.blockchain.reference)
                    }
                },
                methods: session.namespaces.values.flatMap { Array($0.methods) },
                events: session.namespaces.values.flatMap { Array($0.events) },
                expiryDate: session.expiryDate
            )

            // Update or add session
            if let index = sessions.firstIndex(where: { $0.pairingTopic == session.pairingTopic }) {
                sessions[index] = wcSession
            } else {
                sessions.append(wcSession)
            }

            try? await saveSession(wcSession)
            sessionConnected.send(wcSession)
        }
    }

    private func handleSessionRequest(
        requestId: String,
        topic: String,
        method: String,
        params: AnyCodable,
        chainId: String
    ) {
        // Find session for this topic
        let session = sessions.first { $0.pairingTopic == topic }
        let dappName = session?.dappName ?? "Unknown DApp"
        let dappIconUrl = session?.dappIconUrl

        // Parse chain ID number from CAIP-2 format (e.g., "eip155:1" -> 1)
        let chainIdNum = Int(chainId.split(separator: ":").last.flatMap { String($0) } ?? "1") ?? 1

        // Parse method and params into our internal types
        guard let wcMethod = WCMethod(rawValue: method) else {
            Task {
                try? await rejectRequest(requestId: requestId, reason: "Unsupported method: \(method)")
            }
            return
        }

        let requestParams = parseRequestParams(method: wcMethod, params: params)

        let request = WalletConnectRequest(
            id: requestId,
            sessionTopic: topic,
            dappName: dappName,
            dappIconUrl: dappIconUrl,
            method: wcMethod,
            params: requestParams,
            chainId: chainIdNum
        )

        Task { @MainActor in
            await saveRequest(request)
            requestReceived.send(request)
        }
    }

    private func parseRequestParams(method: WCMethod, params: AnyCodable) -> WalletConnectRequestParams {
        switch method {
        case .personalSign, .ethSign:
            if let array = params.value as? [String], array.count >= 2 {
                let message = array[0]
                let address = array[1]
                return .signMessage(message: message, address: address)
            }
            return .signMessage(message: "", address: "")

        case .ethSignTypedData, .ethSignTypedDataV4:
            if let array = params.value as? [String], array.count >= 2 {
                let address = array[0]
                let typedData = array[1]
                return .signTypedData(typedData: typedData, address: address)
            }
            return .signTypedData(typedData: "", address: "")

        case .ethSendTransaction:
            if let array = params.value as? [[String: Any]], let txDict = array.first {
                let tx = TransactionParams(
                    from: txDict["from"] as? String ?? "",
                    to: txDict["to"] as? String,
                    value: txDict["value"] as? String,
                    data: txDict["data"] as? String,
                    gas: txDict["gas"] as? String,
                    gasPrice: txDict["gasPrice"] as? String,
                    nonce: txDict["nonce"] as? String,
                    chainId: (txDict["chainId"] as? String).flatMap { Int($0, radix: 16) }
                )
                return .sendTransaction(tx)
            }
            return .sendTransaction(TransactionParams(from: ""))

        case .ethSignTransaction:
            if let array = params.value as? [[String: Any]], let txDict = array.first {
                let tx = TransactionParams(
                    from: txDict["from"] as? String ?? "",
                    to: txDict["to"] as? String,
                    value: txDict["value"] as? String,
                    data: txDict["data"] as? String,
                    gas: txDict["gas"] as? String,
                    gasPrice: txDict["gasPrice"] as? String,
                    nonce: txDict["nonce"] as? String,
                    chainId: (txDict["chainId"] as? String).flatMap { Int($0, radix: 16) }
                )
                return .signTransaction(tx)
            }
            return .signTransaction(TransactionParams(from: ""))

        case .walletSwitchEthereumChain:
            if let array = params.value as? [[String: Any]], let dict = array.first,
               let chainId = dict["chainId"] as? String {
                return .switchChain(chainId: chainId)
            }
            return .switchChain(chainId: "0x1")

        case .walletAddEthereumChain:
            if let array = params.value as? [[String: Any]], let dict = array.first {
                let chainData = ChainData(
                    chainId: dict["chainId"] as? String ?? "",
                    chainName: dict["chainName"] as? String ?? "",
                    nativeCurrency: ChainData.NativeCurrency(
                        name: (dict["nativeCurrency"] as? [String: Any])?["name"] as? String ?? "",
                        symbol: (dict["nativeCurrency"] as? [String: Any])?["symbol"] as? String ?? "",
                        decimals: (dict["nativeCurrency"] as? [String: Any])?["decimals"] as? Int ?? 18
                    ),
                    rpcUrls: dict["rpcUrls"] as? [String] ?? [],
                    blockExplorerUrls: dict["blockExplorerUrls"] as? [String]
                )
                return .addChain(chainData)
            }
            return .addChain(ChainData(chainId: "", chainName: "", nativeCurrency: ChainData.NativeCurrency(name: "", symbol: "", decimals: 18), rpcUrls: []))

        case .walletWatchAsset:
            if let dict = params.value as? [String: Any],
               let options = dict["options"] as? [String: Any] {
                let asset = WatchAssetParams(
                    type: dict["type"] as? String ?? "ERC20",
                    address: options["address"] as? String ?? "",
                    symbol: options["symbol"] as? String ?? "",
                    decimals: options["decimals"] as? Int ?? 18,
                    image: options["image"] as? String
                )
                return .watchAsset(asset)
            }
            return .watchAsset(WatchAssetParams(type: "ERC20", address: "", symbol: "", decimals: 18))
        }
    }

    // MARK: - Namespace Builder

    private func buildNamespaces(accounts: [String], chainIds: [Int]) -> [String: SessionNamespace] {
        let blockchains = chainIds.compactMap { Blockchain("eip155:\($0)") }
        let wcAccounts = accounts.flatMap { account in
            blockchains.compactMap { blockchain in
                WalletConnectSign.Account(blockchain: blockchain, address: account)
            }
        }

        let namespace = SessionNamespace(
            accounts: Set(wcAccounts),
            methods: Set(WCMethod.allMethods),
            events: Set(["chainChanged", "accountsChanged"])
        )

        return ["eip155": namespace]
    }

    // MARK: - Database Operations

    @MainActor
    private func loadSessions() async throws {
        let sql = """
        SELECT * FROM walletconnect_sessions
        WHERE is_active = 1
        ORDER BY connected_at DESC
        """

        sessions = try database.query(sql) { stmt in
            WalletConnectSession(
                id: stmt.string(at: 1) ?? "",
                pairingTopic: stmt.string(at: 2) ?? "",
                dappName: stmt.string(at: 3) ?? "",
                dappUrl: stmt.string(at: 4) ?? "",
                dappDescription: stmt.string(at: 5),
                dappIconUrl: stmt.string(at: 6),
                accounts: (stmt.string(at: 7) ?? "").split(separator: ",").map(String.init),
                chainIds: (stmt.string(at: 8) ?? "").split(separator: ",").compactMap { Int($0) },
                methods: (stmt.string(at: 9) ?? "").split(separator: ",").map(String.init),
                events: (stmt.string(at: 10) ?? "").split(separator: ",").map(String.init),
                expiryDate: Date(timeIntervalSince1970: TimeInterval(stmt.int64(at: 11))),
                connectedAt: Date(timeIntervalSince1970: TimeInterval(stmt.int64(at: 12))),
                lastUsed: Date(timeIntervalSince1970: TimeInterval(stmt.int64(at: 13))),
                isActive: stmt.int64(at: 14) == 1
            )
        }
    }

    @MainActor
    private func saveSession(_ session: WalletConnectSession) async throws {
        let sql = """
        INSERT OR REPLACE INTO walletconnect_sessions (
            id, session_id, pairing_topic, dapp_name, dapp_url, dapp_description,
            dapp_icon_url, accounts, chain_ids, methods, events, expiry_date,
            connected_at, last_used, is_active
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """

        try database.execute(sql,
            session.id,
            session.id,
            session.pairingTopic,
            session.dappName,
            session.dappUrl,
            session.dappDescription,
            session.dappIconUrl,
            session.accounts.joined(separator: ","),
            session.chainIds.map(String.init).joined(separator: ","),
            session.methods.joined(separator: ","),
            session.events.joined(separator: ","),
            Int64(session.expiryDate.timeIntervalSince1970),
            Int64(session.connectedAt.timeIntervalSince1970),
            Int64(session.lastUsed.timeIntervalSince1970),
            session.isActive ? 1 : 0
        )

        if !sessions.contains(where: { $0.id == session.id }) {
            sessions.append(session)
        }
    }

    @MainActor
    private func updateSessionStatus(sessionId: String, isActive: Bool) async throws {
        let sql = """
        UPDATE walletconnect_sessions
        SET is_active = ?
        WHERE session_id = ?
        """

        try database.execute(sql, isActive ? 1 : 0, sessionId)

        if let index = sessions.firstIndex(where: { $0.id == sessionId }) {
            sessions[index].isActive = isActive
        }
    }

    @MainActor
    private func saveRequest(_ request: WalletConnectRequest) async {
        do {
            let sql = """
            INSERT INTO walletconnect_requests (
                id, request_id, session_topic, dapp_name, dapp_icon_url,
                method, params, chain_id, timestamp, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """

            let paramsJson = try JSONEncoder().encode(request.params)

            try database.execute(sql,
                request.id,
                request.id,
                request.sessionTopic,
                request.dappName,
                request.dappIconUrl,
                request.method.rawValue,
                String(data: paramsJson, encoding: .utf8),
                request.chainId,
                Int64(request.timestamp.timeIntervalSince1970),
                request.status.rawValue
            )

            pendingRequests.append(request)
        } catch {
            Logger.shared.error("[WalletConnect] Failed to save request: \(error)")
        }
    }

    @MainActor
    private func updateRequestStatus(requestId: String, status: RequestStatus) async throws {
        let sql = """
        UPDATE walletconnect_requests
        SET status = ?
        WHERE request_id = ?
        """

        try database.execute(sql, status.rawValue, requestId)

        pendingRequests.removeAll { $0.id == requestId }
    }
}

// MARK: - WalletConnect Error

public enum WalletConnectError: LocalizedError {
    case notInitialized
    case invalidUri
    case sessionNotFound
    case requestNotFound
    case invalidMethod
    case invalidParams
    case userRejected
    case networkError(String)

    public var errorDescription: String? {
        switch self {
        case .notInitialized:
            return "WalletConnect not initialized"
        case .invalidUri:
            return "Invalid WalletConnect URI"
        case .sessionNotFound:
            return "Session not found"
        case .requestNotFound:
            return "Request not found"
        case .invalidMethod:
            return "Invalid method"
        case .invalidParams:
            return "Invalid parameters"
        case .userRejected:
            return "User rejected request"
        case .networkError(let message):
            return "Network error: \(message)"
        }
    }
}

// MARK: - WCMethod Extensions

extension WCMethod {
    static let allMethods: [String] = [
        "personal_sign",
        "eth_sign",
        "eth_signTypedData",
        "eth_signTypedData_v4",
        "eth_sendTransaction",
        "eth_signTransaction",
        "wallet_switchEthereumChain",
        "wallet_addEthereumChain",
        "wallet_watchAsset"
    ]
}

// MARK: - Default Socket Factory

struct DefaultSocketFactory: WebSocketFactory {
    func create(with url: URL) -> WebSocketConnecting {
        URLSessionWebSocket(url: url)
    }
}

/// URLSession-based WebSocket implementation
class URLSessionWebSocket: NSObject, WebSocketConnecting {
    var isConnected: Bool = false
    var onConnect: (() -> Void)?
    var onDisconnect: ((Error?) -> Void)?
    var onText: ((String) -> Void)?

    private var task: URLSessionWebSocketTask?
    private let url: URL

    init(url: URL) {
        self.url = url
        super.init()
    }

    func connect() {
        let session = URLSession(configuration: .default, delegate: self, delegateQueue: nil)
        task = session.webSocketTask(with: url)
        task?.resume()
        receiveMessage()
    }

    func disconnect() {
        task?.cancel(with: .normalClosure, reason: nil)
        isConnected = false
        onDisconnect?(nil)
    }

    func write(string: String, completion: @escaping ((Error?) -> Void)) {
        task?.send(.string(string), completionHandler: completion)
    }

    private func receiveMessage() {
        task?.receive { [weak self] result in
            switch result {
            case .success(let message):
                switch message {
                case .string(let text):
                    self?.onText?(text)
                default:
                    break
                }
                self?.receiveMessage()
            case .failure(let error):
                self?.isConnected = false
                self?.onDisconnect?(error)
            }
        }
    }
}

extension URLSessionWebSocket: URLSessionWebSocketDelegate {
    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) {
        isConnected = true
        onConnect?()
    }

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        isConnected = false
        onDisconnect?(nil)
    }
}
