//
//  WalletCrypto.swift
//  ChainlessChain
//
//  钱包加密工具 - 对应PC端 wallet-manager.js 中的 _encryptData/_decryptData
//  参考: desktop-app-vue/src/main/blockchain/wallet-manager.js:40-48, 783-872
//
//  Created by ChainlessChain on 2026-01-26.
//

import Foundation
import CryptoSwift

// MARK: - 加密配置 (对应PC端 ENCRYPTION_CONFIG)

/// 加密配置
/// 参考: wallet-manager.js:40-48
private struct EncryptionConfig {
    static let algorithm = "aes-256-gcm"
    static let keyLength = 32      // 256 bits
    static let ivLength = 16       // 128 bits (GCM IV)
    static let saltLength = 64     // 512 bits
    static let tagLength = 16      // 128 bits (GCM auth tag)
    static let iterations = 100000 // PBKDF2迭代次数
}

// MARK: - 钱包加密工具

/// 钱包加密工具类
/// 使用 AES-256-GCM 加密算法，与PC端完全一致
class WalletCrypto {

    // MARK: - 加密方法 (对应PC端 _encryptData)

    /// 加密数据
    /// - Parameters:
    ///   - data: 原始数据（明文）
    ///   - password: 密码
    /// - Returns: 加密后的数据（Base64编码）
    /// - Throws: CryptoError
    ///
    /// 参考: wallet-manager.js:783-823
    ///
    /// 加密流程：
    /// 1. 生成64字节随机盐值
    /// 2. 使用PBKDF2从密码派生32字节密钥（100,000次迭代，SHA256）
    /// 3. 生成16字节随机初始化向量（IV）
    /// 4. 使用AES-256-GCM加密数据
    /// 5. 获取16字节认证标签（GCM tag）
    /// 6. 组合: salt(64) + iv(16) + tag(16) + ciphertext
    /// 7. Base64编码
    func encrypt(data: String, password: String) throws -> String {
        // 1. 生成盐值（64字节随机数）
        let salt = AES.randomIV(EncryptionConfig.saltLength)

        // 2. 从密码派生密钥（PBKDF2, 100,000次迭代, SHA256）
        let key = try PKCS5.PBKDF2(
            password: Array(password.utf8),
            salt: salt,
            iterations: EncryptionConfig.iterations,
            keyLength: EncryptionConfig.keyLength,
            variant: .sha2(.sha256)
        ).calculate()

        // 3. 生成初始化向量（16字节随机数）
        let iv = AES.randomIV(EncryptionConfig.ivLength)

        // 4. AES-256-GCM加密
        let gcm = GCM(iv: iv, mode: .combined)
        let aes = try AES(key: key, blockMode: gcm, padding: .noPadding)
        let encrypted = try aes.encrypt(Array(data.utf8))

        // 5. 提取认证标签（GCM最后16字节）
        // CryptoSwift的GCM.combined模式会在密文末尾附加tag
        let ciphertextLength = encrypted.count - EncryptionConfig.tagLength
        let ciphertext = Array(encrypted[0..<ciphertextLength])
        let tag = Array(encrypted[ciphertextLength..<encrypted.count])

        // 6. 组合: salt(64) + iv(16) + tag(16) + ciphertext
        let combined = salt + iv + tag + ciphertext

        // 7. Base64编码
        let base64String = Data(combined).base64EncodedString()

        Logger.debug("[WalletCrypto] 加密成功，密文长度: \(combined.count)字节")

        return base64String
    }

    // MARK: - 解密方法 (对应PC端 _decryptData)

