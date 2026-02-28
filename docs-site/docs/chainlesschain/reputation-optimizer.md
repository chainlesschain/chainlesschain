# 信誉系统优化

> **Phase 60 | v2.0.0 | 4 IPC 处理器 | 2 张新数据库表**

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

## 相关链接

- [代理联邦网络](/chainlesschain/agent-federation)
- [联邦网络加固](/chainlesschain/federation-hardening)
- [压力测试](/chainlesschain/stress-test)
- [跨组织 SLA](/chainlesschain/sla-manager)
