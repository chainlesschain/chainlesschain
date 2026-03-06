# IP 保护与治理 DAO

> **版本: v3.4.0 | 状态: ✅ 生产就绪 | 5 IPC Handlers | 2 数据库表 | DID+VC 版权 + 去中心化治理**

ChainlessChain IP 与治理 DAO 为 EvoMap 生态提供基因知识产权保护和去中心化治理能力。通过 DID+VC 原创性证明、反剽窃检测、衍生链追踪和收益分成管理，保护创作者权益；同时提供提案投票机制实现社区自治。

## 核心特性

- 🪪 **DID+VC 原创性证明**: 基于 W3C 可验证凭证的原创性认证
- 🔍 **反剽窃检测**: 自动检测基因相似度，识别潜在剽窃
- 🔗 **衍生链追踪**: 完整记录基因的衍生关系和贡献者链
- 💰 **收益分成管理**: 按贡献比例自动分配收益
- 🗳️ **治理提案投票**: 创建提案、投票表决、法定人数检查

## 提案状态流转

```
草稿 (draft) → 活跃 (active) → 通过 (passed) → 已执行 (executed)
                              ↓
                          否决 (rejected)
```

## 注册基因所有权

```javascript
const result = await window.electron.ipcRenderer.invoke(
  "evomap-gov:register-ownership",
  {
    geneId: "gene-001",
    ownerDid: "did:example:alice",
    originalityProof: {
      method: "did-vc",
      timestamp: Date.now(),
    },
    revenueSplit: {
      "did:example:alice": 70,
      "did:example:bob": 30,
    },
  },
);
// result.ownership = {
//   id: "uuid",
//   gene_id: "gene-001",
//   owner_did: "did:example:alice",
//   verified: 1,
//   plagiarism_score: 0.0,
// }
```

## 追踪贡献链

```javascript
const result = await window.electron.ipcRenderer.invoke(
  "evomap-gov:trace-contributions",
  "gene-001",
);
// result = {
//   geneId: "gene-001",
//   owner: "did:example:alice",
//   contributors: ["did:example:alice", "did:example:bob"],
//   derivationChain: [],
//   revenueSplit: { "did:example:alice": 70, "did:example:bob": 30 },
// }
```

## 创建治理提案

```javascript
const result = await window.electron.ipcRenderer.invoke(
  "evomap-gov:create-proposal",
  {
    title: "提升基因质量评分标准",
    description: "将最低质量分数从 0.3 提高到 0.5，淘汰低质量基因...",
    proposerDid: "did:example:alice",
    type: "standard", // standard | emergency | parameter
    votingDurationMs: 7 * 24 * 60 * 60 * 1000, // 7 天
  },
);
// result.proposal = {
//   id: "uuid",
//   title: "提升基因质量评分标准",
//   status: "active",
//   votes_for: 0,
//   votes_against: 0,
// }
```

## 投票

```javascript
const result = await window.electron.ipcRenderer.invoke(
  "evomap-gov:cast-vote",
  {
    proposalId: "proposal-001",
    voterDid: "did:example:bob",
    vote: "for", // for | against
  },
);
// result = {
//   proposalId: "proposal-001",
//   vote: "for",
//   totalVotes: 3,
//   status: "passed",               // 达到法定人数（≥3票）自动裁决
// }
```

## 查询治理仪表板

```javascript
const result = await window.electron.ipcRenderer.invoke(
  "evomap-gov:get-governance-dashboard",
);
// result.dashboard = {
//   totalProposals: 10,
//   active: 2,
//   passed: 5,
//   rejected: 2,
//   executed: 1,
// }
```

## IPC 接口完整列表

### IP 与治理操作（5 个）

| 通道                                  | 功能           | 说明                       |
| ------------------------------------- | -------------- | -------------------------- |
| `evomap-gov:register-ownership`       | 注册基因所有权 | DID+VC 原创性证明          |
| `evomap-gov:trace-contributions`      | 追踪贡献链     | 查询衍生关系和收益分成     |
| `evomap-gov:create-proposal`          | 创建治理提案   | 支持标准/紧急/参数三种类型 |
| `evomap-gov:cast-vote`                | 投票表决       | for/against，≥3 票自动裁决 |
| `evomap-gov:get-governance-dashboard` | 治理仪表板     | 提案统计和状态分布         |

