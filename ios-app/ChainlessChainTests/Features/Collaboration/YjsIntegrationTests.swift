/**
 * YjsIntegrationTests.swift
 *
 * Unit tests for Yjs CRDT integration.
 * Tests document management, CRDT operations, state vectors, and awareness.
 */

import XCTest
@testable import ChainlessChain

@MainActor
final class YjsIntegrationTests: XCTestCase {

    // MARK: - Properties

    var yjsIntegration: YjsIntegration!

    // MARK: - Setup & Teardown

    override func setUp() async throws {
        yjsIntegration = YjsIntegration()
    }

    override func tearDown() async throws {
        yjsIntegration.destroy()
        yjsIntegration = nil
    }

    // MARK: - Document Management Tests

    func testGetDocument() async throws {
        // Given
        let documentId = "doc_001"

        // When
        let doc = yjsIntegration.getDocument(documentId)

        // Then
        XCTAssertNotNil(doc)
        XCTAssertEqual(doc.id, documentId)
    }

    func testGetDocumentReturnsSameInstance() async throws {
        // Given
        let documentId = "doc_001"

        // When
        let doc1 = yjsIntegration.getDocument(documentId)
        let doc2 = yjsIntegration.getDocument(documentId)

        // Then
        XCTAssertTrue(doc1 === doc2, "Should return same document instance")
    }

    func testGetMultipleDocuments() async throws {
        // Given
        let docId1 = "doc_001"
        let docId2 = "doc_002"

        // When
        let doc1 = yjsIntegration.getDocument(docId1)
        let doc2 = yjsIntegration.getDocument(docId2)

        // Then
        XCTAssertNotNil(doc1)
        XCTAssertNotNil(doc2)
        XCTAssertFalse(doc1 === doc2, "Should be different instances")
    }

    func testOpenDocument() async throws {
        // Given
        let documentId = "doc_001"
        let userId = "user_001"
        let userName = "Test User"

        // When
        let (doc, awareness) = try await yjsIntegration.openDocument(
            documentId,
            userId: userId,
            userName: userName
        )

        // Then
        XCTAssertNotNil(doc)
        XCTAssertNotNil(awareness)
        XCTAssertEqual(doc.id, documentId)

        // Check awareness state is set
        let activeUsers = yjsIntegration.getActiveUsers(documentId)
        XCTAssertEqual(activeUsers.count, 1)
        XCTAssertEqual(activeUsers.first?.userId, userId)
        XCTAssertEqual(activeUsers.first?.userName, userName)
    }

    func testCloseDocument() async throws {
        // Given
        let documentId = "doc_001"
        let userId = "user_001"
        let userName = "Test User"

        try await yjsIntegration.openDocument(
            documentId,
            userId: userId,
            userName: userName
        )

        // When
        await yjsIntegration.closeDocument(documentId)

        // Then
        let activeUsers = yjsIntegration.getActiveUsers(documentId)
        XCTAssertEqual(activeUsers.count, 0, "Should have no active users after close")
    }

    // MARK: - CRDT Operation Tests

    func testInsertText() async throws {
        // Given
        let documentId = "doc_001"
        let doc = yjsIntegration.getDocument(documentId)
        let clientId = "client_001"

        // When
        doc.insert(0, "Hello", clientId: clientId)

        // Then
        XCTAssertEqual(doc.getText(), "Hello")
    }

    func testInsertTextAtPosition() async throws {
        // Given
        let documentId = "doc_001"
        let doc = yjsIntegration.getDocument(documentId)
        let clientId = "client_001"

        doc.insert(0, "Hello", clientId: clientId)

        // When
        doc.insert(5, " World", clientId: clientId)

        // Then
        XCTAssertEqual(doc.getText(), "Hello World")
    }

    func testInsertTextInMiddle() async throws {
        // Given
        let documentId = "doc_001"
        let doc = yjsIntegration.getDocument(documentId)
        let clientId = "client_001"

        doc.insert(0, "HelloWorld", clientId: clientId)

        // When
        doc.insert(5, " ", clientId: clientId)

        // Then
        XCTAssertEqual(doc.getText(), "Hello World")
    }

