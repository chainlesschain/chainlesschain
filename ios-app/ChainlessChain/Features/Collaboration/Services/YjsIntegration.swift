/**
 * YjsIntegration.swift
 *
 * Swift CRDT implementation compatible with PC端's Yjs protocol.
 * Provides conflict-free replicated data types for collaborative editing.
 *
 * Note: This is a simplified CRDT implementation. For production,
 * consider using Yjs via WebAssembly or a full Swift CRDT library.
 */

import Foundation
import Combine

/// Yjs-compatible CRDT document manager
@MainActor
public class YjsIntegration: ObservableObject {

    // MARK: - Properties

    /// Map of document ID to Yjs document
    private var documents: [String: YDocument] = [:]

    /// Map of document ID to awareness state
    private var awarenessStates: [String: AwarenessState] = [:]

    /// Map of document ID to connected peers
    private var documentPeers: [String: Set<String>] = [:]

    /// Subject for document updates
    private let updateSubject = PassthroughSubject<(String, Data), Never>()

    /// Subject for awareness updates
    private let awarenessSubject = PassthroughSubject<(String, Data), Never>()

    private var cancellables = Set<AnyCancellable>()

    // MARK: - Publishers

    public var documentUpdates: AnyPublisher<(String, Data), Never> {
        updateSubject.eraseToAnyPublisher()
    }

    public var awarenessUpdates: AnyPublisher<(String, Data), Never> {
        awarenessSubject.eraseToAnyPublisher()
    }

    // MARK: - Initialization

    public init() {}

    // MARK: - Document Management

    /// Get or create a Yjs document
    public func getDocument(_ documentId: String) -> YDocument {
        if let doc = documents[documentId] {
            return doc
        }

        let doc = YDocument(id: documentId)

        // Listen for updates
        doc.onUpdate = { [weak self] update in
            guard let self = self else { return }
            Task { @MainActor in
                self.updateSubject.send((documentId, update))
            }
        }

        documents[documentId] = doc
        return doc
    }

    /// Get or create awareness state for a document
    public func getAwareness(_ documentId: String) -> AwarenessState {
        if let awareness = awarenessStates[documentId] {
            return awareness
        }

        let awareness = AwarenessState()
        awarenessStates[documentId] = awareness
        return awareness
    }

    /// Open a document for collaborative editing
    public func openDocument(
        _ documentId: String,
        userId: String,
        userName: String,
        organizationId: String? = nil
    ) async throws -> (document: YDocument, awareness: AwarenessState) {
        let doc = getDocument(documentId)
        let awareness = getAwareness(documentId)

        // Set local user's awareness state
        let userState = UserAwarenessState(
            userId: userId,
            userName: userName,
            color: generateUserColor(),
            cursor: nil,
            selection: nil
        )
        awareness.setLocalState(userState)

        // Broadcast awareness
        broadcastAwareness(documentId)

        return (doc, awareness)
    }

    /// Close a document
    public func closeDocument(_ documentId: String) async {
        // Remove local awareness state
        if let awareness = awarenessStates[documentId] {
            awareness.clearLocalState()
            broadcastAwareness(documentId)
        }

        // Clear peers
        documentPeers[documentId]?.removeAll()

        // Keep document in memory for potential reopen
    }

    /// Update cursor position
    public func updateCursor(
        _ documentId: String,
        cursor: CursorPosition?,
        selection: TextSelection? = nil
    ) {
        guard let awareness = awarenessStates[documentId] else { return }

        awareness.updateCursor(cursor: cursor, selection: selection)
        broadcastAwareness(documentId)
    }

    /// Get active users for a document
    public func getActiveUsers(_ documentId: String) -> [ActiveUser] {
        guard let awareness = awarenessStates[documentId] else { return [] }
        return awareness.getActiveUsers()
    }

    // MARK: - Synchronization

