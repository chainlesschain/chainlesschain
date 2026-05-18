# 多租户 SaaS 引擎

> **Phase 97 | v4.5.0 | 状态: ✅ 生产就绪 | 8 IPC Handlers | 3 数据库表**

ChainlessChain 多租户 SaaS 引擎提供完整的租户隔离、配置管理、用量计量与订阅计费能力，支持从免费版到企业版的四级订阅模型。通过数据库级与应用级双重隔离保障租户数据安全，并提供自定义域名、SSO 集成和数据迁移等企业级功能。

## 概述

多租户 SaaS 引擎为 ChainlessChain 提供企业级租户管理能力，支持数据库级/Schema 级/行级三种隔离模式和 Free/Starter/Pro/Enterprise 四级订阅计划。系统通过 8 个 IPC 接口和 3 张数据表实现租户 CRUD、配置管理、API 调用/存储/用户数自动计量、订阅计费（Stripe/支付宝）以及数据导入导出与迁移。

## 核心特性

- 🏢 **双重租户隔离**: 数据库级隔离（独立 Schema / 独立库）+ 应用级隔离（行级策略 + 中间件拦截），彻底杜绝数据泄漏
- ⚙️ **租户配置中心**: 自定义域名绑定、品牌定制（Logo/主题色）、功能开关、资源配额，每个租户独立配置
- 💰 **用量计量与订阅计费**: Free / Starter / Pro / Enterprise 四级订阅，按 API 调用量、存储、用户数自动计量，支持 Stripe/支付宝对接
- 🔐 **租户级 RBAC + SSO**: 每个租户独立的角色权限体系，支持 SAML/OIDC SSO 集成
- 📦 **数据导入/导出与迁移**: 批量数据导入导出，支持跨租户迁移与版本升级时的数据兼容

## 系统架构

```
┌──────────────────────────────────────────────────┐
│              前端 (Vue3 SaaS 管理控制台)           │
│  ┌──────────┐  ┌──────────┐  ┌────────────────┐ │
│  │ 租户管理  │  │ 订阅管理  │  │ 用量仪表盘    │ │
│  └─────┬────┘  └─────┬────┘  └───────┬────────┘ │
└────────┼─────────────┼───────────────┼───────────┘
         │             │               │
         ▼             ▼               ▼
┌──────────────────────────────────────────────────┐
│              IPC 通道 (saas:*)                    │
└──────────────────────┬───────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────┐
│           多租户 SaaS 引擎 (Main Process)         │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐ │
│  │ 租户管理器  │  │ 隔离引擎   │  │ 计量引擎   │ │
│  └────────────┘  └────────────┘  └────────────┘ │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐ │
│  │ 订阅管理器  │  │ 数据迁移   │  │ SSO 集成   │ │
│  └────────────┘  └────────────┘  └────────────┘ │
└──────────────────────┬───────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────┐
│  SQLite (saas_tenants / saas_usage / saas_subs)  │
└──────────────────────────────────────────────────┘
```

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

## 关键文件

| 文件 | 职责 |
| --- | --- |
| `src/main/enterprise/multi-tenant-saas.js` | SaaS 引擎核心，租户 CRUD 与隔离逻辑 |
| `src/main/enterprise/tenant-isolation.js` | 数据库级/Schema 级/行级隔离实现 |
| `src/main/enterprise/usage-metering.js` | API 调用/存储/用户数计量引擎 |
| `src/main/enterprise/subscription-manager.js` | 订阅计划管理与计费集成 |
| `src/renderer/stores/saas.ts` | Pinia 状态管理 |

## 故障排查

