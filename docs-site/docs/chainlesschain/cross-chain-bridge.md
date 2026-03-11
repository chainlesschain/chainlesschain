# 跨链互操作协议

> **版本: v4.2.0 | 状态: ✅ 生产就绪 | 8 IPC Handlers | 3 数据库表 | Phase 89**

ChainlessChain 跨链互操作协议（Cross-Chain Bridge）支持 EVM 兼容链（Ethereum/Polygon/BSC/Arbitrum）与非 EVM 链（Solana/Cosmos IBC）之间的资产桥接，提供 HTLC 原子交换、跨链消息传递和多链统一视图，实现去中心化的跨链价值流通。

## 核心特性

- 🔗 **EVM 链支持**: Ethereum、Polygon、BSC、Arbitrum 等 EVM 兼容链资产桥接
- 🌐 **非 EVM 链支持**: Solana (SPL Token)、Cosmos IBC 协议互操作
- ⚛️ **HTLC 原子交换**: 哈希时间锁定合约，无需信任的跨链资产交换
- 📨 **跨链消息**: 类 LayerZero 的通用跨链消息传递协议
- 📊 **多链统一视图**: 聚合多链资产余额和交易历史

## 系统架构

```
┌───────────────────────────────────────────────────┐
│                  应用层 (IPC)                       │
│  bridge-asset │ atomic-swap │ send-message │ ...  │
├───────────────┴──────────┬────────────────────────┤
│         Cross-Chain Bridge Core                    │
├──────────┬───────────────┼────────────────────────┤
│  HTLC    │  消息中继器    │  多链余额聚合          │
│  原子交换 │  (LayerZero式) │  (统一视图)           │
├──────────┴───────────────┴────────────────────────┤
│           链适配层 (Chain Adapters)                 │
├────────┬────────┬──────┬──────────┬───────┬───────┤
│Ethereum│Polygon │ BSC  │ Arbitrum │Solana │Cosmos │
│ (EVM)  │ (EVM)  │(EVM) │ (EVM L2) │(SPL)  │(IBC)  │
├────────┴────────┴──────┴──────────┴───────┴───────┤
│  SQLite (cc_bridges, cc_swaps, cc_messages)        │
└───────────────────────────────────────────────────┘
```

## IPC 接口

### 跨链操作（8 个）

| 通道                         | 功能     | 说明                            |
| ---------------------------- | -------- | ------------------------------- |
| `crosschain:bridge-asset`    | 资产桥接 | 将资产从源链转移到目标链        |
| `crosschain:atomic-swap`     | 原子交换 | 发起 HTLC 原子交换              |
| `crosschain:send-message`    | 发送消息 | 跨链发送任意消息                |
| `crosschain:get-balances`    | 查询余额 | 获取多链聚合资产余额            |
| `crosschain:list-chains`     | 链列表   | 获取支持的区块链列表和状态      |
| `crosschain:estimate-fee`    | 估算费用 | 估算跨链操作的 gas 和桥接费用   |
| `crosschain:get-tx-status`   | 交易状态 | 查询跨链交易的确认状态          |
| `crosschain:configure-chain` | 配置链   | 添加或更新区块链 RPC 和合约配置 |

## 使用示例

### 资产桥接

```javascript
const result = await window.electron.ipcRenderer.invoke(
  "crosschain:bridge-asset",
  {
    sourceChain: "ethereum",
    targetChain: "polygon",
    asset: "USDC",
    amount: "100.00",
    recipient: "0x742d35Cc6634C0532925a3b844Bc9e7595f6E321",
  },
);
// result = { success: true, bridgeId: "br_abc123", sourceTx: "0x...", status: "pending", estimatedTime: 900 }
```

### HTLC 原子交换

```javascript
const swap = await window.electron.ipcRenderer.invoke(
  "crosschain:atomic-swap",
  {
    offer: {
      chain: "ethereum",
      asset: "ETH",
      amount: "1.0",
    },
    want: {
      chain: "solana",
      asset: "SOL",
      amount: "150.0",
    },
    counterparty: "did:agent:trader-001",
    timelock: 3600, // 1小时锁定期
  },
);
// swap = { success: true, swapId: "sw_xyz789", hashlock: "0xabc...", status: "initiated", expiresAt: 1709127056789 }
```

