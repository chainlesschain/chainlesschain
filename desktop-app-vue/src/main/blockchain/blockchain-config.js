/**
 * 区块链网络配置
 *
 * 定义支持的区块链网络、RPC端点、链ID等配置
 */

/**
 * 支持的区块链网络
 */
const SupportedChains = {
  // Ethereum
  ETHEREUM_MAINNET: 1,
  ETHEREUM_SEPOLIA: 11155111,

  // Polygon
  POLYGON_MAINNET: 137,
  POLYGON_MUMBAI: 80001,

  // BSC (Binance Smart Chain)
  BSC_MAINNET: 56,
  BSC_TESTNET: 97,

  // Arbitrum
  ARBITRUM_ONE: 42161,
  ARBITRUM_SEPOLIA: 421614,

  // Optimism
  OPTIMISM_MAINNET: 10,
  OPTIMISM_SEPOLIA: 11155420,

  // Avalanche
  AVALANCHE_C_CHAIN: 43114,
  AVALANCHE_FUJI: 43113,

  // Base
  BASE_MAINNET: 8453,
  BASE_SEPOLIA: 84532,

  // Local
  HARDHAT_LOCAL: 31337,
};

/**
 * 网络配置
 */
const NetworkConfigs = {
  [SupportedChains.ETHEREUM_MAINNET]: {
    chainId: 1,
    name: "Ethereum Mainnet",
    symbol: "ETH",
    rpcUrls: [
      process.env.ETHEREUM_RPC_URL || "https://eth-mainnet.g.alchemy.com/v2/your-api-key",
      "https://eth.llamarpc.com",
      "https://ethereum.publicnode.com",
    ],
    blockExplorerUrls: ["https://etherscan.io"],
    nativeCurrency: {
      name: "Ether",
      symbol: "ETH",
      decimals: 18,
    },
  },
  [SupportedChains.ETHEREUM_SEPOLIA]: {
    chainId: 11155111,
    name: "Ethereum Sepolia Testnet",
    symbol: "ETH",
    rpcUrls: [
      process.env.SEPOLIA_RPC_URL || "https://eth-sepolia.g.alchemy.com/v2/your-api-key",
      "https://rpc.sepolia.org",
      "https://ethereum-sepolia.publicnode.com",
    ],
    blockExplorerUrls: ["https://sepolia.etherscan.io"],
    nativeCurrency: {
      name: "Sepolia Ether",
      symbol: "ETH",
      decimals: 18,
    },
  },
  [SupportedChains.POLYGON_MAINNET]: {
    chainId: 137,
    name: "Polygon Mainnet",
    symbol: "MATIC",
    rpcUrls: [
      process.env.POLYGON_RPC_URL || "https://polygon-mainnet.g.alchemy.com/v2/your-api-key",
      "https://polygon.llamarpc.com",
      "https://polygon-bor.publicnode.com",
    ],
    blockExplorerUrls: ["https://polygonscan.com"],
    nativeCurrency: {
      name: "MATIC",
      symbol: "MATIC",
      decimals: 18,
    },
  },
  [SupportedChains.POLYGON_MUMBAI]: {
    chainId: 80001,
    name: "Polygon Mumbai Testnet",
    symbol: "MATIC",
    rpcUrls: [
      process.env.MUMBAI_RPC_URL || "https://polygon-mumbai.g.alchemy.com/v2/your-api-key",
      "https://rpc-mumbai.maticvigil.com",
      "https://polygon-mumbai-bor.publicnode.com",
    ],
    blockExplorerUrls: ["https://mumbai.polygonscan.com"],
    nativeCurrency: {
      name: "MATIC",
      symbol: "MATIC",
      decimals: 18,
    },
  },
  [SupportedChains.HARDHAT_LOCAL]: {
    chainId: 31337,
    name: "Hardhat Local",
    symbol: "ETH",
    rpcUrls: ["http://127.0.0.1:8545"],
    blockExplorerUrls: [],
    nativeCurrency: {
      name: "Ether",
      symbol: "ETH",
      decimals: 18,
    },
  },
  // BSC
  [SupportedChains.BSC_MAINNET]: {
    chainId: 56,
    name: "BNB Smart Chain",
    symbol: "BNB",
    rpcUrls: [
      process.env.BSC_RPC_URL || "https://bsc-dataseed1.binance.org",
      "https://bsc-dataseed2.binance.org",
      "https://bsc-dataseed3.binance.org",
      "https://bsc.publicnode.com",
    ],
    blockExplorerUrls: ["https://bscscan.com"],
    nativeCurrency: {
      name: "BNB",
      symbol: "BNB",
      decimals: 18,
    },
  },
  [SupportedChains.BSC_TESTNET]: {
    chainId: 97,
    name: "BNB Smart Chain Testnet",
    symbol: "tBNB",
    rpcUrls: [
      process.env.BSC_TESTNET_RPC_URL || "https://data-seed-prebsc-1-s1.binance.org:8545",
      "https://data-seed-prebsc-2-s1.binance.org:8545",
      "https://bsc-testnet.publicnode.com",
    ],
    blockExplorerUrls: ["https://testnet.bscscan.com"],
    nativeCurrency: {
      name: "Test BNB",
      symbol: "tBNB",
      decimals: 18,
    },
  },
  // Arbitrum
  [SupportedChains.ARBITRUM_ONE]: {
    chainId: 42161,
    name: "Arbitrum One",
    symbol: "ETH",
    rpcUrls: [
      process.env.ARBITRUM_RPC_URL || "https://arb1.arbitrum.io/rpc",
      "https://arbitrum.llamarpc.com",
      "https://arbitrum-one.publicnode.com",
    ],
    blockExplorerUrls: ["https://arbiscan.io"],
    nativeCurrency: {
      name: "Ether",
      symbol: "ETH",
      decimals: 18,
    },
  },
  [SupportedChains.ARBITRUM_SEPOLIA]: {
    chainId: 421614,
    name: "Arbitrum Sepolia",
    symbol: "ETH",
    rpcUrls: [
      process.env.ARBITRUM_SEPOLIA_RPC_URL || "https://sepolia-rollup.arbitrum.io/rpc",
      "https://arbitrum-sepolia.publicnode.com",
    ],
    blockExplorerUrls: ["https://sepolia.arbiscan.io"],
    nativeCurrency: {
      name: "Sepolia Ether",
      symbol: "ETH",
      decimals: 18,
    },
  },
  // Optimism
  [SupportedChains.OPTIMISM_MAINNET]: {
    chainId: 10,
    name: "Optimism",
    symbol: "ETH",
    rpcUrls: [
      process.env.OPTIMISM_RPC_URL || "https://mainnet.optimism.io",
      "https://optimism.llamarpc.com",
      "https://optimism.publicnode.com",
    ],
    blockExplorerUrls: ["https://optimistic.etherscan.io"],
    nativeCurrency: {
      name: "Ether",
      symbol: "ETH",
      decimals: 18,
    },
  },
  [SupportedChains.OPTIMISM_SEPOLIA]: {
    chainId: 11155420,
    name: "Optimism Sepolia",
    symbol: "ETH",
    rpcUrls: [
      process.env.OPTIMISM_SEPOLIA_RPC_URL || "https://sepolia.optimism.io",
      "https://optimism-sepolia.publicnode.com",
    ],
    blockExplorerUrls: ["https://sepolia-optimism.etherscan.io"],
    nativeCurrency: {
      name: "Sepolia Ether",
      symbol: "ETH",
      decimals: 18,
    },
  },
  // Avalanche
  [SupportedChains.AVALANCHE_C_CHAIN]: {
    chainId: 43114,
    name: "Avalanche C-Chain",
    symbol: "AVAX",
    rpcUrls: [
      process.env.AVALANCHE_RPC_URL || "https://api.avax.network/ext/bc/C/rpc",
      "https://avalanche.publicnode.com",
      "https://avalanche-c-chain.publicnode.com",
    ],
    blockExplorerUrls: ["https://snowtrace.io"],
    nativeCurrency: {
      name: "Avalanche",
      symbol: "AVAX",
      decimals: 18,
    },
  },
  [SupportedChains.AVALANCHE_FUJI]: {
    chainId: 43113,
    name: "Avalanche Fuji Testnet",
    symbol: "AVAX",
    rpcUrls: [
      process.env.AVALANCHE_FUJI_RPC_URL || "https://api.avax-test.network/ext/bc/C/rpc",
      "https://avalanche-fuji-c-chain.publicnode.com",
    ],
    blockExplorerUrls: ["https://testnet.snowtrace.io"],
    nativeCurrency: {
      name: "Avalanche",
      symbol: "AVAX",
      decimals: 18,
    },
  },
  // Base
  [SupportedChains.BASE_MAINNET]: {
    chainId: 8453,
    name: "Base",
    symbol: "ETH",
    rpcUrls: [
      process.env.BASE_RPC_URL || "https://mainnet.base.org",
      "https://base.llamarpc.com",
      "https://base.publicnode.com",
    ],
    blockExplorerUrls: ["https://basescan.org"],
    nativeCurrency: {
      name: "Ether",
      symbol: "ETH",
      decimals: 18,
    },
  },
  [SupportedChains.BASE_SEPOLIA]: {
    chainId: 84532,
    name: "Base Sepolia",
    symbol: "ETH",
    rpcUrls: [
      process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org",
      "https://base-sepolia.publicnode.com",
    ],
    blockExplorerUrls: ["https://sepolia.basescan.org"],
    nativeCurrency: {
      name: "Sepolia Ether",
      symbol: "ETH",
      decimals: 18,
    },
  },
};

