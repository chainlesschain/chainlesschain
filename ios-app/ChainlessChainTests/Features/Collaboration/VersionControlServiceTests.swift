/**
 * VersionControlServiceTests.swift
 *
 * Unit tests for VersionControlService.
 * Tests snapshot creation, restoration, version history, and comparison.
 */

import XCTest
import SQLite
@testable import ChainlessChain

@MainActor
final class VersionControlServiceTests: XCTestCase {

    // MARK: - Properties

    var versionControl: VersionControlService!
    var testDB: Connection!

    // Test data
    let testDocumentId = "doc_001"
    let testContent1 = "Version 1 content"
    let testContent2 = "Version 2 content"
    let testContent3 = "Version 3 content"

    // MARK: - Setup & Teardown

    override func setUp() async throws {
        // Create in-memory database
        testDB = try Connection(.inMemory)

        // Create database tables
        try VersionControlService.createTables(db: testDB)

        // Initialize service
        versionControl = VersionControlService()
        versionControl.setDatabase(testDB)
    }

    override func tearDown() async throws {
        try? testDB.run(Table("document_snapshots").drop(ifExists: true))
        versionControl = nil
        testDB = nil
    }

    // MARK: - Snapshot Creation Tests

    func testCreateSnapshot() async throws {
        // Given
        let metadata = SnapshotMetadata(
            author: "Test User",
            authorDID: "did:example:test",
            comment: "Initial version",
            tags: ["v1"],
            changeCount: 5,
            isAutoSnapshot: false
        )

        // When
        let snapshot = try await versionControl.createSnapshot(
            documentId: testDocumentId,
            content: testContent1,
            version: 1,
            metadata: metadata
        )

        // Then
        XCTAssertNotNil(snapshot)
        XCTAssertEqual(snapshot.documentId, testDocumentId)
        XCTAssertEqual(snapshot.content, testContent1)
        XCTAssertEqual(snapshot.version, 1)
        XCTAssertEqual(snapshot.metadata.author, "Test User")
        XCTAssertEqual(snapshot.metadata.comment, "Initial version")

        // Verify saved to database
        let table = Table("document_snapshots")
        let id = Expression<String>("id")
        let count = try testDB.scalar(table.filter(id == snapshot.id).count)
        XCTAssertEqual(count, 1)
    }

    func testCreateMultipleSnapshots() async throws {
        // Given
        let metadata1 = SnapshotMetadata(author: "User1", changeCount: 5)
        let metadata2 = SnapshotMetadata(author: "User2", changeCount: 3)

        // When
        let snapshot1 = try await versionControl.createSnapshot(
            documentId: testDocumentId,
            content: testContent1,
            version: 1,
            metadata: metadata1
        )

        let snapshot2 = try await versionControl.createSnapshot(
            documentId: testDocumentId,
            content: testContent2,
            version: 2,
            metadata: metadata2
        )

        // Then
        XCTAssertNotEqual(snapshot1.id, snapshot2.id)
        XCTAssertEqual(snapshot1.version, 1)
        XCTAssertEqual(snapshot2.version, 2)
    }

    func testCreateAutoSnapshot() async throws {
        // Given/When
        let snapshot = try await versionControl.createAutoSnapshot(
            documentId: testDocumentId,
            content: testContent1,
            version: 1,
            changeCount: 10
        )

        // Then
        XCTAssertTrue(snapshot.metadata.isAutoSnapshot)
        XCTAssertEqual(snapshot.metadata.changeCount, 10)
    }

    func testCreateSnapshotWithoutDatabase() async throws {
        // Given
        versionControl.setDatabase(nil)

        let metadata = SnapshotMetadata()

        // When/Then
        do {
            _ = try await versionControl.createSnapshot(
                documentId: testDocumentId,
                content: testContent1,
                version: 1,
                metadata: metadata
            )
            XCTFail("Should throw error without database")
        } catch {
            // Expected
        }
    }

    // MARK: - Snapshot Restoration Tests

    func testRestoreSnapshot() async throws {
        // Given
        let metadata = SnapshotMetadata(author: "Test User")

        let snapshot = try await versionControl.createSnapshot(
            documentId: testDocumentId,
            content: testContent1,
            version: 1,
            metadata: metadata
        )

        // When
        let restored = try await versionControl.restoreSnapshot(snapshotId: snapshot.id)

        // Then
        XCTAssertEqual(restored.id, snapshot.id)
        XCTAssertEqual(restored.content, testContent1)
        XCTAssertEqual(restored.version, 1)
        XCTAssertEqual(restored.metadata.author, "Test User")
    }

