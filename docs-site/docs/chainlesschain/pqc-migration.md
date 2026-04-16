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

## 使用示例

### 示例 1: 混合模式密钥迁移

```javascript
// 1. 查看当前迁移状态
const status = await window.electronAPI.invoke("pqc:get-migration-status");
console.log(`迁移进度: ${(status.progress * 100).toFixed(0)}%`);

// 2. 生成混合模式签名密钥
const key = await window.electronAPI.invoke("pqc:generate-key", {
  algorithm: "ML-DSA-65",
  purpose: "SIGNING",
  label: "签名迁移密钥",
  hybridMode: true,
  classicalAlgorithm: "Ed25519",
});

// 3. 模拟运行签名类密钥迁移（不实际执行）
const dryRun = await window.electronAPI.invoke("pqc:execute-migration", {
  scope: "SIGNING",
  strategy: "hybrid-first",
  dryRun: true,
});
console.log(`模拟结果: 将迁移 ${dryRun.migratedCount} 个密钥`);

// 4. 确认无误后正式执行迁移
const result = await window.electronAPI.invoke("pqc:execute-migration", {
  scope: "SIGNING",
  strategy: "hybrid-first",
  dryRun: false,
});
console.log(`迁移完成: 成功 ${result.migratedCount}, 失败 ${result.failedCount}`);
```

### 示例 2: 按用途分批迁移加密密钥

```javascript
// 分步迁移：先加密，再密钥交换
for (const scope of ["ENCRYPTION", "KEY_EXCHANGE"]) {
  const result = await window.electronAPI.invoke("pqc:execute-migration", {
    scope,
    strategy: "hybrid-first",
    dryRun: false,
  });
  console.log(`${scope}: 迁移 ${result.migratedCount} 个, 可回滚: ${result.rollbackAvailable}`);
}
```

---

## 故障排查

| 问题 | 可能原因 | 解决方案 |
| --- | --- | --- |
| 密钥生成失败 | 不支持的算法名称 | 确认使用标准算法名（ML-KEM-768/1024, ML-DSA-65/87） |
| 迁移执行出错 | 目标密钥已被其他进程锁定 | 检查是否有其他迁移任务正在进行，等待完成后重试 |
| 混合模式不生效 | 未指定经典算法 | 启用 `hybridMode` 时必须同时设置 `classicalAlgorithm` |
| 模拟运行结果为 0 | 该用途下无经典密钥需要迁移 | 检查 `pqc:list-keys` 确认目标用途是否存在待迁移密钥 |
| 回滚失败 | 迁移记录已过期或被清理 | 回滚仅在迁移后短期内有效，超时需手动重新生成经典密钥 |
| 性能下降明显 | PQC 算法密钥尺寸较大 | ML-KEM/ML-DSA 密钥比经典算法大，属于正常现象，可优化缓存策略 |

---

## 配置参考

### 完整配置字段

PQC 迁移模块通过 `.chainlesschain/config.json` 中的 `pqc` 节点进行配置：

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

| 字段                      | 类型    | 默认值           | 说明                                                                  |
| ------------------------- | ------- | ---------------- | --------------------------------------------------------------------- |
| `enabled`                 | Boolean | `true`           | 是否启用 PQC 迁移模块                                                 |
| `defaultAlgorithm`        | String  | `"ML-KEM-768"`   | 默认密钥封装算法，可选 `ML-KEM-768` / `ML-KEM-1024`                  |
| `defaultSigningAlgorithm` | String  | `"ML-DSA-65"`    | 默认数字签名算法，可选 `ML-DSA-65` / `ML-DSA-87`                     |
| `hybridModeDefault`       | Boolean | `true`           | 生成密钥时是否默认启用混合模式（经典 + PQC 并行）                     |
| `autoMigrate`             | Boolean | `false`          | 是否在应用启动时自动触发迁移；生产环境建议保持 `false` 手动控制       |
| `migrationStrategy`       | String  | `"hybrid-first"` | 迁移策略，可选 `hybrid-first`（渐进过渡）或 `direct-replace`（直接替换）|

