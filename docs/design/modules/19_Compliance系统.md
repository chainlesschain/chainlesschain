# Phase 43 — Compliance + Data Classification 系统设计

**版本**: v1.0.0
**创建日期**: 2026-02-27
**状态**: ✅ 已实现 (v1.1.0-alpha)

---

## 一、模块概述

Phase 43 引入企业级合规管理和数据分类系统,支持 SOC2、GDPR、ISO27001、HIPAA 等多种合规框架,帮助企业满足监管要求。

### 1.1 核心目标

1. **SOC2 合规**: 5大信任服务原则(TSC)自动检查和证据收集
2. **数据分类**: 4级分类体系(PUBLIC/INTERNAL/CONFIDENTIAL/RESTRICTED)
3. **GDPR DSR处理**: 数据主体请求(导出/删除/修正)自动化
4. **合规管理**: 多框架支持,统一合规检查调度

### 1.2 技术架构

```
┌──────────────────────────────────────────────────────┐
│                  Frontend UI                         │
│  ┌────────────────────────────────────────────────┐  │
│  │ ComplianceDashboardPage                        │  │
│  │ - 证据收集  - 分类管理                         │  │
│  │ - DSR处理   - 报告导出                         │  │
│  └─────────────────────┬──────────────────────────┘  │
└────────────────────────┼─────────────────────────────┘
                         │
┌────────────────────────┼─────────────────────────────┐
│                        ▼                             │
│  ┌──────────────────────────────────────────────┐   │
│  │ compliance Store                             │   │
│  │ - 检查执行  - 报告生成  - 证据管理           │   │
│  └──────────────────────┬───────────────────────┘   │
└─────────────────────────┼───────────────────────────┘
                          │
┌─────────────────────────┼───────────────────────────┐
│                         ▼                           │
│  Compliance Layer (Phase 43, 12 IPC)               │
│  ┌───────────────────────────────────────────────┐ │
│  │ SOC2 Compliance Manager                       │ │
│  │ - 5大TSC (安全/可用性/处理完整性/机密性/隐私) │ │
│  │ - 控制点检查 (50+ controls)                   │ │
│  │ - 证据自动收集                                │ │
│  └───────────────────────────────────────────────┘ │
│  ┌───────────────────────────────────────────────┐ │
│  │ Data Classifier                               │ │
│  │ - 4级分类 (PUBLIC→RESTRICTED)                 │ │
│  │ - ML分类器 (文本分析)                         │ │
│  │ - 规则引擎 (正则匹配)                         │ │
│  └───────────────────────────────────────────────┘ │
│  ┌───────────────────────────────────────────────┐ │
│  │ Classification Policy Engine                  │ │
│  │ - 字段级分类规则                              │ │
│  │ - 自动标记                                    │ │
│  │ - 加密策略映射                                │ │
│  └───────────────────────────────────────────────┘ │
│  ┌───────────────────────────────────────────────┐ │
│  │ Data Subject Request Handler (GDPR DSR)       │ │
│  │ - 数据导出 (JSON/CSV)                         │ │
│  │ - 数据删除 (级联删除)                         │ │
│  │ - 数据修正 (审计日志)                         │ │
│  └───────────────────────────────────────────────┘ │
│  ┌───────────────────────────────────────────────┐ │
│  │ Unified Compliance Manager                    │ │
│  │ - 多框架支持 (GDPR/SOC2/ISO27001/HIPAA)       │ │
│  │ - 定时检查调度                                │ │
│  │ - 风险评分                                    │ │
│  └───────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
            │
┌───────────┼─────────────────────────────────────────┐
│           ▼                                         │
│  Database (Phase 43新增2张表)                       │
│  - soc2_evidence         (SOC2证据)                 │
│  - data_classifications  (数据分类记录)             │
└─────────────────────────────────────────────────────┘
```

---

## 二、核心模块设计

### 2.1 SOC2 Compliance Manager

**文件**: `desktop-app-vue/src/main/audit/soc2-compliance.js`