    /// 解密数据
    /// - Parameters:
    ///   - encryptedData: 加密数据（Base64编码）
    ///   - password: 密码
    /// - Returns: 解密后的明文
    /// - Throws: CryptoError
    ///
    /// 参考: wallet-manager.js:831-872
    ///
    /// 解密流程：
    /// 1. Base64解码
    /// 2. 提取salt(64) + iv(16) + tag(16) + ciphertext
    /// 3. 使用相同的盐和迭代次数从密码派生密钥
    /// 4. 使用AES-256-GCM解密（验证tag）
    /// 5. 转换为UTF-8字符串
    func decrypt(encryptedData: String, password: String) throws -> String {
        // 1. Base64解码
        guard let combined = Data(base64Encoded: encryptedData) else {
            Logger.error("[WalletCrypto] Base64解码失败")
            throw CryptoError.invalidBase64
        }

        let combinedBytes = Array(combined)

        // 验证最小长度
        let minLength = EncryptionConfig.saltLength +
                        EncryptionConfig.ivLength +
                        EncryptionConfig.tagLength
        guard combinedBytes.count > minLength else {
            Logger.error("[WalletCrypto] 加密数据长度不足")
            throw CryptoError.invalidEncryptedData
        }

        // 2. 提取各部分
        let salt = Array(combinedBytes[0..<EncryptionConfig.saltLength])

        let ivStart = EncryptionConfig.saltLength
        let ivEnd = ivStart + EncryptionConfig.ivLength
        let iv = Array(combinedBytes[ivStart..<ivEnd])

        let tagStart = ivEnd
        let tagEnd = tagStart + EncryptionConfig.tagLength
        let tag = Array(combinedBytes[tagStart..<tagEnd])

        let ciphertext = Array(combinedBytes[tagEnd..<combinedBytes.count])

        // 3. 从密码派生密钥（使用相同的盐和迭代次数）
        let key = try PKCS5.PBKDF2(
            password: Array(password.utf8),
            salt: salt,
            iterations: EncryptionConfig.iterations,
            keyLength: EncryptionConfig.keyLength,
            variant: .sha2(.sha256)
        ).calculate()

        // 4. AES-256-GCM解密
        let gcm = GCM(iv: iv, mode: .combined)
        let aes = try AES(key: key, blockMode: gcm, padding: .noPadding)

        // GCM combined模式需要将tag附加到密文后面
        let encryptedWithTag = ciphertext + tag

        let decrypted: [UInt8]
        do {
            decrypted = try aes.decrypt(encryptedWithTag)
        } catch {
            Logger.error("[WalletCrypto] 解密失败: \(error.localizedDescription)")
            throw CryptoError.decryptionFailed
        }

        // 5. 转换为字符串
        guard let plaintext = String(bytes: decrypted, encoding: .utf8) else {
            Logger.error("[WalletCrypto] UTF-8解码失败")
            throw CryptoError.invalidUTF8
        }

        Logger.debug("[WalletCrypto] 解密成功")

        return plaintext
    }

    // MARK: - 辅助方法

    /// 生成随机密码（用于测试）
    static func generateRandomPassword(length: Int = 16) -> String {
        let characters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()"
        return String((0..<length).map { _ in characters.randomElement()! })
    }
}

// MARK: - 错误类型

/// 加密错误类型
enum CryptoError: LocalizedError {
    case invalidBase64
    case invalidUTF8
    case invalidEncryptedData
    case encryptionFailed
    case decryptionFailed

    var errorDescription: String? {
        switch self {
        case .invalidBase64:
            return "无效的Base64编码"
        case .invalidUTF8:
            return "无效的UTF-8编码"
        case .invalidEncryptedData:
            return "无效的加密数据格式"
        case .encryptionFailed:
            return "数据加密失败"
        case .decryptionFailed:
            return "数据解密失败（密码可能错误）"
        }
    }
}

// MARK: - 扩展: Data十六进制转换

extension Data {
    /// 转换为十六进制字符串
    var hexString: String {
        return self.map { String(format: "%02x", $0) }.joined()
    }

    /// 从十六进制字符串创建Data
    init?(hexString: String) {
        let len = hexString.count / 2
        var data = Data(capacity: len)
        var index = hexString.startIndex

        for _ in 0..<len {
            let nextIndex = hexString.index(index, offsetBy: 2)
            if let byte = UInt8(hexString[index..<nextIndex], radix: 16) {
                data.append(byte)
            } else {
                return nil
            }
            index = nextIndex
        }
        self = data
    }
}

// MARK: - 测试

#if DEBUG
extension WalletCrypto {
    /// 测试加密/解密
    static func test() {
        let crypto = WalletCrypto()
        let password = "TestPassword123"
        let plaintext = "This is a secret message"

        do {
            // 加密
            let encrypted = try crypto.encrypt(data: plaintext, password: password)
            print("✅ 加密成功: \(encrypted.prefix(50))...")

            // 解密
            let decrypted = try crypto.decrypt(encryptedData: encrypted, password: password)
            print("✅ 解密成功: \(decrypted)")

            // 验证
            assert(decrypted == plaintext, "❌ 解密结果不匹配")
            print("✅ 加密/解密测试通过")

            // 错误密码测试
            do {
                _ = try crypto.decrypt(encryptedData: encrypted, password: "WrongPassword")
                print("❌ 应该抛出解密失败错误")
            } catch {
                print("✅ 错误密码正确拒绝: \(error.localizedDescription)")
            }

        } catch {
            print("❌ 测试失败: \(error.localizedDescription)")
        }
    }
}
#endif
