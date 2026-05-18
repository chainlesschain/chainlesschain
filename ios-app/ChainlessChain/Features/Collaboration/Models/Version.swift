/**
 * Version.swift
 *
 * Version control and snapshot models for collaborative documents.
 */

import Foundation

// MARK: - Document Snapshot

/// Snapshot of a document at a specific point in time
public struct DocumentSnapshot: Codable, Identifiable {
    public let id: String
    public let documentId: String
    public let version: Int
    public let content: String
    public let snapshotData: Data? // Yjs snapshot binary
    public let stateVector: Data? // Yjs state vector
    public var metadata: SnapshotMetadata
    public let createdAt: Date

    public init(
        id: String = UUID().uuidString,
        documentId: String,
        version: Int,
        content: String,
        snapshotData: Data? = nil,
        stateVector: Data? = nil,
        metadata: SnapshotMetadata = SnapshotMetadata()
    ) {
        self.id = id
        self.documentId = documentId
        self.version = version
        self.content = content
        self.snapshotData = snapshotData
        self.stateVector = stateVector
        self.metadata = metadata
        self.createdAt = Date()
    }
}

// MARK: - Snapshot Metadata

/// Additional metadata for snapshots
public struct SnapshotMetadata: Codable {
    public var author: String?
    public var authorDID: String?
    public var comment: String?
    public var tags: [String]
    public var changeCount: Int
    public var isAutoSnapshot: Bool

    public init(
        author: String? = nil,
        authorDID: String? = nil,
        comment: String? = nil,
        tags: [String] = [],
        changeCount: Int = 0,
        isAutoSnapshot: Bool = false
    ) {
        self.author = author
        self.authorDID = authorDID
        self.comment = comment
        self.tags = tags
        self.changeCount = changeCount
        self.isAutoSnapshot = isAutoSnapshot
    }
}

// MARK: - Version Comparison

/// Comparison result between two versions
public struct VersionComparison: Identifiable {
    public let id = UUID()
    public let oldVersion: DocumentSnapshot
    public let newVersion: DocumentSnapshot
    public var changes: [Change]

    public init(oldVersion: DocumentSnapshot, newVersion: DocumentSnapshot) {
        self.oldVersion = oldVersion
        self.newVersion = newVersion
        self.changes = []
    }

    public struct Change: Identifiable {
        public let id = UUID()
        public let type: ChangeType
        public let position: Int
        public let oldContent: String
        public let newContent: String

        public enum ChangeType {
            case addition
            case deletion
            case modification
        }
    }
}

// MARK: - Version History Entry

/// Represents a version in the history timeline
public struct VersionHistoryEntry: Identifiable {
    public let id: String
    public let snapshotId: String
    public let version: Int
    public let timestamp: Date
    public var author: String
    public var authorDID: String?
    public var comment: String?
    public var changeCount: Int
    public var isAutoSnapshot: Bool
    public var isCurrent: Bool

    public init(
        id: String = UUID().uuidString,
        snapshotId: String,
        version: Int,
        timestamp: Date,
        author: String,
        authorDID: String? = nil,
        comment: String? = nil,
        changeCount: Int = 0,
        isAutoSnapshot: Bool = false,
        isCurrent: Bool = false
    ) {
        self.id = id
        self.snapshotId = snapshotId
        self.version = version
        self.timestamp = timestamp
        self.author = author
        self.authorDID = authorDID
        self.comment = comment
        self.changeCount = changeCount
        self.isAutoSnapshot = isAutoSnapshot
        self.isCurrent = isCurrent
    }

    /// Human-readable version label
    public var versionLabel: String {
        if isCurrent {
            return "v\(version) (当前)"
        }
        return "v\(version)"
    }

    /// Human-readable timestamp
    public var timeAgo: String {
        let now = Date()
        let interval = now.timeIntervalSince(timestamp)

        if interval < 60 {
            return "刚刚"
        } else if interval < 3600 {
            let minutes = Int(interval / 60)
            return "\(minutes)分钟前"
        } else if interval < 86400 {
            let hours = Int(interval / 3600)
            return "\(hours)小时前"
        } else if interval < 604800 {
            let days = Int(interval / 86400)
            return "\(days)天前"
        } else {
            let formatter = DateFormatter()
            formatter.dateStyle = .medium
            formatter.timeStyle = .short
            formatter.locale = Locale(identifier: "zh_CN")
            return formatter.string(from: timestamp)
        }
    }
}

// MARK: - Merge Strategy

/// Strategy for merging conflicting changes
public enum MergeStrategy {
    case ours // Keep local changes
    case theirs // Accept remote changes
    case manual // Manual conflict resolution
    case lastWriteWins // Use timestamp to decide
    case crdt // Use CRDT algorithm (default for Yjs)
}

// MARK: - Conflict

/// Represents a merge conflict
public struct MergeConflict: Identifiable {
    public let id = UUID()
    public let position: Int
    public let localContent: String
    public let remoteContent: String
    public var resolution: Resolution?

    public init(position: Int, localContent: String, remoteContent: String) {
        self.position = position
        self.localContent = localContent
        self.remoteContent = remoteContent
        self.resolution = nil
    }

    public enum Resolution {
        case useLocal
        case useRemote
        case custom(String)
    }
}
