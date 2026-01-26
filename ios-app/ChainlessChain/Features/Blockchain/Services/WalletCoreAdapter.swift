import Foundation
import WalletCore
import CryptoSwift

/// WalletCore适配器
/// 封装Trust Wallet Core的HD钱包功能
/// 提供BIP39/BIP44/BIP32支持
class WalletCoreAdapter {

    // MARK: - Mnemonic Generation

    /// 生成BIP39助记词
    /// - Parameter strength: 助记词强度（128位=12词，256位=24词）
    /// - Returns: 助记词字符串（空格分隔）
    static func generateMnemonic(strength: Int32 = 128) throws -> String {
        // 使用WalletCore生成助记词
        let wallet = HDWallet(strength: strength, passphrase: "")
        guard let wallet = wallet else {
            throw WalletCoreError.mnemonicGenerationFailed
        }

        return wallet.mnemonic
    }

    /// 验证助记词
    /// - Parameter mnemonic: 助记词字符串
    /// - Returns: 是否有效
    static func validateMnemonic(_ mnemonic: String) -> Bool {
        return Mnemonic.isValid(mnemonic: mnemonic)
    }

    // MARK: - Key Derivation

    /// 从助记词派生私钥
    /// - Parameters:
    ///   - mnemonic: BIP39助记词
    ///   - path: BIP44派生路径（如："m/44'/60'/0'/0/0"）
    ///   - passphrase: 可选的BIP39密码短语（默认为空）
    /// - Returns: 十六进制私钥（不含0x前缀）
    static func derivePrivateKey(
        from mnemonic: String,
        path: String,
        passphrase: String = ""
    ) throws -> String {
        // 创建HD钱包
        guard let wallet = HDWallet(mnemonic: mnemonic, passphrase: passphrase) else {
            throw WalletCoreError.invalidMnemonic
        }

        // 解析派生路径
        guard let derivationPath = DerivationPath(path) else {
            throw WalletCoreError.invalidDerivationPath(path)
        }

        // 派生私钥
        let privateKey = wallet.getKey(coin: .ethereum, derivationPath: path)

        // 转换为十六进制字符串
        let privateKeyData = privateKey.data
        return privateKeyData.hexString
    }

    /// 从助记词派生多个地址（批量派生）
    /// - Parameters:
    ///   - mnemonic: BIP39助记词
    ///   - basePath: 基础派生路径（如："m/44'/60'/0'/0"）
    ///   - count: 派生地址数量
    ///   - passphrase: 可选的BIP39密码短语
    /// - Returns: 地址数组
    static func deriveMultipleAddresses(
        from mnemonic: String,
        basePath: String,
        count: Int,
        passphrase: String = ""
    ) throws -> [(address: String, privateKey: String, index: Int)] {
        guard let wallet = HDWallet(mnemonic: mnemonic, passphrase: passphrase) else {
            throw WalletCoreError.invalidMnemonic
        }

        var results: [(String, String, Int)] = []

        for index in 0..<count {
            let path = "\(basePath)/\(index)"
            let privateKey = wallet.getKey(coin: .ethereum, derivationPath: path)
            let publicKey = privateKey.getPublicKeySecp256k1(compressed: false)
            let address = CoinType.ethereum.deriveAddress(publicKey: publicKey)

            results.append((address, privateKey.data.hexString, index))
        }

        return results
    }

    // MARK: - Address Generation

    /// 从私钥生成以太坊地址
    /// - Parameter privateKey: 十六进制私钥（可含或不含0x前缀）
    /// - Returns: 以太坊地址（0x开头）
    static func generateAddress(from privateKey: String) throws -> String {
        // 清理私钥前缀
        let cleanKey = privateKey.hasPrefix("0x") ? String(privateKey.dropFirst(2)) : privateKey

        // 验证私钥长度
        guard cleanKey.count == 64 else {
            throw WalletCoreError.invalidPrivateKeyLength(cleanKey.count)
        }

        // 转换为Data
        guard let privateKeyData = Data(hexString: cleanKey) else {
            throw WalletCoreError.invalidPrivateKeyFormat
        }

        // 创建PrivateKey对象
        guard let privKey = PrivateKey(data: privateKeyData) else {
            throw WalletCoreError.invalidPrivateKey
        }

        // 获取公钥（未压缩格式）
        let publicKey = privKey.getPublicKeySecp256k1(compressed: false)

        // 派生以太坊地址
        let address = CoinType.ethereum.deriveAddress(publicKey: publicKey)

        return address
    }

