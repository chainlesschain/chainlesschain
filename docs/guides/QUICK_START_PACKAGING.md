# ChainlessChain Windows 打包 - 快速开始

## 💻 选择你的环境

### 方式 A: Windows CMD/PowerShell（推荐新手）
使用 `.bat` 批处理脚本

### 方式 B: Git Bash/WSL（推荐熟悉Unix的用户）
使用 `.sh` Shell脚本

> 💡 **提示**: 两种方式功能完全相同，选择你喜欢的即可！

---

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

#### 方式 A: Windows CMD/PowerShell
```batch
cd C:\code\chainlesschain
build-windows-package.bat
```

#### 方式 B: Git Bash/WSL
```bash
cd /c/code/chainlesschain        # Git Bash
# 或
cd /mnt/c/code/chainlesschain    # WSL

./build-windows-package.sh
```

**输出**: `packaging\dist\ChainlessChain-Setup-0.16.0.exe` (~1GB)

---

## ✅ 检查清单

运行构建前，确认：

#### Windows CMD/PowerShell
```batch
# 运行验证脚本
cd packaging\scripts
check-components.bat
```

#### Git Bash/WSL
```bash
# 运行验证脚本
cd packaging/scripts
./check-components.sh
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
- **当前状态**: `packaging/docs/CURRENT_STATUS.md`
- **构建说明**: `packaging/docs/BUILD_INSTRUCTIONS.md`
- **设计文档**: `packaging/docs/WINDOWS_PACKAGE_DESIGN.md`
- **Shell脚本指南**: `packaging/docs/SHELL_SCRIPTS_GUIDE.md` ⭐ 新增

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

需要帮助？查看 `packaging/docs/BUILD_INSTRUCTIONS.md` 的故障排除部分。

## 附录：规范章节补全（v5.0.3.108）

> 为对齐项目用户文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文细节。

### 1. 概述
见正文头部。Windows 打包快速开始：桌面应用打包。

### 2. 核心特性
Windows 打包 / electron-builder / 快速开始。

### 3. 系统架构
见正文 / [系统架构](../design/系统设计_主文档.md)（三端 + 双后端 + P2P）。

### 4. 系统定位
ChainlessChain 的「Windows 打包快速开始」。

### 5. 核心功能
见正文各节。

### 6. 技术架构
见正文技术 / 环境章节。

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
见正文验证 / 测试步骤（如有）。

### 13. 安全考虑
见正文安全 / 密钥章节（如适用）。

### 14. 故障排除
见正文故障排查 / 常见问题章节。

### 15. 关键文件
见正文涉及的文件 / 目录 / 脚本。

### 16. 使用示例
见正文命令 / 操作示例。

### 17. 相关文档
[用户指南索引](./README.md)、[快速开始](../quick-start/QUICK_START.md)、其它用户文档。
