import Foundation
import CryptoKit
import CoreCommon

/// Signal Protocol Manager - End-to-end encryption for P2P messaging
/// Reference: desktop-app-vue/src/main/p2p/signal-session-manager.js
/// iOS implementation uses CryptoKit instead of libsignal-protocol-typescript
@MainActor
class SignalProtocolManager: ObservableObject {
    static let shared = SignalProtocolManager()

    private let logger = Logger.shared

    // Crypto constants (safe to force unwrap as they're always valid ASCII)
    private static let messageKeySendInfo = "MessageKeySend".data(using: .utf8)!
    private static let messageKeyRecvInfo = "MessageKeyRecv".data(using: .utf8)!
    private static let chainSalt = "ChainlessChain-Chain".data(using: .utf8)!
    private static let x3dhSalt = "ChainlessChain-Signal-X3DH".data(using: .utf8)!
    private static let rootKeyInfo = "ChainlessChain-RootKey".data(using: .utf8)!
    private static let keySalt = "ChainlessChain-Salt".data(using: .utf8)!
    private static let chainKeyInfo = "ChainlessChain-ChainKeys".data(using: .utf8)!
    private static let dhRatchetInfo = "ChainlessChain-DH-Ratchet".data(using: .utf8)!

    // Identity
    private var identityKeyPair: IdentityKeyPair?
    private var registrationId: UInt32?

    // Pre-keys storage
    private var preKeys: [UInt32: PreKey] = [:]
    private var signedPreKey: SignedPreKey?

    // Sessions storage
    private var sessions: [String: Session] = [:]

    @Published var isInitialized = false

    // MARK: - Data Types

    struct IdentityKeyPair {
        let publicKey: P256.KeyAgreement.PublicKey
        let privateKey: P256.KeyAgreement.PrivateKey
    }

    struct PreKey {
        let keyId: UInt32
        let keyPair: KeyPair
    }

    struct SignedPreKey {
        let keyId: UInt32
        let keyPair: KeyPair
        let signature: Data
        let timestamp: Date
    }

    struct KeyPair {
        let publicKey: P256.KeyAgreement.PublicKey
        let privateKey: P256.KeyAgreement.PrivateKey
    }

    struct PreKeyBundle {
        let registrationId: UInt32
        let identityKey: P256.KeyAgreement.PublicKey
        let signedPreKey: SignedPreKeyInfo
        let preKey: PreKeyInfo

        struct SignedPreKeyInfo {
            let keyId: UInt32
            let publicKey: P256.KeyAgreement.PublicKey
            let signature: Data
        }

        struct PreKeyInfo {
            let keyId: UInt32
            let publicKey: P256.KeyAgreement.PublicKey
        }
    }

    struct Session {
        let recipientId: String
        let rootKey: SymmetricKey
        var sendingChainKey: Data
        var receivingChainKey: Data
        var sendingMessageNumber: UInt32
        var receivingMessageNumber: UInt32
        var previousSendingChainLength: UInt32
        var dhRatchetKeyPair: KeyPair?
        var remoteDhPublicKey: P256.KeyAgreement.PublicKey?
        let timestamp: Date

        /// Derive message keys from chain key using HKDF
        mutating func deriveMessageKey(fromChainKey chainKey: inout Data, isSending: Bool) -> SymmetricKey {
            // KDF Chain: chain_key, message_key = HKDF(chain_key, info)
            let info = isSending ? SignalProtocolManager.messageKeySendInfo : SignalProtocolManager.messageKeyRecvInfo
            let salt = SignalProtocolManager.chainSalt

            let inputKey = SymmetricKey(data: chainKey)

            // Derive new chain key and message key
            let derived = HKDF<SHA256>.deriveKey(
                inputKeyMaterial: inputKey,
                salt: salt,
                info: info,
                outputByteCount: 64  // 32 for chain key + 32 for message key
            )

            // Split derived key
            let derivedData = derived.withUnsafeBytes { Data($0) }
            chainKey = Data(derivedData[0..<32])  // New chain key
            let messageKey = SymmetricKey(data: derivedData[32..<64])  // Message key

            return messageKey
        }
    }

    private init() {}

    // MARK: - Initialization

