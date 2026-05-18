# 生产加固

> **Phase 57 | v2.0.0 | 6 IPC 处理器 | 2 张新数据库表**

## 核心特性

- 📊 **性能基线采集**: IPC 延迟 (p50/p95/p99)、内存占用、DB 查询耗时基线记录
- 🔍 **回归检测**: 可配置阈值的性能回归自动检测与告警
- 🛡️ **安全审计**: 配置/加密/权限/网络/依赖 5 大类别全方位安全扫描
- ⚠️ **风险评分**: 加权风险评分体系 (0-100)，自动定级 CRITICAL/HIGH/MEDIUM/LOW/INFO
- 📈 **历史对比**: 多版本基线对比，追踪性能趋势

## 系统架构

```
┌──────────────────────────────────────────────┐
│             生产加固系统                       │
│                                              │
│  ┌──────────────────┐ ┌──────────────────┐   │
│  │PerformanceBaseline│ │ SecurityAuditor  │   │
│  │ • 基线采集        │ │ • CONFIG 审计    │   │
│  │ • 回归对比        │ │ • CRYPTO 审计    │   │
│  │ • 样本记录        │ │ • PERMISSION     │   │
│  └────────┬─────────┘ │ • NETWORK        │   │
│           │           │ • DEPENDENCY     │   │
│           │           └────────┬─────────┘   │
│           └──────┬─────────────┘             │
│                  ▼                            │
│  ┌──────────────────────────────────────┐    │
│  │  hardening IPC (6 处理器)             │    │
│  └──────────────────┬───────────────────┘    │
│                     ▼                        │
│  ┌──────────────────────────────────────┐    │
│  │  performance_baselines /             │    │
│  │  security_audit_reports (SQLite)    │    │
│  └──────────────────────────────────────┘    │
└──────────────────────────────────────────────┘
```

## 关键文件

| 文件 | 职责 |
|------|------|
| `desktop-app-vue/src/main/performance/performance-baseline.js` | 性能基线采集与回归对比 |
| `desktop-app-vue/src/main/security/security-auditor.js` | 5 类安全审计扫描 |
| `desktop-app-vue/src/main/security/hardening-ipc.js` | IPC 处理器 (6 个) |
| `desktop-app-vue/src/renderer/stores/hardening.ts` | Pinia 状态管理 |
| `desktop-app-vue/src/renderer/pages/security/HardeningPage.vue` | 生产加固管理页面 |

## 相关文档

- [联邦网络加固](/chainlesschain/federation-hardening)
- [压力测试](/chainlesschain/stress-test)
- [审计日志](/chainlesschain/audit)
- [数据加密](/chainlesschain/encryption)

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

## 使用示例

### 采集性能基线

1. 打开「生产加固」页面，进入「性能基线」标签
2. 输入基线名称（如 v2.0.0-release）和版本号
3. 点击「采集基线」，系统自动采集 IPC 延迟、内存占用和 DB 查询指标
4. 采集完成后查看 p50/p95/p99 延迟和内存使用详情

### 对比性能回归

1. 在基线列表中选择两个基线进行对比
2. 设置回归阈值（如 IPC 延迟偏差 20%、内存增长 15%）
3. 系统自动检测并高亮显示超出阈值的回归项
4. 根据回归报告定位性能退化原因

### 运行安全审计

1. 切换到「安全审计」标签
2. 选择审计类别（CONFIG/CRYPTO/PERMISSION/NETWORK/DEPENDENCY）
3. 点击「运行审计」，等待扫描完成
4. 查看风险评分和发现列表，按严重度优先处理 CRITICAL/HIGH 项

## 故障排查

| 问题 | 可能原因 | 解决方案 |
| --- | --- | --- |
| 基线采集超时 | 系统负载高导致采样缓慢 | 在低负载时段重新采集，减少并发任务 |
| 回归对比无结果 | 两个基线版本相同 | 选择不同版本的基线进行对比 |
| 审计发现全为 INFO | 系统安全配置良好 | 属于正常结果，定期审计保持安全状态 |
| 风险评分异常偏高 | 存在 CRITICAL 级别发现 | 立即处理硬编码密钥、SQL 注入等关键风险 |
| 基线列表加载缓慢 | 历史基线数据量过大 | 清理过期基线记录，保留关键版本 |
| 审计类别不完整 | 某些检查依赖的服务未运行 | 确保所有被检查的服务处于运行状态 |

