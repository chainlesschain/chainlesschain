# BI 智能分析

> **版本: v4.5.0 | 状态: ✅ 生产就绪 | 8 IPC Handlers | 2 数据库表 | Phase 95**

ChainlessChain BI 智能分析引擎提供自然语言转 SQL（NL→SQL）、OLAP 多维分析模拟、智能报告生成（PDF/Excel/PPT）、Z-Score 异常检测、线性趋势预测和 5 种仪表盘模板，让非技术用户也能通过自然语言完成复杂的数据分析。

## 概述

BI 智能分析引擎是 ChainlessChain 的数据分析模块，面向非技术用户提供自然语言驱动的数据查询与分析能力。核心功能包括 NL→SQL 自动转换、OLAP 多维分析（上卷/下钻/切片/切块）、AI 驱动的 PDF/Excel/PPT 报告生成、Z-Score 异常检测和线性趋势预测。

## 核心特性

- 💬 **NL→SQL 自动生成**: 自然语言描述自动转换为 SQL 查询，支持多表关联、聚合、子查询
- 📊 **OLAP 多维分析**: 模拟 OLAP Cube，支持上卷（Roll-up）、下钻（Drill-down）、切片（Slice）、切块（Dice）
- 📄 **智能报告生成**: AI 驱动的报告生成，支持 PDF/Excel/PPT 三种格式，自动图表和结论
- 🔔 **Z-Score 异常检测**: 基于统计学的异常值检测，支持时间序列和多维数据
- 📈 **线性趋势预测**: 基于历史数据的线性回归预测，支持置信区间
- 🎨 **5 种仪表盘模板**: 经营概览、销售分析、用户增长、运维监控、财务报表

## 系统架构

```
┌─────────────────────────────────────────────────┐
│                  BI 智能分析引擎                  │
├─────────────────────────────────────────────────┤
│  自然语言查询  →  NL→SQL 引擎  →  SQL 执行器    │
│       ↓               ↓              ↓          │
│  报告生成器    ←  数据聚合层   ←  查询结果      │
│       ↓                                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │
│  │ 异常检测 │  │ 趋势预测 │  │ 仪表盘模板库 │  │
│  │ Z-Score  │  │ 线性回归 │  │ 5种内置模板  │  │
│  └──────────┘  └──────────┘  └──────────────┘  │
├─────────────────────────────────────────────────┤
│  SQLite 数据层: bi_reports | bi_dashboards      │
└─────────────────────────────────────────────────┘
```

## 配置参考

在 `.chainlesschain/config.json` 中配置 BI 引擎行为（完整块）：

```javascript
// .chainlesschain/config.json — biEngine 完整配置
{
  "biEngine": {
    "enabled": true,

    // NL→SQL 引擎
    "nlToSql": {
      "model": "default",              // "default" | "claude-3-opus" | "local-ollama"
      "maxRetries": 3,                 // SQL 生成失败最多重试次数
      "validateSql": true,             // 执行前做语法 + 安全双重验证
      "allowedTables": [               // 白名单：仅允许查询这些表
        "users", "orders", "events", "metrics"
      ],
      "readOnly": true,                // 禁止生成 INSERT/UPDATE/DELETE
      "schemaRefreshIntervalMs": 3600000  // schema 元数据刷新间隔（1 小时）
    },

    // 报告生成
    "reports": {
      "outputDir": "./reports",        // 报告输出目录
      "defaultFormat": "pdf",          // "pdf" | "excel" | "ppt"
      "maxSections": 20,               // 单份报告最多 section 数
      "aiConclusions": true,           // 自动生成 AI 结论
      "language": "zh-CN",             // 报告语言
      "retentionDays": 90              // 报告文件保留天数
    },

    // 异常检测
    "anomalyDetection": {
      "defaultMethod": "zscore",       // "zscore" | "iqr" | "isolation-forest"
      "defaultThreshold": 2.5,         // Z-Score 阈值（越低越敏感）
      "minDataPoints": 30,             // 最少数据点才启动检测
      "alertEnabled": true,            // 异常超阈值时发送系统通知
      "alertCooldownMs": 300000        // 同一指标告警冷却时间（5 分钟）
    },

    // 趋势预测
    "prediction": {
      "defaultMethod": "linear",       // "linear" | "exponential" | "seasonal"
      "defaultHistoryDays": 90,        // 历史训练窗口（天）
      "maxForecastDays": 365,          // 最远预测天数
      "defaultConfidence": 0.95,       // 置信区间（0.90 / 0.95 / 0.99）
      "minRSquared": 0.5               // R² 低于此值时警告模型质量差
    },

    // 仪表盘
    "dashboard": {
      "maxWidgets": 20,                // 单仪表盘最多 widget 数
      "defaultRefreshInterval": 60000, // 默认刷新间隔（ms）
      "autoRefresh": true,             // 全局开关
      "cacheQueryResults": true,       // 缓存 widget 查询结果
      "cacheExpireMs": 300000          // 缓存过期时间（5 分钟）
    },

    // 定时报告
    "scheduledReports": {
      "enabled": true,
      "maxSchedules": 50,              // 最多定时任务数
      "smtpHost": "",                  // 邮件发送（留空则不发邮件）
      "smtpPort": 465,
      "smtpSecure": true
    }
  }
}
```

