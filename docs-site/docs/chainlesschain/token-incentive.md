# Token Incentive 代币激励系统

> **版本: v3.1.0 | 状态: ✅ 生产就绪 | 5 IPC Handlers | 2 数据库表 | CCT 代币经济**

ChainlessChain Token Incentive 是一个基于代币的去中心化激励系统，通过 CCT（ChainlessChain Token）奖励生态系统中的贡献者。它支持信誉加权定价、贡献质量评分、奖励计算分发以及完整的交易账本，为技能共享和计算资源提供经济激励。

## 概述

代币激励系统通过 CCT 代币为 ChainlessChain 生态的技能共享、计算资源和数据贡献提供经济激励。系统内置信誉加权定价引擎（高信誉用户享受最高 50% 折扣）、贡献质量评分机制（影响奖励倍数）和完整的交易账本，支持 skill/gene/compute/data/review 五种贡献类型的追踪与奖励分发。

## 核心特性

- 💰 **本地代币账本**: CCT 货币，完整的交易记录和余额管理
- ⭐ **信誉加权定价**: 根据调用者信誉动态调整技能价格，最高 50% 折扣
- 📊 **贡献质量评分**: 0-1 分质量评分，影响奖励倍数
- 🎁 **奖励计算分发**: 自动根据贡献类型和质量计算代币奖励
- 📋 **贡献追踪**: 支持 skill/gene/compute/data/review 五种贡献类型
- 🏆 **贡献排行榜**: 按总收益排名，激励优质贡献

## 系统架构

```
┌──────────────────────────────────────────────┐
│             Token Incentive 系统               │
│                                              │
│  ┌──────────┐  ┌───────────┐  ┌───────────┐ │
│  │ 贡献提交 │  │ 定价查询  │  │ 余额查询  │ │
│  └────┬─────┘  └─────┬─────┘  └─────┬─────┘ │
│       │              │              │        │
│       ▼              ▼              ▼        │
│  ┌──────────────────────────────────────┐    │
│  │       Token IPC (5 处理器)            │    │
│  └──────────────┬───────────────────────┘    │
│                 │                            │
│    ┌────────────┼────────────┐               │
│    ▼            ▼            ▼               │
│  ┌────────┐ ┌──────────┐ ┌──────────────┐   │
│  │Token   │ │Contribution│ │信誉加权      │   │
│  │Ledger  │ │Tracker    │ │定价引擎      │   │
│  └───┬────┘ └─────┬─────┘ └──────────────┘   │
│      │            │                          │
│      ▼            ▼                          │
│  ┌──────────────────────────────────────┐    │
│  │  token_transactions / contributions  │    │
│  │         (SQLite 数据库)              │    │
│  └──────────────────────────────────────┘    │
└──────────────────────────────────────────────┘
```

## 奖励计算公式

```
代币奖励 = qualityScore × rewardMultiplier × 10

信誉折扣 = min(callerReputation × 0.1, 0.5)
最终价格 = basePrice × (1 - 信誉折扣)
```

## 查询余额

```javascript
const result = await window.electron.ipcRenderer.invoke("token:get-balance");
// { success: true, balance: 150.5, currency: "CCT", updatedAt: 1709123456789 }
```

## 提交贡献

```javascript
const result = await window.electron.ipcRenderer.invoke(
  "token:submit-contribution",
  {
    type: "skill", // skill | gene | compute | data | review
    contributorDid: "did:example:alice",
    resourceId: "skill-001",
    qualityScore: 0.85,
    description: "提供数据分析技能服务",
  },
);
// result.contribution = { id, tokens_earned: 8.5, ... }
```

## 查询定价

```javascript
const result = await window.electron.ipcRenderer.invoke("token:get-pricing", {
  skillId: "data-analysis",
  callerReputation: 4.5, // 信誉分（0-5）
});
// result.pricing = { basePrice: 10, reputationDiscount: 0.45, finalPrice: 5.5, currency: "CCT" }
```

## IPC 接口完整列表

### Token 操作（5 个）

| 通道                        | 功能         | 说明                        |
| --------------------------- | ------------ | --------------------------- |
| `token:get-balance`         | 查询代币余额 | 返回当前余额和 CCT 货币标识 |
| `token:get-transactions`    | 查询交易历史 | 支持按类型过滤，分页查询    |
| `token:submit-contribution` | 提交贡献     | 自动计算代币奖励并记录交易  |
| `token:get-pricing`         | 查询信誉定价 | 根据调用者信誉计算最终价格  |
| `token:get-rewards-summary` | 获取奖励汇总 | 总奖励、奖励次数、当前余额  |

## 数据库 Schema

**2 张核心表**:

| 表名                 | 用途     | 关键字段                                                |
| -------------------- | -------- | ------------------------------------------------------- |
| `token_transactions` | 交易账本 | id, type, amount, balance_after, from_did, to_did       |
| `contributions`      | 贡献记录 | id, type, contributor_did, quality_score, tokens_earned |

### token_transactions 表

```sql
CREATE TABLE IF NOT EXISTS token_transactions (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,                    -- reward | payment | transfer | penalty
  amount REAL NOT NULL,
  balance_after REAL,
  description TEXT,
  from_did TEXT,
  to_did TEXT,
  skill_id TEXT,
  reputation_weight REAL DEFAULT 1.0,
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_token_tx_type ON token_transactions(type);
CREATE INDEX IF NOT EXISTS idx_token_tx_created ON token_transactions(created_at);
```

### contributions 表

