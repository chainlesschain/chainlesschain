import Foundation

/// 区块链引擎
///
/// 负责区块链钱包集成、交易处理、智能合约交互等任务
/// 参考：PC端 desktop-app-vue/src/main/ai-engine/engines/blockchain-engine.js
/// 集成：iOS端 Features/Blockchain 模块
public class BlockchainEngine: BaseAIEngine {

    public static let shared = BlockchainEngine()

    // MARK: - 服务访问器

    private var walletManager: WalletManager { WalletManager.shared }
    private var chainManager: ChainManager { ChainManager.shared }
    private var contractManager: ContractManager { ContractManager.shared }

    private init() {
        super.init(
            type: .blockchain,
            name: "区块链引擎",
            description: "处理区块链钱包、交易、智能合约等任务"
        )
    }

    public override var capabilities: [AIEngineCapability] {
        return [
            AIEngineCapability(
                id: "wallet_create",
                name: "创建钱包",
                description: "创建新的区块链钱包"
            ),
            AIEngineCapability(
                id: "wallet_import",
                name: "导入钱包",
                description: "通过私钥或助记词导入钱包"
            ),
            AIEngineCapability(
                id: "balance_query",
                name: "余额查询",
                description: "查询钱包余额"
            ),
            AIEngineCapability(
                id: "transaction_send",
                name: "发送交易",
                description: "发送区块链交易"
            ),
            AIEngineCapability(
                id: "transaction_history",
                name: "交易历史",
                description: "查询交易历史记录"
            ),
            AIEngineCapability(
                id: "contract_call",
                name: "合约调用",
                description: "调用智能合约方法"
            ),
            AIEngineCapability(
                id: "nft_manage",
                name: "NFT管理",
                description: "管理NFT资产"
            ),
            AIEngineCapability(
                id: "token_swap",
                name: "代币兑换",
                description: "进行代币兑换交易"
            ),
            AIEngineCapability(
                id: "gas_estimate",
                name: "Gas估算",
                description: "估算交易Gas费用"
            ),
            AIEngineCapability(
                id: "transaction_explain",
                name: "交易解释",
                description: "AI解释交易内容和风险"
            )
        ]
    }

    // MARK: - 初始化

    public override func initialize() async throws {
        try await super.initialize()

        // 初始化区块链管理器
        Logger.shared.info("区块链引擎初始化完成")
    }

    // MARK: - 任务执行

    public override func execute(task: String, parameters: [String: Any]) async throws -> Any {
        guard status != .initializing else {
            throw AIEngineError.notInitialized
        }

        status = .running
        defer { status = .idle }

        Logger.shared.info("区块链引擎执行任务: \(task)")

        switch task {
        case "create_wallet":
            return try await createWallet(parameters: parameters)

        case "import_wallet":
            return try await importWallet(parameters: parameters)

        case "balance":
            return try await queryBalance(parameters: parameters)

        case "send_transaction":
            return try await sendTransaction(parameters: parameters)

        case "transaction_history":
            return try await getTransactionHistory(parameters: parameters)

        case "call_contract":
            return try await callContract(parameters: parameters)

        case "nft_list":
            return try await listNFTs(parameters: parameters)

        case "token_swap":
            return try await swapTokens(parameters: parameters)

        case "estimate_gas":
            return try await estimateGas(parameters: parameters)

        case "explain_transaction":
            return try await explainTransaction(parameters: parameters)

        default:
            throw AIEngineError.capabilityNotSupported(task)
        }
    }

    // MARK: - 钱包管理