**5大信任服务原则(TSC)**:
1. **CC1.0 Security** - 控制环境
2. **CC2.0 Availability** - 系统可用性
3. **CC3.0 Processing Integrity** - 处理完整性
4. **CC4.0 Confidentiality** - 机密性
5. **CC5.0 Privacy** - 隐私

**API**:
```javascript
class SOC2ComplianceManager {
  async runControlCheck(controlId) // 执行单个控制点检查
  async runAllChecks() // 执行所有检查
  async collectEvidence(controlId, evidenceType) // 收集证据
  async generateComplianceReport(startDate, endDate) // 生成合规报告
  async getControlStatus(controlId) // 获取控制点状态
}
```

### 2.2 Data Classifier

**文件**: `desktop-app-vue/src/main/audit/data-classifier.js`

**4级分类**:
- **PUBLIC**: 公开信息 (无敏感数据)
- **INTERNAL**: 内部使用 (员工可见)
- **CONFIDENTIAL**: 机密 (仅授权人员)
- **RESTRICTED**: 高度敏感 (严格控制)

**API**:
```javascript
class DataClassifier {
  async classifyText(text) // ML分类器
  async classifyField(tableName, columnName, sampleData) // 字段分类
  async scanDatabase() // 扫描数据库
  async applyClassification(tableName, columnName, level) // 应用分类
  async getClassificationReport() // 分类报告
}
```

### 2.3 Classification Policy Engine

**文件**: `desktop-app-vue/src/main/audit/classification-policy.js`

**功能**:
- 字段级分类规则 (正则表达式)
- 自动标记触发
- 加密策略映射 (RESTRICTED → AES-256)
- 访问控制集成 (RBAC)

**API**:
```javascript
class ClassificationPolicyEngine {
  async createPolicy(name, rules) // 创建策略
  async applyPolicy(policyId) // 应用策略
  async evaluateField(tableName, columnName, value) // 评估字段
  async getPolicyMatches(text) // 获取匹配策略
}
```

### 2.4 Data Subject Request Handler

**文件**: `desktop-app-vue/src/main/audit/data-subject-handler.js`

**GDPR DSR 类型**:
- **Right to Access**: 导出个人数据 (JSON/CSV)
- **Right to Erasure**: 删除个人数据 (级联删除)
- **Right to Rectification**: 修正个人数据
- **Right to Data Portability**: 数据可携性

**API**:
```javascript
class DataSubjectHandler {
  async createDSR(did, requestType, details) // 创建DSR
  async exportUserData(did, format = "json") // 导出数据
  async deleteUserData(did, options = {}) // 删除数据
  async rectifyUserData(did, corrections) // 修正数据
  async getDSRStatus(dsrId) // 获取DSR状态
}
```

### 2.5 Unified Compliance Manager

**文件**: `desktop-app-vue/src/main/audit/compliance-manager.js`

**支持框架**:
- GDPR (General Data Protection Regulation)
- SOC2 (Service Organization Control 2)
- ISO27001 (Information Security Management)
- HIPAA (Health Insurance Portability and Accountability Act)

**API**:
```javascript
class ComplianceManager {
  async addFramework(frameworkName, config) // 添加合规框架
  async scheduleCheck(frameworkName, cron) // 定时检查
  async runComplianceCheck(frameworkName) // 执行检查
  async calculateRiskScore(frameworkName) // 计算风险
  async getComplianceStatus() // 获取合规状态
}
```

---

## 三、数据库设计

### 3.1 soc2_evidence (SOC2证据)

```sql
CREATE TABLE IF NOT EXISTS soc2_evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  control_id TEXT NOT NULL, -- e.g. 'CC1.1'
  evidence_type TEXT NOT NULL, -- log/screenshot/document/config
  file_path TEXT,
  content TEXT,
  collected_at INTEGER NOT NULL,
  metadata TEXT, -- JSON
  status TEXT DEFAULT 'valid', -- valid/expired/invalid
  INDEX idx_soc2_evidence_control (control_id),
  INDEX idx_soc2_evidence_collected_at (collected_at)
);
```

### 3.2 data_classifications (数据分类记录)

