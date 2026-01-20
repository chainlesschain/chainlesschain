import XCTest
@testable import CoreE2EE
@testable import CoreCommon
@testable import CoreSecurity
@testable import CoreDID

final class CoreE2EETests: XCTestCase {

    var sessionManager: E2EESessionManager!

    override func setUp() {
        super.setUp()
        sessionManager = E2EESessionManager.shared
    }

    // MARK: - Key Generation Tests

    func testGenerateIdentityKeyPair() throws {
        let keyPair = try sessionManager.generateIdentityKeyPair()

        XCTAssertNotNil(keyPair.publicKey)
        XCTAssertNotNil(keyPair.privateKey)
        XCTAssertTrue(keyPair.publicKey.count > 0)
        XCTAssertTrue(keyPair.privateKey.count > 0)
    }

    func testGeneratePreKeys() throws {
        let preKeys = try sessionManager.generatePreKeys(count: 10)

        XCTAssertEqual(preKeys.count, 10)
        for preKey in preKeys {
            XCTAssertNotNil(preKey.keyId)
            XCTAssertNotNil(preKey.publicKey)
        }
    }

    func testGenerateSignedPreKey() throws {
        let identityKeyPair = try sessionManager.generateIdentityKeyPair()
        let signedPreKey = try sessionManager.generateSignedPreKey(
            identityKeyPair: identityKeyPair
        )

        XCTAssertNotNil(signedPreKey.keyId)
        XCTAssertNotNil(signedPreKey.publicKey)
        XCTAssertNotNil(signedPreKey.signature)
        XCTAssertTrue(signedPreKey.signature.count > 0)
    }

    // MARK: - Pre-Key Bundle Tests

    func testCreatePreKeyBundle() throws {
        let bundle = try sessionManager.createPreKeyBundle()

        XCTAssertNotNil(bundle.registrationId)
        XCTAssertNotNil(bundle.identityKey)
        XCTAssertNotNil(bundle.signedPreKey)
        XCTAssertFalse(bundle.preKeys.isEmpty)
    }

    func testPreKeyBundleSerialization() throws {
        let bundle = try sessionManager.createPreKeyBundle()

        // Serialize
        let serialized = try bundle.serialize()
        XCTAssertNotNil(serialized)

        // Deserialize
        let deserialized = try PreKeyBundle.deserialize(from: serialized)
        XCTAssertEqual(deserialized.registrationId, bundle.registrationId)
    }

    // MARK: - Session Establishment Tests

    func testEstablishSession() async throws {
        // Create two parties
        let aliceBundle = try sessionManager.createPreKeyBundle()
        let bobBundle = try sessionManager.createPreKeyBundle()

        // Alice establishes session with Bob
        let session = try await sessionManager.establishSession(
            with: "bob123",
            preKeyBundle: bobBundle
        )

        XCTAssertNotNil(session)
        XCTAssertEqual(session.remotePeerId, "bob123")
    }

    func testSessionPersistence() async throws {
        let bundle = try sessionManager.createPreKeyBundle()

        // Establish session
        _ = try await sessionManager.establishSession(
            with: "peer123",
            preKeyBundle: bundle
        )

        // Verify session exists
        let hasSession = sessionManager.hasSession(with: "peer123")
        XCTAssertTrue(hasSession)
    }

    // MARK: - Encryption/Decryption Tests

    func testEncryptAndDecrypt() async throws {
        // Setup: Create session between Alice and Bob
        let aliceManager = E2EESessionManager.shared
        let bobBundle = try aliceManager.createPreKeyBundle()

        _ = try await aliceManager.establishSession(
            with: "bob",
            preKeyBundle: bobBundle
        )

        // Encrypt
        let plaintext = "Hello, Bob! This is a secret message."
        let ciphertext = try aliceManager.encrypt(
            message: plaintext,
            for: "bob"
        )

        XCTAssertNotNil(ciphertext)
        XCTAssertNotEqual(ciphertext.data, plaintext.data(using: .utf8))
    }

    func testEncryptedMessageStructure() async throws {
        let bundle = try sessionManager.createPreKeyBundle()
        _ = try await sessionManager.establishSession(with: "peer", preKeyBundle: bundle)

        let ciphertext = try sessionManager.encrypt(message: "Test", for: "peer")

        XCTAssertNotNil(ciphertext.messageType)
        XCTAssertNotNil(ciphertext.data)
        XCTAssertTrue(ciphertext.data.count > 0)
    }

