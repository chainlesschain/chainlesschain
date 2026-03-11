# 企业合规与数据分类

> **Phase 43 | v1.1.0-alpha | 12 IPC 处理器 | 2 张新数据库表**

## 核心特性

- 📋 **SOC2 自动合规**: 5 大信任服务原则（安全/可用性/完整性/机密性/隐私）自动检查与证据收集
- 🏷️ **4 级数据分类**: PUBLIC → INTERNAL → CONFIDENTIAL → RESTRICTED，支持 ML + 规则 + 手动三种分类方式
- 📨 **GDPR DSR 自动化**: 一键处理数据访问权、删除权、修正权、可携权请求
- ⚖️ **多框架统一管理**: GDPR / SOC2 / ISO27001 / HIPAA 统一检查调度和风险评分
- 🔒 **证据加密存储**: SOC2 证据文件 AES-256 加密，合规操作全量审计

## 系统架构

```
┌────────────────────────────────────────────────┐
│             企业合规管理系统                     │
├────────────────────────────────────────────────┤
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐ │
│  │ SOC2     │  │ GDPR     │  │ ISO27001     │ │
│  │ 合规检查 │  │ DSR 处理 │  │ / HIPAA      │ │
│  └────┬─────┘  └────┬─────┘  └──────┬───────┘ │
│       └──────────────┼───────────────┘         │
│                      ↓                         │
│          ┌───────────────────────┐             │
│          │  统一合规引擎          │             │
│          │  检查调度 | 风险评分   │             │
│          └───────────┬───────────┘             │
│                      ↓                         │
│  ┌──────────────────────────────────────────┐  │
│  │  数据分类系统 (ML + 规则 + 手动标记)     │  │
│  └──────────────────────────────────────────┘  │
├────────────────────────────────────────────────┤
│  DB: compliance_checks | data_classifications │
└────────────────────────────────────────────────┘
```

## 核心功能

### 1. SOC2 合规管理

**5大信任服务原则(TSC)**:

| TSC | 原则 | 控制点数量 |
|-----|------|-----------|
| CC1.0 | Security (安全) | 15+ |
| CC2.0 | Availability (可用性) | 10+ |
| CC3.0 | Processing Integrity (处理完整性) | 8+ |
| CC4.0 | Confidentiality (机密性) | 12+ |
| CC5.0 | Privacy (隐私) | 10+ |

**使用示例**:

```javascript
// 执行 SOC2 检查
const result = await window.electronAPI.invoke('compliance:soc2-run-check')

console.log(result)
// {
//   passed: 45,
//   failed: 5,
//   passRate: 0.90,
//   criticalIssues: [
//     { controlId: 'CC1.2', issue: '密码策略不符合要求' }
//   ]
// }

// 收集证据
await window.electronAPI.invoke('compliance:soc2-collect-evidence', {
  controlId: 'CC1.1',
  evidenceType: 'config'
})

// 生成合规报告
const report = await window.electronAPI.invoke('compliance:soc2-generate-report', {
  startDate: '2026-01-01',
  endDate: '2026-02-27'
})
```

---

### 2. 数据分类系统

**4级分类体系**:

| 级别 | 说明 | 示例 | 加密要求 |
|------|------|------|---------|
| **PUBLIC** | 公开信息 | 产品文档、公告 | 无 |
| **INTERNAL** | 内部使用 | 员工邮箱、内部文档 | 可选 |
| **CONFIDENTIAL** | 机密 | 商业计划、客户数据 | AES-128 |
| **RESTRICTED** | 高度敏感 | 密码、密钥、个人隐私 | AES-256 |

**分类方式**:

1. **ML 分类器** - 文本内容自动分析(可选)
2. **规则引擎** - 正则表达式匹配
3. **手动标记** - 用户手动指定

**使用示例**:

```javascript
// 文本分类
const classification = await window.electronAPI.invoke('compliance:classify-text', {
  text: "用户密码: 123456, 信用卡号: 1234-5678-9012-3456"
})
// classification.level: 'RESTRICTED'
// classification.reasons: ['密码', '信用卡号']

// 字段分类
await window.electronAPI.invoke('compliance:classify-field', {
  tableName: 'users',
  columnName: 'password',
  sampleData: ['hashed_pw_1', 'hashed_pw_2']
})

// 扫描数据库
const scanResult = await window.electronAPI.invoke('compliance:scan-database')
// {
//   tables: 15,
//   fields: 120,
//   classified: {
//     PUBLIC: 50,
//     INTERNAL: 40,
//     CONFIDENTIAL: 25,
//     RESTRICTED: 5
//   }
// }
```

---

### 3. GDPR 数据主体请求 (DSR)

支持 GDPR 规定的数据主体权利:

**4种 DSR 类型**:

1. **Right to Access** (访问权) - 导出个人数据
2. **Right to Erasure** (删除权) - 删除个人数据
3. **Right to Rectification** (修正权) - 修正个人数据
4. **Right to Data Portability** (可携权) - 数据可携性

**使用示例**:

```javascript
// 创建 DSR
const dsr = await window.electronAPI.invoke('compliance:dsr-create', {
  did: 'did:chainless:abc123',
  requestType: 'export',
  details: '用户请求导出所有个人数据'
})

// 导出数据
const exportData = await window.electronAPI.invoke('compliance:dsr-export-data', {
  did: 'did:chainless:abc123',
  format: 'json' // 或 'csv'
})

// 删除数据
await window.electronAPI.invoke('compliance:dsr-delete-data', {
  did: 'did:chainless:abc123',
  options: {
    cascadeDelete: true,
    keepAuditLogs: true
  }
})
```

