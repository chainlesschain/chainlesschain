import Foundation
import Combine

/// HD钱包管理器
/// 负责创建、导入、管理钱包
///
/// 技术栈：
/// - Trust Wallet Core (https://github.com/trustwallet/wallet-core)
///   - 支持BIP39/BIP44/BIP32标准
///   - 支持70+条区块链
///   - 成熟稳定，被Trust Wallet等大型钱包使用
///   - 通过WalletCoreAdapter封装使用
///
/// 功能特性：
/// - ✅ BIP39助记词生成（12/24词）
/// - ✅ BIP44密钥派生
/// - ✅ 助记词/私钥导入
/// - ✅ AES-256-GCM加密存储
/// - ✅ iOS Keychain安全存储
/// - ✅ Face ID/Touch ID生物识别
class WalletManager: ObservableObject {
    static let shared = WalletManager()

    @Published var wallets: [Wallet] = []
    @Published var currentWallet: Wallet?

    private let keychainStorage = KeychainWalletStorage.shared
    private let databaseManager: DatabaseManager
    private let derivationPath = "m/44'/60'/0'/0/0"  // Ethereum BIP44标准路径

    // 内存中缓存解锁的钱包（钱包ID -> 私钥）
    private var unlockedWallets: [String: String] = [:]

    private init() {
        self.databaseManager = DatabaseManager.shared
        loadWalletsFromDatabase()
    }

    // MARK: - 创建钱包

    /// 创建新的HD钱包
    /// - Parameters:
    ///   - password: 密码（至少8位）
    ///   - chainId: 链ID（默认以太坊主网）
    /// - Returns: 钱包创建结果（包含明文助记词供备份）
    func createWallet(password: String, chainId: Int = 1) async throws -> WalletCreationResult {
        // 验证密码
        guard password.count >= 8 else {
            throw WalletError.invalidPassword
        }

        // 1. 生成BIP39助记词（12个单词）
        let mnemonic = try generateMnemonic()

        // 2. 从助记词派生私钥
        let privateKey = try derivePrivateKey(from: mnemonic, path: derivationPath)

        // 3. 从私钥生成地址
        let address = try generateAddress(from: privateKey)

        // 4. 加密私钥和助记词
        let encryptedPrivateKey = try keychainStorage.encrypt(data: privateKey, password: password)
        let encryptedMnemonic = try keychainStorage.encrypt(data: mnemonic, password: password)

        // 5. 保存到数据库
        let walletId = UUID().uuidString
        let wallet = Wallet(
            id: walletId,
            address: address,
            walletType: .internal,
            provider: .builtin,
            derivationPath: derivationPath,
            chainId: chainId,
            isDefault: wallets.isEmpty,
            createdAt: Date()
        )

        try saveWalletToDatabase(wallet)

        // 6. 保存加密数据到Keychain
        let encryptedData = EncryptedWalletData(
            walletId: walletId,
            encryptedPrivateKey: encryptedPrivateKey.encrypted,
            encryptedMnemonic: encryptedMnemonic.encrypted,
            salt: encryptedPrivateKey.salt,
            iv: encryptedPrivateKey.iv
        )
        try keychainStorage.saveEncryptedWallet(encryptedData)

        // 7. 添加到内存列表
        await MainActor.run {
            wallets.append(wallet)
            if wallet.isDefault {
                currentWallet = wallet
            }
        }

        Logger.shared.info("创建钱包成功: \(address)")

        return WalletCreationResult(
            wallet: wallet,
            mnemonic: mnemonic,
            privateKey: privateKey
        )
    }

