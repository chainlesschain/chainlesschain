# DAO 治理 2.0

> **版本: v4.2.0 | 状态: ✅ 生产就绪 | 8 IPC Handlers | 3 数据库表 | Phase 92**

ChainlessChain DAO 治理 2.0 实现完整的去中心化自治组织治理系统，支持二次方投票（Quadratic Voting）、委托投票（带环路检测）、提案全生命周期管理（Draft→Active→Queue→Execute）和资金库自动分配，为去中心化决策提供公平、高效的治理框架。

## 核心特性

- 🗳️ **二次方投票**: 投票成本 = 票数²，防止大户垄断，保障少数派话语权
- 🔗 **委托投票**: 支持多层级委托链，内置环路检测算法（DFS）防止循环委托
- 📋 **提案全生命周期**: Draft→Active→Queue→Execute 完整状态流转，支持取消和否决
- 💰 **资金库管理**: 自动分配预算，支持多币种管理和支出审批
- 📊 **治理分析**: 投票参与率、提案通过率、委托网络可视化

## 系统架构

```
┌─────────────────────────────────────────────────┐
│               DAO 治理 2.0 应用层                │
│  create-proposal │ vote │ delegate │ execute    │
├──────────────────┴──────┴──────────┴────────────┤
│              DAO Governance Engine               │
├────────────┬────────────┬───────────────────────┤
│ 二次方投票  │ 委托投票    │ 资金库管理            │
│ cost=票数² │ DFS环路检测 │ 多币种+预算分配       │
├────────────┴────────────┴───────────────────────┤
│     提案生命周期 (Draft→Active→Queue→Execute)    │
├─────────────────────────────────────────────────┤
│  SQLite (dao_proposals, dao_votes, dao_treasury) │
└─────────────────────────────────────────────────┘
```

## 提案状态流转

```
  ┌───────┐    提交     ┌────────┐   投票通过   ┌───────┐   延时结束   ┌─────────┐
  │ Draft │───────────→│ Active │────────────→│ Queue │────────────→│ Execute │
  └───────┘            └────────┘              └───────┘              └─────────┘
      │                    │                       │
      │ 撤回               │ 投票未达标            │ 否决
      ▼                    ▼                       ▼
  ┌──────────┐       ┌──────────┐           ┌──────────┐
  │ Canceled │       │ Defeated │           │  Vetoed  │
  └──────────┘       └──────────┘           └──────────┘
```

## 创建提案

```javascript
const result = await window.electron.ipcRenderer.invoke("dao:create-proposal", {
  title: "增加社区开发基金预算",
  description:
    "建议将季度开发基金从 1000 CCT 增加到 2000 CCT，用于激励更多开源贡献者参与...",
  type: "treasury", // treasury | parameter | upgrade | general
  actions: [
    {
      type: "transfer",
      to: "did:chainless:dev-fund",
      amount: 2000,
      currency: "CCT",
    },
  ],
  votingPeriod: 604800000, // 7 天
  quorum: 0.15, // 15% 参与率
  executionDelay: 172800000, // 2 天延时执行
});
// {
//   success: true,
//   proposalId: "prop-20260310-001",
//   status: "draft",
//   createdBy: "did:chainless:proposer",
//   votingStartsAt: null,
//   estimatedCost: { quadraticBase: 1 }
// }
```

## 投票

```javascript
const result = await window.electron.ipcRenderer.invoke("dao:vote", {
  proposalId: "prop-20260310-001",
  votes: 3, // 二次方投票：成本 = 3² = 9 tokens
  direction: "for", // for | against | abstain
  reason: "支持增加开发基金，有利于生态发展",
});
// {
//   success: true,
//   voteId: "vote-001",
//   quadraticCost: 9,
//   effectiveVotes: 3,
//   tokenBalance: 91,
//   currentTally: { for: 15, against: 4, abstain: 2, quorumReached: true }
// }
```

## 委托投票

```javascript
const result = await window.electron.ipcRenderer.invoke("dao:delegate", {
  delegateTo: "did:chainless:expert-alice",
  scope: "all", // all | category:treasury | proposal:prop-001
  votingPower: 100, // 委托的投票权重（百分比）
  expiry: 1712000000000,
  revocable: true,
});
// {
//   success: true,
//   delegationId: "del-001",
//   delegateTo: "did:chainless:expert-alice",
//   cycleCheck: { passed: true, chainLength: 1 },
//   effectiveFrom: 1710100000000
// }
```

