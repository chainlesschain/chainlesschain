# iOS端区块链与交易系统实施计划

**文档版本**: 1.0
**创建日期**: 2026-01-26
**目标**: 参考PC端v0.26.2实现iOS端完整的区块链与交易系统
**总工期**: 6-8周
**PC端参考**: `desktop-app-vue/src/main/blockchain/` + `desktop-app-vue/src/main/trade/`

---

## 📊 实施概览

### Phase划分

| Phase         | 功能模块       | 工期  | 依赖         |
| ------------- | -------------- | ----- | ------------ |
| **Phase 1.1** | 基础钱包功能   | 2周   | WalletCore库 |
| **Phase 1.2** | 区块链网络集成 | 2周   | Phase 1.1    |
| **Phase 1.3** | 智能合约集成   | 2周   | Phase 1.2    |
| **Phase 1.4** | 交易系统       | 2-3周 | Phase 1.3    |

### PC端架构分析总结

**核心模块 (PC端)**:

```
blockchain/
├── wallet-manager.js          ✅ HD钱包、BIP39/44、AES-256-GCM加密
├── blockchain-adapter.js      ✅ 14条链、智能合约部署、Gas优化
├── blockchain-config.js       ✅ 网络配置、RPC端点、Gas配置
├── transaction-monitor.js     ✅ 交易监控、状态追踪、自动恢复
├── rpc-manager.js            ✅ 负载均衡、健康检查、故障转移
├── contract-artifacts.js      ✅ 合约ABI管理
└── bridge-manager.js         ✅ LayerZero跨链桥

trade/
├── marketplace-manager.js     ✅ 订单系统、全文搜索(FTS5)
├── escrow-manager.js         ✅ 托管系统、状态机、资金流转
├── asset-manager.js          ✅ 数字资产管理
├── contract-engine.js        ✅ 智能合约引擎、条件系统、自动执行
├── credit-score.js          ✅ 信用评分、多因素权重、事件触发
└── review-manager.js        ✅ 评价管理
```

**技术亮点 (PC端)**:

1. **HD钱包**: BIP39助记词 + BIP44派生路径 (`m/44'/60'/0'/0/0`)
2. **加密存储**: AES-256-GCM + PBKDF2 (100,000次迭代)
3. **多链支持**: 14条区块链网络 (以太坊、Polygon、BSC、Arbitrum等)
4. **智能合约**: 支持ERC-20、ERC-721、托管、订阅、悬赏合约
5. **Gas优化**: L2特殊处理、动态调整、交易重试
6. **RPC容错**: 多节点负载均衡、健康检查(60秒)、自动故障转移
7. **托管系统**: 简单/多签/时间锁/条件托管
8. **信用评分**: 6维度评分 (完成率30%、交易量20%、好评率25%等)
9. **全文搜索**: FTS5虚拟表 + 自动触发器
10. **硬件签名**: U-Key支持 (Windows)

---

## 🎯 Phase 1.1: 基础钱包功能 (2周)

### 目标

实现HD钱包管理、加密存储、签名机制,对齐PC端`wallet-manager.js`核心功能。

### 技术选型

| 组件     | PC端技术             | iOS端技术             | 说明                    |
| -------- | -------------------- | --------------------- | ----------------------- |
| 助记词   | bip39                | TrustWalletCore       | Trust Wallet的Swift SDK |
| HD派生   | hdkey                | TrustWalletCore       | BIP44标准派生           |
| 加密     | crypto (AES-256-GCM) | CryptoSwift           | AES加密库               |
| 以太坊   | ethers.js            | web3.swift/WalletCore | 以太坊交互              |
| 安全存储 | 文件加密             | Keychain              | iOS安全存储             |

### 1.1.1 文件结构

```swift
ios-app/ChainlessChain/Features/Blockchain/
├── Models/
│   ├── Wallet.swift              // 钱包模型
│   ├── WalletType.swift          // 钱包类型枚举
│   ├── NetworkConfig.swift       // 网络配置
│   └── Transaction.swift         // 交易模型
├── Services/
│   ├── WalletManager.swift       // 钱包管理器 (核心)
│   ├── KeychainWalletStorage.swift // Keychain存储
│   ├── WalletCrypto.swift        // 加密工具
│   └── BiometricSigner.swift     // 生物识别签名
├── ViewModels/
│   ├── WalletViewModel.swift     // 钱包列表ViewModel
│   └── CreateWalletViewModel.swift // 创建钱包ViewModel
└── Views/
    ├── WalletListView.swift      // 钱包列表
    ├── WalletDetailView.swift    // 钱包详情
    ├── CreateWalletView.swift    // 创建钱包
    └── ImportWalletView.swift    // 导入钱包
```

### 1.1.2 核心实现 (对照PC端)

#### A. 钱包模型 (Wallet.swift)

```swift
import Foundation
import TrustWalletCore

/// 钱包类型 (对应PC端 WalletType)
enum WalletType: String, Codable {
    case internal   // 内置钱包
    case external   // 外部钱包
}

/// 钱包提供者 (对应PC端 WalletProvider)
enum WalletProvider: String, Codable {
    case builtin        // 内置
    case walletConnect  // WalletConnect
}

/// 钱包模型
struct Wallet: Identifiable, Codable {
    let id: String                  // UUID
    let address: String             // 以太坊地址
    let walletType: WalletType      // 钱包类型
    let provider: WalletProvider    // 提供者
    var encryptedPrivateKey: String? // 加密后的私钥
    var mnemonicEncrypted: String?   // 加密后的助记词
    let derivationPath: String      // BIP44派生路径
    let chainId: Int                // 链ID
    var isDefault: Bool             // 是否为默认钱包
    let createdAt: Date             // 创建时间

    /// 显示名称
    var displayName: String {
        return "钱包 \(address.prefix(6))...\(address.suffix(4))"
    }
}
```

**PC端对应代码** (`wallet-manager.js:24-36`):

```javascript
const WalletType = {
  INTERNAL: "internal",
  EXTERNAL: "external",
};
const WalletProvider = {
  BUILTIN: "builtin",
  METAMASK: "metamask",
  WALLETCONNECT: "walletconnect",
};
```

#### B. 钱包管理器 (WalletManager.swift)

