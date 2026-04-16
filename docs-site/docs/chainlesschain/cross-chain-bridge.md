# 跨链互操作协议

> **版本: v4.2.0 | 状态: ✅ 生产就绪 | 8 IPC Handlers | 3 数据库表 | Phase 89**

## 概述

跨链互操作协议实现 EVM 兼容链（Ethereum/Polygon/BSC/Arbitrum）与非 EVM 链（Solana/Cosmos IBC）之间的资产桥接和消息传递。通过 HTLC 原子交换实现无需信任的跨链资产交换，并提供多链统一视图聚合各链资产余额和交易历史。

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

### 跨链交易失败详细排查

**现象**: `crosschain:bridge-asset` 状态变为 `failed`，资产未到达目标链。

**排查步骤**:
1. 通过 `crosschain:get-tx-status` 查询 `sourceTx` 在源链上的确认状态
2. 检查源链是否有足够的 gas 余额支付交易费用
3. 确认 `recipient` 地址在目标链上有效（EVM 和 Solana 地址格式不同）
4. 若状态为 `confirming`，等待 `confirmationBlocks` 数量达标后再查询
5. 状态为 `failed` 且有 `refunded` 标记时，资产已退回源链账户

### HTLC 原子交换超时

**现象**: 交换状态变为 `expired`，资金被锁定。

**排查步骤**:
1. 确认 `timelock` 设置是否合理，网络拥堵时建议设置为 2 小时以上
2. 检查双方是否在锁定期内完成了各自的链上操作（锁定 + 揭示 secret）
3. `expired` 状态下可调用退款操作取回锁定资金
4. 避免在不同网络延迟差异大时使用过短的 timelock

### 目标链不可达

**现象**: 跨链操作返回目标链连接失败或 RPC 超时。

**排查步骤**:
1. 检查 `crossChainBridge.rpc` 中目标链的 RPC URL 是否正确可访问
2. 确认 RPC 服务商的 API Key 未过期或超出配额限制
3. 尝试切换备用 RPC 节点（通过 `crosschain:configure-chain` 更新）
4. 检查本地网络防火墙是否阻断了对目标链 RPC 端口的访问

## 关键文件

| 文件 | 职责 |
| --- | --- |
| `desktop-app-vue/src/main/blockchain/cross-chain-bridge.js` | 跨链桥接核心引擎 |
| `desktop-app-vue/src/main/blockchain/chain-adapters/evm-adapter.js` | EVM 链适配器 |
| `desktop-app-vue/src/main/blockchain/chain-adapters/solana-adapter.js` | Solana 链适配器 |
| `desktop-app-vue/src/main/blockchain/chain-adapters/cosmos-adapter.js` | Cosmos IBC 适配器 |
| `desktop-app-vue/src/main/blockchain/htlc-manager.js` | HTLC 原子交换管理 |
| `desktop-app-vue/src/main/blockchain/cross-chain-ipc.js` | 跨链 8 个 IPC Handler |

## 故障排查

### 常见问题

| 症状 | 可能原因 | 解决方案 |
| --- | --- | --- |
| HTLC 超时交易回滚 | 时间锁设置过短或对方链确认慢 | 增大 `timeLock` 值，确认目标链出块速度 |
| 跨链消息丢失 | 中继节点离线或消息队列溢出 | 检查中继节点状态，增大消息队列容量 |
| 链上 Gas 不足交易失败 | 账户余额不够支付 Gas 费 | 充值 Gas，或设置 `gasLimit` 自动调整策略 |
| 资产锚定比例异常 | 预言机喂价延迟或价格源故障 | 检查预言机状态，切换备用价格源 |
| 跨链验证失败 | Merkle 证明不匹配或区块头过期 | 重新获取最新区块头，重建 Merkle 证明 |

### 常见错误修复

**错误: `HTLC_TIMEOUT` 哈希时间锁超时**

```bash
# 查看 HTLC 状态
chainlesschain wallet cross-chain htlc-status --tx-id <id>

# 手动触发退款（超时后）
chainlesschain wallet cross-chain refund --tx-id <id>
```

**错误: `RELAY_OFFLINE` 中继节点不可用**

```bash
# 检查中继节点列表和状态
chainlesschain wallet cross-chain relay-status

# 切换到备用中继节点
chainlesschain wallet cross-chain relay-switch --node <backup-node>
```

**错误: `INSUFFICIENT_GAS` Gas 不足**

```bash
# 查看各链账户余额
chainlesschain wallet assets --chain all

# 估算跨链交易 Gas 费用
chainlesschain wallet cross-chain gas-estimate --from <chain-a> --to <chain-b>
```