### 环境变量覆盖

```javascript
// 优先级：环境变量 > config.json > 默认值
process.env.BI_ENABLED = "true";
process.env.BI_NL_MODEL = "claude-3-opus";          // NL→SQL 使用的模型
process.env.BI_REPORTS_DIR = "/data/reports";        // 报告输出目录
process.env.BI_ANOMALY_THRESHOLD = "3.0";            // Z-Score 阈值覆盖
process.env.BI_CACHE_ENABLED = "true";               // 查询结果缓存开关
```

### CLI 快捷配置

```bash
# 同步数据库 schema 元数据（NL→SQL 精度依赖此步）
chainlesschain bi schema-sync --source default

# 检查所有数据源连通性
chainlesschain bi datasource-check --all

# 调整异常检测全局灵敏度
chainlesschain bi anomaly-config --threshold 3.0 --min-samples 100

# 查看当前生效配置
chainlesschain config list | grep biEngine
```

## 性能指标

### NL→SQL 查询性能

| 操作 | 目标 | 实际 | 状态 |
|------|------|------|------|
| 简单统计查询（COUNT / SUM，单表） | < 2s | ~800ms | ✅ 达标 |
| 多表关联查询生成（JOIN 2 表） | < 3s | ~1.5s | ✅ 达标 |
| 复杂聚合查询（GROUP BY + HAVING） | < 4s | ~2.2s | ✅ 达标 |
| SQL 安全验证耗时 | < 50ms | ~15ms | ✅ 达标 |
| NL→SQL 转换置信度（标准场景） | ≥ 0.90 | ~0.95 | ✅ 达标 |

### 报告生成性能

| 操作 | 目标 | 实际 | 状态 |
|------|------|------|------|
| 单 section PDF 报告生成 | < 10s | ~6s | ✅ 达标 |
| 4 section 季度报告（含图表） | < 30s | ~22s | ✅ 达标 |
| Excel 导出（含原始数据，10K 行） | < 15s | ~9s | ✅ 达标 |
| PPT 报告生成（6 页） | < 20s | ~14s | ✅ 达标 |
| AI 结论生成（4 section） | < 8s | ~5s | ✅ 达标 |

### 异常检测与预测性能

| 操作 | 目标 | 实际 | 状态 |
|------|------|------|------|
| Z-Score 检测（720 数据点，1 小时粒度） | < 500ms | ~120ms | ✅ 达标 |
| IQR 检测（同等数据量） | < 300ms | ~80ms | ✅ 达标 |
| 线性趋势预测（90 天历史，30 天预测） | < 1s | ~350ms | ✅ 达标 |
| 异常告警触发延迟 | < 2s | ~800ms | ✅ 达标 |

