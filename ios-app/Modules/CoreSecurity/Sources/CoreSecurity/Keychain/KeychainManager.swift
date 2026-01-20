import Foundation
import Security
import CoreCommon

/// Keychain 管理器
public class KeychainManager {
    public static let shared = KeychainManager()

    private let service: String
    private let logger = Logger.shared

    private init(service: String = AppConstants.Keychain.service) {
        self.service = service
    }

    // MARK: - Public Methods

    /// 保存数据到 Keychain
    public func save(_ data: Data, forKey key: String, accessibility: CFString = kSecAttrAccessibleWhenUnlockedThisDeviceOnly) throws {
        // 删除旧数据
        try? delete(forKey: key)

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecValueData as String: data,
            kSecAttrAccessible as String: accessibility
        ]

        let status = SecItemAdd(query as CFDictionary, nil)

        guard status == errSecSuccess else {
            logger.error("Failed to save to Keychain", category: "Keychain")
            throw KeychainError.saveFailed(status)
        }

        logger.debug("Saved to Keychain: \(key)", category: "Keychain")
    }

    /// 保存字符串到 Keychain
    public func save(_ string: String, forKey key: String, accessibility: CFString = kSecAttrAccessibleWhenUnlockedThisDeviceOnly) throws {
        guard let data = string.data(using: .utf8) else {
            throw KeychainError.invalidData
        }
        try save(data, forKey: key, accessibility: accessibility)
    }

    /// 从 Keychain 读取数据
    public func load(forKey key: String) throws -> Data {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        guard status == errSecSuccess else {
            if status == errSecItemNotFound {
                throw KeychainError.notFound
            }
            logger.error("Failed to load from Keychain", category: "Keychain")
            throw KeychainError.loadFailed(status)
        }

        guard let data = result as? Data else {
            throw KeychainError.invalidData
        }

        logger.debug("Loaded from Keychain: \(key)", category: "Keychain")
        return data
    }

    /// 从 Keychain 读取字符串
    public func loadString(forKey key: String) throws -> String {
        let data = try load(forKey: key)
        guard let string = String(data: data, encoding: .utf8) else {
            throw KeychainError.invalidData
        }
        return string
    }

    /// 删除 Keychain 数据
    public func delete(forKey key: String) throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key
        ]

        let status = SecItemDelete(query as CFDictionary)

        guard status == errSecSuccess || status == errSecItemNotFound else {
            logger.error("Failed to delete from Keychain", category: "Keychain")
            throw KeychainError.deleteFailed(status)
        }

        logger.debug("Deleted from Keychain: \(key)", category: "Keychain")
    }

    /// 检查 Keychain 是否包含指定键
    public func contains(key: String) -> Bool {
        do {
            _ = try load(forKey: key)
            return true
        } catch {
            return false
        }
    }

    /// 清空所有 Keychain 数据
    public func clear() throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service
        ]

        let status = SecItemDelete(query as CFDictionary)

        guard status == errSecSuccess || status == errSecItemNotFound else {
            logger.error("Failed to clear Keychain", category: "Keychain")
            throw KeychainError.deleteFailed(status)
        }

        logger.info("Cleared all Keychain data", category: "Keychain")
    }

    // MARK: - Secure Enclave Methods

    /// 在 Secure Enclave 中生成密钥
    public func generateSecureEnclaveKey(tag: String) throws -> SecKey {
        guard let access = SecAccessControlCreateWithFlags(
            kCFAllocatorDefault,
            kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
            [.privateKeyUsage, .biometryCurrentSet],
            nil
        ) else {
            logger.error("Failed to create SecAccessControl", category: "Keychain")
            throw KeychainError.secureEnclaveKeyGenerationFailed
        }

        guard let tagData = tag.data(using: .utf8) else {
            logger.error("Failed to convert tag to data", category: "Keychain")
            throw KeychainError.invalidData
        }

        let attributes: [String: Any] = [
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
            kSecAttrKeySizeInBits as String: 256,
            kSecAttrTokenID as String: kSecAttrTokenIDSecureEnclave,
            kSecPrivateKeyAttrs as String: [
                kSecAttrIsPermanent as String: true,
                kSecAttrApplicationTag as String: tagData,
                kSecAttrAccessControl as String: access
            ]
        ]

        var error: Unmanaged<CFError>?
        guard let privateKey = SecKeyCreateRandomKey(attributes as CFDictionary, &error) else {
            if let error = error?.takeRetainedValue() {
                logger.error("Failed to generate Secure Enclave key", error: error as Error, category: "Keychain")
            }
            throw KeychainError.secureEnclaveKeyGenerationFailed
        }

        logger.info("Generated Secure Enclave key: \(tag)", category: "Keychain")
        return privateKey
    }

    /// 从 Secure Enclave 加载密钥
    public func loadSecureEnclaveKey(tag: String) throws -> SecKey {
        guard let tagData = tag.data(using: .utf8) else {
            throw KeychainError.invalidData
        }

        let query: [String: Any] = [
            kSecClass as String: kSecClassKey,
            kSecAttrApplicationTag as String: tagData,
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
            kSecReturnRef as String: true
        ]

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        guard status == errSecSuccess else {
            if status == errSecItemNotFound {
                throw KeychainError.notFound
            }
            throw KeychainError.loadFailed(status)
        }

        guard let key = result as? SecKey else {
            throw KeychainError.invalidData
        }

        return key
    }

    /// 删除 Secure Enclave 密钥
    public func deleteSecureEnclaveKey(tag: String) throws {
        guard let tagData = tag.data(using: .utf8) else {
            throw KeychainError.invalidData
        }

        let query: [String: Any] = [
            kSecClass as String: kSecClassKey,
            kSecAttrApplicationTag as String: tagData,
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom
        ]

        let status = SecItemDelete(query as CFDictionary)

        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainError.deleteFailed(status)
        }

        logger.debug("Deleted Secure Enclave key: \(tag)", category: "Keychain")
    }
}

// MARK: - Keychain Error

public enum KeychainError: Error, LocalizedError {
    case saveFailed(OSStatus)
    case loadFailed(OSStatus)
    case deleteFailed(OSStatus)
    case notFound
    case invalidData
    case secureEnclaveKeyGenerationFailed

    public var errorDescription: String? {
        switch self {
        case .saveFailed(let status):
            return "Failed to save to Keychain (status: \(status))"
        case .loadFailed(let status):
            return "Failed to load from Keychain (status: \(status))"
        case .deleteFailed(let status):
            return "Failed to delete from Keychain (status: \(status))"
        case .notFound:
            return "Item not found in Keychain"
        case .invalidData:
            return "Invalid data format"
        case .secureEnclaveKeyGenerationFailed:
            return "Failed to generate Secure Enclave key"
        }
    }
}
