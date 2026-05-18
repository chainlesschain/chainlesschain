/**
 * CollaborativeDocument.swift
 *
 * Models for real-time collaborative editing.
 * Compatible with PC端's Yjs CRDT implementation.
 */

import Foundation

// MARK: - Collaborative Document

/// Represents a document being edited collaboratively
public struct CollaborativeDocument: Codable, Identifiable {
    public let id: String
    public let knowledgeId: String
    public let organizationId: String?
    public var title: String
    public var content: String
    public var contentType: ContentType
    public var metadata: [String: String]
    public var version: Int
    public var createdAt: Date
    public var updatedAt: Date

    public enum ContentType: String, Codable {
        case plainText = "text/plain"
        case markdown = "text/markdown"
        case html = "text/html"
        case json = "application/json"
    }

    public init(
        id: String = UUID().uuidString,
        knowledgeId: String,
        organizationId: String? = nil,
        title: String,
        content: String = "",
        contentType: ContentType = .markdown,
        metadata: [String: String] = [:],
        version: Int = 0
    ) {
        self.id = id
        self.knowledgeId = knowledgeId
        self.organizationId = organizationId
        self.title = title
        self.content = content
        self.contentType = contentType
        self.metadata = metadata
        self.version = version
        self.createdAt = Date()
        self.updatedAt = Date()
    }
}

// MARK: - Collaboration Session

/// Represents an active collaboration session
public struct CollaborationSession: Codable, Identifiable {
    public let id: String
    public let documentId: String
    public let userId: String
    public let userName: String
    public var isActive: Bool
    public let joinedAt: Date
    public var lastSeen: Date
    public var cursorPosition: CursorPosition?
    public var selection: TextSelection?

    public init(
        id: String = UUID().uuidString,
        documentId: String,
        userId: String,
        userName: String,
        isActive: Bool = true
    ) {
        self.id = id
        self.documentId = documentId
        self.userId = userId
        self.userName = userName
        self.isActive = isActive
        self.joinedAt = Date()
        self.lastSeen = Date()
        self.cursorPosition = nil
        self.selection = nil
    }
}

// MARK: - Cursor and Selection

/// Cursor position in document
public struct CursorPosition: Codable, Equatable {
    public let line: Int
    public let column: Int
    public let offset: Int // Character offset from start

    public init(line: Int, column: Int, offset: Int) {
        self.line = line
        self.column = column
        self.offset = offset
    }
}

/// Text selection range
public struct TextSelection: Codable, Equatable {
    public let start: CursorPosition
    public let end: CursorPosition

    public init(start: CursorPosition, end: CursorPosition) {
        self.start = start
        self.end = end
    }

    public var isEmpty: Bool {
        start == end
    }
}

// MARK: - Active User

/// Represents an active user in collaboration session
public struct ActiveUser: Identifiable {
    public let id: String
    public let userId: String
    public let userName: String
    public let userColor: String // Hex color
    public var cursor: CursorPosition?
    public var selection: TextSelection?
    public var lastUpdate: Date

    public init(
        id: String = UUID().uuidString,
        userId: String,
        userName: String,
        userColor: String,
        cursor: CursorPosition? = nil,
        selection: TextSelection? = nil
    ) {
        self.id = id
        self.userId = userId
        self.userName = userName
        self.userColor = userColor
        self.cursor = cursor
        self.selection = selection
        self.lastUpdate = Date()
    }
}

// MARK: - CRDT Operations

/// CRDT operation types compatible with Yjs
public enum CRDTOperation: Codable {
    case insert(position: Int, content: String, clientId: String, timestamp: Date)
    case delete(position: Int, length: Int, clientId: String, timestamp: Date)
    case update(position: Int, oldContent: String, newContent: String, clientId: String, timestamp: Date)

    public var clientId: String {
        switch self {
        case .insert(_, _, let clientId, _),
             .delete(_, _, let clientId, _),
             .update(_, _, _, let clientId, _):
            return clientId
        }
    }

    public var timestamp: Date {
        switch self {
        case .insert(_, _, _, let timestamp),
             .delete(_, _, _, let timestamp),
             .update(_, _, _, _, let timestamp):
            return timestamp
        }
    }
}

/// CRDT update record stored in database
public struct CRDTUpdate: Codable, Identifiable {
    public let id: String
    public let documentId: String
    public let operation: CRDTOperation
    public let version: Int
    public let createdAt: Date

    public init(
        id: String = UUID().uuidString,
        documentId: String,
        operation: CRDTOperation,
        version: Int
    ) {
        self.id = id
        self.documentId = documentId
        self.operation = operation
        self.version = version
        self.createdAt = Date()
    }
}

// MARK: - Sync Message

/// Message types for P2P synchronization
public enum SyncMessage: Codable {
    case documentOpen(documentId: String, userId: String, userName: String)
    case documentClose(documentId: String, userId: String)
    case yjsSync(documentId: String, stateVector: Data, update: Data)
    case yjsAwareness(documentId: String, awarenessUpdate: Data)
    case cursorUpdate(documentId: String, userId: String, position: CursorPosition?, selection: TextSelection?)
    case error(code: String, message: String)

    public var documentId: String? {
        switch self {
        case .documentOpen(let docId, _, _),
             .documentClose(let docId, _),
             .yjsSync(let docId, _, _),
             .yjsAwareness(let docId, _),
             .cursorUpdate(let docId, _, _, _):
            return docId
        case .error:
            return nil
        }
    }
}

// MARK: - Collaboration Error

public enum CollaborationError: Error, LocalizedError {
    case permissionDenied
    case documentNotFound
    case sessionExpired
    case syncFailed(String)
    case conflictResolutionFailed
    case networkError(String)

    public var errorDescription: String? {
        switch self {
        case .permissionDenied:
            return "您没有权限编辑此文档"
        case .documentNotFound:
            return "文档不存在"
        case .sessionExpired:
            return "协作会话已过期"
        case .syncFailed(let message):
            return "同步失败: \(message)"
        case .conflictResolutionFailed:
            return "冲突解决失败"
        case .networkError(let message):
            return "网络错误: \(message)"
        }
    }
}
