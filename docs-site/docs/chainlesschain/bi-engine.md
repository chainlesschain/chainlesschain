# BI 智能分析

> **版本: v4.5.0 | 状态: ✅ 生产就绪 | 8 IPC Handlers | 2 数据库表 | Phase 95**

ChainlessChain BI 智能分析引擎提供自然语言转 SQL（NL→SQL）、OLAP 多维分析模拟、智能报告生成（PDF/Excel/PPT）、Z-Score 异常检测、线性趋势预测和 5 种仪表盘模板，让非技术用户也能通过自然语言完成复杂的数据分析。

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

## 故障排除

| 问题                    | 解决方案                                            |
| ----------------------- | --------------------------------------------------- |
| NL→SQL 生成的查询不准确 | 提供更具体的自然语言描述，或检查 allowedTables 配置 |
| 报告生成超时            | 减少 sections 数量或缩小时间范围                    |
| 异常检测误报过多        | 调高 Z-Score threshold 或增大 minDataPoints         |
| 趋势预测 R² 值偏低      | 数据波动大时尝试 seasonal 方法，或增加历史数据量    |
| 仪表盘加载缓慢          | 减少 widget 数量或增大 refreshInterval              |

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