    /// 创建钱包
    private func createWallet(parameters: [String: Any]) async throws -> [String: Any] {
        let chainId = parameters["chainId"] as? Int ?? 1 // 1 = Ethereum Mainnet

        guard let password = parameters["password"] as? String else {
            throw AIEngineError.invalidParameters("缺少password参数（至少8位）")
        }

        // 使用WalletManager创建钱包
        let result = try await walletManager.createWallet(password: password, chainId: chainId)

        return [
            "address": result.wallet.address,
            "mnemonic": result.mnemonic,
            "chainId": chainId,
            "walletId": result.wallet.id,
            "created": result.wallet.createdAt.timeIntervalSince1970,
            "warning": "请安全保存助记词，切勿泄露！助记词丢失将无法恢复钱包。"
        ]
    }

    /// 导入钱包
    private func importWallet(parameters: [String: Any]) async throws -> [String: Any] {
        let importType = parameters["importType"] as? String ?? "mnemonic" // mnemonic, privateKey

        guard let importData = parameters["importData"] as? String else {
            throw AIEngineError.invalidParameters("缺少importData参数")
        }

        guard let password = parameters["password"] as? String else {
            throw AIEngineError.invalidParameters("缺少password参数（至少8位）")
        }

        let chainId = parameters["chainId"] as? Int ?? 1

        // 使用WalletManager导入钱包
        switch importType {
        case "mnemonic":
            let result = try await walletManager.importFromMnemonic(
                mnemonic: importData,
                password: password,
                chainId: chainId
            )
            return [
                "address": result.wallet.address,
                "chainId": chainId,
                "walletId": result.wallet.id,
                "importType": importType,
                "imported": result.wallet.createdAt.timeIntervalSince1970
            ]

        case "privateKey":
            let wallet = try await walletManager.importFromPrivateKey(
                privateKey: importData,
                password: password,
                chainId: chainId
            )
            return [
                "address": wallet.address,
                "chainId": chainId,
                "walletId": wallet.id,
                "importType": importType,
                "imported": wallet.createdAt.timeIntervalSince1970
            ]

        default:
            throw AIEngineError.invalidParameters("不支持的导入类型: \(importType)")
        }
    }

    /// 查询余额
    private func queryBalance(parameters: [String: Any]) async throws -> [String: Any] {
        guard let address = parameters["address"] as? String else {
            throw AIEngineError.invalidParameters("缺少address参数")
        }

        let chainId = parameters["chainId"] as? Int ?? 1

        // 获取对应的链配置
        guard let chain = SupportedChain.allCases.first(where: { $0.chainId == chainId }) else {
            throw AIEngineError.invalidParameters("不支持的链ID: \(chainId)")
        }

        // 使用ChainManager查询实际余额
        let balanceWei = try await chainManager.getBalance(address: address, chain: chain)

        // 将Wei转换为可读格式
        let balanceEth = formatWeiToEther(balanceWei)

        return [
            "address": address,
            "chainId": chainId,
            "nativeBalance": balanceEth,
            "nativeBalanceWei": balanceWei,
            "nativeSymbol": chain.symbol,
            "lastUpdated": Date().timeIntervalSince1970
        ]
    }

    /// 将Wei字符串转换为Ether格式
    private func formatWeiToEther(_ wei: String) -> String {
        guard let weiValue = Decimal(string: wei) else {
            return "0"
        }
        let etherValue = weiValue / Decimal(sign: .plus, exponent: 18, significand: 1)
        return String(describing: etherValue)
    }

    // MARK: - 交易操作

