# SIEM 安全信息与事件管理

> **Phase 51 | v1.1.0-alpha | 4 IPC 处理器 | 1 张新数据库表**

## 核心特性

- 📤 **三种标准格式**: 支持 CEF、LEEF、JSON 格式导出，兼容所有主流 SIEM 平台
- 🔌 **多平台集成**: Splunk HEC、IBM QRadar、ArcSight、Elasticsearch、Azure Sentinel
- ⏱️ **实时事件推送**: WebSocket/Syslog 实时推送，支持 TCP/UDP/TLS 传输
- 🔗 **智能事件聚合**: 窗口化聚合重复事件，减少高达 92% 的事件量
- 🛡️ **12 类安全事件**: 从认证到 DLP、配置变更到异常检测的全面覆盖

## 系统架构

```
┌────────────────────────────────────────────┐
│         ChainlessChain 安全事件源           │
│  AUTH / DLP / CONFIG / KEY / ANOMALY / ... │
└──────────────────┬─────────────────────────┘
                   │
                   ▼
┌────────────────────────────────────────────┐
│           SIEM Exporter                    │
│  事件聚合 → 格式化(CEF/LEEF/JSON) → 推送   │
└───────────────┬──────────┬──────────────────┘
     │         │          │
     ▼         ▼          ▼
┌────────┐ ┌────────┐ ┌──────────────┐
│ Splunk │ │ QRadar │ │ Elasticsearch│
│ (HEC)  │ │(Syslog)│ │ (REST API)   │
└────────┘ └────────┘ └──────────────┘
```

## 概述

Phase 51 为 ChainlessChain 引入 SIEM (Security Information and Event Management) 集成能力，支持将安全事件导出到企业 SIEM 平台，实现统一安全监控。

**核心目标**:

- 📤 **事件导出**: 支持 CEF、LEEF、JSON 三种标准格式
- 🔌 **平台集成**: Splunk、QRadar、Elasticsearch 等主流 SIEM
- ⏱️ **实时推送**: WebSocket/Syslog 实时事件推送
- 📊 **事件聚合**: 智能事件聚合和去重

---

## 支持的 SIEM 平台

| 平台               | 协议                       | 格式          | 状态 |
| ------------------ | -------------------------- | ------------- | ---- |
| **Splunk**         | HEC (HTTP Event Collector) | JSON          | ✅   |
| **IBM QRadar**     | Syslog                     | LEEF          | ✅   |
| **ArcSight**       | Syslog                     | CEF           | ✅   |
| **Elasticsearch**  | REST API                   | JSON          | ✅   |
| **Azure Sentinel** | REST API                   | JSON          | ✅   |
| **自定义**         | Syslog / HTTP              | CEF/LEEF/JSON | ✅   |

---

## 核心功能

### 1. 导出格式

#### CEF (Common Event Format)

ArcSight 标准格式：

```
CEF:0|ChainlessChain|Desktop|1.1.0|DLP_VIOLATION|Data Loss Prevention Violation|8|
  src=192.168.1.100 dst=external suser=alice msg=Credit card detected act=blocked
```

#### LEEF (Log Event Extended Format)

IBM QRadar 标准格式：

```
LEEF:2.0|ChainlessChain|Desktop|1.1.0|DLP_VIOLATION|
  devTime=2026-02-27T10:30:00Z severity=8 src=192.168.1.100
  usrName=alice action=blocked reason=Credit card detected
```

#### JSON

通用 JSON 格式：

```json
{
  "timestamp": "2026-02-27T10:30:00.000Z",
  "source": "ChainlessChain",
  "version": "1.1.0",
  "eventType": "DLP_VIOLATION",
  "severity": 8,
  "details": {
    "user": "alice",
    "action": "blocked",
    "violationType": "credit-card",
    "context": "chat-message"
  }
}
```

---

### 2. 事件导出配置

```javascript
// 配置 SIEM 导出器
await window.electronAPI.invoke("siem:configure-exporter", {
  type: "splunk",
  config: {
    url: "https://splunk.company.com:8088",
    token: "HEC-TOKEN-HERE",
    index: "chainlesschain",
    sourcetype: "chainlesschain:security",
  },
  format: "json",
  enabled: true,
});

// 配置 Syslog 导出
await window.electronAPI.invoke("siem:configure-exporter", {
  type: "syslog",
  config: {
    host: "syslog.company.com",
    port: 514,
    protocol: "tcp", // tcp/udp/tls
    facility: "local0",
  },
  format: "cef",
  enabled: true,
});

// 测试连接
const testResult = await window.electronAPI.invoke("siem:test-connection");
// { success: true, latency: 45, message: 'Connection OK' }
```

