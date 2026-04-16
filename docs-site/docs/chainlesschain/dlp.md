# 数据防泄漏 (DLP)

> **Phase 50 | v1.1.0-alpha | 8 IPC 处理器 | 2 张新数据库表**

## 核心特性

- 🔍 **实时内容检测**: 8 种内置检测器（信用卡/身份证/手机号/API密钥等），<50ms 扫描延迟
- 📋 **策略引擎**: 灵活的规则定义，支持 block/mask/warn/log/encrypt 5 种动作
- 🚨 **事件管理**: 违规事件全生命周期（open→investigating→resolved），分级响应
- 🔗 **分类集成**: 与 Phase 43 数据分类系统联动，RESTRICTED 数据自动触发 DLP
- 🛡️ **隐私保护**: 仅存储内容哈希，不保存原始敏感数据

## 系统架构

```
┌─────────────────────────────────────────────────┐
│              应用层 (8 IPC Handlers)              │
│  scan-content │ scan-file │ create-policy │ ...  │
├──────────────┬┴───────────┴──────────────────────┤
│   DLP Engine │    策略引擎 (Policy Engine)        │
│   8 检测器   │    5 种动作 (block/mask/warn/...)  │
├──────────────┴───────────────────────────────────┤
│         数据分类集成 (Phase 43)                    │
│  PUBLIC → INTERNAL → CONFIDENTIAL → RESTRICTED   │
├──────────────────────────────────────────────────┤
│  SQLite (dlp_policies, dlp_incidents)             │
└──────────────────────────────────────────────────┘
```

## 概述

Phase 50 为 ChainlessChain 引入企业级数据防泄漏 (Data Loss Prevention) 引擎，在数据分类 (Phase 43) 基础上构建实时内容检测、策略执行和事件管理能力。

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

## 配置参考

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `enabled` | `boolean` | `true` | 是否启用 DLP 引擎 |
| `realTimeScan` | `boolean` | `true` | 是否启用实时内容扫描（聊天/输入时触发） |
| `defaultAction` | `string` | `"warn"` | 策略未匹配时的默认动作：`block` / `mask` / `warn` / `log` |
| `maxContentSize` | `number` | `10485760` | 单次扫描最大内容大小（字节，默认 10 MB） |
| `customDetectors` | `array` | `[]` | 自定义检测器列表（对象数组，含 `name` / `pattern` / `severity`） |
| `excludePaths` | `array` | `["/tmp", "/cache"]` | 文件扫描排除路径，减少对临时目录的不必要扫描 |
| `incidentRetention` | `number` | `90` | 事件记录保留天数，超期自动清理 |
| `deepScanThreshold` | `string` | `"RESTRICTED"` | 触发深度扫描（OCR 等）的最低分类级别 |
| `whitelistPatterns` | `array` | `[]` | 全局白名单正则，匹配的内容跳过所有检测器 |
| `notifyAdmin` | `boolean` | `true` | `critical` 级别事件是否通知管理员 |

**完整配置示例**:

```json
{
  "compliance": {
    "dlp": {
      "enabled": true,
      "realTimeScan": true,
      "defaultAction": "warn",
      "maxContentSize": 10485760,
      "customDetectors": [
        {
          "name": "internal-employee-id",
          "pattern": "EMP-\\d{6}",
          "severity": "medium",
          "action": "log"
        }
      ],
      "excludePaths": ["/tmp", "/cache", "/.chainlesschain/logs"],
      "incidentRetention": 90,
      "deepScanThreshold": "RESTRICTED",
      "whitelistPatterns": [],
      "notifyAdmin": true
    }
  }
}
```

---

## 测试覆盖

| 测试文件 | 覆盖范围 | 用例数 |
| --- | --- | --- |
| `tests/unit/security/dlp-engine.test.js` | 8 内置检测器正确性、Luhn 校验、边界值 | 32 |
| `tests/unit/security/dlp-policy-manager.test.js` | 策略 CRUD、优先级排序、作用域匹配 | 20 |
| `tests/unit/security/dlp-incident-manager.test.js` | 事件记录、状态流转（open→resolved）、统计聚合 | 18 |
| `tests/unit/security/dlp-ipc.test.js` | 8 个 IPC Handler（scan / policy / incident / stats） | 24 |
| `tests/integration/security/dlp-classification.test.js` | 与 Phase 43 数据分类联动、RESTRICTED 自动触发 | 10 |
| `tests/integration/security/dlp-realtime.test.js` | 实时扫描延迟（<50ms）、并发扫描、误报率 | 12 |

**运行测试**:

```bash
# 全部 DLP 单元测试
cd desktop-app-vue && npx vitest run tests/unit/security/dlp-

# 含集成测试
cd desktop-app-vue && npx vitest run tests/unit/security/dlp- tests/integration/security/dlp-
```

**关键断言示例**:

```javascript
// 信用卡检测器命中并 Luhn 校验
expect(result.violations[0].type).toBe("credit-card");
expect(result.violations[0].severity).toBe("high");

// mask 动作脱敏格式
expect(maskedContent).toMatch(/4\d{3}\*{8}\d{4}/);

// 实时扫描延迟满足 SLA
expect(scanDuration).toBeLessThan(50); // ms

// 事件状态流转
expect(incident.status).toBe("resolved");
expect(incident.resolvedAt).toBeDefined();
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

## 故障排查

### 检测器误报率过高

- **白名单配置**: 对已知安全的内容模式添加白名单规则，避免重复误报
- **调整检测器**: 自定义正则表达式的灵敏度，或禁用不需要的检测器类型
- **误报标记**: 对误报事件标记为 `dismissed`，系统会学习并减少同类误报

```javascript
// 标记误报事件
await window.electronAPI.invoke('dlp:update-incident', {
  incidentId: 'inc-xxx',
  status: 'dismissed',
  resolution: '误报，测试数据'
});
```

### 扫描性能下降

- **文件大小限制**: 检查 `maxContentSize` 配置（默认 10MB），过大的文件会增加扫描时间
- **排除路径**: 将缓存、临时文件目录添加到 `excludePaths` 中减少不必要的扫描
- **深度扫描**: 非必要时关闭 `deep: true`（OCR 等），仅对可疑文件启用深度扫描

### 策略未生效

- 确认策略的 `enabled` 字段为 `true`
- 检查策略的 `scope` 是否包含当前操作场景（如 `chat`、`file-share`、`export`）
- 多策略时注意 `priority` 优先级，高优先级策略的动作会覆盖低优先级
- 检查是否有白名单规则意外匹配了应当拦截的内容

---

## 使用示例

### DLP 策略配置

```javascript
// 创建多规则 DLP 策略（覆盖聊天、文件分享、导出三个场景）
const policy = await window.electronAPI.invoke('dlp:create-policy', {
  name: '企业数据外泄防护',
  rules: [
    { detector: 'credit-card', action: 'block', severity: 'critical', notify: true },
    { detector: 'api-key', action: 'block', severity: 'critical', notify: true },
    { detector: 'phone-number', action: 'mask', severity: 'medium' },
    { detector: 'email', action: 'warn', severity: 'low' }
  ],
  scope: ['chat', 'file-share', 'export'],
  enabled: true
});
```

### 敏感数据扫描

```javascript
// 实时扫描文本内容（<50ms 延迟）
const result = await window.electronAPI.invoke('dlp:scan-content', {
  content: '服务器密码是 admin123，API 密钥 sk-abc123xyz',
  context: 'chat-message'
});
// result.violations 列出每个检测到的敏感项及其位置和严重级别

// 深度扫描文件（支持 OCR 识别图片中的文字）
const fileScan = await window.electronAPI.invoke('dlp:scan-file', {
  filePath: '/path/to/document.pdf',
  deep: true
});
```

### 数据分类与 DLP 联动

```javascript
// 先调用数据分类接口，RESTRICTED 级别自动触发 DLP 深度扫描
const classification = await window.electronAPI.invoke('compliance:classify-text', {
  text: someContent
});
if (classification.level === 'RESTRICTED') {
  const dlpResult = await window.electronAPI.invoke('dlp:scan-content', {
    content: someContent,
    classificationLevel: 'RESTRICTED'
  });
  // RESTRICTED 数据匹配策略后执行 block 动作
}
```

### 事件响应与处理

```javascript
// 查看高严重度事件列表
const incidents = await window.electronAPI.invoke('dlp:list-incidents', {
  severity: 'critical', startDate: '2026-03-01', limit: 20
});

// 将误报事件标记为已处理
await window.electronAPI.invoke('dlp:update-incident', {
  incidentId: 'inc-001',
  status: 'dismissed',
  resolution: '确认为测试数据，非真实敏感信息'
});

// 获取 DLP 拦截统计（按严重度和检测器类型汇总）
const stats = await window.electronAPI.invoke('dlp:get-stats', { period: '30d' });
```

## 关键文件

| 文件 | 职责 |
| --- | --- |
| `desktop-app-vue/src/main/security/dlp-engine.js` | DLP 检测引擎核心（8 内置检测器） |
| `desktop-app-vue/src/main/security/dlp-policy-manager.js` | 策略管理（CRUD + 优先级匹配） |
| `desktop-app-vue/src/main/security/dlp-incident-manager.js` | 事件管理（记录、分级、响应） |
| `desktop-app-vue/src/main/security/dlp-ipc.js` | DLP 8 个 IPC Handler |
| `desktop-app-vue/src/main/security/content-detectors/` | 内置检测器目录（正则 + Luhn 校验） |

## 相关文档

- [合规与数据分类](/chainlesschain/compliance)
- [SIEM 集成](/chainlesschain/siem)
- [企业审计日志](/chainlesschain/audit)
- [产品路线图](/chainlesschain/product-roadmap)

---

**文档版本**: 1.0.0
**最后更新**: 2026-02-27
