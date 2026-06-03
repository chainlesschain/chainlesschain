# Phase 50 — 数据防泄漏 (DLP) 系统设计

**版本**: v1.1.0
**创建日期**: 2026-02-28
**状态**: ✅ 已实现 (v1.1.0-alpha)

---

## 一、模块概述

Phase 50 引入数据防泄漏 (Data Loss Prevention) 引擎，通过策略驱动的内容扫描防止敏感数据泄露。

### 1.1 核心目标

1. **策略管理**: CRUD 管理 DLP 策略 (正则模式 + 关键词)
2. **实时扫描**: 多通道内容扫描 (邮件、聊天、文件传输、剪贴板、导出)
3. **事件响应**: 允许/告警/阻止/隔离四级响应
4. **事件管理**: DLP 事件记录、查询、解决

### 1.2 技术架构

```
┌──────────────────────────────────────────────────────┐
│                   Content Channels                   │
│  Email | Chat | File Transfer | Clipboard | Export   │
└───────────────────────┬──────────────────────────────┘
                        │
┌───────────────────────┼──────────────────────────────┐
│                       ▼                              │
│  ┌─────────────────────────────────────────────┐    │
│  │ DLP Engine (dlp-engine.js)                  │    │
│  │ - Pattern Matching (Regex)                  │    │
│  │ - Keyword Matching (Case-Insensitive)       │    │
│  │ - Content Hashing (SHA-256, Dedup)          │    │
│  │ - Action Enforcement                        │    │
│  └───────────────┬─────────────────────────────┘    │
│                  │                                   │
│  ┌───────────────┼─────────────────────────────┐    │
│  │ DLP Policy Manager (dlp-policy.js)          │    │
│  │ - Policy CRUD                               │    │
│  │ - Channel-Based Filtering                   │    │
│  │ - Enable/Disable Toggle                     │    │
│  └─────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────┘
```

---

## 二、核心模块设计

### 2.1 DLP Engine

**文件**: `desktop-app-vue/src/main/audit/dlp-engine.js`

**响应动作**:

```javascript
const DLP_ACTIONS = {
  ALLOW: "allow", // 允许通过
  ALERT: "alert", // 允许但告警
  BLOCK: "block", // 阻止操作
  QUARANTINE: "quarantine", // 隔离内容
};
```

**扫描通道**:

```javascript
const DLP_CHANNELS = {
  EMAIL: "email",
  CHAT: "chat",
  FILE_TRANSFER: "file_transfer",
  CLIPBOARD: "clipboard",
  EXPORT: "export",
};
```

**API**:

```javascript
class DLPEngine extends EventEmitter {
  async initialize()
  setPolicyManager(pm)     // 注入策略管理器
  async scanContent({ content, channel, userId, metadata = {} }) // 扫描内容
  async getIncidents({ channel, severity, limit = 50, offset = 0 })
  async resolveIncident(incidentId, resolution) // 解决事件
  async getStats()         // 获取扫描统计
  async close()
}
```

**内部方法**:

- `_matchPatterns(content, patterns)` - 正则模式匹配
- `_matchKeywords(content, keywords)` - 关键词匹配 (大小写不敏感)
- `_hashContent(content)` - SHA-256 哈希 (用于去重)
- `_saveIncident(incident)` - 持久化事件

### 2.2 DLP Policy Manager

**文件**: `desktop-app-vue/src/main/audit/dlp-policy.js`

**API**:

```javascript
class DLPPolicyManager extends EventEmitter {
  async initialize()
  async createPolicy({ name, description, channels, patterns, keywords, action = "alert", severity = "medium" })
  async updatePolicy(id, updates)
  async deletePolicy(id)
  async getPolicy(id)
  async listPolicies({ enabled })
  async getActivePoliciesForChannel(channel) // 获取指定通道的活跃策略
  async close()
}
```

---

## 三、数据库设计

### 3.1 dlp_policies (DLP策略)

```sql
CREATE TABLE IF NOT EXISTS dlp_policies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  enabled INTEGER DEFAULT 1,
  channels TEXT,           -- JSON: ["email","chat"]
  patterns TEXT NOT NULL,  -- JSON: ["\\b\\d{16}\\b"] (正则)
  keywords TEXT,           -- JSON: ["confidential","secret"]
  action TEXT DEFAULT 'alert',
  severity TEXT DEFAULT 'medium',
  created_at INTEGER,
  updated_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_dlp_policies_enabled ON dlp_policies(enabled);
```

### 3.2 dlp_incidents (DLP事件)

