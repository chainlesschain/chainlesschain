# Plugin Marketplace Service

独立的插件市场微服务，提供插件发布、浏览、下载、评分等完整功能。

## 技术栈

- **Spring Boot**: 3.1.11
- **Java**: 17
- **Database**: PostgreSQL 16
- **Cache**: Redis 7
- **ORM**: MyBatis Plus 3.5.9
- **Security**: Spring Security + JWT
- **Storage**: MinIO (S3-compatible)

## 功能特性

### 核心功能
- ✅ 插件 CRUD 操作
- ✅ 插件版本管理
- ✅ 插件分类和标签
- ✅ 插件搜索和筛选
- ✅ 插件下载统计
- ✅ 插件评分和评论
- ✅ 插件举报系统
- ✅ 用户认证和授权

### 数据库表结构
- `plugins` - 插件主表
- `plugin_versions` - 版本历史
- `plugin_ratings` - 评分评论
- `plugin_reports` - 举报记录
- `plugin_downloads` - 下载统计
- `categories` - 分类管理
- `users` - 用户账户

## 快速开始

### 1. 环境要求
- Java 17+
- PostgreSQL 16+
- Redis 7+
- MinIO (可选)
- Maven 3.8+

### 2. 数据库初始化
```bash
# 创建数据库
psql -U postgres -c "CREATE DATABASE plugin_marketplace;"

# 执行schema
psql -U postgres -d plugin_marketplace -f src/main/resources/schema.sql
```

### 3. 配置环境变量
```bash
export DB_HOST=localhost
export DB_PORT=5432
export DB_NAME=plugin_marketplace
export DB_USER=chainlesschain
export DB_PASSWORD=chainlesschain_pwd_2024

export REDIS_HOST=localhost
export REDIS_PORT=6379
export REDIS_PASSWORD=chainlesschain_redis_2024

export MINIO_ENDPOINT=http://localhost:9000
export MINIO_ACCESS_KEY=minioadmin
export MINIO_SECRET_KEY=minioadmin
```

### 4. 启动服务
```bash
# 编译
mvn clean compile

# 运行
mvn spring-boot:run

# 或打包后运行
mvn clean package
java -jar target/plugin-marketplace-service-1.0.0.jar
```

### 5. 访问服务
- API Base URL: http://localhost:8090/api
- Swagger UI: http://localhost:8090/api/swagger-ui.html
- Health Check: http://localhost:8090/api/actuator/health

## API 端点

### 插件管理
- `GET /plugins` - 获取插件列表
- `GET /plugins/{id}` - 获取插件详情
- `POST /plugins` - 发布插件
- `PUT /plugins/{id}` - 更新插件
- `DELETE /plugins/{id}` - 删除插件
- `GET /plugins/search` - 搜索插件
- `GET /plugins/featured` - 获取推荐插件
- `GET /plugins/popular` - 获取热门插件

### 版本管理
- `GET /plugins/{id}/versions` - 获取版本列表
- `POST /plugins/{id}/versions` - 发布新版本
- `GET /plugins/{id}/versions/{version}` - 获取版本详情

### 下载
- `GET /plugins/{id}/download` - 下载插件
- `POST /plugins/check-updates` - 检查更新

### 评分评论
- `POST /plugins/{id}/ratings` - 提交评分
- `GET /plugins/{id}/ratings` - 获取评论列表
- `PUT /ratings/{id}` - 更新评论
- `DELETE /ratings/{id}` - 删除评论

### 举报
- `POST /plugins/{id}/reports` - 举报插件
- `GET /reports` - 获取举报列表（管理员）
- `PUT /reports/{id}` - 处理举报（管理员）

### 分类
- `GET /categories` - 获取分类列表

### 统计
- `GET /plugins/{id}/stats` - 获取插件统计
- `GET /stats/overview` - 获取市场概览

## 配置说明

### application.yml
```yaml
server:
  port: 8090

marketplace:
  max-plugin-size: 52428800  # 50MB
  allowed-extensions: .zip,.tar.gz
  cache-ttl: 3600
  featured-limit: 10
  popular-limit: 20
```

### JWT 配置
```yaml
jwt:
  secret: your-secret-key
  expiration: 86400000  # 24 hours
  refresh-expiration: 604800000  # 7 days
```

### MinIO 配置
```yaml
minio:
  endpoint: http://localhost:9000
  access-key: minioadmin
  secret-key: minioadmin
  bucket-name: plugin-marketplace
```

## 安全性

### 认证
- JWT Token 认证
- 支持 Token 刷新
- 密码 BCrypt 加密

### 授权
- 基于角色的访问控制（RBAC）
- 角色：developer, admin, moderator
- 插件发布需要认证
- 管理操作需要管理员权限

### 文件安全
- 文件大小限制
- 文件类型验证
- 文件哈希校验
- 病毒扫描（可选）

## 性能优化

### 缓存策略
- Redis 缓存热门插件
- 缓存分类列表
- 缓存统计数据
- TTL 1小时

### 数据库优化
- 索引优化
- 分页查询
- 连接池配置
- 慢查询监控

## 监控和日志

### 日志
- 请求日志
- 错误日志
- 审计日志
- 性能日志

### 监控指标
- API 响应时间
- 数据库连接数
- 缓存命中率
- 下载统计

## 部署

### Docker 部署
```bash
# 构建镜像
docker build -t plugin-marketplace-service:1.0.0 .

# 运行容器
docker run -d \
  -p 8090:8090 \
  -e DB_HOST=postgres \
  -e REDIS_HOST=redis \
  --name plugin-marketplace \
  plugin-marketplace-service:1.0.0
```

### Docker Compose
```yaml
version: '3.8'
services:
  plugin-marketplace:
    image: plugin-marketplace-service:1.0.0
    ports:
      - "8090:8090"
    environment:
      - DB_HOST=postgres
      - REDIS_HOST=redis
    depends_on:
      - postgres
      - redis
```

## 开发指南

### 添加新功能
1. 创建 Entity 类
2. 创建 Mapper 接口
3. 创建 Service 类
4. 创建 Controller 类
5. 编写单元测试

### 代码规范
- 遵循 Google Java Style Guide
- 使用 Lombok 简化代码
- 添加 Javadoc 注释
- 编写单元测试

## 测试

### 运行测试
```bash
# 运行所有测试
mvn test

# 运行特定测试
mvn test -Dtest=PluginServiceTest
```

### 测试覆盖率
```bash
mvn clean test jacoco:report
```

## 故障排查

### 常见问题

**1. 数据库连接失败**
- 检查数据库是否运行
- 验证连接配置
- 检查防火墙设置

**2. Redis 连接失败**
- 检查 Redis 是否运行
- 验证密码配置
- 检查网络连接

**3. 文件上传失败**
- 检查 MinIO 配置
- 验证文件大小限制
- 检查存储空间

## 许可证

MIT License

## 联系方式

- 项目主页: https://github.com/chainlesschain/plugin-marketplace-service
- 问题反馈: https://github.com/chainlesschain/plugin-marketplace-service/issues
- 邮箱: dev@chainlesschain.com