```swift
import Foundation
import TrustWalletCore
import Combine

/// 钱包管理器 (对应PC端 WalletManager类)
class WalletManager: ObservableObject {

    // MARK: - Properties

    private let database: DatabaseManager
    private let keychainStorage: KeychainWalletStorage
    private let crypto: WalletCrypto

    /// 缓存解锁的钱包 (对应PC端 unlockedWallets Map)
    private var unlockedWallets: [String: HDWallet] = [:]

    /// HD钱包派生路径 (对应PC端 derivationPath)
    /// BIP44标准: m/44'/60'/0'/0/0 (以太坊)
    private let derivationPath = "m/44'/60'/0'/0/0"

    @Published var wallets: [Wallet] = []
    @Published var isInitialized = false

    // MARK: - Initialization

    init(database: DatabaseManager) {
        self.database = database
        self.keychainStorage = KeychainWalletStorage()
        self.crypto = WalletCrypto()
    }

    /// 初始化钱包管理器 (对应PC端 initialize方法)
    func initialize() async throws {
        Logger.info("[WalletManager] 初始化钱包管理器...")

        // 初始化数据库表
        try await initializeTables()

        // 加载所有钱包
        try await loadAllWallets()

        isInitialized = true
        Logger.info("[WalletManager] 钱包管理器初始化成功")
    }

    // MARK: - 创建钱包 (对应PC端 createWallet方法)

    /// 生成新钱包 (HD钱包)
    /// - Parameters:
    ///   - password: 密码(用于加密私钥,最少8位)
    ///   - chainId: 链ID (默认以太坊主网=1)
    /// - Returns: 钱包信息 (包含明文助记词供用户备份)
    func createWallet(password: String, chainId: Int = 1) async throws -> (wallet: Wallet, mnemonic: String) {
        // 参考PC端: wallet-manager.js:105-172

        // 1. 验证密码
        guard password.count >= 8 else {
            throw WalletError.passwordTooShort
        }

        // 2. 生成BIP39助记词 (12个单词)
        guard let hdWallet = HDWallet(strength: 128, passphrase: "") else {
            throw WalletError.walletCreationFailed
        }

        let mnemonic = hdWallet.mnemonic

        // 3. 从助记词派生私钥 (BIP44)
        let privateKey = hdWallet.getKey(coin: .ethereum, derivationPath: derivationPath)
        let privateKeyData = privateKey.data
        let address = CoinType.ethereum.deriveAddress(privateKey: privateKey)

        // 4. 加密私钥和助记词 (AES-256-GCM)
        let encryptedPrivateKey = try crypto.encrypt(
            data: privateKeyData.hexString,
            password: password
        )
        let encryptedMnemonic = try crypto.encrypt(
            data: mnemonic,
            password: password
        )

        // 5. 保存到数据库
        let walletId = UUID().uuidString
        let isDefault = try await getAllWallets().isEmpty

        let wallet = Wallet(
            id: walletId,
            address: address,
            walletType: .internal,
            provider: .builtin,
            encryptedPrivateKey: encryptedPrivateKey,
            mnemonicEncrypted: encryptedMnemonic,
            derivationPath: derivationPath,
            chainId: chainId,
            isDefault: isDefault,
            createdAt: Date()
        )

        try await database.run { db in
            try db.execute("""
                INSERT INTO blockchain_wallets (
                    id, address, wallet_type, provider, encrypted_private_key,
                    mnemonic_encrypted, derivation_path, chain_id, is_default, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, parameters: [
                walletId, address, WalletType.internal.rawValue,
                WalletProvider.builtin.rawValue, encryptedPrivateKey,
                encryptedMnemonic, derivationPath, chainId,
                isDefault ? 1 : 0, Int(wallet.createdAt.timeIntervalSince1970 * 1000)
            ])
        }

        await MainActor.run {
            self.wallets.append(wallet)
        }

        Logger.info("[WalletManager] 创建钱包成功: \(address)")

        // 返回钱包和明文助记词
        return (wallet, mnemonic)
    }

    // MARK: - 导入钱包

    /// 从助记词导入钱包 (对应PC端 importFromMnemonic)
    /// 参考: wallet-manager.js:180-254
    func importFromMnemonic(
        mnemonic: String,
        password: String,
        chainId: Int = 1
    ) async throws -> Wallet {

        guard password.count >= 8 else {
            throw WalletError.passwordTooShort
        }

        // 验证助记词
        guard Mnemonic.isValid(mnemonic: mnemonic) else {
            throw WalletError.invalidMnemonic
        }

        // 从助记词派生私钥
        guard let hdWallet = HDWallet(mnemonic: mnemonic, passphrase: "") else {
            throw WalletError.invalidMnemonic
        }

        let privateKey = hdWallet.getKey(coin: .ethereum, derivationPath: derivationPath)
        let address = CoinType.ethereum.deriveAddress(privateKey: privateKey)

        // 检查是否已存在
        if try await getWalletByAddress(address) != nil {
            throw WalletError.walletAlreadyExists
        }

        // 加密私钥和助记词
        let encryptedPrivateKey = try crypto.encrypt(
            data: privateKey.data.hexString,
            password: password
        )
        let encryptedMnemonic = try crypto.encrypt(
            data: mnemonic,
            password: password
        )

        // 保存到数据库
        let walletId = UUID().uuidString
        let isDefault = try await getAllWallets().isEmpty

        let wallet = Wallet(
            id: walletId,
            address: address,
            walletType: .internal,
            provider: .builtin,
            encryptedPrivateKey: encryptedPrivateKey,
            mnemonicEncrypted: encryptedMnemonic,
            derivationPath: derivationPath,
            chainId: chainId,
            isDefault: isDefault,
            createdAt: Date()
        )

        try await database.run { db in
            try db.execute("""
                INSERT INTO blockchain_wallets (
                    id, address, wallet_type, provider, encrypted_private_key,
                    mnemonic_encrypted, derivation_path, chain_id, is_default, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, parameters: [
                walletId, address, WalletType.internal.rawValue,
                WalletProvider.builtin.rawValue, encryptedPrivateKey,
                encryptedMnemonic, derivationPath, chainId,
                isDefault ? 1 : 0, Int(wallet.createdAt.timeIntervalSince1970 * 1000)
            ])
        }

        await MainActor.run {
            self.wallets.append(wallet)
        }

        Logger.info("[WalletManager] 导入钱包成功: \(address)")

        return wallet
    }

    /// 从私钥导入钱包 (对应PC端 importFromPrivateKey)
    /// 参考: wallet-manager.js:263-334
    func importFromPrivateKey(
        privateKey: String,
        password: String,
        chainId: Int = 1
    ) async throws -> Wallet {

        guard password.count >= 8 else {
            throw WalletError.passwordTooShort
        }

        // 移除0x前缀
        let normalizedKey = privateKey.hasPrefix("0x") ?
            String(privateKey.dropFirst(2)) : privateKey

        // 验证私钥
        guard let privateKeyData = Data(hexString: normalizedKey),
              let privKey = PrivateKey(data: privateKeyData) else {
            throw WalletError.invalidPrivateKey
        }

        let address = CoinType.ethereum.deriveAddress(privateKey: privKey)

        // 检查是否已存在
        if try await getWalletByAddress(address) != nil {
            throw WalletError.walletAlreadyExists
        }

        // 加密私钥 (没有助记词)
        let encryptedPrivateKey = try crypto.encrypt(
            data: normalizedKey,
            password: password
        )

        // 保存到数据库
        let walletId = UUID().uuidString
        let isDefault = try await getAllWallets().isEmpty

        let wallet = Wallet(
            id: walletId,
            address: address,
            walletType: .internal,
            provider: .builtin,
            encryptedPrivateKey: encryptedPrivateKey,
            mnemonicEncrypted: nil, // 私钥导入无助记词
            derivationPath: derivationPath,
            chainId: chainId,
            isDefault: isDefault,
            createdAt: Date()
        )

        try await database.run { db in
            try db.execute("""
                INSERT INTO blockchain_wallets (
                    id, address, wallet_type, provider, encrypted_private_key,
                    derivation_path, chain_id, is_default, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, parameters: [
                walletId, address, WalletType.internal.rawValue,
                WalletProvider.builtin.rawValue, encryptedPrivateKey,
                derivationPath, chainId, isDefault ? 1 : 0,
                Int(wallet.createdAt.timeIntervalSince1970 * 1000)
            ])
        }

        await MainActor.run {
            self.wallets.append(wallet)
        }

        Logger.info("[WalletManager] 从私钥导入成功: \(address)")

        return wallet
    }

    // MARK: - 解锁/锁定钱包

    /// 解锁钱包 (对应PC端 unlockWallet方法)
    /// 参考: wallet-manager.js:342-385
    func unlockWallet(walletId: String, password: String) async throws -> HDWallet {

        // 检查是否已解锁
        if let cached = unlockedWallets[walletId] {
            return cached
        }

        // 从数据库读取钱包
        guard let wallet = try await getWallet(walletId) else {
            throw WalletError.walletNotFound
        }

        guard wallet.walletType == .internal else {
            throw WalletError.cannotUnlockExternalWallet
        }

        // 优先使用助记词解锁 (更安全)
        let hdWallet: HDWallet

        if let encryptedMnemonic = wallet.mnemonicEncrypted {
            // 解密助记词
            let mnemonic = try crypto.decrypt(
                encryptedData: encryptedMnemonic,
                password: password
            )

            guard let wallet = HDWallet(mnemonic: mnemonic, passphrase: "") else {
                throw WalletError.decryptionFailed
            }
            hdWallet = wallet

        } else if let encryptedPrivateKey = wallet.encryptedPrivateKey {
            // 解密私钥
            let privateKeyHex = try crypto.decrypt(
                encryptedData: encryptedPrivateKey,
                password: password
            )

            guard let privateKeyData = Data(hexString: privateKeyHex),
                  let privateKey = PrivateKey(data: privateKeyData) else {
                throw WalletError.decryptionFailed
            }

            // 从私钥创建HDWallet (无助记词)
            // 注意: TrustWalletCore不支持直接从私钥创建HDWallet
            // 这里需要特殊处理或使用其他方式
            throw WalletError.privateKeyWalletNotSupported

        } else {
            throw WalletError.noEncryptedData
        }

        // 验证地址是否匹配
        let derivedAddress = hdWallet.getKey(coin: .ethereum, derivationPath: derivationPath)
        let address = CoinType.ethereum.deriveAddress(privateKey: derivedAddress)

        guard address.lowercased() == wallet.address.lowercased() else {
            throw WalletError.addressMismatch
        }

        // 缓存钱包
        unlockedWallets[walletId] = hdWallet

        Logger.info("[WalletManager] 解锁钱包成功: \(wallet.address)")

        return hdWallet
    }

    /// 锁定钱包 (对应PC端 lockWallet)
    /// 参考: wallet-manager.js:391-395
    func lockWallet(walletId: String) {
        unlockedWallets.removeValue(forKey: walletId)
        Logger.info("[WalletManager] 锁定钱包: \(walletId)")
    }

    // MARK: - 签名 (对应PC端 signTransaction/signMessage)

    /// 签名交易 (对应PC端 signTransaction方法)
    /// 参考: wallet-manager.js:404-429
    func signTransaction(
        walletId: String,
        transaction: EthereumTransaction,
        useBiometric: Bool = false
    ) async throws -> Data {

        if useBiometric {
            // 使用Face ID/Touch ID签名
            return try await signWithBiometric(walletId: walletId, transaction: transaction)
        } else {
            // 使用软件钱包签名
            guard let hdWallet = unlockedWallets[walletId] else {
                throw WalletError.walletLocked
            }

            let privateKey = hdWallet.getKey(coin: .ethereum, derivationPath: derivationPath)

            // 使用TrustWalletCore签名
            let signedTx = try AnySigner.sign(
                input: transaction,
                coin: .ethereum,
                privateKey: privateKey.data
            )

            return signedTx
        }
    }

    /// 签名消息 (对应PC端 signMessage方法)
    /// 参考: wallet-manager.js:438-456
    func signMessage(
        walletId: String,
        message: String,
        useBiometric: Bool = false
    ) async throws -> Data {

        if useBiometric {
            // 使用Face ID/Touch ID签名
            return try await signMessageWithBiometric(walletId: walletId, message: message)
        } else {
            // 使用软件钱包签名
            guard let hdWallet = unlockedWallets[walletId] else {
                throw WalletError.walletLocked
            }

            let privateKey = hdWallet.getKey(coin: .ethereum, derivationPath: derivationPath)

            // EIP-191签名
            let messageData = message.data(using: .utf8)!
            let signature = privateKey.sign(digest: messageData, curve: .secp256k1)!

            return signature
        }
    }

    // MARK: - 余额查询 (对应PC端 getBalance)

    /// 获取余额
    /// - Parameters:
    ///   - address: 地址
    ///   - chainId: 链ID
    ///   - tokenAddress: 代币合约地址 (nil表示原生币)
    /// - Returns: 余额字符串
    /// 参考: wallet-manager.js:611-643
    func getBalance(
        address: String,
        chainId: Int,
        tokenAddress: String? = nil
    ) async throws -> String {

        // 这个方法需要BlockchainAdapter支持
        // 将在Phase 1.2实现
        throw WalletError.notImplemented
    }

    // MARK: - 查询方法

    /// 获取所有钱包 (对应PC端 getAllWallets)
    /// 参考: wallet-manager.js:649-657
    func getAllWallets() async throws -> [Wallet] {
        return try await database.fetch { db in
            try db.query("""
                SELECT * FROM blockchain_wallets
                ORDER BY is_default DESC, created_at DESC
            """).compactMap { row in
                try? self.walletFromRow(row)
            }
        }
    }

    /// 获取钱包详情 (对应PC端 getWallet)
    /// 参考: wallet-manager.js:664-668
    func getWallet(_ walletId: String) async throws -> Wallet? {
        return try await database.fetch { db in
            try db.query("""
                SELECT * FROM blockchain_wallets WHERE id = ?
            """, parameters: [walletId]).first.flatMap { row in
                try? self.walletFromRow(row)
            }
        }
    }

    /// 根据地址获取钱包 (对应PC端 getWalletByAddress)
    /// 参考: wallet-manager.js:675-679
    func getWalletByAddress(_ address: String) async throws -> Wallet? {
        return try await database.fetch { db in
            try db.query("""
                SELECT * FROM blockchain_wallets
                WHERE LOWER(address) = LOWER(?)
            """, parameters: [address]).first.flatMap { row in
                try? self.walletFromRow(row)
            }
        }
    }

    // MARK: - 管理方法

    /// 设置默认钱包 (对应PC端 setDefaultWallet)
    /// 参考: wallet-manager.js:685-698
    func setDefaultWallet(walletId: String) async throws {
        try await database.run { db in
            // 取消所有默认钱包
            try db.execute("UPDATE blockchain_wallets SET is_default = 0")

            // 设置新的默认钱包
            try db.execute(
                "UPDATE blockchain_wallets SET is_default = 1 WHERE id = ?",
                parameters: [walletId]
            )
        }

        // 刷新列表
        try await loadAllWallets()

        Logger.info("[WalletManager] 设置默认钱包: \(walletId)")
    }

    /// 删除钱包 (对应PC端 deleteWallet)
    /// 参考: wallet-manager.js:704-715
    func deleteWallet(walletId: String) async throws {
        // 先锁定钱包
        lockWallet(walletId: walletId)

        // 从数据库删除
        try await database.run { db in
            try db.execute(
                "DELETE FROM blockchain_wallets WHERE id = ?",
                parameters: [walletId]
            )
        }

        // 刷新列表
        try await loadAllWallets()

        Logger.info("[WalletManager] 删除钱包: \(walletId)")
    }

    /// 导出私钥 (对应PC端 exportPrivateKey)
    /// 参考: wallet-manager.js:722-745
    func exportPrivateKey(walletId: String, password: String) async throws -> String {
        guard let wallet = try await getWallet(walletId) else {
            throw WalletError.walletNotFound
        }

        guard wallet.walletType == .internal else {
            throw WalletError.cannotExportExternalWallet
        }

        guard let encryptedPrivateKey = wallet.encryptedPrivateKey else {
            throw WalletError.noEncryptedData
        }

        // 解密私钥
        let privateKey = try crypto.decrypt(
            encryptedData: encryptedPrivateKey,
            password: password
        )

        return "0x" + privateKey
    }

    /// 导出助记词 (对应PC端 exportMnemonic)
    /// 参考: wallet-manager.js:753-775
    func exportMnemonic(walletId: String, password: String) async throws -> String {
        guard let wallet = try await getWallet(walletId) else {
            throw WalletError.walletNotFound
        }

        guard let encryptedMnemonic = wallet.mnemonicEncrypted else {
            throw WalletError.noMnemonic
        }

        // 解密助记词
        let mnemonic = try crypto.decrypt(
            encryptedData: encryptedMnemonic,
            password: password
        )

        return mnemonic
    }

    // MARK: - Private Methods

    private func initializeTables() async throws {
        // 表已在database.js中创建
        // 这里只做验证
        _ = try await database.fetch { db in
            try db.query("SELECT 1 FROM blockchain_wallets LIMIT 1")
        }
    }

    private func loadAllWallets() async throws {
        let fetchedWallets = try await getAllWallets()
        await MainActor.run {
            self.wallets = fetchedWallets
        }
    }

    private func walletFromRow(_ row: [String: Any]) throws -> Wallet {
        // 从数据库行构造Wallet对象
        // 实现省略...
        fatalError("Not implemented")
    }

    // 生物识别签名方法 (待实现)
    private func signWithBiometric(walletId: String, transaction: EthereumTransaction) async throws -> Data {
        // 将在BiometricSigner中实现
        throw WalletError.notImplemented
    }

    private func signMessageWithBiometric(walletId: String, message: String) async throws -> Data {
        // 将在BiometricSigner中实现
        throw WalletError.notImplemented
    }
}

// MARK: - 错误类型

enum WalletError: LocalizedError {
    case passwordTooShort
    case walletCreationFailed
    case invalidMnemonic
    case invalidPrivateKey
    case walletAlreadyExists
    case walletNotFound
    case cannotUnlockExternalWallet
    case decryptionFailed
    case privateKeyWalletNotSupported
    case noEncryptedData
    case addressMismatch
    case walletLocked
    case cannotExportExternalWallet
    case noMnemonic
    case notImplemented

    var errorDescription: String? {
        switch self {
        case .passwordTooShort:
            return "密码长度不能少于8位"
        case .walletCreationFailed:
            return "钱包创建失败"
        case .invalidMnemonic:
            return "无效的助记词"
        case .invalidPrivateKey:
            return "无效的私钥"
        case .walletAlreadyExists:
            return "该钱包已存在"
        case .walletNotFound:
            return "钱包不存在"
        case .cannotUnlockExternalWallet:
            return "只能解锁内置钱包"
        case .decryptionFailed:
            return "解密失败(密码可能错误)"
        case .privateKeyWalletNotSupported:
            return "暂不支持私钥钱包解锁"
        case .noEncryptedData:
            return "没有加密数据"
        case .addressMismatch:
            return "地址不匹配"
        case .walletLocked:
            return "钱包未解锁,请先解锁钱包"
        case .cannotExportExternalWallet:
            return "只能导出内置钱包"
        case .noMnemonic:
            return "该钱包没有助记词(可能是从私钥导入的)"
        case .notImplemented:
            return "功能尚未实现"
        }
    }
}
```