### 跨链消息

```javascript
const msg = await window.electron.ipcRenderer.invoke(
  "crosschain:send-message",
  {
    sourceChain: "ethereum",
    targetChain: "arbitrum",
    payload: {
      type: "agent-task",
      taskId: "task_001",
      data: { action: "execute", params: {} },
    },
    gasLimit: 200000,
  },
);
// msg = { success: true, messageId: "msg_001", sourceTx: "0x...", status: "sent", estimatedDelivery: 120 }
```

### 多链余额查询

```javascript
const balances = await window.electron.ipcRenderer.invoke(
  "crosschain:get-balances",
  {
    chains: ["ethereum", "polygon", "bsc", "solana"],
    assets: ["native", "USDC", "USDT"],
  },
);
// balances = { success: true, total: { USD: 5230.50 }, chains: { ethereum: { ETH: "2.5", USDC: "1000" }, polygon: { MATIC: "500", USDC: "2000" }, ... } }
```

### 费用估算

```javascript
const fee = await window.electron.ipcRenderer.invoke(
  "crosschain:estimate-fee",
  {
    sourceChain: "ethereum",
    targetChain: "polygon",
    asset: "USDC",
    amount: "1000.00",
  },
);
// fee = { success: true, gasFeeSrc: "0.005 ETH", gasFeeTarget: "0.01 MATIC", bridgeFee: "0.50 USDC", totalUSD: 3.20, estimatedTime: 900 }
```

### 配置自定义链

```javascript
const result = await window.electron.ipcRenderer.invoke(
  "crosschain:configure-chain",
  {
    chainId: "custom-l2",
    name: "Custom L2 Chain",
    type: "evm",
    rpcUrl: "https://rpc.custom-l2.example.com",
    explorerUrl: "https://explorer.custom-l2.example.com",
    bridgeContract: "0x...",
    nativeAsset: { symbol: "ETH", decimals: 18 },
  },
);
// result = { success: true, chainId: "custom-l2", status: "configured" }
```

## 数据库 Schema

**3 张核心表**:

| 表名          | 用途     | 关键字段                                                |
| ------------- | -------- | ------------------------------------------------------- |
| `cc_bridges`  | 桥接记录 | id, source_chain, target_chain, asset, amount, status   |
| `cc_swaps`    | 原子交换 | id, offer_chain, want_chain, hashlock, timelock, status |
| `cc_messages` | 跨链消息 | id, source_chain, target_chain, payload, status         |

### cc_bridges 表

```sql
CREATE TABLE IF NOT EXISTS cc_bridges (
  id TEXT PRIMARY KEY,
  source_chain TEXT NOT NULL,
  target_chain TEXT NOT NULL,
  asset TEXT NOT NULL,
  amount TEXT NOT NULL,
  recipient TEXT,
  source_tx TEXT,
  target_tx TEXT,
  status TEXT DEFAULT 'pending',         -- pending | confirming | completed | failed | refunded
  fee TEXT,
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
  completed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_cc_bridges_status ON cc_bridges(status);
CREATE INDEX IF NOT EXISTS idx_cc_bridges_chains ON cc_bridges(source_chain, target_chain);
```

### cc_swaps 表

```sql
CREATE TABLE IF NOT EXISTS cc_swaps (
  id TEXT PRIMARY KEY,
  offer_chain TEXT NOT NULL,
  offer_asset TEXT NOT NULL,
  offer_amount TEXT NOT NULL,
  want_chain TEXT NOT NULL,
  want_asset TEXT NOT NULL,
  want_amount TEXT NOT NULL,
  counterparty TEXT,
  hashlock TEXT NOT NULL,
  timelock INTEGER NOT NULL,
  secret TEXT,                            -- 揭示后填入
  status TEXT DEFAULT 'initiated',       -- initiated | locked | completed | expired | refunded
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
  expires_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_cc_swaps_status ON cc_swaps(status);
CREATE INDEX IF NOT EXISTS idx_cc_swaps_hashlock ON cc_swaps(hashlock);
```

