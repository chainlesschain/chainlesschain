/**
 * CollaborationManagerTests.swift
 *
 * Unit tests for CollaborationManager.
 * Tests session management, permissions, operations, and synchronization.
 */

import XCTest
import SQLite
@testable import ChainlessChain

@MainActor
final class CollaborationManagerTests: XCTestCase {

    // MARK: - Properties

    var manager: CollaborationManager!
    var testDB: Connection!

    // Test data
    let testUserId = "user_001"
    let testUserName = "Test User"
    let testDocumentId = "doc_001"
    let testKnowledgeId = "knowledge_001"
    let testOrgId = "org_001"

    // MARK: - Setup & Teardown

    override func setUp() async throws {
        // Create in-memory database
        testDB = try Connection(.inMemory)

        // Create database schema
        try createDatabaseTables()

        // Initialize manager
        manager = CollaborationManager.shared
        manager.setDatabase(testDB)
    }

    override func tearDown() async throws {
        // Clean up
        try? dropAllTables()
        manager = nil
        testDB = nil
    }

    private func createDatabaseTables() throws {
        // Collaboration sessions
        let sessions = Table("collaboration_sessions")
        try testDB.run(sessions.create(ifNotExists: true) { t in
            t.column(Expression<String>("id"), primaryKey: true)
            t.column(Expression<String>("document_id"))
            t.column(Expression<String>("user_id"))
            t.column(Expression<String>("user_name"))
            t.column(Expression<Bool>("is_active"))
            t.column(Expression<Int64>("joined_at"))
            t.column(Expression<Int64>("last_seen"))
        })

        // Collaboration updates
        let updates = Table("collaboration_updates")
        try testDB.run(updates.create(ifNotExists: true) { t in
            t.column(Expression<String>("id"), primaryKey: true)
            t.column(Expression<String>("document_id"))
            t.column(Expression<Data>("update_data"))
            t.column(Expression<Int64>("created_at"))
        })

        // Document snapshots
        let snapshots = Table("document_snapshots")
        try testDB.run(snapshots.create(ifNotExists: true) { t in
            t.column(Expression<String>("id"), primaryKey: true)
            t.column(Expression<String>("document_id"))
            t.column(Expression<Int>("version"))
            t.column(Expression<String>("content"))
            t.column(Expression<Data?>("snapshot_data"))
            t.column(Expression<Data?>("state_vector"))
            t.column(Expression<String>("metadata"))
            t.column(Expression<Int64>("created_at"))
        })
    }

    private func dropAllTables() throws {
        try testDB.run(Table("collaboration_sessions").drop(ifExists: true))
        try testDB.run(Table("collaboration_updates").drop(ifExists: true))
        try testDB.run(Table("document_snapshots").drop(ifExists: true))
    }

    // MARK: - Session Management Tests

    func testJoinSession() async throws {
        // Given
        let documentId = testDocumentId
        let userId = testUserId
        let userName = testUserName

        // When
        let session = try await manager.joinSession(
            documentId: documentId,
            knowledgeId: testKnowledgeId,
            userId: userId,
            userName: userName
        )

        // Then
        XCTAssertNotNil(session)
        XCTAssertEqual(session.documentId, documentId)
        XCTAssertEqual(session.userId, userId)
        XCTAssertEqual(session.userName, userName)
        XCTAssertTrue(session.isActive)

        // Verify saved to database
        let table = Table("collaboration_sessions")
        let id = Expression<String>("id")
        let count = try testDB.scalar(table.filter(id == session.id).count)
        XCTAssertEqual(count, 1)
    }

    func testJoinSessionUpdatesActiveUsers() async throws {
        // Given
        let documentId = testDocumentId

        // When
        _ = try await manager.joinSession(
            documentId: documentId,
            knowledgeId: testKnowledgeId,
            userId: testUserId,
            userName: testUserName
        )

        // Then
        let activeUsers = manager.activeUsers[documentId] ?? []
        XCTAssertEqual(activeUsers.count, 1)
        XCTAssertEqual(activeUsers.first?.userId, testUserId)
    }

