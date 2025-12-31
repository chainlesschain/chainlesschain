# ChainlessChain Windows 打包 - 快速开始

## 🚀 3 步完成打包

### 步骤 1: 下载组件 (10-20分钟)

下载以下 4 个组件并解压到指定目录：

| 组件 | 下载链接 | 解压路径 | 验证文件 |
|------|---------|----------|---------|
| PostgreSQL 16 | [点击下载](https://www.enterprisedb.com/download-postgresql-binaries) | `packaging/postgres/` | `postgres/bin/postgres.exe` |
| Redis | [点击下载](https://github.com/tporadowski/redis/releases) | `packaging/redis/` | `redis/redis-server.exe` |
| Qdrant | [点击下载](https://github.com/qdrant/qdrant/releases) | `packaging/qdrant/` | `qdrant/qdrant.exe` |
| JRE 17 | [点击下载](https://adoptium.net/temurin/releases/?version=17) | `packaging/jre-17/` | `jre-17/bin/java.exe` |

> 💡 **提示**: 选择 Windows x64 .zip 版本

### 步骤 2: 构建 Java 后端 (5-10分钟)

#### 选项 A: 安装 Maven (推荐)
```batch
# 1. 下载 Maven: https://maven.apache.org/download.cgi
# 2. 解压并添加到 PATH
# 3. 构建
cd backend\project-service
mvn clean package -DskipTests
```

#### 选项 B: 跳过（构建脚本会提示）
如果没有 Maven，构建脚本会检测并给出提示

### 步骤 3: 运行构建 (15-30分钟)

```batch
cd C:\code\chainlesschain
build-windows-package.bat
```

**输出**: `packaging\dist\ChainlessChain-Setup-0.16.0.exe` (~1GB)

---

## ✅ 检查清单

运行构建前，确认：

```batch
# 运行验证脚本
cd packaging\scripts
check-components.bat
```

或手动检查：
- [ ] `packaging\postgres\bin\postgres.exe` 存在
- [ ] `packaging\redis\redis-server.exe` 存在
- [ ] `packaging\qdrant\qdrant.exe` 存在
- [ ] `packaging\jre-17\bin\java.exe` 存在
- [ ] `backend\project-service\target\project-service.jar` 存在 (或已安装 Maven)

---

## 📚 详细文档

- **完整总结**: `WINDOWS_PACKAGE_SUMMARY.md`
- **当前状态**: `packaging/CURRENT_STATUS.md`
- **构建说明**: `packaging/BUILD_INSTRUCTIONS.md`
- **设计文档**: `packaging/WINDOWS_PACKAGE_DESIGN.md`

---

## 🆘 遇到问题？

### 常见问题速查

**Maven 不可用**:
- 构建脚本会检测并给出替代方案
- 或从 https://maven.apache.org/download.cgi 下载

**组件下载慢**:
- 使用国内镜像或下载工具
- 或联系项目组获取网盘链接

**构建失败**:
1. 查看日志: `packaging\build.log`
2. 检查 Node.js 版本: `node --version` (需要 v18+)
3. 重新安装依赖: `cd desktop-app-vue && npm install`

---

**开始构建吧！** 🎉

需要帮助？查看 `packaging/BUILD_INSTRUCTIONS.md` 的故障排除部分。
