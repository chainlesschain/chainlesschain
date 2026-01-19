import Foundation
import SwiftUI
import CoreCommon
import CoreSecurity
import CoreDatabase
import CoreDID

@MainActor
class AuthViewModel: ObservableObject {
    @Published var isLoading = false
    @Published var errorMessage: String?
    @Published var isFirstTimeSetup = false
    @Published var showBiometricPrompt = false

    private let logger = Logger.shared
    private let keychainManager = KeychainManager.shared
    private let biometricManager = BiometricAuthManager.shared

    init() {
        checkFirstTimeSetup()
    }

    // MARK: - Setup Check

    private func checkFirstTimeSetup() {
        // 检查是否已设置 PIN
        let hasPIN = keychainManager.contains(key: AppConstants.Keychain.pinKey)
        isFirstTimeSetup = !hasPIN

        // 检查是否启用生物识别
        showBiometricPrompt = UserDefaults.standard.bool(forKey: AppConstants.UserDefaults.biometricEnabled)
    }

    // MARK: - First Time Setup

    func setupPIN(_ pin: String) async throws {
        guard pin.count >= 6 else {
            throw AuthError.invalidPIN("PIN must be at least 6 digits")
        }

        isLoading = true
        defer { isLoading = false }

        logger.info("Setting up new PIN", category: "Auth")

        // 生成 PIN 哈希
        let pinHash = try CryptoManager.shared.hashPassword(pin)

        // 保存 PIN 哈希到 Keychain
        try keychainManager.save(pinHash, forKey: AppConstants.Keychain.pinKey)

        // 生成数据库密钥
        let dbKey = try CryptoManager.shared.generateRandomBytes(count: AppConstants.Database.encryptionKeySize)
        try keychainManager.save(dbKey, forKey: AppConstants.Keychain.dbKeyKey)

        // 创建并初始化数据库
        try DatabaseManager.shared.open(password: pin)

        // 生成 DID 身份
        try await createPrimaryDID()

        isFirstTimeSetup = false
        logger.info("PIN setup completed", category: "Auth")
    }

    // MARK: - Authentication

    func authenticateWithPIN(_ pin: String) async throws {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        logger.info("Authenticating with PIN", category: "Auth")

        // 验证 PIN
        try verifyPIN(pin)

        // 打开数据库
        try await AppState.shared.authenticate(pin: pin)

        // 发送认证成功通知
        NotificationCenter.default.post(name: AppConstants.Notification.didAuthenticated, object: nil)

        logger.info("PIN authentication successful", category: "Auth")
    }

    func authenticateWithBiometric() async throws {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        logger.info("Authenticating with biometric", category: "Auth")

        // 执行生物识别验证
        try await biometricManager.authenticate(reason: "解锁 ChainlessChain")

        // 从 Keychain 获取 PIN (仅用于打开数据库)
        // 注意: 实际应用中应该使用更安全的方式存储数据库密钥
        guard let pinHash = try? keychainManager.loadString(forKey: AppConstants.Keychain.pinKey) else {
            throw AuthError.biometricFailed("Cannot retrieve credentials")
        }

        // 使用 PIN 哈希打开数据库
        // 注意: 这里应该改进为使用独立的数据库密钥
        let dbKey = try keychainManager.load(forKey: AppConstants.Keychain.dbKeyKey)
        let keyString = dbKey.hexString

        try DatabaseManager.shared.open(password: keyString)

        // 更新应用状态
        AppState.shared.isAuthenticated = true
        AppState.shared.isDatabaseUnlocked = true

        NotificationCenter.default.post(name: AppConstants.Notification.didAuthenticated, object: nil)

        logger.info("Biometric authentication successful", category: "Auth")
    }

    // MARK: - Biometric Settings

    func enableBiometric(_ enabled: Bool) async throws {
        if enabled {
            // 测试生物识别是否可用
            try await biometricManager.authenticate(reason: "启用生物识别解锁")
        }

        UserDefaults.standard.set(enabled, forKey: AppConstants.UserDefaults.biometricEnabled)
        showBiometricPrompt = enabled

        logger.info("Biometric \(enabled ? "enabled" : "disabled")", category: "Auth")
    }

    func canUseBiometric() -> Bool {
        return biometricManager.isBiometricAvailable()
    }

    func biometricType() -> String {
        return biometricManager.biometricType().displayName
    }

    // MARK: - PIN Management

    func changePIN(oldPIN: String, newPIN: String) async throws {
        guard newPIN.count >= 6 else {
            throw AuthError.invalidPIN("New PIN must be at least 6 digits")
        }

        isLoading = true
        defer { isLoading = false }

        logger.info("Changing PIN", category: "Auth")

        // 验证旧 PIN
        try verifyPIN(oldPIN)

        // 生成新 PIN 哈希
        let newPinHash = try CryptoManager.shared.hashPassword(newPIN)

        // 保存新 PIN 哈希
        try keychainManager.save(newPinHash, forKey: AppConstants.Keychain.pinKey)

        // 重新加密数据库 (如果需要)
        // 注意: SQLCipher 支持 PRAGMA rekey

        logger.info("PIN changed successfully", category: "Auth")
    }

    private func verifyPIN(_ pin: String) throws {
        guard let storedHash = try? keychainManager.loadString(forKey: AppConstants.Keychain.pinKey) else {
            throw AuthError.pinNotSet
        }

        let isValid = try CryptoManager.shared.verifyPassword(pin, hash: storedHash)

        guard isValid else {
            throw AuthError.invalidPIN("Incorrect PIN")
        }
    }

    // MARK: - DID Creation

    private func createPrimaryDID() async throws {
        logger.info("Creating primary DID", category: "Auth")

        let didManager = DIDManager.shared

        // 生成 DID
        let didDocument = try didManager.createDID()

        // 保存到数据库
        let sql = """
            INSERT INTO did_identities (id, did, public_key, private_key_encrypted, is_primary, created_at, updated_at)
            VALUES (?, ?, ?, ?, 1, ?, ?);
        """

        let timestamp = Date().timestampMs

        // 加密私钥 (使用 PIN 派生的密钥)
        let privateKeyEncrypted = try encryptPrivateKey(didDocument.privateKey)

        _ = try DatabaseManager.shared.execute(sql)

        // 保存当前 DID
        UserDefaults.standard.set(didDocument.did, forKey: AppConstants.UserDefaults.currentDID)
        AppState.shared.currentDID = didDocument.did

        logger.info("Primary DID created: \(didDocument.did)", category: "Auth")
    }

    private func encryptPrivateKey(_ privateKey: Data) throws -> String {
        // 使用主密钥加密私钥
        let masterKey = try keychainManager.load(forKey: AppConstants.Keychain.dbKeyKey)
        let encrypted = try CryptoManager.shared.encryptAES(data: privateKey, key: masterKey)
        return encrypted.base64EncodedString()
    }

    // MARK: - Error Handling

    func handleError(_ error: Error) {
        logger.error("Auth error", error: error, category: "Auth")
        errorMessage = error.localizedDescription
    }
}

// MARK: - Auth Error

enum AuthError: Error, LocalizedError {
    case pinNotSet
    case invalidPIN(String)
    case biometricFailed(String)
    case databaseError(String)

    var errorDescription: String? {
        switch self {
        case .pinNotSet:
            return "PIN has not been set"
        case .invalidPIN(let message):
            return message
        case .biometricFailed(let message):
            return "Biometric authentication failed: \(message)"
        case .databaseError(let message):
            return "Database error: \(message)"
        }
    }
}
