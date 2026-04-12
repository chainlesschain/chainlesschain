# PQC 全生态迁移

> **版本: v3.2.0 | 状态: ✅ 生产就绪 | 4 IPC Handlers | 1 数据库表 | ML-KEM/ML-DSA 后量子密码**

## 概述

PQC 全生态迁移系统实现了 P2P、DID、存储、消息、认证、U-Key 六大子系统从 RSA-2048 到后量子安全算法（ML-KEM-768/ML-DSA-65）的全面迁移。系统支持按子系统独立追踪迁移进度、SIMKey 固件级 PQC 升级，以及一键验证全系统迁移完整性。

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

## 使用示例

### 示例 1: 逐子系统迁移到 PQC

```javascript
// 1. 查看全系统迁移覆盖率
const coverage = await window.electron.ipcRenderer.invoke("pqc-ecosystem:get-coverage");
Object.entries(coverage.coverage).forEach(([sub, info]) => {
  console.log(`${sub}: ${info.percentage}% (${info.completed}/${info.total})`);
});

// 2. 按优先级逐子系统迁移
const subsystems = ["did", "auth", "p2p", "messaging", "storage", "ukey"];
for (const sub of subsystems) {
  const alg = ["did", "auth"].includes(sub) ? "ML-DSA-65" : "ML-KEM-768";
  const result = await window.electron.ipcRenderer.invoke("pqc-ecosystem:migrate-subsystem", {
    subsystem: sub,
    algorithm: alg,
  });
  console.log(`${sub}: ${result.migration.status}, 密钥迁移 ${result.migration.keys_migrated}/${result.migration.keys_total}`);
}

// 3. 验证全系统迁移完整性
const verify = await window.electron.ipcRenderer.invoke("pqc-ecosystem:verify-migration");
console.log(`验证结果: ${verify.verified ? "全部通过" : "存在未迁移子系统"}`);
```

### 示例 2: SIMKey 固件 PQC 升级

```javascript
// 升级硬件密钥固件到支持 PQC 的版本
const firmware = await window.electron.ipcRenderer.invoke(
  "pqc-ecosystem:update-firmware-pqc", "2.0.0"
);
console.log(`固件版本: ${firmware.result.firmwareVersion}, PQC: ${firmware.result.pqcEnabled}`);
```

---

## 故障排查

| 问题 | 可能原因 | 解决方案 |
| --- | --- | --- |
| 子系统迁移失败 | 该子系统存在正在使用的活跃连接 | 先停止相关服务（如 P2P 连接），再执行迁移 |
| 覆盖率显示 0% | 子系统未初始化密钥 | 先确保对应子系统已启用并生成了初始密钥 |
| 固件升级失败 | U-Key 未连接或固件版本不兼容 | 检查 U-Key 连接状态，确认目标固件版本存在 |
| 验证未通过 | 部分子系统迁移未完成 | 查看 `coverage` 详情，补充迁移未完成的子系统 |
| 迁移后签名验证失败 | 对端尚未升级到 PQC | 确保通信双方均已完成 PQC 迁移，过渡期使用混合模式 |
| 迁移进度卡住 | 数据库锁或并发冲突 | 重启应用后重新执行迁移，检查数据库表锁状态 |

---

## 安全考虑

1. **渐进迁移**: 建议按子系统逐步迁移，避免一次性全系统切换带来的风险
2. **混合过渡**: 迁移期间保持混合模式（经典+PQC），确保向后兼容
3. **固件验证**: SIMKey 固件升级前自动校验签名，防止恶意固件注入
4. **密钥隔离**: 每个子系统的 PQC 密钥独立管理，互不影响
5. **回滚保障**: 迁移失败时支持回退到经典算法，保证服务连续性

---

## 相关文档

- [PQC Migration 后量子迁移 →](/chainlesschain/pqc-migration)
- [Trinity Trust Root 信任根 →](/chainlesschain/trust-root)
- [HSM Adapter 硬件安全模块 →](/chainlesschain/hsm-adapter)
- [U-Key 硬件密钥 →](/chainlesschain/ukey)
