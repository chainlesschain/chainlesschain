# Phase 61 — 跨组织SLA管理系统设计

**版本**: v2.0.0
**创建日期**: 2026-02-28
**状态**: ✅ 已实现 (v2.0.0 Desktop) · ✅ CLI 登陆 2026-04-16 (`cc sla tiers|create|list|show|terminate|record|metrics|check|violations|compensate|report`, `packages/cli/src/lib/sla-manager.js`, 51 tests)

---

## 一、模块概述

Phase 61 引入跨组织SLA管理系统,支持服务等级协议(SLA)的定义、监控、违约检测和补偿计算。

### 1.1 核心功能

- **SLA合约管理**: 合约CRUD、条款定义
- **多级SLA**: 金牌/银牌/铜牌三级
- **实时监控**: 可用性、响应时间、吞吐量
- **违约检测**: 自动检测SLA违约
- **补偿计算**: 违约补偿金自动计算

---

## 二、SLA级别定义

```javascript
const SLA_TIERS = {
  GOLD: {
    name: "gold",
    availability: 0.999, // 99.9%
    maxResponseTime: 100, // 100ms
    minThroughput: 1000, // 1000 req/s
    compensationRate: 0.05, // 5%补偿率
  },
  SILVER: {
    name: "silver",
    availability: 0.995, // 99.5%
    maxResponseTime: 200, // 200ms
    minThroughput: 500,
    compensationRate: 0.03,
  },
  BRONZE: {
    name: "bronze",
    availability: 0.99, // 99%
    maxResponseTime: 500, // 500ms
    minThroughput: 200,
    compensationRate: 0.01,
  },
};
```

---

## 三、核心模块设计

### 3.1 SLA Manager

**文件**: `desktop-app-vue/src/main/ai-engine/cowork/sla-manager.js`

**SLA条款**:

```javascript
const SLA_TERMS = {
  AVAILABILITY: "availability", // 可用性
  RESPONSE_TIME: "response_time", // 响应时间
  THROUGHPUT: "throughput", // 吞吐量
  ERROR_RATE: "error_rate", // 错误率
  DATA_ACCURACY: "data_accuracy", // 数据准确性
};
```

**违约等级**:

```javascript
const VIOLATION_SEVERITY = {
  MINOR: "minor", // 轻微违约 (< 10% deviation)
  MODERATE: "moderate", // 中度违约 (10-25% deviation)
  MAJOR: "major", // 重大违约 (25-50% deviation)
  CRITICAL: "critical", // 严重违约 (> 50% deviation)
};
```

**API方法**:

```javascript
class SLAManager {
  // 创建SLA合约
  async createSLA(orgId, tier, terms, duration) {}

  // 列出SLA合约
  async listSLAs(orgId) {}

  // 获取SLA指标
  async getSLAMetrics(slaId) {}

  // 检查SLA违约
  async checkViolations(slaId) {}

  // 计算补偿
  async calculateCompensation(violationId) {}

  // 生成SLA报告
  async generateReport(slaId, startDate, endDate) {}
}
```

---

## 四、数据库设计

```sql
CREATE TABLE IF NOT EXISTS sla_contracts (
  sla_id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  tier TEXT NOT NULL,
  terms TEXT NOT NULL,
  start_date INTEGER NOT NULL,
  end_date INTEGER NOT NULL,
  status TEXT DEFAULT 'active',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sla_violations (
  violation_id TEXT PRIMARY KEY,
  sla_id TEXT NOT NULL,
  term TEXT NOT NULL,
  severity TEXT NOT NULL,
  expected_value REAL NOT NULL,
  actual_value REAL NOT NULL,
  deviation_percent REAL,
  compensation_amount REAL,
  occurred_at INTEGER NOT NULL,
  resolved_at INTEGER,
  FOREIGN KEY (sla_id) REFERENCES sla_contracts(sla_id)
);
```

---

## 五、补偿计算公式

```javascript
// 基础补偿
baseCompensation = monthlyFee * compensationRate;

// 违约程度调整
deviationMultiplier = Math.min(deviation / 50, 2.0);

// 最终补偿
finalCompensation = baseCompensation * deviationMultiplier * violationDuration;
```

---

## 六、IPC 接口 (5个)

```javascript
const CHANNELS = [
  "sla:create-sla",
  "sla:list-slas",
  "sla:get-sla-metrics",
  "sla:get-violations",
  "sla:generate-report",
];
```

---

## 七、监控指标

实时监控的关键指标:

- **可用性** (Availability): `uptime / total_time`
- **平均响应时间** (Avg Response Time): `sum(response_times) / count`
- **P95响应时间** (P95 Latency): 95百分位延迟
- **吞吐量** (Throughput): `successful_requests / time_window`
- **错误率** (Error Rate): `failed_requests / total_requests`

---

## 八、配置管理

```javascript
sla: {
  enabled: true,
  defaultTier: 'silver',
  monitoring: {
    interval: 60000, // 1分钟监控一次
    retentionDays: 90,
  },
  violation: {
    checkInterval: 300000, // 5分钟检查一次
    alertThreshold: 'moderate',
    autoCompensate: false,
  },
  report: {
    autoGenerate: true,
    schedule: '0 0 1 * *', // 每月1号生成
  },
}
```

---

**相关文档**:

- [Phase 60 — 信誉优化器](./32_信誉优化系统.md)
- [Phase 62 — 技术学习引擎](./34_技术学习引擎系统.md)
