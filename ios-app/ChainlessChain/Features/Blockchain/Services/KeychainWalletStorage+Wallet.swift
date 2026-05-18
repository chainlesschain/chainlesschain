//
//  KeychainWalletStorage+Wallet.swift
//  ChainlessChain
//
//  钱包存储扩展 - 提供高级钱包加密存储功能
//  整合 WalletCrypto (加密) + KeychainWalletStorage (存储)
//
//  Created by ChainlessChain on 2026-01-26.
//

import Foundation
import CryptoKit

// MARK: - 加密钱包数据结构

/// 加密后的钱包数据
struct EncryptedWalletData {
    let walletId: String
    let encryptedPrivateKey: String  // Base64编码的加密私钥
    let encryptedMnemonic: String?   // Base64编码的加密助记词（可选）
    let salt: Data                   // PBKDF2盐值
    let iv: Data                     // AES-GCM初始化向量
}

/// 加密结果
struct EncryptionResult {
    let encrypted: String  // Base64编码的密文
    let salt: Data
    let iv: Data
}

// MARK: - KeychainWalletStorage 钱包扩展

extension KeychainWalletStorage {

    /// 单例
    static let shared = KeychainWalletStorage()

    private var crypto: WalletCrypto {
        return WalletCrypto()
    }

    // MARK: - 加密/解密方法

    /// 加密数据
    /// - Parameters:
    ///   - data: 明文数据
    ///   - password: 密码
    /// - Returns: 加密结果（包含密文、盐值、IV）
    func encrypt(data: String, password: String) throws -> EncryptionResult {
        // 使用WalletCrypto加密，返回Base64字符串
        let encryptedBase64 = try crypto.encrypt(data: data, password: password)

        // WalletCrypto的encrypt方法返回: Base64(salt + iv + tag + ciphertext)
        // 我们需要解析出salt和iv用于存储

        guard let combined = Data(base64Encoded: encryptedBase64) else {
            throw CryptoError.invalidBase64
        }

        // 提取salt和iv（参考WalletCrypto的实现）
        // salt: 前64字节
        // iv: 64-80字节（16字节）
        let saltLength = 64
        let ivLength = 16

        guard combined.count >= saltLength + ivLength else {
            throw CryptoError.invalidEncryptedData
        }

        let salt = combined.subdata(in: 0..<saltLength)
        let iv = combined.subdata(in: saltLength..<(saltLength + ivLength))

        return EncryptionResult(
            encrypted: encryptedBase64,
            salt: salt,
            iv: iv
        )
    }

    /// 解密数据
    /// - Parameters:
    ///   - encrypted: 加密的Base64字符串
    ///   - password: 密码
    ///   - salt: 盐值（用于验证，实际从encrypted中提取）
    ///   - iv: IV（用于验证，实际从encrypted中提取）
    /// - Returns: 明文数据
    func decrypt(encrypted: String, password: String, salt: Data, iv: Data) throws -> String {
        // 直接使用WalletCrypto解密
        // salt和iv参数在这里主要用于接口一致性，实际解密会从encrypted中提取
        return try crypto.decrypt(encryptedData: encrypted, password: password)
    }

    // MARK: - 钱包存储方法

    /// 保存加密的钱包数据
    /// - Parameter walletData: 加密的钱包数据
    func saveEncryptedWallet(_ walletData: EncryptedWalletData) throws {
        // 构建存储的JSON数据
        let storage = WalletStorageData(
            walletId: walletData.walletId,
            encryptedPrivateKey: walletData.encryptedPrivateKey,
            encryptedMnemonic: walletData.encryptedMnemonic,
            salt: walletData.salt.base64EncodedString(),
            iv: walletData.iv.base64EncodedString()
        )

        // 序列化为JSON
        let jsonData = try JSONEncoder().encode(storage)
        guard let jsonString = String(data: jsonData, encoding: .utf8) else {
            throw KeychainError.invalidData
        }

        // 存储到Keychain
        try save(key: walletData.walletId, data: jsonString)
    }

    /// 加载加密的钱包数据
    /// - Parameter walletId: 钱包ID
    /// - Returns: 加密的钱包数据
    func loadEncryptedWallet(walletId: String) throws -> EncryptedWalletData {
        // 从Keychain读取
        let jsonString = try load(key: walletId)

        // 反序列化JSON
        guard let jsonData = jsonString.data(using: .utf8) else {
            throw KeychainError.invalidData
        }

        let storage = try JSONDecoder().decode(WalletStorageData.self, from: jsonData)

        // 解码Base64的salt和iv
        guard let salt = Data(base64Encoded: storage.salt),
              let iv = Data(base64Encoded: storage.iv) else {
            throw KeychainError.invalidData
        }

        return EncryptedWalletData(
            walletId: storage.walletId,
            encryptedPrivateKey: storage.encryptedPrivateKey,
            encryptedMnemonic: storage.encryptedMnemonic,
            salt: salt,
            iv: iv
        )
    }

    /// 删除钱包数据
    /// - Parameter walletId: 钱包ID
    func deleteWallet(walletId: String) throws {
        try delete(key: walletId)
    }

    /// 检查钱包是否存在
    /// - Parameter walletId: 钱包ID
    /// - Returns: 是否存在
    func walletExists(walletId: String) -> Bool {
        return exists(key: walletId)
    }
}

// MARK: - 内部存储数据结构

/// Keychain存储的数据结构（用于JSON序列化）
private struct WalletStorageData: Codable {
    let walletId: String
    let encryptedPrivateKey: String
    let encryptedMnemonic: String?
    let salt: String  // Base64编码
    let iv: String    // Base64编码
}