/**
 * Gas 价格配置（Gwei）
 */
const GasConfigs = {
  [SupportedChains.ETHEREUM_MAINNET]: {
    slow: 20,
    standard: 30,
    fast: 50,
  },
  [SupportedChains.POLYGON_MAINNET]: {
    slow: 30,
    standard: 40,
    fast: 60,
  },
  [SupportedChains.ETHEREUM_SEPOLIA]: {
    slow: 1,
    standard: 2,
    fast: 3,
  },
  [SupportedChains.POLYGON_MUMBAI]: {
    slow: 1,
    standard: 2,
    fast: 3,
  },
  [SupportedChains.BSC_MAINNET]: {
    slow: 3,
    standard: 5,
    fast: 10,
  },
  [SupportedChains.BSC_TESTNET]: {
    slow: 10,
    standard: 10,
    fast: 10,
  },
  [SupportedChains.ARBITRUM_ONE]: {
    slow: 0.1,
    standard: 0.1,
    fast: 0.1,
  },
  [SupportedChains.ARBITRUM_SEPOLIA]: {
    slow: 0.1,
    standard: 0.1,
    fast: 0.1,
  },
  [SupportedChains.OPTIMISM_MAINNET]: {
    slow: 0.001,
    standard: 0.001,
    fast: 0.001,
  },
  [SupportedChains.OPTIMISM_SEPOLIA]: {
    slow: 0.001,
    standard: 0.001,
    fast: 0.001,
  },
  [SupportedChains.AVALANCHE_C_CHAIN]: {
    slow: 25,
    standard: 25,
    fast: 25,
  },
  [SupportedChains.AVALANCHE_FUJI]: {
    slow: 25,
    standard: 25,
    fast: 25,
  },
  [SupportedChains.BASE_MAINNET]: {
    slow: 0.001,
    standard: 0.001,
    fast: 0.001,
  },
  [SupportedChains.BASE_SEPOLIA]: {
    slow: 0.001,
    standard: 0.001,
    fast: 0.001,
  },
};