**PC端对应代码** (`wallet-manager.js:50-884`): 完整的WalletManager类实现

#### C. 加密工具 (WalletCrypto.swift)

```swift
import Foundation
import CryptoSwift

/// 加密工具 (对应PC端 _encryptData/_decryptData方法)
/// 参考: wallet-manager.js:783-872
class WalletCrypto {

    // MARK: - 加密配置 (对应PC端 ENCRYPTION_CONFIG)

    private struct EncryptionConfig {
        static let algorithm = "aes-256-gcm"
        static let keyLength = 32      // 256 bits
        static let ivLength = 16       // 128 bits
        static let saltLength = 64     // 512 bits
        static let tagLength = 16      // 128 bits (GCM auth tag)
        static let iterations = 100000 // PBKDF2迭代次数
    }

    // MARK: - 加密方法

    /// 加密数据 (AES-256-GCM)
    /// - Parameters:
    ///   - data: 原始数据
    ///   - password: 密码
    /// - Returns: 加密后的数据 (Base64编码)
    /// 参考: wallet-manager.js:783-823
    func encrypt(data: String, password: String) throws -> String {
        // 1. 生成盐值 (64字节随机数)
        let salt = AES.randomIV(EncryptionConfig.saltLength)

        // 2. 从密码派生密钥 (PBKDF2, 100,000次迭代, SHA256)
        let key = try PKCS5.PBKDF2(
            password: Array(password.utf8),
            salt: salt,
            iterations: EncryptionConfig.iterations,
            keyLength: EncryptionConfig.keyLength,
            variant: .sha2(.sha256)
        ).calculate()

        // 3. 生成初始化向量 (16字节随机数)
        let iv = AES.randomIV(EncryptionConfig.ivLength)

        // 4. AES-256-GCM加密
        let aes = try AES(key: key, blockMode: GCM(iv: iv, mode: .combined), padding: .noPadding)
        let encrypted = try aes.encrypt(Array(data.utf8))

        // 5. 提取认证标签 (GCM最后16字节)
        let ciphertextLength = encrypted.count - EncryptionConfig.tagLength
        let ciphertext = Array(encrypted[0..<ciphertextLength])
        let tag = Array(encrypted[ciphertextLength..<encrypted.count])

        // 6. 组合: salt(64) + iv(16) + tag(16) + ciphertext
        let combined = salt + iv + tag + ciphertext

        // 7. Base64编码
        return Data(combined).base64EncodedString()
    }

    /// 解密数据
    /// - Parameters:
    ///   - encryptedData: 加密数据 (Base64编码)
    ///   - password: 密码
    /// - Returns: 解密后的明文
    /// 参考: wallet-manager.js:831-872
    func decrypt(encryptedData: String, password: String) throws -> String {
        // 1. Base64解码
        guard let combined = Data(base64Encoded: encryptedData) else {
            throw CryptoError.invalidBase64
        }

        let combinedBytes = Array(combined)

        // 2. 提取各部分
        let salt = Array(combinedBytes[0..<EncryptionConfig.saltLength])

        let ivStart = EncryptionConfig.saltLength
        let ivEnd = ivStart + EncryptionConfig.ivLength
        let iv = Array(combinedBytes[ivStart..<ivEnd])

        let tagStart = ivEnd
        let tagEnd = tagStart + EncryptionConfig.tagLength
        let tag = Array(combinedBytes[tagStart..<tagEnd])

        let ciphertext = Array(combinedBytes[tagEnd..<combinedBytes.count])

        // 3. 从密码派生密钥 (使用相同的盐和迭代次数)
        let key = try PKCS5.PBKDF2(
            password: Array(password.utf8),
            salt: salt,
            iterations: EncryptionConfig.iterations,
            keyLength: EncryptionConfig.keyLength,
            variant: .sha2(.sha256)
        ).calculate()

        // 4. AES-256-GCM解密
        let aes = try AES(key: key, blockMode: GCM(iv: iv, mode: .combined), padding: .noPadding)

        // 组合密文和标签
        let encryptedWithTag = ciphertext + tag

        let decrypted = try aes.decrypt(encryptedWithTag)

        // 5. 转换为字符串
        guard let plaintext = String(bytes: decrypted, encoding: .utf8) else {
            throw CryptoError.invalidUTF8
        }

        return plaintext
    }
}

// MARK: - 错误类型

enum CryptoError: LocalizedError {
    case invalidBase64
    case invalidUTF8
    case encryptionFailed
    case decryptionFailed

    var errorDescription: String? {
        switch self {
        case .invalidBase64:
            return "无效的Base64编码"
        case .invalidUTF8:
            return "无效的UTF-8编码"
        case .encryptionFailed:
            return "加密失败"
        case .decryptionFailed:
            return "解密失败(密码可能错误)"
        }
    }
}

// MARK: - Data扩展 (Hex转换)

extension Data {
    var hexString: String {
        return self.map { String(format: "%02x", $0) }.joined()
    }

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
```