---

### 3. 事件类型

ChainlessChain 导出以下安全事件到 SIEM：

| 事件类型            | 说明         | 严重度 |
| ------------------- | ------------ | ------ |
| `AUTH_LOGIN`        | 用户登录     | 1      |
| `AUTH_LOGOUT`       | 用户登出     | 1      |
| `AUTH_FAILED`       | 登录失败     | 5      |
| `AUTH_LOCKED`       | 账户锁定     | 7      |
| `DLP_VIOLATION`     | DLP 违规     | 6-9    |
| `DATA_EXPORT`       | 数据导出     | 3      |
| `DATA_DELETE`       | 数据删除     | 5      |
| `CONFIG_CHANGE`     | 配置变更     | 4      |
| `KEY_OPERATION`     | 密钥操作     | 6      |
| `PERMISSION_CHANGE` | 权限变更     | 5      |
| `COMPLIANCE_FAIL`   | 合规检查失败 | 7      |
| `ANOMALY_DETECTED`  | 异常检测     | 8      |

```javascript
// 手动发送事件
await window.electronAPI.invoke("siem:send-event", {
  eventType: "CUSTOM_ALERT",
  severity: 6,
  details: {
    message: "自定义安全告警",
    source: "custom-module",
  },
});

// 查看导出历史
const exports = await window.electronAPI.invoke("siem:list-exports", {
  limit: 100,
  since: "2026-02-01",
});
```

---

### 4. 事件聚合

智能聚合重复事件，减少 SIEM 负载：

```javascript
// 配置聚合规则
await window.electronAPI.invoke("siem:configure-aggregation", {
  rules: [
    {
      eventType: "AUTH_FAILED",
      window: 300, // 5 分钟窗口
      threshold: 5, // 5 次触发聚合
      aggregatedSeverity: 8, // 聚合后提升严重度
    },
    {
      eventType: "DLP_VIOLATION",
      window: 60,
      threshold: 3,
      aggregatedSeverity: 9,
    },
  ],
});

// 获取聚合统计
const aggStats = await window.electronAPI.invoke("siem:get-aggregation-stats");
// {
//   totalEvents: 1500,
//   aggregatedEvents: 120,
//   reductionRate: 0.92,  // 92% 事件量减少
//   activeRules: 2
// }
```

**数据库结构**:

```sql
CREATE TABLE siem_exports (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  severity INTEGER NOT NULL,
  format TEXT NOT NULL,         -- cef/leef/json
  destination TEXT NOT NULL,    -- splunk/syslog/elasticsearch
  payload TEXT,                 -- 导出的事件内容
  status TEXT DEFAULT 'sent',   -- sent/failed/pending
  error_message TEXT,
  created_at INTEGER NOT NULL,
  sent_at INTEGER
);
```

---

## 前端集成

### Pinia Store

```typescript
import { useSIEMStore } from "@/stores/siem";

const siem = useSIEMStore();

// 配置导出器
await siem.configureExporter(config);

// 测试连接
await siem.testConnection();

// 查看导出统计
console.log(siem.exportStats);
```

### 前端页面

**SIEM 集成页面** (`/siem-integration`)

**功能模块**:

1. **导出配置**
   - SIEM 平台选择
   - 连接参数配置
   - 格式选择 (CEF/LEEF/JSON)
   - 连接测试

2. **事件管理**
   - 事件类型过滤
   - 严重度过滤
   - 导出状态监控

3. **聚合配置**
   - 聚合规则管理
   - 窗口/阈值配置
   - 聚合效果统计

4. **统计面板**
   - 导出趋势图
   - 事件类型分布
   - 失败率监控

---

## 配置选项

```json
{
  "compliance": {
    "siem": {
      "enabled": true,
      "exporter": {
        "type": "splunk",
        "format": "json",
        "config": {
          "url": "https://splunk.company.com:8088",
          "token": "HEC-TOKEN",
          "index": "chainlesschain"
        }
      },
      "batchSize": 100,
      "flushInterval": 5000,
      "retryAttempts": 3,
      "aggregation": {
        "enabled": true,
        "defaultWindow": 300,
        "defaultThreshold": 5
      }
    }
  }
}
```

---

## 使用场景

### 场景 1: Splunk 集成

