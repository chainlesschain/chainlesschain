import Foundation

/// 钱包类型
enum WalletType: String, Codable {
    case internal       // 内置钱包
    case external       // 外部钱包
}

/// 钱包提供者
enum WalletProvider: String, Codable {
    case builtin        // 内置
    case metamask       // MetaMask
    case walletConnect  // WalletConnect
}

/// 钱包模型
struct Wallet: Identifiable, Codable {
    let id: String
    let address: String
    let walletType: WalletType
    let provider: WalletProvider
    let derivationPath: String
    let chainId: Int
    var isDefault: Bool
    let createdAt: Date

    /// 格式化地址（简短显示）
    var formattedAddress: String {
        guard address.count > 10 else { return address }
        let start = address.prefix(6)
        let end = address.suffix(4)
        return "\(start)...\(end)"
    }

    /// 获取链配置
    var chain: SupportedChain? {
        SupportedChain(rawValue: chainId)
    }

    /// 获取网络配置
    var networkConfig: NetworkConfig? {
        guard let chain = chain else { return nil }
        return NetworkConfig.config(for: chain)
    }
}

/// 钱包余额
struct WalletBalance: Codable {
    let walletId: String
    let chainId: Int
    let balance: String      // Wei余额（字符串避免精度问题）
    let symbol: String
    let decimals: Int
    let updatedAt: Date

    /// 格式化余额（转换为ETH/MATIC等）
    var formattedBalance: String {
        guard let balanceDecimal = Decimal(string: balance) else { return "0.0" }
        let divisor = pow(Decimal(10), decimals)
        let result = balanceDecimal / divisor
        return String(describing: result)
    }

    /// 显示余额（最多6位小数）
    var displayBalance: String {
        guard let value = Double(formattedBalance) else { return "0.0" }
        return String(format: "%.6f", value)
    }
}

/// 加密的钱包数据（存储在Keychain中）
struct EncryptedWalletData: Codable {
    let walletId: String
    let encryptedPrivateKey: String
    let encryptedMnemonic: String?
    let salt: String
    let iv: String
}

/// 钱包创建结果
struct WalletCreationResult {
    let wallet: Wallet
    let mnemonic: String        // 明文助记词（供用户备份）
    let privateKey: String      // 明文私钥（临时使用）
}

/// 钱包导入类型
enum WalletImportType {
    case mnemonic(String)       // 助记词
    case privateKey(String)     // 私钥
}