### cc_messages 表

```sql
CREATE TABLE IF NOT EXISTS cc_messages (
  id TEXT PRIMARY KEY,
  source_chain TEXT NOT NULL,
  target_chain TEXT NOT NULL,
  payload TEXT NOT NULL,                  -- JSON 编码的消息内容
  source_tx TEXT,
  target_tx TEXT,
  gas_limit INTEGER,
  status TEXT DEFAULT 'sent',            -- sent | relayed | delivered | failed
  retry_count INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
  delivered_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_cc_messages_status ON cc_messages(status);
CREATE INDEX IF NOT EXISTS idx_cc_messages_chains ON cc_messages(source_chain, target_chain);
```

## 支持的区块链

| 区块链   | 类型    | 资产桥接 | 原子交换 | 消息传递 |
| -------- | ------- | -------- | -------- | -------- |
| Ethereum | EVM     | ✅       | ✅       | ✅       |
| Polygon  | EVM     | ✅       | ✅       | ✅       |
| BSC      | EVM     | ✅       | ✅       | ✅       |
| Arbitrum | EVM L2  | ✅       | ✅       | ✅       |
| Solana   | Non-EVM | ✅       | ✅       | ✅       |
| Cosmos   | IBC     | ✅       | ✅       | ✅       |

## 配置

在 `.chainlesschain/config.json` 中配置：

```json
{
  "crossChainBridge": {
    "enabled": true,
    "defaultChains": ["ethereum", "polygon", "bsc", "arbitrum", "solana"],
    "rpc": {
      "ethereum": "https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY",
      "polygon": "https://polygon-mainnet.g.alchemy.com/v2/YOUR_KEY",
      "bsc": "https://bsc-dataseed.binance.org",
      "arbitrum": "https://arb1.arbitrum.io/rpc",
      "solana": "https://api.mainnet-beta.solana.com"
    },
    "bridge": {
      "maxAmount": "100000",
      "feeRate": 0.001,
      "confirmationBlocks": {
        "ethereum": 12,
        "polygon": 64,
        "bsc": 15,
        "arbitrum": 1,
        "solana": 32
      }
    },
    "atomicSwap": {
      "defaultTimelock": 3600,
      "maxTimelock": 86400,
      "minAmount": "0.001"
    },
    "messaging": {
      "maxPayloadSize": "10KB",
      "maxRetries": 3,
      "retryInterval": 60000
    }
  }
}
```

## 故障排除

| 问题           | 解决方案                                 |
| -------------- | ---------------------------------------- |
| 桥接交易卡住   | 检查源链确认数，确认 RPC 节点可用        |
| 原子交换过期   | 确认双方在 timelock 内完成，检查网络延迟 |
| 跨链消息未送达 | 检查目标链 gas limit，确认中继器运行正常 |
| 余额查询不全   | 确认所有链 RPC 配置正确，检查网络连通性  |
| 费用估算偏差大 | gas 价格波动导致，建议增加 10-20% 缓冲   |

## 关键文件

| 文件 | 职责 |
| --- | --- |
| `desktop-app-vue/src/main/blockchain/cross-chain-bridge.js` | 跨链桥接核心引擎 |
| `desktop-app-vue/src/main/blockchain/chain-adapters/evm-adapter.js` | EVM 链适配器 |
| `desktop-app-vue/src/main/blockchain/chain-adapters/solana-adapter.js` | Solana 链适配器 |
| `desktop-app-vue/src/main/blockchain/chain-adapters/cosmos-adapter.js` | Cosmos IBC 适配器 |
| `desktop-app-vue/src/main/blockchain/htlc-manager.js` | HTLC 原子交换管理 |
| `desktop-app-vue/src/main/blockchain/cross-chain-ipc.js` | 跨链 8 个 IPC Handler |

## 相关文档

- [去中心化交易](/chainlesschain/trading)
- [加密系统](/chainlesschain/encryption)
- [Agent 经济系统](/chainlesschain/agent-economy)
