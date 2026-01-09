# P2P 数据同步协议设计

**版本**: v1.0
**日期**: 2025-12-30

---

## 概述

ChainlessChain 使用基于版本向量（Vector Clock）的增量同步协议，实现去中心化组织的数据一致性。

## 核心概念

### 1. 资源版本管理

每个资源维护：
- **local_version**: 本地版本号（单调递增）
- **remote_version**: 已知的最新远程版本号
- **vector_clock**: 版本向量（DID → version 映射）
- **cid**: IPFS内容标识符（可选）

### 2. 同步状态

```
synced    - 已同步（local_version == remote_version）
pending   - 待同步（有本地更改未推送）
conflict  - 冲突（并发修改）
```

### 3. 资源类型

支持同步的资源类型：
- `knowledge` - 知识库条目
- `project` - 项目元数据
- `member` - 成员信息
- `role` - 角色配置
- `settings` - 组织设置

## 同步流程

### 增量同步（Pull-based）

```
1. 客户端定期请求同步状态
   Request: { org_id, last_sync_time, resource_types }

2. 服务端返回变更列表
   Response: {
     changes: [
       {
         resource_type,
         resource_id,
         version,
         data,
         author_did,
         timestamp,
         vector_clock
       }
     ]
   }

3. 客户端应用变更
   - 检查版本号
   - 检测冲突
   - 合并或请求人工解决

4. 更新同步状态
```

### 推送变更（Push-based）

```
1. 本地修改资源
   - version++
   - vector_clock[my_did]++

2. 添加到离线队列
   Queue: { action, resource_type, resource_id, data, version }

3. P2P广播变更
   Message: {
     type: 'sync:change',
     org_id,
     resource_type,
     resource_id,
     data,
     version,
     vector_clock,
     author_did,
     timestamp,
     signature
   }

4. 对等节点接收并应用
```

## 冲突检测

### 向量时钟比较

```javascript
function detectConflict(local_vc, remote_vc) {
  let local_newer = false;
  let remote_newer = false;

  // 比较所有节点的版本
  const all_dids = new Set([...Object.keys(local_vc), ...Object.keys(remote_vc)]);

  for (const did of all_dids) {
    const local_v = local_vc[did] || 0;
    const remote_v = remote_vc[did] || 0;

    if (local_v > remote_v) local_newer = true;
    if (remote_v > local_v) remote_newer = true;
  }

  // 并发修改 = 冲突
  if (local_newer && remote_newer) {
    return 'conflict';
  }

  // 本地更新
  if (local_newer) {
    return 'local_wins';
  }

  // 远程更新
  if (remote_newer) {
    return 'remote_wins';
  }

  // 已同步
  return 'synced';
}
```

## 冲突解决策略

### 1. Last-Write-Wins (LWW)

基于时间戳，最后修改者获胜。

```javascript
if (remote.timestamp > local.timestamp) {
  acceptRemote();
} else {
  keepLocal();
}
```

**优点**: 简单、确定性
**缺点**: 可能丢失数据

### 2. Three-Way Merge

基于共同祖先的三路合并。

```javascript
const merged = merge(ancestor, local, remote);
if (merged.conflicts.length > 0) {
  // 人工解决
  requestManualResolve(merged.conflicts);
} else {
  applyMerge(merged.result);
}
```

**优点**: 保留更多数据
**缺点**: 复杂度高

### 3. Operational Transformation (OT)

转换操作序列以保持一致性。

```javascript
const local_ops = getOperations(ancestor, local);
const remote_ops = getOperations(ancestor, remote);

const transformed = transform(local_ops, remote_ops);
applyOperations(transformed);
```

**优点**: 适合实时协作
**缺点**: 实现复杂

### 4. CRDT (Conflict-free Replicated Data Type)

使用无冲突数据结构。

```javascript
// 使用 Y.js / Automerge
const doc = new Y.Doc();
doc.merge(remote_doc);
// 自动合并，无冲突
```

**优点**: 自动无冲突
**缺点**: 数据结构限制

### 当前实现策略

- **知识库内容**: Three-Way Merge（优先）→ Manual Resolve
- **成员信息**: LWW
- **角色配置**: Manual Resolve（需要管理员介入）
- **组织设置**: Manual Resolve

## 离线队列

### 队列结构

```sql
CREATE TABLE sync_queue (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  action TEXT NOT NULL, -- 'create', 'update', 'delete'
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  data TEXT, -- JSON
  version INTEGER NOT NULL,
  vector_clock TEXT, -- JSON
  created_at INTEGER NOT NULL,
  retry_count INTEGER DEFAULT 0,
  last_retry_at INTEGER,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'failed', 'completed'))
);
```

