/**
 * CollaborationManager.swift
 *
 * Main service for managing real-time collaborative editing sessions.
 * Integrates with YjsIntegration for CRDT operations and P2P network for synchronization.
 */

import Foundation
import Combine
import SQLite

@MainActor
public class CollaborationManager: ObservableObject {

    // MARK: - Singleton

    public static let shared = CollaborationManager()

    // MARK: - Properties

    private let yjsIntegration: YjsIntegration
    private let versionControl: VersionControlService
    private var database: Connection?

    /// Active collaboration sessions
    @Published public private(set) var activeSessions: [String: CollaborationSession] = [:]

    /// Active users per document
    @Published public private(set) var activeUsers: [String: [ActiveUser]] = [:]

    /// Sync status per document
    @Published public private(set) var syncStatus: [String: SyncStatus] = [:]

    private var cancellables = Set<AnyCancellable>()

    // MARK: - Initialization

    private init() {
        self.yjsIntegration = YjsIntegration()
        self.versionControl = VersionControlService()

        setupSubscriptions()
    }

    /// Set database connection
    public func setDatabase(_ db: Connection) {
        self.database = db
        versionControl.setDatabase(db)
    }

    // MARK: - Setup

    private func setupSubscriptions() {
        // Subscribe to document updates
        yjsIntegration.documentUpdates
            .sink { [weak self] (documentId, update) in
                Task { @MainActor [weak self] in
                    await self?.handleDocumentUpdate(documentId, update)
                }
            }
            .store(in: &cancellables)

        // Subscribe to awareness updates
        yjsIntegration.awarenessUpdates
            .sink { [weak self] (documentId, update) in
                Task { @MainActor [weak self] in
                    await self?.handleAwarenessUpdate(documentId, update)
                }
            }
            .store(in: &cancellables)
    }

    // MARK: - Session Management

    /// Join a collaboration session
    public func joinSession(
        documentId: String,
        knowledgeId: String,
        userId: String,
        userName: String,
        organizationId: String? = nil
    ) async throws -> CollaborationSession {

        // Check permissions for organization documents
        if let orgId = organizationId {
            let hasPermission = try await checkDocumentPermission(
                userId: userId,
                organizationId: orgId,
                knowledgeId: knowledgeId
            )

            if !hasPermission {
                throw CollaborationError.permissionDenied
            }
        }

        // Open Yjs document
        let (doc, awareness) = try await yjsIntegration.openDocument(
            documentId,
            userId: userId,
            userName: userName,
            organizationId: organizationId
        )

        // Create session
        let session = CollaborationSession(
            documentId: documentId,
            userId: userId,
            userName: userName
        )

        // Save session to database
        try await saveSession(session)

        // Update state
        activeSessions[documentId] = session
        syncStatus[documentId] = .connected

        // Update active users
        activeUsers[documentId] = yjsIntegration.getActiveUsers(documentId)

        return session
    }

    /// Leave a collaboration session
    public func leaveSession(documentId: String) async throws {
        guard let session = activeSessions[documentId] else { return }

        // Close Yjs document
        await yjsIntegration.closeDocument(documentId)

        // Update session in database
        try await updateSessionStatus(session.id, isActive: false)

        // Update state
        activeSessions.removeValue(forKey: documentId)
        activeUsers.removeValue(forKey: documentId)
        syncStatus.removeValue(forKey: documentId)
    }

    /// Update cursor position
    public func updateCursor(
        documentId: String,
        cursor: CursorPosition?,
        selection: TextSelection? = nil
    ) {
        yjsIntegration.updateCursor(documentId, cursor: cursor, selection: selection)

        // Update active users
        activeUsers[documentId] = yjsIntegration.getActiveUsers(documentId)
    }

    // MARK: - Document Operations

    /// Insert text at position
    public func insertText(
        documentId: String,
        position: Int,
        text: String,
        userId: String
    ) throws {
        let doc = yjsIntegration.getDocument(documentId)
        doc.insert(position, text, clientId: userId)
    }

    /// Delete text at position
    public func deleteText(
        documentId: String,
        position: Int,
        length: Int,
        userId: String
    ) throws {
        let doc = yjsIntegration.getDocument(documentId)
        doc.delete(position, length, clientId: userId)
    }

    /// Get current document content
    public func getDocumentContent(documentId: String) -> String {
        let doc = yjsIntegration.getDocument(documentId)
        return doc.getText()
    }

    /// Set document content (for initial load)
    public func setDocumentContent(documentId: String, content: String) {
        let doc = yjsIntegration.getDocument(documentId)
        doc.setContent(content)
    }

    // MARK: - Synchronization

    /// Sync changes with remote peer
    public func syncChanges(documentId: String, remotePeerId: String) async throws {
        syncStatus[documentId] = .syncing

        do {
            // Get state vector
            let stateVector = yjsIntegration.getStateVector(documentId)

            // In production, send via P2P network
            // For now, this is a placeholder
            print("[CollaborationManager] Syncing document \(documentId) with peer \(remotePeerId)")

            syncStatus[documentId] = .connected

        } catch {
            syncStatus[documentId] = .error(error.localizedDescription)
            throw CollaborationError.syncFailed(error.localizedDescription)
        }
    }

