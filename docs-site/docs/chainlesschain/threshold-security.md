# 门限签名 + 生物特征绑定

> **Phase 46 | v1.1.0-alpha | 8 IPC 处理器 | 2 张新数据库表**

## 核心特性

- 🔐 **Shamir 密钥分割**: 2-of-3 门限方案，任意 2 份 share 可恢复完整密钥
- 🧬 **生物特征绑定**: TEE 环境下指纹/面部/虹膜模板哈希与密钥绑定
- 🛡️ **多因素安全**: 硬件密钥 + 生物特征 + 门限签名三重保护架构
- 🔄 **密钥恢复**: 社交恢复 + 门限恢复双通道，抗单点故障
- ⚡ **高性能验证**: 密钥分割 <100ms，生物特征验证 <1000ms

## 系统架构

```
┌──────────────────────────────────────────────┐
│              门限安全系统                       │
│                                              │
│  ┌──────────────┐    ┌──────────────────┐    │
│  │ Shamir 分割  │    │ 生物特征绑定     │    │
│  │ (2-of-3)     │    │ (TEE 安全环境)   │    │
│  └──────┬───────┘    └────────┬─────────┘    │
│         │                     │              │
│         ▼                     ▼              │
│  ┌──────────────────────────────────────┐    │
│  │        统一密钥管理层                  │    │
│  │  份额1:设备 | 份额2:U-Key | 份额3:备份│    │
│  └──────────────────┬───────────────────┘    │
│                     ▼                        │
│  ┌──────────────────────────────────────┐    │
│  │  threshold_key_shares / biometric_   │    │
│  │  bindings (SQLite 加密存储)          │    │
│  └──────────────────────────────────────┘    │
└──────────────────────────────────────────────┘
```

## 概述

Phase 46 为 ChainlessChain 统一密钥系统引入门限签名（Threshold Signatures）和生物特征绑定能力，实现 Shamir 2-of-3 密钥分割和 TEE 级生物认证。

**核心目标**:

- 🔐 **Shamir 密钥分割**: 2-of-3 门限方案，任意 2 份可恢复
- 🧬 **生物特征绑定**: TEE 环境下的生物模板哈希绑定
- 🛡️ **多因素安全**: 硬件密钥 + 生物特征 + 门限签名的三重保护
- 🔄 **密钥恢复**: 社交恢复 + 门限恢复双通道

---

## 门限签名 (Threshold Signatures)

### 什么是门限签名?

门限签名（t-of-n）是一种密钥分割方案，将一个密钥拆分为 n 份 share，至少需要 t 份才能执行签名。

**ChainlessChain 默认方案**: **2-of-3**

- 份额 1: 存储在本地设备
- 份额 2: 存储在 U-Key 硬件
- 份额 3: 加密备份在云端/纸质

**优势**:

- ✅ 单一设备丢失不影响安全
- ✅ 抗单点故障
- ✅ 支持灵活的恢复场景
- ✅ 兼容现有 BIP-32 密钥体系

### 使用示例

```javascript
// 1. 分割密钥为 3 份 share
const shares = await window.electronAPI.invoke("ukey:threshold-split-key", {
  keyId: "master-key-001",
  threshold: 2,
  totalShares: 3,
});

console.log(shares);
// {
//   shares: [
//     { index: 1, data: '0x...', label: 'device' },
//     { index: 2, data: '0x...', label: 'ukey' },
//     { index: 3, data: '0x...', label: 'backup' }
//   ],
//   threshold: 2,
//   totalShares: 3
// }

// 2. 使用任意 2 份进行门限签名
const signature = await window.electronAPI.invoke("ukey:threshold-sign", {
  shares: [shares.shares[0], shares.shares[1]],
  message: "transaction data to sign",
});
// { signature: '0x...', signedAt: 1709078400000 }

// 3. 验证门限签名
const isValid = await window.electronAPI.invoke("ukey:threshold-verify", {
  signature: signature.signature,
  message: "transaction data to sign",
  publicKey: masterPublicKey,
});
// true

// 4. 使用 2 份恢复完整密钥
const recovered = await window.electronAPI.invoke(
  "ukey:threshold-recover-key",
  {
    shares: [shares.shares[0], shares.shares[2]],
  },
);
// { keyId: 'master-key-001', recovered: true }
```

### 份额管理

