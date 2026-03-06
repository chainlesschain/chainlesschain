# U盾固件 OTA 升级

> **Phase 53 | v1.1.0 | 4 IPC 处理器 | 2 张新数据库表**

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

## 相关文档

- [U盾集成](/chainlesschain/ukey)
- [BLE U-Key](/chainlesschain/ble-ukey)
- [统一密钥 + FIDO2](/chainlesschain/unified-key)
- [产品路线图](/chainlesschain/product-roadmap)

---

**文档版本**: 1.0.0
**最后更新**: 2026-02-27