    func testRestoreNonExistentSnapshot() async throws {
        // Given
        let fakeId = "non_existent_id"

        // When/Then
        do {
            _ = try await versionControl.restoreSnapshot(snapshotId: fakeId)
            XCTFail("Should throw error for non-existent snapshot")
        } catch {
            // Expected - should throw CollaborationError.documentNotFound
        }
    }

    // MARK: - Version History Tests

    func testGetVersionHistory() async throws {
        // Given - Create multiple snapshots
        for i in 1...5 {
            let metadata = SnapshotMetadata(
                author: "User\(i)",
                changeCount: i * 2
            )

            _ = try await versionControl.createSnapshot(
                documentId: testDocumentId,
                content: "Content \(i)",
                version: i,
                metadata: metadata
            )

            // Add small delay to ensure different timestamps
            try await Task.sleep(nanoseconds: 10_000_000) // 10ms
        }

        // When
        let history = try await versionControl.getVersionHistory(
            documentId: testDocumentId,
            limit: 10
        )

        // Then
        XCTAssertEqual(history.count, 5)

        // Should be in reverse chronological order (newest first)
        XCTAssertEqual(history[0].version, 5)
        XCTAssertEqual(history[4].version, 1)

        // Check metadata
        XCTAssertEqual(history[0].author, "User5")
        XCTAssertEqual(history[0].changeCount, 10)
    }

    func testGetVersionHistoryWithLimit() async throws {
        // Given - Create 10 snapshots
        for i in 1...10 {
            let metadata = SnapshotMetadata()

            _ = try await versionControl.createSnapshot(
                documentId: testDocumentId,
                content: "Content \(i)",
                version: i,
                metadata: metadata
            )
        }

        // When
        let history = try await versionControl.getVersionHistory(
            documentId: testDocumentId,
            limit: 5
        )

        // Then
        XCTAssertEqual(history.count, 5)
        XCTAssertEqual(history[0].version, 10) // Newest
        XCTAssertEqual(history[4].version, 6)  // 5th newest
    }

    func testGetVersionHistoryCurrentVersion() async throws {
        // Given
        let metadata1 = SnapshotMetadata()
        let metadata2 = SnapshotMetadata()

        _ = try await versionControl.createSnapshot(
            documentId: testDocumentId,
            content: testContent1,
            version: 1,
            metadata: metadata1
        )

        _ = try await versionControl.createSnapshot(
            documentId: testDocumentId,
            content: testContent2,
            version: 2,
            metadata: metadata2
        )

        // When
        let history = try await versionControl.getVersionHistory(
            documentId: testDocumentId,
            limit: 10
        )

        // Then
        XCTAssertTrue(history[0].isCurrent, "Latest version should be marked as current")
        XCTAssertFalse(history[1].isCurrent)
    }

    func testGetVersionHistoryEmptyDocument() async throws {
        // Given
        let documentId = "empty_doc"

        // When
        let history = try await versionControl.getVersionHistory(
            documentId: documentId,
            limit: 10
        )

        // Then
        XCTAssertEqual(history.count, 0)
    }

    func testVersionHistoryEntryLabels() async throws {
        // Given
        let metadata = SnapshotMetadata()

        let snapshot = try await versionControl.createSnapshot(
            documentId: testDocumentId,
            content: testContent1,
            version: 5,
            metadata: metadata
        )

        let history = try await versionControl.getVersionHistory(
            documentId: testDocumentId,
            limit: 10
        )

        // Then
        let entry = history.first!
        XCTAssertTrue(entry.versionLabel.contains("v5"))
        XCTAssertTrue(entry.versionLabel.contains("当前"))
    }

    func testVersionHistoryTimeAgo() async throws {
        // Given
        let metadata = SnapshotMetadata()

        _ = try await versionControl.createSnapshot(
            documentId: testDocumentId,
            content: testContent1,
            version: 1,
            metadata: metadata
        )

        let history = try await versionControl.getVersionHistory(
            documentId: testDocumentId,
            limit: 10
        )

        // Then
        let entry = history.first!
        XCTAssertEqual(entry.timeAgo, "刚刚") // Should be "just now"
    }

    // MARK: - Version Comparison Tests

    func testCompareVersions() async throws {
        // Given
        let metadata1 = SnapshotMetadata()
        let metadata2 = SnapshotMetadata()

        let snapshot1 = try await versionControl.createSnapshot(
            documentId: testDocumentId,
            content: "Hello",
            version: 1,
            metadata: metadata1
        )

        let snapshot2 = try await versionControl.createSnapshot(
            documentId: testDocumentId,
            content: "Hello World",
            version: 2,
            metadata: metadata2
        )

        // When
        let comparison = try await versionControl.compareVersions(
            oldSnapshotId: snapshot1.id,
            newSnapshotId: snapshot2.id
        )

        // Then
        XCTAssertEqual(comparison.oldVersion.id, snapshot1.id)
        XCTAssertEqual(comparison.newVersion.id, snapshot2.id)
        XCTAssertFalse(comparison.changes.isEmpty)
    }