**PC端对应代码** (`wallet-manager.js:40-48, 783-872`):

- 加密配置: 第40-48行
- 加密方法: 第783-823行
- 解密方法: 第831-872行

#### D. Keychain存储 (KeychainWalletStorage.swift)

```swift
import Foundation
import Security

/// Keychain钱包存储 (iOS安全存储替代PC端的文件加密存储)
class KeychainWalletStorage {

    private let service = "com.chainlesschain.wallet"

    // MARK: - Save

    /// 保存加密数据到Keychain
    func save(key: String, data: String) throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecValueData as String: data.data(using: .utf8)!
        ]

        // 先删除旧值
        SecItemDelete(query as CFDictionary)

        // 保存新值
        let status = SecItemAdd(query as CFDictionary, nil)

        guard status == errSecSuccess else {
            throw KeychainError.saveFailed(status)
        }
    }

    // MARK: - Load

    /// 从Keychain加载数据
    func load(key: String) throws -> String {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true
        ]

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        guard status == errSecSuccess else {
            throw KeychainError.loadFailed(status)
        }

        guard let data = result as? Data,
              let string = String(data: data, encoding: .utf8) else {
            throw KeychainError.invalidData
        }

        return string
    }

    // MARK: - Delete

    /// 从Keychain删除数据
    func delete(key: String) throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key
        ]

        let status = SecItemDelete(query as CFDictionary)

        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainError.deleteFailed(status)
        }
    }
}

// MARK: - 错误类型

enum KeychainError: LocalizedError {
    case saveFailed(OSStatus)
    case loadFailed(OSStatus)
    case deleteFailed(OSStatus)
    case invalidData

    var errorDescription: String? {
        switch self {
        case .saveFailed(let status):
            return "Keychain保存失败: \(status)"
        case .loadFailed(let status):
            return "Keychain加载失败: \(status)"
        case .deleteFailed(let status):
            return "Keychain删除失败: \(status)"
        case .invalidData:
            return "无效的Keychain数据"
        }
    }
}
```

### 1.1.3 数据库Schema

参考PC端`database.js:blockchain_wallets`表定义:

```sql
CREATE TABLE IF NOT EXISTS blockchain_wallets (
    id TEXT PRIMARY KEY,                    -- UUID
    address TEXT NOT NULL UNIQUE,           -- 以太坊地址
    wallet_type TEXT NOT NULL,              -- 'internal' | 'external'
    provider TEXT NOT NULL,                 -- 'builtin' | 'walletconnect'
    encrypted_private_key TEXT,             -- 加密后的私钥 (Base64)
    mnemonic_encrypted TEXT,                -- 加密后的助记词 (Base64)
    derivation_path TEXT,                   -- BIP44派生路径
    chain_id INTEGER NOT NULL DEFAULT 1,    -- 链ID
    is_default INTEGER NOT NULL DEFAULT 0,  -- 是否为默认钱包
    created_at INTEGER NOT NULL             -- 创建时间 (毫秒时间戳)
);

CREATE INDEX IF NOT EXISTS idx_wallets_address ON blockchain_wallets(address);
CREATE INDEX IF NOT EXISTS idx_wallets_default ON blockchain_wallets(is_default);
```

### 1.1.4 UI实现 (CreateWalletView.swift)

```swift
import SwiftUI

/// 创建钱包视图
struct CreateWalletView: View {

    @StateObject private var viewModel: CreateWalletViewModel
    @Environment(\.dismiss) private var dismiss

    init(walletManager: WalletManager) {
        _viewModel = StateObject(wrappedValue: CreateWalletViewModel(walletManager: walletManager))
    }

    var body: some View {
        NavigationView {
            Form {
                Section(header: Text("设置密码")) {
                    SecureField("密码 (最少8位)", text: $viewModel.password)
                    SecureField("确认密码", text: $viewModel.confirmPassword)
                }

                Section(header: Text("选项")) {
                    Picker("链网络", selection: $viewModel.chainId) {
                        Text("以太坊主网").tag(1)
                        Text("Polygon").tag(137)
                        Text("BSC").tag(56)
                        Text("Sepolia测试网").tag(11155111)
                    }
                }

                Section {
                    Button(action: {
                        Task {
                            await viewModel.createWallet()
                        }
                    }) {
                        if viewModel.isLoading {
                            ProgressView()
                        } else {
                            Text("创建钱包")
                                .frame(maxWidth: .infinity)
                        }
                    }
                    .disabled(!viewModel.isValid || viewModel.isLoading)
                }
            }
            .navigationTitle("创建钱包")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") {
                        dismiss()
                    }
                }
            }
            .alert("助记词备份", isPresented: $viewModel.showMnemonicAlert) {
                Button("我已备份") {
                    viewModel.completeMnemonicBackup()
                    dismiss()
                }
                Button("复制", role: .destructive) {
                    UIPasteboard.general.string = viewModel.mnemonic
                }
            } message: {
                Text("请妥善保存以下助记词,这是恢复钱包的唯一方式:\n\n\(viewModel.mnemonic ?? "")")
            }
            .alert("错误", isPresented: $viewModel.showError) {
                Button("确定", role: .cancel) {}
            } message: {
                Text(viewModel.errorMessage ?? "")
            }
        }
    }
}
```

### 1.1.5 第三方库依赖

在`Package.swift`中添加:

```swift
dependencies: [
    // TrustWalletCore - HD钱包和多链支持
    .package(url: "https://github.com/trustwallet/wallet-core", from: "4.0.0"),

    // CryptoSwift - AES加密
    .package(url: "https://github.com/krzyzanowskim/CryptoSwift", from: "1.8.0"),
],
targets: [
    .target(
        name: "ChainlessChain",
        dependencies: [
            .product(name: "WalletCore", package: "wallet-core"),
            .product(name: "CryptoSwift", package: "CryptoSwift"),
        ]
    ),
]
```

### 1.1.6 测试计划

```swift
// WalletManagerTests.swift
import XCTest
@testable import ChainlessChain

class WalletManagerTests: XCTestCase {

    var walletManager: WalletManager!
    let testPassword = "Test1234"

    override func setUp() async throws {
        let database = DatabaseManager.test()
        walletManager = WalletManager(database: database)
        try await walletManager.initialize()
    }

    func testCreateWallet() async throws {
        // 测试创建钱包
        let result = try await walletManager.createWallet(
            password: testPassword,
            chainId: 1
        )

        XCTAssertNotNil(result.wallet)
        XCTAssertNotNil(result.mnemonic)
        XCTAssertEqual(result.mnemonic.split(separator: " ").count, 12)
    }

    func testImportFromMnemonic() async throws {
        // 测试从助记词导入
        let mnemonic = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"

        let wallet = try await walletManager.importFromMnemonic(
            mnemonic: mnemonic,
            password: testPassword,
            chainId: 1
        )

        XCTAssertEqual(wallet.address, "0x9858EfFD232B4033E47d90003D41EC34EcaEda94")
    }

    func testUnlockWallet() async throws {
        // 测试解锁钱包
        let result = try await walletManager.createWallet(password: testPassword)

        let hdWallet = try await walletManager.unlockWallet(
            walletId: result.wallet.id,
            password: testPassword
        )

        XCTAssertNotNil(hdWallet)
    }

    func testExportPrivateKey() async throws {
        // 测试导出私钥
        let result = try await walletManager.createWallet(password: testPassword)

        let privateKey = try await walletManager.exportPrivateKey(
            walletId: result.wallet.id,
            password: testPassword
        )

        XCTAssertTrue(privateKey.hasPrefix("0x"))
        XCTAssertEqual(privateKey.count, 66) // 0x + 64 hex chars
    }
}
```

### 1.1.7 Phase 1.1 完成标准

- [ ] WalletManager实现完成 (对应PC端全部功能)
- [ ] WalletCrypto AES-256-GCM加密实现
- [ ] KeychainWalletStorage实现
- [ ] 数据库表创建和验证
- [ ] 创建钱包UI实现
- [ ] 导入钱包UI实现
- [ ] 钱包列表UI实现
- [ ] 单元测试覆盖率 ≥ 80%
- [ ] 助记词备份流程测试通过
- [ ] 加密/解密测试通过

---

## 🌐 Phase 1.2: 区块链网络集成 (2周)

### 目标

实现多链支持、RPC管理、交易发送、余额查询,对齐PC端`blockchain-adapter.js`和`blockchain-config.js`。

### 2.1 文件结构

```swift
ios-app/ChainlessChain/Features/Blockchain/
├── Services/
│   ├── BlockchainAdapter.swift       // 区块链适配器 (核心)
│   ├── BlockchainConfig.swift        // 区块链配置
│   ├── RPCManager.swift             // RPC管理器
│   ├── TransactionMonitor.swift     // 交易监控
│   ├── GasEstimator.swift           // Gas估算
│   └── ChainManager.swift           // 链管理
├── Models/
│   ├── Chain.swift                  // 链配置模型
│   ├── RPCEndpoint.swift            // RPC端点
│   └── TransactionStatus.swift      // 交易状态
└── Repositories/
    └── TransactionRepository.swift  // 交易持久化
```

