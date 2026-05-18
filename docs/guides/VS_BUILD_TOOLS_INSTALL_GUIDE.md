# Visual Studio Build Tools 安装指南

## 为什么需要安装

在 Windows 上开发 Node.js 项目时，某些原生模块（如 `lzma-native`, `koffi`, `sharp` 等）需要使用 C++ 编译器进行编译。Visual Studio Build Tools 提供了这些必需的编译工具。

## 错误症状

如果你看到以下错误，说明需要安装 VS Build Tools：

```
gyp ERR! find VS could not use PowerShell to find Visual Studio 2017 or newer
gyp ERR! find VS You need to install the latest version of Visual Studio
gyp ERR! find VS including the "Desktop development with C++" workload
```

## 安装方法

### 方法 1: 使用自动化脚本（推荐）

我已经为你创建了两个自动化安装脚本：

#### 选项 A: PowerShell 脚本（功能更完整）

1. **右键点击** `install-vs-buildtools.ps1`
2. 选择 **"以管理员身份运行 PowerShell"**
3. 如果提示执行策略错误，运行：
   ```powershell
   Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
   ```
4. 按照提示完成安装

#### 选项 B: 批处理脚本（更简单）

1. **右键点击** `install-vs-buildtools.bat`
2. 选择 **"以管理员身份运行"**
3. 等待自动下载和安装完成

### 方法 2: 手动安装

1. **下载安装程序**

   访问: https://aka.ms/vs/17/release/vs_BuildTools.exe

   或直接下载: [Visual Studio Build Tools 2022](https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022)

2. **运行安装程序**

   双击 `vs_BuildTools.exe`

3. **选择工作负载**

   在安装界面中，勾选：
   - ✅ **Desktop development with C++** (桌面开发 C++)

   这会自动包含：
   - MSVC v143 - VS 2022 C++ x64/x86 编译器
   - Windows 11 SDK
   - CMake tools
   - C++ ATL

4. **开始安装**

   点击 "Install" 按钮，等待 15-30 分钟

5. **重启电脑**（推荐）

### 方法 3: 使用 Chocolatey（如果已安装）

```powershell
# 以管理员身份运行
choco install visualstudio2022buildtools --package-parameters "--add Microsoft.VisualStudio.Workload.VCTools"
```

### 方法 4: 使用 windows-build-tools（已废弃，不推荐）

```bash
# 不推荐：此包已废弃
npm install --global windows-build-tools
```

## 安装完成后

### 1. 验证安装

打开**新的**命令提示符窗口（管理员）：

```bash
# 检查 node-gyp 能否找到 Visual Studio
node-gyp configure
```

如果成功，应该看到类似输出：
```
gyp info it worked if it ends with ok
gyp info using node-gyp@x.x.x
gyp info using node@x.x.x | win32 | x64
gyp info find Python using Python version x.x.x found at "..."
gyp info find VS using VS2022 (17.x.x) found at "..."
gyp info ok
```

### 2. 重新安装项目依赖

```bash
cd E:\code\chainlesschain\desktop-app-vue
npm install
```

### 3. 启动开发服务器

```bash
npm run dev
```

## 安装规格

| 项目 | 详情 |
|------|------|
| **软件名称** | Visual Studio Build Tools 2022 |
| **版本** | 17.x (最新版) |
| **所需组件** | Desktop development with C++ |
| **磁盘空间** | ~10 GB |
| **安装时间** | 15-30 分钟 |
| **需要重启** | 是（推荐） |

## 常见问题

### Q1: 安装失败或卡住怎么办？

**解决方案**:
1. 关闭所有 Visual Studio 相关进程
2. 清理临时文件：`%TEMP%\vs_buildtools`
3. 重新运行安装脚本
4. 如果仍然失败，尝试手动安装

### Q2: 我已经安装了 Visual Studio，还需要安装吗？

**答案**:
- 如果你已经安装了 **Visual Studio 2017/2019/2022**（完整版），并且包含了 "Desktop development with C++" 工作负载，**不需要**再安装 Build Tools
- 如果只安装了 VS Code，**需要**安装 Build Tools

验证方法：
```bash
node-gyp configure
```

### Q3: 安装完成后仍然报错？

**检查清单**:
1. ✅ 是否重启了电脑
2. ✅ 是否打开了**新的**命令提示符窗口
3. ✅ 是否包含了 "Desktop development with C++" 工作负载
4. ✅ Node.js 版本是否兼容（建议 v18 或 v20）

**重新配置**:
```bash
# 清理 npm 缓存
npm cache clean --force

# 删除 node_modules
rm -rf node_modules

# 重新安装
npm install
```

### Q4: 可以跳过这些原生模块吗？

**答案**:
部分可以。某些原生模块是可选的：
- `lzma-native`: 用于压缩，可选
- `sharp`: 用于图片处理，核心功能
- `koffi`: 用于 U-Key 集成，Windows 核心功能

**临时跳过方法**:
```bash
npm install --ignore-scripts
```

**注意**: 这会导致部分功能不可用。

### Q5: 安装占用空间太大，有轻量级替代方案吗？

**答案**:
不推荐，但如果只是测试：
1. 使用 WSL2 + Linux 版本（不需要 VS Build Tools）
2. 使用 Docker 容器开发
3. 移除需要编译的依赖（会失去部分功能）

## 卸载方法

如果需要卸载 Visual Studio Build Tools：

1. 打开 "控制面板" → "程序和功能"
2. 找到 "Visual Studio Build Tools 2022"
3. 右键 → "卸载"

或使用命令行：
```powershell
# 下载卸载程序
$uninstaller = "$env:ProgramFiles\Microsoft Visual Studio\2022\BuildTools\vs_installer.exe"

# 执行卸载
& $uninstaller uninstall --installPath "$env:ProgramFiles\Microsoft Visual Studio\2022\BuildTools"
```

## 相关资源

- [Visual Studio Build Tools 官方文档](https://docs.microsoft.com/en-us/visualstudio/install/build-tools-container)
- [node-gyp 官方文档](https://github.com/nodejs/node-gyp#on-windows)
- [Windows 构建工具要求](https://github.com/nodejs/node-gyp#on-windows)

## 支持

如果遇到安装问题：

1. 查看详细日志：`%TEMP%\dd_vs_buildtools_*.log`
2. 在 GitHub 提交 Issue
3. 联系开发团队

---

**最后更新**: 2026-01-26
**维护者**: ChainlessChain Team
