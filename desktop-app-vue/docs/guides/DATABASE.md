# SQLite 数据库集成文档

## 概述

ChainlessChain Desktop Vue 版本现已集成 SQLite 数据库，使用 `better-sqlite3` 作为数据库驱动。数据将持久化存储到本地文件中，重启应用后数据不会丢失。

## 技术选型

### better-sqlite3

- **性能**: 同步 API，比异步驱动更快
- **简单**: API 简洁易用
- **可靠**: 成熟稳定，广泛使用
- **功能**: 支持事务、全文搜索、备份等

## 数据库架构

### 数据库位置

数据库文件存储在用户数据目录：

- **Windows**: `C:\Users\<用户名>\AppData\Roaming\chainlesschain-desktop-vue\data\chainlesschain.db`
- **macOS**: `~/Library/Application Support/chainlesschain-desktop-vue/data/chainlesschain.db`
- **Linux**: `~/.config/chainlesschain-desktop-vue/data/chainlesschain.db`

### 数据表结构

#### 1. knowledge_items (知识库项)

```sql
CREATE TABLE knowledge_items (
  id TEXT PRIMARY KEY,              -- UUID
  title TEXT NOT NULL,              -- 标题
  type TEXT NOT NULL,               -- 类型: note/document/conversation/web_clip
  content TEXT,                     -- 内容
  content_path TEXT,                -- 内容文件路径（可选）
  embedding_path TEXT,              -- 向量文件路径（可选）
  created_at INTEGER NOT NULL,      -- 创建时间（时间戳）
  updated_at INTEGER NOT NULL,      -- 更新时间（时间戳）
  git_commit_hash TEXT,             -- Git提交哈希
  device_id TEXT,                   -- 设备ID
  sync_status TEXT DEFAULT 'pending' -- 同步状态: synced/pending/conflict
);
```

**索引**:
- `idx_knowledge_items_created_at` - 创建时间索引
- `idx_knowledge_items_updated_at` - 更新时间索引
- `idx_knowledge_items_type` - 类型索引
- `idx_knowledge_items_sync_status` - 同步状态索引

#### 2. tags (标签)

```sql
CREATE TABLE tags (
  id TEXT PRIMARY KEY,              -- UUID
  name TEXT NOT NULL UNIQUE,        -- 标签名（唯一）
  color TEXT NOT NULL,              -- 颜色
  created_at INTEGER NOT NULL       -- 创建时间
);
```

#### 3. knowledge_tags (知识库项-标签关联)

```sql
CREATE TABLE knowledge_tags (
  knowledge_id TEXT NOT NULL,       -- 知识库项ID
  tag_id TEXT NOT NULL,             -- 标签ID
  created_at INTEGER NOT NULL,      -- 创建时间
  PRIMARY KEY (knowledge_id, tag_id),
  FOREIGN KEY (knowledge_id) REFERENCES knowledge_items(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);
```

#### 4. conversations (对话)

```sql
CREATE TABLE conversations (
  id TEXT PRIMARY KEY,              -- UUID
  title TEXT NOT NULL,              -- 对话标题
  knowledge_id TEXT,                -- 关联的知识库项ID
  created_at INTEGER NOT NULL,      -- 创建时间
  updated_at INTEGER NOT NULL,      -- 更新时间
  FOREIGN KEY (knowledge_id) REFERENCES knowledge_items(id) ON DELETE SET NULL
);
```

#### 5. messages (消息)

```sql
CREATE TABLE messages (
  id TEXT PRIMARY KEY,              -- UUID
  conversation_id TEXT NOT NULL,    -- 对话ID
  role TEXT NOT NULL,               -- 角色: user/assistant/system
  content TEXT NOT NULL,            -- 消息内容
  timestamp INTEGER NOT NULL,       -- 时间戳
  tokens INTEGER,                   -- Token数量
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);
```

**索引**:
- `idx_messages_conversation_id` - 对话ID索引
- `idx_messages_timestamp` - 时间戳索引

#### 6. knowledge_search (全文搜索)

```sql
CREATE VIRTUAL TABLE knowledge_search
USING fts5(
  id,
  title,
  content,
  tokenize='porter unicode61'
);
```

