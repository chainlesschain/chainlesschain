# ChainlessChain 社区论坛

基于U盾/SIMKey硬件认证的去中心化社区论坛平台。

## 项目简介

ChainlessChain Community是一个安全的社区交流平台，用户可以通过U盾或SIMKey进行身份认证，分享经验、提出问题、反馈bug和参与讨论。

### 核心特性

- 🔐 **硬件认证**: 基于U盾/SIMKey的安全登录
- 💬 **论坛功能**: 发帖、回复、点赞、收藏
- 🏷️ **分类管理**: 问答、讨论、反馈、公告等分类
- 🔍 **全文搜索**: 快速搜索帖子和回复
- 👤 **用户系统**: 个人主页、声望系统、徽章
- 📊 **数据统计**: 热门话题、活跃用户
- 🌙 **主题切换**: 支持明暗主题
- 📱 **响应式**: 支持PC和移动端

## 技术栈

### 后端
- **框架**: Spring Boot 3.2.1
- **数据库**: MySQL 8.0 + Redis 7.0
- **ORM**: MyBatis Plus 3.5.5
- **安全**: Spring Security + JWT
- **搜索**: Elasticsearch 8.0
- **文档**: Swagger/OpenAPI 3.0

### 前端
- **框架**: Vue 3 + Composition API
- **UI库**: Element Plus
- **构建**: Vite 5
- **状态**: Pinia
- **路由**: Vue Router 4
- **Markdown**: markdown-it
- **代码高亮**: highlight.js

### 部署
- **容器化**: Docker + Docker Compose
- **Web服务器**: Nginx
- **反向代理**: Nginx

## 快速开始

### 前置要求

- Docker Desktop (推荐)
- 或 JDK 17+ / Node.js 18+ / MySQL 8.0 / Redis 7.0

### 一键启动（Docker）

#### Windows

```bash
cd community-forum
start.bat
```

#### Linux/Mac

```bash
cd community-forum
chmod +x start.sh
./start.sh
```

### 访问系统

- **前端**: http://localhost:8081
- **API文档**: http://localhost:8082/api/swagger-ui.html

### 手动部署

#### 启动后端

```bash
cd backend
mvn clean package
java -jar target/community-forum-1.0.0.jar
```

#### 启动前端

```bash
cd frontend
npm install
npm run dev
```

## 功能模块

### 1. 用户认证

- U盾/SIMKey登录
- DID身份验证
- JWT Token管理
- 会话管理

### 2. 论坛板块

#### 问答区
- 提问和回答
- 采纳最佳答案
- 悬赏积分

#### 讨论区
- 技术讨论
- 经验分享
- 项目展示

#### 反馈区
- Bug反馈
- 功能建议
- 产品改进

#### 公告区
- 官方公告
- 版本更新
- 活动通知

### 3. 用户功能

- 个人主页
- 发帖历史
- 回复记录
- 收藏夹
- 关注/粉丝
- 私信功能

### 4. 管理功能

- 内容审核
- 用户管理
- 板块管理
- 标签管理
- 数据统计

## 数据库设计

### 核心表

1. **users** - 用户表
2. **posts** - 帖子表
3. **replies** - 回复表
4. **categories** - 分类表
5. **tags** - 标签表
6. **likes** - 点赞表
7. **favorites** - 收藏表
8. **notifications** - 通知表

## API接口

### 认证接口

- `POST /api/auth/login` - U盾/SIMKey登录
- `POST /api/auth/logout` - 登出
- `POST /api/auth/refresh` - 刷新Token

### 帖子接口

- `GET /api/posts` - 获取帖子列表
- `GET /api/posts/{id}` - 获取帖子详情
- `POST /api/posts` - 创建帖子
- `PUT /api/posts/{id}` - 编辑帖子
- `DELETE /api/posts/{id}` - 删除帖子

### 回复接口

- `GET /api/posts/{postId}/replies` - 获取回复列表
- `POST /api/posts/{postId}/replies` - 创建回复
- `PUT /api/replies/{id}` - 编辑回复
- `DELETE /api/replies/{id}` - 删除回复

### 互动接口

- `POST /api/posts/{id}/like` - 点赞
- `POST /api/posts/{id}/favorite` - 收藏
- `POST /api/posts/{id}/share` - 分享

## 配置说明

### 后端配置 (application.yml)

```yaml
spring:
  datasource:
    url: jdbc:mysql://localhost:3306/community_forum
    username: root
    password: your_password

  redis:
    host: localhost
    port: 6379

jwt:
  secret: your-jwt-secret
  expiration: 86400000

elasticsearch:
  host: localhost
  port: 9200
```

### 前端配置 (vite.config.js)

```javascript
server: {
  port: 8081,
  proxy: {
    '/api': {
      target: 'http://localhost:8082',
      changeOrigin: true
    }
  }
}
```

## 开发指南

### 代码规范

- 后端: Google Java Style
- 前端: Vue 3 + TypeScript
- Git提交: Conventional Commits

### 分支管理

- `main`: 生产环境
- `develop`: 开发环境
- `feature/*`: 功能分支
- `bugfix/*`: 修复分支

### 提交PR

1. Fork项目
2. 创建功能分支
3. 提交变更
4. 发起Pull Request

## 安全说明

### 数据加密

- 密码使用BCrypt加密
- 通信使用HTTPS
- 敏感数据加密存储

### 权限控制

- 基于角色的访问控制(RBAC)
- 用户、版主、管理员三级权限
- 操作审计日志

### 防护措施

- SQL注入防护
- XSS攻击防护
- CSRF防护
- 接口限流
- 内容审核

## 部署架构

```
                    Nginx (80/443)
                         |
        +----------------+----------------+
        |                                 |
   Vue Frontend                    Spring Boot Backend
   (Port 8081)                        (Port 8082)
                                           |
        +------------------+----------------+
        |                 |                |
     MySQL            Redis          Elasticsearch
   (Port 3306)      (Port 6379)      (Port 9200)
```

## 性能优化

- Redis缓存热点数据
- Elasticsearch全文搜索
- CDN加速静态资源
- 数据库索引优化
- 前端懒加载

## 监控和日志

- Spring Boot Actuator
- Prometheus + Grafana
- ELK日志分析
- 性能监控

## 路线图

### v1.0 (当前)

- ✅ 基础论坛功能
- ✅ U盾/SIMKey认证
- ✅ 帖子发布和回复
- ✅ 搜索功能
- ✅ 用户系统

### v1.5 (计划中)

- 🔄 实时通知
- 🔄 私信功能
- 🔄 富文本编辑器增强
- 🔄 移动端App
- 🔄 多语言支持

### v2.0 (未来)

- 📋 WebRTC视频会议
- 📋 直播功能
- 📋 知识库集成
- 📋 AI助手
- 📋 去中心化存储

## 贡献者

感谢所有贡献者！

## 许可证

MIT License

---

© 2024 ChainlessChain Team. All Rights Reserved.

官网: https://www.chainlesschain.com
文档: https://docs.chainlesschain.com
社区: https://community.chainlesschain.com
