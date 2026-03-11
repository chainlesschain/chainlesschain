# PQC 全生态迁移

> **版本: v3.2.0 | 状态: ✅ 生产就绪 | 4 IPC Handlers | 1 数据库表 | ML-KEM/ML-DSA 后量子密码**

ChainlessChain PQC Ecosystem 实现了全系统范围的后量子密码学迁移，覆盖 P2P、DID、存储、消息、认证、U-Key 六大子系统。支持 ML-KEM/ML-DSA 算法替换、SIMKey 固件 PQC 更新、混合到纯 PQC 迁移路径，以及按子系统的迁移进度追踪。

## 核心特性

- 🔄 **全子系统迁移**: P2P/DID/存储/消息/认证/U-Key 六大子系统逐一迁移
- 🔐 **ML-KEM/ML-DSA 替换**: 从 RSA-2048 全面迁移到后量子安全算法
- 📱 **固件 PQC 更新**: SIMKey 固件级别的后量子密码学升级
- 📊 **迁移进度追踪**: 按子系统独立追踪迁移覆盖率和完成状态
- ✅ **迁移验证**: 一键验证全系统 PQC 迁移完整性

## 系统架构

```
┌─────────────────────────────────────────┐
│          PQC Ecosystem Manager           │
│         (全子系统迁移引擎)               │
└────────────────┬────────────────────────┘
                 │
    ┌────────────▼────────────┐
    │     迁移调度器           │
    │  (子系统独立追踪)        │
    └──┬──┬──┬──┬──┬──┬───────┘
       │  │  │  │  │  │
       ▼  ▼  ▼  ▼  ▼  ▼
    ┌────┐┌────┐┌────┐┌────┐┌────┐┌────┐
    │P2P ││DID ││存储 ││消息 ││认证 ││U-Key│
    │KEM ││DSA ││KEM ││KEM ││DSA ││KEM │
    └────┘└────┘└────┘└────┘└────┘└────┘
       │                           │
       ▼                           ▼
┌──────────────┐          ┌──────────────┐
│ RSA→ML-KEM   │          │ SIMKey 固件   │
│ RSA→ML-DSA   │          │ PQC 升级      │
│ (算法替换)   │          │ (硬件级)      │
└──────────────┘          └──────────────┘
       │
       ▼
┌──────────────┐
│ 迁移验证器   │
│ (100%覆盖率) │
└──────────────┘
```

## 支持的子系统

| 子系统      | 说明           | 迁移算法   |
| ----------- | -------------- | ---------- |
| `p2p`       | P2P 通信加密   | ML-KEM-768 |
| `did`       | DID 身份签名   | ML-DSA-65  |
| `storage`   | 存储加密       | ML-KEM-768 |
| `messaging` | 消息端对端加密 | ML-KEM-768 |
| `auth`      | 认证签名       | ML-DSA-65  |
| `ukey`      | 硬件密钥       | ML-KEM-768 |

## 查询迁移覆盖率

```javascript
const result = await window.electron.ipcRenderer.invoke(
  "pqc-ecosystem:get-coverage",
);
// result.coverage = {
//   p2p: { total: 5, completed: 3, percentage: 60 },
//   did: { total: 3, completed: 3, percentage: 100 },
//   storage: { total: 4, completed: 0, percentage: 0 },
//   ...
// }
```

## 迁移子系统

```javascript
const result = await window.electron.ipcRenderer.invoke(
  "pqc-ecosystem:migrate-subsystem",
  {
    subsystem: "p2p",
    algorithm: "ML-KEM-768",
  },
);
// result.migration = {
//   id: "uuid",
//   subsystem: "p2p",
//   algorithm: "ML-KEM-768",
//   from_algorithm: "RSA-2048",
//   status: "completed",
//   progress: 100,
//   keys_migrated: 10,
//   keys_total: 10,
// }
```

## 更新固件 PQC

```javascript
const result = await window.electron.ipcRenderer.invoke(
  "pqc-ecosystem:update-firmware-pqc",
  "2.0.0",
);
// result.result = { firmwareVersion: "2.0.0", pqcEnabled: true, algorithm: "ML-DSA-65" }
```

