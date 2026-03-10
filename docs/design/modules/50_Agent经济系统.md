# Phase 85 — Agent经济系统设计

**版本**: v4.1.0
**创建日期**: 2026-03-10
**状态**: ✅ 已实现 (v4.1.0)

---

## 一、模块概述

Phase 85 构建Agent经济系统，实现微支付、状态通道、资源市场、NFT铸造、贡献追踪和收益分配，为Agent生态提供完整的经济激励机制。

### 1.1 核心目标

1. **微支付**: Agent间低摩擦微支付，支持按调用/按Token/按时间计费
2. **状态通道**: 链下高频交易通道，批量结算降低成本
3. **资源市场**: 算力/存储/模型/数据的去中心化交易市场
4. **NFT铸造**: Agent技能和知识资产的NFT化确权
5. **贡献追踪**: 多Agent协作中的贡献度量化和收益自动分配

### 1.2 技术架构

```
┌──────────────────────────────────────────────────┐
│             Agent Economy System                 │
│                                                  │
│  ┌───────────────────┐  ┌──────────────────────┐ │
│  │ MicropaymentMgr   │  │ StateChannelManager  │ │
│  │ 按调用/Token计费  │  │ 链下高频+批量结算    │ │
│  │ 余额管理+账单     │  │ 争议仲裁+超时关闭    │ │
│  └───────────────────┘  └──────────────────────┘ │
│  ┌───────────────────┐  ┌──────────────────────┐ │
│  │ ResourceMarket    │  │ NFTMinter            │ │
│  │ 算力/存储/模型    │  │ 技能/知识NFT         │ │
│  │ 挂单/撮合/交割    │  │ 元数据+版税          │ │
│  └───────────────────┘  └──────────────────────┘ │
│  ┌──────────────────────────────────────────────┐ │
│  │ ContributionTracker — 贡献度量+收益分配      │ │
│  └──────────────────────────────────────────────┘ │
│  ┌──────────────────────────────────────────────┐ │
│  │        Economy IPC Layer (10 handlers)       │ │
│  └──────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────┘
```

---

## 二、核心模块设计

### 2.1 AgentEconomy (`ai-engine/economy/agent-economy.js`)

Agent经济系统主模块。

**常量**:

- `PAYMENT_TYPE`: PER_CALL, PER_TOKEN, PER_MINUTE, FLAT_RATE
- `CHANNEL_STATUS`: OPEN, ACTIVE, SETTLING, CLOSED, DISPUTED
- `RESOURCE_TYPE`: COMPUTE, STORAGE, MODEL, DATA, SKILL
- `NFT_STATUS`: MINTED, LISTED, SOLD, BURNED

**核心方法**:

- `initialize(deps)` — 初始化经济系统，加载账户余额
- `priceService({ serviceId, pricingModel })` — 设置服务定价模型
- `pay({ fromAgentId, toAgentId, amount, serviceId, metadata })` — 执行微支付
- `getBalance(agentId)` — 获取Agent余额和交易摘要
- `listMarket({ resourceType, sortBy, limit })` — 浏览资源市场
- `tradeResource({ buyerId, sellerId, resourceId, price })` — 交易资源
- `mintNFT({ agentId, assetType, metadata, royaltyPercent })` — 铸造NFT
- `getContributions({ taskId, agentId })` — 获取贡献记录
- `distributeRevenue({ taskId, totalAmount })` — 按贡献比例分配收益
- `openChannel({ agentA, agentB, depositA, depositB })` — 开启状态通道
- `closeChannel(channelId)` — 关闭状态通道并结算
- `_calculateContributionShares(taskId)` — 计算贡献份额
- `_settleChannel(channelId)` — 通道结算
- `destroy()` — 销毁系统

### 2.2 EconomyIPC (`ai-engine/economy/economy-ipc.js`)

IPC通道注册和参数校验。

---

## 三、数据库设计

