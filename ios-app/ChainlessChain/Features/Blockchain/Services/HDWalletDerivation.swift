//
//  HDWalletDerivation.swift
//  ChainlessChain
//
//  HD钱包地址批量派生服务
//  支持BIP44标准路径批量生成地址
//
//  Created by ChainlessChain on 2026-01-26.
//

import Foundation

/// HD派生地址信息
struct HDDerivedAddress: Identifiable, Codable {
    let id: String
    let walletId: String        // 所属钱包ID
    let address: String          // 以太坊地址
    let derivationPath: String   // BIP44路径
    let index: Int               // 地址索引
    let chainId: Int             // 链ID
    var label: String?           // 用户标签
    let createdAt: Date

    var displayPath: String {
        // m/44'/60'/0'/0/0 -> ...0'/0/0
        let components = derivationPath.components(separatedBy: "/")
        if components.count >= 3 {
            return "..." + components.suffix(3).joined(separator: "/")
        }
        return derivationPath
    }

    var displayAddress: String {
        guard address.count > 10 else { return address }
        let start = address.prefix(6)
        let end = address.suffix(4)
        return "\(start)...\(end)"
    }
}

/// HD钱包派生服务
class HDWalletDerivation: ObservableObject {
    static let shared = HDWalletDerivation()

    @Published var derivedAddresses: [String: [HDDerivedAddress]] = [:]  // walletId -> addresses

    private let databaseManager = DatabaseManager.shared

    private init() {
        Task {
            await loadAllDerivedAddresses()
        }
    }

    // MARK: - 批量派生地址

    /// 批量派生地址（从助记词）
    /// - Parameters:
    ///   - wallet: 钱包对象
    ///   - mnemonic: 助记词（明文）
    ///   - basePath: 基础路径（默认 m/44'/60'/0'/0）
    ///   - startIndex: 起始索引
    ///   - count: 派生数量
    ///   - chainId: 链ID
    /// - Returns: 派生的地址列表
    func deriveAddresses(
        for wallet: Wallet,
        mnemonic: String,
        basePath: String = "m/44'/60'/0'/0",
        startIndex: Int = 0,
        count: Int = 10,
        chainId: Int? = nil
    ) async throws -> [HDDerivedAddress] {
        let targetChainId = chainId ?? wallet.chainId

        // 使用WalletCoreAdapter批量派生
        let results = try WalletCoreAdapter.deriveMultipleAddresses(
            from: mnemonic,
            basePath: basePath,
            count: count,
            passphrase: ""
        )

        var derivedAddresses: [HDDerivedAddress] = []

        for (index, result) in results.enumerated() {
            let actualIndex = startIndex + index
            let path = "\(basePath)/\(actualIndex)"

            let derivedAddress = HDDerivedAddress(
                id: UUID().uuidString,
                walletId: wallet.id,
                address: result.address,
                derivationPath: path,
                index: actualIndex,
                chainId: targetChainId,
                label: nil,
                createdAt: Date()
            )

            derivedAddresses.append(derivedAddress)
        }

        // 保存到数据库
        for address in derivedAddresses {
            try await saveDerivedAddress(address)
        }

        // 更新缓存
        await MainActor.run {
            var addresses = self.derivedAddresses[wallet.id] ?? []
            addresses.append(contentsOf: derivedAddresses)
            // 按索引排序
            addresses.sort { $0.index < $1.index }
            self.derivedAddresses[wallet.id] = addresses
        }

        Logger.shared.info("批量派生地址成功: \(count)个")

        return derivedAddresses
    }

    /// 派生单个地址
    /// - Parameters:
    ///   - wallet: 钱包对象
    ///   - mnemonic: 助记词
    ///   - index: 地址索引
    ///   - chainId: 链ID
    /// - Returns: 派生的地址
    func deriveSingleAddress(
        for wallet: Wallet,
        mnemonic: String,
        index: Int,
        chainId: Int? = nil
    ) async throws -> HDDerivedAddress {
        let addresses = try await deriveAddresses(
            for: wallet,
            mnemonic: mnemonic,
            startIndex: index,
            count: 1,
            chainId: chainId
        )

        guard let address = addresses.first else {
            throw HDWalletError.derivationFailed
        }

        return address
    }

