# 开放硬件安全标准 (HSM Adapter)

> **版本: v3.2.0 | 状态: ✅ 生产就绪 | 4 IPC Handlers | 1 数据库表 | FIPS 140-3 合规**

ChainlessChain HSM Adapter 提供统一的硬件安全模块（HSM）接口，支持 YubiKey、Ledger、Trezor 等主流硬件设备的自动发现、连接和加密操作。系统内置 FIPS 140-3 合规追踪，确保所有密码学操作满足企业级安全标准。

## 概述

HSM Adapter 模块为多厂商硬件安全设备（YubiKey、Ledger、Trezor 及通用 PKCS#11 设备）提供统一的连接和加密操作接口，支持 RSA-2048、ECDSA-P256、ML-KEM-768 等算法。系统内置 FIPS 140-3 合规等级评估和实时状态监控，通过 4 个 IPC 接口提供设备管理、加密操作和合规报告能力。

## 核心特性

- 🔌 **多厂商统一接口**: 支持 YubiKey、Ledger、Trezor 及通用 HSM 设备
- 🏛️ **FIPS 140-3 合规**: 自动追踪设备合规状态，提供合规等级评估
- 🔍 **自动设备发现**: 连接时自动识别型号、序列号、固件版本
- 🔐 **统一加密操作**: RSA-2048、ECDSA-P256、ML-KEM-768 等算法支持
- 📊 **合规状态监控**: 实时统计设备连接状态和合规级别

## 系统架构

```
┌────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  Vue3 前端  │────→│  IPC 处理器       │────→│  HSM Adapter     │
│  设备管理   │     │  hsm:*            │     │  Manager         │
└────────────┘     └──────────────────┘     └────────┬─────────┘
                                                      │
                                          ┌───────────┼───────────┐
                                          ▼           ▼           ▼
                                    ┌──────────┐ ┌─────────┐ ┌─────────┐
                                    │ YubiKey  │ │ Ledger  │ │ Trezor  │
                                    │ Adapter  │ │ Adapter │ │ Adapter │
                                    └────┬─────┘ └────┬────┘ └────┬────┘
                                         │            │           │
                                         └─────┬──────┘───────────┘
                                               ▼
                                    ┌───────────────────┐
                                    │  FIPS 140-3 合规   │
                                    │  追踪 & 评估       │
                                    └───────────────────┘
```

## 支持的设备厂商

| 厂商    | 常量值    | FIPS 合规 | 说明                 |
| ------- | --------- | --------- | -------------------- |
| YubiKey | `yubikey` | ✅ 默认   | FIDO2/PIV/PGP 多协议 |
| Ledger  | `ledger`  | 需验证    | 加密货币硬件钱包     |
| Trezor  | `trezor`  | 需验证    | 开源硬件钱包         |
| 通用    | `generic` | 需验证    | PKCS#11 兼容设备     |

## 连接设备

```javascript
const result = await window.electron.ipcRenderer.invoke("hsm:connect-device", {
  vendor: "yubikey",
  model: "YubiKey 5 NFC",
  serialNumber: "12345678",
  firmwareVersion: "5.4.3",
  supportedAlgorithms: ["RSA-2048", "ECDSA-P256", "ML-KEM-768"],
});
// result.adapter = {
//   id: "uuid",
//   vendor: "yubikey",
//   status: "connected",
//   fips_compliant: 1,
//   ...
// }
```

## 执行加密操作

```javascript
const result = await window.electron.ipcRenderer.invoke(
  "hsm:execute-operation",
  {
    adapterId: "adapter-001",
    operation: "sign", // sign | verify | encrypt | decrypt | generateKey
    params: {
      algorithm: "ECDSA-P256",
      data: "待签名数据的哈希值",
    },
  },
);
// result.result = { operation: "sign", result: "sign completed", executedAt: ... }
```

## 查询合规状态

```javascript
const result = await window.electron.ipcRenderer.invoke(
  "hsm:get-compliance-status",
);
// result.status = {
//   totalAdapters: 3,
//   fipsCompliant: 2,
//   connected: 3,
//   complianceLevel: "partial",     // "FIPS-140-3" | "partial"
// }
```

## IPC 接口完整列表

### HSM Adapter 操作（4 个）

| 通道                        | 功能            | 说明                         |
| --------------------------- | --------------- | ---------------------------- |
| `hsm:list-adapters`         | 列出 HSM 适配器 | 支持按厂商/状态过滤          |
| `hsm:connect-device`        | 连接 HSM 设备   | 自动识别型号和能力           |
| `hsm:execute-operation`     | 执行加密操作    | 签名/验签/加密/解密/生成密钥 |
| `hsm:get-compliance-status` | 查询合规状态    | FIPS 140-3 合规等级          |

## 数据库 Schema

**1 张核心表**:

### hsm_adapters 表

```sql
CREATE TABLE IF NOT EXISTS hsm_adapters (
  id TEXT PRIMARY KEY,
  vendor TEXT NOT NULL,                  -- yubikey | ledger | trezor | generic
  model TEXT,
  serial_number TEXT,
  firmware_version TEXT,
  status TEXT DEFAULT 'disconnected',    -- connected | disconnected
  fips_compliant INTEGER DEFAULT 0,
  supported_algorithms TEXT,             -- JSON: ["RSA-2048", "ECDSA-P256", ...]
  last_connected INTEGER,
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_hsm_adapters_vendor ON hsm_adapters(vendor);
CREATE INDEX IF NOT EXISTS idx_hsm_adapters_status ON hsm_adapters(status);
```