### 2.2 区块链配置 (BlockchainConfig.swift)

```swift
import Foundation

/// 支持的区块链 (对应PC端 SupportedChains)
/// 参考: blockchain-config.js:10-41
enum SupportedChain: Int, CaseIterable {
    // Ethereum
    case ethereumMainnet = 1
    case ethereumSepolia = 11155111

    // Polygon
    case polygonMainnet = 137
    case polygonMumbai = 80001

    // BSC
    case bscMainnet = 56
    case bscTestnet = 97

    // Arbitrum
    case arbitrumOne = 42161
    case arbitrumSepolia = 421614

    // Optimism
    case optimismMainnet = 10
    case optimismSepolia = 11155420

    // Avalanche
    case avalancheCChain = 43114
    case avalancheFuji = 43113

    // Base
    case baseMainnet = 8453
    case baseSepolia = 84532

    // Local
    case hardhatLocal = 31337
}

/// 网络配置 (对应PC端 NetworkConfigs)
/// 参考: blockchain-config.js:46-285
struct NetworkConfig {
    let chainId: Int
    let name: String
    let symbol: String
    let rpcUrls: [String]
    let blockExplorerUrls: [String]
    let nativeCurrency: NativeCurrency

    struct NativeCurrency {
        let name: String
        let symbol: String
        let decimals: Int
    }
}

/// 区块链配置管理器
class BlockchainConfig {

    static let shared = BlockchainConfig()

    /// 所有网络配置 (对应PC端 NetworkConfigs对象)
    /// 参考: blockchain-config.js:46-285
    private let configs: [Int: NetworkConfig] = [
        SupportedChain.ethereumMainnet.rawValue: NetworkConfig(
            chainId: 1,
            name: "Ethereum Mainnet",
            symbol: "ETH",
            rpcUrls: [
                ProcessInfo.processInfo.environment["ETHEREUM_RPC_URL"] ?? "https://eth-mainnet.g.alchemy.com/v2/your-api-key",
                "https://eth.llamarpc.com",
                "https://ethereum.publicnode.com"
            ],
            blockExplorerUrls: ["https://etherscan.io"],
            nativeCurrency: NetworkConfig.NativeCurrency(
                name: "Ether",
                symbol: "ETH",
                decimals: 18
            )
        ),
        // ... 其他14条链的配置 (与PC端完全对应)
    ]

    /// Gas配置 (对应PC端 GasConfigs)
    /// 参考: blockchain-config.js:289-361
    private let gasConfigs: [Int: GasConfig] = [
        1: GasConfig(slow: 20, standard: 30, fast: 50),       // Ethereum Mainnet
        137: GasConfig(slow: 30, standard: 40, fast: 60),     // Polygon
        11155111: GasConfig(slow: 1, standard: 2, fast: 3),   // Sepolia
        // ... 其他链的Gas配置
    ]

    struct GasConfig {
        let slow: Double     // Gwei
        let standard: Double
        let fast: Double
    }

    // MARK: - 公共方法 (对应PC端的导出函数)

    /// 获取网络配置 (对应PC端 getNetworkConfig)
    /// 参考: blockchain-config.js:458-464
    func getNetworkConfig(chainId: Int) throws -> NetworkConfig {
        guard let config = configs[chainId] else {
            throw BlockchainError.unsupportedChain(chainId)
        }
        return config
    }

    /// 获取RPC URL (对应PC端 getRpcUrl)
    /// 参考: blockchain-config.js:471-474
    func getRpcUrl(chainId: Int) throws -> String {
        let config = try getNetworkConfig(chainId: chainId)
        return config.rpcUrls[0]
    }

    /// 检查链是否支持 (对应PC端 isChainSupported)
    /// 参考: blockchain-config.js:481-483
    func isChainSupported(chainId: Int) -> Bool {
        return configs[chainId] != nil
    }

    /// 获取区块浏览器URL (对应PC端 getExplorerUrl)
    /// 参考: blockchain-config.js:490-497
    func getExplorerUrl(chainId: Int, txHash: String) -> String? {
        guard let config = try? getNetworkConfig(chainId: chainId),
              !config.blockExplorerUrls.isEmpty else {
            return nil
        }
        return "\(config.blockExplorerUrls[0])/tx/\(txHash)"
    }

    /// 获取地址浏览器URL (对应PC端 getAddressExplorerUrl)
    /// 参考: blockchain-config.js:504-511
    func getAddressExplorerUrl(chainId: Int, address: String) -> String? {
        guard let config = try? getNetworkConfig(chainId: chainId),
              !config.blockExplorerUrls.isEmpty else {
            return nil
        }
        return "\(config.blockExplorerUrls[0])/address/\(address)"
    }
}

enum BlockchainError: LocalizedError {
    case unsupportedChain(Int)

    var errorDescription: String? {
        switch self {
        case .unsupportedChain(let chainId):
            return "不支持的链ID: \(chainId)"
        }
    }
}
```

**PC端对应代码** (`blockchain-config.js:1-523`): 完整的区块链配置文件

### 2.3 RPC管理器 (RPCManager.swift)

参考PC端`rpc-manager.js`实现负载均衡和故障转移:

```swift
import Foundation
import web3swift

/// RPC节点健康状态 (对应PC端 RPCManager中的节点状态)
/// 参考: rpc-manager.js中的健康监控逻辑
struct RPCNodeHealth {
    var provider: Web3Provider
    var healthy: Bool = true
    var latency: TimeInterval = 0
    var lastCheck: Date = Date()
    var failureCount: Int = 0
    var requestCount: Int = 0
    var errorCount: Int = 0
}

/// RPC管理器 - 负载均衡与故障转移
/// 对应PC端 rpc-manager.js
class RPCManager {

    private var nodeHealthMap: [String: RPCNodeHealth] = [:]
    private let healthCheckInterval: TimeInterval = 60 // 60秒
    private let timeout: TimeInterval = 5 // 5秒超时
    private let maxFailures = 3

    private var healthCheckTimer: Timer?

    // MARK: - 初始化

    init() {
        startHealthCheck()
    }

    // MARK: - 健康检查 (对应PC端的健康监控机制)

    /// 启动健康检查定时器
    private func startHealthCheck() {
        healthCheckTimer = Timer.scheduledTimer(
            withTimeInterval: healthCheckInterval,
            repeats: true
        ) { [weak self] _ in
            Task {
                await self?.performHealthCheck()
            }
        }
    }

    /// 执行健康检查
    private func performHealthCheck() async {
        for (url, var health) in nodeHealthMap {
            let startTime = Date()

            do {
                // 发送简单的eth_blockNumber请求测试连通性
                _ = try await health.provider.eth.getBlockNumber()

                health.latency = Date().timeIntervalSince(startTime)
                health.healthy = true
                health.failureCount = 0
                health.lastCheck = Date()

            } catch {
                health.healthy = false
                health.failureCount += 1
                health.errorCount += 1
                health.lastCheck = Date()

                Logger.warning("[RPCManager] 节点健康检查失败: \(url), 失败次数: \(health.failureCount)")
            }

            nodeHealthMap[url] = health
        }
    }

    // MARK: - 自动故障转移

    /// 获取健康的Provider
    func getHealthyProvider(for chainId: Int) throws -> Web3Provider {
        let config = try BlockchainConfig.shared.getNetworkConfig(chainId: chainId)

        // 尝试按优先级获取健康节点
        for rpcUrl in config.rpcUrls {
            if let health = nodeHealthMap[rpcUrl],
               health.healthy && health.failureCount < maxFailures {
                health.requestCount += 1
                return health.provider
            }
        }

        // 如果所有节点都不健康,使用第一个节点并记录警告
        Logger.warning("[RPCManager] 所有节点都不健康,使用默认节点")
        let provider = try createProvider(rpcUrl: config.rpcUrls[0])
        return provider
    }

    private func createProvider(rpcUrl: String) throws -> Web3Provider {
        guard let url = URL(string: rpcUrl) else {
            throw RPCError.invalidURL
        }
        return try Web3HttpProvider(url: url, network: nil)
    }
}

enum RPCError: LocalizedError {
    case invalidURL
    case allNodesUnhealthy
}
```

**PC端对应逻辑**: PC端在`rpc-manager.js`中实现了完整的RPC负载均衡、健康检查、故障转移机制。

### 2.4 数据库Schema (交易表)

```sql
CREATE TABLE IF NOT EXISTS blockchain_transactions (
    id TEXT PRIMARY KEY,                    -- UUID
    tx_hash TEXT NOT NULL UNIQUE,           -- 交易哈希
    chain_id INTEGER NOT NULL,              -- 链ID
    from_address TEXT NOT NULL,             -- 发送地址
    to_address TEXT,                        -- 接收地址
    value TEXT,                             -- 金额 (wei, 字符串)
    gas_used TEXT,                          -- 使用的Gas
    gas_price TEXT,                         -- Gas价格
    status TEXT NOT NULL,                   -- 'PENDING' | 'CONFIRMED' | 'FAILED'
    block_number INTEGER,                   -- 区块号
    tx_type TEXT,                           -- 交易类型
    local_ref_id TEXT,                      -- 本地引用ID
    created_at INTEGER NOT NULL,            -- 创建时间
    confirmed_at INTEGER                    -- 确认时间
);

CREATE INDEX IF NOT EXISTS idx_tx_hash ON blockchain_transactions(tx_hash);
CREATE INDEX IF NOT EXISTS idx_tx_status ON blockchain_transactions(status);
CREATE INDEX IF NOT EXISTS idx_tx_from ON blockchain_transactions(from_address);
```

### Phase 1.2完成标准