## 配置参考

在 `unified-config-manager.js` 中的 `hardening` 配置节完整字段说明：

| 配置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | 是否启用生产加固模块 |
| `baselineAutoCollect` | boolean | `false` | 是否在应用启动时自动采集基线 |
| `auditSchedule` | string | `"manual"` | 安全审计调度方式（`manual` / `daily` / `weekly`） |
| `thresholds.ipcLatencyP95` | number | `0.2` | IPC p95 延迟回归告警阈值（20% 偏差） |
| `thresholds.memoryRss` | number | `0.15` | RSS 内存增长告警阈值（15%） |
| `thresholds.dbQueryAvg` | number | `0.25` | 平均 DB 查询耗时增长告警阈值（25%） |

```javascript
// .chainlesschain/config.json 示例
{
  "hardening": {
    "enabled": true,
    "baselineAutoCollect": false,
    "auditSchedule": "manual",
    "thresholds": {
      "ipcLatencyP95": 0.2,
      "memoryRss": 0.15,
      "dbQueryAvg": 0.25
    }
  }
}
```

---

## 性能指标

### 基线采集耗时

| 操作 | 典型耗时 | 说明 |
| --- | --- | --- |
| IPC 延迟采样（100 次） | 1–3 s | 并发 IPC 调用采集 p50/p95/p99 |
| 内存快照 | < 50 ms | 单次 `process.memoryUsage()` |
| DB 查询基线（100 次） | 1–5 s | 取决于数据库大小和磁盘速度 |
| 完整基线采集 | 3–10 s | 三类指标顺序采集 |

### 安全审计耗时

| 审计类别 | 典型耗时 | 检查项数量 |
| --- | --- | --- |
| CONFIG | < 200 ms | 配置文件扫描、默认凭据检测 |
| CRYPTO | < 100 ms | 算法白名单匹配、证书校验 |
| PERMISSION | < 150 ms | IPC 鉴权规则、RBAC 角色扫描 |
| NETWORK | < 300 ms | 端口探测、CORS 规则检查 |
| DEPENDENCY | 1–3 s | npm audit 联网查询 CVE 数据库 |
| **全类别完整审计** | **2–4 s** | 5 类并行执行 |

### 数据保留

- 性能基线：无上限，建议保留 10 个关键版本基线，定期清理中间版本
- 审计报告：建议保留最近 50 份，历史报告可导出 JSON 存档后删除

---

## 测试覆盖率

| 测试文件 | 覆盖功能 | 用例数 |
| --- | --- | --- |
| `tests/unit/performance/performance-baseline.test.js` | 基线采集、回归对比、样本记录、历史查询 | 24 |
| `tests/unit/security/security-auditor.test.js` | 5 类审计逻辑、风险评分、发现分级 | 31 |
| `tests/unit/security/hardening-ipc.test.js` | 6 个 IPC 处理器参数校验与响应格式 | 18 |
| `tests/unit/stores/hardening.test.ts` | Pinia store 状态流转、过滤与排序 | 14 |

**运行测试**:

```bash
cd desktop-app-vue

# 单独运行生产加固相关测试
npx vitest run tests/unit/performance/ tests/unit/security/

# 运行全量单元测试
npx vitest run tests/unit/
```

---

## 安全考虑

- **安全发现分级**: CRITICAL(40)/HIGH(20)/MEDIUM(10)/LOW(5)/INFO(1) 加权评分体系
- **敏感配置检测**: 自动扫描暴露的密钥、默认凭据和调试模式
- **加密算法审计**: 检测弱加密算法、过短密钥和过期证书
- **依赖安全扫描**: 识别已知 CVE 漏洞和过期依赖
- **审计报告加密**: 审计发现存储在加密数据库中，防止安全信息泄露
- **基线不可篡改**: 采集的基线数据一旦写入不可修改，保证对比的可信度
- **定期审计建议**: 推荐每次版本发布前运行完整安全审计

## 相关链接

- [联邦网络加固](/chainlesschain/federation-hardening)
- [压力测试](/chainlesschain/stress-test)
- [信誉优化](/chainlesschain/reputation-optimizer)
- [审计日志](/chainlesschain/audit)