    /// 从助记词导入钱包
    func importFromMnemonic(
        mnemonic: String,
        password: String,
        chainId: Int = 1
    ) async throws -> WalletCreationResult {
        // 验证密码
        guard password.count >= 8 else {
            throw WalletError.invalidPassword
        }

        // 验证助记词
        guard try validateMnemonic(mnemonic) else {
            throw WalletError.invalidMnemonic
        }

        // 从助记词派生私钥和地址
        let privateKey = try derivePrivateKey(from: mnemonic, path: derivationPath)
        let address = try generateAddress(from: privateKey)

        // 检查钱包是否已存在
        if wallets.contains(where: { $0.address.lowercased() == address.lowercased() }) {
            throw WalletError.keychainError("钱包已存在")
        }

        // 加密并保存
        let encryptedPrivateKey = try keychainStorage.encrypt(data: privateKey, password: password)
        let encryptedMnemonic = try keychainStorage.encrypt(data: mnemonic, password: password)

        let walletId = UUID().uuidString
        let wallet = Wallet(
            id: walletId,
            address: address,
            walletType: .internal,
            provider: .builtin,
            derivationPath: derivationPath,
            chainId: chainId,
            isDefault: wallets.isEmpty,
            createdAt: Date()
        )

        try saveWalletToDatabase(wallet)

        let encryptedData = EncryptedWalletData(
            walletId: walletId,
            encryptedPrivateKey: encryptedPrivateKey.encrypted,
            encryptedMnemonic: encryptedMnemonic.encrypted,
            salt: encryptedPrivateKey.salt,
            iv: encryptedPrivateKey.iv
        )
        try keychainStorage.saveEncryptedWallet(encryptedData)

        await MainActor.run {
            wallets.append(wallet)
            if wallet.isDefault {
                currentWallet = wallet
            }
        }

        Logger.shared.info("导入钱包成功: \(address)")

        return WalletCreationResult(
            wallet: wallet,
            mnemonic: mnemonic,
            privateKey: privateKey
        )
    }

    /// 从私钥导入钱包
    func importFromPrivateKey(
        privateKey: String,
        password: String,
        chainId: Int = 1
    ) async throws -> Wallet {
        // 验证密码
        guard password.count >= 8 else {
            throw WalletError.invalidPassword
        }

        // 验证私钥格式
        guard try validatePrivateKey(privateKey) else {
            throw WalletError.invalidPrivateKey
        }

        // 从私钥生成地址
        let address = try generateAddress(from: privateKey)

        // 检查钱包是否已存在
        if wallets.contains(where: { $0.address.lowercased() == address.lowercased() }) {
            throw WalletError.keychainError("钱包已存在")
        }

        // 加密并保存
        let encryptedPrivateKey = try keychainStorage.encrypt(data: privateKey, password: password)

        let walletId = UUID().uuidString
        let wallet = Wallet(
            id: walletId,
            address: address,
            walletType: .internal,
            provider: .builtin,
            derivationPath: "",  // 私钥导入无派生路径
            chainId: chainId,
            isDefault: wallets.isEmpty,
            createdAt: Date()
        )

        try saveWalletToDatabase(wallet)

        let encryptedData = EncryptedWalletData(
            walletId: walletId,
            encryptedPrivateKey: encryptedPrivateKey.encrypted,
            encryptedMnemonic: nil,  // 私钥导入无助记词
            salt: encryptedPrivateKey.salt,
            iv: encryptedPrivateKey.iv
        )
        try keychainStorage.saveEncryptedWallet(encryptedData)

        await MainActor.run {
            wallets.append(wallet)
            if wallet.isDefault {
                currentWallet = wallet
            }
        }

        Logger.shared.info("从私钥导入钱包成功: \(address)")

        return wallet
    }

    // MARK: - 钱包操作

    /// 解锁钱包
    func unlockWallet(walletId: String, password: String) async throws -> String {
        // 从Keychain读取加密数据
        let encryptedData = try keychainStorage.loadEncryptedWallet(walletId: walletId)

        // 解密私钥
        let privateKey = try keychainStorage.decrypt(
            encrypted: encryptedData.encryptedPrivateKey,
            password: password,
            salt: encryptedData.salt,
            iv: encryptedData.iv
        )

        // 缓存到内存
        unlockedWallets[walletId] = privateKey

        Logger.shared.info("钱包已解锁: \(walletId)")

        return privateKey
    }

