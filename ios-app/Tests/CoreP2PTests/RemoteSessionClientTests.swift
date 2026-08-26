import XCTest
import Foundation
@testable import CoreP2P

/// Covers the iOS Remote Session relay client's connect + register + E2EE pairing
/// handshake (transport injected). A host-side `RemoteSessionCrypto` decrypts what
/// the client sends, proving the wire is byte-compatible with the desktop host and
/// the Android `RemoteSessionClientPushTest`: register → pair.join (with optional
/// push creds) → pair.accepted → CONNECTED → encrypted control/events.
final class RemoteSessionClientTests: XCTestCase {

    /// Fake WebSocket: records everything the client sends and lets tests drive the
    /// listener callbacks synchronously (single-threaded, so the client's
    /// non-thread-safe state is exercised the same way the real transport does).
    private final class FakeWebSocket: RemoteSessionWebSocket {
        weak var listener: RemoteSessionWebSocketListener?
        private(set) var sent: [[String: Any]] = []
        private(set) var closeCode: Int?
        private(set) var closeReason: String?

        func send(_ text: String) {
            let data = Data(text.utf8)
            if let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] {
                sent.append(json)
            }
        }

        func close(code: Int, reason: String) {
            closeCode = code
            closeReason = reason
        }

        func message(ofType type: String) -> [String: Any]? {
            sent.first { $0["type"] as? String == type }
        }

