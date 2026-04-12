# Agent 经济系统

> **版本: v4.1.0 | 状态: ✅ 生产就绪 | 10 IPC Handlers | 6 数据库表 | Phase 85**

ChainlessChain Agent 经济系统（Agent Economy）为 AI Agent 生态提供完整的经济基础设施，包括微支付状态通道、计算资源交易市场、贡献证明机制、Agent NFT 身份和收益自动分配，实现去中心化的 Agent 价值交换网络。

## 概述

Agent 经济系统为去中心化 AI Agent 生态提供价值交换基础设施。系统支持基于 State Channel 的链下微支付、GPU/存储/带宽等计算资源的市场化交易、Proof of Contribution 贡献量化机制，以及 Agent NFT 身份铸造和基于贡献比例的收益自动分配。

## 核心特性

- 💳 **微支付通道**: State Channel 链下支付，毫秒级结算，极低手续费
- 🖥️ **计算资源市场**: GPU/存储/带宽资源上架交易，自动匹配供需
- 📊 **贡献证明**: Proof of Contribution 机制，量化并记录 Agent 贡献
- 🎨 **Agent NFT 身份**: 铸造不可替代的 Agent 身份 NFT，携带能力与信誉
- 💰 **收益分配**: 基于贡献比例的自动收益分配引擎

## IPC 接口

### 经济操作（10 个）

| 通道                         | 功能     | 说明                          |
| ---------------------------- | -------- | ----------------------------- |
| `economy:price-service`      | 服务定价 | 查询或设置 Agent 服务价格     |
| `economy:pay`                | 支付     | 执行微支付，支持链上/状态通道 |
| `economy:get-balance`        | 查询余额 | 获取 Agent 账户余额和资产列表 |
| `economy:list-market`        | 市场列表 | 浏览计算资源市场中的可用资源  |
| `economy:trade-resource`     | 资源交易 | 购买或出售 GPU/存储/带宽资源  |
| `economy:mint-nft`           | 铸造 NFT | 为 Agent 铸造身份 NFT         |
| `economy:get-contributions`  | 查询贡献 | 获取 Agent 的贡献证明记录     |
| `economy:distribute-revenue` | 分配收益 | 按贡献比例执行收益分配        |
| `economy:open-channel`       | 开启通道 | 开启 State Channel 微支付通道 |
| `economy:close-channel`      | 关闭通道 | 关闭通道并结算链上            |

## 使用示例

### 开启微支付通道

```javascript
const channel = await window.electron.ipcRenderer.invoke(
  "economy:open-channel",
  {
    counterpartyDid: "did:agent:provider-001",
    deposit: 100,
    currency: "CCT",
    ttl: 3600000, // 1小时过期
  },
);
// channel = { success: true, channelId: "ch_abc123", deposit: 100, status: "open" }
```

### 执行微支付

```javascript
const result = await window.electron.ipcRenderer.invoke("economy:pay", {
  channelId: "ch_abc123",
  amount: 0.5,
  memo: "调用 data-analysis 技能",
});
// result = { success: true, txId: "tx_xyz", balance: 99.5, nonce: 1 }
```

### 浏览资源市场

```javascript
const market = await window.electron.ipcRenderer.invoke("economy:list-market", {
  type: "gpu", // gpu | storage | bandwidth
  sortBy: "price",
  limit: 20,
});
// market = { success: true, listings: [{ id: "res_001", type: "gpu", spec: "A100 40GB", price: 2.5, provider: "did:agent:..." }, ...] }
```

### 铸造 Agent NFT

```javascript
const nft = await window.electron.ipcRenderer.invoke("economy:mint-nft", {
  agentDid: "did:agent:my-agent",
  metadata: {
    name: "DataAnalyst Agent",
    skills: ["data-analysis", "visualization", "report-generation"],
    reputation: 4.8,
  },
});
// nft = { success: true, nftId: "nft_001", tokenUri: "ipfs://Qm...", mintedAt: 1709123456789 }
```

### 收益分配

```javascript
const result = await window.electron.ipcRenderer.invoke(
  "economy:distribute-revenue",
  {
    poolId: "pool_task_001",
    totalRevenue: 50,
    distributionMethod: "proportional", // proportional | equal | weighted
  },
);
// result = { success: true, distributions: [{ agentDid: "did:agent:a", amount: 30 }, { agentDid: "did:agent:b", amount: 20 }] }
```

## 数据库 Schema

**6 张核心表**:

| 表名                   | 用途      | 关键字段                                         |
| ---------------------- | --------- | ------------------------------------------------ |
| `agent_services`       | 服务注册  | id, agent_did, service_type, price, currency     |
| `agent_payments`       | 支付记录  | id, from_did, to_did, amount, channel_id, status |
| `state_channels`       | 状态通道  | id, party_a, party_b, deposit, nonce, status     |
| `resource_listings`    | 资源上架  | id, provider_did, type, spec, price, available   |
| `agent_nfts`           | Agent NFT | id, agent_did, token_uri, metadata, minted_at    |
| `contribution_records` | 贡献记录  | id, agent_did, task_id, contribution_type, score |

### agent_services 表

```sql
CREATE TABLE IF NOT EXISTS agent_services (
  id TEXT PRIMARY KEY,
  agent_did TEXT NOT NULL,
  service_type TEXT NOT NULL,
  service_name TEXT,
  price REAL NOT NULL DEFAULT 0,
  currency TEXT DEFAULT 'CCT',
  description TEXT,
  status TEXT DEFAULT 'active',
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
  updated_at INTEGER DEFAULT (strftime('%s','now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_agent_services_did ON agent_services(agent_did);
CREATE INDEX IF NOT EXISTS idx_agent_services_type ON agent_services(service_type);
```

### state_channels 表

```sql
CREATE TABLE IF NOT EXISTS state_channels (
  id TEXT PRIMARY KEY,
  party_a TEXT NOT NULL,
  party_b TEXT NOT NULL,
  deposit_a REAL DEFAULT 0,
  deposit_b REAL DEFAULT 0,
  nonce INTEGER DEFAULT 0,
  status TEXT DEFAULT 'open',          -- open | closing | closed | disputed
  ttl INTEGER,
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
  closed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_state_channels_parties ON state_channels(party_a, party_b);
CREATE INDEX IF NOT EXISTS idx_state_channels_status ON state_channels(status);
```

### agent_nfts 表

```sql
CREATE TABLE IF NOT EXISTS agent_nfts (
  id TEXT PRIMARY KEY,
  agent_did TEXT NOT NULL UNIQUE,
  token_uri TEXT,
  metadata TEXT,                        -- JSON: name, skills, reputation
  minted_at INTEGER DEFAULT (strftime('%s','now') * 1000),
  transferred_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_agent_nfts_did ON agent_nfts(agent_did);
```

## 系统架构

```
┌───────────────────────────────────────────────────┐
│                Agent 经济系统                       │
├───────────────────────────────────────────────────┤
│                                                     │
│  ┌────────────┐  ┌────────────┐  ┌─────────────┐  │
│  │ State      │  │ Resource   │  │ Agent NFT   │  │
│  │ Channel    │  │ Market     │  │ Identity    │  │
│  │ (微支付)    │  │ (资源交易)  │  │ (身份铸造)  │  │
│  └─────┬──────┘  └─────┬──────┘  └──────┬──────┘  │
│        │               │                │          │
│  ┌─────▼───────────────▼────────────────▼──────┐  │
│  │          Contribution Proof Engine           │  │
│  │          (贡献证明 + 收益分配)                 │  │
│  └──────────────────┬──────────────────────────┘  │
│                     │                              │
│  ┌──────────────────▼──────────────────────────┐  │
│  │   SQLite 持久化 (6 tables)                   │  │
│  │   services | payments | channels | listings  │  │
│  │   nfts | contributions                       │  │
│  └─────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────┘
```

## 配置

在 `.chainlesschain/config.json` 中配置：

```json
{
  "agentEconomy": {
    "enabled": true,
    "currency": "CCT",
    "stateChannel": {
      "defaultTTL": 3600000,
      "maxDeposit": 10000,
      "settlementInterval": 60000
    },
    "resourceMarket": {
      "listingFee": 0.1,
      "tradeFeeRate": 0.02,
      "maxListingsPerAgent": 50
    },
    "nft": {
      "mintFee": 5,
      "transferEnabled": true
    },
    "revenueDistribution": {
      "defaultMethod": "proportional",
      "minPoolSize": 1
    }
  }
}
```

## 故障排除

| 问题             | 解决方案                                      |
| ---------------- | --------------------------------------------- |
| 通道开启失败     | 检查余额是否足够支付保证金                    |
| 支付超时         | 确认对方 Agent 在线，检查通道 TTL 是否过期    |
| NFT 铸造失败     | 确认 Agent DID 有效，检查是否已存在同 DID NFT |
| 资源交易未匹配   | 检查资源类型和价格区间设置                    |
| 收益分配比例异常 | 确认贡献记录完整，检查分配方法配置            |

### 余额不足导致操作失败

**现象**: 调用 `economy:pay` 或 `economy:open-channel` 返回余额不足错误。