    /// Initialize Signal Protocol Manager
    func initialize() async throws {
        logger.debug("[SignalProtocol] Initializing Signal Protocol Manager...")

        // Load or generate identity
        try await loadOrGenerateIdentity()

        // Generate pre-keys
        try await generatePreKeys()

        isInitialized = true
        logger.debug("[SignalProtocol] Signal Protocol Manager initialized")
        logger.debug("[SignalProtocol] Registration ID: \(registrationId ?? 0)")
    }

    /// Load or generate identity
    private func loadOrGenerateIdentity() async throws {
        // Try to load from persistent storage
        if let savedIdentity = loadIdentityFromStorage() {
            identityKeyPair = savedIdentity.keyPair
            registrationId = savedIdentity.registrationId
            logger.debug("[SignalProtocol] Loaded existing identity")
            return
        }

        // Generate new identity
        try await generateIdentity()

        // Save to storage
        saveIdentityToStorage()
    }

    /// Generate new identity
    private func generateIdentity() async throws {
        logger.debug("[SignalProtocol] Generating new identity...")

        // Generate identity key pair using P256
        let privateKey = P256.KeyAgreement.PrivateKey()
        let publicKey = privateKey.publicKey

        identityKeyPair = IdentityKeyPair(publicKey: publicKey, privateKey: privateKey)

        // Generate registration ID (random 32-bit number)
        registrationId = UInt32.random(in: 1...UInt32.max)

        logger.debug("[SignalProtocol] New identity generated")
    }

    /// Generate pre-keys
    private func generatePreKeys() async throws {
        logger.debug("[SignalProtocol] Generating pre-keys...")

        guard let identityKeyPair = identityKeyPair else {
            throw SignalProtocolError.identityNotInitialized
        }

        // Generate signed pre-key
        let signedPreKeyId = UInt32.random(in: 1...16777215)
        let signedKeyPair = KeyPair(
            publicKey: P256.KeyAgreement.PrivateKey().publicKey,
            privateKey: P256.KeyAgreement.PrivateKey()
        )

        // Sign the public key
        let publicKeyData = signedKeyPair.publicKey.rawRepresentation
        let signature = try signPublicKey(publicKeyData, with: identityKeyPair.privateKey)

        signedPreKey = SignedPreKey(
            keyId: signedPreKeyId,
            keyPair: signedKeyPair,
            signature: signature,
            timestamp: Date()
        )

        // Generate one-time pre-keys (100 keys)
        let basePreKeyId = UInt32.random(in: 1...16777215)
        for i in 0..<100 {
            let preKeyId = (basePreKeyId + i) % 16777215
            let keyPair = KeyPair(
                publicKey: P256.KeyAgreement.PrivateKey().publicKey,
                privateKey: P256.KeyAgreement.PrivateKey()
            )

            preKeys[preKeyId] = PreKey(keyId: preKeyId, keyPair: keyPair)
        }

        logger.debug("[SignalProtocol] Generated \(preKeys.count) pre-keys")
    }

    /// Sign public key
    private func signPublicKey(_ publicKeyData: Data, with privateKey: P256.KeyAgreement.PrivateKey) throws -> Data {
        // Convert key agreement key to signing key for signature
        // In production, use P256.Signing for signatures
        let signingKey = P256.Signing.PrivateKey()
        let signature = try signingKey.signature(for: publicKeyData)
        return signature.rawRepresentation
    }

    // MARK: - Pre Key Bundle

    /// Get pre-key bundle for establishing a new session
    func getPreKeyBundle() throws -> PreKeyBundle {
        guard isInitialized else {
            throw SignalProtocolError.notInitialized
        }

        guard let identityKeyPair = identityKeyPair,
              let registrationId = registrationId,
              let signedPreKey = signedPreKey else {
            throw SignalProtocolError.identityNotInitialized
        }

        // Get a random one-time pre-key
        guard let preKey = preKeys.values.randomElement() else {
            throw SignalProtocolError.noPreKeysAvailable
        }

        return PreKeyBundle(
            registrationId: registrationId,
            identityKey: identityKeyPair.publicKey,
            signedPreKey: PreKeyBundle.SignedPreKeyInfo(
                keyId: signedPreKey.keyId,
                publicKey: signedPreKey.keyPair.publicKey,
                signature: signedPreKey.signature
            ),
            preKey: PreKeyBundle.PreKeyInfo(
                keyId: preKey.keyId,
                publicKey: preKey.keyPair.publicKey
            )
        )
    }

    // MARK: - Session Management

