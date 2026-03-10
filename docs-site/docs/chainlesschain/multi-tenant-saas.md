# 多租户 SaaS 引擎

> **Phase 97 | v4.5.0 | 状态: ✅ 生产就绪 | 8 IPC Handlers | 3 数据库表**

ChainlessChain 多租户 SaaS 引擎提供完整的租户隔离、配置管理、用量计量与订阅计费能力，支持从免费版到企业版的四级订阅模型。通过数据库级与应用级双重隔离保障租户数据安全，并提供自定义域名、SSO 集成和数据迁移等企业级功能。

## 核心特性

- 🏢 **双重租户隔离**: 数据库级隔离（独立 Schema / 独立库）+ 应用级隔离（行级策略 + 中间件拦截），彻底杜绝数据泄漏
- ⚙️ **租户配置中心**: 自定义域名绑定、品牌定制（Logo/主题色）、功能开关、资源配额，每个租户独立配置
- 💰 **用量计量与订阅计费**: Free / Starter / Pro / Enterprise 四级订阅，按 API 调用量、存储、用户数自动计量，支持 Stripe/支付宝对接
- 🔐 **租户级 RBAC + SSO**: 每个租户独立的角色权限体系，支持 SAML/OIDC SSO 集成
- 📦 **数据导入/导出与迁移**: 批量数据导入导出，支持跨租户迁移与版本升级时的数据兼容

---

## 订阅层级

| 层级           | 用户数上限 | API 调用/月 | 存储空间 | 价格     |
| -------------- | ---------- | ----------- | -------- | -------- |
| **Free**       | 3          | 1,000       | 100 MB   | 免费     |
| **Starter**    | 10         | 10,000      | 1 GB     | ¥99/月   |
| **Pro**        | 50         | 100,000     | 10 GB    | ¥499/月  |
| **Enterprise** | 不限       | 不限        | 不限     | 定制报价 |

---

## 创建租户

```javascript
const tenant = await window.electron.ipcRenderer.invoke("saas:create-tenant", {
  name: "Acme Corporation",
  slug: "acme-corp",
  plan: "pro",
  admin: {
    email: "admin@acme.com",
    name: "张管理员",
  },
  config: {
    customDomain: "app.acme.com",
    branding: {
      logo: "https://acme.com/logo.png",
      primaryColor: "#1890ff",
      appName: "Acme AI Platform",
    },
    isolation: "database", // "database" | "schema" | "row"
  },
});
// tenant = { id: "tenant-001", name: "Acme Corporation", slug: "acme-corp", plan: "pro", status: "active", ... }
```

## 租户配置

```javascript
// 更新租户配置：功能开关 + 资源配额
const config = await window.electron.ipcRenderer.invoke("saas:configure", {
  tenantId: "tenant-001",
  settings: {
    features: {
      aiEngine: true,
      collaboration: true,
      marketplace: false,
      customPlugins: true,
    },
    quotas: {
      maxUsers: 50,
      maxStorageMB: 10240,
      maxApiCallsPerMonth: 100000,
    },
    sso: {
      enabled: true,
      provider: "oidc",
      issuerUrl: "https://auth.acme.com",
      clientId: "chainlesschain-app",
    },
  },
});
```

## 用量查询

```javascript
const usage = await window.electron.ipcRenderer.invoke("saas:get-usage", {
  tenantId: "tenant-001",
  period: "2026-03",
});
// usage = {
//   tenantId: "tenant-001",
//   period: "2026-03",
//   apiCalls: { used: 45200, limit: 100000, percentage: 45.2 },
//   storage: { usedMB: 3200, limitMB: 10240, percentage: 31.25 },
//   users: { active: 28, limit: 50, percentage: 56 },
//   billing: { currentCharge: 499, overage: 0, currency: "CNY" }
// }
```

## 订阅管理

```javascript
// 升级订阅计划
const subscription = await window.electron.ipcRenderer.invoke(
  "saas:manage-subscription",
  {
    tenantId: "tenant-001",
    action: "upgrade",
    newPlan: "enterprise",
    billingCycle: "annual",
    paymentMethod: "invoice",
  },
);
// subscription = { tenantId: "tenant-001", plan: "enterprise", status: "active", nextBillingDate: "2027-03-01", ... }
```

## 数据导出

```javascript
const exportResult = await window.electron.ipcRenderer.invoke(
  "saas:export-data",
  {
    tenantId: "tenant-001",
    format: "json",
    scope: ["notes", "conversations", "knowledge-base"],
    encryption: true,
  },
);
// exportResult = { exportId: "exp-001", status: "completed", fileUrl: "/exports/tenant-001-20260310.enc.json", sizeMB: 156 }
```

## 数据导入

```javascript
const importResult = await window.electron.ipcRenderer.invoke(
  "saas:import-data",
  {
    tenantId: "tenant-002",
    source: "/imports/migration-data.json",
    strategy: "merge", // "merge" | "replace" | "append"
    dryRun: false,
  },
);
// importResult = { importId: "imp-001", status: "completed", recordsImported: 12500, conflicts: 3, duration: 45000 }
```