- [ ] BlockchainConfig实现完成 (14条链配置)
- [ ] RPCManager实现完成 (负载均衡+故障转移)
- [ ] TransactionMonitor实现完成
- [ ] GasEstimator实现完成
- [ ] 交易数据库表创建
- [ ] 余额查询测试通过 (原生币+ERC-20)
- [ ] 交易发送测试通过 (测试网)
- [ ] RPC故障转移测试通过

---

## 📜 Phase 1.3: 智能合约集成 (2周)

### 目标

实现智能合约交互、合约部署、ERC-20/ERC-721支持,对齐PC端`blockchain-adapter.js`的合约功能。

### 3.1 文件结构

```swift
ios-app/ChainlessChain/Features/Blockchain/
├── Contracts/                       // 合约Swift包装器
│   ├── ERC20Contract.swift          // ERC-20代币合约
│   ├── ERC721Contract.swift         // ERC-721 NFT合约
│   ├── EscrowContract.swift         // 托管合约
│   ├── SubscriptionContract.swift   // 订阅合约
│   ├── BountyContract.swift         // 悬赏合约
│   └── ContractABIs.swift           // 合约ABI定义
└── Services/
    ├── ContractManager.swift        // 合约管理器
    └── ContractDeployer.swift       // 合约部署器
```

### 3.2 核心实现 (ERC20Contract.swift)

```swift
import Foundation
import web3swift
import BigInt

/// ERC-20代币合约 (对应PC端ERC-20操作)
/// 参考: blockchain-adapter.js中的deployERC20Token, transferToken等方法
class ERC20Contract {

    private let address: String
    private let provider: Web3Provider
    private let contract: web3swift.Contract

    // ERC-20标准ABI (简化版)
    private static let abi = """
    [
        {
            "constant": true,
            "inputs": [{"name": "_owner", "type": "address"}],
            "name": "balanceOf",
            "outputs": [{"name": "balance", "type": "uint256"}],
            "type": "function"
        },
        {
            "constant": false,
            "inputs": [
                {"name": "_to", "type": "address"},
                {"name": "_value", "type": "uint256"}
            ],
            "name": "transfer",
            "outputs": [{"name": "success", "type": "bool"}],
            "type": "function"
        }
    ]
    """

    init(address: String, provider: Web3Provider) throws {
        self.address = address
        self.provider = provider
        self.contract = try web3swift.Contract(abi: Self.abi, at: address)
    }

    // MARK: - 查询方法

    /// 查询余额 (对应PC端的balanceOf调用)
    func balanceOf(address: String) async throws -> BigUInt {
        let result = try await contract.method(
            "balanceOf",
            parameters: [address],
            provider: provider
        ).callPromise()

        guard let balance = result["balance"] as? BigUInt else {
            throw ContractError.invalidResult
        }

        return balance
    }

    // MARK: - 交易方法

    /// 转账代币 (对应PC端 transferToken)
    /// 参考: blockchain-adapter.js中的transferToken方法
    func transfer(
        to: String,
        amount: BigUInt,
        from wallet: HDWallet,
        gasPrice: BigUInt?,
        gasLimit: BigUInt?
    ) async throws -> String {

        let tx = try await contract.method(
            "transfer",
            parameters: [to, amount],
            provider: provider
        ).createTransaction(
            from: wallet.address,
            value: 0,
            gasPrice: gasPrice,
            gasLimit: gasLimit
        )

        // 签名并发送交易
        let signedTx = try wallet.sign(transaction: tx)
        let txHash = try await provider.eth.sendRawTransaction(signedTx)

        Logger.info("[ERC20] 转账交易已发送: \(txHash)")

        return txHash
    }
}

enum ContractError: LocalizedError {
    case invalidResult
    case deploymentFailed

    var errorDescription: String? {
        switch self {
        case .invalidResult:
            return "无效的合约调用结果"
        case .deploymentFailed:
            return "合约部署失败"
        }
    }
}
```

### 3.3 合约管理器 (ContractManager.swift)

```swift
import Foundation

/// 合约管理器 (对应PC端 contract-manager.js)
class ContractManager {

    private let database: DatabaseManager
    private let walletManager: WalletManager

    init(database: DatabaseManager, walletManager: WalletManager) {
        self.database = database
        self.walletManager = walletManager
    }

    // MARK: - 部署合约 (对应PC端的各种deploy方法)

    /// 部署ERC-20代币合约
    /// 参考: blockchain-adapter.js:deployERC20Token方法
    func deployERC20Token(
        walletId: String,
        name: String,
        symbol: String,
        decimals: UInt8,
        initialSupply: String,
        password: String
    ) async throws -> String {

        // 1. 解锁钱包
        let wallet = try await walletManager.unlockWallet(
            walletId: walletId,
            password: password
        )

        // 2. 获取合约字节码和ABI (从ContractABIs中读取)
        let bytecode = ContractABIs.erc20Bytecode
        let abi = ContractABIs.erc20ABI

        // 3. 部署合约
        // ... 部署逻辑 (使用web3swift)

        // 4. 保存部署记录到数据库
        let contractAddress = "0x..." // 部署后的合约地址
        try await saveDeployedContract(
            contractName: name,
            contractType: "ERC20",
            contractAddress: contractAddress,
            chainId: 1,
            deployerAddress: wallet.address,
            abi: abi
        )

        return contractAddress
    }

    // MARK: - 保存部署记录

    private func saveDeployedContract(
        contractName: String,
        contractType: String,
        contractAddress: String,
        chainId: Int,
        deployerAddress: String,
        abi: String
    ) async throws {

        try await database.run { db in
            try db.execute("""
                INSERT INTO deployed_contracts (
                    id, contract_name, contract_type, contract_address,
                    chain_id, deployer_address, abi_json, deployed_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, parameters: [
                UUID().uuidString,
                contractName,
                contractType,
                contractAddress,
                chainId,
                deployerAddress,
                abi,
                Int(Date().timeIntervalSince1970 * 1000)
            ])
        }
    }
}
```

### 3.4 数据库Schema (合约表)

```sql
CREATE TABLE IF NOT EXISTS deployed_contracts (
    id TEXT PRIMARY KEY,                    -- UUID
    local_contract_id TEXT,                 -- 本地合约ID (如有)
    contract_name TEXT NOT NULL,            -- 合约名称
    contract_type TEXT NOT NULL,            -- 合约类型 (ERC20/ERC721/Escrow等)
    contract_address TEXT NOT NULL,         -- 合约地址
    chain_id INTEGER NOT NULL,              -- 链ID
    deployment_tx TEXT,                     -- 部署交易哈希
    deployer_address TEXT NOT NULL,         -- 部署者地址
    abi_json TEXT NOT NULL,                 -- 合约ABI (JSON)
    deployed_at INTEGER NOT NULL            -- 部署时间
);

CREATE INDEX IF NOT EXISTS idx_contract_address ON deployed_contracts(contract_address);
CREATE INDEX IF NOT EXISTS idx_contract_type ON deployed_contracts(contract_type);
```

### Phase 1.3完成标准

- [ ] ERC-20合约包装器实现
- [ ] ERC-721合约包装器实现
- [ ] 托管合约包装器实现
- [ ] 订阅合约包装器实现
- [ ] 悬赏合约包装器实现
- [ ] 合约ABI管理实现
- [ ] 合约部署测试通过 (测试网)
- [ ] 代币转账测试通过
- [ ] NFT铸造测试通过

---

## 🛒 Phase 1.4: 交易系统 (2-3周)

### 目标

实现完整的交易系统,包括订单、托管、信用评分,对齐PC端`trade/`目录所有功能。

### 4.1 文件结构

```swift
ios-app/ChainlessChain/Features/Trade/
├── Models/
│   ├── Order.swift                 // 订单模型
│   ├── Transaction.swift           // 交易模型
│   ├── Escrow.swift                // 托管模型
│   ├── Contract.swift              // 智能合约模型
│   ├── CreditScore.swift           // 信用评分
│   └── Review.swift                // 评价
├── Services/
│   ├── MarketplaceManager.swift    // 市场管理
│   ├── EscrowManager.swift         // 托管管理
│   ├── AssetManager.swift          // 资产管理
│   ├── ContractEngine.swift        // 智能合约引擎
│   ├── CreditScoreService.swift    // 信用评分
│   └── ReviewManager.swift         // 评价管理
├── ViewModels/
│   ├── MarketplaceViewModel.swift  // 市场列表
│   └── OrderViewModel.swift        // 订单详情
└── Views/
    ├── MarketplaceView.swift       // 市场首页
    ├── OrderDetailView.swift       // 订单详情
    └── EscrowView.swift            // 托管详情
```

### 4.2 核心实现 (MarketplaceManager.swift)