这是一个 FTS5 全文搜索虚拟表，支持：
- 快速全文搜索
- Porter 词干分析
- Unicode 支持

## API 文档

### DatabaseManager 类

#### 初始化

```javascript
const db = new DatabaseManager();
db.initialize();
```

#### 知识库项操作

**获取所有项目**
```javascript
const items = db.getKnowledgeItems(limit = 100, offset = 0);
// 返回: Array<KnowledgeItem>
```

**根据ID获取**
```javascript
const item = db.getKnowledgeItemById(id);
// 返回: KnowledgeItem | null
```

**添加项目**
```javascript
const newItem = db.addKnowledgeItem({
  title: '标题',
  type: 'note',
  content: '内容',
});
// 返回: KnowledgeItem
```

**更新项目**
```javascript
const updated = db.updateKnowledgeItem(id, {
  title: '新标题',
  content: '新内容',
});
// 返回: KnowledgeItem | null
```

**删除项目**
```javascript
const success = db.deleteKnowledgeItem(id);
// 返回: boolean
```

#### 搜索功能

```javascript
const results = db.searchKnowledge('关键词');
// 返回: Array<KnowledgeItem>
```

搜索支持：
- 全文搜索（FTS5）
- 自动回退到 LIKE 搜索（如果FTS失败）
- 按相关度排序

#### 标签操作

**获取所有标签**
```javascript
const tags = db.getAllTags();
// 返回: Array<Tag>
```

**创建标签**
```javascript
const tag = db.createTag('标签名', '#1890ff');
// 返回: Tag
```

**为项目添加标签**
```javascript
db.addTagToKnowledge(knowledgeId, tagId);
```

**获取项目的标签**
```javascript
const tags = db.getKnowledgeTags(knowledgeId);
// 返回: Array<Tag>
```

#### 统计信息

```javascript
const stats = db.getStatistics();
// 返回: {
//   total: number,
//   today: number,
//   byType: { note: number, document: number, ... }
// }
```

#### 工具方法

**获取数据库路径**
```javascript
const path = db.getDatabasePath();
```

**备份数据库**
```javascript
await db.backup('/path/to/backup.db');
```

**关闭连接**
```javascript
db.close();
```

**执行事务**
```javascript
db.transaction(() => {
  // 事务操作
  db.addKnowledgeItem(item1);
  db.addKnowledgeItem(item2);
});
```

## IPC 通信

### 渲染进程调用

通过 `window.electronAPI.db.*` 调用数据库操作：

```javascript
// 获取知识库项
const items = await window.electronAPI.db.getKnowledgeItems();

// 添加项目
const newItem = await window.electronAPI.db.addKnowledgeItem({
  title: '标题',
  type: 'note',
  content: '内容',
});

// 搜索
const results = await window.electronAPI.db.searchKnowledgeItems('关键词');

// 获取统计
const stats = await window.electronAPI.db.getStatistics();
```

### 可用的 IPC 通道

- `db:get-knowledge-items` - 获取知识库项列表
- `db:get-knowledge-item-by-id` - 根据ID获取
- `db:add-knowledge-item` - 添加项目
- `db:update-knowledge-item` - 更新项目
- `db:delete-knowledge-item` - 删除项目
- `db:search-knowledge-items` - 搜索
- `db:get-all-tags` - 获取所有标签
- `db:create-tag` - 创建标签
- `db:get-knowledge-tags` - 获取项目标签
- `db:get-statistics` - 获取统计信息
- `db:get-path` - 获取数据库路径
- `db:backup` - 备份数据库

## 测试

### 运行数据库测试

```bash
npm run test:db
```

测试脚本会：
1. 初始化数据库
2. 添加测试数据
3. 测试查询、更新、删除
4. 测试搜索功能
5. 测试标签功能
6. 测试统计功能
7. 测试备份功能

### 预期输出

```
=== 开始数据库测试 ===

1. 初始化数据库...
✓ 数据库初始化成功
  数据库路径: /tmp/chainlesschain-test/data/chainlesschain.db

2. 添加知识库项...
✓ 添加成功: 测试笔记1
✓ 添加成功: 测试文档
✓ 添加成功: 测试对话

...

=== 所有测试通过 ✓ ===
```

