# AI 社区治理

> **Phase 54 | v1.1.0 | 4 IPC 处理器 | 2 张新数据库表**

## 核心特性

- 📋 **结构化提案管理**: 支持参数变更、功能请求、策略更新、预算分配四种提案类型
- 🤖 **AI 影响分析**: 自动评估提案对安全/性能/兼容性的多维度潜在影响
- 📊 **投票结果预测**: 基于社区情感分析预测投票走向，提供置信度与关键因素
- 🗳️ **DID 身份投票**: 与去中心化身份绑定的投票机制，防止女巫攻击与刷票
- ⚙️ **可配置治理参数**: 投票时长、法定人数、最大活跃提案等参数均可自定义

## 系统架构

```
┌────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  Vue3 前端  │────→│  IPC 处理器       │────→│  Governance Core │
│  治理页面   │     │  governance:*     │     │  提案 + AI 分析   │
└────────────┘     └──────────────────┘     └────────┬─────────┘
                                                      │
                         ┌────────────┬───────────────┼──────────┐
                         ▼            ▼               ▼          ▼
                   ┌──────────┐ ┌──────────┐  ┌──────────┐ ┌─────────┐
                   │ 提案管理 │ │ AI 影响  │  │ 投票预测 │ │ DID     │
                   │ CRUD     │ │ 分析引擎 │  │ 情感分析 │ │ 身份    │
                   └──────────┘ └──────────┘  └──────────┘ └─────────┘
                         │                                       │
                         ▼                                       ▼
                   ┌──────────────┐                  ┌───────────────┐
                   │ governance_  │                  │ governance_    │
                   │ proposals    │                  │ votes          │
                   └──────────────┘                  └───────────────┘
```

## 概述

Phase 54 为 ChainlessChain 引入 AI 驱动的社区治理能力，支持提案管理、AI 影响分析和投票预测，帮助去中心化社区实现高效透明的治理决策。

**核心目标**:

- 📋 **提案管理**: 结构化提案创建、审议和投票流程
- 🤖 **AI 影响分析**: 自动评估提案对系统的潜在影响
- 📊 **投票预测**: 基于社区情感的投票结果预测
- ⚙️ **治理参数**: 可配置的投票时长、法定人数等参数

---

## 提案类型

| 类型                  | 说明     | 影响范围 | 示例             |
| --------------------- | -------- | -------- | ---------------- |
| **PARAMETER_CHANGE**  | 参数变更 | 系统配置 | 修改投票法定人数 |
| **FEATURE_REQUEST**   | 功能请求 | 产品功能 | 新增隐私通信功能 |
| **POLICY_UPDATE**     | 策略更新 | 社区规则 | 修改内容审核标准 |
| **BUDGET_ALLOCATION** | 预算分配 | 资源管理 | 分配开发资金     |

---

## 核心功能

### 1. 提案管理

```javascript
// 创建提案
const proposal = await window.electronAPI.invoke("governance:create-proposal", {
  title: "提升默认加密强度至 AES-256-GCM",
  description:
    "鉴于量子计算威胁，建议将系统默认加密从 AES-128 升级到 AES-256-GCM...",
  type: "PARAMETER_CHANGE",
  proposerDid: "did:chainless:abc123",
  parameters: {
    targetConfig: "encryption.defaultAlgorithm",
    currentValue: "AES-128-CBC",
    proposedValue: "AES-256-GCM",
  },
});

console.log(proposal);
// {
//   id: 'prop-001',
//   title: '提升默认加密强度至 AES-256-GCM',
//   type: 'PARAMETER_CHANGE',
//   status: 'DRAFT',
//   proposerDid: 'did:chainless:abc123',
//   votesFor: 0,
//   votesAgainst: 0,
//   votesAbstain: 0,
//   votingStartsAt: null,
//   votingEndsAt: null,
//   createdAt: 1709078400000
// }

// 列出所有提案
const proposals = await window.electronAPI.invoke("governance:list-proposals", {
  status: "ACTIVE", // DRAFT/ACTIVE/PASSED/REJECTED/EXPIRED
  type: "PARAMETER_CHANGE",
  limit: 20,
});
```

---

### 2. AI 影响分析

```javascript
// 对提案进行 AI 影响分析
const analysis = await window.electronAPI.invoke("governance:analyze-impact", {
  proposalId: "prop-001",
});

console.log(analysis);
// {
//   proposalId: 'prop-001',
//   impactLevel: 'MEDIUM',
//   analysis: {
//     securityImpact: {
//       level: 'positive',
//       description: '显著提升抗量子攻击能力'
//     },
//     performanceImpact: {
//       level: 'minor-negative',
//       description: '加密延迟增加约 15%，但仍在可接受范围'
//     },
//     compatibilityImpact: {
//       level: 'moderate',
//       description: '需更新所有客户端加密库'
//     },
//     overallRecommendation: 'APPROVE_WITH_CONDITIONS',
//     conditions: [
//       '建议设置 30 天过渡期',
//       '提供向后兼容的降级选项'
//     ]
//   },
//   analyzedAt: 1709078400000
// }
```

---

