# Phase 87 — Agent安全沙箱2.0设计

**版本**: v4.1.0
**创建日期**: 2026-03-10
**状态**: ✅ 已实现 (v4.1.0)

---

## 一、模块概述

Phase 87 实现Agent安全沙箱2.0，提供完整的沙箱生命周期管理、权限白名单（文件系统/网络/系统调用）、配额管理、审计日志和行为监控（风险评分），确保Agent在受控环境中安全执行。

### 1.1 核心目标

1. **沙箱生命周期**: 创建 → 初始化 → 运行 → 暂停 → 销毁全流程管理
2. **权限白名单**: 细粒度文件系统/网络/系统调用权限控制
3. **配额管理**: CPU/内存/磁盘/网络带宽配额限制和动态调整
4. **审计日志**: 所有沙箱操作的完整审计追踪
5. **行为监控**: 实时行为分析和风险评分，异常自动隔离

### 1.2 技术架构

```
┌──────────────────────────────────────────────────┐
│           Agent Sandbox 2.0 System               │
│                                                  │
│  ┌───────────────────┐  ┌──────────────────────┐ │
│  │ SandboxLifecycle  │  │ PermissionManager    │ │
│  │ 创建/运行/销毁    │  │ 文件系统白名单       │ │
│  │ 状态机+资源回收   │  │ 网络+系统调用控制    │ │
│  └───────────────────┘  └──────────────────────┘ │
│  ┌───────────────────┐  ┌──────────────────────┐ │
│  │ QuotaManager      │  │ AuditLogger          │ │
│  │ CPU/内存/磁盘     │  │ 操作追踪+合规报告    │ │
│  │ 网络带宽+动态调整 │  │ 防篡改+时间戳签名    │ │
│  └───────────────────┘  └──────────────────────┘ │
│  ┌──────────────────────────────────────────────┐ │
│  │ BehaviorMonitor — 实时分析+风险评分+自动隔离 │ │
│  └──────────────────────────────────────────────┘ │
│  ┌──────────────────────────────────────────────┐ │
│  │      Sandbox V2 IPC Layer (6 handlers)       │ │
│  └──────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────┘
```

---

## 二、核心模块设计

### 2.1 AgentSandboxV2 (`ai-engine/sandbox/agent-sandbox-v2.js`)

Agent安全沙箱2.0主模块。

**常量**:

- `SANDBOX_STATUS`: CREATING, READY, RUNNING, PAUSED, TERMINATED, ERROR
- `PERMISSION_TYPE`: FILESYSTEM, NETWORK, SYSCALL, IPC, PROCESS
- `RISK_LEVEL`: SAFE, LOW, MEDIUM, HIGH, CRITICAL
- `QUOTA_TYPE`: CPU_PERCENT, MEMORY_MB, DISK_MB, NETWORK_KBPS, PROCESS_COUNT

**核心方法**:

- `initialize(deps)` — 初始化沙箱系统，加载默认策略
- `create({ agentId, permissions, quotas, config })` — 创建沙箱实例
- `execute({ sandboxId, code, language, timeout })` — 在沙箱中执行代码
- `setPermissions({ sandboxId, permissions })` — 设置权限白名单
- `getAuditLog({ sandboxId, timeRange, eventTypes })` — 获取审计日志
- `setQuota({ sandboxId, quotaType, limit })` — 设置/调整配额
- `monitorBehavior(sandboxId)` — 获取行为监控报告和风险评分
- `_enforcePermissions(sandboxId, operation)` — 运行时权限检查
- `_checkQuota(sandboxId, resourceType, amount)` — 配额检查
- `_calculateRiskScore(sandboxId)` — 计算综合风险评分
- `_isolateSandbox(sandboxId, reason)` — 高风险自动隔离
- `_logAuditEvent({ sandboxId, eventType, details })` — 记录审计事件
- `_cleanupSandbox(sandboxId)` — 清理沙箱资源
- `destroy()` — 销毁所有沙箱，清理资源

### 2.2 SandboxV2IPC (`ai-engine/sandbox/sandbox-v2-ipc.js`)

IPC通道注册和参数校验。

---

## 三、数据库设计