**排查步骤**:
1. 调用 `economy:get-balance` 确认当前 Agent 账户余额
2. 检查是否有未关闭的通道锁定了保证金（`state_channels` 表中 `status = 'open'` 的记录）
3. 确认 `maxDeposit` 配置未被误设为过低值
4. 若通道已不再使用，调用 `economy:close-channel` 释放锁定资金

### 状态通道异常（closing/disputed）

**现象**: 通道状态卡在 `closing` 或进入 `disputed` 状态，无法正常结算。

**排查步骤**:
1. 检查 `state_channels` 表中对应通道的 `nonce` 是否一致
2. 确认双方最后签名的状态是否匹配，如不一致则触发争议仲裁
3. 检查 `settlementInterval` 配置，等待结算周期完成后重试关闭
4. 如通道 TTL 已过期，系统将自动按最后有效状态结算

### NFT 铸造失败详细排查

**现象**: 调用 `economy:mint-nft` 返回失败，NFT 未生成。

**排查步骤**:
1. 确认 `agentDid` 格式正确且为有效的 DID 标识
2. 查询 `agent_nfts` 表确认该 DID 是否已铸造过 NFT（`UNIQUE` 约束）
3. 检查 `mintFee` 配置，确认账户余额足以支付铸造费用
4. 检查 `metadata` 字段是否为合法 JSON，避免序列化异常

## 故障排查

### 常见问题

| 症状 | 可能原因 | 解决方案 |
| --- | --- | --- |
| 余额不足无法发起支付 | 账户未充值或通道保证金被锁定 | 检查可用余额，确认通道状态是否为 `open` |
| State Channel 结算失败 | 双方签名不一致或通道已过期 | 重新协商签名，检查通道 `expiry` 时间戳 |
| NFT 铸造返回错误 | DID 已铸造过 NFT 或 metadata 格式异常 | 查询 `agent_nfts` 表确认唯一约束，验证 JSON 格式 |
| 贡献分配金额为零 | 贡献证明未提交或权重配置错误 | 确认 `contribution-proof` 记录存在，检查权重参数 |
| 资源市场报价查询为空 | 市场未初始化或无卖方注册 | 运行 `economy:market-init`，检查卖方注册状态 |

### 常见错误修复

**错误: `INSUFFICIENT_BALANCE` 支付被拒绝**

```bash
# 查看当前账户余额
chainlesschain economy balance --agent-did <your-did>

# 充值到指定金额
chainlesschain economy deposit --amount 1000 --agent-did <your-did>
```

**错误: `CHANNEL_SETTLEMENT_FAILED` 通道结算超时**

```bash
# 检查通道状态
chainlesschain economy channel-status --channel-id <id>

# 强制关闭并结算通道
chainlesschain economy channel-close --channel-id <id> --force
```

**错误: `NFT_MINT_DUPLICATE` 重复铸造**

```bash
# 查询已铸造的 NFT
chainlesschain economy nft-list --agent-did <your-did>

# 如需重新铸造，先撤销旧 NFT
chainlesschain economy nft-revoke --nft-id <id>
```

## 安全考虑

- **通道签名**: State Channel 每笔交易需双方签名确认，防止单方篡改余额
- **保证金锁定**: 开启通道时保证金锁定在链上，关闭时自动结算，防止资金挪用
- **DID 绑定**: 所有经济操作与 Agent DID 身份绑定，不可伪造交易方
- **交易限额**: 单笔支付和通道保证金设有上限（`maxDeposit`），防止大额损失
- **NFT 唯一性**: 每个 Agent DID 仅可铸造一个身份 NFT，防止重复铸造
- **审计追踪**: 支付、交易、分配记录完整存储，支持争议仲裁和合规审查

## 关键文件

| 文件 | 职责 |
| --- | --- |
| `desktop-app-vue/src/main/blockchain/agent-economy.js` | Agent 经济核心引擎 |
| `desktop-app-vue/src/main/blockchain/state-channel.js` | State Channel 微支付通道 |
| `desktop-app-vue/src/main/blockchain/resource-market.js` | 计算资源交易市场 |
| `desktop-app-vue/src/main/blockchain/agent-nft.js` | Agent NFT 身份铸造 |
| `desktop-app-vue/src/main/blockchain/contribution-proof.js` | 贡献证明与收益分配 |

## 相关文档

- [Token Incentive 代币激励](/chainlesschain/token-incentive)
- [Agent 联邦网络](/chainlesschain/agent-federation)
- [Skill Marketplace 技能市场](/chainlesschain/skill-marketplace)
