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

## 使用示例

### 创建提案并发起投票

```javascript
// 创建参数变更提案
const proposal = await window.electronAPI.invoke("governance:create-proposal", {
  title: "将默认加密算法升级为 AES-256-GCM",
  type: "PARAMETER_CHANGE",
  proposerDid: "did:chainless:my-did",
  parameters: {
    targetConfig: "encryption.defaultAlgorithm",
    currentValue: "AES-128-CBC",
    proposedValue: "AES-256-GCM",
  },
});
// proposal.status = 'DRAFT'，需提交后进入 ACTIVE 投票阶段
```

### AI 影响分析与投票预测

```javascript
// 对提案执行 AI 影响分析
const analysis = await window.electronAPI.invoke("governance:analyze-impact", {
  proposalId: "prop-001",
});
// analysis.analysis.overallRecommendation = 'APPROVE_WITH_CONDITIONS'

// 预测社区投票结果
const prediction = await window.electronAPI.invoke("governance:predict-vote", {
  proposalId: "prop-001",
});
// prediction.prediction.outcome = 'LIKELY_PASS', confidence = 0.78
```

## 故障排除

### 投票权重异常

**现象**: 投票结果统计与预期不符，某些 DID 的投票权重不正确。

**排查步骤**:
1. 确认每个 DID 仅投了一票（`UNIQUE(proposal_id, voter_did)` 约束保证唯一性）
2. 检查是否有委托投票影响了权重计算（若与信誉系统关联）
3. 查看 `governance_votes` 表确认所有投票记录的 `vote` 字段值正确
4. 确认投票统计时是否正确累加了 `for`、`against`、`abstain` 三类票数

### 提案冲突

**现象**: 两个提案修改同一配置参数，存在冲突。

**排查步骤**:
1. 使用 `governance:list-proposals` 筛选 `ACTIVE` 状态的提案，检查是否有参数冲突
2. 配置 `proposalCooldown`（默认 86400000ms / 24 小时）限制同类提案提交频率
3. 若两个提案均通过，系统按执行时间顺序应用，后执行的提案覆盖先执行的
4. 建议在提案描述中注明依赖关系，由社区通过投票决定优先级

## 故障排查

### 常见问题

| 症状 | 可能原因 | 解决方案 |
| --- | --- | --- |
| AI 分析结果偏差大 | 训练数据偏斜或分析模型过时 | 更新模型版本，补充平衡数据集 |
| 投票率低提案无法通过 | 参与门槛过高或通知未触达 | 降低 `quorumThreshold`，启用多渠道通知 |
| 提案冲突多个提案互相矛盾 | 缺乏提案依赖检查机制 | 启用提案冲突检测 `governance conflict-check` |
| 治理决议执行延迟 | 执行队列拥堵或审批流程卡住 | 检查执行队列 `governance queue-status`，催办审批 |
| 权限变更未生效 | 缓存未刷新或同步延迟 | 清除权限缓存 `governance cache-flush` |

### 常见错误修复

**错误: `AI_ANALYSIS_BIAS` AI 分析偏差**

```bash
# 查看分析模型版本
chainlesschain governance model-info

# 重新运行分析（使用最新模型）
chainlesschain governance analyze --proposal-id <id> --refresh-model
```

**错误: `QUORUM_NOT_REACHED` 未达法定人数**

```bash
# 查看当前投票进度
chainlesschain governance vote-progress --proposal-id <id>

# 延长投票周期
chainlesschain governance extend-voting --proposal-id <id> --days 7
```

**错误: `PROPOSAL_CONFLICT` 提案冲突**

```bash
# 检测提案间冲突
chainlesschain governance conflict-check --proposal-id <id>

# 查看冲突详情和建议
chainlesschain governance conflict-detail --proposal-id <id>
```

## 配置参考

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | 是否启用 AI 社区治理模块 |
| `votingDuration` | number (ms) | `604800000` | 单次提案投票周期，默认 7 天 |
| `quorumPercentage` | number (0–100) | `51` | 法定人数百分比，达到才能结算提案 |
| `aiAnalysisEnabled` | boolean | `true` | 是否对新提案自动触发 AI 影响分析 |
| `votePredictionEnabled` | boolean | `true` | 是否启用基于社区情感的投票结果预测 |
| `maxActiveProposals` | number | `10` | 同时处于 ACTIVE 状态的最大提案数量 |
| `proposalCooldown` | number (ms) | `86400000` | 同一 DID 连续提交提案的最短间隔，默认 24 小时 |

**配置示例**（宽松社区环境）:

```json
{
  "governance": {
    "enabled": true,
    "votingDuration": 1209600000,
    "quorumPercentage": 30,
    "aiAnalysisEnabled": true,
    "votePredictionEnabled": true,
    "maxActiveProposals": 20,
    "proposalCooldown": 43200000
  }
}
```

> **注意**: `quorumPercentage` 设置过低（< 20%）可能导致少数人操纵治理结果；建议生产环境保持 ≥ 40%。

---

## 测试覆盖率

### 单元测试

| 测试文件 | 覆盖场景 | 用例数 |
| --- | --- | --- |
| `tests/unit/social/governance-manager.test.js` | 提案 CRUD、状态流转、投票计数 | 24 |
| `tests/unit/social/governance-ai-analysis.test.js` | AI 影响分析评级、推荐结论生成 | 16 |
| `tests/unit/social/governance-vote-prediction.test.js` | 情感分析、预测置信度计算 | 14 |
| `tests/unit/social/governance-ipc.test.js` | 4 个 IPC 处理器输入验证与响应格式 | 18 |

### 集成测试

```bash
# 运行治理模块全量测试
cd desktop-app-vue && npx vitest run tests/unit/social/governance

# 仅运行 AI 分析相关用例
cd desktop-app-vue && npx vitest run tests/unit/social/governance-ai-analysis

# 运行 Pinia store 测试
cd desktop-app-vue && npx vitest run src/renderer/stores/__tests__/governance.test.ts
```

### 关键测试场景

```javascript
// 提案状态流转
it('proposal transitions from DRAFT → ACTIVE → PASSED', async () => { ... });

// DID 唯一投票约束
it('rejects duplicate vote from same DID', async () => { ... });

// AI 分析影响等级映射
it('maps HIGH security risk to impactLevel CRITICAL', async () => { ... });

// 法定人数校验
it('rejects result when participation below quorumPercentage', async () => { ... });

// 投票预测置信度范围
it('prediction confidence is between 0 and 1', async () => { ... });
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