## 性能优化

### 索引

数据库使用了多个索引来优化查询性能：

- 时间索引：加速按时间排序的查询
- 类型索引：加速按类型筛选
- 全文搜索索引：加速内容搜索

### 事务

批量操作应该使用事务：

```javascript
db.transaction(() => {
  for (const item of items) {
    db.addKnowledgeItem(item);
  }
});
```

### 同步 vs 异步

`better-sqlite3` 使用同步 API，在主进程中执行：
- ✅ 性能更好
- ✅ 代码更简单
- ⚠️ 不会阻塞 UI（IPC是异步的）

## 数据迁移

### 从内存存储迁移

如果你之前使用的是内存存储版本，数据无法自动迁移（因为内存数据在重启后丢失）。

### 未来版本迁移

数据库设计考虑了可扩展性：
- 可以添加新表
- 可以添加新字段
- 使用迁移脚本管理版本

## 备份和恢复

### 手动备份

```javascript
const dbPath = await window.electronAPI.db.getPath();
const backupPath = dbPath.replace('.db', `-backup-${Date.now()}.db`);
await window.electronAPI.db.backup(backupPath);
```

### 自动备份

可以在应用启动时自动创建备份（待实现）。

### 恢复数据

直接复制备份文件覆盖当前数据库文件：

```bash
cp chainlesschain-backup.db chainlesschain.db
```

## 常见问题

### Q: 数据库文件在哪里？

A: 使用以下代码查看：
```javascript
const path = await window.electronAPI.db.getPath();
console.log('数据库路径:', path);
```

### Q: 如何查看数据库内容？

A: 使用 SQLite 客户端工具：
- [DB Browser for SQLite](https://sqlitebrowser.org/) （推荐）
- [SQLite Studio](https://sqlitestudio.pl/)
- VS Code 扩展: SQLite

### Q: 数据库文件损坏怎么办？

A:
1. 从备份恢复
2. 或者删除数据库文件，应用会自动重新创建

### Q: 全文搜索不工作？

A: 检查以下内容：
1. 是否正确创建了 `knowledge_search` 虚拟表
2. 添加/更新项目时是否调用了 `updateSearchIndex()`
3. 查看控制台是否有错误信息

### Q: 如何优化查询性能？

A:
1. 使用索引字段进行查询
2. 限制返回结果数量（使用 LIMIT）
3. 使用事务处理批量操作
4. 定期运行 `VACUUM` 整理数据库

### Q: 可以使用异步数据库吗？

A: `better-sqlite3` 是同步的，但通过 IPC 调用时是异步的，不会阻塞 UI。如果需要真正的异步操作，可以：
1. 使用 Worker 线程
2. 或者换用其他异步驱动（如 `sqlite3`）

## 开发建议

### 1. 错误处理

始终捕获数据库操作的错误：

```javascript
try {
  const item = await window.electronAPI.db.addKnowledgeItem(data);
  console.log('添加成功', item);
} catch (error) {
  console.error('添加失败', error);
  message.error('操作失败，请重试');
}
```

### 2. 数据验证

在保存前验证数据：

```javascript
if (!item.title || !item.type) {
  throw new Error('标题和类型不能为空');
}
```

### 3. 搜索优化

对于大量数据，考虑：
- 添加防抖（debounce）
- 限制结果数量
- 显示加载状态

### 4. 定期清理

定期清理不需要的数据：
- 删除旧的草稿
- 清理未使用的标签
- 压缩数据库（VACUUM）

## 下一步计划

- [ ] 数据库版本管理和迁移
- [ ] 自动备份功能
- [ ] 数据导入/导出
- [ ] 数据库加密
- [ ] 多设备同步
- [ ] 向量化搜索集成

## 参考资源

- [better-sqlite3 文档](https://github.com/WiseLibs/better-sqlite3/wiki)
- [SQLite 官方文档](https://www.sqlite.org/docs.html)
- [FTS5 全文搜索](https://www.sqlite.org/fts5.html)

---

**更新时间**: 2024-01-XX
**版本**: 1.0.0