### 仪表盘性能

| 操作 | 目标 | 实际 | 状态 |
|------|------|------|------|
| 仪表盘首次加载（4 widget） | < 3s | ~1.8s | ✅ 达标 |
| widget 增量刷新（缓存命中） | < 200ms | ~60ms | ✅ 达标 |
| widget 增量刷新（缓存未命中） | < 1.5s | ~900ms | ✅ 达标 |
| 模板列表返回（5 模板） | < 100ms | ~25ms | ✅ 达标 |
| 最大并发仪表盘刷新（5 个） | < 5s | ~3.2s | ✅ 达标 |

## 测试覆盖率

### 单元测试

| 测试文件 | 测试数 | 说明 |
|----------|--------|------|
| ✅ `desktop-app-vue/tests/unit/enterprise/bi-engine.test.js` | 42 | BI 引擎核心逻辑、IPC handler 注册、数据库 CRUD |
| ✅ `desktop-app-vue/tests/unit/enterprise/nl-to-sql.test.js` | 35 | NL→SQL 转换、SQL 校验、allowedTables 白名单 |
| ✅ `desktop-app-vue/tests/unit/enterprise/report-generator.test.js` | 28 | PDF/Excel/PPT 生成流程、AI 结论注入、格式切换 |
| ✅ `desktop-app-vue/tests/unit/enterprise/anomaly-detector.test.js` | 24 | Z-Score / IQR 计算、阈值边界、误报率测试 |
| ✅ `desktop-app-vue/tests/unit/enterprise/trend-predictor.test.js` | 20 | 线性回归斜率/截距、R² 计算、置信区间覆盖率 |
| ✅ `desktop-app-vue/tests/unit/enterprise/bi-dashboard.test.js` | 18 | 仪表盘模板 CRUD、widget 配置验证、自动刷新逻辑 |
| ✅ `desktop-app-vue/src/renderer/stores/__tests__/biEngine.test.ts` | 22 | Pinia store 状态管理、IPC 调用 mock、错误处理 |

### 集成测试

| 测试文件 | 测试数 | 说明 |
|----------|--------|------|
| ✅ `desktop-app-vue/tests/integration/bi-ipc-handlers.test.js` | 30 | 8 个 IPC handler 端到端（真实 SQLite）|
| ✅ `desktop-app-vue/tests/integration/bi-scheduled-reports.test.js` | 12 | 定时报告 cron 触发、持久化、邮件发送 mock |

### 覆盖率汇总

| 维度 | 数值 |
|------|------|
| 总测试数 | **231** |
| 单元测试通过率 | 189 / 189 ✅ |
| 集成测试通过率 | 42 / 42 ✅ |
| 行覆盖率（bi-engine.js） | ~92% |
| 行覆盖率（nl-to-sql.js） | ~88% |
| 行覆盖率（anomaly-detector.js） | ~95% |
| 行覆盖率（trend-predictor.js） | ~90% |

## 自然语言查询

```javascript
const result = await window.electron.ipcRenderer.invoke("bi:nl-query", {
  question: "过去 30 天每天新增用户数量是多少？按周汇总",
  database: "analytics", // analytics | business | custom
  returnSql: true,
  visualize: true,
  explain: true,
});
// {
//   success: true,
//   sql: "SELECT strftime('%W', created_at/1000, 'unixepoch') AS week, COUNT(*) AS new_users FROM users WHERE created_at >= strftime('%s', 'now', '-30 days') * 1000 GROUP BY week ORDER BY week",
//   data: [
//     { week: "09", new_users: 145 },
//     { week: "10", new_users: 182 },
//     { week: "11", new_users: 203 },
//     { week: "12", new_users: 178 }
//   ],
//   chart: { type: "bar", xAxis: "week", yAxis: "new_users" },
//   explanation: "查询了 users 表中过去 30 天的数据，按 ISO 周编号聚合统计新增用户数",
//   confidence: 0.95
// }
```

## 生成报告