    func testCompareIdenticalVersions() async throws {
        // Given
        let metadata = SnapshotMetadata()

        let snapshot1 = try await versionControl.createSnapshot(
            documentId: testDocumentId,
            content: "Same content",
            version: 1,
            metadata: metadata
        )

        let snapshot2 = try await versionControl.createSnapshot(
            documentId: testDocumentId,
            content: "Same content",
            version: 2,
            metadata: metadata
        )

        // When
        let comparison = try await versionControl.compareVersions(
            oldSnapshotId: snapshot1.id,
            newSnapshotId: snapshot2.id
        )

        // Then
        XCTAssertTrue(comparison.changes.isEmpty, "Identical content should have no changes")
    }

    func testCompareVersionsWithAddition() async throws {
        // Given
        let metadata = SnapshotMetadata()

        let snapshot1 = try await versionControl.createSnapshot(
            documentId: testDocumentId,
            content: "",
            version: 1,
            metadata: metadata
        )

        let snapshot2 = try await versionControl.createSnapshot(
            documentId: testDocumentId,
            content: "New content",
            version: 2,
            metadata: metadata
        )

        // When
        let comparison = try await versionControl.compareVersions(
            oldSnapshotId: snapshot1.id,
            newSnapshotId: snapshot2.id
        )

        // Then
        XCTAssertEqual(comparison.changes.count, 1)
        XCTAssertEqual(comparison.changes.first?.type, .addition)
    }

    func testCompareVersionsWithDeletion() async throws {
        // Given
        let metadata = SnapshotMetadata()

        let snapshot1 = try await versionControl.createSnapshot(
            documentId: testDocumentId,
            content: "Old content",
            version: 1,
            metadata: metadata
        )

        let snapshot2 = try await versionControl.createSnapshot(
            documentId: testDocumentId,
            content: "",
            version: 2,
            metadata: metadata
        )

        // When
        let comparison = try await versionControl.compareVersions(
            oldSnapshotId: snapshot1.id,
            newSnapshotId: snapshot2.id
        )

        // Then
        XCTAssertEqual(comparison.changes.count, 1)
        XCTAssertEqual(comparison.changes.first?.type, .deletion)
    }

    func testCompareVersionsWithModification() async throws {
        // Given
        let metadata = SnapshotMetadata()

        let snapshot1 = try await versionControl.createSnapshot(
            documentId: testDocumentId,
            content: "Old content",
            version: 1,
            metadata: metadata
        )

        let snapshot2 = try await versionControl.createSnapshot(
            documentId: testDocumentId,
            content: "New content",
            version: 2,
            metadata: metadata
        )

        // When
        let comparison = try await versionControl.compareVersions(
            oldSnapshotId: snapshot1.id,
            newSnapshotId: snapshot2.id
        )

        // Then
        XCTAssertEqual(comparison.changes.count, 1)
        XCTAssertEqual(comparison.changes.first?.type, .modification)
    }

    // MARK: - Cleanup Tests

    func testCleanupOldSnapshots() async throws {
        // Given - Create 15 snapshots
        for i in 1...15 {
            let metadata = SnapshotMetadata()

            _ = try await versionControl.createSnapshot(
                documentId: testDocumentId,
                content: "Content \(i)",
                version: i,
                metadata: metadata
            )
        }

        // When - Keep only last 10
        try await versionControl.cleanupOldSnapshots(
            documentId: testDocumentId,
            keepLast: 10
        )

        // Then
        let table = Table("document_snapshots")
        let docId = Expression<String>("document_id")
        let count = try testDB.scalar(table.filter(docId == testDocumentId).count)

        XCTAssertEqual(count, 10, "Should keep only 10 snapshots")
    }

    func testCleanupOldSnapshotsKeepsNewest() async throws {
        // Given
        var snapshotIds: [String] = []

        for i in 1...10 {
            let metadata = SnapshotMetadata()

            let snapshot = try await versionControl.createSnapshot(
                documentId: testDocumentId,
                content: "Content \(i)",
                version: i,
                metadata: metadata
            )
            snapshotIds.append(snapshot.id)

            // Small delay to ensure timestamp ordering
            try await Task.sleep(nanoseconds: 10_000_000)
        }

        // When - Keep only 5
        try await versionControl.cleanupOldSnapshots(
            documentId: testDocumentId,
            keepLast: 5
        )

        // Then - Latest 5 should remain
        let table = Table("document_snapshots")
        let id = Expression<String>("id")

        for i in 5..<10 {
            let count = try testDB.scalar(table.filter(id == snapshotIds[i]).count)
            XCTAssertEqual(count, 1, "Snapshot \(i) should exist")
        }

        for i in 0..<5 {
            let count = try testDB.scalar(table.filter(id == snapshotIds[i]).count)
            XCTAssertEqual(count, 0, "Snapshot \(i) should be deleted")
        }
    }