    func testDeleteText() async throws {
        // Given
        let documentId = "doc_001"
        let doc = yjsIntegration.getDocument(documentId)
        let clientId = "client_001"

        doc.insert(0, "Hello World", clientId: clientId)

        // When
        doc.delete(5, 6, clientId: clientId) // Delete " World"

        // Then
        XCTAssertEqual(doc.getText(), "Hello")
    }

    func testDeleteTextFromMiddle() async throws {
        // Given
        let documentId = "doc_001"
        let doc = yjsIntegration.getDocument(documentId)
        let clientId = "client_001"

        doc.insert(0, "Hello World", clientId: clientId)

        // When
        doc.delete(0, 6, clientId: clientId) // Delete "Hello "

        // Then
        XCTAssertEqual(doc.getText(), "World")
    }

    func testDeleteBeyondLength() async throws {
        // Given
        let documentId = "doc_001"
        let doc = yjsIntegration.getDocument(documentId)
        let clientId = "client_001"

        doc.insert(0, "Hello", clientId: clientId)

        // When - Try to delete beyond content length
        doc.delete(3, 10, clientId: clientId)

        // Then - Should only delete to end
        XCTAssertEqual(doc.getText(), "Hel")
    }

    func testMultipleOperations() async throws {
        // Given
        let documentId = "doc_001"
        let doc = yjsIntegration.getDocument(documentId)
        let clientId = "client_001"

        // When - Perform multiple operations
        doc.insert(0, "Hello", clientId: clientId)
        doc.insert(5, " World", clientId: clientId)
        doc.delete(5, 1, clientId: clientId) // Delete space
        doc.insert(5, "!!!", clientId: clientId)

        // Then
        XCTAssertEqual(doc.getText(), "HelloWorld!!!")
    }

    // MARK: - State Vector Tests

    func testEncodeStateVector() async throws {
        // Given
        let documentId = "doc_001"
        let doc = yjsIntegration.getDocument(documentId)
        let clientId = "client_001"

        doc.insert(0, "Hello", clientId: clientId)

        // When
        let stateVector = yjsIntegration.getStateVector(documentId)

        // Then
        XCTAssertFalse(stateVector.isEmpty)
    }

    func testGetDiffUpdate() async throws {
        // Given
        let documentId = "doc_001"
        let doc = yjsIntegration.getDocument(documentId)
        let clientId = "client_001"

        doc.insert(0, "Hello", clientId: clientId)

        let remoteStateVector = yjsIntegration.getStateVector(documentId)

        doc.insert(5, " World", clientId: clientId)

        // When
        let diffUpdate = yjsIntegration.getDiffUpdate(documentId, remoteStateVector: remoteStateVector)

        // Then
        XCTAssertFalse(diffUpdate.isEmpty, "Should have diff update")
    }

    func testApplyUpdate() async throws {
        // Given
        let documentId = "doc_001"
        let doc = yjsIntegration.getDocument(documentId)
        let clientId = "client_001"

        doc.insert(0, "Hello", clientId: clientId)

        // Create update data
        let operation = CRDTOperation.insert(
            position: 5,
            content: " World",
            clientId: clientId,
            timestamp: Date()
        )
        let updateData = try JSONEncoder().encode(operation)

        // When
        try yjsIntegration.applyUpdate(documentId, update: updateData)

        // Then
        XCTAssertEqual(doc.getText(), "Hello World")
    }

    func testApplyInvalidUpdate() async throws {
        // Given
        let documentId = "doc_001"
        let invalidData = Data([0x00, 0x01, 0x02])

        // When/Then
        XCTAssertThrowsError(try yjsIntegration.applyUpdate(documentId, update: invalidData))
    }

    // MARK: - Awareness Tests