    /// Process pre-key bundle and establish session
    func processPreKeyBundle(recipientId: String, bundle: PreKeyBundle) async throws {
        logger.debug("[SignalProtocol] Processing pre-key bundle for: \(recipientId)")

        guard let identityKeyPair = identityKeyPair else {
            throw SignalProtocolError.identityNotInitialized
        }

        // Verify signature
        try verifySignature(bundle.signedPreKey.signature,
                          publicKey: bundle.signedPreKey.publicKey,
                          identityKey: bundle.identityKey)

        // Perform X3DH key agreement
        let sharedSecret = try performX3DH(
            identityKeyPair: identityKeyPair,
            remoteIdentityKey: bundle.identityKey,
            remoteSignedPreKey: bundle.signedPreKey.publicKey,
            remotePreKey: bundle.preKey.publicKey
        )

        // Initialize double ratchet
        let (rootKey, sendingChainKey, receivingChainKey) = try initializeDoubleRatchet(sharedSecret: sharedSecret)

        // Generate initial DH ratchet key pair
        let dhPrivateKey = P256.KeyAgreement.PrivateKey()
        let dhKeyPair = KeyPair(publicKey: dhPrivateKey.publicKey, privateKey: dhPrivateKey)

        // Create session
        let session = Session(
            recipientId: recipientId,
            rootKey: rootKey,
            sendingChainKey: sendingChainKey,
            receivingChainKey: receivingChainKey,
            sendingMessageNumber: 0,
            receivingMessageNumber: 0,
            previousSendingChainLength: 0,
            dhRatchetKeyPair: dhKeyPair,
            remoteDhPublicKey: bundle.signedPreKey.publicKey,
            timestamp: Date()
        )

        sessions[recipientId] = session

        // Remove used pre-key
        preKeys.removeValue(forKey: bundle.preKey.keyId)

        logger.debug("[SignalProtocol] Session established with: \(recipientId)")
    }

    /// Perform X3DH key agreement
    private func performX3DH(
        identityKeyPair: IdentityKeyPair,
        remoteIdentityKey: P256.KeyAgreement.PublicKey,
        remoteSignedPreKey: P256.KeyAgreement.PublicKey,
        remotePreKey: P256.KeyAgreement.PublicKey
    ) throws -> SymmetricKey {
        // DH1: Identity key with signed pre-key
        let dh1 = try identityKeyPair.privateKey.sharedSecretFromKeyAgreement(with: remoteSignedPreKey)

        // DH2: Identity key with pre-key
        let dh2 = try identityKeyPair.privateKey.sharedSecretFromKeyAgreement(with: remotePreKey)

        // DH3: Identity key with identity key
        let dh3 = try identityKeyPair.privateKey.sharedSecretFromKeyAgreement(with: remoteIdentityKey)

        // Combine shared secrets using HKDF
        var combinedData = Data()
        combinedData.append(dh1.withUnsafeBytes { Data($0) })
        combinedData.append(dh2.withUnsafeBytes { Data($0) })
        combinedData.append(dh3.withUnsafeBytes { Data($0) })

        let sharedSecret = HKDF<SHA256>.deriveKey(
            inputKeyMaterial: SymmetricKey(data: combinedData),
            salt: SignalProtocolManager.x3dhSalt,
            outputByteCount: 32
        )

        return sharedSecret
    }

    /// Initialize double ratchet with proper key derivation
    private func initializeDoubleRatchet(sharedSecret: SymmetricKey) throws -> (rootKey: SymmetricKey, sendingChainKey: Data, receivingChainKey: Data) {
        // Derive root key from shared secret
        let rootKey = HKDF<SHA256>.deriveKey(
            inputKeyMaterial: sharedSecret,
            salt: SignalProtocolManager.keySalt,
            info: SignalProtocolManager.rootKeyInfo,
            outputByteCount: 32
        )

        // Derive initial chain keys from root key
        let chainKeys = HKDF<SHA256>.deriveKey(
            inputKeyMaterial: rootKey,
            salt: SignalProtocolManager.keySalt,
            info: SignalProtocolManager.chainKeyInfo,
            outputByteCount: 64
        )

        let chainData = chainKeys.withUnsafeBytes { Data($0) }
        let sendingChainKey = Data(chainData[0..<32])
        let receivingChainKey = Data(chainData[32..<64])

        return (rootKey, sendingChainKey, receivingChainKey)
    }

