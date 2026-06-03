# 论坛服务重启指南

## 问题总结
GET /api/posts 接口返回 401 错误的原因：后端服务器未运行或配置未生效。

## 已修复的问题

### 1. SecurityConfig 配置
**文件**: `backend/src/main/java/com/chainlesschain/community/config/SecurityConfig.java`

- ✅ 添加了 `HttpMethod` 导入
- ✅ 明确指定 GET 请求的 permitAll() 配置
- ✅ 暂时将 `anyRequest().permitAll()` 用于调试

### 2. 前端环境配置
**文件**: `frontend/.env.development`

- ✅ 修正端口号从 8081 → 8083

### 3. 后端代码修复
**文件**: `backend/src/main/java/com/chainlesschain/community/service/AuthService.java`

- ✅ 修复 DID 字段生成问题

**文件**: `backend/src/main/java/com/chainlesschain/community/service/PostService.java`

- ✅ 修复 `convertToListVO` 方法，正确填充用户、分类、标签信息

## 启动步骤

### 方法1: 使用 Maven（推荐）

```bash
# 1. 进入后端目录
cd C:\code\chainlesschain\community-forum\backend

# 2. 清理并编译
mvn clean compile

# 3. 启动后端服务
mvn spring-boot:run
```

### 方法2: 使用 IDE

1. 打开 IDEA 或 Eclipse
2. 打开项目: `C:\code\chainlesschain\community-forum\backend`
3. 找到主类: `CommunityForumApplication.java`
4. 右键 → Run 'CommunityForumApplication'

### 方法3: 使用编译后的 JAR

```bash
# 1. 打包
cd C:\code\chainlesschain\community-forum\backend
mvn clean package -DskipTests

# 2. 运行
java -jar target/community-forum-0.0.1-SNAPSHOT.jar
```

## 启动后端后的验证

### 1. 检查后端是否启动成功

```bash
# 检查端口是否监听
netstat -ano | findstr :8083

# 测试健康检查（如果有）
curl http://localhost:8083/api/actuator/health

# 测试帖子列表接口
curl "http://localhost:8083/api/posts?page=1&pageSize=20&sortBy=latest"
```

**期望结果**: 应该返回帖子列表的 JSON 数据，而不是 401 错误

### 2. 启动前端

```bash
cd C:\code\chainlesschain\community-forum\frontend
npm run dev
```

**前端地址**: http://localhost:5173

### 3. 测试登录

**测试账号**:
- 设备ID: `UKEY-ADMIN-001`
- PIN码: `123456`

## 常见问题排查

### Q1: 后端启动失败 - 端口占用
```bash
# 查找占用 8083 端口的进程
netstat -ano | findstr :8083

# 结束进程（替换 <PID> 为实际进程ID）
taskkill /PID <PID> /F
```

### Q2: 数据库连接失败
检查 `application.yml` 中的数据库配置：
```yaml
spring:
  datasource:
    url: jdbc:mysql://localhost:3306/community_forum
    username: root
    password: root
```

确保 MySQL 服务正在运行：
```bash
# 检查 MySQL 服务
sc query MySQL80

# 启动 MySQL 服务
net start MySQL80
```

### Q3: 依然返回 401

**可能原因**:
1. 后端未重启 → 重启后端
2. 前端缓存旧的 token → 清除浏览器 localStorage
3. 请求路径不对 → 检查前端 API 配置

**调试步骤**:
```bash
# 1. 直接测试后端 API（不带 token）
curl -v "http://localhost:8083/api/posts?page=1&pageSize=20&sortBy=latest"

# 2. 查看后端日志
# 日志应该在控制台输出，查找 "JWT authentication" 或 "SecurityConfig" 相关信息
```

## 下一步配置（安全）

当确认接口可以正常访问后，需要将 SecurityConfig 改回安全配置：

```java
// 将这一行：
.anyRequest().permitAll()

// 改回：
.anyRequest().authenticated()
```

这样只有公开的 GET 接口可以无需登录访问，其他操作（POST、PUT、DELETE）需要登录。

## 数据库数据

测试数据已在 `backend/src/main/resources/db/data.sql` 中：
- 4个测试用户
- 5个测试帖子
- 5个分类
- 8个标签

## 技术栈版本

- Java: 17+
- Spring Boot: 3.1.5
- MySQL: 8.0+
- Node.js: 16+
- Vue: 3.x
- Element Plus: Latest

## 联系与支持

如遇到问题，请检查：
1. 后端控制台日志
2. 前端浏览器控制台 (F12)
3. MySQL 数据库是否有数据
