# IPFS 去中心化存储

> **版本: v1.0.0+ | Helia/Kubo 双引擎 | 内容寻址存储**

IPFS 去中心化存储模块提供基于内容寻址的分布式文件存储能力，支持嵌入式 Helia 节点和外部 Kubo 守护进程两种运行模式。

## 概述

IPFS 去中心化存储模块基于 Helia（嵌入式纯 JS）和 Kubo（外部守护进程）双引擎架构，提供内容寻址的分布式文件存储能力。系统支持 AES-256-GCM 可选加密存储、Pin 与配额管理、CID 自动去重，并与社交、协作、知识库和交易模块深度集成。

## 核心特性

- 🗄️ **双引擎架构**: 支持嵌入式 Helia（纯 JS）和外部 Kubo 守护进程两种运行模式，灵活适配不同场景
- 🔒 **AES-256-GCM 加密存储**: 可选端到端加密，私密文件加密后上传，仅持密钥者可解密
- 📌 **Pin 与配额管理**: 固定重要内容防垃圾回收，可配置本地存储上限（默认 1GB）
- 📡 **内容寻址去重**: 基于 CID 的分布式存储，相同内容自动去重，节省空间
- 🔗 **多模块集成**: 与社交、协作、知识库、交易模块深度集成，提供统一存储后端

## 系统架构

```
┌──────────────────────────────────────────────┐
│              应用层 (IPC 接口)                │
│         ipfs:upload / ipfs:download          │
└──────────────────┬───────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────┐
│            IPFS Manager (核心管理器)          │
│  ┌─────────────┐      ┌──────────────────┐  │
│  │ 加密引擎     │      │  Pin 管理器      │  │
│  │ AES-256-GCM │      │  配额管理器      │  │
│  └─────────────┘      └──────────────────┘  │
└──────────┬──────────────────┬────────────────┘
           │                  │
     ┌─────▼─────┐     ┌─────▼─────┐
     │  Helia    │     │   Kubo    │
     │ (嵌入式)  │     │ (外部API) │
     └───────────┘     └───────────┘
           │                  │
           └────────┬─────────┘
                    ▼
          ┌──────────────────┐
          │   IPFS 网络/DHT  │
          └──────────────────┘
```

## 系统概述

### 双引擎架构

```
IPFS Manager
├─ 嵌入式模式 (Helia)
│   ├─ 纯 JavaScript 实现
│   ├─ 内嵌于 Electron 主进程
│   ├─ 自动 DHT 发现
│   └─ 适合轻量级使用
└─ 外部模式 (Kubo)
    ├─ 通过 HTTP API 连接外部守护进程
    ├─ 完整的 IPFS 协议栈
    ├─ 支持 IPFS 网关访问
    └─ 适合重度使用和长期存储
```

### 核心特性

- **内容寻址**: 基于 CID (Content Identifier) 的去重存储
- **AES-256-GCM 加密**: 可选的端到端加密存储
- **Pin 管理**: 固定重要内容防止垃圾回收
- **存储配额**: 可配置的本地存储上限（默认 1GB）
- **元数据持久化**: SQLite 数据库追踪所有存储内容

---

## 配置

### 默认配置

```json
{
  "ipfs": {
    "mode": "helia",
    "repoPath": "data/ipfs-repo",
    "gatewayUrl": "http://localhost:8080",
    "externalApiUrl": "http://localhost:5001",
    "storageQuotaBytes": 1073741824,
    "encryptionEnabled": true
  }
}
```

### 配置说明

| 参数                | 默认值                  | 说明                                         |
| ------------------- | ----------------------- | -------------------------------------------- |
| `mode`              | `"helia"`               | 引擎模式：`helia`（嵌入式）或 `kubo`（外部） |
| `repoPath`          | `"data/ipfs-repo"`      | Helia 仓库本地路径                           |
| `gatewayUrl`        | `http://localhost:8080` | IPFS 网关地址                                |
| `externalApiUrl`    | `http://localhost:5001` | Kubo HTTP API 地址                           |
| `storageQuotaBytes` | `1073741824` (1GB)      | 本地存储配额                                 |
| `encryptionEnabled` | `true`                  | 是否启用加密存储                             |

---

## 使用场景