    func testJoinSessionSetsSyncStatus() async throws {
        // Given
        let documentId = testDocumentId

        // When
        _ = try await manager.joinSession(
            documentId: documentId,
            knowledgeId: testKnowledgeId,
            userId: testUserId,
            userName: testUserName
        )

        // Then
        let status = manager.syncStatus[documentId]
        XCTAssertNotNil(status)

        if case .connected = status {
            // Success
        } else {
            XCTFail("Expected connected status")
        }
    }

    func testJoinMultipleSessions() async throws {
        // Given
        let doc1 = "doc_001"
        let doc2 = "doc_002"

        // When
        let session1 = try await manager.joinSession(
            documentId: doc1,
            knowledgeId: "knowledge_001",
            userId: testUserId,
            userName: testUserName
        )

        let session2 = try await manager.joinSession(
            documentId: doc2,
            knowledgeId: "knowledge_002",
            userId: testUserId,
            userName: testUserName
        )

        // Then
        XCTAssertEqual(manager.activeSessions.count, 2)
        XCTAssertNotNil(manager.activeSessions[doc1])
        XCTAssertNotNil(manager.activeSessions[doc2])
    }

    func testLeaveSession() async throws {
        // Given
        let documentId = testDocumentId

        let session = try await manager.joinSession(
            documentId: documentId,
            knowledgeId: testKnowledgeId,
            userId: testUserId,
            userName: testUserName
        )

        // When
        try await manager.leaveSession(documentId: documentId)

        // Then
        XCTAssertNil(manager.activeSessions[documentId])
        XCTAssertNil(manager.activeUsers[documentId])
        XCTAssertNil(manager.syncStatus[documentId])

        // Verify database updated
        let table = Table("collaboration_sessions")
        let id = Expression<String>("id")
        let isActive = Expression<Bool>("is_active")

        let row = try testDB.pluck(table.filter(id == session.id))
        XCTAssertNotNil(row)
        XCTAssertFalse(row![isActive])
    }

    func testLeaveNonExistentSession() async throws {
        // Given
        let documentId = "non_existent"

        // When/Then - Should not throw
        try await manager.leaveSession(documentId: documentId)
    }

    // MARK: - Document Operation Tests

    func testInsertText() async throws {
        // Given
        let documentId = testDocumentId

        try await manager.joinSession(
            documentId: documentId,
            knowledgeId: testKnowledgeId,
            userId: testUserId,
            userName: testUserName
        )

        // When
        try manager.insertText(
            documentId: documentId,
            position: 0,
            text: "Hello",
            userId: testUserId
        )

        // Then
        let content = manager.getDocumentContent(documentId: documentId)
        XCTAssertEqual(content, "Hello")
    }

    func testDeleteText() async throws {
        // Given
        let documentId = testDocumentId

        try await manager.joinSession(
            documentId: documentId,
            knowledgeId: testKnowledgeId,
            userId: testUserId,
            userName: testUserName
        )

        try manager.insertText(
            documentId: documentId,
            position: 0,
            text: "Hello World",
            userId: testUserId
        )

        // When
        try manager.deleteText(
            documentId: documentId,
            position: 5,
            length: 6,
            userId: testUserId
        )

        // Then
        let content = manager.getDocumentContent(documentId: documentId)
        XCTAssertEqual(content, "Hello")
    }

    func testGetDocumentContent() async throws {
        // Given
        let documentId = testDocumentId

        try await manager.joinSession(
            documentId: documentId,
            knowledgeId: testKnowledgeId,
            userId: testUserId,
            userName: testUserName
        )

        try manager.insertText(
            documentId: documentId,
            position: 0,
            text: "Test Content",
            userId: testUserId
        )

        // When
        let content = manager.getDocumentContent(documentId: documentId)

        // Then
        XCTAssertEqual(content, "Test Content")
    }

    func testSetDocumentContent() async throws {
        // Given
        let documentId = testDocumentId
        let initialContent = "Initial Content"

        // When
        manager.setDocumentContent(documentId: documentId, content: initialContent)

        // Then
        let content = manager.getDocumentContent(documentId: documentId)
        XCTAssertEqual(content, initialContent)
    }