| 问题 | 原因分析 | 解决方案 |
|------|---------|---------|
| 租户创建失败 | `slug` 重复或管理员邮箱格式错误 | 检查 `slug` 唯一性（`TEXT UQ` 约束），确认邮箱格式正确 |
| 数据隔离泄漏 | 行级隔离模式下中间件拦截未生效 | 切换到 `database` 或 `schema` 隔离模式；检查查询是否绑定 `tenant_id` 过滤条件 |
| 用量统计不准确 | 计量引擎采集周期未对齐或数据库写入延迟 | 确认 `period` 参数格式为 `YYYY-MM`，等待当前采集周期结束后重新查询 |
| 订阅升级后配额未更新 | 订阅状态变更但配额配置未同步刷新 | 调用 `saas:configure` 手动刷新配额，或重启租户隔离引擎 |
| SSO 登录失败 | OIDC/SAML 配置的 `issuerUrl` 不可达或 `clientId` 不匹配 | 验证 SSO 提供商的 URL 可访问，确认 Client ID 和 Secret 正确 |
| 数据导入冲突多 | 使用 `replace` 策略导致已有数据被覆盖 | 先使用 `dryRun: true` 预检，确认冲突数量可接受后再执行；优先使用 `merge` 策略 |
| 租户删除后数据恢复 | 未启用 `retainBackup` 导致数据永久丢失 | 删除时务必设置 `retainBackup: true`，在 `retainDays` 内可从备份恢复 |

## 配置参考

完整的多租户 SaaS 引擎配置项（`.chainlesschain/config.json`）：

```javascript
// 多租户 SaaS 完整配置参考
const multiTenantConfig = {
  multiTenantSaas: {
    enabled: true,

    // 隔离模式: "database" | "schema" | "row"
    defaultIsolation: "schema",

    // 默认订阅计划
    defaultPlan: "free",

    // 四级订阅配额定义
    plans: {
      free:       { maxUsers: 3,   maxApiCalls: 1000,   maxStorageMB: 100   },
      starter:    { maxUsers: 10,  maxApiCalls: 10000,  maxStorageMB: 1024  },
      pro:        { maxUsers: 50,  maxApiCalls: 100000, maxStorageMB: 10240 },
      enterprise: { maxUsers: -1,  maxApiCalls: -1,     maxStorageMB: -1    },
    },

    // 计量引擎配置
    metering: {
      samplingIntervalMs: 60000,   // 用量采集间隔（毫秒）
      quotaWarningThresholds: [80, 90, 100],  // 触发 Webhook 通知的百分比阈值
      overageAction: "throttle",   // "throttle" | "block" | "notify-only"
    },

    // 计费集成
    billing: {
      provider: "stripe",          // "stripe" | "alipay" | "manual"
      currency: "CNY",
      webhookSecret: "${BILLING_WEBHOOK_SECRET}",
      invoiceEmailEnabled: true,
    },

    // SSO 全局默认（租户级可覆盖）
    sso: {
      supportedProviders: ["oidc", "saml"],
      sessionTtlSeconds: 28800,    // 8 小时
    },

    // 数据保留策略
    dataRetention: {
      deletedTenantBackupDays: 30,
      usageRecordRetentionDays: 365,
    },
  },
};
```

---

## 性能指标

| 操作 | 目标 | 实际 | 状态 |
| ---- | ---- | ---- | ---- |
| 创建租户（`saas:create-tenant`） | < 500 ms | 210 ms | ✅ 达标 |
| 租户列表查询（20 条） | < 100 ms | 38 ms | ✅ 达标 |
| 用量统计查询（单租户单月） | < 200 ms | 65 ms | ✅ 达标 |
| 配额校验中间件拦截 | < 10 ms | 3 ms | ✅ 达标 |
| 数据导出（100 MB JSON） | < 30 s | 12 s | ✅ 达标 |
| 数据导入（10,000 条记录） | < 60 s | 45 s | ✅ 达标 |
| 订阅升级（`saas:manage-subscription`） | < 1 s | 320 ms | ✅ 达标 |
| 并发租户写操作（10 租户同时写） | WAL 无锁竞争 | SQLITE_BUSY = 0 | ✅ 达标 |
| Schema 级隔离切换开销 | < 5 ms | 2 ms | ✅ 达标 |
| 计量引擎定时采集（每分钟） | CPU < 2% | 0.8% | ✅ 达标 |

---

## 测试覆盖率

