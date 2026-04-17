# IPFS 去中心化存储系统

## 模块概述

**版本**: v1.0.0
**状态**: ✅ 已实现 | CLI Phase 17 ✅
**IPC处理器**: 18个
**最后更新**: 2026-04-17

基于 IPFS 的去中心化存储系统，支持 Helia (嵌入式) 和 Kubo (外部节点) 双引擎模式。提供内容寻址存储、AES-256-GCM 加密、存储配额管理和知识库集成。

### 核心特性

- **双引擎模式**: 嵌入式 Helia 节点或外部 Kubo RPC 节点
- **内容寻址**: 基于 CID (Content Identifier) 的去中心化存储
- **AES-256-GCM 加密**: 可选的端到端内容加密
- **Pin 管理**: 内容固定与垃圾回收
- **存储配额**: 可配置的存储上限 (默认 1GB)
- **知识库集成**: 知识条目可关联 IPFS 附件

---

## 1. 架构设计

### 1.1 整体架构图

```
┌──────────────────────────────────────────────────────────────────┐
│                        前端 (Vue3)                                │
├──────────────────────────────────────────────────────────────────┤
│                 Pinia Store: ipfs-storage.ts (750行)              │
│  ┌──────────┐ ┌──────────────┐ ┌──────────┐ ┌───────────────┐   │
│  │ 节点控制  │ │  内容操作     │ │ Pin管理   │ │ 知识库集成    │   │
│  └──────────┘ └──────────────┘ └──────────┘ └───────────────┘   │
└──────────────────────────────────────────────────────────────────┘
                              ↕ IPC (18个通道)
┌──────────────────────────────────────────────────────────────────┐
│                        主进程 (Electron)                          │
├──────────────────────────────────────────────────────────────────┤
│                      ipfs-ipc.js (342行)                         │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │              IPFSManager (840行, extends EventEmitter)      │  │
│  │  ┌────────────────┐  ┌────────────────┐                    │  │
│  │  │  Helia Engine   │  │  Kubo Engine   │                    │  │
│  │  │  (嵌入式节点)    │  │  (外部RPC)     │                    │  │
│  │  │  blockstore-fs  │  │  HTTP API      │                    │  │
│  │  │  datastore-level│  │  127.0.0.1:5001│                    │  │
│  │  └────────────────┘  └────────────────┘                    │  │
│  │  ┌────────────────┐  ┌────────────────┐                    │  │
│  │  │  AES-256-GCM   │  │  SQLite 存储    │                    │  │
│  │  │  加密/解密      │  │  ipfs_content   │                    │  │
│  │  └────────────────┘  └────────────────┘                    │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

### 1.2 双引擎模式

```
                    ┌─────────────┐
                    │  IPFSManager │
                    │  mode 选择   │
                    └──────┬──────┘
              ┌────────────┴────────────┐
              ↓                         ↓
    ┌─────────────────┐     ┌──────────────────┐
    │ Embedded (Helia) │     │ External (Kubo)  │
    │ ESM 动态导入     │     │ HTTP RPC API     │
    │ blockstore-fs    │     │ 127.0.0.1:5001   │
    │ datastore-level  │     │ 无本地节点实例    │
    │ @helia/unixfs    │     │ 适合共享网关      │
    └─────────────────┘     └──────────────────┘
```

### 1.3 核心组件

| 组件        | 文件              | 行数 | 说明           |
| ----------- | ----------------- | ---- | -------------- |
| IPFSManager | `ipfs-manager.js` | 840  | 双引擎存储核心 |
| IPFS IPC    | `ipfs-ipc.js`     | 342  | 18个IPC处理器  |
| Pinia Store | `ipfs-storage.ts` | 750  | 前端状态管理   |

---

## 2. 核心模块

### 2.1 IPFSManager

双引擎 IPFS 节点管理器，提供内容寻址存储和加密。

**核心方法**:

```javascript
class IPFSManager extends EventEmitter {
  // 初始化
  async initialize(dependencies: { database, config })

  // 节点生命周期
  async startNode()           // 启动 IPFS 节点
  async stopNode()            // 停止 IPFS 节点

  // 内容操作
  async addContent(content, options?)     // 添加文本/Buffer
  async addFile(filePath, options?)       // 添加文件
  async getContent(cid, options?)         // 获取内容
  async getFile(cid, outputPath)          // 获取并保存到文件

  // Pin 管理
  async pin(cid)                          // 固定内容
  async unpin(cid)                        // 取消固定
  async listPins(options?)                // 列出固定内容

  // 存储管理
  async getStorageStats()                 // 获取存储统计
  async garbageCollect()                  // 垃圾回收
  async setQuota(quotaBytes)              // 设置存储配额
  async setMode(mode)                     // 切换引擎模式

  // 知识库集成
  async addKnowledgeAttachment(knowledgeId, content, metadata?)
  async getKnowledgeAttachment(knowledgeId, cid)

  // 加密
  _encrypt(data)             // AES-256-GCM 加密
  _decrypt(data, keyHex)     // AES-256-GCM 解密
}
```

### 2.2 加密方案

```
加密流程:
  1. 生成随机 32字节 AES 密钥
  2. 生成随机 16字节 IV
  3. AES-256-GCM 加密
  4. 输出: Buffer.concat([IV(16), AuthTag(16), Ciphertext])
  5. 密钥以 hex 存储到数据库

解密流程:
  1. 提取 IV (前16字节)
  2. 提取 AuthTag (16-32字节)
  3. 提取 Ciphertext (32字节后)
  4. 从数据库获取 hex 密钥
  5. AES-256-GCM 解密 + 完整性验证
