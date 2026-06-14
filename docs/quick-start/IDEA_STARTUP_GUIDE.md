# 使用IntelliJ IDEA启动ChainlessChain后端服务

## 📋 前置条件

- ✅ IntelliJ IDEA已安装
- ✅ JDK 17已安装
- ✅ Docker服务已启动（PostgreSQL + Redis）

---

## 🚀 启动步骤

### 1. 打开项目

1. 启动IntelliJ IDEA
2. 选择 `File` → `Open`
3. 导航到：`D:\code\chainlesschain\backend\project-service`
4. 点击 `OK`

### 2. 等待Maven依赖下载

IDEA会自动识别Maven项目并开始下载依赖：

1. 查看右下角进度条：`Resolving Maven dependencies...`
2. 等待完成（首次可能需要5-10分钟）
3. 如果下载失败，检查Maven配置：
   - `File` → `Settings` → `Build, Execution, Deployment` → `Build Tools` → `Maven`
   - 确认Maven home directory正确
   - 可以配置国内镜像加速（阿里云）

### 3. 配置运行配置

#### 方式一：自动配置（推荐）
1. 找到主类：`src/main/java/com/chainlesschain/project/ProjectServiceApplication.java`
2. 右键点击文件
3. 选择 `Run 'ProjectServiceApplication'`
4. IDEA会自动创建运行配置

#### 方式二：手动配置
1. 点击右上角 `Add Configuration...`
2. 点击 `+` → `Spring Boot`
3. 配置如下：
   - **Name**: `ProjectService`
   - **Main class**: `com.chainlesschain.project.ProjectServiceApplication`
   - **Working directory**: `$MODULE_WORKING_DIR$`
   - **Use classpath of module**: `project-service`
   - **JRE**: 17
4. 点击 `OK`

### 4. 启动服务

1. 点击右上角的绿色运行按钮 ▶️
2. 或按快捷键 `Shift + F10`
3. 查看控制台输出

### 5. 验证启动成功

在控制台中查找以下日志：

```
  .   ____          _            __ _ _
 /\\ / ___'_ __ _ _(_)_ __  __ _ \ \ \ \
( ( )\___ | '_ | '_| | '_ \/ _` | \ \ \ \
 \\/  ___)| |_)| | | | | || (_| |  ) ) ) )
  '  |____| .__|_| |_|_| |_\__, | / / / /
 =========|_|==============|___/=/_/_/_/
 :: Spring Boot ::               (v3.1.11)

2026-01-09 15:30:00.000  INFO 12345 --- [main] c.c.p.ProjectServiceApplication : Starting ProjectServiceApplication
2026-01-09 15:30:05.000  INFO 12345 --- [main] o.s.b.w.embedded.tomcat.TomcatWebServer  : Tomcat started on port(s): 9090 (http)
2026-01-09 15:30:05.100  INFO 12345 --- [main] c.c.p.ProjectServiceApplication : Started ProjectServiceApplication in 5.123 seconds
```

看到 `Started ProjectServiceApplication` 表示启动成功！

---

## 🧪 测试API

### 方式一：使用浏览器
访问：http://localhost:9090/swagger-ui.html

### 方式二：使用IDEA HTTP Client
1. 在项目中创建文件：`test-api.http`
2. 添加以下内容：

```http
### 健康检查
GET http://localhost:9090/api/conversations/health

### 创建对话
POST http://localhost:9090/api/conversations/create
Content-Type: application/json

{
  "title": "测试对话",
  "userId": "user_test_001",
  "contextMode": "global"
}

### 查询对话列表
GET http://localhost:9090/api/conversations/list?userId=user_test_001&pageNum=1&pageSize=10
```

3. 点击请求旁边的绿色箭头 ▶️ 执行

### 方式三：使用Postman
导入文件：`D:\code\chainlesschain\ChainlessChain_API_Tests.postman_collection.json`

---

## ⚠️ 常见问题

### 问题1：端口被占用
**错误信息**:
```
Web server failed to start. Port 9090 was already in use.
```

**解决方案**:
1. 检查端口占用：
   ```bash
   netstat -ano | findstr :9090
   ```
2. 杀死占用进程或修改端口：
   - 编辑 `src/main/resources/application.yml`
   - 修改 `server.port: 9090` 为其他端口

### 问题2：数据库连接失败
**错误信息**:
```
Connection to localhost:5432 refused
```

**解决方案**:
1. 确认Docker服务已启动：
   ```bash
   docker ps | findstr postgres
   ```
2. 如果未启动，执行：
   ```bash
   cd D:\code\chainlesschain\config\docker
   docker-compose up -d postgres redis
   ```

### 问题3：Maven依赖下载失败
**错误信息**:
```
Could not resolve dependencies
```

**解决方案**:
1. 配置阿里云Maven镜像：
   - 打开 `File` → `Settings` → `Build Tools` → `Maven`
   - 点击 `User settings file` 旁边的 `Override`
   - 编辑 `settings.xml`，添加：

```xml
<mirrors>
  <mirror>
    <id>aliyun</id>
    <mirrorOf>central</mirrorOf>
    <name>Aliyun Maven</name>
    <url>https://maven.aliyun.com/repository/public</url>
  </mirror>
