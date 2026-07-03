import XCTest
import Foundation
@testable import CoreP2P

/// Covers the iOS Remote Session E2EE layer — the pairing-URI parser + the
/// X25519/HKDF/AES-GCM envelope. The cross-instance round-trip proves two peers
/// derive the same key from ECDH + token; the wire format must stay byte-
/// compatible with the Android `RemoteSessionCryptoTest` + the desktop harness.
final class RemoteSessionCryptoTests: XCTestCase {

    // MARK: Pairing parser

    private func pairingURI(
        relayUrl: String = "wss://relay.example.test",
        version: Int = 1,
        expiresAt: Int64? = nil,
        omit: String? = nil
    ) -> String {
        var payload: [String: Any] = [
            "v": version,
            "relayUrl": relayUrl,
            "remoteSessionId": "session-1",
            "hostPeerId": "host-peer",
            "hostPublicKey": "aG9zdC1rZXk",
            "pairingToken": "token-abc",
        ]
        if let expiresAt { payload["expiresAt"] = expiresAt }
        if let omit { payload.removeValue(forKey: omit) }
        let data = try! JSONSerialization.data(withJSONObject: payload)
        return "chainlesschain://remote-session/pair#" + RemoteSessionBase64.encode(data)
    }

    func testParsesAValidPairingURI() throws {
        let pairing = try RemoteSessionPairingParser.parse(pairingURI())
        XCTAssertEqual(pairing.relayUrl, "wss://relay.example.test")
        XCTAssertEqual(pairing.remoteSessionId, "session-1")
        XCTAssertEqual(pairing.hostPeerId, "host-peer")
        XCTAssertEqual(pairing.pairingToken, "token-abc")
        XCTAssertNil(pairing.expiresAt)
    }

    func testRejectsAnInvalidPrefix() {
        XCTAssertThrowsError(try RemoteSessionPairingParser.parse("https://example.com/pair#abc")) {
            XCTAssertEqual($0 as? RemoteSessionCryptoError, .invalidPairingURI)
        }
    }

    func testRejectsAMalformedPayload() {
        let uri = "chainlesschain://remote-session/pair#not-base64-@@@"
        XCTAssertThrowsError(try RemoteSessionPairingParser.parse(uri)) {
            XCTAssertEqual($0 as? RemoteSessionCryptoError, .malformedPairingPayload)
        }
    }

    func testRejectsAnUnsupportedVersion() {
        XCTAssertThrowsError(try RemoteSessionPairingParser.parse(pairingURI(version: 2))) {
            XCTAssertEqual($0 as? RemoteSessionCryptoError, .unsupportedVersion)
        }
    }

    func testRejectsAnExpiredPayload() {
        let uri = pairingURI(expiresAt: 1_000)
        XCTAssertThrowsError(try RemoteSessionPairingParser.parse(uri, now: 2_000)) {
            XCTAssertEqual($0 as? RemoteSessionCryptoError, .pairingExpired)
        }
    }

    func testAcceptsANonExpiredPayload() throws {
        let pairing = try RemoteSessionPairingParser.parse(pairingURI(expiresAt: 5_000), now: 1_000)
        XCTAssertEqual(pairing.expiresAt, 5_000)
    }

    func testRejectsAMissingField() {
        XCTAssertThrowsError(try RemoteSessionPairingParser.parse(pairingURI(omit: "pairingToken"))) {
            XCTAssertEqual($0 as? RemoteSessionCryptoError, .missingField("pairingToken"))
        }
    }

    func testRejectsANonWebSocketRelay() {
        XCTAssertThrowsError(try RemoteSessionPairingParser.parse(pairingURI(relayUrl: "https://relay.test"))) {
            XCTAssertEqual($0 as? RemoteSessionCryptoError, .invalidRelayScheme)
        }
    }

    // MARK: Crypto round-trip

    func testTwoPeersDeriveTheSameKeyAndRoundTrip() throws {
        let host = RemoteSessionCrypto(sessionId: "s1", localPeerId: "host")
        let mobile = RemoteSessionCrypto(sessionId: "s1", localPeerId: "mobile")
        try mobile.pair(hostPublicKey: host.publicKeyBase64(), pairingToken: "tok")
        try host.pair(hostPublicKey: mobile.publicKeyBase64(), pairingToken: "tok")

        let plaintext = Data(#"{"type":"remote-session.prompt","content":"hi"}"#.utf8)
        let envelope = try mobile.encrypt(plaintext)
        XCTAssertEqual(envelope.senderId, "mobile")
        XCTAssertEqual(envelope.sequence, 1)
        XCTAssertEqual(try host.decrypt(envelope), plaintext)

        // Reverse direction works on the same derived key.
        let reply = Data(#"{"type":"remote-session.ack"}"#.utf8)
        XCTAssertEqual(try mobile.decrypt(host.encrypt(reply)), reply)
    }

    func testDecryptRejectsReplayOrOutOfOrder() throws {
        let host = RemoteSessionCrypto(sessionId: "s1", localPeerId: "host")
        let mobile = RemoteSessionCrypto(sessionId: "s1", localPeerId: "mobile")
        try mobile.pair(hostPublicKey: host.publicKeyBase64(), pairingToken: "tok")
        try host.pair(hostPublicKey: mobile.publicKeyBase64(), pairingToken: "tok")

        let envelope = try mobile.encrypt(Data("first".utf8))
        _ = try host.decrypt(envelope)
        XCTAssertThrowsError(try host.decrypt(envelope)) {
            XCTAssertEqual($0 as? RemoteSessionCryptoError, .replayOrOutOfOrder)
        }
    }

    func testEncryptBeforePairingThrowsNotPaired() {
        let crypto = RemoteSessionCrypto(sessionId: "s1", localPeerId: "mobile")
        XCTAssertThrowsError(try crypto.encrypt(Data("x".utf8))) {
            XCTAssertEqual($0 as? RemoteSessionCryptoError, .notPaired)
        }
    }

    func testWrongTokenDerivesADifferentKeyAndFailsToDecrypt() throws {
        let host = RemoteSessionCrypto(sessionId: "s1", localPeerId: "host")
        let mobile = RemoteSessionCrypto(sessionId: "s1", localPeerId: "mobile")
        try mobile.pair(hostPublicKey: host.publicKeyBase64(), pairingToken: "tok")
        try host.pair(hostPublicKey: mobile.publicKeyBase64(), pairingToken: "WRONG")

        let envelope = try mobile.encrypt(Data("secret".utf8))
        XCTAssertThrowsError(try host.decrypt(envelope)) {
            XCTAssertEqual($0 as? RemoteSessionCryptoError, .decryptionFailed)
        }
    }

    func testPublicKeyIs32BytesAndBase64RoundTrips() {
        let crypto = RemoteSessionCrypto(sessionId: "s1", localPeerId: "mobile")
        XCTAssertEqual(crypto.publicKey.count, 32)
        XCTAssertEqual(RemoteSessionBase64.decode(crypto.publicKeyBase64()), crypto.publicKey)
    }

    // MARK: Envelope JSON

    func testEnvelopeJSONRoundTrips() throws {
        let envelope = RemoteEncryptedEnvelope(
            sessionId: "s1",
            senderId: "mobile",
            sequence: 7,
            nonce: "bm9uY2U",
            ciphertext: "Y2lwaGVy",
            tag: "dGFn"
        )
        let restored = try RemoteEncryptedEnvelope.fromJSONData(envelope.toJSONData())
        XCTAssertEqual(restored, envelope)
    }
}