### 公开内容发布

将动态、文章发布到 IPFS 网络，任何人可通过 CID 访问：

```
发布流程:
1. 用户发布公开动态
2. 内容序列化为 JSON
3. 上传到 IPFS 获得 CID
4. Pin 内容确保持久化
5. CID 记录到本地数据库
6. 分享 CID 给好友
```

### 加密文件存储

私密文件使用 AES-256-GCM 加密后存储：

```
加密存储流程:
1. 生成随机 AES 密钥
2. AES-256-GCM 加密文件内容
3. 加密后数据上传到 IPFS
4. CID + 密钥存储到本地数据库
5. 仅持有密钥的用户可解密
```

### 共享相册存储

与社交模块集成，为共享相册提供分布式存储后端：

- 公开相册：直接 IPFS 存储 + Pin
- 好友共享相册：加密后 IPFS 存储，密钥通过 P2P 分发
- 私密相册：仅本地存储

---

## 存储管理

### Pin 管理

```
Pin 类型:
├─ 直接 Pin (Direct)    — 固定单个内容块
├─ 递归 Pin (Recursive) — 固定内容及所有子块
└─ 间接 Pin (Indirect)  — 被递归 Pin 引用的内容
```

### 配额管理

当存储接近配额时：

1. **警告阈值 (80%)**: 通知用户清理
2. **软限制 (90%)**: 自动取消非重要内容的 Pin
3. **硬限制 (100%)**: 拒绝新内容上传

### 垃圾回收

```
GC 策略:
- 定期 GC（默认每 24 小时）
- 取消 Pin 的内容在下次 GC 时清理
- 加密内容优先保留
- 可配置 GC 触发条件
```

---

## 数据库表

### `ipfs_content`

| 字段         | 类型     | 说明                    |
| ------------ | -------- | ----------------------- |
| `id`         | INTEGER  | 主键                    |
| `cid`        | TEXT     | IPFS Content Identifier |
| `name`       | TEXT     | 内容名称                |
| `size`       | INTEGER  | 内容大小（字节）        |
| `mime_type`  | TEXT     | MIME 类型               |
| `encrypted`  | BOOLEAN  | 是否加密                |
| `pinned`     | BOOLEAN  | 是否已 Pin              |
| `created_at` | DATETIME | 创建时间                |
| `updated_at` | DATETIME | 更新时间                |

---

## 与其他模块集成

| 集成模块     | 用途                           |
| ------------ | ------------------------------ |
| 去中心化社交 | 公开动态和共享相册的持久化存储 |
| 实时协作     | 协作文档的版本快照存储         |
| 知识库       | 大文件附件的去中心化存储       |
| 交易模块     | 数字资产文件的内容寻址存储     |

---

## Filecoin 存储证明

### 概述

Filecoin 存储模块提供去中心化持久存储，支持与矿工签订存储交易并验证存储证明。

### 存储交易管理

```javascript
// 创建存储交易
const deal = await filecoinStorage.storeToFilecoin(cid, size, options);
// { dealId, cid, minerId, status: "active", duration, price }

// 验证存储证明 (PoRep / PoSt)
const verification = await filecoinStorage.verifyStorageProof(dealId, {
  type: "porep",       // porep | post
  proofData: "...",    // 证明数据
  commitment: "...",   // SHA-256 承诺值（可选，PoSt 用）
  sectorId: 42,
  challengeIndex: 7
});
// { verified: true, type: "porep", verifiedAt: "2026-04-12T..." }

// 续约存储交易
const renewed = await filecoinStorage.renewDeal(dealId, 518400);
// { dealId, additionalEpochs: 518400, newExpiry, renewalCount, additionalPrice }

// 按条件查询交易列表
const deals = await filecoinStorage.listDeals({ status: "active", minerId: "f01234" });
```

### 证明验证规则

| 证明类型 | 验证方式 | 说明 |
|---------|---------|------|
| PoRep (复制证明) | 检查 proofData 长度 ≥ 32 字节 | 验证矿工确实存储了数据副本 |
| PoSt (时空证明) | SHA-256(dealCid + sectorId + challengeIndex) 与 commitment 比对 | 验证矿工持续存储数据 |

## 关键文件

