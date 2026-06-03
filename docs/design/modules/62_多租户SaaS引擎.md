# Phase 97 — 多租户SaaS引擎设计

**版本**: v4.5.0
**创建日期**: 2026-03-10
**状态**: ✅ 已实现 · ✅ CLI Phase 97 登陆 2026-04-16 (`cc tenant plans|metrics|create|configure|list|show|delete|record|usage|subscribe|subscription|cancel|subscriptions|check-quota|stats|export|import`, 租户 CRUD + 订阅切换 + 用量计量 + 四档计划配额校验 + JSON 快照导入导出, `packages/cli/src/lib/tenant-saas.js`, 77 tests; 物理隔离数据库 (`db_path`)、子域名路由、支付网关集成和租户管理面板仍为 Desktop-only)

---

## 一、模块概述

Phase 97 实现多租户SaaS引擎，提供完整的租户隔离、用量计量、订阅计费（Free/Starter/Pro/Enterprise四档）和数据导入导出能力，支撑ChainlessChain作为SaaS平台的商业化运营。

### 1.1 核心目标

1. **租户隔离**: 数据库级别租户隔离，确保数据安全和访问边界
2. **用量计量**: 实时追踪API调用、存储空间、AI额度等资源使用
3. **订阅计费**: 四档订阅计划（Free/Starter/Pro/Enterprise），支持升降级
4. **数据迁移**: 租户数据完整导出和导入，支持跨实例迁移

### 1.2 技术架构

```
┌───────────────────────────────────────────────────────┐
│              Multi-Tenant SaaS Engine                   │
│                                                        │
│  ┌──────────────────┐  ┌───────────────────────────┐  │
│  │  Tenant Manager   │  │  Subscription Manager      │  │
│  │  创建/配置/删除   │  │  Free/Starter/Pro/Ent     │  │
│  │  数据库级隔离     │  │  升降级+续费+过期处理     │  │
│  └──────────────────┘  └───────────────────────────┘  │
│  ┌──────────────────┐  ┌───────────────────────────┐  │
│  │  Metering Engine  │  │  Data Migration            │  │
│  │  API调用计量      │  │  全量导出（JSON/SQL）      │  │
│  │  存储空间追踪     │  │  增量导入+冲突解决         │  │
│  │  AI额度管控       │  │  跨实例迁移工具            │  │
│  └──────────────────┘  └───────────────────────────┘  │
│  ┌────────────────────────────────────────────────────┐│
│  │              Tenant Dashboard                        ││
│  │  用量图表 → 账单明细 → 配额告警 → 管理操作         ││
│  └────────────────────────────────────────────────────┘│
└───────────────────────────────────────────────────────┘
```

---

## 二、核心模块设计

### 2.1 TenantManager (`enterprise/saas/tenant-manager.js`)

多租户管理核心，负责租户生命周期、计量和订阅。

**核心方法**:

- `createTenant(config)` — 创建租户（初始化隔离数据库、配置配额）
- `configure(tenantId, settings)` — 更新租户配置（功能开关、自定义域名、品牌）
- `getUsage(tenantId, period)` — 获取租户资源使用详情（API/存储/AI额度）
- `manageSubscription(tenantId, action)` — 管理订阅（升级/降级/续费/取消）
- `exportData(tenantId, options)` — 导出租户全量数据（JSON/SQL格式）
- `importData(tenantId, data)` — 导入数据到租户（增量合并+冲突解决）
- `getTenants(filters)` — 获取租户列表（支持状态/计划/创建时间过滤）
- `deleteTenant(tenantId, confirm)` — 删除租户（需二次确认，数据保留30天）

### 2.2 订阅计划

| 计划       | 月费 | API调用/月 | 存储空间 | AI额度/月 | 特性                  |
| ---------- | ---- | ---------- | -------- | --------- | --------------------- |
| Free       | ¥0   | 1,000      | 100MB    | 50次      | 基础功能              |
| Starter    | ¥99  | 10,000     | 1GB      | 500次     | + 协作(5人)           |
| Pro        | ¥399 | 100,000    | 10GB     | 5,000次   | + 高级分析+自定义域名 |
| Enterprise | 定制 | 不限       | 不限     | 不限      | + SSO+SLA+专属支持    |