    /// 从公钥生成以太坊地址
    /// - Parameter publicKey: 十六进制公钥（未压缩，130字符）
    /// - Returns: 以太坊地址（0x开头）
    static func generateAddress(fromPublicKey publicKey: String) throws -> String {
        let cleanKey = publicKey.hasPrefix("0x") ? String(publicKey.dropFirst(2)) : publicKey

        guard cleanKey.count == 130 else {  // 未压缩公钥长度
            throw WalletCoreError.invalidPublicKeyLength(cleanKey.count)
        }

        guard let publicKeyData = Data(hexString: cleanKey) else {
            throw WalletCoreError.invalidPublicKeyFormat
        }

        guard let pubKey = PublicKey(data: publicKeyData, type: .secp256k1) else {
            throw WalletCoreError.invalidPublicKey
        }

        return CoinType.ethereum.deriveAddress(publicKey: pubKey)
    }

    // MARK: - Transaction Signing

    /// 签名以太坊交易
    /// - Parameters:
    ///   - privateKey: 私钥（十六进制）
    ///   - transaction: 交易数据
    /// - Returns: 签名后的交易（十六进制）
    static func signTransaction(
        privateKey: String,
        chainId: Int,
        nonce: Int,
        gasPrice: String,
        gasLimit: String,
        toAddress: String,
        amount: String,
        data: Data = Data()
    ) throws -> String {
        // 清理私钥
        let cleanKey = privateKey.hasPrefix("0x") ? String(privateKey.dropFirst(2)) : privateKey
        guard let privateKeyData = Data(hexString: cleanKey) else {
            throw WalletCoreError.invalidPrivateKeyFormat
        }

        guard let privKey = PrivateKey(data: privateKeyData) else {
            throw WalletCoreError.invalidPrivateKey
        }

        // 构建签名输入
        let input = EthereumSigningInput.with {
            $0.chainID = Data(hexString: String(chainId, radix: 16)) ?? Data()
            $0.nonce = Data(hexString: String(nonce, radix: 16)) ?? Data()
            $0.gasPrice = Data(hexString: gasPrice.stripHexPrefix()) ?? Data()
            $0.gasLimit = Data(hexString: gasLimit.stripHexPrefix()) ?? Data()
            $0.toAddress = toAddress
            $0.transaction = EthereumTransaction.with {
                $0.transfer = EthereumTransaction.Transfer.with {
                    $0.amount = Data(hexString: amount.stripHexPrefix()) ?? Data()
                    $0.data = data
                }
            }
        }

        // 签名
        let output: EthereumSigningOutput = AnySigner.sign(input: input, coin: .ethereum)

        // 返回签名后的交易
        return output.encoded.hexString
    }

    // MARK: - Message Signing

    /// 签名消息（EIP-191）
    /// - Parameters:
    ///   - message: 消息内容
    ///   - privateKey: 私钥（十六进制）
    /// - Returns: 签名（十六进制，含0x前缀）
    static func signMessage(_ message: String, privateKey: String) throws -> String {
        let cleanKey = privateKey.hasPrefix("0x") ? String(privateKey.dropFirst(2)) : privateKey
        guard let privateKeyData = Data(hexString: cleanKey) else {
            throw WalletCoreError.invalidPrivateKeyFormat
        }

        guard let privKey = PrivateKey(data: privateKeyData) else {
            throw WalletCoreError.invalidPrivateKey
        }

        // 构建EIP-191消息
        let messageData = message.data(using: .utf8) ?? Data()
        let prefix = "\u{19}Ethereum Signed Message:\n\(messageData.count)".data(using: .utf8) ?? Data()
        let hash = Hash.keccak256(data: prefix + messageData)

        // 签名
        guard let signature = privKey.sign(digest: hash, curve: .secp256k1) else {
            throw WalletCoreError.signatureFailed
        }

        return "0x" + signature.hexString
    }

