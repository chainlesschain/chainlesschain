import Foundation
import CryptoSwift
import CoreCommon
import CoreSecurity

/// DID 管理器
public class DIDManager {
    public static let shared = DIDManager()

    private let keychain = KeychainManager.shared
    private let crypto = CryptoManager.shared
    private let logger = Logger.shared

    private init() {}

    // MARK: - DID Generation

    /// 生成新的 DID 身份
    public func generateDID(displayName: String? = nil) throws -> DIDIdentity {
        // 生成 Ed25519 密钥对
        let keyPair = try Ed25519KeyPair.generate()

        // 构建 DID
        let did = buildDID(publicKey: keyPair.publicKey)

        // 加密私钥
        let encryptionKey = try getOrCreateMasterKey()
        let encryptedPrivateKey = try crypto.encryptAES(keyPair.privateKey, key: encryptionKey)

        // 创建 DID 身份
        let identity = DIDIdentity(
            did: did,
            publicKey: keyPair.publicKey.base64EncodedString(),
            privateKeyEncrypted: encryptedPrivateKey.toBase64(),
            displayName: displayName,
            isPrimary: false
        )

        logger.info("Generated new DID: \(did)", category: "DID")

        return identity
    }

    /// 构建 DID 字符串
    private func buildDID(publicKey: Data) -> String {
        // did:key 方法使用 multibase + multicodec 编码
        // Ed25519 public key multicodec: 0xed
        var prefixedKey = Data([0xed, 0x01])
        prefixedKey.append(publicKey)

        // 使用 base58btc 编码（前缀 z）
        let encoded = Base58.encode(prefixedKey)
        return "\(AppConstants.DID.prefix)z\(encoded)"
    }

    // MARK: - DID Resolution

    /// 解析 DID
    public func resolveDID(_ did: String) throws -> DIDDocument {
        guard did.hasPrefix(AppConstants.DID.prefix) else {
            throw DIDError.invalidDID("Invalid DID prefix")
        }

        // 提取公钥部分
        let keyPart = String(did.dropFirst(AppConstants.DID.prefix.count + 1)) // 去掉前缀和 z
        guard let decodedData = Base58.decode(keyPart) else {
            throw DIDError.invalidDID("Invalid base58 encoding")
        }

        // 验证 multicodec 前缀
        guard decodedData.count > 2 && decodedData[0] == 0xed && decodedData[1] == 0x01 else {
            throw DIDError.invalidDID("Invalid multicodec prefix")
        }

        // 提取公钥
        let publicKey = Data(decodedData.dropFirst(2))

        // 构建 DID 文档
        let document = DIDDocument(
            id: did,
            verificationMethod: [
                VerificationMethod(
                    id: "\(did)#keys-1",
                    type: "Ed25519VerificationKey2020",
                    controller: did,
                    publicKeyMultibase: "z\(keyPart)"
                )
            ],
            authentication: ["\(did)#keys-1"],
            keyAgreement: ["\(did)#keys-1"]
        )

        return document
    }

    /// 验证 DID 格式
    public func isValidDID(_ did: String) -> Bool {
        guard did.hasPrefix(AppConstants.DID.prefix) else { return false }

        do {
            _ = try resolveDID(did)
            return true
        } catch {
            return false
        }
    }

    // MARK: - Key Management

    /// 获取或创建主密钥
    private func getOrCreateMasterKey() throws -> Data {
        let masterKeyKey = AppConstants.Keychain.masterKeyKey

        do {
            return try keychain.load(forKey: masterKeyKey)
        } catch KeychainError.notFound {
            // 生成新主密钥
            let masterKey = try crypto.generateAESKey()
            try keychain.save(masterKey, forKey: masterKeyKey)
            logger.info("Generated new master key", category: "DID")
            return masterKey
        }
    }

    /// 解密私钥
    public func decryptPrivateKey(encryptedPrivateKey: String) throws -> Data {
        let encryptionKey = try keychain.load(forKey: AppConstants.Keychain.masterKeyKey)
        let encryptedData = try EncryptedData.fromBase64(encryptedPrivateKey)
        return try crypto.decryptAES(encryptedData, key: encryptionKey)
    }

    // MARK: - Signing

    /// 使用 DID 签名数据
    public func sign(data: Data, identity: DIDIdentity) throws -> Data {
        // 解密私钥
        let privateKey = try decryptPrivateKey(encryptedPrivateKey: identity.privateKeyEncrypted)

        // 使用 Ed25519 签名
        let signature = try Ed25519.sign(message: data, privateKey: privateKey)

        logger.debug("Signed data with DID: \(identity.did)", category: "DID")

        return signature
    }

    /// 验证签名
    public func verify(signature: Data, data: Data, publicKey: Data) throws -> Bool {
        return try Ed25519.verify(signature: signature, message: data, publicKey: publicKey)
    }

    /// 验证签名（使用 DID）
    public func verify(signature: Data, data: Data, did: String) throws -> Bool {
        let document = try resolveDID(did)

        guard let verificationMethod = document.verificationMethod.first,
              let keyPart = verificationMethod.publicKeyMultibase?.dropFirst(), // 去掉 z
              let decodedData = Base58.decode(String(keyPart)),
              decodedData.count > 2 else {
            throw DIDError.invalidDID("Cannot extract public key from DID")
        }

        let publicKey = Data(decodedData.dropFirst(2))
        return try verify(signature: signature, data: data, publicKey: publicKey)
    }
}

// MARK: - DID Document

public struct DIDDocument: Codable {
    public let context: [String]
    public let id: String
    public let verificationMethod: [VerificationMethod]
    public let authentication: [String]
    public let keyAgreement: [String]

    enum CodingKeys: String, CodingKey {
        case context = "@context"
        case id
        case verificationMethod
        case authentication
        case keyAgreement
    }

    public init(
        id: String,
        verificationMethod: [VerificationMethod],
        authentication: [String],
        keyAgreement: [String]
    ) {
        self.context = [
            "https://www.w3.org/ns/did/v1",
            "https://w3id.org/security/suites/ed25519-2020/v1"
        ]
        self.id = id
        self.verificationMethod = verificationMethod
        self.authentication = authentication
        self.keyAgreement = keyAgreement
    }
}

public struct VerificationMethod: Codable {
    public let id: String
    public let type: String
    public let controller: String
    public let publicKeyMultibase: String?

    public init(id: String, type: String, controller: String, publicKeyMultibase: String?) {
        self.id = id
        self.type = type
        self.controller = controller
        self.publicKeyMultibase = publicKeyMultibase
    }
}

// MARK: - DID Error

public enum DIDError: Error, LocalizedError {
    case invalidDID(String)
    case keyGenerationFailed
    case signingFailed
    case verificationFailed

    public var errorDescription: String? {
        switch self {
        case .invalidDID(let message):
            return "Invalid DID: \(message)"
        case .keyGenerationFailed:
            return "Key generation failed"
        case .signingFailed:
            return "Signing failed"
        case .verificationFailed:
            return "Verification failed"
        }
    }
}