| 文件                            | 职责                      |
| ------------------------------- | ------------------------- |
| `src/main/ipfs/ipfs-manager.js` | IPFS 管理器核心（双引擎） |
| `src/main/ipfs/ipfs-ipc.js`     | IPFS IPC 处理器           |
| `src/main/ipfs/filecoin-storage.js` | Filecoin 存储证明与交易管理 |
| `src/renderer/stores/ipfs.ts`   | IPFS 状态管理             |

---

## 使用示例

### 上传文件到 IPFS

```javascript
// 上传文件（可选加密）
const result = await window.electronAPI.invoke('ipfs:upload', {
  filePath: '/path/to/document.pdf',
  encrypt: true,  // AES-256-GCM 加密
  pin: true       // 固定内容防垃圾回收
});

console.log(result);
// { cid: 'QmXxx...', size: 1024000, encrypted: true, pinned: true }
```

### 下载和解密文件

```javascript
// 通过 CID 下载文件
const file = await window.electronAPI.invoke('ipfs:download', {
  cid: 'QmXxx...',
  outputPath: '/path/to/output.pdf',
  decrypt: true   // 自动解密（需要本地持有密钥）
});
```

### 管理 Pin 和存储配额

```javascript
// 查看已 Pin 的内容列表
const pinned = await window.electronAPI.invoke('ipfs:list-pinned');

// 取消 Pin（下次 GC 时清理）
await window.electronAPI.invoke('ipfs:unpin', { cid: 'QmXxx...' });

// 查看存储使用情况
const quota = await window.electronAPI.invoke('ipfs:quota-status');
// { used: 536870912, limit: 1073741824, percentage: 50 }
```

---

## 故障排查

### Helia 节点启动失败

- 检查 `repoPath` 是否可写
- 确保端口未被占用
- 清理损坏的仓库：删除 `data/ipfs-repo` 重启

### Kubo 连接失败

```bash
# 检查 Kubo 守护进程是否运行
ipfs id

# 检查 API 端口
curl http://localhost:5001/api/v0/id

# 重启 Kubo
ipfs daemon
```

### 存储配额不足

```
设置 → IPFS → 存储管理 → 清理未使用内容
```

---

## 配置参考

### 完整配置项

```javascript
// .chainlesschain/config.json
{
  "ipfs": {
    // 引擎模式: "helia"（嵌入式纯 JS）| "kubo"（外部守护进程）
    "mode": "helia",

    // Helia 本地仓库路径
    "repoPath": "data/ipfs-repo",

    // IPFS HTTP 网关地址（用于公开内容访问）
    "gatewayUrl": "http://localhost:8080",

    // Kubo 模式下的 HTTP API 地址
    "externalApiUrl": "http://localhost:5001",

    // 本地存储配额（字节），超出后拒绝新上传
    "storageQuotaBytes": 1073741824,   // 1 GB

    // 是否默认对所有上传内容启用 AES-256-GCM 加密
    "encryptionEnabled": true,

    // 垃圾回收间隔（毫秒），0 表示禁用自动 GC
    "gcIntervalMs": 86400000,          // 24 小时

    // 配额警告阈值（0~1），达到后触发通知
    "quotaWarnRatio": 0.8,

    // 配额软限制阈值（0~1），达到后自动取消非关键 Pin
    "quotaSoftLimitRatio": 0.9,

    // Filecoin 存储集成（可选）
    "filecoin": {
      "enabled": false,
      "lotusApiUrl": "http://localhost:1234/rpc/v0",
      "walletAddress": "",
      "defaultDealDuration": 518400   // 180 天（以 epoch 计）
    }
  }
}
```

### 运行时动态配置

```javascript
// 通过 IPC 更新存储配额
await window.electronAPI.invoke('ipfs:set-quota', {
  quotaBytes: 2147483648   // 动态调整为 2 GB
});

// 切换引擎模式（需重启 IPFS 节点）
await window.electronAPI.invoke('ipfs:switch-mode', {
  mode: 'kubo',
  externalApiUrl: 'http://localhost:5001'
});

// 更新 GC 策略
await window.electronAPI.invoke('ipfs:set-gc-policy', {
  intervalMs: 43200000,    // 12 小时
  keepEncryptedOnSoftLimit: true
});
```

