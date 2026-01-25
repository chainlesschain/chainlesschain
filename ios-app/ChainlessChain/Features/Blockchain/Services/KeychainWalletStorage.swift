import Foundation
import Security
import CryptoKit

/// Keychain钱包存储服务
/// 负责安全存储钱包的私钥和助记词
class KeychainWalletStorage {
    static let shared = KeychainWalletStorage()

    private let service = "com.chainlesschain.wallet"

    private init() {}

    // MARK: - 存储加密的钱包数据

    /// 保存加密的钱包数据到Keychain
    func saveEncryptedWallet(_ data: EncryptedWalletData) throws {
        let encoder = JSONEncoder()
        let jsonData = try encoder.encode(data)

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: data.walletId,
            kSecValueData as String: jsonData,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        ]

        // 删除旧数据
        SecItemDelete(query as CFDictionary)

        // 添加新数据
        let status = SecItemAdd(query as CFDictionary, nil)

        guard status == errSecSuccess else {
            throw WalletError.keychainError("保存钱包失败: \(status)")
        }
    }

    /// 从Keychain读取加密的钱包数据
    func loadEncryptedWallet(walletId: String) throws -> EncryptedWalletData {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: walletId,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        guard status == errSecSuccess,
              let data = result as? Data else {
            throw WalletError.keychainError("读取钱包失败: \(status)")
        }

        let decoder = JSONDecoder()
        return try decoder.decode(EncryptedWalletData.self, from: data)
    }

    /// 删除钱包数据
    func deleteWallet(walletId: String) throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: walletId
        ]

        let status = SecItemDelete(query as CFDictionary)

        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw WalletError.keychainError("删除钱包失败: \(status)")
        }
    }

    // MARK: - 加密/解密

    /// 加密数据（AES-256-GCM）
    func encrypt(data: String, password: String) throws -> (encrypted: String, salt: String, iv: String) {
        // 1. 生成随机salt
        var salt = Data(count: 32)
        let saltStatus = salt.withUnsafeMutableBytes { saltBytes in
            SecRandomCopyBytes(kSecRandomDefault, 32, saltBytes.baseAddress!)
        }
        guard saltStatus == errSecSuccess else {
            throw WalletError.encryptionError("生成salt失败")
        }

        // 2. 使用PBKDF2派生密钥
        let key = try deriveKey(password: password, salt: salt)

        // 3. 加密数据
        guard let plainData = data.data(using: .utf8) else {
            throw WalletError.encryptionError("数据转换失败")
        }

        let symmetricKey = SymmetricKey(data: key)
        let sealedBox = try AES.GCM.seal(plainData, using: symmetricKey)

        guard let combined = sealedBox.combined else {
            throw WalletError.encryptionError("加密失败")
        }

        // 4. 提取nonce（IV）
        let nonce = sealedBox.nonce.withUnsafeBytes { Data($0) }

        return (
            encrypted: combined.base64EncodedString(),
            salt: salt.base64EncodedString(),
            iv: nonce.base64EncodedString()
        )
    }

    /// 解密数据
    func decrypt(encrypted: String, password: String, salt: String, iv: String) throws -> String {
        // 1. 解码数据
        guard let encryptedData = Data(base64Encoded: encrypted),
              let saltData = Data(base64Encoded: salt) else {
            throw WalletError.decryptionError("数据解码失败")
        }

        // 2. 派生密钥
        let key = try deriveKey(password: password, salt: saltData)
        let symmetricKey = SymmetricKey(data: key)

        // 3. 解密
        let sealedBox = try AES.GCM.SealedBox(combined: encryptedData)
        let decryptedData = try AES.GCM.open(sealedBox, using: symmetricKey)

        guard let decrypted = String(data: decryptedData, encoding: .utf8) else {
            throw WalletError.decryptionError("解密数据转换失败")
        }

        return decrypted
    }

    /// 使用PBKDF2派生密钥
    private func deriveKey(password: String, salt: Data) throws -> Data {
        guard let passwordData = password.data(using: .utf8) else {
            throw WalletError.encryptionError("密码转换失败")
        }

        var derivedKeyData = Data(count: 32)  // 256 bits
        let derivationStatus = derivedKeyData.withUnsafeMutableBytes { derivedKeyBytes in
            salt.withUnsafeBytes { saltBytes in
                CCKeyDerivationPBKDF(
                    CCPBKDFAlgorithm(kCCPBKDF2),
                    password,
                    passwordData.count,
                    saltBytes.baseAddress?.assumingMemoryBound(to: UInt8.self),
                    salt.count,
                    CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256),
                    100000,  // 迭代次数（与PC端一致）
                    derivedKeyBytes.baseAddress?.assumingMemoryBound(to: UInt8.self),
                    32
                )
            }
        }

        guard derivationStatus == kCCSuccess else {
            throw WalletError.encryptionError("密钥派生失败")
        }

        return derivedKeyData
    }
}

// MARK: - CommonCrypto导入

import CommonCrypto

// MARK: - 错误类型

enum WalletError: LocalizedError {
    case keychainError(String)
    case encryptionError(String)
    case decryptionError(String)
    case invalidMnemonic
    case invalidPrivateKey
    case invalidPassword
    case walletNotFound
    case networkError(String)

    var errorDescription: String? {
        switch self {
        case .keychainError(let message): return "Keychain错误: \(message)"
        case .encryptionError(let message): return "加密错误: \(message)"
        case .decryptionError(let message): return "解密错误: \(message)"
        case .invalidMnemonic: return "无效的助记词"
        case .invalidPrivateKey: return "无效的私钥"
        case .invalidPassword: return "密码错误或长度不足8位"
        case .walletNotFound: return "钱包不存在"
        case .networkError(let message): return "网络错误: \(message)"
        }
    }
}