### 3. 投票预测

```javascript
// 预测投票结果
const prediction = await window.electronAPI.invoke("governance:predict-vote", {
  proposalId: "prop-001",
});

console.log(prediction);
// {
//   proposalId: 'prop-001',
//   prediction: {
//     outcome: 'LIKELY_PASS',
//     confidence: 0.78,
//     estimatedFor: 65,
//     estimatedAgainst: 25,
//     estimatedAbstain: 10,
//     sentimentAnalysis: {
//       positive: 0.62,
//       neutral: 0.23,
//       negative: 0.15
//     },
//     keyFactors: [
//       '安全性提升获得广泛支持',
//       '性能影响引起部分担忧',
//       '迁移成本是主要反对理由'
//     ]
//   },
//   predictedAt: 1709078400000
// }
```

---

## 提案生命周期

```
创建 → 审议 → 投票 → 执行/拒绝
  │       │       │       │
DRAFT   ACTIVE  投票中   PASSED/REJECTED
          │               │
      AI 影响分析      EXPIRED (超时)
      投票预测
```

**投票规则**:

- **投票时长**: 默认 7 天（可配置）
- **法定人数**: 51% 参与率（可配置）
- **通过条件**: 赞成票 > 反对票且达到法定人数

---

## 数据库结构

```sql
CREATE TABLE governance_proposals (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL,             -- PARAMETER_CHANGE/FEATURE_REQUEST/POLICY_UPDATE/BUDGET_ALLOCATION
  proposer_did TEXT NOT NULL,
  status TEXT DEFAULT 'DRAFT',    -- DRAFT/ACTIVE/PASSED/REJECTED/EXPIRED
  impact_level TEXT,              -- LOW/MEDIUM/HIGH/CRITICAL
  impact_analysis TEXT,           -- JSON AI 分析结果
  votes_for INTEGER DEFAULT 0,
  votes_against INTEGER DEFAULT 0,
  votes_abstain INTEGER DEFAULT 0,
  voting_starts_at INTEGER,
  voting_ends_at INTEGER,
  parameters TEXT,                -- JSON 提案参数
  created_at INTEGER NOT NULL,
  updated_at INTEGER
);

CREATE TABLE governance_votes (
  id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL,
  voter_did TEXT NOT NULL,
  vote TEXT NOT NULL,             -- for/against/abstain
  reason TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(proposal_id, voter_did)
);
```

---

## 前端集成

### Pinia Store

```typescript
import { useGovernanceStore } from "@/stores/governance";

const governance = useGovernanceStore();

// 获取提案列表
await governance.fetchProposals();

// 创建提案
await governance.createProposal(proposalData);

// AI 影响分析
await governance.analyzeImpact(proposalId);
console.log(governance.currentAnalysis);

// 投票预测
await governance.predictVote(proposalId);
console.log(governance.votePrediction);
```

### 前端页面

**AI 社区治理页面** (`/governance`)

**功能模块**:

1. **提案列表**
   - 按状态/类型筛选
   - 投票进度展示
   - 提案详情查看

2. **创建提案**
   - 提案类型选择
   - 结构化表单填写
   - 参数配置

3. **AI 分析面板**
   - 影响分析报告
   - 投票预测结果
   - 情感分析可视化

4. **投票管理**
   - 投票操作
   - 投票结果统计
   - 历史提案归档

---

## 配置选项

```json
{
  "governance": {
    "enabled": true,
    "votingDuration": 604800000,
    "quorumPercentage": 51,
    "aiAnalysisEnabled": true,
    "votePredictionEnabled": true,
    "maxActiveProposals": 10,
    "proposalCooldown": 86400000
  }
}
```

---

## 安全考虑

1. **DID 身份绑定**: 所有投票与 DID 绑定，防止刷票
2. **唯一投票**: 每个 DID 对每个提案只能投一票
3. **不可篡改**: 投票记录不可修改，确保结果可审计
4. **AI 透明性**: AI 分析结果附带推理依据
5. **防女巫攻击**: 投票权重可与信誉系统关联

---

## 性能指标

| 指标         | 目标   | 实际   |
| ------------ | ------ | ------ |
| 提案创建延迟 | <200ms | ~100ms |
| AI 影响分析  | <5s    | ~3s    |
| 投票预测     | <3s    | ~2s    |
| 投票记录延迟 | <100ms | ~50ms  |

---

## 相关文档

- [去中心化社交](/chainlesschain/social)
- [Social AI + ActivityPub](/chainlesschain/social-ai)
- [内容推荐](/chainlesschain/content-recommendation)
- [产品路线图](/chainlesschain/product-roadmap)

## 关键文件

| 文件 | 职责 |
| --- | --- |
| `src/main/social/governance-manager.js` | 社区治理核心引擎（提案/投票/AI 分析） |
| `src/main/social/governance-ipc.js` | IPC 处理器（4 个通道） |
| `src/renderer/stores/governance.ts` | Pinia 状态管理 |
| `src/renderer/pages/social/GovernancePage.vue` | AI 社区治理页面 |

---

**文档版本**: 1.0.0
**最后更新**: 2026-02-27