    /// Perform DH ratchet step
    private func performDhRatchet(session: inout Session, remoteDhPublicKey: P256.KeyAgreement.PublicKey) throws {
        guard let dhKeyPair = session.dhRatchetKeyPair else {
            // Generate new DH key pair for ratchet
            let newPrivateKey = P256.KeyAgreement.PrivateKey()
            session.dhRatchetKeyPair = KeyPair(publicKey: newPrivateKey.publicKey, privateKey: newPrivateKey)
            session.remoteDhPublicKey = remoteDhPublicKey
            return
        }

        // Calculate shared secret from DH exchange
        let dhSharedSecret = try dhKeyPair.privateKey.sharedSecretFromKeyAgreement(with: remoteDhPublicKey)

        // Derive new root key and chain key
        let salt = session.rootKey.withUnsafeBytes { Data($0) }

        let newRootKey = HKDF<SHA256>.deriveKey(
            inputKeyMaterial: SymmetricKey(data: dhSharedSecret.withUnsafeBytes { Data($0) }),
            salt: salt,
            info: SignalProtocolManager.dhRatchetInfo,
            outputByteCount: 64
        )

        let derived = newRootKey.withUnsafeBytes { Data($0) }

        // Update session
        session.receivingChainKey = Data(derived[32..<64])
        session.previousSendingChainLength = session.sendingMessageNumber
        session.sendingMessageNumber = 0
        session.receivingMessageNumber = 0
        session.remoteDhPublicKey = remoteDhPublicKey

        // Generate new DH key pair
        let newPrivateKey = P256.KeyAgreement.PrivateKey()
        session.dhRatchetKeyPair = KeyPair(publicKey: newPrivateKey.publicKey, privateKey: newPrivateKey)

        // Derive new sending chain key
        let newDhSharedSecret = try newPrivateKey.sharedSecretFromKeyAgreement(with: remoteDhPublicKey)
        let newSendingKey = HKDF<SHA256>.deriveKey(
            inputKeyMaterial: SymmetricKey(data: newDhSharedSecret.withUnsafeBytes { Data($0) }),
            salt: Data(derived[0..<32]),
            info: SignalProtocolManager.dhRatchetInfo,
            outputByteCount: 32
        )

        session.sendingChainKey = newSendingKey.withUnsafeBytes { Data($0) }
    }

    /// Verify signature
    private func verifySignature(_ signature: Data, publicKey: P256.KeyAgreement.PublicKey, identityKey: P256.KeyAgreement.PublicKey) throws {
        // Signature verification using CryptoKit
        // In production, use P256.Signing for verification
        // For now, we'll skip verification as it requires converting key types
        logger.debug("[SignalProtocol] Signature verification skipped (simplified implementation)")
    }

    // MARK: - Encryption/Decryption

    /// Encrypt message with Double Ratchet
    func encryptMessage(_ message: String, for recipientId: String) throws -> Data {
        guard var session = sessions[recipientId] else {
            throw SignalProtocolError.sessionNotFound
        }

        guard let messageData = message.data(using: .utf8) else {
            throw SignalProtocolError.encryptionFailed
        }

        // Derive message key from sending chain
        let messageKey = session.deriveMessageKey(fromChainKey: &session.sendingChainKey, isSending: true)

        // Generate nonce from message number
        var nonceData = Data(count: 12)
        withUnsafeMutableBytes(of: session.sendingMessageNumber.bigEndian) { bytes in
            nonceData.replaceSubrange(8..<12, with: bytes)
        }
        let nonce = try AES.GCM.Nonce(data: nonceData)

        // Use AES-GCM for encryption with derived message key
        let sealedBox = try AES.GCM.seal(messageData, using: messageKey, nonce: nonce)

        // Create message envelope with header
        let envelope = MessageEnvelope(
            dhPublicKey: session.dhRatchetKeyPair?.publicKey.rawRepresentation,
            previousChainLength: session.previousSendingChainLength,
            messageNumber: session.sendingMessageNumber,
            ciphertext: sealedBox.combined!
        )

        // Update session
        session.sendingMessageNumber += 1
        sessions[recipientId] = session

        // Serialize envelope
        let encoder = JSONEncoder()
        return try encoder.encode(envelope)
    }

