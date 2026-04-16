# 信誉系统优化

> **Phase 60 | v2.0.0 | 4 IPC 处理器 | 2 张新数据库表**

## 核心特性

- 📈 **贝叶斯参数优化**: 自动搜索最优信誉衰减率、权重参数，提升信誉预测准确度
- 🔍 **统计异常检测**: 基于标准差识别信誉分数偏离正常分布的异常节点
- 📊 **信誉分析面板**: 节点信誉趋势、时间权重分析、异常标记可视化
- 📜 **优化历史追踪**: 记录每次优化运行的参数、迭代次数和改进幅度
- ⚙️ **灵活参数范围**: 支持自定义衰减率、成功/失败权重的搜索范围

## 系统架构

```
┌─────────────────────────────────────┐
│      ReputationOptimizer            │
│   (贝叶斯优化 / 异常检测 / 分析)    │
└──────────┬──────────┬───────────────┘
           │          │
           ▼          ▼
┌──────────────┐  ┌────────────────┐
│ 贝叶斯优化器  │  │ 异常检测器      │
│ 迭代搜索最优  │  │ 标准差统计分析  │
│ 参数组合      │  │ 偏离阈值标记    │
└──────┬───────┘  └───────┬────────┘
       │                  │
       ▼                  ▼
┌──────────────────────────────────────┐
│     SQLite 持久化                     │
│  reputation_optimization_runs        │
│  reputation_analytics                │
└──────────────────────────────────────┘
```

## 概述

Phase 60 为联邦代理网络的信誉系统引入贝叶斯优化和异常检测能力，通过数据驱动的方式自动调优信誉参数，识别信誉异常节点。

**核心目标**:

- **贝叶斯优化**: 自动搜索最优信誉衰减率、权重参数
- **异常检测**: 基于统计方法识别信誉分数偏离正常分布的节点
- **分析面板**: 节点信誉趋势、时间权重、异常标记
- **历史追踪**: 记录每次优化运行及改进幅度

---

## 核心功能

### 1. 运行优化

```javascript
const result = await window.electronAPI.invoke('reputation-optimizer:run-optimization', {
  iterations: 200,
  parameters: {
    decayRate: { min: 0.01, max: 0.1 },
    successWeight: { min: 0.5, max: 2.0 },
    failureWeight: { min: 1.0, max: 5.0 },
    minReputation: 0.0,
    maxReputation: 1.0
  }
});

console.log(result);
// {
//   id: 'ro-001',
//   status: 'COMPLETE',
//   iterations: 200,
//   improvement: 0.15,  // 15% 信誉预测准确度提升
//   result: {
//     bestParameters: { decayRate: 0.035, successWeight: 1.2, failureWeight: 2.8 },
//     convergenceHistory: [...]
//   }
// }
```

### 2. 异常检测

```javascript
const anomalies = await window.electronAPI.invoke('reputation-optimizer:detect-anomalies', {
  nodeScores: [
    { nodeId: 'node-a', score: 0.95 },
    { nodeId: 'node-b', score: 0.12 },  // 可能异常
    { nodeId: 'node-c', score: 0.88 },
    // ...
  ]
});

// anomalies: [{ nodeId: 'node-b', score: 0.12, deviation: 3.2, isAnomaly: true }]
```

### 3. 信誉分析

```javascript
// 获取节点信誉分析数据
const analytics = await window.electronAPI.invoke('reputation-optimizer:get-analytics', {
  filter: { anomalyDetected: true }
});

// 获取优化历史
const history = await window.electronAPI.invoke('reputation-optimizer:get-history', {
  filter: { status: 'COMPLETE' }
});
```

---

## 优化参数

| 参数              | 范围         | 说明                       |
| ----------------- | ------------ | -------------------------- |
| `decayRate`       | 0.01 - 0.1  | 信誉时间衰减率             |
| `successWeight`   | 0.5 - 2.0   | 成功任务的信誉加权         |
| `failureWeight`   | 1.0 - 5.0   | 失败任务的信誉惩罚倍数     |
| `minReputation`   | 0.0          | 信誉下限                   |
| `maxReputation`   | 1.0          | 信誉上限                   |

## 异常检测阈值

- **方法**: 基于标准差的统计异常检测
- **阈值**: 偏离均值 2.5 个标准差视为异常
- **标记**: 自动记录到 `reputation_analytics` 表

---

## IPC 通道

| 通道                                       | 参数                          | 返回值       |
| ------------------------------------------ | ----------------------------- | ------------ |
| `reputation-optimizer:run-optimization`     | `{ iterations?, parameters? }` | 优化结果    |
| `reputation-optimizer:get-analytics`        | `{ filter? }`                 | 分析数据列表 |
| `reputation-optimizer:detect-anomalies`     | `{ nodeScores }`             | 异常节点列表 |
| `reputation-optimizer:get-history`          | `{ filter? }`                 | 优化历史     |

---

## 配置参考

```javascript
// reputation-optimizer 配置（传入 run-optimization 的 parameters 字段）
const reputationOptimizerConfig = {
  // 贝叶斯优化迭代次数（推荐 100-200）
  iterations: 200,

  parameters: {
    // 信誉时间衰减率搜索范围
    decayRate: { min: 0.01, max: 0.1 },

    // 成功任务信誉加权系数范围
    successWeight: { min: 0.5, max: 2.0 },

    // 失败任务信誉惩罚倍数范围
    failureWeight: { min: 1.0, max: 5.0 },

    // 信誉分数边界（固定值）
    minReputation: 0.0,
    maxReputation: 1.0
  },

  // 异常检测阈值（偏离均值的标准差倍数）
  anomalyThreshold: 2.5,

  // 分析记录保留天数
  analyticsRetentionDays: 90
};
```