```sql
-- Phase 87: Agent Sandbox 2.0
CREATE TABLE IF NOT EXISTS agent_sandboxes (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  status TEXT DEFAULT 'creating',
  permissions TEXT,              -- JSON: filesystem/network/syscall whitelist
  quotas TEXT,                   -- JSON: { cpu, memory, disk, network }
  config TEXT,                   -- JSON: timeout, isolation level
  risk_score REAL DEFAULT 0.0,
  created_at INTEGER,
  updated_at INTEGER,
  terminated_at INTEGER
);

CREATE TABLE IF NOT EXISTS sandbox_audit_log (
  id TEXT PRIMARY KEY,
  sandbox_id TEXT NOT NULL,
  event_type TEXT NOT NULL,      -- execute, permission_check, quota_check, isolate
  operation TEXT,
  result TEXT,                   -- allowed, denied, exceeded
  details TEXT,                  -- JSON: operation details
  risk_contribution REAL DEFAULT 0.0,
  timestamp INTEGER NOT NULL,
  FOREIGN KEY (sandbox_id) REFERENCES agent_sandboxes(id)
);

CREATE TABLE IF NOT EXISTS sandbox_quota_usage (
  id TEXT PRIMARY KEY,
  sandbox_id TEXT NOT NULL,
  quota_type TEXT NOT NULL,
  current_usage REAL DEFAULT 0.0,
  quota_limit REAL NOT NULL,
  peak_usage REAL DEFAULT 0.0,
  last_updated INTEGER,
  FOREIGN KEY (sandbox_id) REFERENCES agent_sandboxes(id)
);

CREATE TABLE IF NOT EXISTS sandbox_behavior_events (
  id TEXT PRIMARY KEY,
  sandbox_id TEXT NOT NULL,
  behavior_type TEXT,            -- file_access, network_call, process_spawn, syscall
  target TEXT,                   -- path, url, command
  risk_level TEXT DEFAULT 'safe',
  anomaly_score REAL DEFAULT 0.0,
  metadata TEXT,
  detected_at INTEGER,
  FOREIGN KEY (sandbox_id) REFERENCES agent_sandboxes(id)
);
```

---

## 四、IPC接口设计

### Phase 87 — SandboxV2IPC (6 handlers)

| 通道                       | 说明           |
| -------------------------- | -------------- |
| `sandbox:create`           | 创建沙箱       |
| `sandbox:execute`          | 沙箱内执行代码 |
| `sandbox:set-permissions`  | 设置权限白名单 |
| `sandbox:get-audit-log`    | 获取审计日志   |
| `sandbox:set-quota`        | 设置配额       |
| `sandbox:monitor-behavior` | 行为监控报告   |

---

## 五、前端集成

### Pinia Stores

- `agentSandbox.ts` — 沙箱列表、权限配置、配额状态、审计日志、风险监控

### Vue Pages

- `AgentSandboxPage.vue` — 沙箱管理/权限配置/配额监控/审计日志/风险仪表板

### Routes

- `/agent-sandbox` — Agent安全沙箱

---

## 六、配置选项

```javascript
agentSandbox: {
  enabled: false,
  defaultCpuQuotaPercent: 25,
  defaultMemoryQuotaMb: 512,
  defaultDiskQuotaMb: 1024,
  defaultNetworkQuotaKbps: 1024,
  riskThresholdForIsolation: 0.8,
  auditLogRetentionDays: 90,
  behaviorMonitorIntervalMs: 5000,
},
```

---

## 七、测试覆盖

**测试文件**: `src/main/ai-engine/sandbox/__tests__/agent-sandbox-v2.test.js`
**测试数量**: 27 tests

| 分类         | 数量 | 说明                                                      |
| ------------ | ---- | --------------------------------------------------------- |
| 初始化       | 2    | 系统初始化、默认策略加载                                  |
| 沙箱生命周期 | 4    | 创建、运行、暂停/恢复、销毁和资源回收                     |
| 权限管理     | 5    | 文件系统白名单、网络规则、系统调用限制、IPC控制、拒绝日志 |
| 配额管理     | 4    | 配额设置、超额检测、动态调整、峰值记录                    |
| 代码执行     | 4    | 正常执行、超时终止、权限拒绝、配额超限                    |
| 审计日志     | 4    | 日志记录、时间范围过滤、事件类型过滤、防篡改              |
| 行为监控     | 4    | 风险评分计算、异常检测、自动隔离触发、监控报告            |

---

## 八、Context Engineering

- step 5.7: `setAgentSandboxContext()` — 注入Agent安全沙箱上下文
