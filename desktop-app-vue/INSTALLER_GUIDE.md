# ChainlessChain Windows 安装程序构建指南

本指南说明如何为 ChainlessChain 桌面应用创建 Windows 安装程序。

## 目录

- [准备工作](#准备工作)
- [快速开始](#快速开始)
- [详细步骤](#详细步骤)
- [自定义配置](#自定义配置)
- [常见问题](#常见问题)

## 准备工作

### 1. 安装 Inno Setup

**下载安装：**

1. 访问 [Inno Setup 官网](https://jrsoftware.org/isdl.php)
2. 下载最新版本（推荐 6.x）
3. 运行安装程序，使用默认设置即可

**添加到 PATH（可选但推荐）：**

安装完成后，将 Inno Setup 添加到系统 PATH：

1. 打开"系统属性" → "高级" → "环境变量"
2. 在"系统变量"中找到 `Path`
3. 添加 Inno Setup 安装目录（通常是 `C:\Program Files (x86)\Inno Setup 6`）

### 2. 确保应用已打包

在构建安装程序前，必须先打包应用：

```bash
cd desktop-app-vue
npm run package
```

这会在 `out/ChainlessChain-win32-x64/` 目录下创建打包后的应用。

## 快速开始

### 方法 1：使用批处理脚本（推荐）

```bash
cd desktop-app-vue
build-installer.bat
```

### 方法 2：直接使用 Inno Setup 编译器

```bash
cd desktop-app-vue
iscc installer.iss
```

### 方法 3：使用 Inno Setup GUI

1. 打开 Inno Setup Compiler
2. 文件 → 打开 → 选择 `desktop-app-vue/installer.iss`
3. 构建 → 编译

## 详细步骤

### 步骤 1：准备应用文件

```bash
# 1. 安装依赖
npm install

# 2. 构建应用
npm run build

# 3. 打包应用
npm run package
```

### 步骤 2：检查打包结果

确认以下文件存在：
- `out/ChainlessChain-win32-x64/chainlesschain.exe`
- `out/ChainlessChain-win32-x64/resources/`
- 其他运行时文件

### 步骤 3：构建安装程序

运行构建脚本：

```bash
build-installer.bat
```

或手动编译：

```bash
iscc installer.iss
```

### 步骤 4：测试安装程序

构建完成后，安装程序位于：
```
out/installer/ChainlessChain-Setup-0.1.0.exe
```

**测试安装：**

1. 双击运行安装程序
2. 按照向导完成安装
3. 启动应用验证功能
4. 测试卸载程序

## 自定义配置

### 修改安装程序信息

编辑 `installer.iss` 文件顶部的定义：

```pascal
#define MyAppName "ChainlessChain"
#define MyAppVersion "0.1.0"
#define MyAppPublisher "ChainlessChain Team"
#define MyAppURL "https://github.com/chainlesschain/chainlesschain"
```

### 更改安装目录

修改 `DefaultDirName` 配置：

```pascal
DefaultDirName={autopf}\{#MyAppName}
; 或指定自定义路径：
; DefaultDirName=C:\ChainlessChain
```

### 添加许可协议

确保 `LICENSE` 文件存在于项目根目录：

```pascal
LicenseFile=LICENSE
```

### 添加自述文件

在安装前显示 README：

```pascal
InfoBeforeFile=README.md
```

### 自定义图标

确保图标文件存在：

```pascal
SetupIconFile=build\icon.ico
```

支持的格式：`.ico` 文件，推荐尺寸：256x256

## 安装程序特性

### 当前包含的功能

✅ **基本安装**
- 自动检测系统架构（64位）
- 检查 Windows 版本（最低 Windows 10 1809）
- 管理员权限安装

✅ **用户界面**
- 现代化安装向导
- 中文和英文支持
- 许可协议显示
- 自定义安装路径

✅ **快捷方式**
- 开始菜单快捷方式
- 桌面快捷方式（可选）
- 快速启动图标（可选）

✅ **注册表集成**
- 添加到 Windows App Paths
- 卸载程序注册

✅ **数据管理**
- 自动创建用户数据目录
- 卸载时询问是否保留数据

✅ **压缩优化**
- LZMA2 最大压缩
- 固实压缩

### 安装程序行为

**安装时：**
1. 检查系统要求
2. 显示许可协议
3. 选择安装路径
4. 复制应用文件
5. 创建快捷方式
6. 创建用户数据目录
7. 注册应用程序
8. 可选：立即启动应用

**卸载时：**
1. 询问是否保留用户数据
2. 删除应用程序文件
3. 删除快捷方式
4. 清理注册表
5. （可选）删除用户数据

## 高级选项

### 静默安装

```bash
ChainlessChain-Setup-0.1.0.exe /VERYSILENT /NORESTART
```

常用参数：
- `/SILENT` - 静默安装（显示进度）
- `/VERYSILENT` - 完全静默
- `/NORESTART` - 安装后不重启
- `/DIR="C:\Custom\Path"` - 指定安装目录
- `/GROUP="My Program Group"` - 指定开始菜单文件夹
- `/NOICONS` - 不创建开始菜单文件夹

### 静默卸载

```bash
"%ProgramFiles%\ChainlessChain\unins000.exe" /VERYSILENT
```

### 命令行构建

集成到 CI/CD 流程：

```bash
# 完整构建流程
npm run build && npm run package && iscc installer.iss
```

## 文件结构

```
desktop-app-vue/
├── installer.iss              # Inno Setup 脚本
├── build-installer.bat        # 构建脚本（Windows）
├── build/
│   └── icon.ico              # 安装程序图标
├── out/
│   ├── ChainlessChain-win32-x64/  # 打包的应用（由 electron-forge 生成）
│   └── installer/                  # 安装程序输出目录
│       └── ChainlessChain-Setup-0.1.0.exe
├── LICENSE                    # 许可协议
└── README.md                  # 项目说明
```

## 常见问题

### Q1: 提示 "iscc.exe not found"

**A:** Inno Setup 未安装或未添加到 PATH

解决方法：
1. 确认已安装 Inno Setup
2. 将 Inno Setup 目录添加到 PATH
3. 或使用完整路径：`"C:\Program Files (x86)\Inno Setup 6\iscc.exe" installer.iss`

### Q2: 编译时提示找不到文件

**A:** 打包的应用不存在

解决方法：
```bash
npm run package
```

确保 `out/ChainlessChain-win32-x64/` 目录存在且包含应用文件。

### Q3: 安装程序大小过大

**A:** 当前配置使用固实压缩，已经是较优方案

可选优化：
1. 排除不必要的文件（编辑 `installer.iss` 的 `[Files]` 部分）
2. 使用外部压缩器（7-Zip）

### Q4: 安装时需要管理员权限

**A:** 这是默认配置，因为要安装到 `Program Files`

如果不需要管理员权限，修改：
```pascal
PrivilegesRequired=lowest
DefaultDirName={userpf}\{#MyAppName}
```

### Q5: 如何更改应用程序 ID

**A:** 修改 `installer.iss` 中的 `AppId`：

```pascal
#define MyAppId "{{YOUR-UNIQUE-GUID}}"
```

生成新 GUID：在线工具或 PowerShell：
```powershell
[guid]::NewGuid()
```

### Q6: 卸载后数据仍然存在

**A:** 这是设计行为，卸载时会询问用户

如果要强制删除所有数据，修改 `InitializeUninstall` 函数。

### Q7: 如何添加文件关联

**A:** 取消注释 `installer.iss` 中的 `[Registry]` 部分：

```pascal
Root: HKCR; Subkey: ".chain"; ValueType: string; ValueName: ""; ValueData: "ChainlessChainFile"; Flags: uninsdeletevalue
```

## 三种安装程序工具对比

| 特性 | Inno Setup | NSIS | Advanced Installer |
|------|-----------|------|-------------------|
| 许可 | 免费开源 | 免费开源 | 免费版/商业版 |
| 易用性 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| 脚本语言 | Pascal | NSIS Script | GUI + XML |
| 文档 | 优秀 | 一般 | 优秀 |
| 社区支持 | 活跃 | 活跃 | 商业支持 |
| 学习曲线 | 低 | 中 | 低 |
| 现代界面 | ✅ | ✅ | ✅ |
| 文件大小 | 小 | 极小 | 中等 |
| 推荐度 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ |

**我们选择 Inno Setup 的原因：**
- 完全免费且开源
- 脚本简单易懂（类 Pascal 语法）
- 功能强大，满足所有需求
- 优秀的文档和社区支持
- 现代化的用户界面
- 轻量级，编译速度快

## 发布清单

在发布安装程序前，请检查：

- [ ] 版本号正确（`installer.iss` 中的 `MyAppVersion`）
- [ ] 应用程序已完整打包
- [ ] 图标文件存在且正确
- [ ] LICENSE 文件存在
- [ ] README.md 文件存在且最新
- [ ] 在干净的虚拟机或测试机器上测试安装
- [ ] 测试卸载功能
- [ ] 测试应用程序启动
- [ ] 测试所有快捷方式
- [ ] 检查数据目录创建
- [ ] 测试静默安装
- [ ] 数字签名（如果需要）

## 数字签名（可选）

为安装程序添加数字签名可以提升用户信任度：

1. 获取代码签名证书
2. 在 `installer.iss` 中添加：

```pascal
[Setup]
SignTool=signtool
SignedUninstaller=yes
```

3. 配置 signtool（在 Inno Setup 选项中）

## 下一步

安装程序创建完成后，您可以：

1. **测试安装程序** - 在干净的环境中测试
2. **创建更新机制** - 使用 Squirrel.Windows 或 electron-updater
3. **发布到 GitHub Releases** - 附带安装程序
4. **创建便携版** - 无需安装即可运行的版本

## 支持与反馈

如遇到问题，请：

1. 检查本文档的"常见问题"部分
2. 查阅 [Inno Setup 文档](https://jrsoftware.org/ishelp/)
3. 在项目 GitHub 提交 Issue

---

**提示：** 第一次构建安装程序可能需要一些时间（取决于应用大小）。后续构建会更快，因为只有更改的文件会被重新压缩。