## 租户列表

```javascript
const tenants = await window.electron.ipcRenderer.invoke("saas:get-tenants", {
  filter: { plan: "pro", status: "active" },
  page: 1,
  pageSize: 20,
});
// tenants = {
//   items: [{ id: "tenant-001", name: "Acme Corporation", plan: "pro", status: "active", usersCount: 28, ... }],
//   total: 45,
//   page: 1,
//   pageSize: 20
// }
```

## 删除租户

```javascript
const result = await window.electron.ipcRenderer.invoke("saas:delete-tenant", {
  tenantId: "tenant-003",
  confirm: true,
  retainBackup: true,
  retainDays: 30,
});
// result = { success: true, tenantId: "tenant-003", backupId: "bak-003", backupExpiresAt: "2026-04-09" }
```

---

## IPC 通道

| 通道                       | 参数                                         | 返回值   |
| -------------------------- | -------------------------------------------- | -------- |
| `saas:create-tenant`       | `{ name, slug, plan, admin, config? }`       | 租户对象 |
| `saas:configure`           | `{ tenantId, settings }`                     | 配置结果 |
| `saas:get-usage`           | `{ tenantId, period? }`                      | 用量统计 |
| `saas:manage-subscription` | `{ tenantId, action, newPlan?, ... }`        | 订阅信息 |
| `saas:export-data`         | `{ tenantId, format?, scope?, encryption? }` | 导出结果 |
| `saas:import-data`         | `{ tenantId, source, strategy?, dryRun? }`   | 导入结果 |
| `saas:get-tenants`         | `{ filter?, page?, pageSize? }`              | 租户列表 |
| `saas:delete-tenant`       | `{ tenantId, confirm, retainBackup? }`       | 删除结果 |

---

## 数据库表

### saas_tenants

| 字段           | 类型    | 说明                           |
| -------------- | ------- | ------------------------------ |
| id             | TEXT PK | 租户 ID                        |
| name           | TEXT    | 租户名称                       |
| slug           | TEXT UQ | URL 友好标识                   |
| plan           | TEXT    | free/starter/pro/enterprise    |
| status         | TEXT    | active/suspended/deleted       |
| config         | JSON    | 租户配置（域名/品牌/功能开关） |
| isolation_mode | TEXT    | database/schema/row            |
| admin_email    | TEXT    | 管理员邮箱                     |
| created_at     | INTEGER | 创建时间戳                     |
| updated_at     | INTEGER | 更新时间戳                     |

### saas_usage_records

| 字段           | 类型    | 说明                |
| -------------- | ------- | ------------------- |
| id             | TEXT PK | 记录 ID             |
| tenant_id      | TEXT FK | 关联租户 ID         |
| period         | TEXT    | 计量周期（YYYY-MM） |
| api_calls      | INTEGER | API 调用次数        |
| storage_mb     | REAL    | 存储用量（MB）      |
| active_users   | INTEGER | 活跃用户数          |
| overage_charge | REAL    | 超额费用            |
| recorded_at    | INTEGER | 记录时间戳          |

### saas_subscriptions

| 字段              | 类型    | 说明                      |
| ----------------- | ------- | ------------------------- |
| id                | TEXT PK | 订阅 ID                   |
| tenant_id         | TEXT FK | 关联租户 ID               |
| plan              | TEXT    | 订阅计划                  |
| billing_cycle     | TEXT    | monthly/annual            |
| status            | TEXT    | active/cancelled/past_due |
| current_charge    | REAL    | 当前费用                  |
| payment_method    | TEXT    | 支付方式                  |
| next_billing_date | TEXT    | 下次计费日期              |
| created_at        | INTEGER | 创建时间戳                |
| updated_at        | INTEGER | 更新时间戳                |

---

## 配置

在 `.chainlesschain/config.json` 中配置：

```json
{
  "multiTenantSaas": {
    "enabled": true,
    "defaultIsolation": "schema",
    "defaultPlan": "free",
    "plans": {
      "free": { "maxUsers": 3, "maxApiCalls": 1000, "maxStorageMB": 100 },
      "starter": { "maxUsers": 10, "maxApiCalls": 10000, "maxStorageMB": 1024 },
      "pro": { "maxUsers": 50, "maxApiCalls": 100000, "maxStorageMB": 10240 },
      "enterprise": { "maxUsers": -1, "maxApiCalls": -1, "maxStorageMB": -1 }
    },
    "billing": {
      "provider": "stripe",
      "currency": "CNY",
      "webhookSecret": "${BILLING_WEBHOOK_SECRET}"
    },
    "dataRetention": {
      "deletedTenantBackupDays": 30
    }
  }
}
```

---

## 相关链接

- [工作流自动化引擎](/chainlesschain/workflow-automation)
- [审计与合规](/chainlesschain/audit)
- [权限管理](/chainlesschain/compliance)
