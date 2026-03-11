# 后量子密码迁移 (PQC Migration)

> **Phase 52 | v1.1.0 | 4 IPC 处理器 | 2 张新数据库表**

## 概述

Phase 52 为 ChainlessChain 引入后量子密码 (Post-Quantum Cryptography) 迁移管理能力，支持 ML-KEM/ML-DSA 密钥生成、混合模式过渡和全面迁移执行，为量子计算时代做好密码学准备。

## 核心特性

- 🔑 **PQC 密钥生成**: 支持 ML-KEM-768/1024 和 ML-DSA-65/87 算法，密钥生成 <100ms
- 🔄 **混合模式过渡**: 经典算法 + PQC 算法并行运行，确保向后兼容和安全双保险
- 📊 **迁移状态追踪**: 按用途分类追踪迁移进度，支持模拟运行和回滚
- 🛡️ **渐进式迁移**: hybrid-first 策略三步走（经典→混合→纯 PQC），不中断现有业务
- 📋 **NIST 标准合规**: 基于 FIPS 203/204 标准实现，6 种算法全覆盖

## 系统架构

```
┌──────────────────────────────────┐
│       PQC Migration Manager       │
│       (迁移管理引擎)              │
└───────────────┬──────────────────┘
                │
     ┌──────────▼──────────┐
     │    密钥生成器        │
     │ ML-KEM / ML-DSA     │
     │ + 混合算法           │
     └──────────┬──────────┘
                │
     ┌──────────▼──────────┐
     │    迁移策略引擎      │
     │ ┌────────┐┌───────┐ │
     │ │hybrid- ││direct-│ │
     │ │first   ││replace│ │
     │ └────────┘└───────┘ │
     └──────────┬──────────┘
                │
     ┌──────────▼──────────┐
     │    迁移执行器        │
     │  dryRun / 实际执行   │
     │  + 回滚支持          │
     └──────────┬──────────┘
                │
     ┌──────────▼──────────┐
     │   pqc_keys 表        │
     │   pqc_migration_status│
     └─────────────────────┘
```

---

## 支持的 PQC 算法

| 算法                  | 类型     | 安全级别 | 用途           | 状态 |
| --------------------- | -------- | -------- | -------------- | ---- |
| **ML-KEM-768**        | 密钥封装 | NIST L3  | 密钥交换/加密  | ✅   |
| **ML-KEM-1024**       | 密钥封装 | NIST L5  | 高安全密钥交换 | ✅   |
| **ML-DSA-65**         | 数字签名 | NIST L3  | 签名/身份认证  | ✅   |
| **ML-DSA-87**         | 数字签名 | NIST L5  | 高安全签名     | ✅   |
| **X25519-ML-KEM-768** | 混合封装 | L3+经典  | 过渡期密钥交换 | ✅   |
| **Ed25519-ML-DSA-65** | 混合签名 | L3+经典  | 过渡期签名     | ✅   |

---

## 核心功能

### 1. PQC 密钥管理

```javascript
// 生成 PQC 密钥
const key = await window.electronAPI.invoke("pqc:generate-key", {
  algorithm: "ML-KEM-768",
  purpose: "ENCRYPTION",
  label: "主加密密钥",
  hybridMode: true, // 启用混合模式
  classicalAlgorithm: "X25519", // 经典算法配对
});

console.log(key);
// {
//   id: 'pqc-key-001',
//   algorithm: 'ML-KEM-768',
//   purpose: 'ENCRYPTION',
//   publicKey: 'base64...',
//   hybridMode: true,
//   classicalAlgorithm: 'X25519',
//   status: 'active',
//   createdAt: 1709078400000
// }

// 列出所有 PQC 密钥
const keys = await window.electronAPI.invoke("pqc:list-keys");
// [{ id, algorithm, purpose, status, hybridMode, createdAt }, ...]
```

---

### 2. 迁移状态管理

```javascript
// 查看迁移状态
const status = await window.electronAPI.invoke("pqc:get-migration-status");

console.log(status);
// {
//   overallStatus: 'IN_PROGRESS',
//   totalKeys: 12,
//   migratedKeys: 8,
//   pendingKeys: 4,
//   progress: 0.67,
//   phases: [
//     { name: 'ENCRYPTION', status: 'COMPLETED', keysCount: 4 },
//     { name: 'SIGNING', status: 'IN_PROGRESS', keysCount: 5 },
//     { name: 'KEY_EXCHANGE', status: 'PENDING', keysCount: 3 }
//   ],
//   startedAt: 1709078400000,
//   estimatedCompletion: 1709164800000
// }
```

---

### 3. 迁移执行

