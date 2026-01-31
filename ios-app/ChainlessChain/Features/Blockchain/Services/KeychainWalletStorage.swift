//
//  KeychainWalletStorage.swift
//  ChainlessChain
//
//  Keychain钱包存储 - iOS安全存储（替代PC端的文件加密存储）
//  参考: iOS Keychain Services
//
//  Created by ChainlessChain on 2026-01-26.
//

import Foundation
import Security

// MARK: - Keychain钱包存储

/// Keychain钱包存储类
/// 使用iOS Keychain Services安全存储敏感数据
/// 比PC端的文件加密存储更安全（硬件级保护）
class KeychainWalletStorage {

    // MARK: - 属性

    private let service = "com.chainlesschain.wallet"

    // MARK: - 保存方法

    /// 保存数据到Keychain
    /// - Parameters:
    ///   - key: 键（通常是钱包ID）
    ///   - data: 数据（字符串）
    /// - Throws: KeychainError
    func save(key: String, data: String) throws {
        guard let dataBytes = data.data(using: .utf8) else {
            throw KeychainError.invalidData
        }

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecValueData as String: dataBytes,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        ]

        // 先删除旧值（如果存在）
        SecItemDelete(query as CFDictionary)

        // 保存新值
        let status = SecItemAdd(query as CFDictionary, nil)

        guard status == errSecSuccess else {
            Logger.error("[KeychainStorage] 保存失败: \(status)")
            throw KeychainError.saveFailed(status)
        }

        Logger.debug("[KeychainStorage] 保存成功: \(key)")
    }

    // MARK: - 加载方法

    /// 从Keychain加载数据
    /// - Parameter key: 键
    /// - Returns: 数据字符串
    /// - Throws: KeychainError
    func load(key: String) throws -> String {
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
                Logger.debug("[KeychainStorage] 未找到数据: \(key)")
                throw KeychainError.itemNotFound
            }
            Logger.error("[KeychainStorage] 加载失败: \(status)")
            throw KeychainError.loadFailed(status)
        }

        guard let data = result as? Data,
              let string = String(data: data, encoding: .utf8) else {
            Logger.error("[KeychainStorage] 数据格式无效")
            throw KeychainError.invalidData
        }

        Logger.debug("[KeychainStorage] 加载成功: \(key)")

        return string
    }

    // MARK: - 删除方法

    /// 从Keychain删除数据
    /// - Parameter key: 键
    /// - Throws: KeychainError
    func delete(key: String) throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key
        ]

        let status = SecItemDelete(query as CFDictionary)

        // errSecItemNotFound也视为成功（已经不存在）
        guard status == errSecSuccess || status == errSecItemNotFound else {
            Logger.error("[KeychainStorage] 删除失败: \(status)")
            throw KeychainError.deleteFailed(status)
        }

        Logger.debug("[KeychainStorage] 删除成功: \(key)")
    }

    // MARK: - 检查方法

    /// 检查Keychain中是否存在指定键
    /// - Parameter key: 键
    /// - Returns: 是否存在
    func exists(key: String) -> Bool {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecReturnData as String: false
        ]

        let status = SecItemCopyMatching(query as CFDictionary, nil)
        return status == errSecSuccess
    }

    // MARK: - 清空方法

    /// 清空所有钱包数据（危险操作）
    /// - Throws: KeychainError
    func clearAll() throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service
        ]

        let status = SecItemDelete(query as CFDictionary)

        guard status == errSecSuccess || status == errSecItemNotFound else {
            Logger.error("[KeychainStorage] 清空失败: \(status)")
            throw KeychainError.deleteFailed(status)
        }

        Logger.info("[KeychainStorage] 已清空所有数据")
    }
}

// MARK: - 错误类型

enum KeychainError: LocalizedError {
    case saveFailed(OSStatus)
    case loadFailed(OSStatus)
    case deleteFailed(OSStatus)
    case invalidData
    case itemNotFound

    var errorDescription: String? {
        switch self {
        case .saveFailed(let status):
            return "Keychain保存失败: \(keychainErrorMessage(status))"
        case .loadFailed(let status):
            return "Keychain加载失败: \(keychainErrorMessage(status))"
        case .deleteFailed(let status):
            return "Keychain删除失败: \(keychainErrorMessage(status))"
        case .invalidData:
            return "无效的Keychain数据格式"
        case .itemNotFound:
            return "Keychain中未找到该项"
        }
    }

    private func keychainErrorMessage(_ status: OSStatus) -> String {
        if let errorMessage = SecCopyErrorMessageString(status, nil) as String? {
            return errorMessage
        }
        return "错误代码 \(status)"
    }
}
