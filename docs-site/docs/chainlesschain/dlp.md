# 数据防泄漏 (DLP)

> **Phase 50 | v1.1.0-alpha | 8 IPC 处理器 | 2 张新数据库表**

## 概述

Phase 50 为 ChainlessChain 引入企业级数据防泄漏 (Data Loss Prevention) 引擎，在数据分类 (Phase 43) 基础上构建实时内容检测、策略执行和事件管理能力。

**核心目标**:

- 🔍 **实时内容检测**: 监控数据流动，识别敏感信息
- 📋 **策略引擎**: 灵活的规则定义和动作执行
- 🚨 **事件管理**: 违规事件记录、分级和响应
- 🔗 **分类集成**: 与 Phase 43 数据分类系统联动

---

## 核心功能

### 1. DLP 引擎

实时检测数据中的敏感信息。

**内置检测器**:

| 检测器        | 说明         | 示例模式                               |
| ------------- | ------------ | -------------------------------------- | ---------------- | ------------------ |
| **信用卡号**  | PCI DSS      | `4[0-9]{12}(?:[0-9]{3})?`              |
| **身份证号**  | 中国 18 位   | `[1-9]\d{5}(19                         | 20)\d{9}[0-9Xx]` |
| **手机号**    | 中国手机号   | `1[3-9]\d{9}`                          |
| **邮箱地址**  | RFC 5322     | `\w+@\w+\.\w+`                         |
| **API 密钥**  | 常见模式     | `(sk-                                  | ak\_             | AKIA)[a-zA-Z0-9]+` |
| **密码**      | 明文密码     | `password\s*[:=]\s*\S+`                |
| **SSH 密钥**  | RSA/ED25519  | `-----BEGIN.*PRIVATE KEY-----`         |
| **JWT Token** | Bearer Token | `eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+` |

**使用示例**:

```javascript
// 扫描文本内容
const result = await window.electronAPI.invoke("dlp:scan-content", {
  content: "请将款项打到卡号 4111111111111111，联系手机 13812345678",
  context: "chat-message",
});

console.log(result);
// {
//   violations: [
//     { type: 'credit-card', value: '4111****1111', position: [12, 28], severity: 'high' },
//     { type: 'phone-number', value: '138****5678', position: [34, 45], severity: 'medium' }
//   ],
//   riskLevel: 'high',
//   action: 'block',
//   policyId: 'policy-001'
// }

// 扫描文件
const fileScan = await window.electronAPI.invoke("dlp:scan-file", {
  filePath: "/path/to/document.pdf",
  deep: true, // 深度扫描（OCR 等）
});

// 批量扫描
const batchResult = await window.electronAPI.invoke("dlp:batch-scan", {
  items: [
    { type: "text", content: "some text..." },
    { type: "file", path: "/path/to/file.doc" },
  ],
});
```

---

### 2. DLP 策略管理

```javascript
// 创建 DLP 策略
const policy = await window.electronAPI.invoke("dlp:create-policy", {
  name: "敏感数据外发防护",
  description: "防止敏感数据通过聊天/文件分享外泄",
  rules: [
    {
      detector: "credit-card",
      action: "block",
      severity: "critical",
      notify: true,
    },
    {
      detector: "phone-number",
      action: "mask", // 自动脱敏
      severity: "medium",
      notify: false,
    },
    {
      detector: "api-key",
      action: "block",
      severity: "critical",
      notify: true,
    },
  ],
  scope: ["chat", "file-share", "export"],
  enabled: true,
});

// 列出所有策略
const policies = await window.electronAPI.invoke("dlp:list-policies");

// 更新策略
await window.electronAPI.invoke("dlp:update-policy", {
  policyId: policy.id,
  enabled: false,
});

// 删除策略
await window.electronAPI.invoke("dlp:delete-policy", {
  policyId: policy.id,
});
```

**策略动作**:

| 动作        | 说明     | 用户感知                 |
| ----------- | -------- | ------------------------ |
| **block**   | 阻止操作 | 弹窗提示，操作被拒绝     |
| **mask**    | 自动脱敏 | 敏感信息被替换为 `****`  |
| **warn**    | 警告提示 | 弹窗警告，用户可选择继续 |
| **log**     | 静默记录 | 用户无感知，后台记录     |
| **encrypt** | 强制加密 | 自动加密后允许操作       |

**数据库结构**:

```sql
CREATE TABLE dlp_policies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  rules TEXT NOT NULL,      -- JSON 规则数组
  scope TEXT,               -- JSON 作用域数组
  enabled INTEGER DEFAULT 1,
  priority INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER
);
```

---

### 3. 事件管理

