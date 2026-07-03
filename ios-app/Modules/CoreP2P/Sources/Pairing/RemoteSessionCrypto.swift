import Foundation
import CryptoKit

/// iOS port of the Android `RemoteSessionCrypto` — the E2EE layer for the Remote
/// Session relay client. Wire format is byte-compatible with the desktop host and
/// Android mobile: X25519 ECDH → HKDF-SHA256 → AES-256-GCM, base64url (no
/// padding) for all binary fields, and a `\n`-joined AAD. Any change here must
/// stay in lock-step with `RemoteSessionCrypto.kt` and the desktop harness.

public let remoteSessionProtocol = "chainlesschain.remote-session.e2ee.v1"
private let remoteSessionPairingPrefix = "chainlesschain://remote-session/pair#"

public enum RemoteSessionCryptoError: Error, Equatable {
    case invalidPairingURI
    case malformedPairingPayload
    case unsupportedVersion
    case pairingExpired
    case missingField(String)
    case invalidRelayScheme
    case invalidHostPublicKey
    case notPaired
    case invalidEnvelope
    case replayOrOutOfOrder
    case decryptionFailed
}

public struct RemoteSessionPairing: Equatable, Sendable {
    public let relayUrl: String
    public let remoteSessionId: String
    public let hostPeerId: String
    public let hostPublicKey: String
    public let pairingToken: String
    public let expiresAt: Int64?

    public init(
        relayUrl: String,
        remoteSessionId: String,
        hostPeerId: String,
        hostPublicKey: String,
        pairingToken: String,
        expiresAt: Int64?
    ) {
        self.relayUrl = relayUrl
        self.remoteSessionId = remoteSessionId
        self.hostPeerId = hostPeerId
        self.hostPublicKey = hostPublicKey
        self.pairingToken = pairingToken
        self.expiresAt = expiresAt
    }
}

public struct RemoteEncryptedEnvelope: Equatable, Sendable {
    public let version: Int
    public let sessionId: String
    public let senderId: String
    public let sequence: Int64
    public let nonce: String
    public let ciphertext: String
    public let tag: String

    public init(
        version: Int = 1,
        sessionId: String,
        senderId: String,
        sequence: Int64,
        nonce: String,
        ciphertext: String,
        tag: String
    ) {
        self.version = version
        self.sessionId = sessionId
        self.senderId = senderId
        self.sequence = sequence
        self.nonce = nonce
        self.ciphertext = ciphertext
        self.tag = tag
    }

    public func toJSONObject() -> [String: Any] {
        [
            "v": version,
            "sessionId": sessionId,
            "senderId": senderId,
            "sequence": sequence,
            "nonce": nonce,
            "ciphertext": ciphertext,
            "tag": tag,
        ]
    }

    public func toJSONData() throws -> Data {
        try JSONSerialization.data(withJSONObject: toJSONObject())
    }

    public static func fromJSONObject(_ json: [String: Any]) throws -> RemoteEncryptedEnvelope {
        func string(_ key: String) throws -> String {
            guard let value = json[key] as? String, !value.isEmpty else {
                throw RemoteSessionCryptoError.invalidEnvelope
            }
            return value
        }
        guard let version = (json["v"] as? NSNumber)?.intValue,
              let sequence = (json["sequence"] as? NSNumber)?.int64Value
        else {
            throw RemoteSessionCryptoError.invalidEnvelope
        }
        return RemoteEncryptedEnvelope(
            version: version,
            sessionId: try string("sessionId"),
            senderId: try string("senderId"),
            sequence: sequence,
            nonce: try string("nonce"),
            ciphertext: try string("ciphertext"),
            tag: try string("tag")
        )
    }

    public static func fromJSONData(_ data: Data) throws -> RemoteEncryptedEnvelope {
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw RemoteSessionCryptoError.invalidEnvelope
        }
        return try fromJSONObject(json)
    }
}

public enum RemoteSessionPairingParser {
    public static func parse(
        _ uri: String,
        now: Int64 = Int64(Date().timeIntervalSince1970 * 1000)
    ) throws -> RemoteSessionPairing {
        guard uri.hasPrefix(remoteSessionPairingPrefix) else {
            throw RemoteSessionCryptoError.invalidPairingURI
        }
        let fragment = String(uri.dropFirst(remoteSessionPairingPrefix.count))
        guard let bytes = RemoteSessionBase64.decode(fragment),
              let json = try? JSONSerialization.jsonObject(with: bytes) as? [String: Any]
        else {
            throw RemoteSessionCryptoError.malformedPairingPayload
        }
        guard (json["v"] as? NSNumber)?.intValue == 1 else {
            throw RemoteSessionCryptoError.unsupportedVersion
        }
        let expiresAt = (json["expiresAt"] as? NSNumber)?.int64Value
        let resolvedExpiry = (expiresAt ?? 0) > 0 ? expiresAt : nil
        if let resolvedExpiry, resolvedExpiry <= now {
            throw RemoteSessionCryptoError.pairingExpired
        }

        func required(_ key: String) throws -> String {
            guard let value = json[key] as? String,
                  !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            else {
                throw RemoteSessionCryptoError.missingField(key)
            }
            return value
        }

        let relayUrl = try required("relayUrl")
        let scheme = URLComponents(string: relayUrl)?.scheme
        guard scheme == "ws" || scheme == "wss" else {
            throw RemoteSessionCryptoError.invalidRelayScheme
        }
        return RemoteSessionPairing(
            relayUrl: relayUrl,
            remoteSessionId: try required("remoteSessionId"),
            hostPeerId: try required("hostPeerId"),
            hostPublicKey: try required("hostPublicKey"),
            pairingToken: try required("pairingToken"),
            expiresAt: resolvedExpiry
        )
    }
}