    func testMultipleOperations() async throws {
        // Given
        let documentId = testDocumentId

        try await manager.joinSession(
            documentId: documentId,
            knowledgeId: testKnowledgeId,
            userId: testUserId,
            userName: testUserName
        )

        // When - Perform multiple operations
        try manager.insertText(documentId: documentId, position: 0, text: "Hello", userId: testUserId)
        try manager.insertText(documentId: documentId, position: 5, text: " World", userId: testUserId)
        try manager.deleteText(documentId: documentId, position: 5, length: 1, userId: testUserId)

        // Then
        let content = manager.getDocumentContent(documentId: documentId)
        XCTAssertEqual(content, "HelloWorld")
    }

    // MARK: - Cursor Update Tests

    func testUpdateCursor() async throws {
        // Given
        let documentId = testDocumentId

        try await manager.joinSession(
            documentId: documentId,
            knowledgeId: testKnowledgeId,
            userId: testUserId,
            userName: testUserName
        )

        let cursor = CursorPosition(line: 1, column: 5, offset: 5)

        // When
        manager.updateCursor(documentId: documentId, cursor: cursor)

        // Then
        let activeUsers = manager.activeUsers[documentId] ?? []
        XCTAssertEqual(activeUsers.first?.cursor, cursor)
    }

    func testUpdateCursorWithSelection() async throws {
        // Given
        let documentId = testDocumentId

        try await manager.joinSession(
            documentId: documentId,
            knowledgeId: testKnowledgeId,
            userId: testUserId,
            userName: testUserName
        )

        let cursor = CursorPosition(line: 1, column: 5, offset: 5)
        let selection = TextSelection(
            start: CursorPosition(line: 1, column: 0, offset: 0),
            end: cursor
        )

        // When
        manager.updateCursor(documentId: documentId, cursor: cursor, selection: selection)

        // Then
        let activeUsers = manager.activeUsers[documentId] ?? []
        XCTAssertEqual(activeUsers.first?.cursor, cursor)
        XCTAssertEqual(activeUsers.first?.selection, selection)
    }

    // MARK: - Synchronization Tests

    func testApplyRemoteUpdate() async throws {
        // Given
        let documentId = testDocumentId

        try await manager.joinSession(
            documentId: documentId,
            knowledgeId: testKnowledgeId,
            userId: testUserId,
            userName: testUserName
        )

        let operation = CRDTOperation.insert(
            position: 0,
            content: "Remote",
            clientId: "remote_client",
            timestamp: Date()
        )
        let updateData = try JSONEncoder().encode(operation)

        // When
        try manager.applyRemoteUpdate(
            documentId: documentId,
            update: updateData,
            peerId: "peer_001"
        )

        // Then
        let content = manager.getDocumentContent(documentId: documentId)
        XCTAssertEqual(content, "Remote")
    }

    func testApplyRemoteAwareness() async throws {
        // Given
        let documentId = testDocumentId

        try await manager.joinSession(
            documentId: documentId,
            knowledgeId: testKnowledgeId,
            userId: testUserId,
            userName: testUserName
        )

        let awarenessState = UserAwarenessState(
            userId: "remote_user",
            userName: "Remote User",
            color: "#FF0000",
            cursor: CursorPosition(line: 1, column: 10, offset: 10),
            selection: nil
        )
        let updateData = try JSONEncoder().encode(awarenessState)

        // When
        manager.applyRemoteAwareness(
            documentId: documentId,
            update: updateData,
            peerId: "peer_001"
        )

        // Then
        let activeUsers = manager.activeUsers[documentId] ?? []
        XCTAssertGreaterThan(activeUsers.count, 1)

        let remoteUser = activeUsers.first { $0.userId == "remote_user" }
        XCTAssertNotNil(remoteUser)
        XCTAssertEqual(remoteUser?.userName, "Remote User")
    }