    // MARK: - Double Ratchet Tests

    func testDoubleRatchetKeyEvolution() async throws {
        let bundle = try sessionManager.createPreKeyBundle()
        _ = try await sessionManager.establishSession(with: "peer", preKeyBundle: bundle)

        // Send multiple messages
        let ciphertext1 = try sessionManager.encrypt(message: "Message 1", for: "peer")
        let ciphertext2 = try sessionManager.encrypt(message: "Message 2", for: "peer")
        let ciphertext3 = try sessionManager.encrypt(message: "Message 3", for: "peer")

        // Each message should have different ciphertext due to ratcheting
        XCTAssertNotEqual(ciphertext1.data, ciphertext2.data)
        XCTAssertNotEqual(ciphertext2.data, ciphertext3.data)
        XCTAssertNotEqual(ciphertext1.data, ciphertext3.data)
    }

    func testMessageNumberIncrement() async throws {
        let bundle = try sessionManager.createPreKeyBundle()
        let session = try await sessionManager.establishSession(with: "peer", preKeyBundle: bundle)

        let initialMessageNumber = session.sendingMessageNumber

        _ = try sessionManager.encrypt(message: "Message 1", for: "peer")

        let updatedSession = sessionManager.getSession(with: "peer")
        XCTAssertEqual(updatedSession?.sendingMessageNumber, initialMessageNumber + 1)
    }

    // MARK: - Session Management Tests

    func testGetSession() async throws {
        let bundle = try sessionManager.createPreKeyBundle()
        _ = try await sessionManager.establishSession(with: "peer123", preKeyBundle: bundle)

        let session = sessionManager.getSession(with: "peer123")
        XCTAssertNotNil(session)
    }

    func testRemoveSession() async throws {
        let bundle = try sessionManager.createPreKeyBundle()
        _ = try await sessionManager.establishSession(with: "tempPeer", preKeyBundle: bundle)

        // Remove session
        sessionManager.removeSession(with: "tempPeer")

        let hasSession = sessionManager.hasSession(with: "tempPeer")
        XCTAssertFalse(hasSession)
    }

    func testListActiveSessions() async throws {
        let bundle1 = try sessionManager.createPreKeyBundle()
        let bundle2 = try sessionManager.createPreKeyBundle()

        _ = try await sessionManager.establishSession(with: "peer1", preKeyBundle: bundle1)
        _ = try await sessionManager.establishSession(with: "peer2", preKeyBundle: bundle2)

        let activeSessions = sessionManager.listActiveSessions()
        XCTAssertTrue(activeSessions.contains("peer1"))
        XCTAssertTrue(activeSessions.contains("peer2"))
    }

    // MARK: - Error Handling Tests

    func testEncryptWithoutSession() {
        XCTAssertThrowsError(
            try sessionManager.encrypt(message: "Test", for: "unknownPeer")
        ) { error in
            XCTAssertTrue(error is E2EEError)
        }
    }

    func testDecryptWithInvalidData() async throws {
        let bundle = try sessionManager.createPreKeyBundle()
        _ = try await sessionManager.establishSession(with: "peer", preKeyBundle: bundle)

        let invalidCiphertext = EncryptedMessage(
            messageType: .preKey,
            data: Data([0x00, 0x01, 0x02])
        )

        XCTAssertThrowsError(
            try sessionManager.decrypt(ciphertext: invalidCiphertext, from: "peer")
        )
    }
}

// MARK: - E2EE Error Tests

final class E2EEErrorTests: XCTestCase {

    func testE2EEErrorDescriptions() {
        let sessionError = E2EEError.sessionNotFound("peer")
        XCTAssertTrue(sessionError.localizedDescription.contains("Session"))

        let encryptionError = E2EEError.encryptionFailed("test")
        XCTAssertTrue(encryptionError.localizedDescription.contains("Encryption"))

        let decryptionError = E2EEError.decryptionFailed("test")
        XCTAssertTrue(decryptionError.localizedDescription.contains("Decryption"))
    }
}