```sql
CREATE TABLE IF NOT EXISTS contributions (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,                    -- skill | gene | compute | data | review
  contributor_did TEXT,
  resource_id TEXT,
  quality_score REAL DEFAULT 0.0,        -- 0-1 质量评分
  tokens_earned REAL DEFAULT 0.0,
  description TEXT,
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_contributions_type ON contributions(type);
CREATE INDEX IF NOT EXISTS idx_contributions_contributor ON contributions(contributor_did);
```

## 前端集成

### TokenIncentivePage 页面

**功能模块**:

- **统计卡片**: CCT 余额 / 交易数 / 奖励数
- **交易列表**: Tab 页签，展示类型、金额、余额、描述
- **贡献提交**: 表单，选择贡献类型并提交
- **错误提示**: Alert 组件展示错误信息

### Pinia Store (tokenIncentive.ts)

```typescript
const useTokenIncentiveStore = defineStore("tokenIncentive", {
  state: () => ({
    balance: 0,
    transactions: [],
    rewardsSummary: null,
    loading: false,
    error: null,
  }),
  getters: {
    rewardTransactions, // 筛选 type === 'reward' 的交易
  },
  actions: {
    fetchBalance, // → token:get-balance
    fetchTransactions, // → token:get-transactions
    submitContribution, // → token:submit-contribution
    fetchPricing, // → token:get-pricing
    fetchRewardsSummary, // → token:get-rewards-summary
  },
});
```

## 关键文件

| 文件                                           | 职责                  | 行数 |
| ---------------------------------------------- | --------------------- | ---- |
| `src/main/marketplace/token-ledger.js`         | 代币账本核心引擎      | ~210 |
| `src/main/marketplace/contribution-tracker.js` | 贡献追踪器            | ~100 |
| `src/main/marketplace/token-ipc.js`            | Token IPC（5 处理器） | ~130 |
| `src/renderer/stores/tokenIncentive.ts`        | Pinia 状态管理        | ~100 |
| `src/renderer/pages/ai/TokenIncentivePage.vue` | 代币激励页面          | ~106 |

## 测试覆盖率

```
✅ token-ledger.test.js              - 余额/交易/奖励/定价测试
✅ contribution-tracker.test.js       - 贡献记录/评分/排行榜测试
✅ stores/tokenIncentive.test.ts      - Store 状态管理测试
✅ e2e/ai/token-incentive.e2e.test.ts - 端到端用户流程测试
```

## 使用示例

### 示例 1: 提交贡献并查看奖励

```javascript
// 1. 查看当前余额
const balance = await window.electron.ipcRenderer.invoke("token:get-balance");
console.log(`当前余额: ${balance.balance} ${balance.currency}`);

// 2. 提交一项技能贡献
const contribution = await window.electron.ipcRenderer.invoke("token:submit-contribution", {
  type: "skill",
  contributorDid: "did:example:alice",
  resourceId: "data-analysis-v2",
  qualityScore: 0.92,
  description: "提供高质量数据分析技能，覆盖 5 种图表类型",
});
console.log(`获得奖励: ${contribution.contribution.tokens_earned} CCT`);

// 3. 查看奖励汇总
const summary = await window.electron.ipcRenderer.invoke("token:get-rewards-summary");
console.log(`总奖励: ${summary.totalRewards} CCT, 奖励次数: ${summary.rewardCount}`);
```

### 示例 2: 信誉定价查询与交易历史

```javascript
// 查询信誉折扣后的技能价格
const pricing = await window.electron.ipcRenderer.invoke("token:get-pricing", {
  skillId: "data-analysis",
  callerReputation: 4.2,
});
console.log(`原价: ${pricing.pricing.basePrice}, 折扣: ${(pricing.pricing.reputationDiscount * 100).toFixed(0)}%, 最终: ${pricing.pricing.finalPrice} CCT`);

// 查看交易历史（按奖励类型过滤）
const txns = await window.electron.ipcRenderer.invoke("token:get-transactions", {
  type: "reward",
  limit: 20,
});
txns.forEach(tx => console.log(`[${tx.type}] +${tx.amount} CCT - ${tx.description}`));
```

---

## 故障排查

| 问题 | 可能原因 | 解决方案 |
| --- | --- | --- |
| 余额为 0 | 未提交过贡献或奖励未结算 | 通过 `token:submit-contribution` 提交贡献后系统自动计算奖励 |
| 奖励金额异常 | 质量评分过低导致奖励倍数低 | 提高 `qualityScore`（0-1），奖励公式为 `score × multiplier × 10` |
| 定价查询无折扣 | 调用者信誉分为 0 | 信誉折扣 = `min(reputation × 0.1, 0.5)`，需积累信誉值 |
| 交易记录缺失 | 过滤条件限制了返回结果 | 移除 `type` 过滤参数查看全部交易，或增大 `limit` |
| 贡献提交失败 | DID 未初始化或类型无效 | 确认 `contributorDid` 有效，`type` 为 skill/gene/compute/data/review 之一 |
| 余额不一致 | 并发交易导致竞态 | 重新调用 `token:get-balance` 刷新余额，系统会自动修正 |

---

## 安全考虑

1. **本地账本**: 所有交易记录存储在本地 SQLite，不依赖外部区块链
2. **DID 绑定**: 贡献和交易均绑定 DID 身份，确保可追溯性
3. **质量评分**: 奖励与质量评分挂钩，防止低质量刷量行为
4. **信誉机制**: 信誉加权定价鼓励优质服务，高信誉用户享受更低价格
5. **防篡改**: 交易记录一旦写入不可修改，保证账本完整性

---

## 相关文档

- [Skill Marketplace 技能市场 →](/chainlesschain/skill-marketplace)
- [Inference Network 推理网络 →](/chainlesschain/inference-network)
- [EvoMap 进化图谱 →](/chainlesschain/evomap)