| 测试文件 | 覆盖场景 |
| -------- | -------- |
| ✅ `tests/unit/enterprise/multi-tenant-saas.test.js` | 租户 CRUD、plan 枚举校验、slug 唯一性约束、隔离模式切换 |
| ✅ `tests/unit/enterprise/tenant-isolation.test.js` | database/schema/row 三种隔离模式、跨租户访问拒绝、中间件拦截 |
| ✅ `tests/unit/enterprise/usage-metering.test.js` | API 调用/存储/用户数计量、配额预警阈值（80/90/100%）、超额限流 |
| ✅ `tests/unit/enterprise/subscription-manager.test.js` | 订阅升级/降级/取消、Stripe Webhook 处理、计费周期计算 |
| ✅ `tests/unit/enterprise/tenant-sso.test.js` | OIDC/SAML 配置校验、Token 验证、SSO 会话管理 |
| ✅ `tests/unit/enterprise/tenant-data-migration.test.js` | merge/replace/append 策略、dryRun 预检、冲突计数、大批量导入性能 |
| ✅ `tests/integration/saas-ipc-handlers.test.js` | 8 个 IPC 通道端到端调用、错误码验证、权限边界 |
| ✅ `tests/unit/enterprise/saas-billing-webhook.test.js` | Webhook 签名验证、超额事件处理、`webhookSecret` 加密存储 |

---

## 安全考虑

### 租户隔离
- **数据库级隔离**: 企业版建议使用 `database` 隔离模式，每个租户独立数据库实例，物理隔离杜绝跨租户数据泄漏
- **行级策略**: 使用 `row` 隔离模式时，所有数据库查询自动注入 `tenant_id` 过滤条件，中间件层进行二次校验
- **跨租户访问禁止**: 系统严格禁止跨租户数据访问，即使管理员也需要通过专用管理接口操作

### 认证与授权
- **租户级 RBAC**: 每个租户拥有独立的角色权限体系，角色定义和权限分配互不影响
- **SSO 安全**: OIDC/SAML SSO 集成使用标准安全协议，Token 验证在服务端完成，不在前端暴露敏感信息
- **管理员权限**: 租户管理员仅能管理本租户资源，平台超级管理员操作记录完整审计日志

### 计费安全
- **计量防篡改**: 用量计量数据由服务端引擎自动采集，租户无法修改自身用量记录
- **支付安全**: 计费集成 Stripe/支付宝等第三方支付平台，敏感支付信息不经过本系统，`webhookSecret` 加密存储
- **超额保护**: 达到配额上限时系统自动限流（而非直接停服），给予租户缓冲时间升级或优化用量

### 数据安全
- **导出加密**: 数据导出支持 `encryption: true`，使用 AES-256 加密导出文件，防止传输过程中数据泄露
- **删除保留**: 租户删除后数据保留 `retainDays`（默认 30 天）后永久删除，满足合规要求
- **备份隔离**: 租户备份数据独立存储，不同租户的备份文件相互隔离

## 使用示例

### 完整租户生命周期

```bash
# 1. 创建租户（Pro 计划，数据库级隔离）
# IPC: saas:create-tenant { name: "Acme Corp", slug: "acme", plan: "pro", isolation: "database" }

# 2. 查询当月用量
# IPC: saas:get-usage { tenantId: "tenant-001", period: "2026-03" }
# → apiCalls: 45200/100000, storage: 3.2GB/10GB, users: 28/50

# 3. 用量接近上限时升级订阅
# IPC: saas:manage-subscription { tenantId: "tenant-001", action: "upgrade", newPlan: "enterprise" }

# 4. 导出租户数据用于审计
# IPC: saas:export-data { tenantId: "tenant-001", format: "json", encryption: true }
```

### 用量计量与计费要点

- **用量周期**: `period` 格式为 `YYYY-MM`，每月 1 日自动重置 API 调用计数
- **超额处理**: 达到配额上限时系统自动限流（非停服），`overage` 字段显示超额费用
- **计费触发**: 订阅升级立即生效，降级在当前计费周期结束后生效，避免重复收费
- **Webhook 通知**: 用量达到 80%/90%/100% 时系统通过 Webhook 通知租户管理员

### 租户配置最佳实践

| 场景 | 推荐配置 |
|------|---------|
| 小团队试用 | `plan: "free"`, `isolation: "row"`, 功能按需开启 |
| 中型企业 | `plan: "pro"`, `isolation: "schema"`, 启用 SSO |
| 大型企业/合规要求 | `plan: "enterprise"`, `isolation: "database"`, 启用全部审计 |

## 相关文档

- [工作流自动化引擎](/chainlesschain/workflow-automation)
- [审计与合规](/chainlesschain/audit)
- [权限管理](/chainlesschain/compliance)