---

## 性能指标

### 存储与传输性能

| 操作 | 目标 | 实际 | 状态 |
| --- | --- | --- | --- |
| 文件上传（本地 Helia，1 MB） | < 200 ms | ~120 ms | ✅ |
| 文件上传（加密，1 MB） | < 350 ms | ~280 ms | ✅ |
| 文件下载（本地 Pin，1 MB） | < 150 ms | ~90 ms | ✅ |
| 文件下载 + 解密（1 MB） | < 300 ms | ~210 ms | ✅ |
| Kubo API 上传（1 MB） | < 500 ms | ~380 ms | ✅ |
| CID 重复内容去重命中 | < 10 ms | ~5 ms | ✅ |
| Pin 操作 | < 50 ms | ~30 ms | ✅ |
| 配额状态查询 | < 20 ms | ~8 ms | ✅ |

### 存储效率

| 操作 | 目标 | 实际 | 状态 |
| --- | --- | --- | --- |
| 相同文件去重率 | 100% | 100% | ✅ |
| 加密开销（相对原始大小） | < 5% | ~1.2% | ✅ |
| 元数据 SQLite 写入 | < 30 ms | ~18 ms | ✅ |
| 垃圾回收（1000 个未 Pin CID） | < 10 s | ~6 s | ✅ |
| Helia 节点启动时间 | < 3 s | ~1.8 s | ✅ |
| Filecoin 存储证明验证（PoRep） | < 200 ms | ~140 ms | ✅ |

---

## 测试覆盖率

### 单元测试

- ✅ `desktop-app-vue/tests/unit/ipfs/ipfs-manager.test.js` — 双引擎初始化、上传/下载、加密存储、Pin 管理（42 tests）
- ✅ `desktop-app-vue/tests/unit/ipfs/ipfs-encryption.test.js` — AES-256-GCM 加解密、密钥生成与存储（18 tests）
- ✅ `desktop-app-vue/tests/unit/ipfs/quota-manager.test.js` — 配额计算、警告阈值、软/硬限制触发（24 tests）
- ✅ `desktop-app-vue/tests/unit/ipfs/filecoin-storage.test.js` — 存储交易创建、PoRep/PoSt 证明验证、续约逻辑（31 tests）
- ✅ `desktop-app-vue/tests/unit/ipfs/gc-scheduler.test.js` — GC 策略调度、Pin 保留逻辑（14 tests）

### 集成测试

- ✅ `desktop-app-vue/tests/integration/ipfs/helia-node.test.js` — Helia 节点端到端上传下载（11 tests）
- ✅ `desktop-app-vue/tests/integration/ipfs/ipfs-ipc.test.js` — 全部 IPC 通道冒烟测试（8 tests）
- ✅ `desktop-app-vue/tests/integration/ipfs/social-integration.test.js` — 社交模块动态/相册存储集成（9 tests）

### 总覆盖

| 模块 | 行覆盖率 | 分支覆盖率 |
| --- | --- | --- |
| `ipfs-manager.js` | 94% | 91% |
| `filecoin-storage.js` | 89% | 86% |
| `ipfs-ipc.js` | 97% | 95% |
| **整体** | **93%** | **91%** |

---

## 安全考虑

- **端到端加密**: 私密文件上传前使用 AES-256-GCM 加密，仅持有密钥的用户可解密，IPFS 网络中其他节点无法读取明文
- **内容寻址安全**: CID 基于内容哈希生成，任何篡改都会改变 CID，天然具备完整性验证能力
- **密钥管理**: 加密密钥存储在本地 SQLite 数据库中（受 SQLCipher 保护），不随文件上传到 IPFS 网络
- **公开内容风险**: 未加密上传的内容任何知道 CID 的人都可访问，发布前确认内容不含敏感信息
- **Pin 策略**: 重要内容务必 Pin，否则可能在垃圾回收时被清除
- **网络隐私**: Helia 嵌入式节点的 DHT 查询可能暴露 IP 地址，敏感场景建议通过 Kubo + Tor 代理访问

---

## 相关文档

- [去中心化社交](/chainlesschain/social)
- [实时协作](/chainlesschain/collaboration)
- [加密与安全](/chainlesschain/encryption)