```javascript
// 执行迁移计划
const result = await window.electronAPI.invoke("pqc:execute-migration", {
  scope: "SIGNING", // 迁移范围: ENCRYPTION/SIGNING/KEY_EXCHANGE/ALL
  strategy: "hybrid-first", // 策略: hybrid-first/direct-replace
  dryRun: false, // true 为模拟运行
});

console.log(result);
// {
//   success: true,
//   migratedCount: 5,
//   failedCount: 0,
//   details: [
//     { keyId: 'key-001', from: 'Ed25519', to: 'Ed25519-ML-DSA-65', status: 'COMPLETED' },
//     { keyId: 'key-002', from: 'ECDSA', to: 'ML-DSA-65', status: 'COMPLETED' }
//   ],
//   rollbackAvailable: true
// }
```

---

## 迁移策略

### hybrid-first（推荐）

渐进式迁移，先切换到混合模式，验证稳定后再移除经典算法：

```
经典算法 → 混合模式（经典+PQC）→ 纯 PQC
  Step 1       Step 2              Step 3
```

### direct-replace

直接替换为纯 PQC 算法，适用于新系统或非关键场景：

```
经典算法 → 纯 PQC
  Step 1     Step 2
```

---

## 数据库结构

```sql
CREATE TABLE pqc_keys (
  id TEXT PRIMARY KEY,
  algorithm TEXT NOT NULL,       -- ML-KEM-768/ML-DSA-65 等
  purpose TEXT NOT NULL,         -- ENCRYPTION/SIGNING/KEY_EXCHANGE
  public_key TEXT NOT NULL,
  hybrid_mode INTEGER DEFAULT 0,
  classical_algorithm TEXT,      -- X25519/Ed25519/ECDSA
  status TEXT DEFAULT 'active',  -- active/rotated/revoked
  label TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER
);

CREATE TABLE pqc_migration_status (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  strategy TEXT NOT NULL,
  status TEXT DEFAULT 'PENDING', -- PENDING/IN_PROGRESS/COMPLETED/FAILED/ROLLED_BACK
  total_keys INTEGER DEFAULT 0,
  migrated_keys INTEGER DEFAULT 0,
  details TEXT,                  -- JSON 迁移详情
  started_at INTEGER,
  completed_at INTEGER,
  created_at INTEGER NOT NULL
);
```

---

## 前端集成

### Pinia Store

```typescript
import { usePQCMigrationStore } from "@/stores/pqcMigration";

const pqc = usePQCMigrationStore();

// 获取密钥列表
await pqc.fetchKeys();
console.log(pqc.keys);

// 生成新密钥
await pqc.generateKey({ algorithm: "ML-KEM-768", purpose: "ENCRYPTION" });

// 查看迁移状态
await pqc.fetchMigrationStatus();
console.log(pqc.migrationProgress); // 0.67

// 执行迁移
await pqc.executeMigration({ scope: "ALL", strategy: "hybrid-first" });
```

### 前端页面

**PQC 迁移管理页面** (`/pqc-migration`)

**功能模块**:

1. **密钥管理**
   - PQC 密钥列表
   - 密钥生成向导
   - 算法选择和配置

2. **迁移仪表板**
   - 整体迁移进度
   - 分类迁移状态
   - 迁移历史记录

3. **迁移执行**
   - 策略选择
   - 模拟运行
   - 一键迁移

---

## 配置选项

```json
{
  "pqc": {
    "enabled": true,
    "defaultAlgorithm": "ML-KEM-768",
    "defaultSigningAlgorithm": "ML-DSA-65",
    "hybridModeDefault": true,
    "autoMigrate": false,
    "migrationStrategy": "hybrid-first"
  }
}
```

---

## 安全考虑

1. **算法标准**: 基于 NIST FIPS 203/204 标准实现
2. **混合安全**: 混合模式确保即使 PQC 算法被攻破，经典算法仍提供保护
3. **密钥隔离**: PQC 密钥与经典密钥独立存储
4. **回滚能力**: 所有迁移操作支持回滚到经典算法
5. **渐进迁移**: 支持按用途分批迁移，降低风险

---

## 性能指标

| 指标            | 目标   | 实际   |
| --------------- | ------ | ------ |
| ML-KEM 密钥生成 | <100ms | ~60ms  |
| ML-DSA 密钥生成 | <200ms | ~120ms |
| 混合加密延迟    | <50ms  | ~30ms  |
| 单密钥迁移延迟  | <500ms | ~300ms |

---

## 关键文件

| 文件 | 职责 |
| --- | --- |
| `src/main/ukey/pqc-migration-manager.js` | PQC 迁移核心引擎 |
| `src/main/ukey/pqc-migration-ipc.js` | IPC 处理器（4 个） |
| `src/renderer/stores/pqcMigration.ts` | Pinia PQC 迁移状态管理 |
| `src/renderer/pages/security/PQCMigrationPage.vue` | PQC 迁移管理页面 |

## 相关文档

- [统一密钥 + FIDO2](/chainlesschain/unified-key)
- [门限签名 + 生物特征](/chainlesschain/threshold-security)
- [SIMKey 企业版](/chainlesschain/simkey-enterprise)
- [产品路线图](/chainlesschain/product-roadmap)

---

**文档版本**: 1.0.0
**最后更新**: 2026-02-27
