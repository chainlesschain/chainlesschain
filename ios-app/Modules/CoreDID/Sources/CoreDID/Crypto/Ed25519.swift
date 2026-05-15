import Foundation
import CryptoKit

/// Ed25519 signing 命名空间 — 包装 Apple CryptoKit Curve25519.Signing。
public enum Ed25519 {

    public enum Ed25519Error: Error, LocalizedError {
        case invalidPrivateKey
        case invalidPublicKey
        case signingFailed
        case verificationFailed

        public var errorDescription: String? {
            switch self {
            case .invalidPrivateKey: return "Invalid Ed25519 private key (expected 32 bytes raw)"
            case .invalidPublicKey:  return "Invalid Ed25519 public key (expected 32 bytes raw)"
            case .signingFailed:     return "Ed25519 sign failed"
            case .verificationFailed: return "Ed25519 verify failed"
            }
        }
    }

    /// 用 raw 32-byte private key 对 message 签名，返回 64 字节签名。
    public static func sign(message: Data, privateKey: Data) throws -> Data {
        guard let key = try? Curve25519.Signing.PrivateKey(rawRepresentation: privateKey) else {
            throw Ed25519Error.invalidPrivateKey
        }
        do {
            return try key.signature(for: message)
        } catch {
            throw Ed25519Error.signingFailed
        }
    }

    /// 用 raw 32-byte public key 验签 64 字节签名。
    public static func verify(signature: Data, message: Data, publicKey: Data) throws -> Bool {
        guard let key = try? Curve25519.Signing.PublicKey(rawRepresentation: publicKey) else {
            throw Ed25519Error.invalidPublicKey
        }
        return key.isValidSignature(signature, for: message)
    }
}
