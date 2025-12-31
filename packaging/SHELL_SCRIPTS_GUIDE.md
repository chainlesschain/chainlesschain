# ChainlessChain Shell 脚本使用指南

## 📋 概述

除了 Windows 批处理脚本（.bat），我们还提供了完整的 Shell 脚本（.sh）版本，可以在以下环境中使用：

- **Git Bash** (推荐) - Windows 上最常用的 Bash 环境
- **WSL** (Windows Subsystem for Linux) - 完整的 Linux 环境
- **Cygwin** - Unix-like 环境
- **MSYS2** - 另一个流行的 Unix 环境

---

## 🚀 快速开始

### 使用 Git Bash（推荐）

```bash
# 1. 打开 Git Bash
# 2. 进入项目目录
cd /c/code/chainlesschain

# 3. 运行构建脚本
./build-windows-package.sh
```

### 使用 WSL

```bash
# 1. 打开 WSL 终端
# 2. 进入项目目录（注意 Windows 路径映射）
cd /mnt/c/code/chainlesschain

# 3. 运行构建脚本
./build-windows-package.sh
```

---

## 📁 可用脚本

### 主构建脚本

| 脚本 | Batch 版本 | Shell 版本 | 说明 |
|------|-----------|-----------|------|
| 主构建 | `build-windows-package.bat` | `build-windows-package.sh` | 完整的构建流程 |
| 下载组件 | `packaging/download-components.bat` | `packaging/download-components.sh` | 下载第三方组件 |

### 服务管理脚本

| 脚本 | Batch 版本 | Shell 版本 | 说明 |
|------|-----------|-----------|------|
| 启动服务 | `packaging/scripts/start-backend-services.bat` | `packaging/scripts/start-backend-services.sh` | 启动所有后端服务 |
| 停止服务 | `packaging/scripts/stop-backend-services.bat` | `packaging/scripts/stop-backend-services.sh` | 停止所有后端服务 |
| 检查服务 | `packaging/scripts/check-services.bat` | `packaging/scripts/check-services.sh` | 检查服务状态 |

### 组件验证脚本

| 脚本 | Batch 版本 | Shell 版本 | 说明 |
|------|-----------|-----------|------|
| 检查组件 | `packaging/scripts/check-components.bat` | `packaging/scripts/check-components.sh` | 验证构建组件 |

---

## 🔧 详细使用说明

### 1. 主构建脚本

#### 使用方法

```bash
cd /c/code/chainlesschain
./build-windows-package.sh
```

#### 功能

1. 检查必需工具（Node.js, npm, Maven, Java）
2. 构建 Java 后端服务
3. 准备第三方组件（自动下载 Redis, Qdrant）
4. 创建配置文件
5. 构建 Electron 应用
6. 打包 Electron 应用
7. 创建 Windows 安装程序
8. 整理输出文件

#### 输出

- 构建日志: `packaging/build.log`
- 安装包: `packaging/dist/ChainlessChain-Setup-*.exe`

---

### 2. 下载组件脚本

#### 使用方法

```bash
cd /c/code/chainlesschain/packaging
./download-components.sh
```

#### 功能

- 自动下载 Redis for Windows
- 自动下载 Qdrant
- 提示手动下载 PostgreSQL
- 提示手动下载 JRE 17
- 验证所有组件状态

---

### 3. 服务管理脚本

#### 启动服务

```bash
cd /c/code/chainlesschain/packaging/scripts
./start-backend-services.sh
```

启动顺序：
1. PostgreSQL (端口 5432)
2. Redis (端口 6379)
3. Qdrant (端口 6333)
4. Project Service (端口 9090)

#### 停止服务

```bash
./stop-backend-services.sh
```

停止顺序（反向）：
1. Project Service
2. Qdrant
3. Redis
4. PostgreSQL

#### 检查服务状态

```bash
./check-services.sh
```

显示：
- 各服务运行状态
- 端口占用情况
- 彩色输出（运行=绿色，停止=红色）

---

### 4. 组件验证脚本

#### 使用方法

```bash
cd /c/code/chainlesschain/packaging/scripts
./check-components.sh
```

#### 检查内容

- [x] PostgreSQL 二进制文件
- [x] Redis 二进制文件
- [x] Qdrant 二进制文件
- [x] JRE 17
- [x] Java 后端 JAR 文件
- [x] Node.js 和 npm

---

## 🎨 脚本特性

### 彩色输出

所有脚本都使用 ANSI 颜色代码：
- 🟢 **绿色** - 成功/已完成
- 🔴 **红色** - 错误/缺失
- 🟡 **黄色** - 警告/待处理
- 🔵 **青色** - 信息/标题

### 错误处理

- 使用 `set -e` 自动在错误时退出
- 详细的错误信息输出
- 日志文件记录

### 兼容性

- 支持 Git Bash
- 支持 WSL
- 支持 Cygwin
- 支持 MSYS2

---

## 💡 使用技巧

### Git Bash vs Batch

#### 何时使用 Git Bash (Shell 脚本)

✅ 你习惯使用 Unix/Linux 命令
✅ 需要跨平台脚本（未来可能支持 macOS/Linux）
✅ 需要更好的脚本调试功能
✅ 喜欢彩色终端输出

#### 何时使用 CMD/PowerShell (Batch 脚本)