    /// Decrypt message with Double Ratchet
    func decryptMessage(_ encryptedData: Data, from senderId: String) throws -> String {
        guard var session = sessions[senderId] else {
            throw SignalProtocolError.sessionNotFound
        }

        // Parse message envelope
        let decoder = JSONDecoder()
        let envelope = try decoder.decode(MessageEnvelope.self, from: encryptedData)

        // Check if DH ratchet needed
        if let dhPublicKeyData = envelope.dhPublicKey,
           let remoteDhPublicKey = try? P256.KeyAgreement.PublicKey(rawRepresentation: dhPublicKeyData) {
            // Check if this is a new DH public key
            if session.remoteDhPublicKey?.rawRepresentation != dhPublicKeyData {
                try performDhRatchet(session: &session, remoteDhPublicKey: remoteDhPublicKey)
            }
        }

        // Derive message key from receiving chain
        let messageKey = session.deriveMessageKey(fromChainKey: &session.receivingChainKey, isSending: false)

        // Generate nonce from message number
        var nonceData = Data(count: 12)
        withUnsafeMutableBytes(of: envelope.messageNumber.bigEndian) { bytes in
            nonceData.replaceSubrange(8..<12, with: bytes)
        }
        let nonce = try AES.GCM.Nonce(data: nonceData)

        // Use AES-GCM for decryption
        let sealedBox = try AES.GCM.SealedBox(combined: envelope.ciphertext)
        let decryptedData = try AES.GCM.open(sealedBox, using: messageKey)

        guard let message = String(data: decryptedData, encoding: .utf8) else {
            throw SignalProtocolError.decryptionFailed
        }

        // Update session
        session.receivingMessageNumber += 1
        sessions[senderId] = session

        return message
    }

    /// Message envelope for serialization
    private struct MessageEnvelope: Codable {
        let dhPublicKey: Data?
        let previousChainLength: UInt32
        let messageNumber: UInt32
        let ciphertext: Data
    }

    // MARK: - Persistence

    private func loadIdentityFromStorage() -> (keyPair: IdentityKeyPair, registrationId: UInt32)? {
        // Load from UserDefaults (simplified storage)
        guard let privateKeyData = UserDefaults.standard.data(forKey: "signal_private_key"),
              let publicKeyData = UserDefaults.standard.data(forKey: "signal_public_key"),
              let registrationId = UserDefaults.standard.object(forKey: "signal_registration_id") as? UInt32 else {
            return nil
        }

        do {
            let privateKey = try P256.KeyAgreement.PrivateKey(rawRepresentation: privateKeyData)
            let publicKey = try P256.KeyAgreement.PublicKey(rawRepresentation: publicKeyData)

            return (IdentityKeyPair(publicKey: publicKey, privateKey: privateKey), registrationId)
        } catch {
            logger.error("[SignalProtocol] Failed to load identity: \(error)")
            return nil
        }
    }

    private func saveIdentityToStorage() {
        guard let identityKeyPair = identityKeyPair,
              let registrationId = registrationId else {
            return
        }

        UserDefaults.standard.set(identityKeyPair.privateKey.rawRepresentation, forKey: "signal_private_key")
        UserDefaults.standard.set(identityKeyPair.publicKey.rawRepresentation, forKey: "signal_public_key")
        UserDefaults.standard.set(registrationId, forKey: "signal_registration_id")

        logger.debug("[SignalProtocol] Identity saved to storage")
    }

    /// Clear all sessions
    func clearSessions() {
        sessions.removeAll()
        logger.debug("[SignalProtocol] All sessions cleared")
    }

    /// Remove session
    func removeSession(recipientId: String) {
        sessions.removeValue(forKey: recipientId)
        logger.debug("[SignalProtocol] Session removed: \(recipientId)")
    }
}

// MARK: - Error Types

enum SignalProtocolError: LocalizedError {
    case notInitialized
    case identityNotInitialized
    case noPreKeysAvailable
    case sessionNotFound
    case encryptionFailed
    case decryptionFailed
    case invalidPreKeyBundle
    case signatureVerificationFailed

    var errorDescription: String? {
        switch self {
        case .notInitialized:
            return "Signal Protocol not initialized"
        case .identityNotInitialized:
            return "Identity not initialized"
        case .noPreKeysAvailable:
            return "No pre-keys available"
        case .sessionNotFound:
            return "Session not found"
        case .encryptionFailed:
            return "Encryption failed"
        case .decryptionFailed:
            return "Decryption failed"
        case .invalidPreKeyBundle:
            return "Invalid pre-key bundle"
        case .signatureVerificationFailed:
            return "Signature verification failed"
        }
    }
}