---

### 4. 统一合规管理

**支持的合规框架**:

| 框架 | 全称 | 适用行业 | 状态 |
|------|------|---------|------|
| **GDPR** | 通用数据保护条例 | 欧盟所有行业 | ✅ |
| **SOC2** | 服务组织控制2 | SaaS/云服务 | ✅ |
| **ISO27001** | 信息安全管理 | 全行业 | 🔄 部分支持 |
| **HIPAA** | 健康保险可携性 | 医疗行业 | 🔄 规划中 |

**使用示例**:

```javascript
// 添加合规框架
await window.electronAPI.invoke('compliance:add-framework', {
  name: 'gdpr',
  config: {
    enabled: true,
    checkInterval: '0 0 * * *' // 每日午夜
  }
})

// 执行合规检查
const checkResult = await window.electronAPI.invoke('compliance:run-check', {
  framework: 'soc2'
})

// 计算风险评分
const riskScore = await window.electronAPI.invoke('compliance:calculate-risk', {
  framework: 'gdpr'
})
// { score: 75, level: 'MEDIUM', issues: 5 }

// 获取整体状态
const status = await window.electronAPI.invoke('compliance:get-status')
```

---

## 前端集成

### Pinia Store

```typescript
import { useComplianceStore } from '@/stores/compliance'

const compliance = useComplianceStore()

// 执行 SOC2 检查
await compliance.runSOC2Check()

// 扫描数据库分类
await compliance.classifyDatabase()

// 创建 DSR
await compliance.createDSR(did, 'export')
```

### 前端页面

**合规仪表板页面** (`/compliance-dashboard`)

**功能模块**:

1. **合规概览**
   - 各框架合规状态
   - 风险评分趋势
   - 待处理问题

2. **SOC2 管理**
   - 控制点检查状态
   - 证据收集管理
   - 报告生成与导出

3. **数据分类**
   - 分类统计可视化
   - 字段分类管理
   - 策略配置

4. **DSR 处理**
   - DSR 请求列表
   - 处理工作流
   - 日志追踪

---

## 配置选项

```json
{
  "compliance": {
    "enabled": true,
    "frameworks": ["soc2", "gdpr"],
    "checkInterval": "0 0 * * *",
    "evidencePath": "./data/compliance/evidence",
    "dataClassification": {
      "mlEnabled": false,
      "autoTagging": true,
      "encryptionMapping": {
        "RESTRICTED": "aes-256",
        "CONFIDENTIAL": "aes-128"
      }
    },
    "dsr": {
      "exportFormats": ["json", "csv"],
      "retentionDays": 30
    }
  }
}
```

---

## 使用场景

### 场景 1: 定期合规检查

```javascript
// 1. 调度每日检查
await window.electronAPI.invoke('compliance:schedule-check', {
  framework: 'soc2',
  cron: '0 0 * * *'
})

// 2. 执行检查
const result = await window.electronAPI.invoke('compliance:run-check', {
  framework: 'soc2'
})

// 3. 处理失败项
if (result.failed > 0) {
  result.criticalIssues.forEach(async issue => {
    await notifyAdmin(issue)
  })
}
```

### 场景 2: 数据分类审计

```javascript
// 1. 扫描整个数据库
const scanResult = await window.electronAPI.invoke('compliance:scan-database')

// 2. 检查未分类字段
const unclassified = scanResult.fields.filter(f => !f.classification)

// 3. 批量分类
for (const field of unclassified) {
  await window.electronAPI.invoke('compliance:classify-field', {
    tableName: field.table,
    columnName: field.column
  })
}
```

### 场景 3: 处理 GDPR DSR

```javascript
// 1. 接收用户请求
const dsr = await window.electronAPI.invoke('compliance:dsr-create', {
  did: userDID,
  requestType: 'export',
  details: '用户通过邮件请求导出数据'
})

// 2. 导出数据
const data = await window.electronAPI.invoke('compliance:dsr-export-data', {
  did: userDID,
  format: 'json'
})

// 3. 发送给用户
await sendEmail(userEmail, data)

// 4. 标记 DSR 完成
await window.electronAPI.invoke('compliance:dsr-update-status', {
  dsrId: dsr.id,
  status: 'completed'
})
```

---

## 安全考虑

1. **证据加密**: SOC2证据文件使用AES-256加密存储
2. **访问控制**: 合规管理仅限管理员角色
3. **审计日志**: 所有合规操作记录到audit_logs
4. **数据脱敏**: DSR导出自动脱敏敏感字段
5. **级联删除**: DSR删除确保完整性(外键约束)

---

## 相关文档

- [企业审计日志](/chainlesschain/audit)
- [权限管理](/chainlesschain/permissions)
- [SCIM 集成](/chainlesschain/scim)
- [产品路线图](/chainlesschain/product-roadmap)

## 关键文件

| 文件 | 说明 |
| --- | --- |
| `desktop-app-vue/src/main/enterprise/compliance-manager.js` | 统一合规引擎核心 |
| `desktop-app-vue/src/main/enterprise/soc2-checker.js` | SOC2 合规检查与证据收集 |
| `desktop-app-vue/src/main/enterprise/data-classifier.js` | 数据分类系统（ML+规则） |
| `desktop-app-vue/src/main/enterprise/gdpr-dsr-handler.js` | GDPR 数据主体请求处理 |
| `desktop-app-vue/src/renderer/stores/compliance.ts` | 合规管理 Pinia Store |

---

**文档版本**: 1.0.0
**最后更新**: 2026-02-27
