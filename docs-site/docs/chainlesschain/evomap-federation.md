# 全球进化网络 (EvoMap Federation)

> **版本: v3.4.0 | 状态: ✅ 生产就绪 | 5 IPC Handlers | 2 数据库表 | 多 Hub 联邦进化**

ChainlessChain 全球进化网络实现了 EvoMap 多 Hub 联邦架构，支持基因跨 Hub 同步、进化压力选择、基因重组和谱系追踪。通过 Hub 间的互联互通，构建全球范围的 AI 基因进化生态。

## 概述

全球进化网络（EvoMap Federation）实现多 Hub 联邦架构下的 AI 基因跨节点同步与进化。系统支持 Hub 自动发现与互联、基因双向推拉同步、基于适应度的进化压力淘汰机制、多基因交叉重组以及 DAG 格式的完整谱系追踪，提供 5 个 IPC 接口和 2 张数据表。

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

## 使用示例

### 加入全球进化网络

1. 打开「全球进化网络」页面
2. 在「Hub 列表」中查看已知的联邦 Hub 节点
3. 系统自动发现并连接可用的远程 Hub
4. 查看每个 Hub 的状态、基因数量和在线状态

### 跨 Hub 基因同步

1. 选择目标 Hub 和需要同步的基因
2. 选择同步方向：push（推送）/ pull（拉取）/ bidirectional（双向）
3. 点击「同步」，系统自动处理冲突和版本合并
4. 查看同步结果：成功数量和冲突数量

### 基因重组实验

1. 在「基因重组」面板选择两个或多个父基因
2. 选择重组策略：crossover（交叉）/ mutation（变异）/ hybrid（混合）
3. 查看生成的子基因及其适应度评分
4. 高适应度子基因自动保留到基因库

## 故障排查

| 问题 | 可能原因 | 解决方案 |
| --- | --- | --- |
| Hub 发现失败 | 远程 Hub 不在线或网络不可达 | 检查网络连接，确认目标 Hub endpoint 地址正确 |
| 基因同步冲突过多 | 双方基因版本差异大 | 改用单向同步（push/pull），手动解决冲突 |
| 进化压力报告为空 | 基因库数据不足 | 需要累计一定数量的基因才能生成统计 |
| 重组后适应度为 0 | 父基因兼容性差 | 选择相似领域的基因进行重组 |
| 谱系 DAG 加载缓慢 | 基因历史代数过多 | 限制查询深度，分页加载谱系数据 |
| Hub 状态显示 offline | 心跳超时未响应 | 联系 Hub 管理员确认服务状态 |

## 配置参考

```javascript
// desktop-app-vue/src/main/evomap/evomap-federation.js
const DEFAULT_CONFIG = {
  federation: {
    hubHeartbeatIntervalMs: 30000,   // Hub 心跳检测间隔（30 秒）
    hubTimeoutMs: 90000,             // Hub 心跳超时判定离线（90 秒）
    maxHubsPerInstance: 20,          // 单实例最多联邦 Hub 数
    syncBatchSize: 50,               // 单次同步批量基因数
  },
  evolution: {
    fitnessThreshold: 0.3,           // 适应度低于此值的基因被淘汰
    recombinationRate: 0.8,          // 基因重组交叉概率
    mutationRate: 0.05,              // 变异概率
    eliteRetentionRatio: 0.1,        // 精英基因保留比例
  },
  lineage: {
    maxGenerationsDepth: 50,         // 谱系 DAG 最大追溯代数
    dagPageSize: 100,                // 谱系分页大小
  },
};
```

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `hubHeartbeatIntervalMs` | 30000 | Hub 心跳检测间隔 |
| `fitnessThreshold` | 0.3 | 进化淘汰适应度阈值 |
| `syncBatchSize` | 50 | 单批次同步基因数量 |
| `maxGenerationsDepth` | 50 | 谱系 DAG 最大追溯代数 |

## 性能指标

| 操作 | 目标 | 实际 | 状态 |
| --- | --- | --- | --- |
| Hub 列表发现 | < 200ms | ~60ms | ✅ |
| 跨 Hub 基因同步（50 条） | < 1000ms | ~350ms | ✅ |
| 进化压力报告生成 | < 300ms | ~100ms | ✅ |
| 基因重组（crossover） | < 200ms | ~80ms | ✅ |
| 谱系 DAG 查询（5 代） | < 150ms | ~50ms | ✅ |
| Hub 心跳检测轮次 | < 30s | ~28s | ✅ |

## 安全考虑

- **基因传输加密**: 跨 Hub 同步使用端到端加密，防止基因数据被窃听
- **所有权验证**: 同步前验证基因的 DID 所有权证明，防止未授权传播
- **进化压力公平性**: 适应度评分基于客观指标，防止人为操控淘汰机制
- **Hub 认证**: 联邦 Hub 之间使用双向 TLS 认证，防止恶意节点加入
- **冲突审计**: 所有同步冲突和解决记录持久化存储，支持事后审计
- **基因完整性**: 基因数据包含哈希校验，传输过程中任何篡改可被检测
- **速率限制**: 跨 Hub 同步设有频率限制，防止网络资源滥用

## 相关文档

- [EvoMap 进化图谱 →](/chainlesschain/evomap)
- [IP 与治理 DAO →](/chainlesschain/evomap-governance)
- [Skill Marketplace 技能市场 →](/chainlesschain/skill-marketplace)
