# 全球进化网络 (EvoMap Federation)

> **版本: v3.4.0 | 状态: ✅ 生产就绪 | 5 IPC Handlers | 2 数据库表 | 多 Hub 联邦进化**

ChainlessChain 全球进化网络实现了 EvoMap 多 Hub 联邦架构，支持基因跨 Hub 同步、进化压力选择、基因重组和谱系追踪。通过 Hub 间的互联互通，构建全球范围的 AI 基因进化生态。

## 核心特性

- 🌐 **多 Hub 互联发现**: 自动发现和连接远程 EvoMap Hub 节点
- 🧬 **跨 Hub 基因同步**: 基因在多个 Hub 之间双向同步传播
- 📊 **进化压力选择**: 基于适应度的自然选择机制，淘汰低质量基因
- 🔀 **基因重组**: 多基因交叉重组，产生新的优化变体
- 🌳 **谱系 DAG 追踪**: 有向无环图记录完整基因演化路径

## 系统架构

```
┌──────────┐       ┌──────────┐       ┌──────────┐
│ Hub Asia │◄─────►│ Hub EU   │◄─────►│ Hub US   │
│ 基因: 150 │       │ 基因: 230 │       │ 基因: 180 │
└────┬─────┘       └────┬─────┘       └────┬─────┘
     │                   │                   │
     └───────────┬───────┘───────────────────┘
                 ▼
        ┌─────────────────┐
        │  Federation Core │
        │  同步 / 重组引擎  │
        └────────┬────────┘
                 │
     ┌───────────┼───────────┐
     ▼           ▼           ▼
┌─────────┐ ┌─────────┐ ┌──────────┐
│ 基因同步 │ │ 进化压力 │ │ 谱系 DAG │
│ Push/Pull│ │ 适应度   │ │ 追踪     │
└─────────┘ └─────────┘ └──────────┘
```

## 列出联邦 Hub

```javascript
const result = await window.electron.ipcRenderer.invoke(
  "evomap-federation:list-hubs",
);
// result.hubs = [
//   { id, name: "Asia Hub", endpoint: "https://...", status: "online", geneCount: 150 },
//   { id, name: "Europe Hub", endpoint: "https://...", status: "online", geneCount: 230 },
// ]
```

## 跨 Hub 基因同步

```javascript
const result = await window.electron.ipcRenderer.invoke(
  "evomap-federation:sync-genes",
  {
    targetHubId: "hub-europe",
    geneIds: ["gene-001", "gene-002"],
    direction: "push", // push | pull | bidirectional
  },
);
// result = { success: true, synced: 2, conflicts: 0 }
```

## 获取进化压力报告

```javascript
const result = await window.electron.ipcRenderer.invoke(
  "evomap-federation:get-pressure-report",
);
// result.report = {
//   totalGenes: 380,
//   activeGenes: 320,
//   eliminatedGenes: 60,
//   avgFitness: 0.72,
//   topPerformers: [...],
// }
```

## 基因重组

```javascript
const result = await window.electron.ipcRenderer.invoke(
  "evomap-federation:recombine-genes",
  {
    parentGenes: ["gene-001", "gene-002"],
    strategy: "crossover", // crossover | mutation | hybrid
  },
);
// result.offspring = { id: "gene-new", parents: [...], fitness: 0.85 }
```

## 查询基因谱系

```javascript
const result = await window.electron.ipcRenderer.invoke(
  "evomap-federation:get-lineage",
  "gene-001",
);
// result.lineage = {
//   geneId: "gene-001",
//   generations: 5,
//   ancestors: [...],
//   descendants: [...],
//   dagStructure: { nodes: [...], edges: [...] },
// }
```

## IPC 接口完整列表

### EvoMap Federation 操作（5 个）

| 通道                                    | 功能            | 说明                   |
| --------------------------------------- | --------------- | ---------------------- |
| `evomap-federation:list-hubs`           | 列出联邦 Hub    | 发现和列出所有已知 Hub |
| `evomap-federation:sync-genes`          | 跨 Hub 基因同步 | 推送/拉取/双向同步     |
| `evomap-federation:get-pressure-report` | 进化压力报告    | 适应度统计和淘汰分析   |
| `evomap-federation:recombine-genes`     | 基因重组        | 交叉/变异/混合策略     |
| `evomap-federation:get-lineage`         | 查询基因谱系    | DAG 格式的演化路径     |

## 数据库 Schema

**2 张核心表**:

| 表名                    | 用途         | 关键字段                                   |
| ----------------------- | ------------ | ------------------------------------------ |
| `evomap_hub_federation` | Hub 注册表   | id, name, endpoint, status, gene_count     |
| `gene_lineage`          | 基因谱系 DAG | id, gene_id, parent_ids (JSON), generation |

## 前端集成

### EvoMapFederationPage 页面

**功能模块**:

- **Hub 列表**: 展示所有联邦 Hub 的状态、基因数量
- **同步操作**: 选择目标 Hub 和基因进行同步
- **进化压力图表**: 可视化适应度分布和淘汰趋势
- **谱系浏览**: 查询和展示基因演化 DAG

### Pinia Store (evoMapFederation.ts)

```typescript
const useEvoMapFederationStore = defineStore("evoMapFederation", {
  state: () => ({
    hubs: [],
    pressureReport: null,
    lineage: null,
    loading: false,
    error: null,
  }),
  actions: {
    fetchHubs, // → evomap-federation:list-hubs
    syncGenes, // → evomap-federation:sync-genes
    fetchPressureReport, // → evomap-federation:get-pressure-report
    recombineGenes, // → evomap-federation:recombine-genes
    fetchLineage, // → evomap-federation:get-lineage
  },
});
```

## 关键文件

| 文件                                             | 职责               | 行数 |
| ------------------------------------------------ | ------------------ | ---- |
| `src/main/evomap/evomap-federation.js`           | 联邦进化核心引擎   | ~250 |
| `src/main/evomap/evomap-federation-ipc.js`       | IPC 处理器（5 个） | ~130 |
| `src/renderer/stores/evoMapFederation.ts`        | Pinia 状态管理     | ~100 |
| `src/renderer/pages/ai/EvoMapFederationPage.vue` | 联邦进化页面       | ~100 |

## 测试覆盖率

```
✅ evomap-federation.test.js                - Hub 发现/同步/重组/谱系测试
✅ stores/evoMapFederation.test.ts          - Store 状态管理测试
✅ e2e/ai/evomap-federation.e2e.test.ts     - 端到端用户流程测试
```

## 相关文档

- [EvoMap 进化图谱 →](/chainlesschain/evomap)
- [IP 与治理 DAO →](/chainlesschain/evomap-governance)
- [Skill Marketplace 技能市场 →](/chainlesschain/skill-marketplace)
