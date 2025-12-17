# 数据库初始化指南

## 📋 前置要求

- MySQL 8.0+
- 确保MySQL服务已启动

## 🚀 快速初始化

### 方法1：使用MySQL命令行（推荐）

```bash
# 1. 登录MySQL
mysql -u root -p

# 2. 创建数据库
CREATE DATABASE community_forum CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

# 3. 退出MySQL
exit;

# 4. 导入表结构
mysql -u root -p community_forum < backend/src/main/resources/db/schema.sql

# 5. 导入测试数据
mysql -u root -p community_forum < backend/src/main/resources/db/data.sql
```

### 方法2：使用SQL文件（一次性）

```bash
# 直接导入schema.sql（包含CREATE DATABASE语句）
mysql -u root -p < backend/src/main/resources/db/schema.sql

# 导入测试数据
mysql -u root -p community_forum < backend/src/main/resources/db/data.sql
```

### 方法3：使用MySQL Workbench

1. 打开MySQL Workbench
2. 连接到本地MySQL服务器
3. 依次执行以下操作：
   - File → Open SQL Script → 选择 `schema.sql`
   - 点击 ⚡ 执行
   - File → Open SQL Script → 选择 `data.sql`
   - 点击 ⚡ 执行

## 📊 验证数据库

初始化完成后，验证数据是否正确：

```sql
-- 使用数据库
USE community_forum;

-- 检查表是否创建
SHOW TABLES;

-- 应该看到以下表：
-- categories
-- favorites
-- follows
-- likes
-- messages
-- notifications
-- operation_logs
-- post_tags
-- posts
-- replies
-- reports
-- tags
-- users

-- 检查测试数据
SELECT COUNT(*) FROM users;    -- 应该有4条记录
SELECT COUNT(*) FROM posts;    -- 应该有5条记录
SELECT COUNT(*) FROM categories; -- 应该有5条记录
SELECT COUNT(*) FROM tags;     -- 应该有8条记录

-- 查看帖子列表
SELECT id, title, user_id, category_id FROM posts;
```

## 🔧 配置检查

确保 `application.yml` 配置正确：

```yaml
spring:
  datasource:
    url: jdbc:mysql://localhost:3306/community_forum?useSSL=false&serverTimezone=Asia/Shanghai&characterEncoding=utf8&allowPublicKeyRetrieval=true
    username: root
    password: root  # 修改为你的MySQL密码

server:
  port: 8083
  servlet:
    context-path: /api
```

## 🌐 API访问地址

数据库初始化后，启动后端服务，使用以下地址访问API：

### 基础URL
```
http://localhost:8083/api
```

### 测试接口

1. **获取帖子列表**
   ```
   GET http://localhost:8083/api/posts?page=1&pageSize=20&sortBy=latest
   ```

2. **获取分类列表**
   ```
   GET http://localhost:8083/api/categories
   ```

3. **API文档**
   ```
   http://localhost:8083/api/swagger-ui.html
   ```

4. **健康检查**
   ```
   GET http://localhost:8083/actuator/health
   ```

## 📝 测试账号

已创建以下测试用户（不需要真实的U盾/SIMKey）：

| 用户名 | 昵称 | 设备ID | 角色 |
|--------|------|--------|------|
| admin | 系统管理员 | UKEY-ADMIN-001 | ADMIN |
| alice | Alice | UKEY-USER-001 | USER |
| bob | Bob | SIMKEY-USER-002 | USER |
| carol | Carol | UKEY-USER-003 | USER |

登录时使用：
- **deviceId**: 如 `UKEY-ADMIN-001`
- **pin**: 任意6位数字（测试环境）

## 🔄 重置数据库

如果需要重置数据库：

```bash
# 删除数据库
mysql -u root -p -e "DROP DATABASE IF EXISTS community_forum;"

# 重新创建并导入
mysql -u root -p < backend/src/main/resources/db/schema.sql
mysql -u root -p community_forum < backend/src/main/resources/db/data.sql
```

## 🐛 常见问题

### 1. 错误：Access denied for user

检查MySQL密码是否正确，修改 `application.yml` 中的密码配置。

### 2. 错误：Unknown database 'community_forum'

数据库未创建，执行：
```sql
CREATE DATABASE community_forum CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

### 3. 错误：Table 'community_forum.posts' doesn't exist

表结构未导入，执行：
```bash
mysql -u root -p community_forum < backend/src/main/resources/db/schema.sql
```

### 4. API返回空数据

测试数据未导入，执行：
```bash
mysql -u root -p community_forum < backend/src/main/resources/db/data.sql
```

### 5. 端口错误 (8080 vs 8083)

配置文件中的端口是 **8083**，不是8080。
正确的URL：`http://localhost:8083/api/posts`

## ✅ 初始化检查清单

- [ ] MySQL服务已启动
- [ ] 数据库 `community_forum` 已创建
- [ ] 表结构已导入（13张表）
- [ ] 测试数据已导入（4用户、5帖子）
- [ ] application.yml 配置正确
- [ ] 端口号为 8083
- [ ] 后端服务已启动
- [ ] API可以访问

完成所有步骤后，访问 http://localhost:8083/api/posts 应该能看到5条测试帖子！