```sql
-- Phase 85: Agent Economy
CREATE TABLE IF NOT EXISTS agent_accounts (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL UNIQUE,
  balance REAL DEFAULT 0.0,
  total_earned REAL DEFAULT 0.0,
  total_spent REAL DEFAULT 0.0,
  created_at INTEGER,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS agent_transactions (
  id TEXT PRIMARY KEY,
  from_agent_id TEXT,
  to_agent_id TEXT,
  amount REAL NOT NULL,
  payment_type TEXT,
  service_id TEXT,
  channel_id TEXT,              -- NULL if direct payment
  metadata TEXT,
  created_at INTEGER
);

CREATE TABLE IF NOT EXISTS state_channels (
  id TEXT PRIMARY KEY,
  agent_a TEXT NOT NULL,
  agent_b TEXT NOT NULL,
  deposit_a REAL DEFAULT 0.0,
  deposit_b REAL DEFAULT 0.0,
  balance_a REAL DEFAULT 0.0,
  balance_b REAL DEFAULT 0.0,
  nonce INTEGER DEFAULT 0,
  status TEXT DEFAULT 'open',
  opened_at INTEGER,
  closed_at INTEGER
);

CREATE TABLE IF NOT EXISTS resource_market (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  name TEXT,
  description TEXT,
  price REAL NOT NULL,
  available INTEGER DEFAULT 1,
  metadata TEXT,
  listed_at INTEGER,
  sold_at INTEGER
);

CREATE TABLE IF NOT EXISTS agent_nfts (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  asset_type TEXT,
  metadata TEXT,                -- JSON: name, description, image
  royalty_percent REAL DEFAULT 0.0,
  status TEXT DEFAULT 'minted',
  minted_at INTEGER,
  sold_at INTEGER
);

CREATE TABLE IF NOT EXISTS agent_contributions (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  contribution_type TEXT,       -- code, review, data, compute
  weight REAL DEFAULT 1.0,
  revenue_share REAL DEFAULT 0.0,
  metadata TEXT,
  created_at INTEGER
);
```

---

## 四、IPC接口设计

### Phase 85 — EconomyIPC (10 handlers)

| 通道                         | 说明         |
| ---------------------------- | ------------ |
| `economy:price-service`      | 设置服务定价 |
| `economy:pay`                | 执行微支付   |
| `economy:get-balance`        | 获取余额     |
| `economy:list-market`        | 浏览资源市场 |
| `economy:trade-resource`     | 交易资源     |
| `economy:mint-nft`           | 铸造NFT      |
| `economy:get-contributions`  | 获取贡献记录 |
| `economy:distribute-revenue` | 分配收益     |
| `economy:open-channel`       | 开启状态通道 |
| `economy:close-channel`      | 关闭状态通道 |

---

## 五、前端集成

### Pinia Stores

- `agentEconomy.ts` — 账户余额、交易记录、市场列表、NFT、贡献、通道

### Vue Pages

- `AgentEconomyPage.vue` — 余额管理/支付/市场/NFT/贡献追踪/状态通道

### Routes

- `/agent-economy` — Agent经济系统

---

## 六、配置选项

```javascript
agentEconomy: {
  enabled: false,
  defaultPricingModel: 'per_call',
  channelTimeoutMs: 86400000,
  marketCommissionPercent: 2.5,
  nftRoyaltyMaxPercent: 15.0,
  contributionDecayDays: 30,
  settlementBatchSize: 100,
},
```

---

## 七、测试覆盖

**测试文件**: `src/main/ai-engine/economy/__tests__/agent-economy.test.js`
**测试数量**: 25 tests

| 分类     | 数量 | 说明                                      |
| -------- | ---- | ----------------------------------------- |
| 初始化   | 2    | 系统初始化、账户加载                      |
| 微支付   | 4    | 正常支付、余额不足、多计费模型、交易记录  |
| 状态通道 | 4    | 开启通道、高频交易、结算关闭、争议处理    |
| 资源市场 | 4    | 挂单、浏览过滤、撮合交易、下架            |
| NFT铸造  | 3    | 铸造验证、元数据、版税设置                |
| 贡献追踪 | 4    | 贡献记录、权重计算、收益分配、多Agent协作 |
| 余额管理 | 4    | 查询余额、交易摘要、充值、提现            |

---

## 八、Context Engineering

- step 5.5: `setAgentEconomyContext()` — 注入Agent经济系统上下文
