# 数据库性能优化指南

## 概述

ChainlessChain PC端已集成完整的数据库性能优化系统，包括：
- 查询性能监控
- 智能查询缓存
- 批量操作优化
- 自动索引建议
- 慢查询分析
- 数据库统计和优化

## 核心功能

### 1. 查询缓存

**自动缓存SELECT查询结果，显著提升重复查询性能**

- **缓存大小**: 默认1000条查询
- **缓存TTL**: 默认60秒
- **自动失效**: 数据修改时自动清除相关缓存

**配置示例**:
```javascript
const optimizer = new DatabaseOptimizer(db, {
  enableCache: true,
  cacheMaxSize: 1000,
  cacheTTL: 60000 // 60秒
});
```

### 2. 慢查询监控

**自动检测和记录执行时间超过阈值的查询**

- **默认阈值**: 100ms
- **自动记录**: 最近100条慢查询
- **索引建议**: 自动分析并生成索引优化建议

**查看慢查询**:
```javascript
const slowQueries = optimizer.getSlowQueries(20);
```

### 3. 批量操作优化

**使用事务批量处理，提升大量数据操作性能**

**批量插入**:
```javascript
const records = [
  { id: '1', title: 'Note 1', content: 'Content 1' },
  { id: '2', title: 'Note 2', content: 'Content 2' },
  // ... 更多记录
];

const result = await optimizer.batchInsert('knowledge_items', records, {
  batchSize: 100 // 每批100条
});

console.log(`插入 ${result.inserted} 条记录，耗时 ${result.duration}ms`);
```

**批量更新**:
```javascript
const updates = [
  { id: '1', title: 'Updated Title 1' },
  { id: '2', title: 'Updated Title 2' },
  // ... 更多更新
];

const result = await optimizer.batchUpdate('knowledge_items', updates, 'id', {
  batchSize: 100
});
```

### 4. 索引优化

**自动分析慢查询并生成索引建议**

**获取索引建议**:
```javascript
const suggestions = optimizer.getIndexSuggestions();
// [
//   {
//     table: 'knowledge_items',
//     column: 'created_at',
//     sql: 'CREATE INDEX IF NOT EXISTS idx_knowledge_items_created_at ON knowledge_items(created_at);',
//     reason: 'Slow query (150ms) with WHERE clause on created_at'
//   }
// ]
```

**应用索引建议**:
```javascript
// 应用单个建议
optimizer.applyIndexSuggestion(suggestions[0]);

// 应用所有建议
const results = optimizer.applyAllIndexSuggestions();
```

### 5. 数据库优化

**定期运行VACUUM和ANALYZE优化数据库**

```javascript
await optimizer.optimize();
// 执行:
// - VACUUM: 重建数据库文件，回收空间
// - ANALYZE: 更新查询优化器统计信息
```

### 6. 性能统计

**实时查看数据库性能指标**

```javascript
const stats = optimizer.getStats();
// {
//   totalQueries: 1234,
//   slowQueries: 5,
//   avgQueryTime: 23.5,
//   cache: {
//     hits: 890,
//     misses: 344,
//     hitRate: '72.14%',
//     size: 456,
//     maxSize: 1000
//   },
//   indexSuggestions: [...]
// }
```

## 使用方法

### 在主进程中集成

**1. 初始化优化器**:
```javascript
const { DatabaseOptimizer } = require('./database-optimizer');
const { registerDatabasePerformanceIPC } = require('./database-performance-ipc');

// 创建数据库实例
const db = new DatabaseManager();
await db.initialize();

// 创建优化器
const optimizer = new DatabaseOptimizer(db.db, {
  enableCache: true,
  slowQueryThreshold: 100,
  logSlowQueries: true
});

// 注册IPC接口
registerDatabasePerformanceIPC(optimizer);
```

**2. 使用优化的查询方法**:
```javascript
// 替换原有的查询方法
// 原来: const items = db.all('SELECT * FROM knowledge_items');
// 现在:
const items = await optimizer.query('SELECT * FROM knowledge_items', [], {
  cache: true // 启用缓存
});
```

**3. 批量操作**:
```javascript
// 批量插入
await optimizer.batchInsert('knowledge_items', records);

// 批量更新
await optimizer.batchUpdate('knowledge_items', updates);
```

### 在前端使用

**1. 访问性能监控页面**:
```
设置 -> 数据库性能监控
```

**2. 使用IPC接口**:
```javascript
// 获取性能统计
const stats = await window.electronAPI.dbPerformance.getStats();

// 获取慢查询
const slowQueries = await window.electronAPI.dbPerformance.getSlowQueries(20);

// 获取索引建议
const suggestions = await window.electronAPI.dbPerformance.getIndexSuggestions();

// 应用索引建议
await window.electronAPI.dbPerformance.applyIndexSuggestion(suggestion);

// 优化数据库
await window.electronAPI.dbPerformance.optimize();

// 清空缓存
await window.electronAPI.dbPerformance.clearCache();
```

