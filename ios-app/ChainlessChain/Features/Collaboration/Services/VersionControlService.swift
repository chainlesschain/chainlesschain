/**
 * VersionControlService.swift
 *
 * Manages document version history and snapshots.
 * Provides snapshot creation, restoration, and version comparison.
 */

import Foundation
import SQLite

@MainActor
public class VersionControlService {

    // MARK: - Properties

    private var database: Connection?

    // MARK: - Initialization

    public init() {}

    /// Set database connection
    public func setDatabase(_ db: Connection) {
        self.database = db
    }

    // MARK: - Snapshot Management

    /// Create a snapshot of the current document state
    public func createSnapshot(
        documentId: String,
        content: String,
        version: Int,
        metadata: SnapshotMetadata
    ) async throws -> DocumentSnapshot {
        guard let db = database else {
            throw CollaborationError.syncFailed("Database not configured")
        }

        let snapshot = DocumentSnapshot(
            documentId: documentId,
            version: version,
            content: content,
            metadata: metadata
        )

        // Save to database
        let table = Table("document_snapshots")
        let id = Expression<String>("id")
        let docId = Expression<String>("document_id")
        let versionCol = Expression<Int>("version")
        let contentCol = Expression<String>("content")
        let metadataCol = Expression<String>("metadata")
        let createdAt = Expression<Int64>("created_at")

        let metadataJson = try JSONEncoder().encode(snapshot.metadata)

        try db.run(table.insert(
            id <- snapshot.id,
            docId <- snapshot.documentId,
            versionCol <- snapshot.version,
            contentCol <- snapshot.content,
            metadataCol <- String(data: metadataJson, encoding: .utf8) ?? "{}",
            createdAt <- Int64(snapshot.createdAt.timeIntervalSince1970)
        ))

        return snapshot
    }

    /// Create auto-snapshot (triggered after N changes)
    public func createAutoSnapshot(
        documentId: String,
        content: String,
        version: Int,
        changeCount: Int
    ) async throws -> DocumentSnapshot {
        let metadata = SnapshotMetadata(
            changeCount: changeCount,
            isAutoSnapshot: true
        )

        return try await createSnapshot(
            documentId: documentId,
            content: content,
            version: version,
            metadata: metadata
        )
    }

    /// Restore document from a snapshot
    public func restoreSnapshot(snapshotId: String) async throws -> DocumentSnapshot {
        guard let db = database else {
            throw CollaborationError.syncFailed("Database not configured")
        }

        let table = Table("document_snapshots")
        let id = Expression<String>("id")
        let documentId = Expression<String>("document_id")
        let version = Expression<Int>("version")
        let content = Expression<String>("content")
        let metadataCol = Expression<String>("metadata")
        let createdAt = Expression<Int64>("created_at")

        guard let row = try db.pluck(table.filter(id == snapshotId)) else {
            throw CollaborationError.documentNotFound
        }

        let metadataJson = row[metadataCol].data(using: .utf8) ?? Data()
        let metadata = try JSONDecoder().decode(SnapshotMetadata.self, from: metadataJson)

        return DocumentSnapshot(
            id: row[id],
            documentId: row[documentId],
            version: row[version],
            content: row[content],
            metadata: metadata
        )
    }

    /// Get version history for a document
    public func getVersionHistory(
        documentId: String,
        limit: Int = 50
    ) async throws -> [VersionHistoryEntry] {
        guard let db = database else {
            throw CollaborationError.syncFailed("Database not configured")
        }

        let table = Table("document_snapshots")
        let id = Expression<String>("id")
        let docId = Expression<String>("document_id")
        let version = Expression<Int>("version")
        let metadataCol = Expression<String>("metadata")
        let createdAt = Expression<Int64>("created_at")

        let rows = try db.prepare(
            table.filter(docId == documentId)
                .order(createdAt.desc)
                .limit(limit)
        )

        // Get current version
        let currentVersion = try getCurrentVersion(documentId: documentId)

        var entries: [VersionHistoryEntry] = []
        for row in rows {
            let metadataJson = row[metadataCol].data(using: .utf8) ?? Data()
            let metadata = try? JSONDecoder().decode(SnapshotMetadata.self, from: metadataJson)

            let entry = VersionHistoryEntry(
                id: row[id],
                snapshotId: row[id],
                version: row[version],
                timestamp: Date(timeIntervalSince1970: TimeInterval(row[createdAt])),
                author: metadata?.author ?? "Unknown",
                authorDID: metadata?.authorDID,
                comment: metadata?.comment,
                changeCount: metadata?.changeCount ?? 0,
                isAutoSnapshot: metadata?.isAutoSnapshot ?? false,
                isCurrent: row[version] == currentVersion
            )
            entries.append(entry)
        }

        return entries
    }