    func testGetAwareness() async throws {
        // Given
        let documentId = "doc_001"

        // When
        let awareness = yjsIntegration.getAwareness(documentId)

        // Then
        XCTAssertNotNil(awareness)
    }

    func testUpdateCursor() async throws {
        // Given
        let documentId = "doc_001"
        let userId = "user_001"
        let userName = "Test User"

        try await yjsIntegration.openDocument(
            documentId,
            userId: userId,
            userName: userName
        )

        let cursor = CursorPosition(line: 1, column: 5, offset: 5)

        // When
        yjsIntegration.updateCursor(documentId, cursor: cursor)

        // Then
        let activeUsers = yjsIntegration.getActiveUsers(documentId)
        XCTAssertEqual(activeUsers.count, 1)
        XCTAssertEqual(activeUsers.first?.cursor, cursor)
    }

    func testUpdateCursorWithSelection() async throws {
        // Given
        let documentId = "doc_001"
        let userId = "user_001"
        let userName = "Test User"

        try await yjsIntegration.openDocument(
            documentId,
            userId: userId,
            userName: userName
        )

        let cursor = CursorPosition(line: 1, column: 5, offset: 5)
        let selection = TextSelection(
            start: CursorPosition(line: 1, column: 0, offset: 0),
            end: cursor
        )

        // When
        yjsIntegration.updateCursor(documentId, cursor: cursor, selection: selection)

        // Then
        let activeUsers = yjsIntegration.getActiveUsers(documentId)
        XCTAssertEqual(activeUsers.first?.cursor, cursor)
        XCTAssertEqual(activeUsers.first?.selection, selection)
    }

    func testGetActiveUsers() async throws {
        // Given
        let documentId = "doc_001"

        // When - No users yet
        var activeUsers = yjsIntegration.getActiveUsers(documentId)

        // Then
        XCTAssertEqual(activeUsers.count, 0)

        // When - Open document
        try await yjsIntegration.openDocument(
            documentId,
            userId: "user_001",
            userName: "User 1"
        )

        activeUsers = yjsIntegration.getActiveUsers(documentId)

        // Then
        XCTAssertEqual(activeUsers.count, 1)
    }

    func testMultipleActiveUsers() async throws {
        // Given
        let documentId = "doc_001"
        let awareness = yjsIntegration.getAwareness(documentId)

        // Create user states
        let user1State = UserAwarenessState(
            userId: "user_001",
            userName: "User 1",
            color: "#FF0000",
            cursor: nil,
            selection: nil
        )

        let user2State = UserAwarenessState(
            userId: "user_002",
            userName: "User 2",
            color: "#00FF00",
            cursor: nil,
            selection: nil
        )

        awareness.setLocalState(user1State)

        let user2Data = try JSONEncoder().encode(user2State)

        // When
        yjsIntegration.applyAwarenessUpdate(documentId, update: user2Data, peerId: "peer_002")

        // Then
        let activeUsers = yjsIntegration.getActiveUsers(documentId)
        XCTAssertEqual(activeUsers.count, 2)

        let userIds = Set(activeUsers.map { $0.userId })
        XCTAssertTrue(userIds.contains("user_001"))
        XCTAssertTrue(userIds.contains("user_002"))
    }

    func testApplyAwarenessUpdate() async throws {
        // Given
        let documentId = "doc_001"

        let userState = UserAwarenessState(
            userId: "user_remote",
            userName: "Remote User",
            color: "#0000FF",
            cursor: CursorPosition(line: 1, column: 10, offset: 10),
            selection: nil
        )

        let updateData = try JSONEncoder().encode(userState)

        // When
        yjsIntegration.applyAwarenessUpdate(documentId, update: updateData, peerId: "peer_001")

        // Then
        let activeUsers = yjsIntegration.getActiveUsers(documentId)
        XCTAssertEqual(activeUsers.count, 1)
        XCTAssertEqual(activeUsers.first?.userId, "user_remote")
        XCTAssertEqual(activeUsers.first?.userName, "Remote User")
    }

    // MARK: - Concurrent Editing Tests