---

## 性能指标

| 操作                   | 目标        | 实际        | 状态 |
| ---------------------- | ----------- | ----------- | ---- |
| 贝叶斯优化（200 次迭代）| < 10s       | ~6s         | ✅   |
| 异常检测（100 节点）   | < 500ms     | ~120ms      | ✅   |
| 分析数据写入           | < 20ms/条   | ~8ms        | ✅   |
| 优化历史查询           | < 100ms     | ~35ms       | ✅   |
| 信誉预测准确度提升幅度 | > 10%       | ~15%        | ✅   |
| 异常节点检出率         | > 95%       | ~97%        | ✅   |

---

## 测试覆盖

✅ `reputation-optimizer.test.js` — 贝叶斯优化收敛、参数范围验证、改进幅度计算（18 个用例）

✅ `reputation-optimizer-anomaly.test.js` — 标准差异常检测、阈值边界、空节点列表处理（12 个用例）

✅ `reputation-optimizer-ipc.test.js` — 4 个 IPC 通道参数验证与返回值格式（14 个用例）

✅ `reputation-optimizer-db.test.js` — `reputation_optimization_runs` 和 `reputation_analytics` 表 CRUD、并发写入（10 个用例）

✅ `reputation-optimizer-analytics.test.js` — 时间权重计算、异常标记持久化、历史过滤查询（9 个用例）

> **总测试数**: 63 个用例，覆盖率 > 90%

---

## 数据库表

### reputation_optimization_runs

| 字段        | 类型    | 说明                     |
| ----------- | ------- | ------------------------ |
| id          | TEXT PK | 运行 ID                 |
| status      | TEXT    | PENDING/RUNNING/COMPLETE |
| parameters  | JSON    | 搜索参数范围             |
| result      | JSON    | 最优参数和收敛历史       |
| improvement | REAL    | 改进幅度                 |
| iterations  | INTEGER | 迭代次数                 |
| created_at  | INTEGER | 创建时间                 |

### reputation_analytics

| 字段              | 类型    | 说明                 |
| ----------------- | ------- | -------------------- |
| id                | TEXT PK | 记录 ID              |
| node_id           | TEXT    | 节点 ID              |
| reputation_score  | REAL    | 信誉评分             |
| anomaly_detected  | INTEGER | 是否异常（0/1）      |
| temporal_weight   | REAL    | 时间权重             |
| details           | JSON    | 详细信息             |
| created_at        | INTEGER | 创建时间             |

---

## 关键文件

| 文件                                                    | 职责                     |
| ------------------------------------------------------- | ------------------------ |
| `src/main/ai-engine/cowork/reputation-optimizer.js`     | 信誉优化核心引擎         |
| `src/main/ai-engine/cowork/reputation-optimizer-ipc.js` | IPC 处理器（4 个）       |
| `src/renderer/stores/reputationOptimizer.ts`            | Pinia 状态管理           |
| `src/renderer/pages/ai/ReputationOptimizerPage.vue`     | 信誉优化分析页面         |

---

## 使用示例

### 运行贝叶斯优化

1. 打开「信誉优化」页面，进入「参数优化」面板
2. 设置迭代次数（推荐 100-200 次）
3. 调整参数搜索范围（衰减率、成功/失败权重）
4. 点击「运行优化」，等待迭代完成
5. 查看最优参数和收敛历史曲线

### 检测异常节点

1. 切换到「异常检测」标签页
2. 系统自动加载所有节点的信誉评分
3. 偏离均值 2.5 个标准差的节点被标记为异常（红色高亮）
4. 点击异常节点查看详细偏离信息和历史趋势

### 查看信誉分析

1. 进入「信誉分析」面板
2. 查看节点信誉趋势图、时间权重分布
3. 筛选仅显示异常节点的分析数据
4. 查看优化历史，对比不同参数组合的改进幅度

## 故障排查

| 问题 | 可能原因 | 解决方案 |
| --- | --- | --- |
| 优化运行时间过长 | 迭代次数过多或参数范围过大 | 减少迭代次数，缩小参数搜索范围 |
| 优化结果无改进 | 当前参数已接近最优 | 属于正常情况，尝试扩大搜索范围 |
| 异常检测无结果 | 节点评分分布均匀 | 属于正常情况，说明网络健康 |
| 分析数据加载失败 | 数据库查询超时 | 检查 `reputation_analytics` 表数据量，清理过期记录 |
| 优化历史为空 | 尚未运行过优化 | 执行首次优化后历史记录将自动生成 |
| 衰减率搜索结果极端 | 搜索范围设置不合理 | 使用默认范围 0.01-0.1，避免极端值 |

## 安全考虑

- **参数防篡改**: 优化结果和最优参数存储在加密数据库中，防止人为修改
- **异常检测客观性**: 基于统计标准差的检测方法，不依赖主观判断
- **防刷分机制**: 信誉评分基于实际任务质量，单次任务权重有上限
- **时间衰减公平性**: 衰减因子对所有节点一视同仁，长期不活跃自动降分
- **优化历史审计**: 每次优化运行的参数、迭代和结果完整记录
- **异常标记透明**: 异常检测结果对节点所有者可见，支持申诉
- **隔离保护**: 优化过程不直接修改运行中的信誉系统参数，需手动应用

## 相关文档

- [代理联邦网络](/chainlesschain/agent-federation) - 联邦代理注册与发现
- [联邦网络加固](/chainlesschain/federation-hardening) - 联邦网络安全加固
- [压力测试](/chainlesschain/stress-test) - 联邦网络压力测试
- [跨组织 SLA](/chainlesschain/sla-manager) - 跨组织服务等级协议
