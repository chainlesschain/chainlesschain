# U盾固件 OTA 升级

> **Phase 53 | v1.1.0 | 4 IPC 处理器 | 2 张新数据库表**

## 核心特性

- 📦 **多通道版本管理**: STABLE/BETA/NIGHTLY 三通道固件发布与版本追踪
- 🔒 **双重安全验证**: SHA-256 完整性校验 + Ed25519 签名验证，防篡改防降级
- ⬇️ **断点续传下载**: 64KB 分块下载，网络中断可恢复，确保大固件可靠传输
- 🔄 **自动回滚保护**: 安装失败自动恢复上一版本，防止设备变砖
- 📋 **完整审计追踪**: 记录所有升级历史，支持回滚操作与故障排查

## 系统架构

```
┌────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  Vue3 前端  │────→│  IPC 处理器       │────→│  Firmware OTA    │
│  OTA 管理   │     │  firmware:*       │     │  Manager         │
└────────────┘     └──────────────────┘     └────────┬─────────┘
                                                      │
                         ┌────────────┬───────────────┼──────────┐
                         ▼            ▼               ▼          ▼
                   ┌──────────┐ ┌──────────┐  ┌──────────┐ ┌─────────┐
                   │ 版本检查 │ │ 安全下载 │  │ 签名验证 │ │ 安装 &  │
                   │ 通道管理 │ │ 断点续传 │  │ 完整性   │ │ 回滚    │
                   └──────────┘ └──────────┘  └──────────┘ └─────────┘
                         │                                       │
                         ▼                                       ▼
                   ┌──────────────┐                  ┌───────────────┐
                   │ firmware_    │                  │ firmware_      │
                   │ versions     │                  │ update_log     │
                   └──────────────┘                  └───────────────┘
```

## 概述

Phase 53 为 ChainlessChain 引入 U盾固件远程升级 (Over-The-Air) 能力，支持安全的固件版本管理、断点续传下载、签名验证和回滚保护。

**核心目标**:

- 📦 **版本管理**: 多通道固件版本管理 (STABLE/BETA/NIGHTLY)
- ⬇️ **安全下载**: 断点续传、完整性校验、签名验证
- 🔄 **安装回滚**: 安装失败自动回滚，支持手动回退
- 📋 **升级历史**: 完整的固件升级日志和审计追踪

---

## 更新通道

| 通道        | 说明       | 发布频率 | 稳定性 |
| ----------- | ---------- | -------- | ------ |
| **STABLE**  | 稳定版     | 月度     | 最高   |
| **BETA**    | 测试版     | 双周     | 中等   |
| **NIGHTLY** | 每日构建版 | 每日     | 实验性 |

---

## 核心功能

### 1. 检查更新

```javascript
// 检查固件更新
const updates = await window.electronAPI.invoke("firmware:check-updates", {
  channel: "STABLE", // 更新通道
  currentVersion: "2.1.0", // 当前固件版本
  deviceType: "ukey-v2", // 设备类型
});

console.log(updates);
// {
//   available: true,
//   latestVersion: '2.2.0',
//   releaseNotes: '安全补丁 + BLE 性能优化',
//   fileSize: 524288,
//   checksum: 'sha256:abc123...',
//   isCritical: false,
//   releasedAt: 1709078400000
// }
```

---

### 2. 版本列表

```javascript
// 获取固件版本列表
const versions = await window.electronAPI.invoke("firmware:list-versions", {
  channel: "STABLE",
  limit: 10,
});

console.log(versions);
// [
//   {
//     id: 'fw-v2.2.0',
//     version: '2.2.0',
//     channel: 'STABLE',
//     releaseNotes: '安全补丁 + BLE 性能优化',
//     fileSize: 524288,
//     checksum: 'sha256:abc123...',
//     isCritical: false,
//     releasedAt: 1709078400000
//   },
//   ...
// ]
```

---

### 3. 固件升级