```javascript
const result = await window.electron.ipcRenderer.invoke("bi:generate-report", {
  title: "2026年 Q1 经营分析报告",
  type: "quarterly", // daily | weekly | monthly | quarterly | custom
  sections: [
    { name: "用户增长", query: "过去 90 天用户增长趋势", chartType: "line" },
    { name: "收入分析", query: "各产品线季度收入对比", chartType: "bar" },
    { name: "留存率", query: "过去 12 周的周留存率", chartType: "area" },
    { name: "异常事件", query: "本季度异常指标汇总", chartType: "table" },
  ],
  format: "pdf", // pdf | excel | ppt
  includeConclusions: true,
  language: "zh-CN",
});
// {
//   success: true,
//   reportId: "rpt-20260310-001",
//   filePath: "/reports/2026-Q1-经营分析报告.pdf",
//   pages: 12,
//   sections: 4,
//   charts: 4,
//   generatedAt: 1710100000000,
//   aiConclusions: ["Q1 用户增长 23%，环比提升 5%", "产品线 A 收入占比最高（45%）", ...]
// }
```

## 创建仪表盘

```javascript
const result = await window.electron.ipcRenderer.invoke("bi:create-dashboard", {
  name: "运营实时看板",
  template: "operations", // overview | sales | growth | operations | finance
  widgets: [
    {
      type: "kpi",
      title: "日活用户",
      query: "今日活跃用户数",
      refreshInterval: 60000,
    },
    {
      type: "line-chart",
      title: "请求量趋势",
      query: "过去 24 小时每小时请求量",
      refreshInterval: 300000,
    },
    {
      type: "heatmap",
      title: "错误分布",
      query: "过去 7 天各模块错误次数热力图",
    },
    {
      type: "table",
      title: "Top 10 慢查询",
      query: "响应时间最长的 10 个 API",
      sortBy: "response_time",
      order: "desc",
    },
  ],
  autoRefresh: true,
  refreshInterval: 60000,
});
// {
//   success: true,
//   dashboardId: "dash-001",
//   name: "运营实时看板",
//   template: "operations",
//   widgets: 4,
//   url: "/bi/dashboard/dash-001"
// }
```

## 异常检测

```javascript
const result = await window.electron.ipcRenderer.invoke("bi:detect-anomaly", {
  metric: "api_response_time",
  timeRange: { start: 1709000000000, end: 1710000000000 },
  method: "zscore", // zscore | iqr | isolation-forest
  threshold: 2.5, // Z-Score 阈值
  granularity: "hour", // minute | hour | day
});
// {
//   success: true,
//   anomalies: [
//     {
//       timestamp: 1709500000000,
//       value: 2850,
//       mean: 450,
//       stddev: 120,
//       zscore: 20.0,
//       severity: "critical",
//       possibleCause: "数据库连接池耗尽"
//     },
//     {
//       timestamp: 1709800000000,
//       value: 1200,
//       mean: 450,
//       stddev: 120,
//       zscore: 6.25,
//       severity: "warning",
//       possibleCause: "缓存失效导致回源请求增加"
//     }
//   ],
//   totalPoints: 720,
//   anomalyCount: 2,
//   anomalyRate: 0.0028
// }
```

## 趋势预测

```javascript
const result = await window.electron.ipcRenderer.invoke("bi:predict-trend", {
  metric: "daily_active_users",
  historyDays: 90,
  forecastDays: 30,
  method: "linear", // linear | exponential | seasonal
  confidenceLevel: 0.95,
});
// {
//   success: true,
//   model: {
//     method: "linear",
//     slope: 12.5,
//     intercept: 1200,
//     rSquared: 0.87,
//     equation: "y = 12.5x + 1200"
//   },
//   forecast: [
//     { date: "2026-03-11", predicted: 2325, lower: 2180, upper: 2470 },
//     { date: "2026-03-12", predicted: 2338, lower: 2190, upper: 2486 },
//     ...
//   ],
//   trend: "increasing",
//   growthRate: 0.054
// }
```

## 获取仪表盘模板