    /// Apply remote update to document
    public func applyUpdate(_ documentId: String, update: Data) throws {
        let doc = getDocument(documentId)
        try doc.applyUpdate(update, origin: "network")
    }

    /// Get state vector for synchronization
    public func getStateVector(_ documentId: String) -> Data {
        let doc = getDocument(documentId)
        return doc.encodeStateVector()
    }

    /// Get diff update based on remote state vector
    public func getDiffUpdate(_ documentId: String, remoteStateVector: Data) -> Data {
        let doc = getDocument(documentId)
        return doc.encodeDiffUpdate(remoteStateVector)
    }

    /// Apply awareness update from remote peer
    public func applyAwarenessUpdate(_ documentId: String, update: Data, peerId: String) {
        guard let awareness = awarenessStates[documentId] else { return }
        awareness.applyRemoteUpdate(update, peerId: peerId)
    }

    // MARK: - Broadcasting

    private func broadcastAwareness(_ documentId: String) {
        guard let awareness = awarenessStates[documentId] else { return }
        let update = awareness.encodeUpdate()
        awarenessSubject.send((documentId, update))
    }

    // MARK: - Helpers

    private func generateUserColor() -> String {
        let colors = [
            "#FF6B6B", "#4ECDC4", "#45B7D1", "#FFA07A",
            "#98D8C8", "#F7DC6F", "#BB8FCE", "#85C1E2"
        ]
        return colors.randomElement() ?? "#4ECDC4"
    }

    // MARK: - Cleanup

    public func destroy() {
        documents.removeAll()
        awarenessStates.removeAll()
        documentPeers.removeAll()
        cancellables.removeAll()
    }
}

// MARK: - YDocument

/// Simplified Yjs document implementation
public class YDocument {
    public let id: String
    private var content: String = ""
    private var operations: [CRDTOperation] = []
    private var clock: Int = 0
    public var onUpdate: ((Data) -> Void)?

    public init(id: String) {
        self.id = id
    }

    /// Get text content
    public func getText() -> String {
        return content
    }

    /// Insert text at position
    public func insert(_ position: Int, _ text: String, clientId: String) {
        let timestamp = Date()
        let operation = CRDTOperation.insert(
            position: position,
            content: text,
            clientId: clientId,
            timestamp: timestamp
        )

        applyOperation(operation)
        operations.append(operation)
        clock += 1

        // Notify update
        if let update = encodeOperation(operation) {
            onUpdate?(update)
        }
    }

    /// Delete text at position
    public func delete(_ position: Int, _ length: Int, clientId: String) {
        let timestamp = Date()
        let operation = CRDTOperation.delete(
            position: position,
            length: length,
            clientId: clientId,
            timestamp: timestamp
        )

        applyOperation(operation)
        operations.append(operation)
        clock += 1

        // Notify update
        if let update = encodeOperation(operation) {
            onUpdate?(update)
        }
    }

    /// Apply CRDT operation to content
    private func applyOperation(_ operation: CRDTOperation) {
        switch operation {
        case .insert(let position, let text, _, _):
            let index = content.index(content.startIndex, offsetBy: min(position, content.count))
            content.insert(contentsOf: text, at: index)

        case .delete(let position, let length, _, _):
            guard position < content.count else { return }
            let startIndex = content.index(content.startIndex, offsetBy: position)
            let endIndex = content.index(startIndex, offsetBy: min(length, content.count - position))
            content.removeSubrange(startIndex..<endIndex)

        case .update(let position, _, let newContent, _, _):
            // Simplified: treat as delete + insert
            let deleteOp = CRDTOperation.delete(
                position: position,
                length: newContent.count,
                clientId: operation.clientId,
                timestamp: operation.timestamp
            )
            let insertOp = CRDTOperation.insert(
                position: position,
                content: newContent,
                clientId: operation.clientId,
                timestamp: operation.timestamp
            )
            applyOperation(deleteOp)
            applyOperation(insertOp)
        }
    }