/**
 * 合约地址配置（部署后填写）
 */
const ContractAddresses = {
  [SupportedChains.ETHEREUM_MAINNET]: {
    escrow: null,
    tokenFactory: null,
    nftFactory: null,
    bridge: null,
  },
  [SupportedChains.POLYGON_MAINNET]: {
    escrow: null,
    tokenFactory: null,
    nftFactory: null,
    bridge: null,
  },
  [SupportedChains.ETHEREUM_SEPOLIA]: {
    escrow: null,
    tokenFactory: null,
    nftFactory: null,
    bridge: null,
  },
  [SupportedChains.POLYGON_MUMBAI]: {
    escrow: null,
    tokenFactory: null,
    nftFactory: null,
    bridge: null,
  },
  [SupportedChains.BSC_MAINNET]: {
    escrow: null,
    tokenFactory: null,
    nftFactory: null,
    bridge: null,
  },
  [SupportedChains.BSC_TESTNET]: {
    escrow: null,
    tokenFactory: null,
    nftFactory: null,
    bridge: null,
  },
  [SupportedChains.ARBITRUM_ONE]: {
    escrow: null,
    tokenFactory: null,
    nftFactory: null,
    bridge: null,
  },
  [SupportedChains.ARBITRUM_SEPOLIA]: {
    escrow: null,
    tokenFactory: null,
    nftFactory: null,
    bridge: null,
  },
  [SupportedChains.OPTIMISM_MAINNET]: {
    escrow: null,
    tokenFactory: null,
    nftFactory: null,
    bridge: null,
  },
  [SupportedChains.OPTIMISM_SEPOLIA]: {
    escrow: null,
    tokenFactory: null,
    nftFactory: null,
    bridge: null,
  },
  [SupportedChains.AVALANCHE_C_CHAIN]: {
    escrow: null,
    tokenFactory: null,
    nftFactory: null,
    bridge: null,
  },
  [SupportedChains.AVALANCHE_FUJI]: {
    escrow: null,
    tokenFactory: null,
    nftFactory: null,
    bridge: null,
  },
  [SupportedChains.BASE_MAINNET]: {
    escrow: null,
    tokenFactory: null,
    nftFactory: null,
    bridge: null,
  },
  [SupportedChains.BASE_SEPOLIA]: {
    escrow: null,
    tokenFactory: null,
    nftFactory: null,
    bridge: null,
  },
};