    func testLoadDocumentUpdates() async throws {
        // Given
        let documentId = testDocumentId

        // Insert some updates into database
        let table = Table("collaboration_updates")
        let id = Expression<String>("id")
        let docId = Expression<String>("document_id")
        let updateData = Expression<Data>("update_data")
        let createdAt = Expression<Int64>("created_at")

        let operation1 = CRDTOperation.insert(
            position: 0,
            content: "Hello",
            clientId: "client_001",
            timestamp: Date()
        )
        let data1 = try JSONEncoder().encode(operation1)

        try testDB.run(table.insert(
            id <- UUID().uuidString,
            docId <- documentId,
            updateData <- data1,
            createdAt <- Int64(Date().timeIntervalSince1970)
        ))

        let operation2 = CRDTOperation.insert(
            position: 5,
            content: " World",
            clientId: "client_001",
            timestamp: Date()
        )
        let data2 = try JSONEncoder().encode(operation2)

        try testDB.run(table.insert(
            id <- UUID().uuidString,
            docId <- documentId,
            updateData <- data2,
            createdAt <- Int64(Date().timeIntervalSince1970 + 1)
        ))

        // When
        try await manager.loadDocumentUpdates(documentId: documentId)

        // Then
        let content = manager.getDocumentContent(documentId: documentId)
        XCTAssertEqual(content, "Hello World")
    }

    // MARK: - Conflict Resolution Tests

    func testResolveConflicts() async throws {
        // Given
        let documentId = testDocumentId

        try await manager.joinSession(
            documentId: documentId,
            knowledgeId: testKnowledgeId,
            userId: testUserId,
            userName: testUserName
        )

        // When/Then - CRDT should handle automatically
        try await manager.resolveConflicts(documentId: documentId)
    }

    // MARK: - Edge Cases

    func testInsertWithoutSession() async throws {
        // Given
        let documentId = "no_session"

        // When/Then - Should not crash
        try manager.insertText(
            documentId: documentId,
            position: 0,
            text: "Test",
            userId: testUserId
        )
    }

    func testUpdateCursorWithoutSession() async throws {
        // Given
        let documentId = "no_session"
        let cursor = CursorPosition(line: 1, column: 5, offset: 5)

        // When/Then - Should not crash
        manager.updateCursor(documentId: documentId, cursor: cursor)
    }

    func testGetContentForNonExistentDocument() async throws {
        // Given
        let documentId = "non_existent"

        // When
        let content = manager.getDocumentContent(documentId: documentId)

        // Then - Should return empty string
        XCTAssertEqual(content, "")
    }

    func testMultipleUsersInSession() async throws {
        // Given
        let documentId = testDocumentId

        try await manager.joinSession(
            documentId: documentId,
            knowledgeId: testKnowledgeId,
            userId: "user_001",
            userName: "User 1"
        )

        // Simulate second user joining (via awareness update)
        let user2State = UserAwarenessState(
            userId: "user_002",
            userName: "User 2",
            color: "#00FF00",
            cursor: nil,
            selection: nil
        )
        let updateData = try JSONEncoder().encode(user2State)

        manager.applyRemoteAwareness(
            documentId: documentId,
            update: updateData,
            peerId: "peer_002"
        )

        // Then
        let activeUsers = manager.activeUsers[documentId] ?? []
        XCTAssertEqual(activeUsers.count, 2)
    }

    func testLargeContentOperations() async throws {
        // Given
        let documentId = testDocumentId

        try await manager.joinSession(
            documentId: documentId,
            knowledgeId: testKnowledgeId,
            userId: testUserId,
            userName: testUserName
        )

        // When - Insert large content
        let largeText = String(repeating: "A", count: 10000)
        try manager.insertText(
            documentId: documentId,
            position: 0,
            text: largeText,
            userId: testUserId
        )

        // Then
        let content = manager.getDocumentContent(documentId: documentId)
        XCTAssertEqual(content.count, 10000)
    }

    func testSessionPersistence() async throws {
        // Given
        let documentId = testDocumentId

        let session = try await manager.joinSession(
            documentId: documentId,
            knowledgeId: testKnowledgeId,
            userId: testUserId,
            userName: testUserName
        )

        // When - Query database directly
        let table = Table("collaboration_sessions")
        let id = Expression<String>("id")
        let userId = Expression<String>("user_id")

        let row = try testDB.pluck(table.filter(id == session.id))

        // Then
        XCTAssertNotNil(row)
        XCTAssertEqual(row![userId], testUserId)
    }
}