## 验证完整迁移

```javascript
const result = await window.electron.ipcRenderer.invoke(
  "pqc-ecosystem:verify-migration",
);
// result = { verified: true, coverage: {...}, verifiedAt: 1709123456789 }
```

## IPC 接口完整列表

### PQC Ecosystem 操作（4 个）

| 通道                                | 功能           | 说明                         |
| ----------------------------------- | -------------- | ---------------------------- |
| `pqc-ecosystem:get-coverage`        | 查询迁移覆盖率 | 按子系统统计迁移进度         |
| `pqc-ecosystem:migrate-subsystem`   | 迁移指定子系统 | RSA → ML-KEM/ML-DSA          |
| `pqc-ecosystem:update-firmware-pqc` | 更新固件 PQC   | SIMKey 固件 PQC 升级         |
| `pqc-ecosystem:verify-migration`    | 验证完整迁移   | 检查所有子系统是否 100% 完成 |

## 数据库 Schema

**1 张核心表**:

### pqc_subsystem_migrations 表

```sql
CREATE TABLE IF NOT EXISTS pqc_subsystem_migrations (
  id TEXT PRIMARY KEY,
  subsystem TEXT NOT NULL,               -- p2p | did | storage | messaging | auth | ukey
  algorithm TEXT NOT NULL,               -- ML-KEM-768 | ML-DSA-65
  from_algorithm TEXT,                   -- RSA-2048
  status TEXT DEFAULT 'pending',         -- pending | in_progress | completed | failed
  progress REAL DEFAULT 0,              -- 0-100 百分比
  keys_migrated INTEGER DEFAULT 0,
  keys_total INTEGER DEFAULT 0,
  error TEXT,
  started_at INTEGER,
  completed_at INTEGER,
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_pqc_sub_migrations_status ON pqc_subsystem_migrations(status);
CREATE INDEX IF NOT EXISTS idx_pqc_sub_migrations_subsystem ON pqc_subsystem_migrations(subsystem);
```

## 前端集成

### PQCEcosystemPage 页面

**功能模块**:

- **覆盖率面板**: 按子系统展示迁移进度条（Ant Design Progress）
- **迁移操作**: 选择子系统并执行迁移
- **验证按钮**: 一键验证全系统 PQC 迁移
- **错误提示**: Alert 组件展示错误信息

### Pinia Store (pqcEcosystem.ts)

```typescript
const usePQCEcosystemStore = defineStore("pqcEcosystem", {
  state: () => ({
    coverage: null,
    loading: false,
    error: null,
  }),
  actions: {
    fetchCoverage, // → pqc-ecosystem:get-coverage
    migrateSubsystem, // → pqc-ecosystem:migrate-subsystem
    updateFirmwarePQC, // → pqc-ecosystem:update-firmware-pqc
    verifyMigration, // → pqc-ecosystem:verify-migration
  },
});
```

## 关键文件

| 文件                                               | 职责               | 行数 |
| -------------------------------------------------- | ------------------ | ---- |
| `src/main/ukey/pqc-ecosystem-manager.js`           | PQC 迁移核心引擎   | ~184 |
| `src/main/ukey/pqc-ecosystem-ipc.js`               | IPC 处理器（4 个） | ~117 |
| `src/renderer/stores/pqcEcosystem.ts`              | Pinia 状态管理     | ~80  |
| `src/renderer/pages/security/PQCEcosystemPage.vue` | PQC 迁移页面       | ~80  |

## 测试覆盖率

```
✅ pqc-ecosystem-manager.test.js         - 迁移/覆盖率/固件/验证测试
✅ stores/pqcEcosystem.test.ts           - Store 状态管理测试
✅ e2e/security/pqc-ecosystem.e2e.test.ts - 端到端用户流程测试
```

## 相关文档

- [PQC Migration 后量子迁移 →](/chainlesschain/pqc-migration)
- [Trinity Trust Root 信任根 →](/chainlesschain/trust-root)
- [HSM Adapter 硬件安全模块 →](/chainlesschain/hsm-adapter)
- [U-Key 硬件密钥 →](/chainlesschain/ukey)