```javascript
// 启动固件升级
const result = await window.electronAPI.invoke("firmware:start-update", {
  versionId: "fw-v2.2.0",
  options: {
    verifyChecksum: true, // 校验完整性
    verifySignature: true, // 验证签名
    autoRollback: true, // 安装失败自动回滚
    backupCurrent: true, // 备份当前固件
  },
});

console.log(result);
// {
//   updateId: 'upd-001',
//   status: 'COMPLETED',
//   progress: 1.0,
//   steps: [
//     { step: 'download', status: 'COMPLETED', duration: 15000 },
//     { step: 'verify', status: 'COMPLETED', duration: 2000 },
//     { step: 'install', status: 'COMPLETED', duration: 30000 },
//     { step: 'reboot', status: 'COMPLETED', duration: 5000 }
//   ],
//   previousVersion: '2.1.0',
//   installedVersion: '2.2.0'
// }
```

---

### 4. 升级历史

```javascript
// 查看升级历史
const history = await window.electronAPI.invoke("firmware:get-history", {
  limit: 20,
});

console.log(history);
// [
//   {
//     id: 'upd-001',
//     versionId: 'fw-v2.2.0',
//     fromVersion: '2.1.0',
//     toVersion: '2.2.0',
//     status: 'COMPLETED',
//     startedAt: 1709078400000,
//     completedAt: 1709078452000,
//     rollbackAvailable: true
//   }
// ]
```

---

## 升级流程

```
检查更新 → 下载固件 → 校验完整性 → 验证签名 → 备份当前 → 安装固件 → 重启验证
   │          │          │           │          │          │          │
 check     download   checksum   signature   backup    install   verify
                                                         │
                                                    失败 → 自动回滚
```

**关键安全措施**:

1. **双重校验**: SHA-256 完整性 + Ed25519 签名验证
2. **断点续传**: 64KB 分块下载，网络中断可恢复
3. **备份保护**: 安装前自动备份当前固件
4. **回滚机制**: 安装失败自动恢复上一版本

---

## 数据库结构

```sql
CREATE TABLE firmware_versions (
  id TEXT PRIMARY KEY,
  version TEXT NOT NULL,
  channel TEXT NOT NULL,         -- STABLE/BETA/NIGHTLY
  release_notes TEXT,
  file_size INTEGER,
  checksum TEXT,                 -- SHA-256 哈希
  download_url TEXT,
  is_critical INTEGER DEFAULT 0,
  released_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE firmware_update_log (
  id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL,
  from_version TEXT,
  to_version TEXT,
  status TEXT DEFAULT 'PENDING', -- PENDING/DOWNLOADING/VERIFYING/INSTALLING/COMPLETED/FAILED/ROLLED_BACK
  progress REAL DEFAULT 0,
  error_message TEXT,
  started_at INTEGER,
  completed_at INTEGER,
  created_at INTEGER NOT NULL
);
```

---

## 前端集成

### Pinia Store

```typescript
import { useFirmwareOtaStore } from "@/stores/firmwareOta";

const firmware = useFirmwareOtaStore();

// 检查更新
await firmware.checkUpdates();
console.log(firmware.hasUpdate); // true

// 查看可用版本
await firmware.fetchVersions();

// 执行升级
await firmware.startUpdate(versionId);

// 查看历史
await firmware.fetchHistory();
```

### 前端页面

**固件 OTA 管理页面** (`/firmware-ota`)

**功能模块**:

1. **更新检查**
   - 当前固件版本显示
   - 可用更新检测
   - 通道切换

2. **版本管理**
   - 版本列表和发布说明
   - 关键更新标记
   - 版本对比

3. **升级执行**
   - 一键升级
   - 进度实时显示
   - 步骤状态追踪

4. **升级历史**
   - 历史记录列表
   - 回滚操作入口
   - 失败原因查看

---

## 配置选项

```json
{
  "firmwareOta": {
    "enabled": true,
    "autoCheck": true,
    "checkInterval": 86400000,
    "defaultChannel": "STABLE",
    "autoInstallCritical": false,
    "backupBeforeUpdate": true,
    "maxRetries": 3,
    "chunkSize": 65536
  }
}
```