### 队列处理

```javascript
// 定期处理离线队列
async function processQueue() {
  const items = await getQueueItems({ status: 'pending', limit: 100 });

  for (const item of items) {
    try {
      await syncItem(item);
      await markCompleted(item.id);
    } catch (error) {
      await markFailed(item.id, error);

      // 重试策略：指数退避
      const delay = Math.min(1000 * Math.pow(2, item.retry_count), 60000);
      scheduleRetry(item.id, delay);
    }
  }
}
```

## P2P 消息类型

### sync:request

请求同步数据

```json
{
  "type": "sync:request",
  "org_id": "org_abc123",
  "last_sync_time": 1704000000000,
  "resource_types": ["knowledge", "project"]
}
```

### sync:response

返回变更列表

```json
{
  "type": "sync:response",
  "changes": [
    {
      "resource_type": "knowledge",
      "resource_id": "kb_123",
      "action": "update",
      "data": { ... },
      "version": 5,
      "vector_clock": { "did:user:alice": 5, "did:user:bob": 3 },
      "author_did": "did:user:alice",
      "timestamp": 1704000000000
    }
  ]
}
```

### sync:change

广播变更

```json
{
  "type": "sync:change",
  "org_id": "org_abc123",
  "resource_type": "knowledge",
  "resource_id": "kb_123",
  "action": "update",
  "data": { ... },
  "version": 6,
  "vector_clock": { "did:user:alice": 6, "did:user:bob": 3 },
  "author_did": "did:user:alice",
  "timestamp": 1704000100000,
  "signature": "0x..."
}
```

### sync:conflict

通知冲突

```json
{
  "type": "sync:conflict",
  "org_id": "org_abc123",
  "resource_type": "knowledge",
  "resource_id": "kb_123",
  "local_version": 6,
  "remote_version": 6,
  "local_data": { ... },
  "remote_data": { ... },
  "local_vector_clock": { ... },
  "remote_vector_clock": { ... }
}
```

## 安全机制

### 1. 签名验证

所有同步消息必须签名：

```javascript
const signature = await didManager.sign(JSON.stringify(message));
message.signature = signature;

// 接收端验证
const isValid = await didManager.verify(message.signature, JSON.stringify(message), message.author_did);
```

### 2. 权限检查

应用变更前检查权限：

```javascript
const hasPermission = await checkPermission(
  message.org_id,
  message.author_did,
  getRequiredPermission(message.resource_type, message.action)
);

if (!hasPermission) {
  throw new Error('Unauthorized sync operation');
}
```

### 3. 数据完整性

使用 CID（内容标识符）验证：

```javascript
const calculated_cid = calculateCID(message.data);
if (calculated_cid !== message.cid) {
  throw new Error('Data integrity check failed');
}
```

## 性能优化

### 1. 批量同步

批量处理多个变更，减少网络往返：

```javascript
const batch_size = 50;
const changes = await getChanges({ limit: batch_size });
await syncBatch(changes);
```

### 2. 差异传输

仅传输变更的字段：

```javascript
const diff = calculateDiff(local_data, remote_data);
// 只传输 diff，而不是完整数据
```

### 3. 压缩

压缩大数据：

```javascript
const compressed = await compress(JSON.stringify(data));
message.data = compressed;
message.compressed = true;
```

### 4. 增量版本

基于版本号的增量拉取：

```javascript
// 只请求版本号 > last_known_version 的数据
const changes = await getChangesSince(last_known_version);
```

## 监控与调试

### 同步状态指标

```javascript
{
  total_resources: 1250,
  synced: 1200,
  pending: 45,
  conflicts: 5,
  last_sync_time: 1704000000000,
  queue_size: 12,
  avg_sync_latency: 350 // ms
}
```

### 日志级别

- **DEBUG**: 每次同步操作的详细信息
- **INFO**: 同步周期完成
- **WARN**: 冲突检测、重试
- **ERROR**: 同步失败

---

## 实现路线图

### Phase 1: 基础同步（当前）
- ✅ 数据库表结构
- 🔲 P2PSyncEngine 核心模块
- 🔲 增量同步算法
- 🔲 LWW 冲突解决

### Phase 2: 高级冲突解决
- 🔲 Three-Way Merge
- 🔲 Manual Resolve UI
- 🔲 冲突历史记录

### Phase 3: 性能优化
- 🔲 批量同步
- 🔲 差异传输
- 🔲 压缩

### Phase 4: CRDT 集成
- 🔲 Y.js 协同编辑
- 🔲 Automerge 数据结构

---

**设计者**: Claude Code
**版本**: v1.0
**最后更新**: 2025-12-30
