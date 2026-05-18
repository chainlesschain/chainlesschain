# U盾/SIMKey厂家管理系统

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Vue](https://img.shields.io/badge/Vue-3.4.0-green.svg)](https://vuejs.org/)
[![Spring Boot](https://img.shields.io/badge/Spring%20Boot-3.2.1-brightgreen.svg)](https://spring.io/projects/spring-boot)

## 项目简介

这是一个功能完整的U盾和SIMKey设备厂家管理平台,提供设备全生命周期管理、多平台APP发布、数据备份恢复等核心功能。

### ✨ v1.1.0 更新

🎉 **新增完整的管理页面**:
- ✅ 设备注册页面 (单个/批量注册)
- ✅ 备份管理页面
- ✅ 用户管理页面
- ✅ 操作日志页面
- ✅ Dashboard控制台 (统计图表)
- ✅ 登录页面
- ✅ APP版本上传页面

**所有9个核心页面已全部完成!** 📱

### 核心功能

1. **设备管理**
   - 批量注册设备
   - 设备激活与绑定
   - 设备锁定/解锁
   - 设备状态监控

2. **密码恢复**
   - 多种验证方式(短信、邮箱、安全问题、助记词)
   - 密码重置流程
   - 操作日志审计

3. **数据备份恢复**
   - 设备数据加密备份
   - 数据恢复到新设备
   - 备份历史管理

4. **APP版本管理**
   - PC端(Windows/Mac/Linux)安装包管理
   - 移动端(Android/iOS)应用管理
   - 版本发布与更新
   - 自动更新检查
   - 下载统计

5. **用户管理**
   - 用户注册与认证
   - 角色权限控制
   - 用户设备绑定

6. **监控与审计**
   - 操作日志记录
   - 设备在线状态监控
   - 统计报表

## 技术栈

### 后端
- **框架**: Spring Boot 3.2.1
- **数据库**: MySQL 8.0
- **缓存**: Redis 7.0
- **ORM**: MyBatis Plus 3.5.5
- **安全**: Spring Security + JWT
- **文档**: Swagger/OpenAPI 3.0

### 前端
- **框架**: Vue 3 + Composition API
- **UI库**: Element Plus
- **构建工具**: Vite 5
- **状态管理**: Pinia
- **HTTP客户端**: Axios
- **图表**: ECharts

### 部署
- **容器化**: Docker + Docker Compose
- **Web服务器**: Nginx
- **反向代理**: Nginx

## 项目结构

```
manufacturer-system/
├── backend/                    # Spring Boot后端
│   ├── src/
│   │   ├── main/
│   │   │   ├── java/com/chainlesschain/manufacturer/
│   │   │   │   ├── controller/      # 控制器层
│   │   │   │   ├── service/         # 服务层
│   │   │   │   ├── mapper/          # 数据访问层
│   │   │   │   ├── entity/          # 实体类
│   │   │   │   ├── dto/             # 数据传输对象
│   │   │   │   ├── config/          # 配置类
│   │   │   │   └── common/          # 通用工具
│   │   │   └── resources/
│   │   │       ├── application.yml  # 配置文件
│   │   │       └── db/              # 数据库脚本
│   │   └── test/                    # 测试代码
│   ├── pom.xml                      # Maven配置
│   └── Dockerfile                   # Docker镜像
│
├── frontend/                   # Vue.js前端
│   ├── src/
│   │   ├── views/               # 页面组件
│   │   │   ├── device/          # 设备管理
│   │   │   ├── app/             # APP版本管理
│   │   │   ├── backup/          # 备份管理
│   │   │   ├── user/            # 用户管理
│   │   │   └── log/             # 日志管理
│   │   ├── layout/              # 布局组件
│   │   ├── router/              # 路由配置
│   │   ├── stores/              # 状态管理
│   │   ├── api/                 # API接口
│   │   ├── utils/               # 工具函数
│   │   └── assets/              # 静态资源
│   ├── package.json             # 依赖配置
│   ├── vite.config.js           # Vite配置
│   ├── nginx.conf               # Nginx配置
│   └── Dockerfile               # Docker镜像
│
├── docker-compose.yml          # Docker Compose配置
├── ARCHITECTURE.md             # 架构设计文档
└── README.md                   # 项目说明
```

## 快速开始

### 环境要求

- JDK 17+
- Maven 3.8+
- Node.js 18+
- MySQL 8.0+
- Redis 7.0+
- Docker & Docker Compose (可选)

### 方式一: Docker部署(推荐)

1. **克隆项目**
```bash
git clone <repository-url>
cd manufacturer-system
```

2. **启动所有服务**
```bash
docker-compose up -d
```

3. **访问系统**
- 前端管理界面: http://localhost
- 后端API文档: http://localhost:8080/api/swagger-ui.html
- 默认管理员账号: admin / admin123456

### 方式二: 本地开发部署

#### 后端启动

1. **创建数据库**
```bash
mysql -u root -p
CREATE DATABASE manufacturer_system DEFAULT CHARACTER SET utf8mb4;
```

2. **导入数据库表**
```bash
mysql -u root -p manufacturer_system < backend/src/main/resources/db/schema.sql
mysql -u root -p manufacturer_system < backend/src/main/resources/db/app_version_schema.sql
```

3. **修改配置**
编辑 `backend/src/main/resources/application.yml`,修改数据库和Redis连接信息

4. **编译启动**
```bash
cd backend
mvn clean package
java -jar target/manufacturer-system-1.0.0-SNAPSHOT.jar
```

或使用IDE直接运行 `ManufacturerSystemApplication.java`

#### 前端启动

1. **安装依赖**
```bash
cd frontend
npm install
```

2. **启动开发服务器**
```bash
npm run dev
```

3. **访问**: http://localhost:3000

## API文档

启动后端服务后,访问 Swagger文档:
- URL: http://localhost:8080/api/swagger-ui.html
- 在线API调试和文档查看

### 主要API接口

#### 设备管理
```
POST   /api/devices/register      # 批量注册设备
POST   /api/devices/activate      # 激活设备
GET    /api/devices/list          # 查询设备列表
GET    /api/devices/{deviceId}    # 查询设备详情
POST   /api/devices/{deviceId}/lock      # 锁定设备
POST   /api/devices/{deviceId}/unlock    # 解锁设备
POST   /api/devices/{deviceId}/deactivate # 注销设备
```

#### 密码恢复
```
POST   /api/recovery/initiate     # 发起密码恢复
POST   /api/recovery/verify       # 验证恢复信息
POST   /api/recovery/reset-password # 重置密码
```

#### 数据备份恢复
```
POST   /api/backup/create         # 创建备份
GET    /api/backup/list           # 查询备份列表
POST   /api/backup/restore        # 恢复数据
DELETE /api/backup/{backupId}     # 删除备份
```

#### APP版本管理
```
POST   /api/app-versions/upload   # 上传APP安装包
POST   /api/app-versions/create   # 创建版本
PUT    /api/app-versions/{versionId} # 更新版本信息
POST   /api/app-versions/{versionId}/publish   # 发布版本
POST   /api/app-versions/{versionId}/deprecate # 废弃版本
GET    /api/app-versions/list     # 查询版本列表
POST   /api/app-versions/check-update # 检查更新
GET    /api/app-versions/latest   # 获取最新版本
GET    /api/app-versions/download/{versionId} # 下载APP
```

## 数据库设计

### 核心表结构

1. **devices** - 设备表
   - 存储U盾和SIMKey设备信息
   - 设备状态、激活码、绑定用户等

2. **users** - 用户表
   - 用户基本信息
   - 角色权限、认证信息

3. **device_logs** - 设备操作日志
   - 所有设备操作的审计日志

4. **key_backups** - 密钥备份表
   - 加密的设备数据备份

5. **activation_codes** - 激活码表
   - 激活码生成和使用记录

6. **password_recovery** - 密码恢复记录
   - 密码找回流程记录

7. **app_versions** - APP版本表
   - PC和移动端应用版本信息

8. **app_downloads** - APP下载记录
   - 下载统计和追踪

详细设计见: [ARCHITECTURE.md](ARCHITECTURE.md)

## 使用说明

### 设备管理流程

1. **批量注册设备**
   - 进入"设备管理"页面
   - 点击"注册设备"
   - 上传设备列表CSV或手动添加
   - 系统自动生成设备ID和激活码

2. **激活设备**
   - 用户使用激活码激活设备
   - 绑定用户信息
   - 设备状态变为"已激活"

3. **设备管理**
   - 查看设备状态
   - 锁定异常设备
   - 注销报废设备

### APP版本管理流程

1. **上传新版本**
   - 进入"APP版本管理"
   - 点击"上传新版本"
   - 选择APP类型(PC/移动端)
   - 上传安装包文件
   - 填写版本信息和更新日志

2. **发布版本**
   - 测试版本无误后
   - 点击"发布"按钮
   - 用户端即可检测到更新

3. **APP更新检查**
   - 客户端调用检查更新API
   - 返回最新版本信息
   - 支持强制更新配置

## 配置说明

### 后端配置 (application.yml)

```yaml
# 数据库配置
spring:
  datasource:
    url: jdbc:mysql://localhost:3306/manufacturer_system
    username: root
    password: your_password

# Redis配置
  redis:
    host: localhost
    port: 6379

# JWT配置
jwt:
  secret: your-secret-key
  expiration: 86400000  # 24小时

# 系统配置
system:
  activation-code-validity-days: 365
  recovery-code-validity-seconds: 1800
  backup-retention-days: 730
```

### 前端配置 (vite.config.js)

```javascript
// API代理配置
server: {
  proxy: {
    '/api': {
      target: 'http://localhost:8080',
      changeOrigin: true
    }
  }
}
```

## 常见问题

### 1. 数据库连接失败
- 检查MySQL服务是否启动
- 确认数据库用户名密码正确
- 验证数据库已创建

### 2. 前端无法访问后端API
- 检查后端服务是否正常启动
- 确认端口号配置正确(默认8080)
- 查看浏览器控制台错误信息

### 3. 文件上传失败
- 检查上传目录权限
- 确认文件大小限制配置
- 查看后端日志错误信息

## 安全建议

1. **生产环境部署前必须修改**:
   - 数据库密码
   - JWT密钥
   - Redis密码
   - 默认管理员密码

2. **启用HTTPS**:
   - 配置SSL证书
   - 强制HTTPS访问

3. **定期备份**:
   - 数据库定期备份
   - 上传文件备份

4. **访问控制**:
   - 配置防火墙规则
   - 限制API访问频率
   - 启用IP白名单

## 性能优化

1. **数据库优化**:
   - 添加必要索引
   - 定期清理日志表
   - 配置连接池

2. **缓存优化**:
   - Redis缓存热点数据
   - 配置合理的过期时间

3. **文件存储**:
   - 大文件使用OSS对象存储
   - CDN加速静态资源

## 更新日志

### v1.0.0 (2024-12-02)
- 初始版本发布
- 设备管理核心功能
- APP版本管理
- 密码恢复和数据备份
- 后台管理界面

## 技术支持

- **官网**: https://www.chainlesschain.com
- **文档**: https://docs.chainlesschain.com
- **邮箱**: zhanglongfa@chainlesschain.com
- **电话**: 400-1068-687

## 许可证

本项目采用 MIT License 开源许可证

---

© 2024 ChainlessChain Team. All Rights Reserved.