```

---

## 3. 数据模型

### 3.1 ipfs_content

| 字段           | 类型        | 说明                    |
| -------------- | ----------- | ----------------------- |
| id             | TEXT PK     | UUID                    |
| cid            | TEXT UNIQUE | IPFS Content Identifier |
| filename       | TEXT        | 原始文件名              |
| size           | INTEGER     | 内容大小 (字节)         |
| mime_type      | TEXT        | MIME 类型               |
| pinned         | INTEGER     | 是否固定 (0/1)          |
| encrypted      | INTEGER     | 是否加密 (0/1)          |
| encryption_key | TEXT        | AES 密钥 (hex)          |
| knowledge_id   | TEXT        | 关联知识条目ID          |
| metadata       | TEXT(JSON)  | 附加元数据              |
| created_at     | TEXT        | 创建时间                |
| updated_at     | TEXT        | 更新时间                |

**索引**: `cid`, `knowledge_id`, `pinned`

---

## 4. IPC接口 (18个)

### 4.1 节点管理 (4个)

| 通道                   | 说明             | 参数            |
| ---------------------- | ---------------- | --------------- |
| `ipfs:initialize`      | 初始化并启动节点 | config?: Object |
| `ipfs:start-node`      | 启动节点         | -               |
| `ipfs:stop-node`       | 停止节点         | -               |
| `ipfs:get-node-status` | 获取节点状态     | -               |

### 4.2 内容操作 (4个)

| 通道               | 说明              | 参数               |
| ------------------ | ----------------- | ------------------ |
| `ipfs:add-content` | 添加内容          | content, options?  |
| `ipfs:add-file`    | 添加文件          | filePath, options? |
| `ipfs:get-content` | 获取内容 (base64) | cid, options?      |
| `ipfs:get-file`    | 获取并保存文件    | cid, outputPath    |

### 4.3 Pin管理 (3个)

| 通道             | 说明         | 参数                                |
| ---------------- | ------------ | ----------------------------------- |
| `ipfs:pin`       | 固定CID      | cid                                 |
| `ipfs:unpin`     | 取消固定     | cid                                 |
| `ipfs:list-pins` | 列出固定内容 | options?: { offset, limit, sortBy } |

### 4.4 存储管理 (4个)

| 通道                     | 说明         | 参数                           |
| ------------------------ | ------------ | ------------------------------ |
| `ipfs:get-storage-stats` | 获取存储统计 | -                              |
| `ipfs:garbage-collect`   | 执行垃圾回收 | -                              |
| `ipfs:set-quota`         | 设置存储配额 | quotaBytes: number             |
| `ipfs:set-mode`          | 设置引擎模式 | mode: 'embedded' \| 'external' |

### 4.5 知识库集成 (2个)

| 通道                            | 说明         | 参数                            |
| ------------------------------- | ------------ | ------------------------------- |
| `ipfs:add-knowledge-attachment` | 添加知识附件 | knowledgeId, content, metadata? |
| `ipfs:get-knowledge-attachment` | 获取知识附件 | knowledgeId, cid                |

### 4.6 配置 (1个)

| 通道              | 说明         | 参数 |
| ----------------- | ------------ | ---- |
| `ipfs:get-config` | 获取IPFS配置 | -    |

---

## 5. 前端页面

### 5.1 Pinia Store: ipfs-storage.ts

```typescript
interface IPFSStorageState {
  nodeStatus: IPFSNodeStatus;
  pinnedContent: IPFSContent[];
  pinnedTotal: number;
  storageStats: StorageStats | null;
  config: IPFSConfig | null;
  loading: boolean;
  error: string | null;
  uploadProgress: number;
}

// Getters
isNodeRunning; // 节点是否运行中
currentMode; // 当前引擎模式
connectedPeers; // 连接的节点数
pinnedCount; // 固定内容数
encryptedItems; // 已加密内容列表
usagePercent; // 存储使用百分比
formattedTotalSize; // 格式化的总大小
formattedQuota; // 格式化的配额

// Actions
initializeIPFS(); // 初始化
startNode(); // 启动节点
stopNode(); // 停止节点
addContent(); // 添加内容
addFile(); // 添加文件
pinContent(); // 固定内容
unpinContent(); // 取消固定
garbageCollect(); // 垃圾回收
setQuota(); // 设置配额
setMode(); // 切换模式
```

---

## 6. 配置

### 6.1 默认配置

```javascript
{
  repoPath: '{userData}/.chainlesschain/ipfs-repo/',
  gatewayUrl: 'https://ipfs.io',
  storageQuotaBytes: 1073741824,    // 1 GB
  externalApiUrl: 'http://127.0.0.1:5001',
  encryptionEnabled: false,
}
```

### 6.2 仓库路径

```
ipfs-repo/
├── blocks/          # FsBlockstore (Helia)
└── data/            # LevelDatastore (Helia)
```

---

## 7. 文件结构

```
desktop-app-vue/src/main/ipfs/
├── ipfs-manager.js         # 双引擎存储核心 (840行)
└── ipfs-ipc.js             # 18个IPC处理器 (342行)

desktop-app-vue/src/renderer/
└── stores/ipfs-storage.ts  # IPFS状态管理 (750行)
```

---

## 8. 相关文档

- [数据同步方案](../数据同步方案.md)
- [安全机制设计](../安全机制设计.md)
- [知识库管理模块](01_知识库管理模块.md)

---

**文档版本**: 1.0
**最后更新**: 2026-03-05