## 配置参考

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 是否启用跨链互操作模块 |
| `defaultChains` | `["ethereum","polygon","bsc","arbitrum","solana"]` | 默认启用的链列表 |
| `rpc.<chain>` | — | 各链 RPC 端点 URL，支持 Alchemy/Infura/自建节点 |
| `bridge.maxAmount` | `"100000"` | 单笔桥接最大金额（USDC 计价） |
| `bridge.feeRate` | `0.001` | 桥接手续费率（0.1%） |
| `bridge.confirmationBlocks.ethereum` | `12` | 以太坊源链所需确认区块数 |
| `bridge.confirmationBlocks.polygon` | `64` | Polygon 源链所需确认区块数 |
| `bridge.confirmationBlocks.arbitrum` | `1` | Arbitrum L2 所需确认区块数（出块快） |
| `atomicSwap.defaultTimelock` | `3600` | HTLC 默认锁定时长（秒，1 小时） |
| `atomicSwap.maxTimelock` | `86400` | HTLC 最大锁定时长（秒，24 小时） |
| `atomicSwap.minAmount` | `"0.001"` | 原子交换最小金额 |
| `messaging.maxPayloadSize` | `"10KB"` | 跨链消息最大载荷大小 |
| `messaging.maxRetries` | `3` | 消息中继失败最大重试次数 |
| `messaging.retryInterval` | `60000` | 重试间隔（毫秒） |

## 性能指标

| 指标 | 典型值 | 说明 |
| --- | --- | --- |
| 以太坊→Polygon 桥接时间 | ~15 分钟 | 需等待 12 个以太坊区块确认（~2 分钟/块） |
| 以太坊→Arbitrum 桥接时间 | ~2 分钟 | Arbitrum L2 仅需 1 个确认 |
| HTLC 原子交换完成时间 | ~10–30 分钟 | 取决于双方链的出块速度和网络拥堵 |
| 跨链消息送达延迟 | 2–5 分钟 | 类 LayerZero 中继，Arbitrum 最快 ~120 秒 |
| 多链余额查询耗时 | < 3 秒 | 并发查询 5 条链，聚合后本地缓存 30 秒 |
| 费用估算响应时间 | < 500 ms | 通过 RPC 获取实时 gas price 计算 |
| 数据库写入（桥接记录） | < 5 ms | SQLite 单次 INSERT，含索引更新 |
| IPC 调用端到端延迟 | < 50 ms | 本地 Electron IPC + 同步 DB 读写 |

## 测试覆盖率

| 模块 | 测试文件 | 用例数 | 覆盖场景 |
| --- | --- | --- | --- |
| CrossChainBridge 核心 | `cross-chain-bridge.test.js` | 35 | 桥接发起/状态追踪/失败回滚/重复防护 |
| HTLC 原子交换 | `htlc-manager.test.js` | 28 | 锁定/揭秘/超时退款/哈希验证 |
| EVM 链适配器 | `evm-adapter.test.js` | 22 | 4 条 EVM 链的 RPC 调用/Gas 估算/确认数 |
| Solana 适配器 | `solana-adapter.test.js` | 16 | SPL Token 转移/账户派生/确认轮询 |
| Cosmos IBC 适配器 | `cosmos-adapter.test.js` | 14 | IBC 通道建立/中继消息/超时处理 |
| IPC Handlers | `cross-chain-ipc.test.js` | 24 | 8 个通道的请求验证/响应格式/错误路径 |
| **合计** | **6 个文件** | **139** | **主流程 + 多链边界 + 异常恢复全覆盖** |

运行跨链互操作模块测试：

```bash
cd desktop-app-vue && npx vitest run tests/unit/blockchain/cross-chain/
```

## 安全考虑

### 跨链交易安全
- **HTLC 时间锁**: 原子交换的 `timelock` 应设置合理区间（建议 1-24 小时），过短可能因网络拥堵导致资金锁定，过长则增加对手方风险
- **哈希锁保密**: HTLC 的 `secret`（原像）在交换完成前严禁泄露，泄露将导致对手方提前取走资金
- **双花防护**: 桥接交易在源链需等待足够的确认数（`confirmationBlocks`），以太坊建议 12 个区块，防止链重组导致双花

### RPC 节点安全
- **节点可信性**: 仅使用可信的 RPC 节点（如 Alchemy、Infura 或自建全节点），恶意 RPC 可能返回伪造的交易状态
- **API Key 保护**: RPC URL 中的 API Key 存储在加密配置中，切勿硬编码到代码或日志中
- **请求频率限制**: 配置合理的请求频率，避免触发 RPC 提供商的速率限制导致交易状态查询失败

### 资产安全
- **金额上限**: 通过 `maxAmount` 配置单笔桥接最大金额，防止操作失误或攻击导致大额资金损失
- **合约地址验证**: 添加自定义链时务必验证 `bridgeContract` 地址的正确性，错误地址将导致资金永久丢失
- **跨链消息验证**: 目标链接收跨链消息时应验证源链签名和中继器身份，防止伪造消息注入
- **余额聚合隐私**: 多链余额查询结果仅在本地聚合展示，不上传到任何中心化服务器

## 相关文档

- [去中心化交易](/chainlesschain/trading)
- [加密系统](/chainlesschain/encryption)
- [Agent 经济系统](/chainlesschain/agent-economy)