    /// 派生找零地址（m/44'/60'/0'/1/*）
    /// - Parameters:
    ///   - wallet: 钱包对象
    ///   - mnemonic: 助记词
    ///   - count: 派生数量
    ///   - chainId: 链ID
    /// - Returns: 找零地址列表
    func deriveChangeAddresses(
        for wallet: Wallet,
        mnemonic: String,
        count: Int = 5,
        chainId: Int? = nil
    ) async throws -> [HDDerivedAddress] {
        return try await deriveAddresses(
            for: wallet,
            mnemonic: mnemonic,
            basePath: "m/44'/60'/0'/1",  // 找零地址链
            startIndex: 0,
            count: count,
            chainId: chainId
        )
    }

    // MARK: - 地址管理

    /// 获取钱包的所有派生地址
    /// - Parameter walletId: 钱包ID
    /// - Returns: 派生地址列表
    func getDerivedAddresses(for walletId: String) -> [HDDerivedAddress] {
        derivedAddresses[walletId] ?? []
    }

    /// 获取下一个未使用的地址索引
    /// - Parameter walletId: 钱包ID
    /// - Returns: 下一个可用索引
    func getNextAddressIndex(for walletId: String) -> Int {
        let addresses = getDerivedAddresses(for: walletId)
        if addresses.isEmpty {
            return 0
        }
        let maxIndex = addresses.map { $0.index }.max() ?? -1
        return maxIndex + 1
    }

    /// 更新地址标签
    /// - Parameters:
    ///   - addressId: 地址ID
    ///   - label: 新标签
    func updateAddressLabel(addressId: String, label: String) async throws {
        // 查找地址
        for (walletId, addresses) in derivedAddresses {
            if let index = addresses.firstIndex(where: { $0.id == addressId }) {
                var updatedAddress = addresses[index]
                updatedAddress.label = label

                // 更新数据库
                try await updateDerivedAddressInDatabase(updatedAddress)

                // 更新缓存
                await MainActor.run {
                    var addresses = self.derivedAddresses[walletId] ?? []
                    addresses[index] = updatedAddress
                    self.derivedAddresses[walletId] = addresses
                }

                Logger.shared.info("地址标签已更新: \(label)")
                return
            }
        }

        throw HDWalletError.addressNotFound
    }

    /// 删除派生地址
    /// - Parameter addressId: 地址ID
    func deleteDerivedAddress(addressId: String) async throws {
        for (walletId, addresses) in derivedAddresses {
            if let index = addresses.firstIndex(where: { $0.id == addressId }) {
                // 从数据库删除
                try await deleteDerivedAddressFromDatabase(addressId)

                // 从缓存删除
                await MainActor.run {
                    var addresses = self.derivedAddresses[walletId] ?? []
                    addresses.remove(at: index)
                    self.derivedAddresses[walletId] = addresses
                }

                Logger.shared.info("派生地址已删除: \(addressId)")
                return
            }
        }

        throw HDWalletError.addressNotFound
    }

    // MARK: - 地址查找

    /// 根据地址字符串查找派生地址
    /// - Parameter address: 以太坊地址
    /// - Returns: 派生地址信息
    func findDerivedAddress(byAddress address: String) -> HDDerivedAddress? {
        for addresses in derivedAddresses.values {
            if let found = addresses.first(where: { $0.address.lowercased() == address.lowercased() }) {
                return found
            }
        }
        return nil
    }

    /// 检查地址是否已派生
    /// - Parameters:
    ///   - address: 以太坊地址
    ///   - walletId: 钱包ID
    /// - Returns: 是否已存在
    func isDerivedAddress(_ address: String, for walletId: String) -> Bool {
        let addresses = getDerivedAddresses(for: walletId)
        return addresses.contains { $0.address.lowercased() == address.lowercased() }
    }

    // MARK: - 数据库操作

    /// 初始化数据库表
    private func initializeDatabase() async throws {
        let sql = """
        CREATE TABLE IF NOT EXISTS hd_derived_addresses (
            id TEXT PRIMARY KEY,
            wallet_id TEXT NOT NULL,
            address TEXT NOT NULL,
            derivation_path TEXT NOT NULL,
            address_index INTEGER NOT NULL,
            chain_id INTEGER NOT NULL,
            label TEXT,
            created_at INTEGER NOT NULL,
            UNIQUE(wallet_id, address_index, chain_id)
        )
        """

        try databaseManager.db.execute(sql)

        // 创建索引
        try databaseManager.db.execute("""
            CREATE INDEX IF NOT EXISTS idx_hd_wallet ON hd_derived_addresses(wallet_id)
        """)

        try databaseManager.db.execute("""
            CREATE INDEX IF NOT EXISTS idx_hd_address ON hd_derived_addresses(address)
        """)

        Logger.shared.debug("HD派生地址表初始化成功")
    }

