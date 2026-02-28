# Phase 51 — SIEM 集成系统设计

**版本**: v1.1.0
**创建日期**: 2026-02-28
**状态**: ✅ 已实现 (v1.1.0-alpha)

---

## 一、模块概述

Phase 51 实现 SIEM (Security Information and Event Management) 集成，支持将审计日志导出到主流 SIEM 平台。

### 1.1 核心目标

1. **多目标导出**: 支持配置多个 SIEM 导出目标
2. **多格式支持**: CEF (Common Event Format)、LEEF (Log Event Extended Format)、JSON
3. **批量导出**: 增量批量导出审计日志
4. **导出追踪**: 记录每个目标的导出进度和统计

### 1.2 技术架构

```
┌──────────────────────────────────────────────────────┐
│                   Audit Logs (SQLite)                │
│  audit_logs table → Enterprise Audit Logger          │
└───────────────────────┬──────────────────────────────┘
                        │
┌───────────────────────┼──────────────────────────────┐
│                       ▼                              │
│  ┌─────────────────────────────────────────────┐    │
│  │ SIEM Exporter (siem-exporter.js)            │    │
│  │ - Target Management                         │    │
│  │ - Log Format Conversion                     │    │
│  │ - Batch Export (100 logs/batch)              │    │
│  │ - Progress Tracking                         │    │
│  └───────────────┬─────────────────────────────┘    │
│                  │                                   │
│          ┌───────┼───────┬──────────────┐           │
│          ▼       ▼       ▼              │           │
│       ┌─────┐ ┌─────┐ ┌───────────┐    │           │
│       │ CEF │ │LEEF │ │   JSON    │    │           │
│       └──┬──┘ └──┬──┘ └─────┬─────┘    │           │
│          │       │           │           │           │
│          ▼       ▼           ▼           │           │
│  ┌──────────────────────────────────┐   │           │
│  │ HTTP Export (to SIEM targets)    │   │           │
│  │ - Splunk HEC                     │   │           │
│  │ - Elasticsearch                  │   │           │
│  │ - Azure Sentinel                 │   │           │
│  └──────────────────────────────────┘   │           │
└──────────────────────────────────────────────────────┘
```

---

## 二、核心模块设计

### 2.1 SIEM Exporter

**文件**: `desktop-app-vue/src/main/audit/siem-exporter.js`

**支持格式**:

```javascript
const SIEM_FORMATS = {
  JSON: "json", // 标准JSON格式
  CEF: "cef", // ArcSight Common Event Format
  LEEF: "leef", // IBM QRadar Log Event Extended Format
};
```

**目标类型**:

```javascript
const SIEM_TARGETS = {
  SPLUNK_HEC: "splunk_hec", // Splunk HTTP Event Collector
  ELASTICSEARCH: "elasticsearch", // Elasticsearch / OpenSearch
  AZURE_SENTINEL: "azure_sentinel", // Microsoft Sentinel
};
```

**API**:

```javascript
class SIEMExporter extends EventEmitter {
  async initialize()
  async addTarget({ type, url, format, config })  // 添加导出目标
  async removeTarget(targetId)                      // 移除目标
  async listTargets()                               // 列出所有目标
  async exportLogs({ targetId, limit })             // 导出日志到指定目标
  async exportAll()                                 // 导出到所有活跃目标
  async getExportStats()                            // 获取导出统计
  async close()
}
```

### 2.2 日志格式转换

**CEF 格式** (ArcSight):

```
CEF:0|ChainlessChain|Desktop|1.1.0|{eventId}|{eventName}|{severity}|src={ip} suser={userId} msg={message} rt={timestamp}
```

**LEEF 格式** (IBM QRadar):

```
LEEF:2.0|ChainlessChain|Desktop|1.1.0|{eventId}|devTime={timestamp}\tusrName={userId}\taction={action}\tsrc={ip}\tmsg={message}
```

**JSON 格式**:

```json
{
  "timestamp": 1709100000000,
  "severity": "INFO",
  "source": "chainlesschain-desktop",
  "message": "User login",
  "metadata": {
    "eventId": "evt-123",
    "userId": "user-1",
    "action": "login",
    "resource": "auth",
    "ip": "192.168.1.1"
  }
}
```

**严重性映射** (CEF 0-10):

| 级别     | CEF值 |
| -------- | ----- |
| DEBUG    | 1     |
| INFO     | 3     |
| WARN     | 5     |
| ERROR    | 7     |
| CRITICAL | 9     |
| FATAL    | 10    |

---

## 三、数据库设计

### 3.1 siem_exports (SIEM导出记录)

```sql
CREATE TABLE IF NOT EXISTS siem_exports (
  id TEXT PRIMARY KEY,
  target_type TEXT,
  target_url TEXT,
  format TEXT,
  last_exported_log_id TEXT,
  exported_count INTEGER DEFAULT 0,
  last_export_at INTEGER,
  status TEXT DEFAULT 'active',
  config TEXT,
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_siem_exports_target_type ON siem_exports(target_type);
```

---

## 四、IPC 接口设计

**文件**: `desktop-app-vue/src/main/audit/siem-ipc.js`

4个处理器:

- `siem:list-targets` - 列出配置的SIEM目标
- `siem:add-target` - 添加新SIEM目标
- `siem:export-logs` - 导出审计日志到目标
- `siem:get-stats` - 获取导出统计

---

## 五、前端集成

### 5.1 Pinia Store (`stores/siem.ts`)

```typescript
interface SIEMTarget {
  id: string; target_type: string; target_url: string;
  format: string; exported_count: number;
  last_export_at: number | null; status: string;
}

const useSiemStore = defineStore('siem', {
  state: () => ({
    targets: [], stats: null,
    loading: false, error: null,
  }),
  getters: {
    activeTargets, // 活跃目标
    totalExported, // 总导出量
  },
  actions: {
    fetchTargets(), addTarget(), exportLogs(), fetchStats(),
  }
})
```

### 5.2 UI 页面 (`pages/enterprise/SIEMIntegrationPage.vue`)

- SIEM目标卡片 (类型图标、URL、格式、导出计数)
- 添加目标表单 (类型选择、URL输入、格式选择、认证配置)
- 导出操作按钮 (单目标/全部导出)
- 导出统计仪表板 (已导出日志数、最后导出时间、目标健康状态)

---

## 六、配置选项

```javascript
// unified-config-manager.js → compliance.siem
compliance: {
  siem: {
    enabled: true,
    batchSize: 100,           // 每批导出日志数
    defaultFormat: "json",    // 默认格式
    autoExport: false,        // 自动导出开关
    autoExportInterval: 300,  // 自动导出间隔 (秒)
    retryAttempts: 3,
    retryDelay: 5000          // ms
  }
}
```

---

## 七、与审计系统集成

```
Enterprise Audit Logger
    │
    ├── setSIEMExporter(exporter) ← 注入SIEM导出器
    │
    ├── 审计事件写入 → audit_logs 表
    │                      │
    │                      ▼
    │               SIEM Exporter
    │               ├── 增量读取 audit_logs
    │               ├── 格式转换 (CEF/LEEF/JSON)
    │               └── HTTP POST → SIEM 平台
    │
    └── DLP事件 (Phase 50) 也通过审计日志 → SIEM
```

---

## 八、测试覆盖

- ✅ `siem-exporter.test.js` - 目标管理、格式转换、批量导出
- ✅ `siem-ipc.test.js` - IPC处理器
- ✅ `siem.test.ts` - Pinia Store

---

**文档版本**: 1.0.0
**最后更新**: 2026-02-28
