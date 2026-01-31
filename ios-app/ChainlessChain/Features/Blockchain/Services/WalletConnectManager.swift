import Foundation
import Combine
import WalletConnectSwift // WalletConnect v2 SDK

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
    private let metadata: AppMetadata

    // MARK: - Session Proposal

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

    // MARK: - App Metadata

    public struct AppMetadata {
        public let name: String
        public let description: String
        public let url: String
        public let icons: [String]
    }

    // MARK: - Initialization

    private init() {
        self.database = Database.shared
        self.projectId = "YOUR_WALLETCONNECT_PROJECT_ID" // Configure in production
        self.metadata = AppMetadata(
            name: "ChainlessChain",
            description: "Decentralized Personal AI Management System",
            url: "https://chainlesschain.com",
            icons: ["https://chainlesschain.com/icon.png"]
        )
    }

    // MARK: - Public Methods

    /// Initialize WalletConnect SDK
    @MainActor
    public func initialize() async throws {
        guard !isInitialized else { return }

        // TODO: Initialize WalletConnect v2 SDK
        // This would use the real WalletConnect SDK in production
        /*
        Networking.configure(projectId: projectId, socketFactory: DefaultSocketFactory())

        Pair.configure(metadata: metadata)

        Sign.instance.sessionProposalPublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] proposal in
                self?.handleSessionProposal(proposal)
            }
            .store(in: &cancellables)

        Sign.instance.sessionRequestPublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] request in
                self?.handleSessionRequest(request)
            }
            .store(in: &cancellables)
        */

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

        // TODO: Implement pairing with real SDK
        // Pair.instance.pair(uri: WalletConnectURI(string: uri))

        // For now, simulate pairing
        print("Pairing with URI: \(uri)")
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

        // TODO: Implement with real SDK
        /*
        let namespaces = buildNamespaces(accounts: accounts, chainIds: chainIds)
        try await Sign.instance.approve(proposalId: proposalId, namespaces: namespaces)
        */

        // Create session record
        let session = WalletConnectSession(
            id: UUID().uuidString,
            pairingTopic: proposalId,
            dappName: "DApp",
            dappUrl: "https://dapp.example.com",
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

        // TODO: Implement with real SDK
        // try await Sign.instance.reject(proposalId: proposalId, reason: reason)

        print("Rejected session: \(proposalId), reason: \(reason)")
    }

    /// Disconnect session
    @MainActor
    public func disconnectSession(sessionId: String) async throws {
        guard isInitialized else {
            throw WalletConnectError.notInitialized
        }

        // TODO: Implement with real SDK
        // try await Sign.instance.disconnect(topic: sessionId)

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

        // TODO: Respond to WalletConnect
        // try await Sign.instance.respond(topic: sessionTopic, requestId: requestId, response: signature)

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

        // TODO: Respond to WalletConnect
        // try await Sign.instance.respond(topic: sessionTopic, requestId: requestId, response: record.hash)

        // Update request status
        try await updateRequestStatus(requestId: requestId, status: .approved)

        return record.hash
    }

    /// Reject request
    @MainActor
    public func rejectRequest(requestId: String, reason: String) async throws {
        // TODO: Respond to WalletConnect
        // try await Sign.instance.reject(topic: sessionTopic, requestId: requestId, reason: reason)

        // Update request status
        try await updateRequestStatus(requestId: requestId, status: .rejected)
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

        sessions.append(session)
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
    private func saveRequest(_ request: WalletConnectRequest) async throws {
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

    // MARK: - Helper Methods

    private func handleSessionProposal(_ proposal: SessionProposal) {
        sessionProposal.send(proposal)
    }

    private func handleSessionRequest(_ request: WalletConnectRequest) {
        Task {
            await MainActor.run {
                requestReceived.send(request)
            }
        }
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
