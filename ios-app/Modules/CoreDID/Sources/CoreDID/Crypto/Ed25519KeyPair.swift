import Foundation
import CryptoKit

/// Ed25519 raw key pair 容器 — 用 CryptoKit Curve25519.Signing 生成。
public struct Ed25519KeyPair {
    public let publicKey: Data   // 32 bytes raw
    public let privateKey: Data  // 32 bytes raw seed

    public init(publicKey: Data, privateKey: Data) {
        self.publicKey = publicKey
        self.privateKey = privateKey
    }

    /// 生成新密钥对。
    public static func generate() throws -> Ed25519KeyPair {
        let privKey = Curve25519.Signing.PrivateKey()
        return Ed25519KeyPair(
            publicKey: privKey.publicKey.rawRepresentation,
            privateKey: privKey.rawRepresentation
        )
    }
}
