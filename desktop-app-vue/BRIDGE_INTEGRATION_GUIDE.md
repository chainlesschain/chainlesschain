# Blockchain Bridge Integration Guide

This guide explains how to integrate real cross-chain bridge protocols with ChainlessChain.

## Current Status

The bridge manager currently has **mock fallbacks** for development/testing. This guide shows how to integrate production bridge solutions.

## Supported Bridge Protocols

### 1. LayerZero (Recommended)

**Why LayerZero:**
- Omnichain messaging protocol
- Supports 50+ blockchains
- Battle-tested with $6B+ TVL
- Developer-friendly SDK

**Integration Steps:**

```bash
# Install LayerZero SDK
npm install @layerzerolabs/lz-sdk
```

**Configuration:**

```javascript
// src/main/blockchain/bridges/layerzero-bridge.js
const { LayerZero } = require('@layerzerolabs/lz-sdk');

class LayerZeroBridge {
  constructor(config) {
    this.lz = new LayerZero({
      endpoint: config.endpoint,
      chainId: config.chainId
    });
  }

  async bridgeAsset(params) {
    const { fromChain, toChain, asset, amount, recipient } = params;

    // Send cross-chain message
    const tx = await this.lz.send({
      dstChainId: toChain,
      dstAddress: recipient,
      payload: this.encodeTransferPayload(asset, amount),
      refundAddress: params.refundAddress,
      zroPaymentAddress: ethers.ZeroAddress,
      adapterParams: '0x'
    });

    return tx.hash;
  }
}
```

### 2. Chainlink CCIP

**Why Chainlink CCIP:**
- Secure cross-chain messaging
- Backed by Chainlink oracles
- Enterprise-grade reliability

**Integration:**

```bash
npm install @chainlink/contracts-ccip
```

```javascript
// src/main/blockchain/bridges/chainlink-ccip-bridge.js
const { CCIPRouter } = require('@chainlink/contracts-ccip');

class ChainlinkCCIPBridge {
  constructor(config) {
    this.router = new CCIPRouter(config.routerAddress);
  }

  async bridgeAsset(params) {
    const message = {
      receiver: params.recipient,
      data: this.encodeData(params),
      tokenAmounts: [{
        token: params.asset,
        amount: params.amount
      }],
      feeToken: params.feeToken,
      extraArgs: '0x'
    };

    const tx = await this.router.ccipSend(
      params.destinationChainSelector,
      message
    );

    return tx.hash;
  }
}
```

### 3. Axelar Network

**Why Axelar:**
- Universal interoperability
- Supports 50+ chains
- Programmable cross-chain calls

**Integration:**

```bash
npm install @axelar-network/axelarjs-sdk
```

```javascript
// src/main/blockchain/bridges/axelar-bridge.js
const { AxelarAssetTransfer } = require('@axelar-network/axelarjs-sdk');

class AxelarBridge {
  constructor(config) {
    this.transfer = new AxelarAssetTransfer({
      environment: config.environment // 'mainnet' or 'testnet'
    });
  }

  async bridgeAsset(params) {
    const tx = await this.transfer.sendToken({
      fromChain: params.fromChain,
      toChain: params.toChain,
      destinationAddress: params.recipient,
      asset: params.asset,
      amount: params.amount
    });

    return tx.transactionHash;
  }
}
```

## Implementation Plan

### Phase 1: Bridge Adapter Pattern

Create a unified bridge adapter that supports multiple protocols:

```javascript
// src/main/blockchain/bridge-adapter.js
class BridgeAdapter {
  constructor(config) {
    this.bridges = {
      layerzero: new LayerZeroBridge(config.layerzero),
      chainlink: new ChainlinkCCIPBridge(config.chainlink),
      axelar: new AxelarBridge(config.axelar)
    };

    this.defaultBridge = config.defaultBridge || 'layerzero';
  }

  async bridgeAsset(params) {
    const bridge = this.bridges[params.protocol || this.defaultBridge];

    if (!bridge) {
      throw new Error(`Bridge protocol not supported: ${params.protocol}`);
    }

    return bridge.bridgeAsset(params);
  }

  async estimateFee(params) {
    const bridge = this.bridges[params.protocol || this.defaultBridge];
    return bridge.estimateFee(params);
  }

  async getStatus(txHash, protocol) {
    const bridge = this.bridges[protocol || this.defaultBridge];
    return bridge.getStatus(txHash);
  }
}
```

### Phase 2: Update Bridge Manager

Replace mock fallbacks with real bridge calls:

```javascript
// src/main/blockchain/bridge-manager.js

// Remove mock fallbacks
async _lockOnSourceChain(options) {
  try {
    // Real implementation
    const lockTx = await bridgeContract.lockAsset(...);
    await lockTx.wait(1);
    return lockTx.hash;
  } catch (error) {
    // Log error and throw (no mock fallback)
    console.error('[BridgeManager] Lock failed:', error);
    throw new Error(`Bridge lock failed: ${error.message}`);
  }
}

async _mintOnTargetChain(options) {
  try {
    // Use bridge adapter instead of direct contract call
    const txHash = await this.bridgeAdapter.bridgeAsset({
      fromChain: options.sourceChainId,
      toChain: options.chainId,
      asset: options.assetAddress,
      amount: options.amount,
      recipient: options.recipientAddress,
      protocol: options.bridgeProtocol || 'layerzero'
    });

    return txHash;
  } catch (error) {
    console.error('[BridgeManager] Mint failed:', error);
    throw new Error(`Bridge mint failed: ${error.message}`);
  }
}
```

### Phase 3: Configuration

Add bridge configuration to environment:

```javascript
// .env
LAYERZERO_ENDPOINT=0x66A71Dcef29A0fFBDBE3c6a460a3B5BC225Cd675
CHAINLINK_ROUTER=0x80226fc0Ee2b096224EeAc085Bb9a8cba1146f7D
AXELAR_ENVIRONMENT=mainnet

# Bridge preferences
DEFAULT_BRIDGE_PROTOCOL=layerzero
BRIDGE_CONFIRMATION_BLOCKS=2
BRIDGE_TIMEOUT_MS=300000
```

```javascript
// src/main/blockchain/bridge-config.js
module.exports = {
  layerzero: {
    endpoint: process.env.LAYERZERO_ENDPOINT,
    supportedChains: {
      1: 101,      // Ethereum
      56: 102,     // BSC
      137: 109,    // Polygon
      42161: 110,  // Arbitrum
      10: 111      // Optimism
    }
  },

  chainlink: {
    routers: {
      1: '0x80226fc0Ee2b096224EeAc085Bb9a8cba1146f7D',    // Ethereum
      56: '0x34B03Cb9086d7D758AC55af71584F81A598759FE',   // BSC
      137: '0x849c5ED5a80F5B408Dd4969b78c2C8fdf0565Bfe',  // Polygon
      42161: '0x141fa059441E0ca23ce184B6A78bafD2A517DdE8', // Arbitrum
      10: '0x261c05167db67B2b619f9d312e0753f3721ad6E8'    // Optimism
    }
  },

  axelar: {
    environment: process.env.AXELAR_ENVIRONMENT || 'mainnet',
    gasService: '0x2d5d7d31F671F86C782533cc367F14109a082712'
  },

  settings: {
    defaultProtocol: process.env.DEFAULT_BRIDGE_PROTOCOL || 'layerzero',
    confirmationBlocks: parseInt(process.env.BRIDGE_CONFIRMATION_BLOCKS) || 2,
    timeoutMs: parseInt(process.env.BRIDGE_TIMEOUT_MS) || 300000,
    maxRetries: 3,
    retryDelayMs: 5000
  }
};
```

## Testing Strategy

### 1. Testnet Testing

Test on testnets before mainnet:

```javascript
// Test configuration
const testConfig = {
  layerzero: {
    endpoint: '0x6Fcb97553D41516Cb228ac03FdC8B9a0a9df04A1', // Goerli
    supportedChains: {
      5: 10121,      // Goerli
      80001: 10109   // Mumbai
    }
  },
  // ... other testnet configs
};
```

### 2. Integration Tests

```javascript
// tests/integration/bridge.test.js
describe('Bridge Integration', () => {
  it('should bridge assets via LayerZero', async () => {
    const result = await bridgeManager.bridgeAsset({
      fromChain: 5,  // Goerli
      toChain: 80001, // Mumbai
      asset: '0x...',
      amount: '1000000000000000000', // 1 token
      recipient: '0x...',
      protocol: 'layerzero'
    });

    expect(result.txHash).toBeDefined();
    expect(result.status).toBe('pending');
  });

  it('should estimate bridge fees', async () => {
    const fee = await bridgeManager.estimateBridgeFee({
      fromChain: 1,
      toChain: 137,
      asset: '0x...',
      amount: '1000000000000000000'
    });

    expect(fee.nativeFee).toBeGreaterThan(0);
  });
});
```

### 3. Monitoring

Add bridge transaction monitoring:

```javascript
// src/main/blockchain/bridge-monitor.js
class BridgeMonitor {
  async monitorTransaction(txHash, protocol) {
    const maxAttempts = 60; // 5 minutes
    let attempts = 0;

    while (attempts < maxAttempts) {
      const status = await this.bridgeAdapter.getStatus(txHash, protocol);

      if (status.completed) {
        return {
          success: true,
          destinationTxHash: status.destinationTxHash,
          completedAt: Date.now()
        };
      }

      if (status.failed) {
        return {
          success: false,
          error: status.error
        };
      }

      await new Promise(resolve => setTimeout(resolve, 5000));
      attempts++;
    }

    throw new Error('Bridge transaction timeout');
  }
}
```

## Security Considerations

### 1. Relayer Security

```javascript
// Only authorized relayers can mint
const RELAYER_ROLE = ethers.keccak256(ethers.toUtf8Bytes('RELAYER_ROLE'));

async function verifyRelayer(address) {
  const hasRole = await bridgeContract.hasRole(RELAYER_ROLE, address);
  if (!hasRole) {
    throw new Error('Not authorized as relayer');
  }
}
```

### 2. Amount Limits

```javascript
// Enforce bridge limits
const BRIDGE_LIMITS = {
  minAmount: ethers.parseEther('0.01'),
  maxAmount: ethers.parseEther('1000'),
  dailyLimit: ethers.parseEther('10000')
};

async function validateBridgeAmount(amount) {
  const amountBN = ethers.parseEther(amount);

  if (amountBN < BRIDGE_LIMITS.minAmount) {
    throw new Error('Amount below minimum');
  }

  if (amountBN > BRIDGE_LIMITS.maxAmount) {
    throw new Error('Amount exceeds maximum');
  }

  // Check daily limit
  const dailyTotal = await getDailyBridgeTotal();
  if (dailyTotal + amountBN > BRIDGE_LIMITS.dailyLimit) {
    throw new Error('Daily limit exceeded');
  }
}
```

### 3. Signature Verification

```javascript
// Verify cross-chain messages
async function verifyBridgeSignature(message, signature) {
  const messageHash = ethers.keccak256(message);
  const recoveredAddress = ethers.recoverAddress(messageHash, signature);

  const isValidRelayer = await bridgeContract.hasRole(
    RELAYER_ROLE,
    recoveredAddress
  );

  if (!isValidRelayer) {
    throw new Error('Invalid signature');
  }

  return true;
}
```

## Migration Path

### Step 1: Deploy Bridge Contracts

```bash
# Deploy LayerZero endpoint contracts
npx hardhat run scripts/deploy-layerzero-bridge.js --network mainnet

# Deploy Chainlink CCIP contracts
npx hardhat run scripts/deploy-chainlink-bridge.js --network mainnet
```

### Step 2: Update Configuration

```javascript
// Update bridge-manager.js to use real contracts
this.bridgeContracts = {
  ethereum: '0x...', // Deployed contract address
  bsc: '0x...',
  polygon: '0x...'
};
```

### Step 3: Remove Mock Fallbacks

```javascript
// Remove all mock fallback code
// Lines 418-426, 521-526 in bridge-manager.js
// Replace with proper error handling
```

### Step 4: Enable Production Mode

```javascript
// .env
BRIDGE_MODE=production
ENABLE_MOCK_FALLBACK=false
```

## Cost Optimization

### 1. Batch Transfers

```javascript
async function batchBridge(transfers) {
  // Combine multiple transfers into one transaction
  const batchTx = await bridgeContract.batchLockAssets(
    transfers.map(t => ({
      asset: t.asset,
      amount: t.amount,
      recipient: t.recipient,
      destChain: t.destChain
    }))
  );

  return batchTx.hash;
}
```

### 2. Gas Optimization

```javascript
// Use optimal gas settings
const gasSettings = {
  maxFeePerGas: await provider.getFeeData().maxFeePerGas,
  maxPriorityFeePerGas: ethers.parseUnits('2', 'gwei'),
  gasLimit: 300000
};
```

## Support & Resources

- **LayerZero Docs**: https://layerzero.gitbook.io/docs/
- **Chainlink CCIP**: https://docs.chain.link/ccip
- **Axelar Docs**: https://docs.axelar.dev/
- **Bridge Security**: https://github.com/0xProject/0x-protocol-specification

## Next Steps

1. Choose bridge protocol (LayerZero recommended)
2. Deploy bridge contracts to testnets
3. Integrate bridge SDK
4. Test thoroughly on testnets
5. Security audit
6. Deploy to mainnet
7. Remove mock fallbacks
8. Monitor bridge transactions

---

**Note**: Mock fallbacks are useful for development but should be removed in production. Always test bridge integrations thoroughly on testnets before mainnet deployment.