    /// 保存派生地址到数据库
    private func saveDerivedAddress(_ address: HDDerivedAddress) async throws {
        // 确保表存在
        try await initializeDatabase()

        let sql = """
        INSERT INTO hd_derived_addresses
        (id, wallet_id, address, derivation_path, address_index, chain_id, label, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """

        try databaseManager.db.execute(
            sql,
            address.id,
            address.walletId,
            address.address,
            address.derivationPath,
            address.index,
            address.chainId,
            address.label,
            Int(address.createdAt.timeIntervalSince1970 * 1000)
        )
    }

    /// 从数据库加载所有派生地址
    private func loadAllDerivedAddresses() async {
        do {
            try await initializeDatabase()

            let rows = try databaseManager.db.prepare("SELECT * FROM hd_derived_addresses ORDER BY address_index ASC")

            var addressesByWallet: [String: [HDDerivedAddress]] = [:]

            for row in rows {
                guard let address = parseDerivedAddressRow(row) else { continue }

                var addresses = addressesByWallet[address.walletId] ?? []
                addresses.append(address)
                addressesByWallet[address.walletId] = addresses
            }

            await MainActor.run {
                self.derivedAddresses = addressesByWallet
            }

            Logger.shared.info("加载HD派生地址: \(addressesByWallet.values.flatMap { $0 }.count)个")
        } catch {
            Logger.shared.error("加载HD派生地址失败: \(error)")
        }
    }

    /// 更新数据库中的派生地址
    private func updateDerivedAddressInDatabase(_ address: HDDerivedAddress) async throws {
        let sql = "UPDATE hd_derived_addresses SET label = ? WHERE id = ?"
        try databaseManager.db.execute(sql, address.label, address.id)
    }

    /// 从数据库删除派生地址
    private func deleteDerivedAddressFromDatabase(_ addressId: String) async throws {
        try databaseManager.db.execute("DELETE FROM hd_derived_addresses WHERE id = ?", addressId)
    }

    /// 解析数据库行
    private func parseDerivedAddressRow(_ row: [String: Any]) -> HDDerivedAddress? {
        guard let id = row["id"] as? String,
              let walletId = row["wallet_id"] as? String,
              let address = row["address"] as? String,
              let derivationPath = row["derivation_path"] as? String,
              let index = row["address_index"] as? Int,
              let chainId = row["chain_id"] as? Int,
              let createdAtMs = row["created_at"] as? Int else {
            return nil
        }

        return HDDerivedAddress(
            id: id,
            walletId: walletId,
            address: address,
            derivationPath: derivationPath,
            index: index,
            chainId: chainId,
            label: row["label"] as? String,
            createdAt: Date(timeIntervalSince1970: Double(createdAtMs) / 1000)
        )
    }
}

// MARK: - 错误类型

enum HDWalletError: LocalizedError {
    case derivationFailed
    case addressNotFound
    case duplicateAddress
    case invalidMnemonic

    var errorDescription: String? {
        switch self {
        case .derivationFailed:
            return "地址派生失败"
        case .addressNotFound:
            return "未找到派生地址"
        case .duplicateAddress:
            return "地址已存在"
        case .invalidMnemonic:
            return "无效的助记词"
        }
    }
}

// MARK: - 预览数据

#if DEBUG
extension HDDerivedAddress {
    static let preview = HDDerivedAddress(
        id: "preview-hd-address",
        walletId: "preview-wallet-id",
        address: "0x1234567890123456789012345678901234567890",
        derivationPath: "m/44'/60'/0'/0/0",
        index: 0,
        chainId: 1,
        label: "Main Address",
        createdAt: Date()
    )

    static let previews: [HDDerivedAddress] = [
        preview,
        HDDerivedAddress(
            id: "preview-hd-address-2",
            walletId: "preview-wallet-id",
            address: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
            derivationPath: "m/44'/60'/0'/0/1",
            index: 1,
            chainId: 1,
            label: "Secondary Address",
            createdAt: Date().addingTimeInterval(-86400)
        )
    ]
}
#endif