    /// 验证消息签名
    /// - Parameters:
    ///   - message: 原始消息
    ///   - signature: 签名（十六进制）
    ///   - address: 预期的签名者地址
    /// - Returns: 签名是否有效
    static func verifyMessage(
        _ message: String,
        signature: String,
        expectedAddress: String
    ) throws -> Bool {
        let cleanSig = signature.hasPrefix("0x") ? String(signature.dropFirst(2)) : signature
        guard let signatureData = Data(hexString: cleanSig) else {
            throw WalletCoreError.invalidSignatureFormat
        }

        // 重建消息哈希
        let messageData = message.data(using: .utf8) ?? Data()
        let prefix = "\u{19}Ethereum Signed Message:\n\(messageData.count)".data(using: .utf8) ?? Data()
        let hash = Hash.keccak256(data: prefix + messageData)

        // 从签名恢复公钥
        guard let publicKey = PublicKey.recover(signature: signatureData, message: hash) else {
            return false
        }

        // 验证地址匹配
        let recoveredAddress = CoinType.ethereum.deriveAddress(publicKey: publicKey)
        return recoveredAddress.lowercased() == expectedAddress.lowercased()
    }

    // MARK: - Multi-chain Support

    /// 为指定链派生地址
    /// - Parameters:
    ///   - mnemonic: 助记词
    ///   - coinType: 链类型
    ///   - path: 派生路径
    /// - Returns: 地址字符串
    static func deriveAddress(
        from mnemonic: String,
        coinType: CoinType,
        path: String
    ) throws -> String {
        guard let wallet = HDWallet(mnemonic: mnemonic, passphrase: "") else {
            throw WalletCoreError.invalidMnemonic
        }

        return wallet.getAddressForCoin(coin: coinType)
    }

    // MARK: - Transaction Building & Signing

    /// 签名以太坊交易（完整参数版本）
    /// - Parameters:
    ///   - wallet: 钱包对象
    ///   - to: 接收地址
    ///   - amount: 金额（Wei）
    ///   - gasLimit: Gas限制
    ///   - gasPrice: Gas价格（Wei）
    ///   - nonce: Nonce
    ///   - data: 交易数据（可选）
    ///   - chainId: 链ID
    /// - Returns: 签名后的原始交易（十六进制）
    static func signTransaction(
        wallet: Wallet,
        to: String,
        amount: String,
        gasLimit: String,
        gasPrice: String,
        nonce: Int,
        data: String? = nil,
        chainId: Int
    ) throws -> String {
        // 从Keychain加载并解密私钥
        guard let encryptedPrivateKey = wallet.encryptedPrivateKey else {
            throw WalletCoreError.invalidPrivateKey
        }

        // 这里需要密码解锁，实际应该从WalletManager.unlockedWallets获取
        // 为了避免循环依赖，这个方法应该接收已解锁的私钥
        throw WalletCoreError.signatureFailed
    }

    /// 签名以太坊交易（使用私钥直接签名）
    /// - Parameters:
    ///   - privateKey: 私钥（十六进制）
    ///   - to: 接收地址
    ///   - amount: 金额（Wei）
    ///   - gasLimit: Gas限制
    ///   - gasPrice: Gas价格（Wei）
    ///   - nonce: Nonce
    ///   - data: 交易数据（可选）
    ///   - chainId: 链ID
    /// - Returns: 签名后的原始交易（十六进制）
    static func signTransaction(
        privateKey: String,
        to: String,
        amount: String,
        gasLimit: String,
        gasPrice: String,
        nonce: Int,
        data: String? = nil,
        chainId: Int
    ) throws -> String {
        // 清理私钥
        let cleanKey = privateKey.hasPrefix("0x") ? String(privateKey.dropFirst(2)) : privateKey
        guard let privateKeyData = Data(hexString: cleanKey) else {
            throw WalletCoreError.invalidPrivateKeyFormat
        }

        guard let privKey = PrivateKey(data: privateKeyData) else {
            throw WalletCoreError.invalidPrivateKey
        }

        // 转换参数
        guard let amountData = bigIntToData(amount),
              let gasLimitData = bigIntToData(gasLimit),
              let gasPriceData = bigIntToData(gasPrice) else {
            throw WalletCoreError.invalidPrivateKey
        }

        let nonceData = Data(count: 8)
        var nonceMutable = nonce
        withUnsafeBytes(of: &nonceMutable) { bytes in
            _ = nonceData
        }

        // 构建签名输入
        let input = EthereumSigningInput.with {
            $0.chainID = Data([UInt8(chainId)])
            $0.nonce = bigIntToData(String(nonce)) ?? Data()
            $0.gasPrice = gasPriceData
            $0.gasLimit = gasLimitData
            $0.toAddress = to
            $0.privateKey = privateKeyData

            if let txData = data, let dataBytes = Data(hexString: txData) {
                $0.transaction = EthereumTransaction.with {
                    $0.contractGeneric = EthereumTransaction.ContractGeneric.with {
                        $0.amount = amountData
                        $0.data = dataBytes
                    }
                }
            } else {
                $0.transaction = EthereumTransaction.with {
                    $0.transfer = EthereumTransaction.Transfer.with {
                        $0.amount = amountData
                    }
                }
            }
        }

        // 签名
        let output: EthereumSigningOutput = AnySigner.sign(input: input, coin: .ethereum)

        // 检查错误
        guard output.error == .ok else {
            throw WalletCoreError.signatureFailed
        }

        // 返回签名后的交易
        return "0x" + output.encoded.hexString
    }