```javascript
// 列出所有门限密钥
const thresholdKeys = await window.electronAPI.invoke(
  "ukey:threshold-list-keys",
);
// [{ keyId: '...', threshold: 2, totalShares: 3, createdAt: ... }]

// 刷新某一份 share (不影响其他份额)
const newShare = await window.electronAPI.invoke(
  "ukey:threshold-refresh-share",
  {
    keyId: "master-key-001",
    shareIndex: 3,
  },
);

// 获取门限方案状态
const status = await window.electronAPI.invoke("ukey:threshold-get-status", {
  keyId: "master-key-001",
});
// { availableShares: 2, threshold: 2, canSign: true }
```

**数据库结构**:

```sql
CREATE TABLE threshold_key_shares (
  id TEXT PRIMARY KEY,
  key_id TEXT NOT NULL,
  share_index INTEGER NOT NULL,
  share_data TEXT NOT NULL,      -- 加密存储
  label TEXT,                     -- device/ukey/backup
  threshold INTEGER NOT NULL,
  total_shares INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER
);
```

---

## 生物特征绑定 (Biometric Binding)

### TEE 安全架构

生物特征绑定利用 TEE（Trusted Execution Environment）安全环境，将生物模板哈希与密钥绑定。

**支持的生物特征类型**:

| 类型     | 说明            | 平台支持               |
| -------- | --------------- | ---------------------- |
| **指纹** | 光学/超声波指纹 | Windows Hello, Android |
| **面部** | 3D 结构光面部   | Windows Hello, Face ID |
| **虹膜** | 虹膜扫描        | 部分企业设备           |

**安全原则**:

- 生物数据**永不离开 TEE**
- 仅存储模板**哈希值** (SHA-256)
- 绑定关系加密存储于本地数据库
- 支持多生物特征同时绑定

### 使用示例

```javascript
// 1. 注册生物特征
const binding = await window.electronAPI.invoke("ukey:biometric-register", {
  keyId: "master-key-001",
  biometricType: "fingerprint",
  label: "右手食指",
});

console.log(binding);
// {
//   bindingId: 'bio-abc123',
//   templateHash: 'sha256:...',
//   biometricType: 'fingerprint',
//   boundKeyId: 'master-key-001'
// }

// 2. 使用生物特征验证后签名
const result = await window.electronAPI.invoke(
  "ukey:biometric-verify-and-sign",
  {
    bindingId: "bio-abc123",
    message: "transaction data",
  },
);
// { verified: true, signature: '0x...' }

// 3. 列出所有绑定
const bindings = await window.electronAPI.invoke(
  "ukey:biometric-list-bindings",
  {
    keyId: "master-key-001",
  },
);

// 4. 撤销绑定
await window.electronAPI.invoke("ukey:biometric-revoke", {
  bindingId: "bio-abc123",
});
```

**数据库结构**:

```sql
CREATE TABLE biometric_bindings (
  id TEXT PRIMARY KEY,
  key_id TEXT NOT NULL,
  biometric_type TEXT NOT NULL,  -- fingerprint/face/iris
  template_hash TEXT NOT NULL,
  label TEXT,
  status TEXT DEFAULT 'active',  -- active/revoked
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);
```

---

## 前端集成

### Pinia Store

```typescript
import { useThresholdSecurityStore } from "@/stores/thresholdSecurity";

const security = useThresholdSecurityStore();

// 分割密钥
await security.splitKey(keyId, 2, 3);

// 门限签名
await security.thresholdSign(shares, message);

// 注册生物特征
await security.registerBiometric(keyId, "fingerprint");
```

### 前端页面

**门限安全页面** (`/threshold-security`)

**功能模块**:

1. **密钥分割管理**
   - 创建门限方案
   - 查看份额分布状态
   - 份额刷新操作

2. **生物特征管理**
   - 注册/撤销生物特征
   - 绑定关系可视化
   - 安全状态检查

3. **恢复中心**
   - 门限恢复流程
   - 社交恢复通道
   - 备份份额导入

---

## 配置选项

```json
{
  "thresholdSecurity": {
    "enabled": true,
    "defaultThreshold": 2,
    "defaultTotalShares": 3,
    "shareLabels": ["device", "ukey", "backup"],
    "biometric": {
      "enabled": true,
      "allowedTypes": ["fingerprint", "face"],
      "verificationTimeout": 30000,
      "maxRetries": 3
    }
  }
}
```

---

## 使用场景

### 场景 1: 企业级密钥保护

```javascript
// 1. 分割企业主密钥
const shares = await window.electronAPI.invoke("ukey:threshold-split-key", {
  keyId: enterpriseKeyId,
  threshold: 2,
  totalShares: 3,
});

// 2. 分发份额
// 份额1 → 保留在 CEO 设备
// 份额2 → 存入公司 U-Key
// 份额3 → 加密打印备份

// 3. 绑定 CEO 生物特征
await window.electronAPI.invoke("ukey:biometric-register", {
  keyId: enterpriseKeyId,
  biometricType: "fingerprint",
});
```

