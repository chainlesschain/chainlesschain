import Foundation
import CryptoSwift
import CoreCommon

/// 加密管理器
public class CryptoManager {
    public static let shared = CryptoManager()

    private let logger = Logger.shared

    private init() {}

    // MARK: - AES Encryption/Decryption

    /// AES-256-GCM 加密
    public func encryptAES(_ data: Data, key: Data) throws -> EncryptedData {
        guard key.count == AppConstants.Crypto.aesKeySize else {
            throw CryptoError.invalidKeySize
        }

        // 生成随机 IV (12 bytes for GCM)
        let iv = try generateRandomBytes(count: 12)

        // 使用 AES-GCM 加密
        let gcm = GCM(iv: iv.bytes, mode: .combined)
        let aes = try AES(key: key.bytes, blockMode: gcm, padding: .noPadding)
        let encrypted = try aes.encrypt(data.bytes)

        // GCM mode 会在密文后附加 16 字节的认证标签
        let ciphertext = Data(encrypted)

        logger.debug("Encrypted data: \(data.count) bytes -> \(ciphertext.count) bytes", category: "Crypto")

        return EncryptedData(ciphertext: ciphertext, iv: iv)
    }

    /// AES-256-GCM 解密
    public func decryptAES(_ encryptedData: EncryptedData, key: Data) throws -> Data {
        guard key.count == AppConstants.Crypto.aesKeySize else {
            throw CryptoError.invalidKeySize
        }

        // 使用 AES-GCM 解密
        let gcm = GCM(iv: encryptedData.iv.bytes, mode: .combined)
        let aes = try AES(key: key.bytes, blockMode: gcm, padding: .noPadding)
        let decrypted = try aes.decrypt(encryptedData.ciphertext.bytes)

        let plaintext = Data(decrypted)

        logger.debug("Decrypted data: \(encryptedData.ciphertext.count) bytes -> \(plaintext.count) bytes", category: "Crypto")

        return plaintext
    }

    /// AES 加密字符串
    public func encryptString(_ string: String, key: Data) throws -> EncryptedData {
        guard let data = string.data(using: .utf8) else {
            throw CryptoError.invalidData
        }
        return try encryptAES(data, key: key)
    }

    /// AES 解密字符串
    public func decryptString(_ encryptedData: EncryptedData, key: Data) throws -> String {
        let data = try decryptAES(encryptedData, key: key)
        guard let string = String(data: data, encoding: .utf8) else {
            throw CryptoError.invalidData
        }
        return string
    }

    // MARK: - Key Derivation (PBKDF2)

    /// 使用 PBKDF2 派生密钥
    public func deriveKey(password: String, salt: Data, iterations: Int = AppConstants.Crypto.pbkdf2Iterations, keyLength: Int = AppConstants.Crypto.aesKeySize) throws -> Data {
        guard let passwordData = password.data(using: .utf8) else {
            throw CryptoError.invalidPassword
        }

        let derivedKey = try PKCS5.PBKDF2(
            password: passwordData.bytes,
            salt: salt.bytes,
            iterations: iterations,
            keyLength: keyLength,
            variant: .sha256
        ).calculate()

        logger.debug("Derived key using PBKDF2: \(iterations) iterations", category: "Crypto")

        return Data(derivedKey)
    }

    /// 使用 PBKDF2 派生密钥（带自动生成盐）
    public func deriveKey(password: String, iterations: Int = AppConstants.Crypto.pbkdf2Iterations, keyLength: Int = AppConstants.Crypto.aesKeySize) throws -> (key: Data, salt: Data) {
        let salt = try generateRandomBytes(count: AppConstants.Crypto.saltSize)
        let key = try deriveKey(password: password, salt: salt, iterations: iterations, keyLength: keyLength)
        return (key, salt)
    }

    // MARK: - Hashing

    /// SHA-256 哈希
    public func sha256(_ data: Data) -> Data {
        return Data(data.sha256())
    }

    /// SHA-256 哈希字符串
    public func sha256(_ string: String) -> Data? {
        guard let data = string.data(using: .utf8) else { return nil }
        return sha256(data)
    }

    /// SHA-256 哈希字符串（返回十六进制）
    public func sha256Hex(_ string: String) -> String? {
        guard let hash = sha256(string) else { return nil }
        return hash.toHexString()
    }

    // MARK: - Random Generation

    /// 生成随机字节
    public func generateRandomBytes(count: Int) throws -> Data {
        var bytes = [UInt8](repeating: 0, count: count)
        let status = SecRandomCopyBytes(kSecRandomDefault, count, &bytes)

        guard status == errSecSuccess else {
            logger.error("Failed to generate random bytes", category: "Crypto")
            throw CryptoError.randomGenerationFailed
        }

        return Data(bytes)
    }

    /// 生成随机密钥
    public func generateAESKey() throws -> Data {
        return try generateRandomBytes(count: AppConstants.Crypto.aesKeySize)
    }

    // MARK: - PIN Verification

    /// 验证 PIN 码
    public func verifyPIN(_ pin: String, storedHash: Data) -> Bool {
        guard let pinHash = sha256(pin) else {
            return false
        }
        return pinHash == storedHash
    }

    /// 哈希 PIN 码用于存储
    public func hashPIN(_ pin: String) -> Data? {
        return sha256(pin)
    }
}

// MARK: - Encrypted Data

public struct EncryptedData: Codable {
    public let ciphertext: Data
    public let iv: Data

    public init(ciphertext: Data, iv: Data) {
        self.ciphertext = ciphertext
        self.iv = iv
    }

    /// 转换为 Base64 字符串
    public func toBase64() -> String {
        let combined = iv + ciphertext
        return combined.base64EncodedString()
    }

    /// 从 Base64 字符串解析
    public static func fromBase64(_ base64: String) throws -> EncryptedData {
        guard let combined = Data(base64Encoded: base64) else {
            throw CryptoError.invalidData
        }

        // IV 是前 12 字节 (GCM mode)
        let ivSize = 12
        guard combined.count > ivSize else {
            throw CryptoError.invalidData
        }

        let iv = combined.prefix(ivSize)
        let ciphertext = combined.suffix(from: ivSize)

        return EncryptedData(ciphertext: ciphertext, iv: iv)
    }
}

// MARK: - Crypto Error

public enum CryptoError: Error, LocalizedError {
    case invalidKeySize
    case invalidData
    case invalidPassword
    case encryptionFailed
    case decryptionFailed
    case randomGenerationFailed

    public var errorDescription: String? {
        switch self {
        case .invalidKeySize:
            return "Invalid key size"
        case .invalidData:
            return "Invalid data format"
        case .invalidPassword:
            return "Invalid password"
        case .encryptionFailed:
            return "Encryption failed"
        case .decryptionFailed:
            return "Decryption failed"
        case .randomGenerationFailed:
            return "Failed to generate random bytes"
        }
    }
}