    /// 锁定钱包
    func lockWallet(walletId: String) {
        unlockedWallets.removeValue(forKey: walletId)
        Logger.shared.info("钱包已锁定: \(walletId)")
    }

    /// 获取已解锁的私钥
    /// - Parameter walletId: 钱包ID
    /// - Returns: 私钥（如果已解锁）
    func getUnlockedPrivateKey(walletId: String) -> String? {
        return unlockedWallets[walletId]
    }

    /// 导出私钥
    /// - Parameters:
    ///   - walletId: 钱包ID
    ///   - password: 密码
    /// - Returns: 私钥（十六进制字符串，带0x前缀）
    /// - Throws: 密码错误或钱包不存在
    ///
    /// 参考: PC端 wallet-manager.js:722-745
    func exportPrivateKey(walletId: String, password: String) async throws -> String {
        // 验证密码长度
        guard password.count >= 8 else {
            throw WalletError.invalidPassword
        }

        // 从Keychain读取加密数据
        let encryptedData = try keychainStorage.loadEncryptedWallet(walletId: walletId)

        // 解密私钥
        let privateKey = try keychainStorage.decrypt(
            encrypted: encryptedData.encryptedPrivateKey,
            password: password,
            salt: encryptedData.salt,
            iv: encryptedData.iv
        )

        Logger.shared.info("私钥导出成功: \(walletId)")

        // 确保返回带0x前缀的格式
        return privateKey.hasPrefix("0x") ? privateKey : "0x" + privateKey
    }

    /// 导出助记词
    /// - Parameters:
    ///   - walletId: 钱包ID
    ///   - password: 密码
    /// - Returns: 助记词（12个单词，空格分隔）
    /// - Throws: 密码错误、钱包不存在、或钱包无助记词（从私钥导入的钱包）
    ///
    /// 参考: PC端 wallet-manager.js:753-775
    func exportMnemonic(walletId: String, password: String) async throws -> String {
        // 验证密码长度
        guard password.count >= 8 else {
            throw WalletError.invalidPassword
        }

        // 从Keychain读取加密数据
        let encryptedData = try keychainStorage.loadEncryptedWallet(walletId: walletId)

        // 检查是否有助记词（从私钥导入的钱包没有助记词）
        guard let encryptedMnemonic = encryptedData.encryptedMnemonic else {
            throw WalletError.noMnemonic
        }

        // 解密助记词
        let mnemonic = try keychainStorage.decrypt(
            encrypted: encryptedMnemonic,
            password: password,
            salt: encryptedData.salt,
            iv: encryptedData.iv
        )

        Logger.shared.info("助记词导出成功: \(walletId)")

        return mnemonic
    }

    /// 删除钱包
    func deleteWallet(_ wallet: Wallet) async throws {
        // 从Keychain删除
        try keychainStorage.deleteWallet(walletId: wallet.id)

        // 从数据库删除
        try deleteWalletFromDatabase(wallet.id)

        // 从内存删除
        await MainActor.run {
            wallets.removeAll { $0.id == wallet.id }
            unlockedWallets.removeValue(forKey: wallet.id)

            if currentWallet?.id == wallet.id {
                currentWallet = wallets.first
            }
        }

        Logger.shared.info("钱包已删除: \(wallet.address)")
    }

    /// 设置默认钱包
    func setDefaultWallet(_ wallet: Wallet) async throws {
        // 更新所有钱包的isDefault状态
        for var w in wallets {
            w.isDefault = (w.id == wallet.id)
            try updateWalletInDatabase(w)
        }

        await MainActor.run {
            // 重新加载
            loadWalletsFromDatabase()
            currentWallet = wallet
        }

        Logger.shared.info("设置默认钱包: \(wallet.address)")
    }