```javascript
// 查看 DLP 事件
const incidents = await window.electronAPI.invoke("dlp:list-incidents", {
  severity: "high",
  startDate: "2026-02-01",
  endDate: "2026-02-27",
  limit: 50,
});

console.log(incidents);
// [
//   {
//     id: 'inc-001',
//     policyId: 'policy-001',
//     violationType: 'credit-card',
//     action: 'blocked',
//     severity: 'critical',
//     context: 'chat-message',
//     userId: 'did:chainless:abc123',
//     timestamp: 1709078400000,
//     details: { ... }
//   }
// ]

// 获取事件详情
const detail = await window.electronAPI.invoke("dlp:get-incident", {
  incidentId: "inc-001",
});

// 更新事件状态
await window.electronAPI.invoke("dlp:update-incident", {
  incidentId: "inc-001",
  status: "resolved",
  resolution: "已确认为测试数据，无需处理",
});

// 获取统计
const stats = await window.electronAPI.invoke("dlp:get-stats", {
  period: "30d",
});
// { total: 45, blocked: 30, masked: 10, warned: 5, bySeverity: {...} }
```

**数据库结构**:

```sql
CREATE TABLE dlp_incidents (
  id TEXT PRIMARY KEY,
  policy_id TEXT,
  violation_type TEXT NOT NULL,
  action_taken TEXT NOT NULL,
  severity TEXT NOT NULL,
  context TEXT,
  user_id TEXT,
  content_hash TEXT,          -- 不存储原文，仅哈希
  details TEXT,               -- JSON 详情
  status TEXT DEFAULT 'open', -- open/investigating/resolved/dismissed
  resolution TEXT,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);
```

---

## 与数据分类集成

DLP 引擎与 Phase 43 数据分类系统深度集成：

```javascript
// 使用分类结果进行 DLP 检测
const classification = await window.electronAPI.invoke(
  "compliance:classify-text",
  {
    text: someContent,
  },
);

// 分类为 RESTRICTED 的数据自动触发 DLP
if (classification.level === "RESTRICTED") {
  const dlpResult = await window.electronAPI.invoke("dlp:scan-content", {
    content: someContent,
    classificationLevel: classification.level,
  });
}
```

---

## 前端集成

### Pinia Store

```typescript
import { useDLPStore } from "@/stores/dlp";

const dlp = useDLPStore();

// 管理策略
await dlp.fetchPolicies();
await dlp.createPolicy(policyData);

// 查看事件
await dlp.fetchIncidents();
console.log(dlp.incidentStats);
```

### 前端页面

**DLP 策略管理页面** (`/dlp-policies`)

**功能模块**:

1. **策略管理**
   - 创建/编辑/删除策略
   - 规则配置器
   - 策略启用/禁用

2. **事件面板**
   - 事件时间线
   - 严重度分布图
   - 事件详情查看

3. **统计概览**
   - 拦截趋势图
   - 高危数据类型排名
   - 策略命中率

---

## 配置选项

```json
{
  "compliance": {
    "dlp": {
      "enabled": true,
      "realTimeScan": true,
      "defaultAction": "warn",
      "maxContentSize": 10485760,
      "customDetectors": [],
      "excludePaths": ["/tmp", "/cache"],
      "incidentRetention": 90
    }
  }
}
```

---

## 使用场景

### 场景 1: 防止聊天泄密

```javascript
// 1. 创建聊天防泄漏策略
await window.electronAPI.invoke("dlp:create-policy", {
  name: "聊天敏感信息防护",
  rules: [
    { detector: "credit-card", action: "mask" },
    { detector: "id-card", action: "block" },
    { detector: "api-key", action: "block" },
  ],
  scope: ["chat"],
});

// 2. 发送消息时自动检测
// 系统自动拦截或脱敏
```

### 场景 2: 文件导出审计

```javascript
// 1. 创建文件导出策略
await window.electronAPI.invoke("dlp:create-policy", {
  name: "文件导出审计",
  rules: [
    { detector: "ssh-key", action: "block" },
    { detector: "password", action: "block" },
  ],
  scope: ["file-share", "export"],
});

// 2. 导出文件时自动扫描
```

---

## 安全考虑

1. **不存原文**: DLP 事件仅存储内容哈希，不存储原始敏感数据
2. **最小权限**: DLP 策略管理仅限管理员角色
3. **审计追踪**: 所有策略变更记录到审计日志
4. **性能保障**: 异步扫描，不阻塞用户操作
5. **误报处理**: 支持白名单和误报标记

---

## 性能指标

| 指标             | 目标  | 实际  |
| ---------------- | ----- | ----- |
| 文本扫描延迟     | <50ms | ~30ms |
| 文件扫描延迟     | <2s   | ~1.5s |
| 策略匹配延迟     | <10ms | ~5ms  |
| 批量扫描 (100项) | <5s   | ~3s   |

---

## 相关文档

- [合规与数据分类](/chainlesschain/compliance)
- [SIEM 集成](/chainlesschain/siem)
- [企业审计日志](/chainlesschain/audit)
- [产品路线图](/chainlesschain/product-roadmap)

---

**文档版本**: 1.0.0
**最后更新**: 2026-02-27
