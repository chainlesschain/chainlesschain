import Foundation

/// 支持的区块链网络
enum SupportedChain: Int, CaseIterable, Codable {
    // Ethereum
    case ethereumMainnet = 1
    case ethereumSepolia = 11155111

    // Polygon
    case polygonMainnet = 137
    case polygonMumbai = 80001

    // BSC (Binance Smart Chain)
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

    var name: String {
        switch self {
        case .ethereumMainnet: return "Ethereum Mainnet"
        case .ethereumSepolia: return "Ethereum Sepolia"
        case .polygonMainnet: return "Polygon Mainnet"
        case .polygonMumbai: return "Polygon Mumbai"
        case .bscMainnet: return "BNB Smart Chain"
        case .bscTestnet: return "BNB Testnet"
        case .arbitrumOne: return "Arbitrum One"
        case .arbitrumSepolia: return "Arbitrum Sepolia"
        case .optimismMainnet: return "Optimism"
        case .optimismSepolia: return "Optimism Sepolia"
        case .avalancheCChain: return "Avalanche C-Chain"
        case .avalancheFuji: return "Avalanche Fuji"
        case .baseMainnet: return "Base"
        case .baseSepolia: return "Base Sepolia"
        case .hardhatLocal: return "Hardhat Local"
        }
    }

    var symbol: String {
        switch self {
        case .ethereumMainnet, .ethereumSepolia, .arbitrumOne, .arbitrumSepolia,
             .optimismMainnet, .optimismSepolia, .baseMainnet, .baseSepolia, .hardhatLocal:
            return "ETH"
        case .polygonMainnet, .polygonMumbai:
            return "MATIC"
        case .bscMainnet:
            return "BNB"
        case .bscTestnet:
            return "tBNB"
        case .avalancheCChain, .avalancheFuji:
            return "AVAX"
        }
    }

    var isTestnet: Bool {
        switch self {
        case .ethereumSepolia, .polygonMumbai, .bscTestnet, .arbitrumSepolia,
             .optimismSepolia, .avalancheFuji, .baseSepolia, .hardhatLocal:
            return true
        default:
            return false
        }
    }
}

/// 原生货币配置
struct NativeCurrency: Codable {
    let name: String
    let symbol: String
    let decimals: Int
}

/// 网络配置
struct NetworkConfig: Codable {
    let chainId: Int
    let name: String
    let symbol: String
    let rpcUrls: [String]
    let blockExplorerUrls: [String]
    let nativeCurrency: NativeCurrency