    /// 发送交易
    private func sendTransaction(parameters: [String: Any]) async throws -> [String: Any] {
        guard let walletId = parameters["walletId"] as? String else {
            throw AIEngineError.invalidParameters("缺少walletId参数")
        }

        guard let to = parameters["to"] as? String,
              let value = parameters["value"] as? String else {
            throw AIEngineError.invalidParameters("缺少to或value参数")
        }

        let chainId = parameters["chainId"] as? Int ?? 1
        let gasPrice = parameters["gasPrice"] as? String
        let gasLimit = parameters["gasLimit"] as? String

        // 查找钱包
        guard let wallet = walletManager.wallets.first(where: { $0.id == walletId }) else {
            throw AIEngineError.invalidParameters("钱包不存在: \(walletId)")
        }

        // 检查钱包是否已解锁
        guard walletManager.getUnlockedPrivateKey(walletId: walletId) != nil else {
            throw AIEngineError.executionFailed("钱包未解锁，请先解锁钱包")
        }

        // 获取对应的链
        guard let chain = SupportedChain.allCases.first(where: { $0.chainId == chainId }) else {
            throw AIEngineError.invalidParameters("不支持的链ID: \(chainId)")
        }

        // 使用TransactionManager发送交易
        let record = try await MainActor.run {
            try await TransactionManager.shared.sendTransaction(
                wallet: wallet,
                to: to,
                value: value,
                gasLimit: gasLimit,
                gasPrice: gasPrice,
                chain: chain
            )
        }

        return [
            "txHash": record.hash ?? "",
            "from": record.from,
            "to": record.to,
            "value": record.value,
            "chainId": chainId,
            "gasPrice": record.gasPrice,
            "gasLimit": record.gasLimit,
            "nonce": record.nonce,
            "status": record.status.rawValue,
            "timestamp": record.createdAt.timeIntervalSince1970
        ]
    }

    /// 查询交易历史
    private func getTransactionHistory(parameters: [String: Any]) async throws -> [String: Any] {
        let walletId = parameters["walletId"] as? String
        let address = parameters["address"] as? String
        let chainId = parameters["chainId"] as? Int
        let limit = parameters["limit"] as? Int ?? 20
        let offset = parameters["offset"] as? Int ?? 0

        // 使用TransactionManager查询交易历史
        let (records, total): ([TransactionRecord], Int) = try await MainActor.run {
            let txManager = TransactionManager.shared
            var txRecords: [TransactionRecord]

            if let wId = walletId {
                txRecords = try await txManager.getTransactionHistory(
                    walletId: wId,
                    chainId: chainId,
                    limit: limit,
                    offset: offset
                )
            } else if let addr = address {
                txRecords = try await txManager.getTransactionsByAddress(
                    address: addr,
                    chainId: chainId,
                    limit: limit
                )
            } else {
                throw AIEngineError.invalidParameters("需要提供walletId或address参数")
            }

            let count = try await txManager.getTransactionCount(
                walletId: walletId,
                chainId: chainId
            )

            return (txRecords, count)
        }

        let transactions: [[String: Any]] = records.map { record in
            return [
                "hash": record.hash ?? "",
                "from": record.from,
                "to": record.to,
                "value": record.value,
                "status": record.status.rawValue,
                "timestamp": record.createdAt.timeIntervalSince1970,
                "blockNumber": record.blockNumber ?? "",
                "confirmations": record.confirmations,
                "type": record.type.rawValue
            ]
        }

        return [
            "transactions": transactions,
            "total": total,
            "limit": limit,
            "offset": offset,
            "address": address ?? walletId ?? "",
            "chainId": chainId ?? 1
        ]
    }

    // MARK: - 智能合约

    /// 调用智能合约
    private func callContract(parameters: [String: Any]) async throws -> [String: Any] {
        guard let contractAddress = parameters["contractAddress"] as? String,
              let method = parameters["method"] as? String else {
            throw AIEngineError.invalidParameters("缺少contractAddress或method参数")
        }

        let args = parameters["args"] as? [Any] ?? []
        let chainId = parameters["chainId"] as? Int ?? 1
        let abi = parameters["abi"] as? String ?? ContractABI.erc20ABI

        // 获取对应的链
        guard let chain = SupportedChain.allCases.first(where: { $0.chainId == chainId }) else {
            throw AIEngineError.invalidParameters("不支持的链ID: \(chainId)")
        }

        // 使用ContractManager调用合约
        let result = try await MainActor.run {
            try await ContractManager.shared.callContractFunction(
                contractAddress: contractAddress,
                abi: abi,
                functionName: method,
                parameters: args,
                chain: chain
            )
        }

        return [
            "contractAddress": contractAddress,
            "method": method,
            "args": args,
            "result": result,
            "success": true,
            "chainId": chainId
        ]
    }