## 前端集成

### HSMAdapterPage 页面

**功能模块**:

- **统计卡片**: 总适配器数 / FIPS 合规数 / 已连接数 / 合规等级
- **设备列表**: 展示厂商、型号、序列号、固件版本、状态
- **连接操作**: 选择厂商并连接新设备
- **合规报告**: 展示整体合规状态

### Pinia Store (hsmAdapter.ts)

```typescript
const useHsmAdapterStore = defineStore("hsmAdapter", {
  state: () => ({
    adapters: [],
    complianceStatus: null,
    loading: false,
    error: null,
  }),
  actions: {
    fetchAdapters, // → hsm:list-adapters
    connectDevice, // → hsm:connect-device
    executeOperation, // → hsm:execute-operation
    fetchComplianceStatus, // → hsm:get-compliance-status
  },
});
```

## 关键文件

| 文件                                             | 职责               | 行数 |
| ------------------------------------------------ | ------------------ | ---- |
| `src/main/ukey/hsm-adapter-manager.js`           | HSM 适配器核心引擎 | ~193 |
| `src/main/ukey/hsm-adapter-ipc.js`               | IPC 处理器（4 个） | ~113 |
| `src/renderer/stores/hsmAdapter.ts`              | Pinia 状态管理     | ~80  |
| `src/renderer/pages/security/HSMAdapterPage.vue` | HSM 适配器页面     | ~90  |

## 测试覆盖率

```
✅ hsm-adapter-manager.test.js         - 设备连接/操作/合规测试
✅ stores/hsmAdapter.test.ts           - Store 状态管理测试
✅ e2e/security/hsm-adapter.e2e.test.ts - 端到端用户流程测试
```

## 使用示例

### 示例 1: 连接 YubiKey 并执行签名

```javascript
// 1. 连接 YubiKey 设备
const adapter = await window.electron.ipcRenderer.invoke("hsm:connect-device", {
  vendor: "yubikey",
  model: "YubiKey 5 NFC",
  serialNumber: "12345678",
  firmwareVersion: "5.4.3",
  supportedAlgorithms: ["RSA-2048", "ECDSA-P256", "ML-KEM-768"],
});
console.log(`设备已连接: ${adapter.adapter.id}, FIPS: ${adapter.adapter.fips_compliant}`);

// 2. 使用设备执行 ECDSA 签名
const signResult = await window.electron.ipcRenderer.invoke("hsm:execute-operation", {
  adapterId: adapter.adapter.id,
  operation: "sign",
  params: { algorithm: "ECDSA-P256", data: "待签名数据摘要" },
});
console.log(`签名完成: ${signResult.result.executedAt}`);

// 3. 查看整体合规状态
const compliance = await window.electron.ipcRenderer.invoke("hsm:get-compliance-status");
console.log(`合规等级: ${compliance.status.complianceLevel}, FIPS设备: ${compliance.status.fipsCompliant}/${compliance.status.totalAdapters}`);
```

### 示例 2: 列出设备并生成密钥

```javascript
// 列出所有已连接的 HSM 适配器
const adapters = await window.electron.ipcRenderer.invoke("hsm:list-adapters");
adapters.forEach(a => console.log(`[${a.vendor}] ${a.model} - ${a.status}`));

// 在指定设备上生成新密钥对
const keyResult = await window.electron.ipcRenderer.invoke("hsm:execute-operation", {
  adapterId: adapters[0].id,
  operation: "generateKey",
  params: { algorithm: "RSA-2048" },
});
console.log(`密钥生成完成: ${keyResult.result.result}`);
```

---

## 故障排查

| 问题 | 可能原因 | 解决方案 |
| --- | --- | --- |
| 设备连接失败 | USB 驱动未安装或设备未插入 | 确认设备已正确连接，安装对应厂商的驱动程序 |
| 加密操作超时 | 设备繁忙或通信中断 | 拔插设备重新连接，检查 USB 线缆是否松动 |
| FIPS 合规状态为 `partial` | 存在非 FIPS 认证的设备 | 替换为 FIPS 140-3 认证设备（如 YubiKey FIPS 版） |
| 算法不支持 | 设备固件版本过低 | 升级设备固件，或选择设备 `supportedAlgorithms` 中列出的算法 |
| PKCS#11 通用设备不识别 | 缺少 PKCS#11 中间件 | 安装设备厂商提供的 PKCS#11 库，配置库文件路径 |
| 设备列表为空 | 未执行过连接操作 | 先调用 `hsm:connect-device` 注册设备到系统中 |

---

## 安全考虑

1. **硬件隔离**: 私钥始终保存在 HSM 硬件内部，不会导出到主机内存
2. **FIPS 合规**: 优先使用 FIPS 140-3 认证设备，合规状态实时监控
3. **PIN 保护**: HSM 操作需要 PIN 验证，防止未授权的物理访问
4. **操作审计**: 所有加密操作（签名/加密/生成密钥）均记录到审计日志
5. **固件验证**: 连接时自动检测设备固件版本，过低版本会提示升级

---

## 相关文档

- [U-Key 硬件密钥 →](/chainlesschain/ukey)
- [Trinity Trust Root 信任根 →](/chainlesschain/trust-root)
- [PQC Ecosystem 后量子密码 →](/chainlesschain/pqc-ecosystem)
- [加密系统 →](/chainlesschain/encryption)