---

## 使用示例

### 检查并执行固件升级

```javascript
// 1. 检查是否有可用更新
const updates = await window.electronAPI.invoke('firmware:check-updates', {
  channel: 'STABLE',
  currentVersion: '2.1.0',
  deviceType: 'ukey-v2'
});

if (updates.available) {
  console.log(`发现新版本: ${updates.latestVersion}`);
  console.log(`更新说明: ${updates.releaseNotes}`);

  // 2. 执行固件升级（含安全验证和自动回滚）
  const result = await window.electronAPI.invoke('firmware:start-update', {
    versionId: `fw-v${updates.latestVersion}`,
    options: {
      verifyChecksum: true,
      verifySignature: true,
      autoRollback: true,
      backupCurrent: true
    }
  });

  console.log(`升级结果: ${result.status}`);
  console.log(`${result.previousVersion} → ${result.installedVersion}`);
}
```

### 前端 Pinia Store 集成

```typescript
import { useFirmwareOtaStore } from '@/stores/firmwareOta';

const firmware = useFirmwareOtaStore();

// 一键检查更新
await firmware.checkUpdates();
if (firmware.hasUpdate) {
  // 展示更新信息给用户确认后执行升级
  await firmware.startUpdate(firmware.latestVersion.id);
  // 升级进度通过 firmware.updateProgress 实时追踪
}

// 查看历史升级记录
await firmware.fetchHistory();
firmware.updateHistory.forEach(log => {
  console.log(`${log.fromVersion} → ${log.toVersion}: ${log.status}`);
});
```

### 回滚到上一版本

```javascript
// 查看升级历史，找到可回滚的记录
const history = await window.electronAPI.invoke('firmware:get-history', {
  limit: 5
});

const lastUpdate = history.find(h => h.rollbackAvailable);
if (lastUpdate) {
  // 执行回滚操作
  const rollback = await window.electronAPI.invoke('firmware:rollback', {
    updateId: lastUpdate.id
  });
  console.log(`已回滚到版本: ${rollback.restoredVersion}`);
}
```

## 配置参考

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | 是否启用固件 OTA 升级模块 |
| `autoCheck` | boolean | `true` | 是否在应用启动时自动检查固件更新 |
| `checkInterval` | number (ms) | `86400000` | 自动检查更新的间隔时间，默认 24 小时 |
| `defaultChannel` | string | `"STABLE"` | 默认更新通道：`STABLE` / `BETA` / `NIGHTLY` |
| `autoInstallCritical` | boolean | `false` | 是否自动安装标记为关键安全的固件更新 |
| `backupBeforeUpdate` | boolean | `true` | 升级前是否自动备份当前固件版本 |
| `maxRetries` | number | `3` | 下载或安装失败后的最大重试次数 |
| `chunkSize` | number (bytes) | `65536` | 断点续传的分块大小，默认 64 KB |

**配置示例**（企业受控环境，禁用自动安装）:

```json
{
  "firmwareOta": {
    "enabled": true,
    "autoCheck": true,
    "checkInterval": 43200000,
    "defaultChannel": "STABLE",
    "autoInstallCritical": false,
    "backupBeforeUpdate": true,
    "maxRetries": 5,
    "chunkSize": 131072
  }
}
```

> **注意**: `autoInstallCritical: true` 会在无需用户确认的情况下自动重启 U盾设备，生产环境请谨慎启用。

---

## 测试覆盖

### 单元测试

| 测试文件 | 覆盖场景 | 用例数 |
| --- | --- | --- |
| `tests/unit/ukey/firmware-ota-manager.test.js` | 版本检查、下载分块、回滚逻辑 | 22 |
| `tests/unit/ukey/firmware-ota-checksum.test.js` | SHA-256 完整性校验、篡改检测 | 12 |
| `tests/unit/ukey/firmware-ota-signature.test.js` | Ed25519 签名验证、公钥加载 | 10 |
| `tests/unit/ukey/firmware-ota-ipc.test.js` | 4 个 IPC 处理器输入验证与响应格式 | 18 |

