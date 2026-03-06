# Token Incentive 代币激励系统

> **版本: v3.1.0 | 状态: ✅ 生产就绪 | 5 IPC Handlers | 2 数据库表 | CCT 代币经济**

ChainlessChain Token Incentive 是一个基于代币的去中心化激励系统，通过 CCT（ChainlessChain Token）奖励生态系统中的贡献者。它支持信誉加权定价、贡献质量评分、奖励计算分发以及完整的交易账本，为技能共享和计算资源提供经济激励。

## 核心特性

- 💰 **本地代币账本**: CCT 货币，完整的交易记录和余额管理
- ⭐ **信誉加权定价**: 根据调用者信誉动态调整技能价格，最高 50% 折扣
- 📊 **贡献质量评分**: 0-1 分质量评分，影响奖励倍数
- 🎁 **奖励计算分发**: 自动根据贡献类型和质量计算代币奖励
- 📋 **贡献追踪**: 支持 skill/gene/compute/data/review 五种贡献类型
- 🏆 **贡献排行榜**: 按总收益排名，激励优质贡献

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

## 相关文档

- [Skill Marketplace 技能市场 →](/chainlesschain/skill-marketplace)
- [Inference Network 推理网络 →](/chainlesschain/inference-network)
- [EvoMap 进化图谱 →](/chainlesschain/evomap)
