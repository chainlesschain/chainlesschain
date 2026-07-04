/**
 * Pure helpers extracted from TransactionDetailModal.vue (opportunistic split).
 * Block-explorer URL + network name by chain id, status icon/title/color/text,
 * type color/text, and datetime/gas/JSON formatting. No reactive state.
 */

export const getBlockExplorerUrl = (chainId, type, value) => {
  const explorers = {
    1: "https://etherscan.io",
    11155111: "https://sepolia.etherscan.io",
    137: "https://polygonscan.com",
    80001: "https://mumbai.polygonscan.com",
    56: "https://bscscan.com",
    97: "https://testnet.bscscan.com",
    42161: "https://arbiscan.io",
    421613: "https://goerli.arbiscan.io",
    10: "https://optimistic.etherscan.io",
    420: "https://goerli-optimism.etherscan.io",
    43114: "https://snowtrace.io",
    43113: "https://testnet.snowtrace.io",
    250: "https://ftmscan.com",
    4002: "https://testnet.ftmscan.com",
    100: "https://gnosisscan.io",
    31337: null,
  };

  const baseUrl = explorers[chainId];
  if (!baseUrl) {
    return null;
  }

  const paths = {
    address: "address",
    tx: "tx",
    block: "block",
  };

  return `${baseUrl}/${paths[type]}/${value}`;
};

export const getNetworkName = (chainId) => {
  const networks = {
    1: "以太坊主网",
    11155111: "Sepolia测试网",
    137: "Polygon主网",
    80001: "Mumbai测试网",
    56: "BSC主网",
    97: "BSC测试网",
    42161: "Arbitrum One",
    421613: "Arbitrum Goerli",
    10: "Optimism",
    420: "Optimism Goerli",
    43114: "Avalanche C-Chain",
    43113: "Avalanche Fuji",
    250: "Fantom Opera",
    4002: "Fantom Testnet",
    100: "Gnosis Chain",
    31337: "Hardhat本地网络",
  };
  return networks[chainId] || `Chain ${chainId}`;
};

export const getStatusIcon = (status) => {
  const icons = {
    pending: "info",
    confirmed: "success",
    success: "success",
    failed: "error",
    error: "error",
  };
  return icons[status] || "info";
};

export const getStatusTitle = (status) => {
  const titles = {
    pending: "交易待确认",
    confirmed: "交易已确认",
    success: "交易成功",
    failed: "交易失败",
    error: "交易错误",
  };
  return titles[status] || "未知状态";
};

export const getStatusColor = (status) => {
  const colors = {
    pending: "processing",
    confirmed: "success",
    success: "success",
    failed: "error",
    error: "error",
  };
  return colors[status] || "default";
};

export const getStatusText = (status) => {
  const texts = {
    pending: "待确认",
    confirmed: "已确认",
    success: "成功",
    failed: "失败",
    error: "错误",
  };
  return texts[status] || status;
};

export const getTypeColor = (type) => {
  const colors = {
    transfer: "blue",
    deploy: "purple",
    mint: "green",
    burn: "orange",
    approve: "cyan",
    swap: "magenta",
  };
  return colors[type] || "default";
};

export const getTypeText = (type) => {
  const texts = {
    transfer: "转账",
    deploy: "部署合约",
    mint: "铸造",
    burn: "销毁",
    approve: "授权",
    swap: "交换",
  };
  return texts[type] || type;
};

export const formatDateTime = (timestamp) => {
  if (!timestamp) {
    return "-";
  }
  const date = new Date(timestamp);
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
};

export const formatGas = (gasUsed, gasPrice) => {
  if (!gasUsed || !gasPrice) {
    return "-";
  }
  const gasCost = (gasUsed * gasPrice) / 1e18;
  return `${gasCost.toFixed(6)} ETH`;
};

export const formatJSON = (data) => {
  try {
    if (typeof data === "string") {
      return JSON.stringify(JSON.parse(data), null, 2);
    }
    return JSON.stringify(data, null, 2);
  } catch {
    return data;
  }
};