```sql
CREATE TABLE IF NOT EXISTS dlp_incidents (
  id TEXT PRIMARY KEY,
  policy_id TEXT,
  channel TEXT,
  action_taken TEXT,
  content_hash TEXT,       -- SHA-256 (去重用)
  matched_patterns TEXT,   -- JSON: 匹配到的模式
  severity TEXT,
  user_id TEXT,
  metadata TEXT,
  created_at INTEGER,
  resolved_at INTEGER,
  resolution TEXT
);
CREATE INDEX IF NOT EXISTS idx_dlp_incidents_policy_id ON dlp_incidents(policy_id);
CREATE INDEX IF NOT EXISTS idx_dlp_incidents_channel ON dlp_incidents(channel);
CREATE INDEX IF NOT EXISTS idx_dlp_incidents_severity ON dlp_incidents(severity);
CREATE INDEX IF NOT EXISTS idx_dlp_incidents_created_at ON dlp_incidents(created_at);
```

---

## 四、IPC 接口设计

**文件**: `desktop-app-vue/src/main/audit/dlp-ipc.js`

### 4.1 扫描与事件 IPC (4个)

- `dlp:scan-content` - 扫描内容
- `dlp:get-incidents` - 获取DLP事件 (支持 channel/severity/limit 过滤)
- `dlp:resolve-incident` - 解决事件
- `dlp:get-stats` - 获取扫描统计

### 4.2 策略管理 IPC (4个)

- `dlp:create-policy` - 创建策略
- `dlp:update-policy` - 更新策略
- `dlp:delete-policy` - 删除策略
- `dlp:list-policies` - 列出策略

---

## 五、前端集成

### 5.1 Pinia Store (`stores/dlp.ts`)

```typescript
interface DLPPolicy {
  id: string; name: string; description: string;
  enabled: boolean; channels: string[]; patterns: string[];
  keywords: string[]; action: string; severity: string;
}

interface DLPIncident {
  id: string; policy_id: string; channel: string;
  action_taken: string; matched_patterns: string;
  severity: string; user_id: string;
  resolved_at: number | null; resolution: string | null;
}

const useDlpStore = defineStore('dlp', {
  state: () => ({
    policies: [], incidents: [],
    stats: null, loading: false, error: null,
  }),
  getters: {
    activePolicies,      // 启用的策略
    unresolvedIncidents, // 未解决事件
  },
  actions: {
    fetchPolicies(), createPolicy(), updatePolicy(), deletePolicy(),
    fetchIncidents(), resolveIncident(), scanContent(), fetchStats(),
  }
})
```

### 5.2 UI 页面 (`pages/enterprise/DLPPoliciesPage.vue`)

- 策略列表 (名称、通道、模式数、动作、严重性、启用开关)
- 策略创建/编辑表单 (正则模式编辑器、关键词标签)
- 事件仪表板 (时间线、严重性分布图)
- 事件详情面板 (匹配内容预览、解决操作)

---

## 六、配置选项

```javascript
// unified-config-manager.js → compliance.dlp
compliance: {
  dlp: {
    enabled: true,
    defaultAction: "alert",
    maxContentSize: 10485760, // 10MB
    hashAlgorithm: "sha256",
    builtinPolicies: true     // 加载内置策略模板
  }
}
```

---

## 七、内置策略模板

| 策略名称 | 模式                                         | 通道    | 动作         |
| -------- | -------------------------------------------- | ------- | ------------ | ---- | ----- |
| 信用卡号 | `\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b` | 全部    | block        |
| 身份证号 | `\b\d{17}[\dXx]\b`                           | 全部    | block        |
| 邮箱地址 | `[\w.]+@[\w.]+\.\w+`                         | 导出    | alert        |
| API密钥  | `(sk-                                        | api_key | secret_key)` | 全部 | block |
| 密码明文 | `password\s*[:=]\s*\S+`                      | 全部    | alert        |

---

## 八、与审计系统集成

- `enterprise-audit-logger.js` 扩展了 DLP 事件类型
- DLP 事件自动写入审计日志
- SIEM 导出器 (Phase 51) 可导出 DLP 事件

---

## 九、测试覆盖

- ✅ `dlp-engine.test.js` - 扫描引擎、模式匹配
- ✅ `dlp-policy.test.js` - 策略管理
- ✅ `dlp-ipc.test.js` - IPC处理器
- ✅ `dlp.test.ts` - Pinia Store

---

**文档版本**: 1.0.0
**最后更新**: 2026-02-28