```javascript
const result = await window.electron.ipcRenderer.invoke("bi:list-templates");
// {
//   success: true,
//   templates: [
//     { id: "overview", name: "经营概览", description: "KPI、趋势、同环比分析", widgets: 6, preview: "..." },
//     { id: "sales", name: "销售分析", description: "漏斗、转化率、区域分布", widgets: 5, preview: "..." },
//     { id: "growth", name: "用户增长", description: "新增、留存、活跃用户分析", widgets: 5, preview: "..." },
//     { id: "operations", name: "运维监控", description: "性能、错误率、可用性监控", widgets: 6, preview: "..." },
//     { id: "finance", name: "财务报表", description: "收入、支出、利润趋势", widgets: 5, preview: "..." }
//   ]
// }
```

## 导出报告

```javascript
const result = await window.electron.ipcRenderer.invoke("bi:export-report", {
  reportId: "rpt-20260310-001",
  format: "excel", // pdf | excel | ppt
  includeRawData: true,
});
// { success: true, exportPath: "/exports/2026-Q1-经营分析报告.xlsx", size: 3145728 }
```

## 定时报告

```javascript
const result = await window.electron.ipcRenderer.invoke("bi:schedule-report", {
  reportConfig: {
    title: "每周运营周报",
    type: "weekly",
    sections: [
      { name: "关键指标", query: "本周 DAU/WAU/MAU 变化" },
      { name: "异常汇总", query: "本周异常事件统计" },
    ],
    format: "pdf",
  },
  schedule: {
    cron: "0 9 * * 1", // 每周一 09:00
    timezone: "Asia/Shanghai",
    recipients: ["admin@example.com"],
  },
  enabled: true,
});
// { success: true, scheduleId: "sched-001", nextRun: 1710118800000, cron: "0 9 * * 1" }
```

## IPC 接口完整列表

### BI 分析操作（8 个）

| 通道                  | 功能         | 说明                             |
| --------------------- | ------------ | -------------------------------- |
| `bi:nl-query`         | 自然语言查询 | NL→SQL 自动生成并执行            |
| `bi:generate-report`  | 生成报告     | AI 驱动，支持 PDF/Excel/PPT      |
| `bi:create-dashboard` | 创建仪表盘   | 5 种模板 + 自定义 widget         |
| `bi:detect-anomaly`   | 异常检测     | Z-Score / IQR / Isolation Forest |
| `bi:predict-trend`    | 趋势预测     | 线性/指数/季节性回归预测         |
| `bi:list-templates`   | 获取模板列表 | 5 种内置仪表盘模板               |
| `bi:export-report`    | 导出报告     | 导出为 PDF/Excel/PPT             |
| `bi:schedule-report`  | 定时报告     | Cron 定时生成和发送报告          |

## 数据库 Schema

**2 张核心表**:

| 表名            | 用途       | 关键字段                                      |
| --------------- | ---------- | --------------------------------------------- |
| `bi_reports`    | 报告存储   | id, title, type, format, sections, file_path  |
| `bi_dashboards` | 仪表盘配置 | id, name, template, widgets, refresh_interval |

### bi_reports 表

```sql
CREATE TABLE IF NOT EXISTS bi_reports (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  type TEXT NOT NULL,                  -- daily | weekly | monthly | quarterly | custom
  format TEXT DEFAULT 'pdf',           -- pdf | excel | ppt
  sections TEXT NOT NULL,              -- JSON: 报告章节配置
  file_path TEXT,
  ai_conclusions TEXT,                 -- JSON: AI 生成的结论
  schedule_id TEXT,                    -- 关联定时任务
  pages INTEGER DEFAULT 0,
  status TEXT DEFAULT 'generated',     -- generating | generated | failed | scheduled
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_bi_report_type ON bi_reports(type);
CREATE INDEX IF NOT EXISTS idx_bi_report_status ON bi_reports(status);
CREATE INDEX IF NOT EXISTS idx_bi_report_created ON bi_reports(created_at);
```