### 算法与经典配对映射

| PQC 算法              | 推荐经典配对 | 说明                          |
| --------------------- | ------------ | ----------------------------- |
| `ML-KEM-768`          | `X25519`     | 标准安全级别密钥交换          |
| `ML-KEM-1024`         | `X448`       | 高安全级别密钥交换            |
| `ML-DSA-65`           | `Ed25519`    | 标准安全级别签名              |
| `ML-DSA-87`           | `Ed448`      | 高安全级别签名                |

### 环境变量覆盖

```bash
# 禁用自动迁移（CI 环境推荐）
PQC_AUTO_MIGRATE=false

# 强制指定默认算法
PQC_DEFAULT_ALGORITHM=ML-KEM-1024
PQC_DEFAULT_SIGNING_ALGORITHM=ML-DSA-87
```

环境变量优先级高于 `config.json` 中的配置值。

---

## 测试覆盖

### 测试文件

| 文件                                                        | 类型     | 用例数 | 说明                                      |
| ----------------------------------------------------------- | -------- | ------ | ----------------------------------------- |
| `tests/unit/ukey/pqc-migration-manager.test.js`             | 单元测试 | 38     | 密钥生成、迁移状态管理、策略执行、回滚    |
| `tests/unit/ukey/pqc-migration-strategies.test.js`          | 单元测试 | 22     | `hybrid-first` 三步走、`direct-replace` 校验 |
| `tests/integration/ukey/pqc-migration-ipc.test.js`          | 集成测试 | 16     | 4 个 IPC 处理器端到端调用                 |
| `tests/unit/ukey/pqc-algorithm-validation.test.js`          | 单元测试 | 14     | 算法名校验、混合模式参数一致性检查        |

**总计**: 90 个测试用例，覆盖率 ~92%

### 关键测试场景

```javascript
// 1. 生成 ML-KEM-768 混合模式密钥
it('should generate hybrid ML-KEM-768 key with X25519 classical pair', async () => {
  const key = await manager.generateKey({
    algorithm: 'ML-KEM-768',
    purpose: 'ENCRYPTION',
    hybridMode: true,
    classicalAlgorithm: 'X25519',
  });
  expect(key.algorithm).toBe('ML-KEM-768');
  expect(key.hybridMode).toBe(true);
  expect(key.classicalAlgorithm).toBe('X25519');
  expect(key.publicKey).toBeTruthy();
});

// 2. hybrid-first 策略三步走验证
it('should migrate through hybrid stage before pure PQC', async () => {
  const result = await manager.executeMigration({
    scope: 'SIGNING',
    strategy: 'hybrid-first',
    dryRun: false,
  });
  // 第一次迁移：经典 → 混合
  expect(result.details[0].to).toContain('-ML-DSA-');
  expect(result.rollbackAvailable).toBe(true);
});

// 3. dryRun 不写入数据库
it('should not persist changes on dryRun', async () => {
  const before = await manager.getMigrationStatus();
  await manager.executeMigration({ scope: 'ENCRYPTION', strategy: 'hybrid-first', dryRun: true });
  const after = await manager.getMigrationStatus();
  expect(after.migratedKeys).toBe(before.migratedKeys);
});

// 4. 混合模式缺少 classicalAlgorithm 时拒绝生成
it('should reject hybridMode without classicalAlgorithm', async () => {
  await expect(
    manager.generateKey({ algorithm: 'ML-DSA-65', purpose: 'SIGNING', hybridMode: true }),
  ).rejects.toThrow('classicalAlgorithm is required when hybridMode is true');
});
```

### 运行测试

```bash
# 全量 PQC 迁移测试
cd desktop-app-vue && npx vitest run tests/unit/ukey/pqc-migration

# 含 IPC 集成测试
cd desktop-app-vue && npx vitest run tests/unit/ukey/ tests/integration/ukey/pqc-migration-ipc

# 仅策略测试
cd desktop-app-vue && npx vitest run tests/unit/ukey/pqc-migration-strategies
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
