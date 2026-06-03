"use strict";

/**
 * Transaction parser — decodes raw tx parameters into structured format
 * Extracts method names, ABI parameters, and normalizes values for risk analysis
 */

/**
 * Supported chains with their configurations
 */
const SUPPORTED_CHAINS = {
  ethereum: {
    chainId: 1,
    symbol: "ETH",
    decimals: 18,
    rpcUrl: "https://eth.llamarpc.com",
  },
  polygon: {
    chainId: 137,
    symbol: "MATIC",
    decimals: 18,
    rpcUrl: "https://polygon.llamarpc.com",
  },
  bsc: {
    chainId: 56,
    symbol: "BNB",
    decimals: 18,
    rpcUrl: "https://bsc-dataseed1.binance.org",
  },
  avalanche: {
    chainId: 43114,
    symbol: "AVAX",
    decimals: 18,
    rpcUrl: "https://api.avax.network/ext/bc/C/rpc",
  },
  arbitrum: {
    chainId: 42161,
    symbol: "ETH",
    decimals: 18,
    rpcUrl: "https://arb1.arbitrum.io/rpc",
  },
  optimism: {
    chainId: 10,
    symbol: "ETH",
    decimals: 18,
    rpcUrl: "https://mainnet.optimism.io",
  },
  solana: {
    chainId: null,
    symbol: "SOL",
    decimals: 9,
    rpcUrl: "https://api.mainnet-beta.solana.com",
  },
  bitcoin: {
    chainId: null,
    symbol: "BTC",
    decimals: 8,
    rpcUrl: "https://blockstream.info/api",
  },
};

/**
 * 4-byte method selectors mapped to human-readable method names (40+ entries)
 * Key: '0x' + 4-byte hex selector
 */
const KNOWN_METHODS = {
  // ERC-20 core
  "0xa9059cbb": "transfer",
  "0x23b872dd": "transferFrom",
  "0x095ea7b3": "approve",
  "0xd505accf": "permit",
  // WETH
  "0x2e1a7d4d": "withdraw",
  "0xd0e30db0": "deposit",
  // Uniswap v2
  "0x18cbafe5": "swapExactTokensForETH",
  "0x38ed1739": "swapExactTokensForTokens",
  "0x7ff36ab5": "swapExactETHForTokens",
  "0x5c11d795": "swapExactTokensForTokensSupportingFeeOnTransferTokens",
  "0xfb3bdb41": "swapETHForExactTokens",
  "0x4a25d94a": "swapTokensForExactETH",
  "0xe8e33700": "addLiquidity",
  "0xf305d719": "addLiquidityETH",
  "0xbaa2abde": "removeLiquidity",
  "0x02751cec": "removeLiquidityETH",
  "0x0902f1ac": "getReserves",
  // Uniswap v3
  "0x04e45aaf": "exactInputSingle",
  "0xdb3e2198": "exactOutputSingle",
  "0xb858183f": "exactInput",
  "0x09b81346": "exactOutput",
  "0xe449022e": "uniswapV3Swap",
  "0x5ae401dc": "multicall",
  "0x3593564c": "execute",
  "0xac9650d8": "multicall",
  "0x12aa3caf": "swap",
  // ERC-721 / NFT
  "0x42842e0e": "safeTransferFrom",
  "0xb88d4fde": "safeTransferFrom",
  "0x6352211e": "ownerOf",
  "0x081812fc": "getApproved",
  "0xa22cb465": "setApprovalForAll",
  "0xe985e9c5": "isApprovedForAll",
  // ERC-20 view
  "0x70a08231": "balanceOf",
  "0xdd62ed3e": "allowance",
  "0x06fdde03": "name",
  "0x95d89b41": "symbol",
  "0x313ce567": "decimals",
  "0x18160ddd": "totalSupply",
  // Mint / Burn
  "0x40c10f19": "mint",
  "0xa0712d68": "mint",
  "0x6a627842": "mint",
  "0x1249c58b": "mint",
  "0x42966c68": "burn",
  // DeFi lending
  "0xe8eda9df": "deposit",
  "0x69328dec": "withdraw",
  "0xc5ebeaec": "borrow",
  "0x573ade81": "repay",
  // Ownership
  "0xf2fde38b": "transferOwnership",
  "0x715018a6": "renounceOwnership",
  "0x8da5cb5b": "owner",
};

