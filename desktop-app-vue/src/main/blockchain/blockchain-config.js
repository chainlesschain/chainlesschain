/**
 * 区块链网络配置
 *
 * 定义支持的区块链网络、RPC端点、链ID等配置
 */

/**
 * 支持的区块链网络
 */
const SupportedChains = {
  ETHEREUM_MAINNET: 1,
  ETHEREUM_SEPOLIA: 11155111,
  POLYGON_MAINNET: 137,
  POLYGON_MUMBAI: 80001,
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