/**
 * 获取网络配置
 * @param {number} chainId - 链ID
 * @returns {object} 网络配置
 */
function getNetworkConfig(chainId) {
  const config = NetworkConfigs[chainId];
  if (!config) {
    throw new Error(`Unsupported chain ID: ${chainId}`);
  }
  return config;
}

/**
 * 获取RPC URL
 * @param {number} chainId - 链ID
 * @returns {string} RPC URL
 */
function getRpcUrl(chainId) {
  const config = getNetworkConfig(chainId);
  return config.rpcUrls[0];
}

/**
 * 检查链是否支持
 * @param {number} chainId - 链ID
 * @returns {boolean} 是否支持
 */
function isChainSupported(chainId) {
  return NetworkConfigs[chainId] !== undefined;
}

/**
 * 获取区块浏览器 URL
 * @param {number} chainId - 链ID
 * @param {string} txHash - 交易哈希
 * @returns {string} 区块浏览器 URL
 */
function getExplorerUrl(chainId, txHash) {
  const config = getNetworkConfig(chainId);
  if (config.blockExplorerUrls.length === 0) {
    return null;
  }
  return `${config.blockExplorerUrls[0]}/tx/${txHash}`;
}

/**
 * 获取地址浏览器 URL
 * @param {number} chainId - 链ID
 * @param {string} address - 地址
 * @returns {string} 区块浏览器 URL
 */
function getAddressExplorerUrl(chainId, address) {
  const config = getNetworkConfig(chainId);
  if (config.blockExplorerUrls.length === 0) {
    return null;
  }
  return `${config.blockExplorerUrls[0]}/address/${address}`;
}

module.exports = {
  SupportedChains,
  NetworkConfigs,
  GasConfigs,
  ContractAddresses,
  getNetworkConfig,
  getRpcUrl,
  isChainSupported,
  getExplorerUrl,
  getAddressExplorerUrl,
};