---

## 三、核心文件

| 文件                                         | 说明                             |
| -------------------------------------------- | -------------------------------- |
| `src/main/enterprise/saas/tenant-manager.js` | 多租户管理引擎（租户/计量/订阅） |
| `src/main/enterprise/saas/saas-ipc.js`       | IPC Handler注册（8个通道）       |

---

## 四、IPC Handlers

| Channel                    | 说明                            |
| -------------------------- | ------------------------------- |
| `saas:create-tenant`       | 创建租户（初始化隔离环境）      |
| `saas:configure`           | 更新租户配置（功能开关、品牌）  |
| `saas:get-usage`           | 获取资源使用详情（API/存储/AI） |
| `saas:manage-subscription` | 管理订阅（升级/降级/续费/取消） |
| `saas:export-data`         | 导出租户全量数据                |
| `saas:import-data`         | 导入数据到租户                  |
| `saas:get-tenants`         | 获取租户列表（支持过滤）        |
| `saas:delete-tenant`       | 删除租户（二次确认）            |

---

## 五、数据库表

### 5.1 `saas_tenants` — 租户表

```sql
CREATE TABLE IF NOT EXISTS saas_tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE,           -- 租户标识（用于子域名/路由）
  config TEXT,                -- JSON: 功能开关、品牌配置、自定义域名
  status TEXT DEFAULT 'active', -- active | suspended | deleted
  plan TEXT DEFAULT 'free',   -- free | starter | pro | enterprise
  db_path TEXT,               -- 隔离数据库文件路径
  owner_id TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  deleted_at DATETIME         -- 软删除时间戳（保留30天）
);
CREATE INDEX IF NOT EXISTS idx_saas_tenants_slug ON saas_tenants(slug);
CREATE INDEX IF NOT EXISTS idx_saas_tenants_status ON saas_tenants(status);
```

### 5.2 `saas_usage` — 用量记录表

```sql
CREATE TABLE IF NOT EXISTS saas_usage (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  metric TEXT NOT NULL,        -- api_calls | storage_bytes | ai_requests
  value REAL NOT NULL,
  period TEXT NOT NULL,        -- 月份标识，如 '2026-03'
  recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES saas_tenants(id)
);
CREATE INDEX IF NOT EXISTS idx_saas_usage_tenant ON saas_usage(tenant_id, period);
CREATE INDEX IF NOT EXISTS idx_saas_usage_metric ON saas_usage(metric, period);
```

### 5.3 `saas_subscriptions` — 订阅记录表

```sql
CREATE TABLE IF NOT EXISTS saas_subscriptions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  plan TEXT NOT NULL,          -- free | starter | pro | enterprise
  status TEXT DEFAULT 'active', -- active | cancelled | expired | past_due
  started_at DATETIME NOT NULL,
  expires_at DATETIME,
  cancelled_at DATETIME,
  payment_method TEXT,         -- JSON: 支付方式信息
  amount REAL,                 -- 月费金额
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES saas_tenants(id)
);
CREATE INDEX IF NOT EXISTS idx_saas_sub_tenant ON saas_subscriptions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_saas_sub_status ON saas_subscriptions(status);
```

---

## 六、测试覆盖

| 测试文件                                                    | 测试数量 | 状态        |
| ----------------------------------------------------------- | -------- | ----------- |
| `src/main/enterprise/saas/__tests__/tenant-manager.test.js` | 23       | ✅ 通过     |
| **合计**                                                    | **23**   | ✅ 全部通过 |

### 测试要点

- 租户创建、配置、删除完整生命周期
- 数据库级隔离验证（跨租户数据不可见）
- 用量计量准确性（API调用、存储、AI额度）
- 四档订阅计划升降级和配额变更
- 配额超限告警和服务降级处理
- 数据导出完整性和导入冲突解决
- 软删除和30天保留期验证