### bi_dashboards 表

```sql
CREATE TABLE IF NOT EXISTS bi_dashboards (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  template TEXT,                       -- overview | sales | growth | operations | finance
  widgets TEXT NOT NULL,               -- JSON: widget 列表和配置
  auto_refresh INTEGER DEFAULT 1,
  refresh_interval INTEGER DEFAULT 60000,
  layout TEXT,                         -- JSON: 仪表盘布局配置
  status TEXT DEFAULT 'active',        -- active | archived | draft
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
  updated_at INTEGER DEFAULT (strftime('%s','now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_bi_dash_template ON bi_dashboards(template);
CREATE INDEX IF NOT EXISTS idx_bi_dash_status ON bi_dashboards(status);
```

## 配置

在 `.chainlesschain/config.json` 中配置：

```json
{
  "biEngine": {
    "enabled": true,
    "nlToSql": {
      "model": "default",
      "maxRetries": 3,
      "validateSql": true,
      "allowedTables": ["users", "orders", "events", "metrics"],
      "readOnly": true
    },
    "reports": {
      "outputDir": "./reports",
      "defaultFormat": "pdf",
      "maxSections": 20,
      "aiConclusions": true,
      "language": "zh-CN"
    },
    "anomalyDetection": {
      "defaultMethod": "zscore",
      "defaultThreshold": 2.5,
      "minDataPoints": 30
    },
    "prediction": {
      "defaultMethod": "linear",
      "defaultHistoryDays": 90,
      "maxForecastDays": 365,
      "defaultConfidence": 0.95
    },
    "dashboard": {
      "maxWidgets": 20,
      "defaultRefreshInterval": 60000,
      "autoRefresh": true
    }
  }
}
```

## 使用示例

### 自然语言查询示例

```javascript
// 简单统计查询
const result = await window.electron.ipcRenderer.invoke("bi:nl-query", {
  question: "本月活跃用户有多少？",
  database: "analytics",
  returnSql: true,
});

// 多表关联查询
const result2 = await window.electron.ipcRenderer.invoke("bi:nl-query", {
  question: "过去 7 天每个产品线的订单金额排行",
  visualize: true,
  explain: true,
});
```

### 快速创建仪表盘

```javascript
// 使用内置模板一键创建
const dashboard = await window.electron.ipcRenderer.invoke("bi:create-dashboard", {
  name: "销售实时看板",
  template: "sales",
  autoRefresh: true,
  refreshInterval: 30000,
});
// 在 /bi/dashboard/{dashboardId} 路径访问
```

### 异常检测与告警

```javascript
// 检测 API 响应时间异常
const anomalies = await window.electron.ipcRenderer.invoke("bi:detect-anomaly", {
  metric: "api_response_time",
  timeRange: { start: Date.now() - 86400000, end: Date.now() },
  method: "zscore",
  threshold: 3.0,
  granularity: "hour",
});
// anomalies.anomalies 包含所有异常点及可能原因
```

## 故障排除

| 问题                    | 解决方案                                            |
| ----------------------- | --------------------------------------------------- |
| NL→SQL 生成的查询不准确 | 提供更具体的自然语言描述，或检查 allowedTables 配置 |
| 报告生成超时            | 减少 sections 数量或缩小时间范围                    |
| 异常检测误报过多        | 调高 Z-Score threshold 或增大 minDataPoints         |
| 趋势预测 R² 值偏低      | 数据波动大时尝试 seasonal 方法，或增加历史数据量    |
| 仪表盘加载缓慢          | 减少 widget 数量或增大 refreshInterval              |

### SQL 生成错误详细排查

**现象**: NL→SQL 引擎生成的 SQL 语法错误或查询结果与预期不符。

**排查步骤**:
1. 设置 `returnSql: true` 和 `explain: true` 查看生成的 SQL 和解释
2. 检查 `allowedTables` 配置是否包含目标表，遗漏的表不会被 NL→SQL 引擎使用
3. 尝试使用更具体的自然语言描述，明确指定表名、字段名和时间范围
4. 确认 `validateSql: true` 已开启，系统会在执行前校验 SQL 语法合法性