    func testConcurrentInserts() async throws {
        // Given
        let documentId = "doc_001"
        let doc = yjsIntegration.getDocument(documentId)

        // When - Simulate concurrent inserts
        doc.insert(0, "A", clientId: "client_001")
        doc.insert(1, "B", clientId: "client_002")
        doc.insert(2, "C", clientId: "client_001")

        // Then
        XCTAssertEqual(doc.getText(), "ABC")
    }

    func testConcurrentDeleteAndInsert() async throws {
        // Given
        let documentId = "doc_001"
        let doc = yjsIntegration.getDocument(documentId)

        doc.insert(0, "Hello World", clientId: "client_001")

        // When - Delete and insert at same time
        doc.delete(6, 5, clientId: "client_001") // Delete "World"
        doc.insert(6, "Swift", clientId: "client_002")

        // Then - Should have both operations applied
        XCTAssertTrue(doc.getText().contains("Swift"))
    }

    // MARK: - Edge Cases

    func testInsertIntoEmptyDocument() async throws {
        // Given
        let documentId = "doc_001"
        let doc = yjsIntegration.getDocument(documentId)

        // When
        doc.insert(0, "First", clientId: "client_001")

        // Then
        XCTAssertEqual(doc.getText(), "First")
    }

    func testDeleteFromEmptyDocument() async throws {
        // Given
        let documentId = "doc_001"
        let doc = yjsIntegration.getDocument(documentId)

        // When - Try to delete from empty
        doc.delete(0, 5, clientId: "client_001")

        // Then - Should remain empty
        XCTAssertEqual(doc.getText(), "")
    }

    func testInsertAtInvalidPosition() async throws {
        // Given
        let documentId = "doc_001"
        let doc = yjsIntegration.getDocument(documentId)

        doc.insert(0, "Hello", clientId: "client_001")

        // When - Insert beyond length (should append)
        doc.insert(100, " World", clientId: "client_001")

        // Then
        XCTAssertEqual(doc.getText(), "Hello World")
    }

    func testLargeDocument() async throws {
        // Given
        let documentId = "doc_001"
        let doc = yjsIntegration.getDocument(documentId)
        let clientId = "client_001"

        // When - Insert large content
        let largeText = String(repeating: "A", count: 10000)
        doc.insert(0, largeText, clientId: clientId)

        // Then
        XCTAssertEqual(doc.getText().count, 10000)
    }

    func testManyOperations() async throws {
        // Given
        let documentId = "doc_001"
        let doc = yjsIntegration.getDocument(documentId)
        let clientId = "client_001"

        // When - Perform many operations
        for i in 0..<100 {
            doc.insert(i, "A", clientId: clientId)
        }

        // Then
        XCTAssertEqual(doc.getText().count, 100)
    }

    func testUnicodeContent() async throws {
        // Given
        let documentId = "doc_001"
        let doc = yjsIntegration.getDocument(documentId)
        let clientId = "client_001"

        // When - Insert unicode
        doc.insert(0, "你好世界 🌍", clientId: clientId)

        // Then
        XCTAssertEqual(doc.getText(), "你好世界 🌍")
    }

    func testUpdateCursorWithoutOpening() async throws {
        // Given
        let documentId = "doc_001"
        let cursor = CursorPosition(line: 1, column: 5, offset: 5)

        // When - Try to update cursor without opening document
        yjsIntegration.updateCursor(documentId, cursor: cursor)

        // Then - Should not crash, but no users
        let activeUsers = yjsIntegration.getActiveUsers(documentId)
        XCTAssertEqual(activeUsers.count, 0)
    }

    // MARK: - Cleanup Tests

    func testDestroy() async throws {
        // Given
        let documentId = "doc_001"
        try await yjsIntegration.openDocument(
            documentId,
            userId: "user_001",
            userName: "Test User"
        )

        // When
        yjsIntegration.destroy()

        // Then - Should clear all state
        // Note: Can't test directly as it clears internal state
        // Just ensure no crash
    }
}