```javascript
// 1. 配置 Splunk HEC
await window.electronAPI.invoke("siem:configure-exporter", {
  type: "splunk",
  config: {
    url: "https://splunk.company.com:8088",
    token: "YOUR-HEC-TOKEN",
    index: "security",
    sourcetype: "chainlesschain",
  },
  format: "json",
});

// 2. 测试连接
const test = await window.electronAPI.invoke("siem:test-connection");
console.log(test.success); // true

// 3. 事件将自动推送到 Splunk
```

### 场景 2: 安全事件告警

```javascript
// 1. 配置聚合规则 - 5 分钟内 5 次登录失败告警
await window.electronAPI.invoke("siem:configure-aggregation", {
  rules: [
    {
      eventType: "AUTH_FAILED",
      window: 300,
      threshold: 5,
      aggregatedSeverity: 9,
    },
  ],
});

// 2. 聚合事件自动发送高严重度告警到 SIEM
// SIEM 端可配置告警规则进行通知
```

---

## 使用示例

### 示例 1: CEF 格式导出到 ArcSight

```javascript
// 1. 配置 Syslog/CEF 导出到 ArcSight
await window.electronAPI.invoke("siem:configure-exporter", {
  type: "syslog",
  config: {
    host: "arcsight.company.com",
    port: 514,
    protocol: "tls",
    facility: "local0",
  },
  format: "cef",
  enabled: true,
});

// 2. 验证连接
const test = await window.electronAPI.invoke("siem:test-connection");
console.log(`连接状态: ${test.success ? "成功" : "失败"}, 延迟: ${test.latency}ms`);

// 3. 配置登录失败告警聚合（5 分钟内 3 次触发高严重度告警）
await window.electronAPI.invoke("siem:configure-aggregation", {
  rules: [{
    eventType: "AUTH_FAILED",
    window: 300,
    threshold: 3,
    aggregatedSeverity: 9,
  }],
});
```

### 示例 2: LEEF 格式导出到 QRadar 并手动发送事件

```javascript
// 配置 QRadar Syslog 导出
await window.electronAPI.invoke("siem:configure-exporter", {
  type: "syslog",
  config: { host: "qradar.company.com", port: 514, protocol: "tcp" },
  format: "leef",
  enabled: true,
});

// 手动发送自定义安全事件
await window.electronAPI.invoke("siem:send-event", {
  eventType: "ANOMALY_DETECTED",
  severity: 8,
  details: { message: "异常数据访问模式", source: "dlp-module", user: "bob" },
});

// 查看聚合效果统计
const stats = await window.electronAPI.invoke("siem:get-aggregation-stats");
console.log(`事件缩减率: ${(stats.reductionRate * 100).toFixed(0)}%`);
```

---

## 故障排查

| 问题 | 可能原因 | 解决方案 |
| --- | --- | --- |
| 连接测试失败 | SIEM 端口不可达或凭证错误 | 检查防火墙规则，确认 HEC Token 和 Syslog 端口配置正确 |
| 事件发送状态为 `failed` | 网络中断或 SIEM 拒绝请求 | 查看 `siem:list-exports` 中的 `error_message`，系统会自动重试 |
| CEF/LEEF 格式解析异常 | 事件字段包含特殊字符 | 确认事件详情中无管道符 `|` 或换行符，系统会自动转义 |
| 聚合未生效 | 事件类型不匹配规则 | 检查 `eventType` 拼写，确认与聚合规则中的类型完全一致 |
| 事件量过大导致积压 | 批量大小或刷新间隔不合理 | 调整 `batchSize`（默认 100）和 `flushInterval`（默认 5000ms） |
| TLS 连接报错 | 证书链不完整或过期 | 更新 SIEM 服务端证书，或在配置中指定自签名 CA 证书路径 |

---

## 配置参考

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `enabled` | `boolean` | `false` | 是否启用 SIEM 导出 |
| `exporter.type` | `string` | `"splunk"` | 导出目标类型：`splunk` / `syslog` / `elasticsearch` / `azure-sentinel` |
| `exporter.format` | `string` | `"json"` | 事件格式：`cef` / `leef` / `json` |
| `exporter.config.url` | `string` | — | 目标平台地址（HTTP/HTTPS/Syslog 主机） |
| `exporter.config.token` | `string` | — | HEC Token 或 API 密钥（加密存储） |
| `exporter.config.index` | `string` | `"chainlesschain"` | Splunk/Elasticsearch 索引名 |
| `exporter.config.port` | `number` | `514` | Syslog 端口（TCP/UDP/TLS） |
| `exporter.config.protocol` | `string` | `"tcp"` | Syslog 传输协议：`tcp` / `udp` / `tls` |
| `exporter.config.facility` | `string` | `"local0"` | Syslog facility |
| `batchSize` | `number` | `100` | 批量发送大小（事件数） |
| `flushInterval` | `number` | `5000` | 批量刷新间隔（毫秒） |
| `retryAttempts` | `number` | `3` | 发送失败最大重试次数 |
| `aggregation.enabled` | `boolean` | `true` | 是否启用事件聚合 |
| `aggregation.defaultWindow` | `number` | `300` | 聚合时间窗口（秒） |
| `aggregation.defaultThreshold` | `number` | `5` | 触发聚合的事件数阈值 |

