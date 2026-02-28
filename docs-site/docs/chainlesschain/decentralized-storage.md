# 去中心化存储系统

> **版本: v3.3.0 | 状态: ✅ 生产就绪 | 5 IPC Handlers | 2 数据库表 | Filecoin + P2P CDN + IPLD**

ChainlessChain 去中心化存储系统集成了 Filecoin 持久化存储、P2P 内容分发网络和 IPLD DAG 版本管理。通过存储交易管理、热内容缓存和内容版本追踪，为用户数据提供持久、高可用的去中心化存储解决方案。

## 核心特性

- 💾 **Filecoin 存储交易**: 创建和管理存储交易，支持验证交易和自动续期
- ✅ **证明验证**: 自动验证存储证明，确保数据完整性
- 🌐 **P2P 内容分发**: 热内容自动缓存到多个对等节点，加速访问
- 📋 **IPLD DAG 版本管理**: 基于 IPLD 有向无环图的内容版本控制
- 📊 **存储统计**: 交易数量、总存储量、成本追踪

## 创建存储交易

```javascript
const result = await window.electron.ipcRenderer.invoke(
  "dstorage:store-to-filecoin",
  {
    cid: "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
    sizeBytes: 1048576, // 1MB
    minerId: "f01234",
    durationEpochs: 518400, // ~6 个月
  },
);
// result.deal = {
//   id: "uuid",
//   cid: "bafybeig...",
//   miner_id: "f01234",
//   status: "active",
//   price_fil: 1.048576,
//   verified: 1,
// }
```

## 分发内容到 P2P 网络

```javascript
const result = await window.electron.ipcRenderer.invoke(
  "dstorage:distribute-content",
  {
    cid: "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
    peerCount: 5, // 分发到 5 个对等节点
  },
);
// result.result = {
//   id: "uuid",
//   content_cid: "bafybeig...",
//   cached: 1,
//   peer_count: 5,
// }
```

## 查询版本历史

```javascript
const result = await window.electron.ipcRenderer.invoke(
  "dstorage:get-version-history",
  "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
);
// result.versions = [
//   { id, content_cid, version: 3, parent_cid: "...", dag_structure: {...} },
//   { id, content_cid, version: 2, parent_cid: "...", dag_structure: {...} },
//   { id, content_cid, version: 1, parent_cid: null, dag_structure: {...} },
// ]
```

## 系统架构

```
┌──────────────────────────────────────────────────┐
│              去中心化存储系统                       │
│                                                    │
│  ┌──────────────┐    ┌─────────────────────────┐  │
│  │ Filecoin     │    │   Content Distributor    │  │
│  │ Storage      │    │                          │  │
│  │ 存储交易管理  │    │ P2P CDN + 热内容缓存     │  │
│  │ 证明验证      │    │ IPLD DAG 版本管理        │  │
│  └──────┬───────┘    └──────────┬───────────────┘  │
│         │                       │                   │
│  ┌──────┴───────────────────────┴───────────────┐  │
│  │        IPC Layer (5 handlers)                  │  │
│  └────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────┘
```

## IPC 接口完整列表

### 去中心化存储操作（5 个）

| 通道                           | 功能               | 说明                     |
| ------------------------------ | ------------------ | ------------------------ |
| `dstorage:store-to-filecoin`   | 创建 Filecoin 交易 | 指定 CID、矿工、时长     |
| `dstorage:get-deal-status`     | 查询交易状态       | 返回交易详情和验证状态   |
| `dstorage:distribute-content`  | P2P 内容分发       | 缓存到指定数量的对等节点 |
| `dstorage:get-version-history` | 查询版本历史       | IPLD DAG 版本链          |
| `dstorage:get-storage-stats`   | 获取存储统计       | 交易数、总存储量、总成本 |

## 数据库 Schema

**2 张核心表**:

| 表名               | 用途          | 关键字段                                            |
| ------------------ | ------------- | --------------------------------------------------- |
| `filecoin_deals`   | Filecoin 交易 | id, cid, miner_id, size_bytes, price_fil, status    |
| `content_versions` | 内容版本历史  | id, content_cid, version, parent_cid, dag_structure |

### filecoin_deals 表

```sql
CREATE TABLE IF NOT EXISTS filecoin_deals (
  id TEXT PRIMARY KEY,
  cid TEXT NOT NULL,
  miner_id TEXT,
  size_bytes INTEGER,
  price_fil REAL,
  duration_epochs INTEGER,
  status TEXT DEFAULT 'proposed',        -- proposed | active | expired | failed
  verified INTEGER DEFAULT 0,
  renewal_count INTEGER DEFAULT 0,
  expires_at INTEGER,
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_filecoin_deals_status ON filecoin_deals(status);
CREATE INDEX IF NOT EXISTS idx_filecoin_deals_cid ON filecoin_deals(cid);
```

### content_versions 表

```sql
CREATE TABLE IF NOT EXISTS content_versions (
  id TEXT PRIMARY KEY,
  content_cid TEXT NOT NULL,
  version INTEGER DEFAULT 1,
  parent_cid TEXT,
  dag_structure TEXT,                    -- JSON: IPLD DAG 结构
  cached INTEGER DEFAULT 0,
  peer_count INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_content_versions_cid ON content_versions(content_cid);
```

## 前端集成

### DecentralizedStoragePage 页面

**功能模块**:

- **统计卡片**: 总交易数 / 活跃交易 / 总存储量 / 总成本
- **交易列表**: 展示 CID、矿工、大小、状态
- **存储操作**: 创建新的 Filecoin 存储交易
- **版本历史**: 查询指定 CID 的版本链

### Pinia Store (decentralizedStorage.ts)

```typescript
const useDecentralizedStorageStore = defineStore("decentralizedStorage", {
  state: () => ({
    deals: [],
    versions: [],
    storageStats: null,
    loading: false,
    error: null,
  }),
  actions: {
    storeToFilecoin, // → dstorage:store-to-filecoin
    fetchDealStatus, // → dstorage:get-deal-status
    distributeContent, // → dstorage:distribute-content
    fetchVersionHistory, // → dstorage:get-version-history
    fetchStorageStats, // → dstorage:get-storage-stats
  },
});
```

## 关键文件

| 文件                                                     | 职责               | 行数 |
| -------------------------------------------------------- | ------------------ | ---- |
| `src/main/ipfs/filecoin-storage.js`                      | Filecoin 存储引擎  | ~142 |
| `src/main/ipfs/content-distributor.js`                   | P2P 内容分发器     | ~116 |
| `src/main/ipfs/decentralized-storage-ipc.js`             | IPC 处理器（5 个） | ~132 |
| `src/renderer/stores/decentralizedStorage.ts`            | Pinia 状态管理     | ~100 |
| `src/renderer/pages/social/DecentralizedStoragePage.vue` | 去中心化存储页面   | ~100 |

## 测试覆盖率

```
✅ filecoin-storage.test.js                  - 交易创建/查询/统计测试
✅ content-distributor.test.js               - 分发/版本/缓存测试
✅ stores/decentralizedStorage.test.ts       - Store 状态管理测试
✅ e2e/social/decentralized-storage.e2e.test.ts - 端到端用户流程测试
```

## 相关文档

- [IPFS 存储 →](/chainlesschain/knowledge-base)
- [EvoMap 进化图谱 →](/chainlesschain/evomap)
- [去中心化社交 →](/chainlesschain/social)