</mirrors>
```

2. 点击 `Reload All Maven Projects` 按钮（右侧Maven面板）

### 问题4：JDK版本不匹配
**错误信息**:
```
java: error: release version 17 not supported
```

**解决方案**:
1. 下载JDK 17：https://adoptium.net/
2. 配置IDEA：
   - `File` → `Project Structure` → `Project`
   - 设置 `SDK` 为 JDK 17
   - 设置 `Language level` 为 17

### 问题5：Flyway迁移失败
**错误信息**:
```
FlywayException: Unable to obtain connection from database
```

**解决方案**:
1. 检查数据库配置：`src/main/resources/application.yml`
2. 确认数据库已创建：
   ```bash
   docker exec -it chainlesschain-postgres psql -U chainlesschain -d chainlesschain
   ```
3. 如果数据库不存在，创建：
   ```sql
   CREATE DATABASE chainlesschain;
   ```

---

## 🔧 开发技巧

### 1. 热重载
启用Spring Boot DevTools自动重启：
1. 添加依赖（已包含）
2. `File` → `Settings` → `Build, Execution, Deployment` → `Compiler`
3. 勾选 `Build project automatically`
4. `Help` → `Find Action` → 搜索 `Registry`
5. 勾选 `compiler.automake.allow.when.app.running`

### 2. 调试模式
1. 点击右上角的调试按钮 🐛
2. 或按快捷键 `Shift + F9`
3. 在代码中设置断点（点击行号左侧）

### 3. 查看日志
1. 在控制台底部查看实时日志
2. 日志文件位置：`logs/project-service.log`

### 4. 数据库管理
1. 打开 `Database` 面板（右侧）
2. 点击 `+` → `Data Source` → `PostgreSQL`
3. 配置连接：
   - **Host**: localhost
   - **Port**: 5432
   - **Database**: chainlesschain
   - **User**: chainlesschain
   - **Password**: chainlesschain_pwd_2024
4. 点击 `Test Connection`
5. 点击 `OK`

---

## 📊 性能监控

### 1. Actuator端点
访问：http://localhost:9090/actuator

可用端点：
- `/actuator/health` - 健康检查
- `/actuator/info` - 应用信息
- `/actuator/metrics` - 性能指标

### 2. JVM监控
使用IDEA内置的Profiler：
1. 右键点击运行配置
2. 选择 `Run with Profiler`
3. 查看CPU和内存使用情况

---

## 🎯 下一步

启动成功后，请按照以下步骤测试：

1. ✅ 访问Swagger UI：http://localhost:9090/swagger-ui.html
2. ✅ 测试健康检查：`GET /api/conversations/health`
3. ✅ 创建测试对话：`POST /api/conversations/create`
4. ✅ 查询对话列表：`GET /api/conversations/list`
5. ✅ 创建测试消息：`POST /api/conversations/messages/create`
6. ✅ 查询消息列表：`GET /api/conversations/{id}/messages`

详细测试步骤请参考：`TESTING_GUIDE_2026-01-09.md`

---

## 📞 获取帮助

如果遇到问题：
1. 查看控制台错误日志
2. 检查 `logs/project-service.log`
3. 参考 `TESTING_GUIDE_2026-01-09.md`
4. 查看 `FINAL_SUMMARY_2026-01-09.md`

---

**祝您测试顺利！** 🎉

## 附录：规范章节补全（v5.0.3.108）

> 为对齐项目用户文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文细节。

### 1. 概述
见正文头部。使用 IntelliJ IDEA 启动后端服务：Java 后端开发环境启动。

### 2. 核心特性
IDEA 配置 / Spring Boot 启动 / 调试。

### 3. 系统架构
见正文 / [系统架构](../design/系统设计_主文档.md)（三端 + 双后端 + P2P）。

### 4. 系统定位
ChainlessChain 的「IDEA 后端启动指南」。

### 5. 核心功能
见正文各节。

### 6. 技术架构
Electron + Vue3 / Spring Boot + FastAPI / libp2p + Signal / SQLCipher（按需）。

### 7. 系统特点
见正文（步骤 / 版本 / 注意事项）。

### 8. 应用场景
见正文使用场景。

### 9. 竞品对比
见正文对比（如有）。

### 10. 配置参考
见正文配置 / 环境变量章节；`.chainlesschain/config.json`。

### 11. 性能指标
见正文性能 / 资源要求（如有）。

### 12. 测试覆盖
见正文验证步骤（如有）。

### 13. 安全考虑
见正文安全 / 密钥章节；本地加密 + U盾/SIMKey（如适用）。

### 14. 故障排除
见正文故障排查 / 常见问题章节。

### 15. 关键文件
见正文涉及的文件 / 目录。

### 16. 使用示例
见正文命令 / 操作示例。

### 17. 相关文档
[快速开始](./QUICK_START.md)、[安装指南](./INSTALLATION.md)、其它用户文档。