    // MARK: - Helper Methods

    /// 大整数字符串转Data
    private static func bigIntToData(_ value: String) -> Data? {
        // 移除0x前缀
        let cleanValue = value.hasPrefix("0x") ? String(value.dropFirst(2)) : value

        // 转换为十六进制Data
        if let intValue = UInt64(cleanValue, radix: 16) {
            var mutableValue = intValue.bigEndian
            return Data(bytes: &mutableValue, count: MemoryLayout<UInt64>.size)
        } else if let data = Data(hexString: cleanValue) {
            return data
        }

        // 尝试十进制转换
        if let decimalValue = UInt64(cleanValue) {
            var mutableValue = decimalValue.bigEndian
            return Data(bytes: &mutableValue, count: MemoryLayout<UInt64>.size)
        }

        return nil
    }
}

// MARK: - Error Types

enum WalletCoreError: LocalizedError {
    case mnemonicGenerationFailed
    case invalidMnemonic
    case invalidDerivationPath(String)
    case invalidPrivateKey
    case invalidPrivateKeyFormat
    case invalidPrivateKeyLength(Int)
    case invalidPublicKey
    case invalidPublicKeyFormat
    case invalidPublicKeyLength(Int)
    case invalidSignatureFormat
    case signatureFailed

    var errorDescription: String? {
        switch self {
        case .mnemonicGenerationFailed:
            return "助记词生成失败"
        case .invalidMnemonic:
            return "无效的助记词"
        case .invalidDerivationPath(let path):
            return "无效的派生路径: \(path)"
        case .invalidPrivateKey:
            return "无效的私钥"
        case .invalidPrivateKeyFormat:
            return "私钥格式错误"
        case .invalidPrivateKeyLength(let length):
            return "私钥长度错误: \(length)（应为64）"
        case .invalidPublicKey:
            return "无效的公钥"
        case .invalidPublicKeyFormat:
            return "公钥格式错误"
        case .invalidPublicKeyLength(let length):
            return "公钥长度错误: \(length)（应为130）"
        case .invalidSignatureFormat:
            return "签名格式错误"
        case .signatureFailed:
            return "签名失败"
        }
    }
}

// MARK: - Helper Extensions

private extension String {
    func stripHexPrefix() -> String {
        hasPrefix("0x") ? String(dropFirst(2)) : self
    }
}

private extension Data {
    init?(hexString: String) {
        let cleanHex = hexString.hasPrefix("0x") ? String(hexString.dropFirst(2)) : hexString
        guard cleanHex.count % 2 == 0 else { return nil }

        var data = Data(capacity: cleanHex.count / 2)
        var index = cleanHex.startIndex

        while index < cleanHex.endIndex {
            let nextIndex = cleanHex.index(index, offsetBy: 2)
            let byteString = cleanHex[index..<nextIndex]

            guard let byte = UInt8(byteString, radix: 16) else { return nil }
            data.append(byte)

            index = nextIndex
        }

        self = data
    }

    var hexString: String {
        map { String(format: "%02x", $0) }.joined()
    }
}