## 性能优化建议

### 1. 查询优化

**使用索引**:
```sql
-- 不好: 全表扫描
SELECT * FROM knowledge_items WHERE created_at > 1234567890;

-- 好: 使用索引
CREATE INDEX idx_knowledge_items_created_at ON knowledge_items(created_at);
SELECT * FROM knowledge_items WHERE created_at > 1234567890;
```

**避免SELECT ***:
```sql
-- 不好: 查询所有列
SELECT * FROM knowledge_items WHERE id = '123';

-- 好: 只查询需要的列
SELECT id, title, created_at FROM knowledge_items WHERE id = '123';
```

**使用LIMIT**:
```sql
-- 不好: 查询所有数据
SELECT * FROM knowledge_items ORDER BY created_at DESC;

-- 好: 限制结果数量
SELECT * FROM knowledge_items ORDER BY created_at DESC LIMIT 100;
```

### 2. 批量操作

**使用事务**:
```javascript
// 不好: 逐条插入
for (const record of records) {
  db.run('INSERT INTO knowledge_items ...', [record]);
}

// 好: 批量插入
await optimizer.batchInsert('knowledge_items', records);
```

### 3. 缓存策略

**合理使用缓存**:
```javascript
// 频繁查询的数据启用缓存
const items = await optimizer.query('SELECT * FROM knowledge_items', [], {
  cache: true
});

// 实时性要求高的数据禁用缓存
const latestItem = await optimizer.query('SELECT * FROM knowledge_items ORDER BY created_at DESC LIMIT 1', [], {
  cache: false
});
```

**及时清除缓存**:
```javascript
// 数据修改后清除相关缓存
await db.run('UPDATE knowledge_items SET title = ? WHERE id = ?', [newTitle, id]);
optimizer.queryCache.invalidate('SELECT.*FROM knowledge_items');
```

### 4. 定期维护

**建议每周执行一次数据库优化**:
```javascript
// 手动执行
await optimizer.optimize();

// 或设置定时任务
setInterval(async () => {
  await optimizer.optimize();
}, 7 * 24 * 60 * 60 * 1000); // 每周
```

## 性能指标

### 查询性能目标

- **平均查询时间**: < 50ms
- **慢查询比例**: < 5%
- **缓存命中率**: > 80%

### 监控指标

| 指标 | 良好 | 警告 | 严重 |
|------|------|------|------|
| 平均查询时间 | < 50ms | 50-100ms | > 100ms |
| 慢查询数量 | 0 | 1-10 | > 10 |
| 缓存命中率 | > 80% | 60-80% | < 60% |

## 故障排查

### 问题1: 查询速度慢

**诊断**:
1. 查看慢查询日志
2. 检查是否缺少索引
3. 分析查询计划

**解决**:
```javascript
// 1. 查看慢查询
const slowQueries = optimizer.getSlowQueries();

// 2. 应用索引建议
const suggestions = optimizer.getIndexSuggestions();
optimizer.applyAllIndexSuggestions();

// 3. 优化数据库
await optimizer.optimize();
```

### 问题2: 缓存命中率低

**原因**:
- 查询模式不稳定
- 缓存TTL设置过短
- 缓存大小不足

**解决**:
```javascript
// 增加缓存大小和TTL
const optimizer = new DatabaseOptimizer(db, {
  cacheMaxSize: 2000,
  cacheTTL: 120000 // 2分钟
});
```

### 问题3: 数据库文件过大

**解决**:
```javascript
// 运行VACUUM回收空间
await optimizer.optimize();
```

## 最佳实践

1. **启用查询缓存**: 对频繁查询的数据启用缓存
2. **使用批量操作**: 大量数据操作使用批量方法
3. **定期优化**: 每周运行一次数据库优化
4. **监控性能**: 定期查看性能统计，及时发现问题
5. **应用索引建议**: 根据慢查询自动生成的索引建议优化数据库
6. **合理设置阈值**: 根据实际情况调整慢查询阈值

## 相关文件

- **优化器**: `src/main/database-optimizer.js`
- **IPC接口**: `src/main/database-performance-ipc.js`
- **监控页面**: `src/renderer/pages/DatabasePerformancePage.vue`
- **数据库管理**: `src/main/database.js`

## 更新日志

### v0.20.0 (2026-01-14)
- ✅ 添加查询缓存机制
- ✅ 实现批量操作优化
- ✅ 添加慢查询监控
- ✅ 自动索引建议
- ✅ 性能统计和监控页面
- ✅ 数据库优化工具

---

**注意**: 数据库性能优化是一个持续的过程，建议定期查看性能统计，根据实际使用情况调整优化策略。
