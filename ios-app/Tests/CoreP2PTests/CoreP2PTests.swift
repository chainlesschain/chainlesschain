import XCTest
@testable import CoreP2P
@testable import CoreCommon
@testable import CoreE2EE

final class CoreP2PTests: XCTestCase {

    // MARK: - Message Manager Tests

    func testMessageCreation() {
        let message = P2PMessage(
            id: "msg-123",
            from: "peer-alice",
            to: "peer-bob",
            type: .text,
            content: "Hello, Bob!",
            timestamp: Date()
        )

        XCTAssertEqual(message.id, "msg-123")
        XCTAssertEqual(message.from, "peer-alice")
        XCTAssertEqual(message.to, "peer-bob")
        XCTAssertEqual(message.type, .text)
        XCTAssertEqual(message.content, "Hello, Bob!")
    }

    func testMessageSerialization() throws {
        let message = P2PMessage(
            id: "msg-456",
            from: "alice",
            to: "bob",
            type: .text,
            content: "Test message",
            timestamp: Date()
        )

        let encoded = try JSONEncoder().encode(message)
        let decoded = try JSONDecoder().decode(P2PMessage.self, from: encoded)

        XCTAssertEqual(decoded.id, message.id)
        XCTAssertEqual(decoded.content, message.content)
    }

    func testMessageTypes() {
        XCTAssertEqual(P2PMessageType.text.rawValue, "text")
        XCTAssertEqual(P2PMessageType.image.rawValue, "image")
        XCTAssertEqual(P2PMessageType.file.rawValue, "file")
        XCTAssertEqual(P2PMessageType.system.rawValue, "system")
    }

    // MARK: - Message Queue Tests

    func testMessageQueueEnqueue() {
        let queue = MessageQueue()

        queue.enqueue(P2PMessage(
            id: "1",
            from: "a",
            to: "b",
            type: .text,
            content: "First",
            timestamp: Date()
        ))

        queue.enqueue(P2PMessage(
            id: "2",
            from: "a",
            to: "b",
            type: .text,
            content: "Second",
            timestamp: Date()
        ))

        XCTAssertEqual(queue.count, 2)
    }

    func testMessageQueueDequeue() {
        let queue = MessageQueue()

        queue.enqueue(P2PMessage(
            id: "1",
            from: "a",
            to: "b",
            type: .text,
            content: "First",
            timestamp: Date()
        ))

        queue.enqueue(P2PMessage(
            id: "2",
            from: "a",
            to: "b",
            type: .text,
            content: "Second",
            timestamp: Date()
        ))

        let first = queue.dequeue()
        XCTAssertEqual(first?.id, "1")
        XCTAssertEqual(queue.count, 1)

        let second = queue.dequeue()
        XCTAssertEqual(second?.id, "2")
        XCTAssertEqual(queue.count, 0)
    }

    func testMessageQueuePriority() {
        let queue = MessageQueue()

        queue.enqueue(P2PMessage(
            id: "normal",
            from: "a",
            to: "b",
            type: .text,
            content: "Normal",
            timestamp: Date(),
            priority: .normal
        ))

        queue.enqueue(P2PMessage(
            id: "high",
            from: "a",
            to: "b",
            type: .text,
            content: "High Priority",
            timestamp: Date(),
            priority: .high
        ))

        // High priority should come first
        let first = queue.dequeue()
        XCTAssertEqual(first?.id, "high")
    }

    // MARK: - Message Deduplication Tests

    func testMessageDeduplication() {
        let deduplicator = MessageDeduplicator()
        let messageId = "msg-123"

        // First occurrence
        XCTAssertFalse(deduplicator.isDuplicate(messageId))
        deduplicator.markSeen(messageId)

        // Second occurrence should be duplicate
        XCTAssertTrue(deduplicator.isDuplicate(messageId))
    }

    func testDeduplicatorCleanup() {
        let deduplicator = MessageDeduplicator(maxAge: 0.1) // 100ms

        deduplicator.markSeen("old-message")

        // Wait for message to expire
        Thread.sleep(forTimeInterval: 0.2)
        deduplicator.cleanup()

        // Should no longer be considered duplicate
        XCTAssertFalse(deduplicator.isDuplicate("old-message"))
    }

    // MARK: - Connection State Tests

    func testConnectionState() {
        XCTAssertEqual(ConnectionState.disconnected.description, "Disconnected")
        XCTAssertEqual(ConnectionState.connecting.description, "Connecting")
        XCTAssertEqual(ConnectionState.connected.description, "Connected")
        XCTAssertEqual(ConnectionState.reconnecting.description, "Reconnecting")
    }

    func testConnectionStateTransitions() {
        var state = ConnectionState.disconnected

        // Valid transition: disconnected -> connecting
        state = .connecting
        XCTAssertEqual(state, .connecting)

        // Valid transition: connecting -> connected
        state = .connected
        XCTAssertEqual(state, .connected)

        // Valid transition: connected -> disconnected
        state = .disconnected
        XCTAssertEqual(state, .disconnected)
    }

    // MARK: - Peer Info Tests