    /// Apply remote update
    public func applyRemoteUpdate(documentId: String, update: Data, peerId: String) throws {
        try yjsIntegration.applyUpdate(documentId, update: update)

        // Update active users if needed
        activeUsers[documentId] = yjsIntegration.getActiveUsers(documentId)
    }

    /// Apply remote awareness update
    public func applyRemoteAwareness(documentId: String, update: Data, peerId: String) {
        yjsIntegration.applyAwarenessUpdate(documentId, update: update, peerId: peerId)

        // Update active users
        activeUsers[documentId] = yjsIntegration.getActiveUsers(documentId)
    }

    // MARK: - Conflict Resolution

    /// Resolve conflicts (CRDT handles this automatically)
    public func resolveConflicts(documentId: String) async throws {
        // Yjs/CRDT automatically resolves conflicts
        // This method is here for manual resolution if needed
        print("[CollaborationManager] CRDT automatic conflict resolution for \(documentId)")
    }

    // MARK: - Update Handlers

    private func handleDocumentUpdate(_ documentId: String, _ update: Data) async {
        // In production, broadcast update via P2P network
        print("[CollaborationManager] Document update: \(documentId), size: \(update.count) bytes")

        // Save update to database for persistence
        do {
            try await saveUpdate(documentId, update: update)
        } catch {
            print("[CollaborationManager] Error saving update: \(error)")
        }
    }

    private func handleAwarenessUpdate(_ documentId: String, _ update: Data) async {
        // Update active users
        activeUsers[documentId] = yjsIntegration.getActiveUsers(documentId)

        // In production, broadcast awareness via P2P network
        print("[CollaborationManager] Awareness update: \(documentId)")
    }

    // MARK: - Database Operations

    private func saveSession(_ session: CollaborationSession) async throws {
        guard let db = database else {
            throw CollaborationError.syncFailed("Database not configured")
        }

        let table = Table("collaboration_sessions")
        let id = Expression<String>("id")
        let documentId = Expression<String>("document_id")
        let userId = Expression<String>("user_id")
        let userName = Expression<String>("user_name")
        let isActive = Expression<Bool>("is_active")
        let joinedAt = Expression<Int64>("joined_at")
        let lastSeen = Expression<Int64>("last_seen")

        try db.run(table.insert(
            id <- session.id,
            documentId <- session.documentId,
            userId <- session.userId,
            userName <- session.userName,
            isActive <- session.isActive,
            joinedAt <- Int64(session.joinedAt.timeIntervalSince1970),
            lastSeen <- Int64(session.lastSeen.timeIntervalSince1970)
        ))
    }

    private func updateSessionStatus(_ sessionId: String, isActive: Bool) async throws {
        guard let db = database else { return }

        let table = Table("collaboration_sessions")
        let id = Expression<String>("id")
        let isActiveCol = Expression<Bool>("is_active")
        let lastSeen = Expression<Int64>("last_seen")

        let session = table.filter(id == sessionId)
        try db.run(session.update(
            isActiveCol <- isActive,
            lastSeen <- Int64(Date().timeIntervalSince1970)
        ))
    }

    private func saveUpdate(_ documentId: String, update: Data) async throws {
        guard let db = database else { return }

        let table = Table("collaboration_updates")
        let id = Expression<String>("id")
        let docId = Expression<String>("document_id")
        let updateData = Expression<Data>("update_data")
        let createdAt = Expression<Int64>("created_at")

        try db.run(table.insert(
            id <- UUID().uuidString,
            docId <- documentId,
            updateData <- update,
            createdAt <- Int64(Date().timeIntervalSince1970)
        ))
    }

    /// Load document updates from database
    public func loadDocumentUpdates(documentId: String) async throws {
        guard let db = database else { return }

        let table = Table("collaboration_updates")
        let docId = Expression<String>("document_id")
        let updateData = Expression<Data>("update_data")
        let createdAt = Expression<Int64>("created_at")

        let updates = try db.prepare(
            table.filter(docId == documentId)
                .order(createdAt.asc)
        )

        for update in updates {
            let data = update[updateData]
            try yjsIntegration.applyUpdate(documentId, update: data)
        }
    }

    // MARK: - Permissions

    private func checkDocumentPermission(
        userId: String,
        organizationId: String,
        knowledgeId: String
    ) async throws -> Bool {
        // In production, check with OrganizationManager
        // For now, return true
        return true
    }

    // MARK: - Cleanup

    public func destroy() {
        cancellables.removeAll()
        yjsIntegration.destroy()
    }
}

// MARK: - Sync Status

public enum SyncStatus {
    case disconnected
    case connecting
    case connected
    case syncing
    case error(String)

    public var description: String {
        switch self {
        case .disconnected: return "未连接"
        case .connecting: return "连接中"
        case .connected: return "已连接"
        case .syncing: return "同步中"
        case .error(let message): return "错误: \(message)"
        }
    }

    public var isError: Bool {
        if case .error = self { return true }
        return false
    }
}