### 场景 2: 安全交易签名

```javascript
// 1. 生物特征验证
const verified = await window.electronAPI.invoke(
  "ukey:biometric-verify-and-sign",
  {
    bindingId: biometricBindingId,
    message: transactionData,
  },
);

// 2. 门限签名 (需要 2 份 share)
const sig = await window.electronAPI.invoke("ukey:threshold-sign", {
  shares: [deviceShare, ukeyShare],
  message: transactionData,
});
```

---

## 故障排查

### 密钥分割失败

**现象**: `ukey:threshold-split-key` 返回错误。

**排查步骤**:

1. 确认目标 `keyId` 存在且为有效的主密钥
2. 检查 `threshold` 值是否小于等于 `totalShares`（如 2-of-3 有效，3-of-2 无效）
3. 确认数据库 `threshold_key_shares` 表已正确创建
4. 查看日志中 `[ThresholdManager]` 的详细错误信息

### 门限签名验证失败

**现象**: 使用 2 份 share 签名后，验证方返回签名无效。

**排查步骤**:

1. 确认提供的 2 份 share 属于同一个 `keyId` 的分割结果
2. 检查 share 数据是否完整（未被截断或修改）
3. 验证并确认使用的是分割时对应的原始公钥
4. 如果份额已刷新（`threshold-refresh-share`），确认使用的是刷新后的份额

### 生物特征注册失败

**现象**: `ukey:biometric-register` 超时或返回错误。

**排查步骤**:

1. 确认设备支持所选生物特征类型（如 Windows Hello 指纹/面部）
2. 检查 TEE 环境是否正常（部分虚拟机不支持 TEE）
3. 指纹注册时确保手指干燥清洁，多次按压以采集不同角度
4. `verificationTimeout` 默认 30 秒，在首次注册时可适当增大

### 密钥恢复份额不足

**现象**: `ukey:threshold-recover-key` 报告份额不足。

**排查步骤**:

1. 确认提供的份额数量 >= `threshold` 值（2-of-3 方案需至少 2 份）
2. 检查备份份额是否损坏或过期（从加密备份导入时需正确密码）
3. 如果设备份额丢失，可通过 U-Key 份额 + 备份份额恢复
4. 如果两份以上份额丢失，密钥将无法恢复，需使用助记词重新生成

### 生物特征验证后签名超时

**现象**: `ukey:biometric-verify-and-sign` 生物验证通过但签名步骤超时。

**排查步骤**:

1. 确认 U-Key 硬件已连接且可正常通信
2. 检查绑定关系是否仍然有效（未被撤销 `status: 'active'`）
3. 生物验证和签名之间存在时间窗口限制（默认 30 秒），需在窗口内完成

## 配置参考

`.chainlesschain/config.json` 中 `thresholdSecurity` 字段的完整说明：

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `enabled` | boolean | `true` | 是否启用门限安全模块 |
| `defaultThreshold` | number | `2` | 默认门限值 t（需要多少份 share 才能恢复） |
| `defaultTotalShares` | number | `3` | 默认总份额数 n |
| `shareLabels` | string[] | `["device","ukey","backup"]` | 各份额的标签，长度必须等于 `defaultTotalShares` |
| `biometric.enabled` | boolean | `true` | 是否启用生物特征绑定 |
| `biometric.allowedTypes` | string[] | `["fingerprint","face"]` | 允许的生物特征类型（`fingerprint` / `face` / `iris`） |
| `biometric.verificationTimeout` | number (ms) | `30000` | 生物验证超时（毫秒），验证完成需在此窗口内完成签名 |
| `biometric.maxRetries` | number | `3` | 生物验证失败后的最大重试次数，超出后锁定 |

**最小配置示例**（仅门限，不启用生物绑定）：

```json
{
  "thresholdSecurity": {
    "enabled": true,
    "defaultThreshold": 2,
    "defaultTotalShares": 3,
    "biometric": { "enabled": false }
  }
}
```

**高安全企业配置**（3-of-5 方案 + 虹膜）：

```json
{
  "thresholdSecurity": {
    "enabled": true,
    "defaultThreshold": 3,
    "defaultTotalShares": 5,
    "shareLabels": ["ceo", "cto", "cfo", "legal", "backup"],
    "biometric": {
      "enabled": true,
      "allowedTypes": ["fingerprint", "face", "iris"],
      "verificationTimeout": 60000,
      "maxRetries": 2
    }
  }
}
```

