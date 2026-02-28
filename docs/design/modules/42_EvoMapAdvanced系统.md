# Phase 76-77 — EvoMap高级联邦与治理系统设计

**版本**: v3.4.0
**创建日期**: 2026-02-28
**状态**: ✅ 已实现 (v3.4.0)

---

## 一、模块概述

Phase 76-77 扩展EvoMap为全球进化网络，引入多Hub联邦同步、基因谱系追踪、知识产权保护和去中心化治理DAO。

### 1.1 核心目标

1. **联邦同步**: 多Hub之间的基因同步和进化压力传播
2. **基因谱系**: 完整的基因进化谱系树和重组记录
3. **知识产权**: DID+VC原创性证明和反剽窃
4. **治理DAO**: 基因质量投票和标准提案管理

### 1.2 技术架构

```
┌──────────────────────────────────────────────┐
│           EvoMap Advanced                      │
│                                                │
│  ┌───────────────────┐  ┌──────────────────┐  │
│  │ EvoMapFederation  │  │ GeneIPManager    │  │
│  │ Multi-Hub同步     │  │ DID+VC IP保护    │  │
│  │ 进化压力+重组     │  │ 反剽窃+收益分配  │  │
│  └───────────────────┘  └──────────────────┘  │
│  ┌───────────────────┐  ┌──────────────────┐  │
│  │ EvoMapFederation  │  │ EvoMapDAO        │  │
│  │ IPC (5 handlers)  │  │ 提案+投票+仲裁   │  │
│  └───────────────────┘  └──────────────────┘  │
│  ┌──────────────────────────────────────────┐ │
│  │  EvoMapGovernanceIPC (5 handlers)        │ │
│  └──────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘
```

---

## 二、核心模块设计

### 2.1 EvoMapFederation (Phase 76) (`evomap/evomap-federation.js`)

全球EvoMap Hub联邦网络。

**常量**:

- `HUB_STATUS`: ONLINE, OFFLINE, SYNCING, DEGRADED

**核心方法**:

- `initialize()` — 初始化联邦网络并加载Hub列表
- `listHubs(filter)` — 列出Hub（status, region, limit）
- `syncGenes({ hubId, geneIds })` — 与Hub同步基因
- `getPressureReport()` — 进化压力报告（总基因数、平均适应度、最大世代、突变/重组数）
- `recombineGenes({ geneId1, geneId2 })` — 基因重组（返回新谱系条目）
- `getLineage(geneId)` — 获取完整基因谱系树
- `buildFederationContext()` — 构建联邦上下文（Context Engineering注入）

### 2.2 GeneIPManager (Phase 77) (`evomap/gene-ip-manager.js`)

基因知识产权管理。

**核心方法**:

- `initialize()` — 初始化IP管理器
- `registerOwnership({ geneId, ownerDid, originalityProof, revenueSplit })` — 注册基因所有权（DID+VC证明）
- `traceContributions(geneId)` — 追踪贡献者和收益分配

### 2.3 EvoMapDAO (Phase 77) (`evomap/evomap-dao.js`)

去中心化治理DAO。

**常量**:

- `PROPOSAL_STATUS`: DRAFT, ACTIVE, PASSED, REJECTED, EXECUTED

**核心方法**:

- `initialize()` — 初始化DAO并加载活跃提案
- `createProposal({ title, description, proposerDid, type, votingDurationMs })` — 创建治理提案
- `castVote({ proposalId, voterDid, vote })` — 投票（for/against，达到quorum自动裁决）
- `getGovernanceDashboard()` — 治理仪表板（总提案数、各状态分布）

---

## 三、数据库设计

```sql
-- Phase 76: EvoMap Federation
CREATE TABLE IF NOT EXISTS evomap_hub_federation (
  id TEXT PRIMARY KEY,
  hub_url TEXT NOT NULL,
  hub_name TEXT,
  status TEXT DEFAULT 'online',
  region TEXT,
  gene_count INTEGER DEFAULT 0,
  last_sync INTEGER,
  trust_score REAL DEFAULT 1.0,
  created_at INTEGER
);

CREATE TABLE IF NOT EXISTS gene_lineage (
  id TEXT PRIMARY KEY,
  gene_id TEXT NOT NULL,
  parent_gene_id TEXT,
  hub_id TEXT,
  generation INTEGER DEFAULT 1,
  fitness_score REAL DEFAULT 0.5,
  mutation_type TEXT,
  recombination_source TEXT,
  created_at INTEGER
);

-- Phase 77: Gene IP + DAO
CREATE TABLE IF NOT EXISTS gene_ownership (
  id TEXT PRIMARY KEY,
  gene_id TEXT NOT NULL,
  owner_did TEXT NOT NULL,
  originality_proof TEXT,
  derivation_chain TEXT,
  revenue_split TEXT,
  verified INTEGER DEFAULT 0,
  plagiarism_score REAL DEFAULT 0.0,
  created_at INTEGER
);

CREATE TABLE IF NOT EXISTS evomap_governance_proposals (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  proposer_did TEXT,
  type TEXT DEFAULT 'standard',
  status TEXT DEFAULT 'draft',
  votes_for INTEGER DEFAULT 0,
  votes_against INTEGER DEFAULT 0,
  quorum_reached INTEGER DEFAULT 0,
  voting_deadline INTEGER,
  executed_at INTEGER,
  created_at INTEGER
);
```

---

## 四、IPC接口设计

### Phase 76 — EvoMapFederationIPC (5 handlers)

| 通道                             | 说明         |
| -------------------------------- | ------------ |
| `evomap-fed:list-hubs`           | 列出Hub      |
| `evomap-fed:sync-genes`          | 同步基因     |
| `evomap-fed:get-pressure-report` | 进化压力报告 |
| `evomap-fed:recombine-genes`     | 基因重组     |
| `evomap-fed:get-lineage`         | 基因谱系     |

### Phase 77 — EvoMapGovernanceIPC (5 handlers)

| 通道                                  | 说明       |
| ------------------------------------- | ---------- |
| `evomap-gov:register-ownership`       | 注册所有权 |
| `evomap-gov:trace-contributions`      | 追踪贡献   |
| `evomap-gov:create-proposal`          | 创建提案   |
| `evomap-gov:cast-vote`                | 投票       |
| `evomap-gov:get-governance-dashboard` | 治理仪表板 |

---

## 五、前端集成

### Pinia Stores

- `evoMapFederation.ts` — Hub列表、同步状态、进化压力、谱系
- `evoMapGovernance.ts` — 所有权记录、提案列表、投票、仪表板

### Vue Pages

- `EvoMapFederationPage.vue` — Hub管理/基因同步/进化压力/谱系可视化
- `EvoMapGovernancePage.vue` — IP注册/贡献追踪/提案管理/投票

### Routes

- `/evomap-federation` — EvoMap联邦
- `/evomap-governance` — EvoMap治理

---

## 六、配置选项

```javascript
evoMapFederation: {
  enabled: false,
  maxHubs: 50,
  syncIntervalMs: 60000,
  evolutionPressureEnabled: true,
  recombinationEnabled: true,
},
evoMapGovernance: {
  enabled: false,
  votingDurationMs: 604800000,
  quorumPercentage: 10,
  disputeArbitrationEnabled: true,
},
```

---

## 七、Context Engineering

- step 4.12: `setEvoMapFederation()` — 注入EvoMap联邦上下文