## 执行提案

```javascript
const result = await window.electron.ipcRenderer.invoke("dao:execute", {
  proposalId: "prop-20260310-001",
});
// {
//   success: true,
//   executed: true,
//   actions: [
//     { type: "transfer", to: "did:chainless:dev-fund", amount: 2000, status: "completed", txId: "tx-001" }
//   ],
//   executedAt: 1710200000000
// }
```

## 查询资金库

```javascript
const result = await window.electron.ipcRenderer.invoke("dao:get-treasury", {
  includeHistory: true,
  limit: 20,
});
// {
//   success: true,
//   treasury: {
//     balance: { CCT: 50000, ETH: 2.5 },
//     allocations: [
//       { category: "development", budget: 10000, spent: 3500 },
//       { category: "marketing", budget: 5000, spent: 1200 },
//       { category: "operations", budget: 3000, spent: 800 }
//     ],
//     recentTransactions: [...]
//   }
// }
```

## 分配资金

```javascript
const result = await window.electron.ipcRenderer.invoke("dao:allocate-funds", {
  proposalId: "prop-20260310-001",
  allocations: [{ category: "development", amount: 2000, currency: "CCT" }],
  autoExecute: false,
});
// { success: true, allocationId: "alloc-001", pendingApproval: true, requiredVotes: 3 }
```

## 治理统计

```javascript
const result = await window.electron.ipcRenderer.invoke(
  "dao:get-governance-stats",
  {
    timeRange: { start: 1709000000000, end: 1710000000000 },
  },
);
// {
//   success: true,
//   stats: {
//     totalProposals: 23,
//     passed: 15,
//     defeated: 5,
//     active: 3,
//     avgParticipation: 0.42,
//     avgQuadraticCost: 12.3,
//     topDelegates: [...],
//     treasuryGrowth: 12.5
//   }
// }
```

## 配置治理参数

```javascript
const result = await window.electron.ipcRenderer.invoke("dao:configure", {
  voting: {
    quadraticEnabled: true,
    defaultPeriod: 604800000,
    minQuorum: 0.1,
  },
  delegation: {
    maxChainDepth: 5,
    cycleDetection: true,
  },
  treasury: {
    autoAllocation: true,
    approvalThreshold: 3,
  },
});
// { success: true, updated: true }
```

## IPC 接口完整列表

### DAO 治理操作（8 个）

| 通道                       | 功能         | 说明                                         |
| -------------------------- | ------------ | -------------------------------------------- |
| `dao:create-proposal`      | 创建提案     | 支持 treasury/parameter/upgrade/general 类型 |
| `dao:vote`                 | 投票         | 二次方投票，成本 = 票数²                     |
| `dao:delegate`             | 委托投票     | 多层级委托，内置环路检测                     |
| `dao:execute`              | 执行提案     | 延时结束后执行已通过的提案                   |
| `dao:get-treasury`         | 查询资金库   | 余额、分配、交易历史                         |
| `dao:allocate-funds`       | 分配资金     | 按提案分配资金库预算                         |
| `dao:get-governance-stats` | 治理统计     | 参与率、通过率、委托网络                     |
| `dao:configure`            | 配置治理参数 | 投票规则、委托规则、资金库配置               |

## 数据库 Schema

**3 张核心表**:

| 表名            | 用途       | 关键字段                                          |
| --------------- | ---------- | ------------------------------------------------- |
| `dao_proposals` | 提案存储   | id, title, type, status, quorum, voting_period    |
| `dao_votes`     | 投票记录   | id, proposal_id, voter_did, votes, quadratic_cost |
| `dao_treasury`  | 资金库记录 | id, type, amount, currency, proposal_id           |

### dao_proposals 表

