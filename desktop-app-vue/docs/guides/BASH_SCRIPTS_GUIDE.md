# Bash 脚本使用指南

由于 Windows 批处理脚本（.bat）可能存在兼容性问题，我们提供了 Bash 脚本版本（.sh）。

## 环境要求

### Windows 用户

您需要以下任一 Bash 环境：

1. **Git Bash**（推荐）
   - 下载：https://git-scm.com/download/win
   - 安装后右键点击文件夹选择"Git Bash Here"

2. **WSL (Windows Subsystem for Linux)**
   - 运行：`wsl --install`
   - 使用 Ubuntu 或其他 Linux 发行版

3. **Cygwin**
   - 下载：https://www.cygwin.com/

### Linux/macOS 用户

直接使用系统自带的 Bash 终端。

## 可用的 Bash 脚本

| 脚本 | 功能 | 位置 |
|------|------|------|
| `build-windows-package-standalone.sh` | 无 Docker 版本打包 | `desktop-app-vue/` |
| `build-standalone.sh` | 后端服务编译 | `backend/` |

## 使用方法

### 1. 无 Docker 版本打包

```bash
# 进入目录
cd desktop-app-vue

# 赋予执行权限（首次需要）
chmod +x build-windows-package-standalone.sh

# 运行脚本
./build-windows-package-standalone.sh
```

**选择模式：**
- `[1]` 仅前端应用
- `[2]` 前端 + 便携后端
- `[3]` 云端后端配置

### 2. 后端服务编译

```bash
# 进入目录
cd backend

# 赋予执行权限（首次需要）
chmod +x build-standalone.sh

# 运行脚本
./build-standalone.sh
```

**选择编译方式：**
- `[1]` JAR + JRE（需要 Java 运行时）
- `[2]` GraalVM Native Image（完全独立）
- `[3]` jpackage（推荐）

## 完整示例

### 示例 1: 仅前端应用（最简单）

```bash
cd C:/code/chainlesschain/desktop-app-vue
chmod +x build-windows-package-standalone.sh
./build-windows-package-standalone.sh
# 输入: 1
```

**输出：** `ChainlessChain-Standalone-Setup-*.exe` (~50MB)

### 示例 2: 完整独立版（含后端）

```bash
# 第一步：编译后端
cd C:/code/chainlesschain/backend
chmod +x build-standalone.sh
./build-standalone.sh
# 输入: 3  (jpackage)

# 第二步：打包前端 + 后端
cd ../desktop-app-vue
chmod +x build-windows-package-standalone.sh
./build-windows-package-standalone.sh
# 输入: 2
```

**输出：** `ChainlessChain-Standalone-Setup-*.exe` (~200MB)

### 示例 3: 云端后端配置

```bash
cd C:/code/chainlesschain/desktop-app-vue
chmod +x build-windows-package-standalone.sh
./build-windows-package-standalone.sh
# 输入: 3
```

**输出：** `ChainlessChain-Standalone-Setup-*.exe` (~50MB)

## 常见问题

### Q1: 脚本无法执行，提示 "Permission denied"

**A:** 需要赋予执行权限：

```bash
chmod +x *.sh
```

### Q2: 脚本运行报错 "命令not found"

**A:** 确保在 Git Bash 或 WSL 中运行，不是 Windows CMD 或 PowerShell。

### Q3: 路径问题（Windows 路径格式）

**A:** Git Bash 中使用 Unix 风格路径：

```bash
# 正确
cd /c/code/chainlesschain

# 错误
cd C:\code\chainlesschain
```

### Q4: npm 命令找不到

**A:** 确保 Node.js 已安装并添加到 PATH：

```bash
# 检查 Node.js
which node
node --version

# 检查 npm
which npm
npm --version
```

### Q5: Maven 命令找不到

**A:** 确保 Maven 已安装（仅编译后端时需要）：

```bash
# 检查 Maven
which mvn
mvn --version
```

## 如果 Bash 脚本仍然有问题

### 替代方案 1: 逐步手动执行

```bash
# 1. 安装依赖
npm install

# 2. 构建前端
npm run build:renderer
npm run build:main
npm run package

# 3. 生成安装包（需要 Inno Setup）
"/c/Program Files (x86)/Inno Setup 6/iscc.exe" installer-standalone.iss
```

### 替代方案 2: 使用 PowerShell 版本

如果您更熟悉 PowerShell，我们可以提供 PowerShell 版本的脚本。

### 替代方案 3: 使用 npm 脚本

直接使用 package.json 中定义的脚本：

```bash
npm run build        # 构建应用
npm run package      # 打包应用
```

## 调试技巧

### 启用详细输出

在脚本开头添加：

```bash
set -x  # 显示每条命令
set -v  # 显示命令源码
```

### 检查脚本语法

```bash
bash -n build-windows-package-standalone.sh
```

### 逐步运行

复制脚本中的命令，逐条在终端中执行。

## 性能提示

- **Git Bash** 性能较好，推荐使用
- **WSL** 功能最强大但启动稍慢
- **Cygwin** 兼容性最好但体积较大

## 脚本对比

| 特性 | .bat 脚本 | .sh 脚本 |
|------|----------|----------|
| **兼容性** | 仅 Windows | 跨平台 |
| **语法** | 批处理 | Bash |
| **错误处理** | 有限 | 更强大 |
| **调试** | 困难 | 容易 |
| **运行环境** | CMD | Bash |

## 获取帮助

如果遇到问题：

1. 查看本文档的"常见问题"部分
2. 检查脚本输出的错误信息
3. 在 GitHub 提交 Issue 并附上：
   - 操作系统版本
   - Bash 环境（Git Bash/WSL/等）
   - 完整的错误信息
   - 脚本运行输出

## 相关文档

- [STANDALONE_PACKAGE_GUIDE.md](STANDALONE_PACKAGE_GUIDE.md) - 独立版打包详细指南
- [PACKAGING_COMPARISON.md](PACKAGING_COMPARISON.md) - 所有打包方案对比
- [BUILD_PACKAGE_GUIDE.md](BUILD_PACKAGE_GUIDE.md) - Docker 版打包指南