    // MARK: - 私有方法（需要集成WalletCore/web3.swift）

    /// 生成BIP39助记词
    private func generateMnemonic() throws -> String {
        return try WalletCoreAdapter.generateMnemonic(strength: 128)
    }

    /// 验证助记词
    private func validateMnemonic(_ mnemonic: String) throws -> Bool {
        return WalletCoreAdapter.validateMnemonic(mnemonic)
    }

    /// 验证私钥
    private func validatePrivateKey(_ privateKey: String) throws -> Bool {
        // 验证是否为64个十六进制字符（不含0x）或66个（含0x）
        let cleanKey = privateKey.hasPrefix("0x") ? String(privateKey.dropFirst(2)) : privateKey
        return cleanKey.count == 64 && cleanKey.allSatisfy { $0.isHexDigit }
    }

    /// 从助记词派生私钥
    private func derivePrivateKey(from mnemonic: String, path: String) throws -> String {
        return try WalletCoreAdapter.derivePrivateKey(from: mnemonic, path: path)
    }

    /// 从私钥生成地址
    private func generateAddress(from privateKey: String) throws -> String {
        return try WalletCoreAdapter.generateAddress(from: privateKey)
    }

    // MARK: - 数据库操作

    private func loadWalletsFromDatabase() {
        do {
            let db = databaseManager.db
            let rows = try db.prepare("SELECT * FROM blockchain_wallets ORDER BY created_at DESC")

            var loadedWallets: [Wallet] = []
            for row in rows {
                if let wallet = parseWalletRow(row) {
                    loadedWallets.append(wallet)
                }
            }

            wallets = loadedWallets
            currentWallet = wallets.first { $0.isDefault } ?? wallets.first

            Logger.shared.info("从数据库加载 \(wallets.count) 个钱包")
        } catch {
            Logger.shared.error("加载钱包失败: \(error)")
        }
    }

    private func saveWalletToDatabase(_ wallet: Wallet) throws {
        let db = databaseManager.db
        let sql = """
            INSERT INTO blockchain_wallets
            (id, address, wallet_type, provider, derivation_path, chain_id, is_default, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """

        try db.execute(
            sql,
            wallet.id,
            wallet.address,
            wallet.walletType.rawValue,
            wallet.provider.rawValue,
            wallet.derivationPath,
            wallet.chainId,
            wallet.isDefault ? 1 : 0,
            Int(wallet.createdAt.timeIntervalSince1970 * 1000)
        )
    }

    private func updateWalletInDatabase(_ wallet: Wallet) throws {
        let db = databaseManager.db
        let sql = "UPDATE blockchain_wallets SET is_default = ? WHERE id = ?"
        try db.execute(sql, wallet.isDefault ? 1 : 0, wallet.id)
    }

    private func deleteWalletFromDatabase(_ walletId: String) throws {
        let db = databaseManager.db
        try db.execute("DELETE FROM blockchain_wallets WHERE id = ?", walletId)
    }

    private func parseWalletRow(_ row: [String: Any]) -> Wallet? {
        guard let id = row["id"] as? String,
              let address = row["address"] as? String,
              let walletTypeStr = row["wallet_type"] as? String,
              let providerStr = row["provider"] as? String,
              let derivationPath = row["derivation_path"] as? String,
              let chainId = row["chain_id"] as? Int,
              let isDefault = row["is_default"] as? Int,
              let createdAtMs = row["created_at"] as? Int,
              let walletType = WalletType(rawValue: walletTypeStr),
              let provider = WalletProvider(rawValue: providerStr) else {
            return nil
        }

        return Wallet(
            id: id,
            address: address,
            walletType: walletType,
            provider: provider,
            derivationPath: derivationPath,
            chainId: chainId,
            isDefault: isDefault == 1,
            createdAt: Date(timeIntervalSince1970: Double(createdAtMs) / 1000)
        )
    }
}