    func testCleanupWithFewerSnapshots() async throws {
        // Given - Only 5 snapshots
        for i in 1...5 {
            let metadata = SnapshotMetadata()

            _ = try await versionControl.createSnapshot(
                documentId: testDocumentId,
                content: "Content \(i)",
                version: i,
                metadata: metadata
            )
        }

        // When - Try to keep 10
        try await versionControl.cleanupOldSnapshots(
            documentId: testDocumentId,
            keepLast: 10
        )

        // Then - All 5 should remain
        let table = Table("document_snapshots")
        let docId = Expression<String>("document_id")
        let count = try testDB.scalar(table.filter(docId == testDocumentId).count)

        XCTAssertEqual(count, 5)
    }

    func testCleanupForNonExistentDocument() async throws {
        // Given
        let documentId = "non_existent"

        // When/Then - Should not throw
        try await versionControl.cleanupOldSnapshots(
            documentId: documentId,
            keepLast: 10
        )
    }

    // MARK: - Edge Cases

    func testCreateSnapshotWithEmptyContent() async throws {
        // Given
        let metadata = SnapshotMetadata()

        // When
        let snapshot = try await versionControl.createSnapshot(
            documentId: testDocumentId,
            content: "",
            version: 1,
            metadata: metadata
        )

        // Then
        XCTAssertEqual(snapshot.content, "")
    }

    func testCreateSnapshotWithLargeContent() async throws {
        // Given
        let largeContent = String(repeating: "A", count: 100000)
        let metadata = SnapshotMetadata()

        // When
        let snapshot = try await versionControl.createSnapshot(
            documentId: testDocumentId,
            content: largeContent,
            version: 1,
            metadata: metadata
        )

        // Then
        XCTAssertEqual(snapshot.content.count, 100000)
    }

    func testCreateSnapshotWithUnicodeContent() async throws {
        // Given
        let unicodeContent = "你好世界 🌍 Hello World"
        let metadata = SnapshotMetadata()

        // When
        let snapshot = try await versionControl.createSnapshot(
            documentId: testDocumentId,
            content: unicodeContent,
            version: 1,
            metadata: metadata
        )

        // Then
        XCTAssertEqual(snapshot.content, unicodeContent)
    }

    func testSnapshotMetadataWithAllFields() async throws {
        // Given
        let metadata = SnapshotMetadata(
            author: "Test User",
            authorDID: "did:example:test",
            comment: "Test comment",
            tags: ["tag1", "tag2", "tag3"],
            changeCount: 42,
            isAutoSnapshot: true
        )

        // When
        let snapshot = try await versionControl.createSnapshot(
            documentId: testDocumentId,
            content: testContent1,
            version: 1,
            metadata: metadata
        )

        let restored = try await versionControl.restoreSnapshot(snapshotId: snapshot.id)

        // Then
        XCTAssertEqual(restored.metadata.author, "Test User")
        XCTAssertEqual(restored.metadata.authorDID, "did:example:test")
        XCTAssertEqual(restored.metadata.comment, "Test comment")
        XCTAssertEqual(restored.metadata.tags.count, 3)
        XCTAssertEqual(restored.metadata.changeCount, 42)
        XCTAssertTrue(restored.metadata.isAutoSnapshot)
    }

    func testMultipleDocumentsVersionHistory() async throws {
        // Given - Create snapshots for multiple documents
        let doc1 = "doc_001"
        let doc2 = "doc_002"

        for i in 1...3 {
            let metadata = SnapshotMetadata()

            _ = try await versionControl.createSnapshot(
                documentId: doc1,
                content: "Doc1 Content \(i)",
                version: i,
                metadata: metadata
            )

            _ = try await versionControl.createSnapshot(
                documentId: doc2,
                content: "Doc2 Content \(i)",
                version: i,
                metadata: metadata
            )
        }

        // When
        let history1 = try await versionControl.getVersionHistory(documentId: doc1)
        let history2 = try await versionControl.getVersionHistory(documentId: doc2)

        // Then
        XCTAssertEqual(history1.count, 3)
        XCTAssertEqual(history2.count, 3)

        // Should not overlap
        let ids1 = Set(history1.map { $0.snapshotId })
        let ids2 = Set(history2.map { $0.snapshotId })
        XCTAssertTrue(ids1.isDisjoint(with: ids2))
    }
}