```sql
CREATE TABLE IF NOT EXISTS dao_proposals (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL,                  -- treasury | parameter | upgrade | general
  status TEXT DEFAULT 'draft',         -- draft | active | queue | execute | defeated | canceled | vetoed
  proposer_did TEXT NOT NULL,
  actions TEXT,                         -- JSON: 执行动作列表
  quorum REAL DEFAULT 0.1,
  voting_period INTEGER DEFAULT 604800000,
  execution_delay INTEGER DEFAULT 172800000,
  votes_for INTEGER DEFAULT 0,
  votes_against INTEGER DEFAULT 0,
  votes_abstain INTEGER DEFAULT 0,
  voting_starts_at INTEGER,
  voting_ends_at INTEGER,
  executed_at INTEGER,
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
  updated_at INTEGER DEFAULT (strftime('%s','now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_dao_prop_status ON dao_proposals(status);
CREATE INDEX IF NOT EXISTS idx_dao_prop_type ON dao_proposals(type);
CREATE INDEX IF NOT EXISTS idx_dao_prop_proposer ON dao_proposals(proposer_did);
```

### dao_votes 表

```sql
CREATE TABLE IF NOT EXISTS dao_votes (
  id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL,
  voter_did TEXT NOT NULL,
  direction TEXT NOT NULL,             -- for | against | abstain
  votes INTEGER NOT NULL,
  quadratic_cost REAL NOT NULL,
  delegated_from TEXT,                 -- NULL if direct vote, DID if delegated
  reason TEXT,
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
  UNIQUE(proposal_id, voter_did)
);
CREATE INDEX IF NOT EXISTS idx_dao_votes_proposal ON dao_votes(proposal_id);
CREATE INDEX IF NOT EXISTS idx_dao_votes_voter ON dao_votes(voter_did);
```

### dao_treasury 表

```sql
CREATE TABLE IF NOT EXISTS dao_treasury (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,                  -- deposit | withdrawal | allocation | transfer
  amount REAL NOT NULL,
  currency TEXT DEFAULT 'CCT',
  category TEXT,                       -- development | marketing | operations | custom
  proposal_id TEXT,
  from_address TEXT,
  to_address TEXT,
  description TEXT,
  status TEXT DEFAULT 'completed',     -- pending | completed | failed | reverted
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_dao_treasury_type ON dao_treasury(type);
CREATE INDEX IF NOT EXISTS idx_dao_treasury_category ON dao_treasury(category);
CREATE INDEX IF NOT EXISTS idx_dao_treasury_proposal ON dao_treasury(proposal_id);
```

## 配置

在 `.chainlesschain/config.json` 中配置：

```json
{
  "daoGovernance": {
    "enabled": true,
    "voting": {
      "quadraticEnabled": true,
      "defaultPeriod": 604800000,
      "minQuorum": 0.1,
      "maxQuorum": 0.5,
      "initialTokenAllocation": 100
    },
    "delegation": {
      "enabled": true,
      "maxChainDepth": 5,
      "cycleDetection": true,
      "defaultExpiry": 2592000000
    },
    "treasury": {
      "autoAllocation": true,
      "approvalThreshold": 3,
      "currencies": ["CCT", "ETH"],
      "budgetCategories": ["development", "marketing", "operations"]
    },
    "executionDelay": 172800000
  }
}
```

## 故障排除

| 问题                  | 解决方案                                          |
| --------------------- | ------------------------------------------------- |
| 委托出现环路错误      | 系统已内置 DFS 环路检测，尝试更换委托对象         |
| 提案投票未达法定人数  | 延长投票周期或降低 minQuorum 配置                 |
| 资金库余额不足        | 检查资金库余额，等待新的存入或调整分配金额        |
| 二次方投票 token 不足 | 当前余额不足以支付投票成本（票数²），减少投票数量 |

## 关键文件

| 文件 | 职责 |
| --- | --- |
| `desktop-app-vue/src/main/blockchain/dao-governance-v2.js` | DAO 治理引擎核心 |
| `desktop-app-vue/src/main/blockchain/quadratic-voting.js` | 二次方投票算法 |
| `desktop-app-vue/src/main/blockchain/delegation-manager.js` | 委托投票与环路检测 |
| `desktop-app-vue/src/main/blockchain/treasury-manager.js` | 资金库管理 |
| `desktop-app-vue/src/main/blockchain/dao-governance-ipc.js` | DAO 8 个 IPC Handler |

## 相关文档

- [去中心化身份 2.0](/chainlesschain/did-v2)
- [隐私计算框架](/chainlesschain/privacy-computing)
- [Token 代币激励](/chainlesschain/token-incentive)