```swift
import Foundation

/// 订单类型 (对应PC端 OrderType)
/// 参考: marketplace-manager.js中的OrderType枚举
enum OrderType: String, Codable {
    case buy = "buy"           // 购买
    case sell = "sell"         // 出售
    case service = "service"   // 服务
    case barter = "barter"     // 以物换物
}

/// 订单状态 (对应PC端订单状态流转)
/// 参考: marketplace-manager.js中的状态机
enum OrderStatus: String, Codable {
    case open = "OPEN"           // 开放
    case matched = "MATCHED"     // 已匹配
    case escrow = "ESCROW"       // 托管中
    case completed = "COMPLETED" // 已完成
    case disputed = "DISPUTED"   // 有争议
    case cancelled = "CANCELLED" // 已取消
}

/// 市场管理器 (对应PC端 marketplace-manager.js)
class MarketplaceManager {

    private let database: DatabaseManager
    private let escrowManager: EscrowManager
    private let assetManager: AssetManager

    init(
        database: DatabaseManager,
        escrowManager: EscrowManager,
        assetManager: AssetManager
    ) {
        self.database = database
        self.escrowManager = escrowManager
        self.assetManager = assetManager
    }

    // MARK: - 创建订单 (对应PC端 createOrder)

    /// 创建订单
    /// 参考: marketplace-manager.js:createOrder方法
    func createOrder(
        type: OrderType,
        assetId: String?,
        title: String,
        description: String?,
        priceAmount: String,
        quantity: Int = 1
    ) async throws -> String {

        let orderId = UUID().uuidString
        let createdAt = Int(Date().timeIntervalSince1970 * 1000)

        try await database.run { db in
            try db.execute("""
                INSERT INTO orders (
                    id, order_type, creator_did, asset_id,
                    title, description, price_amount, quantity,
                    status, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, parameters: [
                orderId, type.rawValue, "current_user_did", assetId,
                title, description, priceAmount, quantity,
                OrderStatus.open.rawValue, createdAt, createdAt
            ])
        }

        Logger.info("[Marketplace] 创建订单成功: \(orderId)")

        return orderId
    }

    // MARK: - 匹配订单 (对应PC端 matchOrder)

    /// 匹配订单 (购买)
    /// 参考: marketplace-manager.js:matchOrder方法
    func matchOrder(
        orderId: String,
        quantity: Int = 1
    ) async throws -> String {

        // 1. 创建交易记录
        let transactionId = UUID().uuidString

        try await database.run { db in
            try db.execute("""
                INSERT INTO transactions (
                    id, order_id, buyer_did, seller_did,
                    quantity, status, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """, parameters: [
                transactionId, orderId, "buyer_did", "seller_did",
                quantity, "PENDING", Int(Date().timeIntervalSince1970 * 1000)
            ])
        }

        // 2. 自动创建托管
        let escrowId = try await escrowManager.createEscrow(
            transactionId: transactionId,
            buyerDid: "buyer_did",
            sellerDid: "seller_did",
            amount: "100" // 从订单获取
        )

        Logger.info("[Marketplace] 匹配订单成功,托管ID: \(escrowId)")

        return transactionId
    }

    // MARK: - 确认交付 (对应PC端 confirmDelivery)

    /// 确认交付
    /// 参考: marketplace-manager.js:confirmDelivery方法
    func confirmDelivery(transactionId: String) async throws {

        // 1. 释放托管资金
        try await escrowManager.releaseEscrow(transactionId: transactionId)

        // 2. 转移资产
        try await assetManager.transferAsset(transactionId: transactionId)

        // 3. 更新订单状态
        try await database.run { db in
            try db.execute("""
                UPDATE transactions
                SET status = ?, completed_at = ?
                WHERE id = ?
            """, parameters: [
                "COMPLETED",
                Int(Date().timeIntervalSince1970 * 1000),
                transactionId
            ])
        }

        Logger.info("[Marketplace] 确认交付成功: \(transactionId)")
    }

    // MARK: - 全文搜索 (对应PC端FTS5全文搜索)

    /// 搜索订单 (使用FTS5全文搜索)
    /// 参考: marketplace-manager.js:getOrders方法中的全文搜索
    func searchOrders(
        query: String,
        type: OrderType? = nil,
        status: OrderStatus? = nil
    ) async throws -> [Order] {

        var sql = """
            SELECT o.* FROM orders o
            LEFT JOIN orders_fts fts ON o.id = fts.id
            WHERE 1=1
        """

        var parameters: [Any] = []

        // 全文搜索
        if !query.isEmpty {
            sql += " AND fts MATCH ?"
            parameters.append(query)
        }

        // 类型过滤
        if let type = type {
            sql += " AND o.order_type = ?"
            parameters.append(type.rawValue)
        }

        // 状态过滤
        if let status = status {
            sql += " AND o.status = ?"
            parameters.append(status.rawValue)
        }

        sql += " ORDER BY o.created_at DESC"

        return try await database.fetch { db in
            try db.query(sql, parameters: parameters).map { row in
                // 将row转换为Order对象
                // ...
            }
        }
    }
}

// MARK: - 订单模型

struct Order: Identifiable, Codable {
    let id: String
    let orderType: OrderType
    let creatorDid: String
    let assetId: String?
    let title: String
    let description: String?
    let priceAmount: String
    let quantity: Int
    var status: OrderStatus
    let createdAt: Date
    var updatedAt: Date
}
```

**PC端对应代码**: `trade/marketplace-manager.js` - 完整的市场管理器实现

### 4.3 信用评分服务 (CreditScoreService.swift)

```swift
import Foundation

/// 信用评分服务 (对应PC端 credit-score.js)
/// 参考: credit-score.js完整实现
class CreditScoreService {

    private let database: DatabaseManager

    // MARK: - 评分权重 (对应PC端 scoreWeights)
    /// 参考: credit-score.js中的权重配置
    private struct ScoreWeights {
        static let completionRate: Double = 0.30    // 交易完成率 30%
        static let tradeVolume: Double = 0.20       // 交易金额 20%
        static let positiveRate: Double = 0.25      // 好评率 25%
        static let responseSpeed: Double = 0.10     // 响应速度 10%
        static let disputeRate: Double = 0.10       // 纠纷率 10%
        static let refundRate: Double = 0.05        // 退款率 5%
    }

    // MARK: - 信用等级 (对应PC端信用等级定义)

    enum CreditLevel: String {
        case rookie = "新手"        // 0-100
        case bronze = "青铜"        // 101-300
        case silver = "白银"        // 301-600
        case gold = "黄金"          // 601-900
        case diamond = "钻石"       // 901-1000
    }

    init(database: DatabaseManager) {
        self.database = database
    }

    // MARK: - 计算信用评分 (对应PC端 calculateCreditScore)

    /// 计算信用评分
    /// 参考: credit-score.js:calculateCreditScore方法
    func calculateCreditScore(userDid: String) async throws -> Double {

        let stats = try await getUserStats(userDid: userDid)

        var score: Double = 0

        // 1. 交易完成率分数 (0-300)
        if stats.totalTransactions > 0 {
            let completionScore = (Double(stats.completedTransactions) / Double(stats.totalTransactions)) * 300
            score += completionScore * ScoreWeights.completionRate / 0.30
        }

        // 2. 交易金额分数 (对数增长, 0-200)
        let volumeScore = log10(stats.totalVolume + 1) * 50
        score += volumeScore * ScoreWeights.tradeVolume / 0.20

        // 3. 好评率分数 (0-250)
        if stats.totalReviews > 0 {
            let positiveScore = (Double(stats.positiveReviews) / Double(stats.totalReviews)) * 250
            score += positiveScore * ScoreWeights.positiveRate / 0.25
        }

        // 4. 响应速度分数 (0-100)
        let responseScore = max(0, 100 - stats.avgResponseTime / 3600000) // 毫秒转小时
        score += responseScore * ScoreWeights.responseSpeed / 0.10

        // 5. 纠纷率分数 (扣分项)
        if stats.totalTransactions > 0 {
            let disputeScore = (1 - Double(stats.disputes) / Double(stats.totalTransactions)) * 100
            score += disputeScore * ScoreWeights.disputeRate / 0.10
        }

        // 6. 退款率分数 (扣分项)
        if stats.totalTransactions > 0 {
            let refundScore = (1 - Double(stats.refunds) / Double(stats.totalTransactions)) * 50
            score += refundScore * ScoreWeights.refundRate / 0.05
        }

        // 限制在0-1000范围内
        return min(1000, max(0, score))
    }

    // MARK: - 事件触发器 (对应PC端事件触发系统)

    /// 交易完成事件 (对应PC端 onTransactionCompleted)
    /// 参考: credit-score.js:onTransactionCompleted
    func onTransactionCompleted(
        userDid: String,
        transactionId: String,
        amount: Double
    ) async throws {

        // 更新统计数据
        try await updateUserStats(userDid: userDid) { stats in
            stats.totalTransactions += 1
            stats.completedTransactions += 1
            stats.totalVolume += amount
        }

        // 增加信用分 +10
        try await adjustCreditScore(userDid: userDid, delta: 10)

        Logger.info("[CreditScore] 交易完成,用户\(userDid) +10分")
    }

    /// 好评事件 (对应PC端 onPositiveReview)
    /// 参考: credit-score.js:onPositiveReview
    func onPositiveReview(
        userDid: String,
        reviewId: String,
        rating: Int
    ) async throws {

        // 更新统计数据
        try await updateUserStats(userDid: userDid) { stats in
            stats.positiveReviews += 1
        }

        // 根据评分增加分数
        let delta: Int = {
            switch rating {
            case 5: return 15
            case 4: return 10
            case 3: return 5
            default: return 0
            }
        }()

        try await adjustCreditScore(userDid: userDid, delta: delta)

        Logger.info("[CreditScore] 好评,用户\(userDid) +\(delta)分")
    }

    // MARK: - 私有方法

    private func getUserStats(userDid: String) async throws -> UserStats {
        // 从数据库查询用户统计信息
        // ...
        fatalError("Not implemented")
    }

    private func updateUserStats(
        userDid: String,
        updates: (inout UserStats) -> Void
    ) async throws {
        // 更新用户统计信息
        // ...
    }

    private func adjustCreditScore(userDid: String, delta: Int) async throws {
        // 调整信用分数
        try await database.run { db in
            try db.execute("""
                UPDATE user_credits
                SET credit_score = credit_score + ?,
                    last_updated = ?
                WHERE user_did = ?
            """, parameters: [delta, Int(Date().timeIntervalSince1970 * 1000), userDid])
        }
    }
}

// MARK: - 统计模型

struct UserStats {
    var totalTransactions: Int = 0
    var completedTransactions: Int = 0
    var totalVolume: Double = 0
    var positiveReviews: Int = 0
    var totalReviews: Int = 0
    var disputes: Int = 0
    var refunds: Int = 0
    var avgResponseTime: TimeInterval = 0 // 毫秒
}
```

**PC端对应代码** (`credit-score.js:1-全部`): 完整的信用评分系统

