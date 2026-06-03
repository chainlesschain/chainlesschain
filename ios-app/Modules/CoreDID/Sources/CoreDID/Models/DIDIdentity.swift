import Foundation

/// DID 身份对象
///
/// 持有一个 DID + 公钥 base64 + 已加密的私钥（AES-256-GCM via
/// CoreSecurity.CryptoManager + master key in Keychain）+ 显示名 + 主标记。
public struct DIDIdentity: Codable, Equatable, Identifiable {
    public var id: String { did }

    public let did: String
    public let publicKey: String           // base64(raw 32B Ed25519 public key)
    public let privateKeyEncrypted: String // base64(EncryptedData(ciphertext+iv))
    public let displayName: String?
    public let isPrimary: Bool
    public let createdAt: Date

    public init(
        did: String,
        publicKey: String,
        privateKeyEncrypted: String,
        displayName: String? = nil,
        isPrimary: Bool = false,
        createdAt: Date = Date()
    ) {
        self.did = did
        self.publicKey = publicKey
        self.privateKeyEncrypted = privateKeyEncrypted
        self.displayName = displayName
        self.isPrimary = isPrimary
        self.createdAt = createdAt
    }
}
