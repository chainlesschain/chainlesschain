# 数据库修复指南

## 问题
```
Unknown column 'deleted' in 'field list'
```

`categories` 和 `tags` 表缺少 `deleted` 字段。

## 解决方案

### 方法1: 使用 MySQL 命令行（推荐）

```bash
# 1. 登录 MySQL
mysql -u root -p

# 2. 选择数据库
USE community_forum;

# 3. 添加 deleted 字段到 categories 表
ALTER TABLE `categories`
ADD COLUMN `deleted` TINYINT DEFAULT 0 COMMENT '是否删除' AFTER `updated_at`;

# 4. 添加 deleted 字段到 tags 表
ALTER TABLE `tags`
ADD COLUMN `deleted` TINYINT DEFAULT 0 COMMENT '是否删除' AFTER `updated_at`;

# 5. 验证
SHOW COLUMNS FROM `categories` LIKE 'deleted';
SHOW COLUMNS FROM `tags` LIKE 'deleted';

# 6. 退出
EXIT;
```

### 方法2: 使用 SQL 文件

```bash
# 执行修复脚本
mysql -u root -p community_forum < backend/src/main/resources/db/fix_deleted_column.sql
```

### 方法3: 使用 MySQL Workbench 或其他 GUI 工具

1. 打开 MySQL Workbench
2. 连接到数据库
3. 选择 `community_forum` 数据库
4. 打开 `backend/src/main/resources/db/fix_deleted_column.sql`
5. 点击执行按钮 ⚡

## 验证修复

执行以下 SQL 验证字段已添加：

```sql
USE community_forum;

-- 查看 categories 表结构
DESC categories;

-- 查看 tags 表结构
DESC tags;

-- 应该能看到 deleted 字段
```

**期望输出**:
```
+-------------+-----------+------+-----+-------------------+
| Field       | Type      | Null | Key | Default           |
+-------------+-----------+------+-----+-------------------+
| ...         | ...       | ...  | ... | ...               |
| deleted     | tinyint   | YES  |     | 0                 |
+-------------+-----------+------+-----+-------------------+
```

## 修复完成后

1. **重启后端服务器**（如果正在运行）

2. **测试接口**:
```bash
curl "http://localhost:8083/api/posts?page=1&pageSize=20&sortBy=latest"
```

**期望结果**: 返回帖子列表 JSON，不再报错

3. **检查日志**: 应该不再有 `Unknown column 'deleted'` 错误

## 为什么会出现这个问题？

MyBatis Plus 全局配置了逻辑删除：

```yaml
# application.yml
mybatis-plus:
  global-config:
    db-config:
      logic-delete-field: deleted
      logic-delete-value: 1
      logic-not-delete-value: 0
```

这意味着 MyBatis Plus 会在所有表的查询中自动添加 `AND deleted=0` 条件，但 `categories` 和 `tags` 表初始创建时没有这个字段。

## 已修复的文件

1. ✅ `backend/src/main/resources/db/schema.sql` - 已更新表结构
2. ✅ `backend/src/main/resources/db/fix_deleted_column.sql` - 新增修复脚本

## 相关表的 deleted 字段状态

| 表名 | 是否有 deleted 字段 | 状态 |
|------|---------------------|------|
| users | ❌ 否 | 不需要（用户不删除，只禁用） |
| categories | ✅ 是（已修复） | 需要 |
| tags | ✅ 是（已修复） | 需要 |
| posts | ✅ 是 | 正常 |
| replies | ✅ 是 | 正常 |
| likes | ❌ 否 | 不需要（点赞取消是物理删除） |
| favorites | ❌ 否 | 不需要（收藏取消是物理删除） |
| messages | ✅ 是 | 正常 |
| notifications | ✅ 是 | 正常 |
| follows | ❌ 否 | 不需要（取关是物理删除） |

## 故障排除

### 如果还是报错

1. **确认字段已添加**:
```sql
SELECT COLUMN_NAME, COLUMN_TYPE, COLUMN_DEFAULT
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'community_forum'
  AND TABLE_NAME IN ('categories', 'tags')
  AND COLUMN_NAME = 'deleted';
```

2. **确认后端服务器已重启**

3. **检查 MyBatis Plus 配置**:
   - 打开 `application.yml`
   - 确认 `logic-delete-field: deleted` 配置正确

4. **查看完整错误日志**，确认是否还有其他表缺少字段