    // MARK: - NFT管理

    /// 列出NFT
    private func listNFTs(parameters: [String: Any]) async throws -> [String: Any] {
        guard let address = parameters["address"] as? String else {
            throw AIEngineError.invalidParameters("缺少address参数")
        }

        let chainId = parameters["chainId"] as? Int ?? 1

        // 获取对应的链
        guard let chain = SupportedChain.allCases.first(where: { $0.chainId == chainId }) else {
            throw AIEngineError.invalidParameters("不支持的链ID: \(chainId)")
        }

        // 使用NFTManager获取NFT列表
        let nfts = await MainActor.run {
            NFTManager.shared.nfts.filter {
                $0.ownerAddress.lowercased() == address.lowercased() && $0.chainId == chainId
            }
        }

        let nftList: [[String: Any]] = nfts.map { nft in
            return [
                "contractAddress": nft.contractAddress,
                "tokenId": nft.tokenId,
                "name": nft.name ?? "Unknown NFT",
                "imageURL": nft.imageUrl ?? "",
                "collection": nft.collectionName ?? "",
                "description": nft.description ?? "",
                "tokenStandard": nft.standard.rawValue
            ]
        }

        return [
            "nfts": nftList,
            "count": nftList.count,
            "address": address,
            "chainId": chainId
        ]
    }

    /// 兑换代币
    private func swapTokens(parameters: [String: Any]) async throws -> [String: Any] {
        guard let fromToken = parameters["fromToken"] as? String,
              let toToken = parameters["toToken"] as? String,
              let amount = parameters["amount"] as? String else {
            throw AIEngineError.invalidParameters("缺少fromToken、toToken或amount参数")
        }

        let slippage = parameters["slippage"] as? Double ?? 0.5 // 0.5%
        let chainId = parameters["chainId"] as? Int ?? 1

        // 获取对应的链
        guard let chain = SupportedChain.allCases.first(where: { $0.chainId == chainId }) else {
            throw AIEngineError.invalidParameters("不支持的链ID: \(chainId)")
        }

        // 使用1inch DEX聚合器获取实际报价
        do {
            let quote = try await DEXAggregatorService.shared.getQuote(
                chainId: chainId,
                fromToken: fromToken,
                toToken: toToken,
                amount: amount
            )

            let routeNames = quote.protocols.flatMap { $0.map { $0.name } }

            return [
                "fromToken": fromToken,
                "toToken": toToken,
                "inputAmount": amount,
                "estimatedOutput": quote.toAmount,
                "slippage": slippage,
                "estimatedGas": quote.estimatedGas,
                "route": routeNames.isEmpty ? [fromToken, toToken] : routeNames,
                "chainId": chainId,
                "source": "1inch"
            ]
        } catch {
            // Fallback to estimate if API is unavailable
            let estimatedOutput: Double
            if let amountDouble = Double(amount) {
                estimatedOutput = amountDouble * 0.98
            } else {
                estimatedOutput = 0
            }

            return [
                "fromToken": fromToken,
                "toToken": toToken,
                "inputAmount": amount,
                "estimatedOutput": String(format: "%.6f", estimatedOutput),
                "slippage": slippage,
                "priceImpact": 0.3,
                "route": [fromToken, toToken],
                "chainId": chainId,
                "source": "estimate",
                "note": "DEX聚合器不可用，返回估算值: \(error.localizedDescription)"
            ]
        }
    }

    // MARK: - Gas估算

