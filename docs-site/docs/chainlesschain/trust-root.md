# Trinity Trust Root 三位一体信任根

> **版本: v3.2.0 | 状态: ✅ 生产就绪 | 5 IPC Handlers | 2 数据库表 | U-Key + SIMKey + TEE**

ChainlessChain Trinity Trust Root 实现了 U-Key + SIMKey + TEE 三位一体的统一信任根体系。通过证明链验证、安全启动校验、硬件指纹绑定和跨设备密钥同步，构建从硬件到应用的完整信任链路。

## 核心特性

- 🔐 **证明链验证**: U-Key → SIMKey → TEE 三步证明链，逐层验证硬件可信
- 🖥️ **安全启动校验**: 验证设备安全启动状态，防止固件篡改
- 🔑 **硬件指纹绑定**: 将密钥与硬件指纹绑定，防止密钥迁移攻击
- 🔄 **跨设备密钥同步**: 加密传输密钥到可信设备，支持多设备协同
- 📊 **信任状态监控**: 实时追踪所有设备的信任等级（已验证/未验证/已妥协）

## 信任等级

| 等级          | 说明             | 颜色 |
| ------------- | ---------------- | ---- |
| `verified`    | 三重验证通过     | 绿色 |
| `unverified`  | 待验证或部分验证 | 黄色 |
| `compromised` | 检测到安全威胁   | 红色 |
| `pending`     | 验证进行中       | 灰色 |

## 验证信任链

```javascript
// 执行三步证明链验证
const result = await window.electron.ipcRenderer.invoke(
  "trust-root:verify-chain",
  "device-001",
);
// result.attestation = {
//   id: "uuid",
//   device_id: "device-001",
//   trust_level: "verified",
//   ukey_status: "connected",
//   simkey_status: "active",
//   tee_status: "supported",
//   attestation_chain: [
//     { step: "ukey_check", passed: true },
//     { step: "simkey_verify", passed: true },
//     { step: "tee_attest", passed: true },
//   ],
//   boot_verified: 1,
// }
```

## 跨设备密钥同步

```javascript
const result = await window.electron.ipcRenderer.invoke(
  "trust-root:sync-keys",
  {
    sourceDevice: "device-001",
    targetDevice: "device-002",
    keyType: "master", // master | signing | encryption
  },
);
// result.syncRecord = { id, sync_status: "completed", verified: 1, ... }
```

## 绑定硬件指纹

```javascript
const result = await window.electron.ipcRenderer.invoke(
  "trust-root:bind-fingerprint",
  {
    deviceId: "device-001",
    fingerprint: "hw_fp_abc123def456",
  },
);
```

## 系统架构

```
┌──────────────────────────────────────────────────┐
│              Trinity Trust Root                    │
│                                                    │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐│
│  │  U-Key    │  │  SIMKey   │  │  TEE             ││
│  │  Check    │→ │  Verify   │→ │  Attest          ││
│  │          │  │           │  │                  ││
│  │ 硬件连接  │  │ SIM 验证   │  │ 可信环境认证     ││
│  └──────────┘  └──────────┘  └──────────────────┘│
│         │              │              │            │
│         ▼              ▼              ▼            │
│  ┌────────────────────────────────────────────┐   │
│  │        Attestation Chain (证明链)            │   │
│  │  trust_level: verified | unverified         │   │
│  └─────────────────┬──────────────────────────┘   │
│                    │                               │
│  ┌─────────────────┴──────────────────────────┐   │
│  │     Cross-Device Key Sync (跨设备密钥同步)   │   │
│  │  加密传输 → 验证 → 绑定硬件指纹              │   │
│  └────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────┘
```

## IPC 接口完整列表

### Trust Root 操作（5 个）