        /// The encrypted `remote-session.pair` / control payload wrapper the client
        /// sends as `{type:"message", to, payload:{...}}`.
        func payload(ofType payloadType: String) -> [String: Any]? {
            for message in sent {
                if message["type"] as? String == "message",
                   let payload = message["payload"] as? [String: Any],
                   payload["type"] as? String == payloadType {
                    return payload
                }
            }
            return nil
        }
    }

    // MARK: Fixtures

    private let remoteSessionId = "session-1"
    private let hostPeerId = "host-peer"
    private let pairingToken = "token-abc"

    private func pairingURI(hostPublicKey: String) -> String {
        let payload: [String: Any] = [
            "v": 1,
            "relayUrl": "wss://relay.example.test",
            "remoteSessionId": remoteSessionId,
            "hostPeerId": hostPeerId,
            "hostPublicKey": hostPublicKey,
            "pairingToken": pairingToken,
        ]
        let data = try! JSONSerialization.data(withJSONObject: payload)
        return "chainlesschain://remote-session/pair#" + RemoteSessionBase64.encode(data)
    }

    /// Wires a client to a fake socket + a host crypto whose public key is the one
    /// baked into the pairing URI, so the host can complete ECDH the same way the
    /// desktop peer does.
    private func makeHarness() -> (client: RemoteSessionClient, socket: FakeWebSocket, host: RemoteSessionCrypto) {
        let host = RemoteSessionCrypto(sessionId: remoteSessionId, localPeerId: hostPeerId)
        let socket = FakeWebSocket()
        let client = RemoteSessionClient(
            webSocketFactory: { _, listener in
                socket.listener = listener
                return socket
            },
            peerIdFactory: { "ios-test" }
        )
        return (client, socket, host)
    }

    /// Completes ECDH on the host side using the mobile public key from the
    /// client's pair request, then returns the decrypted pair.join JSON.
    private func decryptPairJoin(
        _ socket: FakeWebSocket,
        host: RemoteSessionCrypto
    ) throws -> [String: Any] {
        let pair = try XCTUnwrap(socket.payload(ofType: "remote-session.pair"))
        let mobilePublicKey = try XCTUnwrap(pair["mobilePublicKey"] as? String)
        try host.pair(hostPublicKey: mobilePublicKey, pairingToken: pairingToken)
        let envelopeJSON = try XCTUnwrap(pair["envelope"] as? [String: Any])
        let envelope = try RemoteEncryptedEnvelope.fromJSONObject(envelopeJSON)
        let plaintext = try host.decrypt(envelope)
        return try XCTUnwrap((try JSONSerialization.jsonObject(with: plaintext)) as? [String: Any])
    }

    /// Encrypts a host→client control event and delivers it as a wrapped
    /// `remote-session.encrypted` relay message.
    private func deliverEncrypted(
        _ event: [String: Any],
        from host: RemoteSessionCrypto,
        to socket: FakeWebSocket
    ) throws {
        let plaintext = try JSONSerialization.data(withJSONObject: event)
        let envelope = try host.encrypt(plaintext)
        let message: [String: Any] = [
            "type": "message",
            "payload": [
                "type": "remote-session.encrypted",
                "envelope": envelope.toJSONObject(),
            ],
        ]
        let text = String(data: try JSONSerialization.data(withJSONObject: message), encoding: .utf8)!
        socket.listener?.webSocket(socket, didReceiveText: text)
    }

    // MARK: Connect + register

    func testConnectSetsConnectingAndRegistersOnOpen() throws {
        let (client, socket, _) = makeHarness()
        var statuses: [RemoteSessionStatus] = []
        client.onStatusChange = { statuses.append($0) }

        try client.connect(pairingURI(hostPublicKey: RemoteSessionCrypto(sessionId: remoteSessionId, localPeerId: hostPeerId).publicKeyBase64()))
        XCTAssertEqual(client.status, .connecting)
        XCTAssertTrue(statuses.contains(.connecting))

        socket.listener?.webSocketDidOpen(socket)
        let register = try XCTUnwrap(socket.message(ofType: "register"))
        XCTAssertEqual(register["peerId"] as? String, "ios-test")
        XCTAssertEqual(register["deviceType"] as? String, "mobile")
        let deviceInfo = try XCTUnwrap(register["deviceInfo"] as? [String: Any])
        XCTAssertEqual(deviceInfo["protocol"] as? String, "remote-session.e2ee.v1")
    }

    // MARK: Pairing handshake

    func testRegisteredTriggersPairRequestWithDecryptableJoin() throws {
        let (client, socket, host) = makeHarness()
        try client.connect(pairingURI(hostPublicKey: host.publicKeyBase64()))
        socket.listener?.webSocketDidOpen(socket)

        socket.listener?.webSocket(socket, didReceiveText: #"{"type":"registered"}"#)
        XCTAssertEqual(client.status, .pairing)

        let pair = try XCTUnwrap(socket.payload(ofType: "remote-session.pair"))
        XCTAssertEqual(pair["mobilePeerId"] as? String, "ios-test")
        // Host decrypts the join envelope with the mobile public key from the request.
        let join = try decryptPairJoin(socket, host: host)
        XCTAssertEqual(join["type"] as? String, "pair.join")
        XCTAssertEqual(join["remoteSessionId"] as? String, remoteSessionId)
        XCTAssertEqual(join["token"] as? String, pairingToken)
        XCTAssertEqual(
            join["capabilities"] as? [String],
            ["approval-binding-v1", "approval-decision-v1"]
        )
        XCTAssertNil(join["pushToken"])
    }

    func testPairJoinCarriesPushCredentialsWhenSet() throws {
        let (client, socket, host) = makeHarness()
        client.setPushCredentials(token: "apns-device-token", provider: "apns")
        try client.connect(pairingURI(hostPublicKey: host.publicKeyBase64()))
        socket.listener?.webSocketDidOpen(socket)
        socket.listener?.webSocket(socket, didReceiveText: #"{"type":"registered"}"#)

        let join = try decryptPairJoin(socket, host: host)
        XCTAssertEqual(join["pushToken"] as? String, "apns-device-token")
        XCTAssertEqual(join["pushProvider"] as? String, "apns")
    }

    func testPairAcceptedMovesToConnected() throws {
        let (client, socket, host) = makeHarness()
        try client.connect(pairingURI(hostPublicKey: host.publicKeyBase64()))
        socket.listener?.webSocketDidOpen(socket)
        socket.listener?.webSocket(socket, didReceiveText: #"{"type":"registered"}"#)
        _ = try decryptPairJoin(socket, host: host) // completes host-side ECDH

        try deliverEncrypted(["type": "pair.accepted"], from: host, to: socket)
        XCTAssertEqual(client.status, .connected)
    }

    // MARK: Control messages

    func testSendPromptIsRejectedBeforePairingAndEncryptedAfter() throws {
        let (client, socket, host) = makeHarness()
        try client.connect(pairingURI(hostPublicKey: host.publicKeyBase64()))
        socket.listener?.webSocketDidOpen(socket)
        socket.listener?.webSocket(socket, didReceiveText: #"{"type":"registered"}"#)
        _ = try decryptPairJoin(socket, host: host)

        XCTAssertFalse(client.sendPrompt("too early")) // not yet paired

        try deliverEncrypted(["type": "pair.accepted"], from: host, to: socket)
        XCTAssertTrue(client.sendPrompt("hello host"))

        // Host decrypts the control envelope → {type:prompt, content}.
        let control = try XCTUnwrap(socket.payload(ofType: "remote-session.encrypted"))
        let envelope = try RemoteEncryptedEnvelope.fromJSONObject(try XCTUnwrap(control["envelope"] as? [String: Any]))
        let plaintext = try host.decrypt(envelope)
        let event = try XCTUnwrap((try JSONSerialization.jsonObject(with: plaintext)) as? [String: Any])
        XCTAssertEqual(event["type"] as? String, "prompt")
        XCTAssertEqual(event["content"] as? String, "hello host")
    }

    func testResolveApprovalEchoesCompleteDurableBindingAndRejectsPartialTuple() throws {
        let (client, socket, host) = makeHarness()
        try client.connect(pairingURI(hostPublicKey: host.publicKeyBase64()))
        socket.listener?.webSocketDidOpen(socket)
        socket.listener?.webSocket(socket, didReceiveText: #"{"type":"registered"}"#)
        _ = try decryptPairJoin(socket, host: host)
        try deliverEncrypted(["type": "pair.accepted"], from: host, to: socket)

        XCTAssertFalse(client.resolveApproval(
            requestId: "partial",
            decision: .acceptOnce,
            fingerprint: "sha256:partial"
        ))
        XCTAssertTrue(client.resolveApproval(
            requestId: "approval-1",
            decision: .acceptOnce,
            fingerprint: "sha256:approval-1",
            binding: "binding-1",
            revision: 4
        ))

        let control = try XCTUnwrap(socket.payload(ofType: "remote-session.encrypted"))
        let envelope = try RemoteEncryptedEnvelope.fromJSONObject(
            try XCTUnwrap(control["envelope"] as? [String: Any])
        )
        let event = try XCTUnwrap(
            (try JSONSerialization.jsonObject(with: try host.decrypt(envelope))) as? [String: Any]
        )
        XCTAssertEqual(event["type"] as? String, "approval.resolve")
        XCTAssertEqual(event["requestId"] as? String, "approval-1")
        XCTAssertEqual((event["decision"] as? [String: Any])?["kind"] as? String, "acceptOnce")
        XCTAssertEqual(event["approved"] as? Bool, true)
        XCTAssertEqual(event["fingerprint"] as? String, "sha256:approval-1")
        XCTAssertEqual(event["binding"] as? String, "binding-1")
        XCTAssertEqual(event["revision"] as? Int, 4)
    }

    func testResolveApprovalRejectsUnreviewedGrantAndEncodesCanonicalDecline() throws {
        let (client, socket, host) = makeHarness()
        try client.connect(pairingURI(hostPublicKey: host.publicKeyBase64()))
        socket.listener?.webSocketDidOpen(socket)
        socket.listener?.webSocket(socket, didReceiveText: #"{"type":"registered"}"#)
        _ = try decryptPairJoin(socket, host: host)
        try deliverEncrypted(["type": "pair.accepted"], from: host, to: socket)

        XCTAssertFalse(client.resolveApproval(
            requestId: "grant",
            decision: .acceptForSession(permissions: nil)
        ))
        XCTAssertTrue(client.resolveApproval(
            requestId: "decline",
            decision: .decline(reason: "user denied")
        ))

        let control = try XCTUnwrap(socket.payload(ofType: "remote-session.encrypted"))
        let envelope = try RemoteEncryptedEnvelope.fromJSONObject(
            try XCTUnwrap(control["envelope"] as? [String: Any])
        )
        let event = try XCTUnwrap(
            (try JSONSerialization.jsonObject(with: try host.decrypt(envelope))) as? [String: Any]
        )
        let decision = try XCTUnwrap(event["decision"] as? [String: Any])
        XCTAssertEqual(event["requestId"] as? String, "decline")
        XCTAssertEqual(decision["kind"] as? String, "decline")
        XCTAssertEqual(decision["reason"] as? String, "user denied")
        XCTAssertEqual(event["approved"] as? Bool, false)
    }

    // MARK: Inbound events

    func testInboundEventIsDecryptedAndEmitted() throws {
        let (client, socket, host) = makeHarness()
        var events: [RemoteSessionEvent] = []
        client.onEvent = { events.append($0) }

        try client.connect(pairingURI(hostPublicKey: host.publicKeyBase64()))
        socket.listener?.webSocketDidOpen(socket)
        socket.listener?.webSocket(socket, didReceiveText: #"{"type":"registered"}"#)
        _ = try decryptPairJoin(socket, host: host)
        try deliverEncrypted(["type": "pair.accepted"], from: host, to: socket)

        try deliverEncrypted(["type": "assistant.delta", "text": "hi"], from: host, to: socket)
        XCTAssertEqual(events.count, 1)
        XCTAssertEqual(events.first?.type, "assistant.delta")
        XCTAssertTrue(events.first?.json.contains("\"text\"") ?? false)
    }

    func testSessionRevokedClosesAndReportsRevoked() throws {
        let (client, socket, host) = makeHarness()
        try client.connect(pairingURI(hostPublicKey: host.publicKeyBase64()))
        socket.listener?.webSocketDidOpen(socket)
        socket.listener?.webSocket(socket, didReceiveText: #"{"type":"registered"}"#)
        _ = try decryptPairJoin(socket, host: host)
        try deliverEncrypted(["type": "pair.accepted"], from: host, to: socket)

        try deliverEncrypted(["type": "session.revoked"], from: host, to: socket)
        XCTAssertEqual(client.status, .revoked)
        XCTAssertEqual(socket.closeCode, 1000)
    }

    func testUpdatePushCredentialsSendsPushRegisterAfterPairing() throws {
        let (client, socket, host) = makeHarness()
        try client.connect(pairingURI(hostPublicKey: host.publicKeyBase64()))
        socket.listener?.webSocketDidOpen(socket)
        socket.listener?.webSocket(socket, didReceiveText: #"{"type":"registered"}"#)
        _ = try decryptPairJoin(socket, host: host)
        try deliverEncrypted(["type": "pair.accepted"], from: host, to: socket)

        XCTAssertTrue(client.updatePushCredentials(token: "new-apns", provider: "apns"))
        let control = try XCTUnwrap(socket.payload(ofType: "remote-session.encrypted"))
        let envelope = try RemoteEncryptedEnvelope.fromJSONObject(try XCTUnwrap(control["envelope"] as? [String: Any]))
        let event = try XCTUnwrap((try JSONSerialization.jsonObject(with: try host.decrypt(envelope))) as? [String: Any])
        XCTAssertEqual(event["type"] as? String, "push.register")
        XCTAssertEqual(event["pushToken"] as? String, "new-apns")
    }

    // MARK: Offline unwrap + disconnect

    func testOfflineMessageUnwrapsOriginalRegistered() throws {
        let (client, socket, host) = makeHarness()
        try client.connect(pairingURI(hostPublicKey: host.publicKeyBase64()))
        socket.listener?.webSocketDidOpen(socket)

        // Relay may buffer & replay the `registered` inside an offline-message.
        socket.listener?.webSocket(socket, didReceiveText: #"{"type":"offline-message","originalMessage":{"type":"registered"}}"#)
        XCTAssertEqual(client.status, .pairing)
        XCTAssertNotNil(socket.payload(ofType: "remote-session.pair"))
    }

    func testDisconnectClosesSocketAndReportsDisconnected() throws {
        let (client, socket, host) = makeHarness()
        try client.connect(pairingURI(hostPublicKey: host.publicKeyBase64()))
        socket.listener?.webSocketDidOpen(socket)

        client.disconnect()
        XCTAssertEqual(client.status, .disconnected)
        XCTAssertEqual(socket.closeCode, 1000)
    }

    func testTransientDropReconnectsExactPairedIdentityAndCancelsStaleRetry() throws {
        let host = RemoteSessionCrypto(sessionId: remoteSessionId, localPeerId: hostPeerId)
        var sockets: [FakeWebSocket] = []
        var scheduled: [(TimeInterval, () -> Void)] = []
        let client = RemoteSessionClient(
            webSocketFactory: { _, listener in
                let socket = FakeWebSocket()
                socket.listener = listener
                sockets.append(socket)
                return socket
            },
            peerIdFactory: { "ios-stable-peer" },
            reconnectPolicy: .init(
                maximumAttempts: 3,
                initialDelaySeconds: 2,
                maximumDelaySeconds: 8
            ),
            reconnectScheduler: { delay, action in scheduled.append((delay, action)) }
        )

        try client.connect(pairingURI(hostPublicKey: host.publicKeyBase64()))
        let first = try XCTUnwrap(sockets.first)
        first.listener?.webSocketDidOpen(first)
        first.listener?.webSocket(first, didReceiveText: #"{"type":"registered"}"#)
        _ = try decryptPairJoin(first, host: host)
        try deliverEncrypted(["type": "pair.accepted"], from: host, to: first)

        first.listener?.webSocket(first, didCloseWithCode: 1006, reason: "transient")
        XCTAssertEqual(client.status, .reconnecting)
        XCTAssertEqual(scheduled.count, 1)
        XCTAssertEqual(scheduled[0].0, 2)
        scheduled[0].1()

        let second = try XCTUnwrap(sockets.last)
        XCTAssertFalse(second === first)
        second.listener?.webSocketDidOpen(second)
        let register = try XCTUnwrap(second.message(ofType: "register"))
        XCTAssertEqual(register["peerId"] as? String, "ios-stable-peer")
        second.listener?.webSocket(second, didReceiveText: #"{"type":"registered"}"#)
        XCTAssertEqual(client.status, .connected)
        XCTAssertNil(second.payload(ofType: "remote-session.pair"))

        second.listener?.webSocket(second, didFailWithError: URLError(.networkConnectionLost))
        XCTAssertEqual(client.status, .reconnecting)
        XCTAssertEqual(scheduled.count, 2)
        client.disconnect()
        scheduled[1].1()
        XCTAssertEqual(sockets.count, 2, "explicit disconnect must invalidate a queued retry")
        XCTAssertEqual(client.status, .disconnected)
    }

    func testReconnectExhaustionRequiresExplicitResumeAndRevocationCannotResume() throws {
        let host = RemoteSessionCrypto(sessionId: remoteSessionId, localPeerId: hostPeerId)
        var sockets: [FakeWebSocket] = []
        var scheduled: [() -> Void] = []
        let client = RemoteSessionClient(
            webSocketFactory: { _, listener in
                let socket = FakeWebSocket()
                socket.listener = listener
                sockets.append(socket)
                return socket
            },
            reconnectPolicy: .init(
                maximumAttempts: 1,
                initialDelaySeconds: 0,
                maximumDelaySeconds: 0
            ),
            reconnectScheduler: { _, action in scheduled.append(action) }
        )

        try client.connect(pairingURI(hostPublicKey: host.publicKeyBase64()))
        let first = try XCTUnwrap(sockets.first)
        first.listener?.webSocket(first, didFailWithError: URLError(.timedOut))
        XCTAssertEqual(client.status, .reconnecting)
        scheduled.removeFirst()()
        let second = try XCTUnwrap(sockets.last)
        second.listener?.webSocket(second, didFailWithError: URLError(.timedOut))
        XCTAssertEqual(client.status, .error)

        XCTAssertTrue(client.resumeAfterTransientFailure())
        XCTAssertEqual(client.status, .reconnecting)
        scheduled.removeFirst()()
        let third = try XCTUnwrap(sockets.last)
        third.listener?.webSocketDidOpen(third)
        third.listener?.webSocket(third, didReceiveText: #"{"type":"registered"}"#)
        _ = try decryptPairJoin(third, host: host)
        try deliverEncrypted(["type": "pair.accepted"], from: host, to: third)
        try deliverEncrypted(["type": "session.revoked"], from: host, to: third)
        XCTAssertEqual(client.status, .revoked)
        XCTAssertFalse(client.resumeAfterTransientFailure())
    }
}