    func testPeerInfo() {
        let peer = PeerInfo(
            id: "peer-123",
            did: "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK",
            displayName: "Alice",
            publicKey: Data([0x01, 0x02, 0x03])
        )

        XCTAssertEqual(peer.id, "peer-123")
        XCTAssertTrue(peer.did.hasPrefix("did:key:"))
        XCTAssertEqual(peer.displayName, "Alice")
    }

    func testPeerInfoEquality() {
        let peer1 = PeerInfo(id: "peer-1", did: "did:1", displayName: "Test", publicKey: Data())
        let peer2 = PeerInfo(id: "peer-1", did: "did:1", displayName: "Test", publicKey: Data())
        let peer3 = PeerInfo(id: "peer-2", did: "did:2", displayName: "Other", publicKey: Data())

        XCTAssertEqual(peer1, peer2)
        XCTAssertNotEqual(peer1, peer3)
    }

    // MARK: - Signaling Message Tests

    func testSignalingOffer() throws {
        let offer = SignalingMessage.offer(
            from: "alice",
            to: "bob",
            sdp: "v=0\r\no=- 123456 2 IN IP4 127.0.0.1\r\n..."
        )

        XCTAssertEqual(offer.type, .offer)
        XCTAssertEqual(offer.from, "alice")
        XCTAssertEqual(offer.to, "bob")
    }

    func testSignalingAnswer() throws {
        let answer = SignalingMessage.answer(
            from: "bob",
            to: "alice",
            sdp: "v=0\r\no=- 654321 2 IN IP4 127.0.0.1\r\n..."
        )

        XCTAssertEqual(answer.type, .answer)
    }

    func testSignalingICECandidate() throws {
        let ice = SignalingMessage.iceCandidate(
            from: "alice",
            to: "bob",
            candidate: "candidate:1 1 UDP 2122252543 192.168.1.1 54321 typ host",
            sdpMid: "0",
            sdpMLineIndex: 0
        )

        XCTAssertEqual(ice.type, .iceCandidate)
    }

    // MARK: - Batch Processing Tests

    func testBatchProcessor() {
        let processor = BatchProcessor<P2PMessage>(
            batchSize: 3,
            flushInterval: 1.0
        ) { batch in
            XCTAssertEqual(batch.count, 3)
        }

        for i in 0..<3 {
            processor.add(P2PMessage(
                id: "\(i)",
                from: "a",
                to: "b",
                type: .text,
                content: "Message \(i)",
                timestamp: Date()
            ))
        }

        processor.flush()
    }

    // MARK: - Retry Logic Tests

    func testExponentialBackoff() {
        let backoff = ExponentialBackoff(
            initialDelay: 1.0,
            maxDelay: 60.0,
            multiplier: 2.0
        )

        XCTAssertEqual(backoff.nextDelay(attempt: 0), 1.0)
        XCTAssertEqual(backoff.nextDelay(attempt: 1), 2.0)
        XCTAssertEqual(backoff.nextDelay(attempt: 2), 4.0)
        XCTAssertEqual(backoff.nextDelay(attempt: 3), 8.0)

        // Should cap at max delay
        XCTAssertEqual(backoff.nextDelay(attempt: 10), 60.0)
    }

    func testBackoffWithJitter() {
        let backoff = ExponentialBackoff(
            initialDelay: 1.0,
            maxDelay: 60.0,
            multiplier: 2.0,
            jitter: 0.1
        )

        let delay1 = backoff.nextDelay(attempt: 1)
        let delay2 = backoff.nextDelay(attempt: 1)

        // With jitter, delays should vary slightly
        XCTAssertTrue(delay1 >= 1.8 && delay1 <= 2.2)
        XCTAssertTrue(delay2 >= 1.8 && delay2 <= 2.2)
    }
}

// MARK: - P2P Error Tests

final class P2PErrorTests: XCTestCase {

    func testP2PErrorDescriptions() {
        let connectionError = P2PError.connectionFailed("test")
        XCTAssertTrue(connectionError.localizedDescription.contains("Connection"))

        let peerNotFoundError = P2PError.peerNotFound("peer123")
        XCTAssertTrue(peerNotFoundError.localizedDescription.contains("not found"))

        let signalingError = P2PError.signalingFailed("timeout")
        XCTAssertTrue(signalingError.localizedDescription.contains("Signaling"))
    }
}

// MARK: - Mock Classes for Testing

private class MockWebRTCDelegate: WebRTCManagerDelegate {
    var onConnected: ((String) -> Void)?
    var onDisconnected: ((String) -> Void)?
    var onMessageReceived: ((String, Data) -> Void)?

    func webRTCManager(_ manager: WebRTCManager, didConnectTo peerId: String) {
        onConnected?(peerId)
    }

    func webRTCManager(_ manager: WebRTCManager, didDisconnectFrom peerId: String) {
        onDisconnected?(peerId)
    }

    func webRTCManager(_ manager: WebRTCManager, didReceiveMessage data: Data, from peerId: String) {
        onMessageReceived?(peerId, data)
    }
}