    /// 估算Gas费用
    private func estimateGas(parameters: [String: Any]) async throws -> [String: Any] {
        guard let from = parameters["from"] as? String,
              let to = parameters["to"] as? String else {
            throw AIEngineError.invalidParameters("缺少from或to参数")
        }

        let value = parameters["value"] as? String ?? "0"
        let data = parameters["data"] as? String
        let chainId = parameters["chainId"] as? Int ?? 1

        // 获取对应的链
        guard let chain = SupportedChain.allCases.first(where: { $0.chainId == chainId }) else {
            throw AIEngineError.invalidParameters("不支持的链ID: \(chainId)")
        }

        // 使用TransactionManager估算Gas
        let (gasLimit, gasPriceHex) = try await MainActor.run {
            let txManager = TransactionManager.shared
            let limit = try await txManager.estimateGas(
                from: from,
                to: to,
                value: value,
                data: data,
                chain: chain
            )
            let price = try await txManager.getGasPrice(chain: chain)
            return (limit, price)
        }

        // 解析Gas价格（从十六进制Wei转换为Gwei）
        let cleanPriceHex = gasPriceHex.hasPrefix("0x") ? String(gasPriceHex.dropFirst(2)) : gasPriceHex
        let gasPriceWei = Int(cleanPriceHex, radix: 16) ?? 0
        let gasPriceGwei = Double(gasPriceWei) / 1e9

        let cleanLimitHex = gasLimit.hasPrefix("0x") ? String(gasLimit.dropFirst(2)) : gasLimit
        let gasLimitInt = Int(cleanLimitHex, radix: 16) ?? 21000

        // 计算估算费用
        let estimatedCostWei = Double(gasLimitInt) * Double(gasPriceWei)
        let estimatedCostEth = estimatedCostWei / 1e18

        return [
            "gasLimit": gasLimitInt,
            "gasPrice": gasPriceGwei,
            "gasPriceUnit": "Gwei",
            "estimatedCost": estimatedCostEth,
            "estimatedCostUnit": chain.symbol,
            "chainId": chainId
        ]
    }

    // MARK: - AI增强

    /// 解释交易
    private func explainTransaction(parameters: [String: Any]) async throws -> [String: Any] {
        guard let txHash = parameters["txHash"] as? String else {
            throw AIEngineError.invalidParameters("缺少txHash参数")
        }

        // 从TransactionManager获取交易详情
        let record = try await MainActor.run {
            try await TransactionManager.shared.getTransaction(txHash: txHash)
        }

        var txData: [String: Any]

        if let record = record {
            txData = [
                "hash": txHash,
                "from": record.from,
                "to": record.to,
                "value": record.value,
                "data": record.data ?? "0x",
                "type": record.type.rawValue,
                "status": record.status.rawValue,
                "gasUsed": record.gasUsed ?? "N/A",
                "fee": record.fee ?? "N/A",
                "confirmations": record.confirmations
            ]
        } else {
            // 如果本地没有记录，返回基本信息
            txData = [
                "hash": txHash,
                "note": "交易详情需要从区块链网络查询"
            ]
        }

        let prompt = """
        请解释以下区块链交易：

        交易Hash: \(txHash)
        发送方: \(txData["from"] ?? "未知")
        接收方: \(txData["to"] ?? "未知")
        金额: \(txData["value"] ?? "0") Wei
        交易类型: \(txData["type"] ?? "unknown")
        状态: \(txData["status"] ?? "unknown")
        Gas消耗: \(txData["gasUsed"] ?? "N/A")
        手续费: \(txData["fee"] ?? "N/A")
        确认数: \(txData["confirmations"] ?? 0)

        请提供：
        1. 交易目的和操作说明
        2. 潜在风险评估
        3. 安全建议
        4. 是否为常见的诈骗模式
        """

        let explanation = try await generateWithLLM(
            prompt: prompt,
            systemPrompt: "你是一个区块链安全专家，擅长分析交易并识别潜在风险。"
        )

        // 简单的风险等级判断
        var riskLevel = "low"
        if let record = record {
            if record.status == .failed {
                riskLevel = "medium"
            }
        }

        return [
            "txHash": txHash,
            "explanation": explanation,
            "txData": txData,
            "riskLevel": riskLevel
        ]
    }
}