✅ 纯 Windows 环境
✅ 不想安装额外工具
✅ 需要与 Windows 系统深度集成
✅ 团队成员不熟悉 Bash

### 路径转换

在 Git Bash 中使用 Windows 路径：

```bash
# Windows 路径
C:\code\chainlesschain

# Git Bash 路径
/c/code/chainlesschain

# WSL 路径
/mnt/c/code/chainlesschain
```

### 调试脚本

启用调试模式：

```bash
# 方法 1: 使用 bash -x
bash -x build-windows-package.sh

# 方法 2: 在脚本开头添加
set -x  # 显示每个命令
set -v  # 显示原始命令
```

---

## 🐛 常见问题

### Q1: 脚本提示 "Permission denied"

**A**: 添加执行权限

```bash
chmod +x build-windows-package.sh
chmod +x packaging/scripts/*.sh
```

### Q2: 找不到命令（command not found）

**A**: 确保路径正确

```bash
# 检查当前目录
pwd

# 使用绝对路径
/c/code/chainlesschain/build-windows-package.sh

# 或相对路径
./build-windows-package.sh
```

### Q3: Windows 换行符问题（\r\n vs \n）

**A**: 转换换行符

```bash
# 使用 dos2unix (如果已安装)
dos2unix build-windows-package.sh

# 或使用 sed
sed -i 's/\r$//' build-windows-package.sh
```

### Q4: Maven/Java 找不到

**A**: 确保 PATH 配置正确

```bash
# 检查 Maven
which mvn

# 检查 Java
which java

# 查看 PATH
echo $PATH
```

### Q5: curl 下载失败

**A**: 检查网络或使用代理

```bash
# 使用代理
export http_proxy=http://proxy:port
export https_proxy=http://proxy:port

# 或手动下载后放到指定目录
```

---

## 📊 对比表

### Batch vs Shell 脚本功能对比

| 功能 | Batch (.bat) | Shell (.sh) | 说明 |
|------|--------------|------------|------|
| 平台支持 | Windows 原生 | Git Bash/WSL | Shell 可跨平台 |
| 彩色输出 | 有限支持 | 完全支持 | Shell 更美观 |
| 错误处理 | 手动检查 | `set -e` 自动 | Shell 更可靠 |
| 脚本调试 | 困难 | `set -x` 简单 | Shell 更易调试 |
| 函数支持 | 有限 | 完全支持 | Shell 更灵活 |
| 变量操作 | 复杂 | 简单 | Shell 更易用 |
| 文件操作 | cmd 命令 | Unix 工具 | Shell 更强大 |
| 学习曲线 | Windows 用户友好 | Unix 用户友好 | 看个人背景 |

---

## 🔄 脚本转换

如果需要在 Batch 和 Shell 之间切换：

### Batch → Shell

```bash
# Batch
cd backend\project-service
mvn clean package

# Shell (Git Bash)
cd backend/project-service
mvn clean package
```

### Shell → Batch

```batch
REM Shell
cd backend/project-service
mvn clean package

REM Batch
cd backend\project-service
mvn clean package
```

主要区别：
- 路径分隔符: `\` vs `/`
- 注释: `REM` vs `#`
- 变量: `%VAR%` vs `$VAR`

---

## 📝 脚本清单

所有可用的 Shell 脚本：

```bash
chainlesschain/
├── build-windows-package.sh              # 主构建脚本 ✅
└── packaging/
    ├── download-components.sh            # 组件下载脚本 ✅
    └── scripts/
        ├── start-backend-services.sh     # 启动服务 ✅
        ├── stop-backend-services.sh      # 停止服务 ✅
        ├── check-services.sh             # 检查服务 ✅
        └── check-components.sh           # 验证组件 ✅
```

---

## 🎯 推荐工作流

### Git Bash 用户

```bash
# 1. 检查组件
cd /c/code/chainlesschain/packaging/scripts
./check-components.sh

# 2. 如有缺失，下载组件
cd ..
./download-components.sh

# 3. 再次检查
cd scripts
./check-components.sh

# 4. 运行构建
cd ../..
./build-windows-package.sh

# 5. 测试服务（可选）
cd packaging/scripts
./start-backend-services.sh
./check-services.sh
./stop-backend-services.sh
```

### WSL 用户

```bash
# 1. 进入 Windows 目录
cd /mnt/c/code/chainlesschain

# 2. 运行检查
./packaging/scripts/check-components.sh

# 3. 构建
./build-windows-package.sh
```

---

## 📞 需要帮助？

- **Batch 脚本问题**: 查看 `BUILD_INSTRUCTIONS.md`
- **Shell 脚本问题**: 查看本文档
- **通用问题**: 查看 `CURRENT_STATUS.md`

---

## ✨ 总结

### Shell 脚本优势

✅ 更现代的脚本语法
✅ 更好的错误处理
✅ 彩色输出更友好
✅ 可能的跨平台支持
✅ 丰富的 Unix 工具集

### 何时选择 Shell 脚本

- 你熟悉 Unix/Linux
- 已经安装 Git Bash
- 需要脚本调试功能
- 喜欢终端彩色输出

### 何时选择 Batch 脚本

- 纯 Windows 环境
- 不想安装额外工具
- 团队使用 Windows 批处理

**两者功能完全相同，选择你喜欢的即可！** 🎉

---

**Happy Building!** 🚀