### 报表生成结果为空

**现象**: 调用 `bi:generate-report` 成功但报告中无数据内容。

**排查步骤**:
1. 分别对每个 section 的 `query` 执行 `bi:nl-query` 确认是否有数据返回
2. 检查时间范围设置，确认 `type`（daily/weekly/monthly）对应的时间窗口内有数据
3. 确认数据库中目标表是否已导入数据且非空
4. 查看报告的 `status` 字段，若为 `failed` 则检查日志中的生成错误信息

## 故障排查

### 常见问题

| 症状 | 可能原因 | 解决方案 |
| --- | --- | --- |
| NL→SQL 语义错误生成错误查询 | 自然语言歧义或表结构未注册 | 补充表/列注释元数据，使用 `bi schema-sync` 同步 |
| 报表渲染失败显示空白 | 数据源连接超时或图表类型不支持 | 检查数据源连通性，切换为兼容的图表类型 |
| 异常检测误报频繁 | 检测阈值过低或历史基线数据不足 | 调高 `anomalyThreshold`，积累更多历史数据 |
| 仪表盘加载缓慢 | 查询未命中缓存或数据量过大 | 启用查询缓存 `bi cache-enable`，添加数据聚合层 |
| 定时报告未发送 | 调度任务异常或邮件服务配置错误 | 检查调度日志 `bi schedule-log`，验证 SMTP 配置 |

### 常见错误修复

**错误: `NL_SQL_PARSE_FAILED` 自然语言转换失败**

```bash
# 同步数据库 schema 元数据
chainlesschain bi schema-sync --source default

# 测试 NL→SQL 转换
chainlesschain bi nl-test "最近7天的活跃用户数"
```

**错误: `REPORT_RENDER_FAILED` 报表渲染异常**

```bash
# 检查数据源连接状态
chainlesschain bi datasource-check --all

# 重新生成报表（使用缓存数据）
chainlesschain bi report-regenerate --report-id <id> --use-cache
```

**错误: `ANOMALY_FALSE_POSITIVE` 异常检测误报**

```bash
# 调整异常检测灵敏度
chainlesschain bi anomaly-config --threshold 3.0 --min-samples 100

# 标记误报并反馈训练
chainlesschain bi anomaly-feedback --id <anomaly-id> --label false-positive
```

## 安全考虑

- **只读查询**: NL→SQL 引擎默认 `readOnly: true`，禁止生成 INSERT/UPDATE/DELETE 语句
- **表白名单**: `allowedTables` 限制可查询的表范围，防止访问敏感系统表
- **SQL 验证**: 生成的 SQL 经过语法和安全性双重验证后才执行
- **报告权限**: 报告生成和导出受 RBAC 权限控制，仅授权角色可访问
- **数据脱敏**: 报告中的敏感字段（如手机号、身份证）支持自动脱敏处理
- **定时任务审计**: 所有定时报告的创建、执行、发送操作记录完整审计日志

## 相关文档

- [企业知识图谱](/chainlesschain/enterprise-knowledge-graph)
- [低代码/无代码平台](/chainlesschain/low-code-platform)
- [Analytics 分析](/chainlesschain/analytics)

## 关键文件

| 文件 | 说明 |
| --- | --- |
| `desktop-app-vue/src/main/enterprise/bi-engine.js` | BI 引擎核心实现 |
| `desktop-app-vue/src/main/enterprise/nl-to-sql.js` | NL→SQL 转换模块 |
| `desktop-app-vue/src/main/enterprise/report-generator.js` | 报告生成器（PDF/Excel/PPT） |
| `desktop-app-vue/src/main/enterprise/anomaly-detector.js` | Z-Score 异常检测 |
| `desktop-app-vue/src/main/enterprise/trend-predictor.js` | 线性趋势预测 |
| `desktop-app-vue/src/renderer/stores/biEngine.ts` | BI 引擎 Pinia Store |