/**
 * Convert a raw value (hex wei, decimal wei string, or ETH float string) to decimal ETH
 * @param {string|number|bigint|undefined} value
 * @returns {string} decimal ETH value
 */
function normalizeValue(value) {
  if (
    value === undefined ||
    value === null ||
    value === "" ||
    value === "0x" ||
    value === "0x0" ||
    value === "0"
  ) {
    return "0";
  }

  if (typeof value === "bigint") {
    return (Number(value) / 1e18).toString();
  }

  if (typeof value === "number") {
    return value > 1e15 ? (value / 1e18).toString() : value.toString();
  }

  const str = String(value).trim();

  // Hex → wei
  if (str.startsWith("0x") || str.startsWith("0X")) {
    try {
      const wei = BigInt(str);
      if (wei === 0n) {
        return "0";
      }
      const unit = BigInt("1000000000000000000");
      const ethInt = wei / unit;
      const ethFrac = wei % unit;
      if (ethFrac === 0n) {
        return ethInt.toString();
      }
      return `${ethInt}.${ethFrac.toString().padStart(18, "0").replace(/0+$/, "")}`;
    } catch {
      return "0";
    }
  }

  // Has decimal point → already in ETH units
  if (str.includes(".")) {
    return str;
  }

  // Large decimal integer → treat as wei
  try {
    const bigVal = BigInt(str);
    const unit = BigInt("1000000000000000000");
    if (bigVal > BigInt("100000000000000000")) {
      const ethInt = bigVal / unit;
      const ethFrac = bigVal % unit;
      if (ethFrac === 0n) {
        return ethInt.toString();
      }
      return `${ethInt}.${ethFrac.toString().padStart(18, "0").replace(/0+$/, "")}`;
    }
    return str;
  } catch {
    return str;
  }
}

/**
 * Decode ABI-encoded parameters from calldata (skipping 4-byte selector)
 * Handles address (20-byte right-aligned), uint256, bytes32
 * @param {string} data - full hex calldata including '0x' prefix
 * @param {string} [_methodId] - selector (reserved for future typed decoding)
 * @returns {string[]} decoded parameter values as strings
 */
function decodeABI(data, _methodId) {
  if (!data || data.length <= 10) {
    return [];
  }

  const payload = data.slice(10); // skip '0x' + 8 selector hex chars
  const result = [];

  for (let i = 0; i < payload.length; i += 64) {
    const chunk = payload.slice(i, i + 64);
    if (chunk.length < 64) {
      break;
    }

    // Address detection: leading 24 zeros, then 40-char hex address
    const prefix24 = chunk.slice(0, 24);
    const addrPart = chunk.slice(24);
    if (/^0{24}$/.test(prefix24) && /^[0-9a-fA-F]{40}$/.test(addrPart)) {
      try {
        if (BigInt("0x" + addrPart) !== 0n) {
          result.push("0x" + addrPart.toLowerCase());
          continue;
        }
      } catch {
        /* fall through to uint decode */
      }
    }

    // uint256 or other: hex big-int
    const stripped = chunk.replace(/^0+/, "") || "0";
    result.push("0x" + stripped);
  }

  return result;
}

/**
 * Parse raw transaction parameters into structured format
 * @param {object} txParams - { to, from, value, data, input, gasLimit, gas, gasPrice, nonce }
 * @param {string} [chain='ethereum']
 * @returns {{ chain, chainId, to, from, value, data, methodId, methodName, params, gasLimit, gasPrice, nonce }}
 */
function parseTx(txParams, chain = "ethereum") {
  const chainInfo = SUPPORTED_CHAINS[chain] || SUPPORTED_CHAINS.ethereum;
  const data = txParams.data || txParams.input || "";

  let methodId = null;
  let methodName = null;
  let params = [];

  if (data && data.length >= 10 && data !== "0x") {
    methodId = data.slice(0, 10).toLowerCase();
    methodName = KNOWN_METHODS[methodId] || "unknown";
    params = decodeABI(data, methodId);
  }

  return {
    chain,
    chainId: chainInfo.chainId,
    to: txParams.to || null,
    from: txParams.from || null,
    value: normalizeValue(txParams.value),
    data,
    methodId,
    methodName,
    params,
    gasLimit: txParams.gasLimit || txParams.gas || 21000,
    gasPrice: txParams.gasPrice || null,
    nonce: txParams.nonce || 0,
  };
}

module.exports = { parseTx, decodeABI, KNOWN_METHODS, SUPPORTED_CHAINS };