    /// Apply remote update
    public func applyUpdate(_ update: Data, origin: String) throws {
        // Decode operation from update data
        guard let operation = decodeOperation(update) else {
            throw CollaborationError.syncFailed("Invalid update format")
        }

        applyOperation(operation)
        operations.append(operation)
        clock += 1

        // Don't notify for network updates to avoid loops
        if origin != "network" {
            onUpdate?(update)
        }
    }

    /// Encode state vector (simplified)
    public func encodeStateVector() -> Data {
        let vector = ["clock": clock, "documentId": id]
        return (try? JSONEncoder().encode(vector)) ?? Data()
    }

    /// Encode diff update based on remote state vector
    public func encodeDiffUpdate(_ remoteStateVector: Data) -> Data {
        // Simplified: send all operations after remote clock
        guard let vector = try? JSONDecoder().decode([String: Int].self, from: remoteStateVector),
              let remoteClock = vector["clock"] else {
            return Data()
        }

        let newOperations = operations.dropFirst(remoteClock)
        let updates = newOperations.compactMap { encodeOperation($0) }

        // Combine all updates
        return updates.reduce(Data()) { $0 + $1 }
    }

    /// Encode operation to Data
    private func encodeOperation(_ operation: CRDTOperation) -> Data? {
        return try? JSONEncoder().encode(operation)
    }

    /// Decode operation from Data
    private func decodeOperation(_ data: Data) -> CRDTOperation? {
        return try? JSONDecoder().decode(CRDTOperation.self, from: data)
    }

    /// Set content (for initial load)
    public func setContent(_ content: String) {
        self.content = content
    }
}

// MARK: - Awareness State

/// Tracks cursor and presence information
public class AwarenessState {
    private var localState: UserAwarenessState?
    private var remoteStates: [String: UserAwarenessState] = [:] // peerId -> state
    private var peerMetadata: [String: PeerMetadata] = [:]

    public func setLocalState(_ state: UserAwarenessState) {
        self.localState = state
    }

    public func clearLocalState() {
        self.localState = nil
    }

    public func updateCursor(cursor: CursorPosition?, selection: TextSelection?) {
        localState?.cursor = cursor
        localState?.selection = selection
        localState?.lastUpdate = Date()
    }

    public func applyRemoteUpdate(_ update: Data, peerId: String) {
        guard let state = try? JSONDecoder().decode(UserAwarenessState.self, from: update) else {
            return
        }

        remoteStates[peerId] = state
        peerMetadata[peerId] = PeerMetadata(lastUpdate: Date())
    }

    public func getActiveUsers() -> [ActiveUser] {
        var users: [ActiveUser] = []

        // Add local user
        if let local = localState {
            users.append(ActiveUser(
                userId: local.userId,
                userName: local.userName,
                userColor: local.color,
                cursor: local.cursor,
                selection: local.selection
            ))
        }

        // Add remote users
        for (peerId, state) in remoteStates {
            users.append(ActiveUser(
                id: peerId,
                userId: state.userId,
                userName: state.userName,
                userColor: state.color,
                cursor: state.cursor,
                selection: state.selection
            ))
        }

        return users
    }

    public func encodeUpdate() -> Data {
        guard let local = localState else { return Data() }
        return (try? JSONEncoder().encode(local)) ?? Data()
    }

    struct PeerMetadata {
        let lastUpdate: Date
    }
}

// MARK: - User Awareness State

public struct UserAwarenessState: Codable {
    public let userId: String
    public let userName: String
    public let color: String
    public var cursor: CursorPosition?
    public var selection: TextSelection?
    public var lastUpdate: Date

    public init(
        userId: String,
        userName: String,
        color: String,
        cursor: CursorPosition?,
        selection: TextSelection?
    ) {
        self.userId = userId
        self.userName = userName
        self.color = color
        self.cursor = cursor
        self.selection = selection
        self.lastUpdate = Date()
    }
}