### 集成测试

```bash
# 运行固件 OTA 模块全量测试
cd desktop-app-vue && npx vitest run tests/unit/ukey/firmware-ota

# 仅运行安全验证相关用例
cd desktop-app-vue && npx vitest run tests/unit/ukey/firmware-ota-checksum tests/unit/ukey/firmware-ota-signature

# 运行 Pinia store 测试
cd desktop-app-vue && npx vitest run src/renderer/stores/__tests__/firmwareOta.test.ts
```

### 关键测试场景

```javascript
// 断点续传恢复
it('resumes download from last chunk offset after network interruption', async () => { ... });

// 完整性校验失败回退
it('aborts installation and rejects when SHA-256 mismatch', async () => { ... });

// 签名验证拒绝无效包
it('rejects firmware with invalid Ed25519 signature', async () => { ... });

// 安装失败自动回滚
it('auto-rolls back to previous version when install fails', async () => { ... });

// 降级攻击防护
it('rejects firmware version lower than current installed version', async () => { ... });
```

---

## 安全考虑

1. **签名验证**: 所有固件包使用 Ed25519 签名验证
2. **完整性校验**: SHA-256 哈希校验防篡改
3. **安全通道**: 固件下载强制 HTTPS/TLS
4. **回滚保护**: 安装失败自动恢复，防止变砖
5. **版本锁定**: 防止降级攻击，禁止安装低版本

---

## 性能指标

| 指标             | 目标   | 实际   |
| ---------------- | ------ | ------ |
| 更新检查延迟     | <2s    | ~1s    |
| 固件下载 (512KB) | <30s   | ~15s   |
| 签名验证延迟     | <500ms | ~200ms |
| 安装执行延迟     | <60s   | ~30s   |

---

## 故障排查

| 症状 | 可能原因 | 解决方案 |
| --- | --- | --- |
| 更新下载失败或中断 | 网络不稳定或固件服务器不可达 | 检查网络连接，系统支持断点续传，重新调用 `firmware:start-update` 会自动从断点恢复 |
| 校验失败（checksum 不匹配） | 下载过程中数据损坏或文件被篡改 | 删除已下载的固件缓存，重新下载；若多次失败，确认固件服务器 SHA-256 哈希值是否正确 |
| 安装后自动回滚到旧版本 | 固件安装过程出错或新固件启动自检失败 | 查看 `firmware:get-history` 中的 `error_message` 字段定位失败原因，尝试切换到 BETA 通道测试 |
| 连接 U 盾超时 | USB/BLE 连接不稳定或设备未就绪 | 重新插拔 U 盾或重新配对 BLE 连接，确认设备驱动正常加载，Windows 下检查设备管理器状态 |
| 版本号不匹配（显示旧版本） | 安装完成但设备未正确重启或版本缓存未刷新 | 手动重启 U 盾设备，调用 `firmware:check-updates` 刷新本地版本缓存 |

**常见修复操作**:

```bash
# 清除固件下载缓存并重新检查更新
chainlesschain firmware clear-cache && chainlesschain firmware check --channel STABLE

# 查看最近升级日志，排查失败原因
chainlesschain firmware history --limit 5 --verbose
```

## 相关文档

- [U盾集成](/chainlesschain/ukey)
- [BLE U-Key](/chainlesschain/ble-ukey)
- [统一密钥 + FIDO2](/chainlesschain/unified-key)
- [产品路线图](/chainlesschain/product-roadmap)

## 关键文件

| 文件 | 职责 |
| --- | --- |
| `src/main/ukey/firmware-ota-manager.js` | 固件 OTA 核心引擎（版本管理/下载/安装/回滚） |
| `src/main/ukey/firmware-ota-ipc.js` | IPC 处理器（4 个通道） |
| `src/renderer/stores/firmwareOta.ts` | Pinia 状态管理 |
| `src/renderer/pages/security/FirmwareOtaPage.vue` | 固件 OTA 管理页面 |

---

**文档版本**: 1.0.0
**最后更新**: 2026-02-27