```sql
CREATE TABLE IF NOT EXISTS data_classifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name TEXT NOT NULL,
  column_name TEXT,
  classification_level TEXT NOT NULL, -- PUBLIC/INTERNAL/CONFIDENTIAL/RESTRICTED
  policy_id TEXT,
  classified_by TEXT, -- auto/manual
  classified_at INTEGER NOT NULL,
  reviewed_at INTEGER,
  notes TEXT,
  INDEX idx_data_classifications_table (table_name),
  INDEX idx_data_classifications_level (classification_level),
  UNIQUE(table_name, column_name)
);
```

---

## 四、IPC 接口设计

**文件**: `desktop-app-vue/src/main/audit/compliance-ipc.js`

### 4.1 SOC2 IPC (3个)

- `compliance:soc2-run-check` - 执行SOC2检查
- `compliance:soc2-collect-evidence` - 收集证据
- `compliance:soc2-generate-report` - 生成报告

### 4.2 数据分类 IPC (4个)

- `compliance:classify-text` - 文本分类
- `compliance:classify-field` - 字段分类
- `compliance:scan-database` - 扫描数据库
- `compliance:get-classification-report` - 分类报告

### 4.3 DSR IPC (3个)

- `compliance:dsr-create` - 创建DSR
- `compliance:dsr-export-data` - 导出数据
- `compliance:dsr-delete-data` - 删除数据

### 4.4 合规管理 IPC (2个)

- `compliance:run-check` - 执行合规检查
- `compliance:get-status` - 获取合规状态

---

## 五、前端集成

### 5.1 Pinia Store

**文件**: `desktop-app-vue/src/renderer/stores/compliance.ts`

```typescript
export const useComplianceStore = defineStore('compliance', {
  state: () => ({
    soc2Evidence: [] as SOC2Evidence[],
    classifications: [] as DataClassification[],
    dsrRequests: [] as DSRRequest[],
    complianceStatus: {} as ComplianceStatus,
    isChecking: false
  }),

  actions: {
    async runSOC2Check() {
      this.isChecking = true
      try {
        const result = await (window as any).electronAPI.invoke(
          'compliance:soc2-run-check'
        )
        return result
      } finally {
        this.isChecking = false
      }
    },

    async classifyDatabase() {
      const result = await (window as any).electronAPI.invoke(
        'compliance:scan-database'
      )
      this.classifications = result
      return result
    },

    async createDSR(did: string, requestType: string) {
      const result = await (window as any).electronAPI.invoke(
        'compliance:dsr-create',
        { did, requestType }
      )
      this.dsrRequests.unshift(result)
      return result
    }
  }
})
```

### 5.2 前端页面

**ComplianceDashboardPage.vue** (`/compliance-dashboard`)

**功能**:
- SOC2 合规状态仪表板
- 证据收集管理
- 数据分类可视化
- DSR 请求处理
- 合规报告导出

---

## 六、配置选项

```javascript
compliance: {
  enabled: true,
  frameworks: ['soc2', 'gdpr'],
  checkInterval: '0 0 * * *', // 每天午夜
  evidencePath: './data/compliance/evidence',
  dataClassification: {
    mlEnabled: false, // ML分类器(需要训练)
    autoTagging: true,
    encryptionMapping: {
      RESTRICTED: 'aes-256',
      CONFIDENTIAL: 'aes-128'
    }
  },
  dsr: {
    exportFormats: ['json', 'csv'],
    retentionDays: 30
  }
}
```

---

## 七、安全考虑

1. **证据加密**: SOC2证据文件使用AES-256加密存储
2. **访问控制**: 合规管理仅限管理员角色
3. **审计日志**: 所有合规操作记录到audit_logs
4. **数据脱敏**: DSR导出自动脱敏敏感字段
5. **级联删除**: DSR删除确保完整性 (外键约束)

---

## 八、测试覆盖

- ✅ `soc2-compliance.test.js` - SOC2检查
- ✅ `data-classifier.test.js` - 数据分类
- ✅ `classification-policy.test.js` - 策略引擎
- ✅ `data-subject-handler.test.js` - DSR处理
- ✅ `compliance-manager.test.js` - 合规管理

---

**文档版本**: 1.0.0
**最后更新**: 2026-02-27
