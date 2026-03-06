# 生产加固

> **Phase 57 | v2.0.0 | 6 IPC 处理器 | 2 张新数据库表**

## 概述

Phase 57 为 ChainlessChain 引入生产加固能力，包含性能基线采集与回归检测、全方位安全审计，确保系统在大规模部署前达到生产标准。

**核心目标**:

- **性能基线**: IPC 延迟（p50/p95/p99）、内存占用、DB 查询耗时的基线采集与对比
- **安全审计**: 配置/加密/权限/网络/依赖 5 大类别全方位安全扫描
- **回归检测**: 可配置阈值的性能回归自动检测
- **风险评分**: 加权风险评分体系，自动定级安全发现

---

## 架构设计

```
┌─────────────────────────────────────────────────┐
│                 生产加固系统                       │
│                                                 │
│  ┌──────────────────┐  ┌──────────────────┐     │
│  │ PerformanceBaseline│  │ SecurityAuditor  │     │
│  │                  │  │                  │     │
│  │ • 基线采集       │  │ • 配置审计       │     │
│  │ • 回归对比       │  │ • 加密审计       │     │
│  │ • 样本记录       │  │ • 权限审计       │     │
│  │ • 历史查询       │  │ • 网络审计       │     │
│  └────────┬─────────┘  │ • 依赖审计       │     │
│           │            └────────┬─────────┘     │
│           └──────┬──────────────┘               │
│                  ▼                               │
│         ┌──────────────┐                         │
│         │ hardening-ipc│  6 IPC 处理器           │
│         └──────────────┘                         │
└─────────────────────────────────────────────────┘
```

---

## 核心功能

### 1. 性能基线采集

```javascript
// 采集性能基线
const baseline = await window.electronAPI.invoke('hardening:collect-baseline', {
  name: 'v2.0.0-release',
  version: '2.0.0'
});

console.log(baseline);
// {
//   id: 'bl-001',
//   name: 'v2.0.0-release',
//   version: '2.0.0',
//   status: 'COMPLETE',
//   metrics: {
//     ipcLatency: { p50: 12, p95: 45, p99: 120 },
//     memory: { rss: 256, heapUsed: 128, heapTotal: 192 },
//     dbQuery: { avgMs: 3.2, maxMs: 15 }
//   },
//   sampleCount: 100,
//   createdAt: 1709078400000
// }
```

### 2. 性能回归对比

```javascript
// 对比两个基线，检测回归
const comparison = await window.electronAPI.invoke('hardening:compare-baseline', {
  baselineId: 'bl-001',
  currentId: 'bl-002',
  thresholds: {
    ipcLatencyP95: 0.2,  // 20% 偏差告警
    memoryRss: 0.15,      // 15% 内存增长告警
    dbQueryAvg: 0.25      // 25% 查询时间增长告警
  }
});

// comparison.regressions: [{ metric, baseline, current, deviation, severity }]
```

### 3. 安全审计

```javascript
// 运行安全审计
const report = await window.electronAPI.invoke('hardening:run-security-audit', {
  name: 'pre-release-audit',
  categories: ['CONFIG', 'CRYPTO', 'PERMISSION', 'NETWORK', 'DEPENDENCY']
});

console.log(report);
// {
//   id: 'sar-001',
//   name: 'pre-release-audit',
//   status: 'COMPLETE',
//   riskScore: 23.5,
//   findings: [
//     { category: 'CRYPTO', severity: 'HIGH', title: '弱加密算法', ... },
//     { category: 'DEPENDENCY', severity: 'MEDIUM', title: '过期依赖', ... }
//   ],
//   summary: { critical: 0, high: 1, medium: 3, low: 5, info: 2 }
// }
```

---

## 审计类别

| 类别           | 检查项                                     | 风险权重 |
| -------------- | ------------------------------------------ | -------- |
| **CONFIG**     | 敏感配置暴露、默认凭据、调试模式           | 高       |
| **CRYPTO**     | 弱算法、密钥长度、证书过期、随机数质量     | 高       |
| **PERMISSION** | 过度授权、未鉴权端点、敏感操作无审计       | 中       |
| **NETWORK**    | 不安全协议、开放端口、CORS 配置            | 中       |
| **DEPENDENCY** | 已知 CVE、过期依赖、许可证风险             | 低       |

---

## 风险评分

| 严重度       | 权重 | 示例                         |
| ------------ | ---- | ---------------------------- |
| **CRITICAL** | 40   | 硬编码密钥、SQL 注入         |
| **HIGH**     | 20   | 弱加密算法、未加密传输       |
| **MEDIUM**   | 10   | 过度权限、缺少速率限制       |
| **LOW**      | 5    | 过期依赖、缺少安全头         |
| **INFO**     | 1    | 建议性改进、最佳实践提示     |

---

## IPC 通道

| 通道                            | 参数                                  | 返回值           |
| ------------------------------- | ------------------------------------- | ---------------- |
| `hardening:collect-baseline`    | `{ name, version }`                   | 基线对象         |
| `hardening:compare-baseline`    | `{ baselineId, currentId, thresholds }` | 对比结果       |
| `hardening:get-baselines`       | `{ filter? }`                         | 基线列表         |
| `hardening:run-security-audit`  | `{ name, categories }`               | 审计报告         |
| `hardening:get-audit-reports`   | `{ filter? }`                         | 报告列表         |
| `hardening:get-audit-report`    | `{ reportId }`                        | 单份报告详情     |

---

## 数据库表

### performance_baselines

| 字段         | 类型    | 说明                          |
| ------------ | ------- | ----------------------------- |
| id           | TEXT PK | 基线 ID                      |
| name         | TEXT    | 基线名称                      |
| version      | TEXT    | 版本号                        |
| status       | TEXT    | 状态（PENDING/COMPLETE）      |
| metrics      | JSON    | IPC延迟/内存/DB查询指标       |
| environment  | JSON    | 运行环境信息                  |
| sample_count | INTEGER | 采样数量                      |
| created_at   | INTEGER | 创建时间                      |

### security_audit_reports

| 字段       | 类型    | 说明                              |
| ---------- | ------- | --------------------------------- |
| id         | TEXT PK | 报告 ID                          |
| name       | TEXT    | 审计名称                          |
| status     | TEXT    | 状态                              |
| findings   | JSON    | 发现列表（类别/严重度/标题/描述） |
| risk_score | REAL    | 加权风险评分（0-100）             |
| summary    | JSON    | 严重度统计汇总                    |
| created_at | INTEGER | 创建时间                          |

---

## 配置

在 `unified-config-manager.js` 中添加 `hardening` 配置节：

```javascript
hardening: {
  enabled: true,
  baselineAutoCollect: false,
  auditSchedule: 'manual',
  thresholds: {
    ipcLatencyP95: 0.2,
    memoryRss: 0.15,
    dbQueryAvg: 0.25
  }
}
```

---

## 相关链接

- [联邦网络加固](/chainlesschain/federation-hardening)
- [压力测试](/chainlesschain/stress-test)
- [信誉优化](/chainlesschain/reputation-optimizer)
- [审计日志](/chainlesschain/audit)