public final class RemoteSessionCrypto {
    private let sessionId: String
    public let localPeerId: String
    private let privateKey: Curve25519.KeyAgreement.PrivateKey
    public let publicKey: Data
    private var key: SymmetricKey?
    private var sendSequence: Int64 = 0
    private var receivedSequences: [String: Int64] = [:]

    public init(
        sessionId: String,
        localPeerId: String,
        privateKey: Curve25519.KeyAgreement.PrivateKey = Curve25519.KeyAgreement.PrivateKey()
    ) {
        self.sessionId = sessionId
        self.localPeerId = localPeerId
        self.privateKey = privateKey
        self.publicKey = privateKey.publicKey.rawRepresentation
    }

    /// Derive the shared AES key from the host public key + pairing token. The
    /// salt is SHA-256(token) and the info is `<protocol>:<sessionId>` — matching
    /// the Android + desktop HKDF exactly.
    public func pair(hostPublicKey: String, pairingToken: String) throws {
        guard let encoded = RemoteSessionBase64.decode(hostPublicKey) else {
            throw RemoteSessionCryptoError.invalidHostPublicKey
        }
        // Accept a raw 32-byte key or a longer SPKI-wrapped key (trailing 32B).
        let raw = encoded.count == 32 ? encoded : Data(encoded.suffix(32))
        guard raw.count == 32,
              let hostPub = try? Curve25519.KeyAgreement.PublicKey(rawRepresentation: raw),
              let shared = try? privateKey.sharedSecretFromKeyAgreement(with: hostPub)
        else {
            throw RemoteSessionCryptoError.invalidHostPublicKey
        }
        let salt = Data(SHA256.hash(data: Data(pairingToken.utf8)))
        let info = Data("\(remoteSessionProtocol):\(sessionId)".utf8)
        key = shared.hkdfDerivedSymmetricKey(
            using: SHA256.self,
            salt: salt,
            sharedInfo: info,
            outputByteCount: 32
        )
    }

    public func encrypt(_ plaintext: Data) throws -> RemoteEncryptedEnvelope {
        guard let key else { throw RemoteSessionCryptoError.notPaired }
        sendSequence += 1
        let sequence = sendSequence
        let nonce = AES.GCM.Nonce()
        let aad = Data(aadString(senderId: localPeerId, sequence: sequence).utf8)
        guard let box = try? AES.GCM.seal(plaintext, using: key, nonce: nonce, authenticating: aad) else {
            throw RemoteSessionCryptoError.decryptionFailed
        }
        return RemoteEncryptedEnvelope(
            sessionId: sessionId,
            senderId: localPeerId,
            sequence: sequence,
            nonce: RemoteSessionBase64.encode(Data(nonce)),
            ciphertext: RemoteSessionBase64.encode(box.ciphertext),
            tag: RemoteSessionBase64.encode(box.tag)
        )
    }

    public func decrypt(_ envelope: RemoteEncryptedEnvelope) throws -> Data {
        guard envelope.version == 1, envelope.sessionId == sessionId else {
            throw RemoteSessionCryptoError.invalidEnvelope
        }
        let previous = receivedSequences[envelope.senderId] ?? 0
        guard envelope.sequence > previous else {
            throw RemoteSessionCryptoError.replayOrOutOfOrder
        }
        guard let key else { throw RemoteSessionCryptoError.notPaired }
        guard let nonceData = RemoteSessionBase64.decode(envelope.nonce),
              let ciphertext = RemoteSessionBase64.decode(envelope.ciphertext),
              let tag = RemoteSessionBase64.decode(envelope.tag),
              let nonce = try? AES.GCM.Nonce(data: nonceData),
              let box = try? AES.GCM.SealedBox(nonce: nonce, ciphertext: ciphertext, tag: tag)
        else {
            throw RemoteSessionCryptoError.decryptionFailed
        }
        let aad = Data(aadString(senderId: envelope.senderId, sequence: envelope.sequence).utf8)
        guard let plaintext = try? AES.GCM.open(box, using: key, authenticating: aad) else {
            throw RemoteSessionCryptoError.decryptionFailed
        }
        receivedSequences[envelope.senderId] = envelope.sequence
        return plaintext
    }

    public func publicKeyBase64() -> String {
        RemoteSessionBase64.encode(publicKey)
    }

    private func aadString(senderId: String, sequence: Int64) -> String {
        "\(remoteSessionProtocol)\n\(sessionId)\n\(senderId)\n\(sequence)"
    }
}

/// URL-safe, unpadded base64 — matching `Base64.getUrlEncoder().withoutPadding()`
/// / `getUrlDecoder()` used by the Android + desktop peers.
public enum RemoteSessionBase64 {
    public static func encode(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    public static func decode(_ string: String) -> Data? {
        var s = string
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        let remainder = s.count % 4
        if remainder != 0 {
            s += String(repeating: "=", count: 4 - remainder)
        }
        return Data(base64Encoded: s)
    }
}