**完整配置示例**:

```json
{
  "compliance": {
    "siem": {
      "enabled": true,
      "exporter": {
        "type": "splunk",
        "format": "json",
        "config": {
          "url": "https://splunk.company.com:8088",
          "token": "HEC-TOKEN",
          "index": "chainlesschain",
          "sourcetype": "chainlesschain:security"
        }
      },
      "batchSize": 100,
      "flushInterval": 5000,
      "retryAttempts": 3,
      "aggregation": {
        "enabled": true,
        "defaultWindow": 300,
        "defaultThreshold": 5
      }
    }
  }
}
```

---

## 测试覆盖率

| 测试文件 | 覆盖范围 | 用例数 |
| --- | --- | --- |
| `tests/unit/enterprise/siem-exporter.test.js` | 导出器初始化、批量发送、重试逻辑、flush 间隔 | 18 |
| `tests/unit/enterprise/siem-formatter.test.js` | CEF / LEEF / JSON 格式化、特殊字符转义 | 24 |
| `tests/unit/enterprise/siem-aggregator.test.js` | 聚合窗口计算、阈值触发、严重度提升 | 15 |
| `tests/unit/enterprise/siem-ipc.test.js` | 4 个 IPC Handler（configure / test / send / list） | 12 |
| `tests/integration/enterprise/siem-splunk.test.js` | Splunk HEC 端到端（mock server） | 8 |
| `tests/integration/enterprise/siem-syslog.test.js` | Syslog TCP / UDP / TLS 推送 | 9 |

**运行测试**:

```bash
# 全部 SIEM 单元测试
cd desktop-app-vue && npx vitest run tests/unit/enterprise/siem-

# 含集成测试（需 mock Splunk server）
cd desktop-app-vue && npx vitest run tests/unit/enterprise/siem- tests/integration/enterprise/siem-
```

**关键断言示例**:

```javascript
// CEF 格式包含必要字段
expect(cefLine).toMatch(/^CEF:0\|ChainlessChain\|/);
expect(cefLine).toContain("DLP_VIOLATION");

// 聚合后事件量减少
expect(aggStats.reductionRate).toBeGreaterThan(0.8);

// 重试 3 次后标记 failed
expect(exportRecord.status).toBe("failed");
expect(exportRecord.retryCount).toBe(3);
```

---

## 安全考虑

1. **传输加密**: 所有 SIEM 通信使用 TLS 加密
2. **凭证保护**: SIEM Token/密码使用 AES-256 加密存储
3. **数据脱敏**: 导出事件自动脱敏敏感信息
4. **速率限制**: 防止事件风暴导致 SIEM 过载
5. **故障恢复**: 发送失败的事件自动重试和本地缓存

---

## 性能指标

| 指标             | 目标   | 实际   |
| ---------------- | ------ | ------ |
| 事件格式化延迟   | <5ms   | ~2ms   |
| 单事件发送延迟   | <100ms | ~50ms  |
| 批量发送 (100条) | <500ms | ~300ms |
| 聚合处理延迟     | <10ms  | ~5ms   |

---

## 相关文档

- [DLP 数据防泄漏](/chainlesschain/dlp)
- [合规与数据分类](/chainlesschain/compliance)
- [企业审计日志](/chainlesschain/audit)
- [产品路线图](/chainlesschain/product-roadmap)

---

## 关键文件

| 文件                                                | 职责                     |
| --------------------------------------------------- | ------------------------ |
| `src/main/enterprise/siem-exporter.js`              | SIEM 事件导出核心引擎    |
| `src/main/enterprise/siem-formatter.js`             | CEF/LEEF/JSON 格式化器   |
| `src/main/enterprise/siem-aggregator.js`            | 事件聚合与去重           |
| `src/main/enterprise/siem-ipc.js`                   | IPC 处理器（4 个）       |
| `src/renderer/pages/enterprise/SIEMPage.vue`        | SIEM 集成管理页面        |
| `src/renderer/stores/siem.ts`                       | Pinia 状态管理           |

---

**文档版本**: 1.0.0
**最后更新**: 2026-02-27