### 4.4 数据库Schema (交易相关表)

参考PC端数据库表定义:

```sql
-- 订单表
CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    order_type TEXT NOT NULL,              -- 'buy' | 'sell' | 'service' | 'barter'
    creator_did TEXT NOT NULL,
    asset_id TEXT,
    title TEXT NOT NULL,
    description TEXT,
    price_asset_id TEXT,
    price_amount TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'OPEN',   -- 'OPEN' | 'MATCHED' | 'ESCROW' | 'COMPLETED' | 'DISPUTED' | 'CANCELLED'
    metadata TEXT,                         -- JSON
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- 订单全文搜索表 (FTS5)
CREATE VIRTUAL TABLE IF NOT EXISTS orders_fts USING fts5(
    id UNINDEXED,
    title,
    description,
    content='orders',
    content_rowid='rowid'
);

-- FTS5触发器 (保持同步)
CREATE TRIGGER IF NOT EXISTS orders_fts_insert AFTER INSERT ON orders
BEGIN
    INSERT INTO orders_fts(rowid, id, title, description)
    VALUES (new.rowid, new.id, new.title, new.description);
END;

CREATE TRIGGER IF NOT EXISTS orders_fts_update AFTER UPDATE ON orders
BEGIN
    UPDATE orders_fts
    SET title = new.title, description = new.description
    WHERE rowid = new.rowid;
END;

CREATE TRIGGER IF NOT EXISTS orders_fts_delete AFTER DELETE ON orders
BEGIN
    DELETE FROM orders_fts WHERE rowid = old.rowid;
END;

-- 交易表
CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL,
    buyer_did TEXT NOT NULL,
    seller_did TEXT NOT NULL,
    asset_id TEXT,
    payment_asset_id TEXT,
    payment_amount TEXT,
    quantity INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'PENDING',
    escrow_id TEXT,
    created_at INTEGER NOT NULL,
    completed_at INTEGER
);

-- 托管表
CREATE TABLE IF NOT EXISTS escrows (
    id TEXT PRIMARY KEY,
    transaction_id TEXT NOT NULL,
    buyer_did TEXT NOT NULL,
    seller_did TEXT NOT NULL,
    asset_id TEXT,
    amount TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'CREATED',  -- 'CREATED' | 'LOCKED' | 'RELEASED' | 'REFUNDED' | 'DISPUTED'
    created_at INTEGER NOT NULL,
    locked_at INTEGER,
    released_at INTEGER,
    refunded_at INTEGER,
    metadata TEXT
);

-- 托管历史表
CREATE TABLE IF NOT EXISTS escrow_history (
    id TEXT PRIMARY KEY,
    escrow_id TEXT NOT NULL,
    from_status TEXT,
    to_status TEXT NOT NULL,
    operated_by TEXT,
    reason TEXT,
    created_at INTEGER NOT NULL
);

-- 用户信用表
CREATE TABLE IF NOT EXISTS user_credits (
    user_did TEXT PRIMARY KEY,
    credit_score REAL NOT NULL DEFAULT 0,
    credit_level TEXT NOT NULL DEFAULT '新手',
    total_transactions INTEGER NOT NULL DEFAULT 0,
    completed_transactions INTEGER NOT NULL DEFAULT 0,
    total_volume REAL NOT NULL DEFAULT 0,
    positive_reviews INTEGER NOT NULL DEFAULT 0,
    negative_reviews INTEGER NOT NULL DEFAULT 0,
    disputes INTEGER NOT NULL DEFAULT 0,
    refunds INTEGER NOT NULL DEFAULT 0,
    avg_response_time REAL NOT NULL DEFAULT 0,
    last_updated INTEGER NOT NULL
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_orders_type ON orders(order_type);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_transactions_order ON transactions(order_id);
CREATE INDEX IF NOT EXISTS idx_escrows_transaction ON escrows(transaction_id);
```

### Phase 1.4完成标准

- [ ] MarketplaceManager实现完成 (订单CRUD、搜索、匹配)
- [ ] EscrowManager实现完成 (托管创建、锁定、释放、退款、争议)
- [ ] AssetManager实现完成 (资产转移)
- [ ] ContractEngine实现完成 (智能合约引擎、条件系统)
- [ ] CreditScoreService实现完成 (评分计算、事件触发)
- [ ] ReviewManager实现完成 (评价管理)
- [ ] 全文搜索测试通过 (FTS5)
- [ ] 托管流程测试通过 (创建→锁定→释放)
- [ ] 信用评分测试通过 (各事件触发)
- [ ] UI界面实现完成

---

## 📊 实施进度追踪

### 总体进度表

| 周次  | Phase | 任务                | 完成度 | 备注 |
| ----- | ----- | ------------------- | ------ | ---- |
| 第1周 | 1.1   | 钱包管理器实现      | 0%     |      |
| 第2周 | 1.1   | 加密存储、UI实现    | 0%     |      |
| 第3周 | 1.2   | 区块链配置、RPC管理 | 0%     |      |
| 第4周 | 1.2   | 交易监控、Gas估算   | 0%     |      |
| 第5周 | 1.3   | 智能合约包装器      | 0%     |      |
| 第6周 | 1.3   | 合约部署测试        | 0%     |      |
| 第7周 | 1.4   | 市场管理、托管系统  | 0%     |      |
| 第8周 | 1.4   | 信用评分、UI完善    | 0%     |      |

### 里程碑

- **M1 (第2周末)**: Phase 1.1完成,钱包创建和导入功能可用
- **M2 (第4周末)**: Phase 1.2完成,能够查询余额和发送交易
- **M3 (第6周末)**: Phase 1.3完成,能够部署和交互智能合约
- **M4 (第8周末)**: Phase 1.4完成,完整的交易系统可用

---

## 🧪 测试策略

### 单元测试

```swift
// WalletManagerTests.swift
// BlockchainAdapterTests.swift
// ContractManagerTests.swift
// MarketplaceManagerTests.swift
// EscrowManagerTests.swift
// CreditScoreTests.swift
```

### 集成测试

- 钱包创建→解锁→签名→发送交易 完整流程
- 订单创建→匹配→托管→交付→完成 完整流程
- 合约部署→调用→事件监听 完整流程

### UI测试

- 创建钱包流程测试
- 导入钱包流程测试
- 发送交易流程测试
- 市场下单流程测试

### 目标覆盖率

- 单元测试覆盖率 ≥ 80%
- 集成测试覆盖所有核心流程
- UI测试覆盖所有关键页面

---

## 📚 参考PC端代码路径

### 钱包相关

- `desktop-app-vue/src/main/blockchain/wallet-manager.js` (892行)
- `desktop-app-vue/src/main/blockchain/blockchain-config.js` (523行)

### 交易相关

- `desktop-app-vue/src/main/blockchain/blockchain-adapter.js`
- `desktop-app-vue/src/main/blockchain/transaction-monitor.js`
- `desktop-app-vue/src/main/blockchain/rpc-manager.js`

### 市场相关

- `desktop-app-vue/src/main/trade/marketplace-manager.js`
- `desktop-app-vue/src/main/trade/escrow-manager.js`
- `desktop-app-vue/src/main/trade/contract-engine.js`
- `desktop-app-vue/src/main/trade/credit-score.js`

### 智能合约

- `desktop-app-vue/contracts/EscrowContract.sol`
- `desktop-app-vue/contracts/SubscriptionContract.sol`
- `desktop-app-vue/contracts/ChainlessToken.sol`
- `desktop-app-vue/contracts/ChainlessNFT.sol`

---

## 🚨 风险与挑战

### 技术风险

1. **TrustWalletCore集成复杂度**
   - 风险: WalletCore的Swift API可能与ethers.js差异较大
   - 缓解: 优先阅读WalletCore文档,参考示例代码

2. **web3swift vs web3.js差异**
   - 风险: Swift生态的web3库功能可能不如JavaScript完整
   - 缓解: 必要时使用WalletCore的底层API直接构建

3. **FTS5全文搜索在iOS上的性能**
   - 风险: 移动端性能可能不足
   - 缓解: 限制搜索结果数量,增加分页

### 工期风险

1. **第三方库学习曲线**
   - 缓解: 预留1周buffer时间

2. **测试网RPC不稳定**
   - 缓解: 配置多个备用RPC端点

### 资源风险

1. **需要区块链开发经验**
   - 缓解: 深入研究PC端代码,理解业务逻辑

---

## ✅ 验收标准

### Phase 1.1

- [x] 能创建HD钱包并加密存储
- [x] 能从助记词/私钥导入钱包
- [x] 能解锁钱包并签名交易
- [x] 能导出私钥和助记词
- [x] UI完整且流畅

### Phase 1.2

- [x] 能切换14条区块链网络
- [x] 能查询原生币和ERC-20余额
- [x] 能发送交易到测试网
- [x] RPC故障转移机制工作正常
- [x] Gas估算准确

### Phase 1.3

- [x] 能部署ERC-20和ERC-721合约到测试网
- [x] 能调用合约方法
- [x] 能监听合约事件
- [x] 合约交互稳定可靠

### Phase 1.4

- [x] 能创建和搜索订单
- [x] 能创建托管并完成资金流转
- [x] 信用评分计算正确
- [x] 全文搜索性能良好
- [x] 所有交易流程完整可用

---

## 📝 后续行动

### 立即开始

1. **环境准备**
   - 安装Xcode最新版本
   - 配置测试网RPC节点 (Sepolia, Mumbai等)
   - 准备测试钱包和测试币

2. **技术调研**
   - 深入研究TrustWalletCore文档
   - 研究web3.swift库能力
   - 评估CryptoSwift加密性能

3. **代码移植**
   - 从Phase 1.1开始
   - 严格参考PC端代码逻辑
   - 保持数据模型一致性

---

**最后更新**: 2026-01-26
**文档维护**: 根据实际开发进度更新本文档
**下次审查**: Phase 1.1完成后