    static func config(for chain: SupportedChain) -> NetworkConfig {
        switch chain {
        case .ethereumMainnet:
            return NetworkConfig(
                chainId: 1,
                name: "Ethereum Mainnet",
                symbol: "ETH",
                rpcUrls: [
                    "https://eth.llamarpc.com",
                    "https://ethereum.publicnode.com"
                ],
                blockExplorerUrls: ["https://etherscan.io"],
                nativeCurrency: NativeCurrency(name: "Ether", symbol: "ETH", decimals: 18)
            )

        case .ethereumSepolia:
            return NetworkConfig(
                chainId: 11155111,
                name: "Ethereum Sepolia",
                symbol: "ETH",
                rpcUrls: [
                    "https://rpc.sepolia.org",
                    "https://ethereum-sepolia.publicnode.com"
                ],
                blockExplorerUrls: ["https://sepolia.etherscan.io"],
                nativeCurrency: NativeCurrency(name: "Sepolia Ether", symbol: "ETH", decimals: 18)
            )

        case .polygonMainnet:
            return NetworkConfig(
                chainId: 137,
                name: "Polygon Mainnet",
                symbol: "MATIC",
                rpcUrls: [
                    "https://polygon.llamarpc.com",
                    "https://polygon-bor.publicnode.com"
                ],
                blockExplorerUrls: ["https://polygonscan.com"],
                nativeCurrency: NativeCurrency(name: "MATIC", symbol: "MATIC", decimals: 18)
            )

        case .polygonMumbai:
            return NetworkConfig(
                chainId: 80001,
                name: "Polygon Mumbai",
                symbol: "MATIC",
                rpcUrls: [
                    "https://rpc-mumbai.maticvigil.com",
                    "https://polygon-mumbai-bor.publicnode.com"
                ],
                blockExplorerUrls: ["https://mumbai.polygonscan.com"],
                nativeCurrency: NativeCurrency(name: "MATIC", symbol: "MATIC", decimals: 18)
            )

        case .bscMainnet:
            return NetworkConfig(
                chainId: 56,
                name: "BNB Smart Chain",
                symbol: "BNB",
                rpcUrls: [
                    "https://bsc-dataseed1.binance.org",
                    "https://bsc.publicnode.com"
                ],
                blockExplorerUrls: ["https://bscscan.com"],
                nativeCurrency: NativeCurrency(name: "BNB", symbol: "BNB", decimals: 18)
            )

        case .bscTestnet:
            return NetworkConfig(
                chainId: 97,
                name: "BNB Testnet",
                symbol: "tBNB",
                rpcUrls: [
                    "https://data-seed-prebsc-1-s1.binance.org:8545",
                    "https://bsc-testnet.publicnode.com"
                ],
                blockExplorerUrls: ["https://testnet.bscscan.com"],
                nativeCurrency: NativeCurrency(name: "Test BNB", symbol: "tBNB", decimals: 18)
            )

        case .arbitrumOne:
            return NetworkConfig(
                chainId: 42161,
                name: "Arbitrum One",
                symbol: "ETH",
                rpcUrls: [
                    "https://arb1.arbitrum.io/rpc",
                    "https://arbitrum-one.publicnode.com"
                ],
                blockExplorerUrls: ["https://arbiscan.io"],
                nativeCurrency: NativeCurrency(name: "Ether", symbol: "ETH", decimals: 18)
            )

        case .arbitrumSepolia:
            return NetworkConfig(
                chainId: 421614,
                name: "Arbitrum Sepolia",
                symbol: "ETH",
                rpcUrls: [
                    "https://sepolia-rollup.arbitrum.io/rpc",
                    "https://arbitrum-sepolia.publicnode.com"
                ],
                blockExplorerUrls: ["https://sepolia.arbiscan.io"],
                nativeCurrency: NativeCurrency(name: "Sepolia Ether", symbol: "ETH", decimals: 18)
            )

        case .optimismMainnet:
            return NetworkConfig(
                chainId: 10,
                name: "Optimism",
                symbol: "ETH",
                rpcUrls: [
                    "https://mainnet.optimism.io",
                    "https://optimism.publicnode.com"
                ],
                blockExplorerUrls: ["https://optimistic.etherscan.io"],
                nativeCurrency: NativeCurrency(name: "Ether", symbol: "ETH", decimals: 18)
            )

        case .optimismSepolia:
            return NetworkConfig(
                chainId: 11155420,
                name: "Optimism Sepolia",
                symbol: "ETH",
                rpcUrls: [
                    "https://sepolia.optimism.io",
                    "https://optimism-sepolia.publicnode.com"
                ],
                blockExplorerUrls: ["https://sepolia-optimism.etherscan.io"],
                nativeCurrency: NativeCurrency(name: "Sepolia Ether", symbol: "ETH", decimals: 18)
            )

        case .avalancheCChain:
            return NetworkConfig(
                chainId: 43114,
                name: "Avalanche C-Chain",
                symbol: "AVAX",
                rpcUrls: [
                    "https://api.avax.network/ext/bc/C/rpc",
                    "https://avalanche.publicnode.com"
                ],
                blockExplorerUrls: ["https://snowtrace.io"],
                nativeCurrency: NativeCurrency(name: "Avalanche", symbol: "AVAX", decimals: 18)
            )

        case .avalancheFuji:
            return NetworkConfig(
                chainId: 43113,
                name: "Avalanche Fuji",
                symbol: "AVAX",
                rpcUrls: [
                    "https://api.avax-test.network/ext/bc/C/rpc",
                    "https://avalanche-fuji-c-chain.publicnode.com"
                ],
                blockExplorerUrls: ["https://testnet.snowtrace.io"],
                nativeCurrency: NativeCurrency(name: "Avalanche", symbol: "AVAX", decimals: 18)
            )

        case .baseMainnet:
            return NetworkConfig(
                chainId: 8453,
                name: "Base",
                symbol: "ETH",
                rpcUrls: [
                    "https://mainnet.base.org",
                    "https://base.publicnode.com"
                ],
                blockExplorerUrls: ["https://basescan.org"],
                nativeCurrency: NativeCurrency(name: "Ether", symbol: "ETH", decimals: 18)
            )

        case .baseSepolia:
            return NetworkConfig(
                chainId: 84532,
                name: "Base Sepolia",
                symbol: "ETH",
                rpcUrls: [
                    "https://sepolia.base.org",
                    "https://base-sepolia.publicnode.com"
                ],
                blockExplorerUrls: ["https://sepolia.basescan.org"],
                nativeCurrency: NativeCurrency(name: "Sepolia Ether", symbol: "ETH", decimals: 18)
            )

        case .hardhatLocal:
            return NetworkConfig(
                chainId: 31337,
                name: "Hardhat Local",
                symbol: "ETH",
                rpcUrls: ["http://127.0.0.1:8545"],
                blockExplorerUrls: [],
                nativeCurrency: NativeCurrency(name: "Ether", symbol: "ETH", decimals: 18)
            )
        }
    }

    /// 获取RPC URL
    var rpcUrl: String {
        rpcUrls.first ?? ""
    }

    /// 获取交易浏览器URL
    func explorerUrl(for txHash: String) -> String? {
        guard let baseUrl = blockExplorerUrls.first else { return nil }
        return "\(baseUrl)/tx/\(txHash)"
    }

    /// 获取地址浏览器URL
    func addressExplorerUrl(for address: String) -> String? {
        guard let baseUrl = blockExplorerUrls.first else { return nil }
        return "\(baseUrl)/address/\(address)"
    }
}

/// Gas价格配置（Gwei）
struct GasConfig {
    let slow: Double
    let standard: Double
    let fast: Double

    static func config(for chain: SupportedChain) -> GasConfig {
        switch chain {
        case .ethereumMainnet:
            return GasConfig(slow: 20, standard: 30, fast: 50)
        case .polygonMainnet:
            return GasConfig(slow: 30, standard: 40, fast: 60)
        case .bscMainnet:
            return GasConfig(slow: 3, standard: 5, fast: 10)
        case .arbitrumOne, .arbitrumSepolia:
            return GasConfig(slow: 0.1, standard: 0.1, fast: 0.1)
        case .optimismMainnet, .optimismSepolia:
            return GasConfig(slow: 0.001, standard: 0.001, fast: 0.001)
        case .avalancheCChain, .avalancheFuji:
            return GasConfig(slow: 25, standard: 25, fast: 25)
        case .baseMainnet, .baseSepolia:
            return GasConfig(slow: 0.001, standard: 0.001, fast: 0.001)
        case .ethereumSepolia, .polygonMumbai:
            return GasConfig(slow: 1, standard: 2, fast: 3)
        case .bscTestnet:
            return GasConfig(slow: 10, standard: 10, fast: 10)
        case .hardhatLocal:
            return GasConfig(slow: 1, standard: 1, fast: 1)
        }
    }
}