| 通道                          | 功能           | 说明                         |
| ----------------------------- | -------------- | ---------------------------- |
| `trust-root:get-status`       | 查询信任根状态 | 设备数、验证数、最后验证时间 |
| `trust-root:verify-chain`     | 执行证明链验证 | U-Key → SIMKey → TEE 三步    |
| `trust-root:sync-keys`        | 跨设备密钥同步 | 加密传输到可信目标设备       |
| `trust-root:bind-fingerprint` | 绑定硬件指纹   | 将密钥与设备指纹绑定         |
| `trust-root:get-boot-status`  | 查询安全启动   | 已验证/未验证设备统计        |

## 数据库 Schema

**2 张核心表**:

| 表名                      | 用途         | 关键字段                                                |
| ------------------------- | ------------ | ------------------------------------------------------- |
| `trust_root_attestations` | 证明链记录   | id, device_id, trust_level, attestation_chain (JSON)    |
| `cross_device_key_sync`   | 密钥同步记录 | id, source_device, target_device, sync_status, verified |

### trust_root_attestations 表

```sql
CREATE TABLE IF NOT EXISTS trust_root_attestations (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  trust_level TEXT DEFAULT 'unverified',
  ukey_status TEXT,
  simkey_status TEXT,
  tee_status TEXT,
  attestation_chain TEXT,            -- JSON: 三步验证结果
  hardware_fingerprint TEXT,
  boot_verified INTEGER DEFAULT 0,
  last_verified INTEGER,
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_trust_attestations_device ON trust_root_attestations(device_id);
CREATE INDEX IF NOT EXISTS idx_trust_attestations_level ON trust_root_attestations(trust_level);
```

### cross_device_key_sync 表

```sql
CREATE TABLE IF NOT EXISTS cross_device_key_sync (
  id TEXT PRIMARY KEY,
  source_device TEXT NOT NULL,
  target_device TEXT NOT NULL,
  key_type TEXT,
  sync_status TEXT DEFAULT 'pending',
  encrypted_key_data TEXT,
  verified INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_key_sync_status ON cross_device_key_sync(sync_status);
```

## 前端集成

### TrustRootPage 页面

**功能模块**:

- **统计卡片**: 设备数 / 已验证 / 安全启动 / 未验证
- **验证操作**: 输入设备 ID，执行信任链验证
- **错误提示**: Alert 组件展示错误信息

### Pinia Store (trustRoot.ts)

```typescript
const useTrustRootStore = defineStore("trustRoot", {
  state: () => ({
    status: null,
    bootStatus: null,
    loading: false,
    error: null,
  }),
  actions: {
    fetchStatus, // → trust-root:get-status
    verifyChain, // → trust-root:verify-chain
    syncKeys, // → trust-root:sync-keys
    bindFingerprint, // → trust-root:bind-fingerprint
    fetchBootStatus, // → trust-root:get-boot-status
  },
});
```

## 关键文件

| 文件                                            | 职责               | 行数 |
| ----------------------------------------------- | ------------------ | ---- |
| `src/main/ukey/trust-root-manager.js`           | 信任根核心引擎     | ~260 |
| `src/main/ukey/trust-root-ipc.js`               | IPC 处理器（5 个） | ~133 |
| `src/renderer/stores/trustRoot.ts`              | Pinia 状态管理     | ~80  |
| `src/renderer/pages/security/TrustRootPage.vue` | 信任根页面         | ~83  |

## 测试覆盖率

```
✅ trust-root-manager.test.js          - 证明链/指纹/密钥同步测试
✅ stores/trustRoot.test.ts            - Store 状态管理测试
✅ e2e/security/trust-root.e2e.test.ts - 端到端用户流程测试
```

## 相关文档

- [U-Key 硬件密钥 →](/chainlesschain/ukey)
- [PQC Ecosystem 后量子密码 →](/chainlesschain/pqc-ecosystem)
- [HSM Adapter 硬件安全模块 →](/chainlesschain/hsm-adapter)
- [加密系统 →](/chainlesschain/encryption)