    /// Compare two versions
    public func compareVersions(
        oldSnapshotId: String,
        newSnapshotId: String
    ) async throws -> VersionComparison {
        let oldSnapshot = try await restoreSnapshot(snapshotId: oldSnapshotId)
        let newSnapshot = try await restoreSnapshot(snapshotId: newSnapshotId)

        var comparison = VersionComparison(
            oldVersion: oldSnapshot,
            newVersion: newSnapshot
        )

        // Simple diff algorithm (for production, use a better diff library)
        comparison.changes = computeChanges(
            old: oldSnapshot.content,
            new: newSnapshot.content
        )

        return comparison
    }

    /// Delete old snapshots (keep last N)
    public func cleanupOldSnapshots(
        documentId: String,
        keepLast: Int = 10
    ) async throws {
        guard let db = database else { return }

        let table = Table("document_snapshots")
        let id = Expression<String>("id")
        let docId = Expression<String>("document_id")
        let createdAt = Expression<Int64>("created_at")

        // Get all snapshots ordered by creation time
        let snapshots = try db.prepare(
            table.filter(docId == documentId)
                .order(createdAt.desc)
        )

        let snapshotIds = snapshots.map { $0[id] }

        // Keep last N, delete the rest
        if snapshotIds.count > keepLast {
            let toDelete = Array(snapshotIds.dropFirst(keepLast))

            for snapshotId in toDelete {
                try db.run(table.filter(id == snapshotId).delete())
            }
        }
    }

    // MARK: - Helper Methods

    private func getCurrentVersion(documentId: String) throws -> Int {
        guard let db = database else { return 0 }

        let table = Table("document_snapshots")
        let docId = Expression<String>("document_id")
        let version = Expression<Int>("version")

        guard let maxVersion = try db.scalar(
            table.filter(docId == documentId)
                .select(version.max)
        ) else {
            return 0
        }

        return maxVersion
    }

    private func computeChanges(old: String, new: String) -> [VersionComparison.Change] {
        // Simplified diff algorithm
        // In production, use a proper diff library
        var changes: [VersionComparison.Change] = []

        if old != new {
            if old.isEmpty {
                changes.append(VersionComparison.Change(
                    type: .addition,
                    position: 0,
                    oldContent: "",
                    newContent: new
                ))
            } else if new.isEmpty {
                changes.append(VersionComparison.Change(
                    type: .deletion,
                    position: 0,
                    oldContent: old,
                    newContent: ""
                ))
            } else {
                changes.append(VersionComparison.Change(
                    type: .modification,
                    position: 0,
                    oldContent: old,
                    newContent: new
                ))
            }
        }

        return changes
    }
}

// MARK: - Database Schema Extension

extension VersionControlService {
    /// Create necessary database tables
    public static func createTables(db: Connection) throws {
        // Document snapshots table
        let snapshots = Table("document_snapshots")
        let id = Expression<String>("id")
        let documentId = Expression<String>("document_id")
        let version = Expression<Int>("version")
        let content = Expression<String>("content")
        let snapshotData = Expression<Data?>("snapshot_data")
        let stateVector = Expression<Data?>("state_vector")
        let metadata = Expression<String>("metadata")
        let createdAt = Expression<Int64>("created_at")

        try db.run(snapshots.create(ifNotExists: true) { t in
            t.column(id, primaryKey: true)
            t.column(documentId)
            t.column(version)
            t.column(content)
            t.column(snapshotData)
            t.column(stateVector)
            t.column(metadata)
            t.column(createdAt)
        })

        try db.run(snapshots.createIndex(documentId, createdAt, ifNotExists: true))

        // Collaboration sessions table
        let sessions = Table("collaboration_sessions")
        let sessionId = Expression<String>("id")
        let docId = Expression<String>("document_id")
        let userId = Expression<String>("user_id")
        let userName = Expression<String>("user_name")
        let isActive = Expression<Bool>("is_active")
        let joinedAt = Expression<Int64>("joined_at")
        let lastSeen = Expression<Int64>("last_seen")

        try db.run(sessions.create(ifNotExists: true) { t in
            t.column(sessionId, primaryKey: true)
            t.column(docId)
            t.column(userId)
            t.column(userName)
            t.column(isActive)
            t.column(joinedAt)
            t.column(lastSeen)
        })

        try db.run(sessions.createIndex(docId, userId, ifNotExists: true))

        // Collaboration updates table
        let updates = Table("collaboration_updates")
        let updateId = Expression<String>("id")
        let updateDocId = Expression<String>("document_id")
        let updateData = Expression<Data>("update_data")
        let updateCreatedAt = Expression<Int64>("created_at")

        try db.run(updates.create(ifNotExists: true) { t in
            t.column(updateId, primaryKey: true)
            t.column(updateDocId)
            t.column(updateData)
            t.column(updateCreatedAt)
        })

        try db.run(updates.createIndex(updateDocId, updateCreatedAt, ifNotExists: true))
    }
}