## 数据库 Schema

**2 张核心表**:

| 表名                          | 用途       | 关键字段                                                 |
| ----------------------------- | ---------- | -------------------------------------------------------- |
| `gene_ownership`              | 基因所有权 | id, gene_id, owner_did, originality_proof, revenue_split |
| `evomap_governance_proposals` | 治理提案   | id, title, status, votes_for, votes_against, quorum      |

### gene_ownership 表

```sql
CREATE TABLE IF NOT EXISTS gene_ownership (
  id TEXT PRIMARY KEY,
  gene_id TEXT NOT NULL,
  owner_did TEXT NOT NULL,
  originality_proof TEXT,                -- JSON: DID+VC 证明
  derivation_chain TEXT,                 -- JSON: 衍生链
  revenue_split TEXT,                    -- JSON: 收益分成比例
  verified INTEGER DEFAULT 0,
  plagiarism_score REAL DEFAULT 0.0,     -- 0-1 剽窃分数
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_gene_ownership_gene ON gene_ownership(gene_id);
CREATE INDEX IF NOT EXISTS idx_gene_ownership_owner ON gene_ownership(owner_did);
```

### evomap_governance_proposals 表

```sql
CREATE TABLE IF NOT EXISTS evomap_governance_proposals (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  proposer_did TEXT,
  type TEXT DEFAULT 'standard',          -- standard | emergency | parameter
  status TEXT DEFAULT 'draft',           -- draft | active | passed | rejected | executed
  votes_for INTEGER DEFAULT 0,
  votes_against INTEGER DEFAULT 0,
  quorum_reached INTEGER DEFAULT 0,
  voting_deadline INTEGER,
  executed_at INTEGER,
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_evomap_gov_status ON evomap_governance_proposals(status);
CREATE INDEX IF NOT EXISTS idx_evomap_gov_proposer ON evomap_governance_proposals(proposer_did);
```

## 前端集成

### EvoMapGovernancePage 页面

**功能模块**:

- **治理仪表板**: 提案总数 / 活跃 / 通过 / 否决统计
- **提案列表**: 展示标题、状态、投票数、提案者
- **创建提案**: 表单输入标题/描述/类型/投票时长
- **投票操作**: 对活跃提案进行赞成/反对投票

### Pinia Store (evoMapGovernance.ts)

```typescript
const useEvoMapGovernanceStore = defineStore("evoMapGovernance", {
  state: () => ({
    proposals: [],
    dashboard: null,
    ownerships: [],
    loading: false,
    error: null,
  }),
  actions: {
    registerOwnership, // → evomap-gov:register-ownership
    traceContributions, // → evomap-gov:trace-contributions
    createProposal, // → evomap-gov:create-proposal
    castVote, // → evomap-gov:cast-vote
    fetchDashboard, // → evomap-gov:get-governance-dashboard
  },
});
```

## 关键文件

| 文件                                             | 职责               | 行数 |
| ------------------------------------------------ | ------------------ | ---- |
| `src/main/evomap/gene-ip-manager.js`             | 基因 IP 保护引擎   | ~160 |
| `src/main/evomap/evomap-dao.js`                  | 治理 DAO 核心引擎  | ~204 |
| `src/main/evomap/evomap-governance-ipc.js`       | IPC 处理器（5 个） | ~130 |
| `src/renderer/stores/evoMapGovernance.ts`        | Pinia 状态管理     | ~100 |
| `src/renderer/pages/ai/EvoMapGovernancePage.vue` | 治理 DAO 页面      | ~100 |

## 测试覆盖率

```
✅ gene-ip-manager.test.js                - 所有权注册/贡献追踪/反剽窃测试
✅ evomap-dao.test.js                     - 提案创建/投票/法定人数测试
✅ stores/evoMapGovernance.test.ts        - Store 状态管理测试
✅ e2e/ai/evomap-governance.e2e.test.ts   - 端到端用户流程测试
```

## 相关文档

- [EvoMap 进化图谱 →](/chainlesschain/evomap)
- [全球进化网络 →](/chainlesschain/evomap-federation)
- [Token Incentive 代币激励 →](/chainlesschain/token-incentive)
