# ChainlessChain 打包依赖手动下载指南

由于网络限制，请按照以下步骤手动下载所需依赖。

## 📥 需要下载的文件

### 1. JRE 17 (Java Runtime Environment)
- **下载链接**: https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.13%2B11/OpenJDK17U-jre_x64_windows_hotspot_17.0.13_11.zip
- **备用链接**: https://adoptium.net/zh-CN/temurin/releases/ (选择 JRE 17 Windows x64)
- **文件大小**: ~45 MB
- **解压到**: `D:\code\chainlesschain\packaging\jre-17\`
- **说明**: 解压后应该有 `bin/java.exe` 文件

### 2. PostgreSQL 16 (数据库)
- **下载链接**: https://get.enterprisedb.com/postgresql/postgresql-16.6-1-windows-x64-binaries.zip
- **备用链接**: https://www.enterprisedb.com/download-postgresql-binaries (选择 16.x Windows x64 binaries)
- **文件大小**: ~180 MB
- **解压到**: `D:\code\chainlesschain\packaging\postgres\`
- **说明**: 解压后应该有 `bin/postgres.exe` 文件

### 3. Redis 5.0.14 (缓存数据库)
- **下载链接**: https://github.com/tporadowski/redis/releases/download/v5.0.14.1/Redis-x64-5.0.14.1.zip
- **备用链接**: https://github.com/tporadowski/redis/releases (选择最新版 x64)
- **文件大小**: ~5 MB
- **解压到**: `D:\code\chainlesschain\packaging\redis\`
- **说明**: 解压后应该有 `redis-server.exe` 文件

### 4. Qdrant 1.12.5 (向量数据库)
- **下载链接**: https://github.com/qdrant/qdrant/releases/download/v1.12.5/qdrant-x86_64-pc-windows-msvc.zip
- **备用链接**: https://github.com/qdrant/qdrant/releases (选择 Windows x86_64)
- **文件大小**: ~30 MB
- **解压到**: `D:\code\chainlesschain\packaging\qdrant\`
- **说明**: 解压后应该有 `qdrant.exe` 文件

---

## 📂 目录结构验证

下载并解压完成后，目录结构应该如下：

```
D:\code\chainlesschain\packaging\
├── jre-17\
│   ├── bin\
│   │   ├── java.exe
│   │   ├── javaw.exe
│   │   └── ...
│   └── lib\
├── postgres\
│   ├── bin\
│   │   ├── postgres.exe
│   │   ├── pg_ctl.exe
│   │   └── ...
│   └── lib\
├── redis\
│   ├── redis-server.exe
│   ├── redis-cli.exe
│   └── redis.conf
└── qdrant\
    └── qdrant.exe
```

---

## ✅ 验证脚本

运行以下命令验证所有依赖是否正确安装：

```bash
cd D:/code/chainlesschain/packaging

# 验证 JRE
./jre-17/bin/java.exe -version

# 验证 PostgreSQL
./postgres/bin/postgres.exe --version

# 验证 Redis
./redis/redis-server.exe --version

# 验证 Qdrant
./qdrant/qdrant.exe --version
```

---

## 🏗️ 构建 Java 项目

在下载完依赖后，还需要构建 Java 后端服务：

### 方法1: 使用 Maven (推荐)

```bash
cd D:/code/chainlesschain/backend/project-service
mvn clean package -DskipTests
```

生成的 JAR 文件位置: `backend/project-service/target/project-service-*.jar`

### 方法2: 如果没有 Maven

1. 下载 Maven: https://maven.apache.org/download.cgi
2. 解压到 `C:\Program Files\Apache\maven\`
3. 添加到 PATH: `C:\Program Files\Apache\maven\bin`
4. 重启终端，运行上述 mvn 命令

### 方法3: 跳过 Java 服务 (仅桌面功能)

如果只需要桌面应用的基础功能，可以跳过Java服务。修改 `desktop-app-vue/forge.config.js`:

```javascript
// 在第320行左右，找到：
} else if (missingResources.length > 0) {

// 改为：
} else if (missingResources.filter(r => !r.includes('project-service')).length > 0) {
```

---

## 🚀 运行打包

所有依赖准备完成后，运行：

```bash
cd D:/code/chainlesschain/desktop-app-vue
npm run make:win
```

打包完成后，安装包位置: `desktop-app-vue/out/make/squirrel.windows/x64/`

---

## 📊 预期包大小

- **依赖总大小**: ~260 MB
- **最终安装包**: ~350-400 MB (包含应用代码和依赖)

---

## 🔧 故障排除

### 问题1: 网络下载失败
- 使用国内镜像或VPN
- 使用迅雷/IDM等下载工具

### 问题2: Maven 构建失败
- 检查 Java 版本: `java -version` (需要 JDK 17)
- 清理缓存: `mvn clean`
- 使用国内Maven镜像 (aliyun)

### 问题3: 打包失败
- 检查所有目录是否正确创建
- 查看错误日志确定缺失的依赖
- 确保有足够的磁盘空间 (至少 2GB)

---

## 💡 使用 Docker 的替代方案

如果不需要打包成单个exe文件，可以使用 Docker Compose 运行后端服务：

```bash
cd D:/code/chainlesschain
docker-compose up -d
```

这将启动 PostgreSQL, Redis, Qdrant 和 Ollama，无需手动配置。

---

**祝打包顺利! 如有问题，请查看项目 README.md 或提交 Issue。**