---

## 测试覆盖

### 测试文件

| 测试文件 | 覆盖范围 | 用例数 |
|----------|----------|--------|
| `desktop-app-vue/tests/unit/ukey/threshold-manager.test.js` | Shamir 分割、门限签名、密钥恢复、份额刷新 | 24 |
| `desktop-app-vue/tests/unit/ukey/biometric-binding.test.js` | TEE 绑定注册、验证、撤销、多类型支持 | 18 |
| `desktop-app-vue/tests/unit/ukey/threshold-ipc.test.js` | 8 个 IPC 处理器参数校验与错误处理 | 16 |
| `desktop-app-vue/src/renderer/stores/__tests__/thresholdSecurity.test.ts` | Pinia store 状态流转与 IPC 调用 | 12 |

**合计**: 70 个测试用例

### 运行测试

```bash
# 所有门限安全测试
cd desktop-app-vue && npx vitest run tests/unit/ukey/threshold-manager.test.js \
  tests/unit/ukey/biometric-binding.test.js \
  tests/unit/ukey/threshold-ipc.test.js

# Pinia store 测试
cd desktop-app-vue && npx vitest run src/renderer/stores/__tests__/thresholdSecurity.test.ts
```

### 关键测试场景

```javascript
// 1. 2-of-3 分割后使用任意两份恢复
it('recovers key from any 2-of-3 shares', async () => {
  const { shares } = await thresholdManager.splitKey('key-001', 2, 3)
  const recovered1 = await thresholdManager.recoverKey([shares[0], shares[1]])
  const recovered2 = await thresholdManager.recoverKey([shares[0], shares[2]])
  const recovered3 = await thresholdManager.recoverKey([shares[1], shares[2]])
  expect(recovered1).toEqual(recovered2)
  expect(recovered2).toEqual(recovered3)
})

// 2. 单份 share 无法恢复（信息论安全）
it('cannot recover key from a single share', async () => {
  const { shares } = await thresholdManager.splitKey('key-002', 2, 3)
  await expect(thresholdManager.recoverKey([shares[0]])).rejects.toThrow('insufficient shares')
})

// 3. 生物验证窗口超时后签名失败
it('rejects sign when verification window expires', async () => {
  vi.useFakeTimers()
  const binding = await biometricBinding.register('key-001', 'fingerprint')
  vi.advanceTimersByTime(31000) // 超过 30s 窗口
  await expect(
    biometricBinding.verifyAndSign(binding.bindingId, 'msg')
  ).rejects.toThrow('verification window expired')
})
```

---

## 安全考虑

1. **Shamir 安全性**: 基于有限域上的多项式插值，信息论安全
2. **份额加密**: 每份 share 使用 AES-256 独立加密存储
3. **TEE 隔离**: 生物数据处理在 TEE 中完成，主系统无法访问
4. **模板不可逆**: 生物模板哈希使用 SHA-256，不可逆推原始数据
5. **时间限制**: 生物验证有超时机制，防止重放攻击

---

## 性能指标

| 指标         | 目标    | 实际   |
| ------------ | ------- | ------ |
| 密钥分割延迟 | <100ms  | ~60ms  |
| 门限签名延迟 | <200ms  | ~150ms |
| 密钥恢复延迟 | <150ms  | ~100ms |
| 生物特征验证 | <1000ms | ~800ms |

---

## 相关文档

- [统一密钥 + FIDO2](/chainlesschain/unified-key)
- [U盾/SIMKey 基础](/chainlesschain/ukey)
- [数据加密](/chainlesschain/encryption)
- [BLE 设备管理](/chainlesschain/ble-ukey)
- [产品路线图](/chainlesschain/product-roadmap)

---

## 关键文件

| 文件 | 职责 |
|------|------|
| `desktop-app-vue/src/main/ukey/threshold-manager.js` | Shamir 密钥分割与门限签名核心 |
| `desktop-app-vue/src/main/ukey/biometric-binding.js` | 生物特征 TEE 绑定管理 |
| `desktop-app-vue/src/main/ukey/threshold-ipc.js` | 门限安全 IPC 处理器 (8个) |
| `desktop-app-vue/src/renderer/stores/thresholdSecurity.ts` | Pinia 状态管理 |
| `desktop-app-vue/src/renderer/pages/security/ThresholdSecurityPage.vue` | 门限安全管理页面 |

---

**文档版本**: 1.0.0
**最后更新**: 2026-02-27
