# ChainlessChain iOS 快速开始指南

本指南帮助你快速设置和运行 ChainlessChain iOS 应用。

## 📋 目录

1. [前置要求](#前置要求)
2. [项目设置](#项目设置)
3. [运行应用](#运行应用)
4. [常见问题](#常见问题)
5. [下一步](#下一步)

---

## 前置要求

### 必需软件

- **macOS** 12.0 (Monterey) 或更高版本
- **Xcode** 14.0 或更高版本
- **iOS 模拟器** 或 **iOS 设备**（iOS 15.0+）

### 安装 Xcode

1. 从 App Store 下载并安装 Xcode
2. 打开 Xcode 并同意许可协议
3. 安装命令行工具：
   ```bash
   xcode-select --install
   sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
   ```

4. 验证安装：
   ```bash
   xcodebuild -version
   # 应该显示：Xcode 14.0 或更高版本
   ```

### 可选工具

- **Ruby** (用于自动化脚本)：
  ```bash
  sudo gem install xcodeproj
  ```

- **Python 3** (用于生成图标)：
  ```bash
  pip3 install Pillow
  ```

---

## 项目设置

### 方式一：使用 Xcode GUI（推荐新手）

#### 步骤 1：创建 Xcode 项目

1. 打开 Xcode
2. 选择 "Create a new Xcode project"
3. 选择模板：
   - 平台：**iOS**
   - 模板：**App**
4. 配置项目：
   - Product Name: `ChainlessChain`
   - Organization Identifier: `com.chainlesschain`
   - Interface: **SwiftUI**
   - Language: **Swift**
5. 保存到：`/Users/mac/Documents/code2/chainlesschain/ios-app/`

#### 步骤 2：整合现有代码

1. **删除默认文件**：
   - 删除 Xcode 生成的 `ChainlessChainApp.swift`
   - 删除 `ContentView.swift`
   - 删除 `Assets.xcassets`

2. **添加现有源代码**：
   - 右键项目 → "Add Files to ChainlessChain..."
   - 选择 `ChainlessChain` 文件夹
   - ✅ 勾选 "Copy items if needed"
   - ✅ 选择 "Create groups"

3. **配置 Info.plist**：
   - Target → Build Settings
   - 搜索 "Info.plist File"
   - 设置为：`ChainlessChain/Resources/Info.plist`

#### 步骤 3：添加 Swift Package 依赖

1. Project 设置 → Package Dependencies → "+"
2. 依次添加以下包：

```
https://github.com/signalapp/libsignal.git (>= 0.30.0)
https://github.com/sqlcipher/sqlcipher.git (>= 4.5.6)
https://github.com/stasel/WebRTC.git (>= 120.0.0)
https://github.com/daltoniam/Starscream.git (>= 4.0.0)
https://github.com/krzyzanowskim/CryptoSwift.git (>= 1.8.0)
https://github.com/Flight-School/AnyCodable.git (>= 0.6.0)
```

3. 添加本地模块包：
   - Package Dependencies → "Add Local..."
   - 依次添加 `Modules/` 下的 6 个模块

#### 步骤 4：配置构建设置

1. Target → Build Settings
2. 设置以下选项：
   ```
   Deployment Target: iOS 15.0
   Swift Language Version: Swift 5
   Enable Bitcode: No
   Other Linker Flags: -lsqlite3 -lc++
   ```

#### 步骤 5：配置 Capabilities

1. Target → Signing & Capabilities
2. 添加 Capabilities：
   - **Keychain Sharing**
   - **Background Modes**：
     - ✅ Audio, AirPlay, and Picture in Picture
     - ✅ Background fetch

#### 步骤 6：添加应用图标

**选项 A：使用在线工具**（推荐）

1. 设计 1024x1024 图标
2. 使用 [AppIconMaker](https://appiconmaker.co/) 生成所有尺寸
3. 将生成的图标拖入 `Assets.xcassets` → `AppIcon`

**选项 B：使用 Python 脚本**

```bash
cd /Users/mac/Documents/code2/chainlesschain/ios-app
pip3 install Pillow
python3 generate_app_icons.py
```

详见：`ChainlessChain/Resources/Assets.xcassets/README.md`

---

### 方式二：使用自动化脚本（推荐高级用户）

#### 前置要求

```bash
sudo gem install xcodeproj
```

#### 运行脚本

```bash
cd /Users/mac/Documents/code2/chainlesschain/ios-app
ruby create_xcode_project.rb
```

脚本会自动：
- 创建 `.xcodeproj` 文件
- 配置构建设置
- 添加源文件
- 配置 Scheme

**注意**：仍需手动添加 Swift Package 依赖。

---

## 运行应用

### 在模拟器中运行

1. 打开 Xcode 项目：
   ```bash
   open /Users/mac/Documents/code2/chainlesschain/ios-app/ChainlessChain.xcodeproj
   ```

2. 选择模拟器：
   - 顶部工具栏：选择 "iPhone 14 Pro" 或其他设备

3. 构建并运行：
   - 快捷键：`Cmd + R`
   - 或：Product → Run

4. 首次运行：
   - 应用会提示设置 PIN 码
   - 设置 6-8 位 PIN
   - 启用 Face ID/Touch ID（可选）

### 在真机上运行

1. **连接设备**：
   - 使用 USB 连接 iPhone/iPad
   - 在设备上信任此电脑

2. **配置签名**：
   - Target → Signing & Capabilities
   - Team：选择你的 Apple Developer 账号
   - 如果没有账号，可以使用免费的个人账号

3. **选择设备**：
   - 顶部工具栏：选择你的设备

4. **运行**：
   - `Cmd + R`

---

## 常见问题

### 1. 编译错误：找不到模块

**错误信息**：
```
No such module 'CoreCommon'
```

**解决方案**：
1. File → Packages → Resolve Package Versions
2. Product → Clean Build Folder (`Cmd + Shift + K`)
3. 重新构建

### 2. SQLCipher 链接错误

**错误信息**：
```
Undefined symbols for architecture arm64: "_sqlite3_..."
```

**解决方案**：
- Build Settings → Other Linker Flags
- 添加：`-lsqlite3`

### 3. WebRTC 编译失败

**错误信息**：
```
Bitcode is not supported
```

**解决方案**：
- Build Settings → Enable Bitcode
- 设置为：`No`

### 4. 模拟器白屏

**原因**：数据库初始化失败

**解决方案**：
1. 查看控制台日志（`Cmd + Shift + Y`）
2. 重置模拟器：Device → Erase All Content and Settings
3. 重新运行

### 5. 签名错误

**错误信息**：
```
Signing for "ChainlessChain" requires a development team
```

**解决方案**：
1. Target → Signing & Capabilities
2. 选择 Team（或使用个人免费账号）
3. 如果没有账号：Xcode → Preferences → Accounts → "+"

---

## 项目结构

```
ios-app/
├── ChainlessChain.xcodeproj/       # Xcode 项目文件
├── ChainlessChain/                 # 主应用
│   ├── App/                        # 应用入口
│   │   ├── ChainlessChainApp.swift # @main 入口
│   │   ├── AppState.swift          # 全局状态
│   │   └── ContentView.swift       # 根视图
│   ├── Features/                   # 功能模块
│   │   ├── Auth/                   # 认证（PIN + Face ID）
│   │   ├── Knowledge/              # 知识库管理
│   │   ├── AI/                     # AI 对话
│   │   ├── Social/                 # P2P 消息
│   │   └── Settings/               # 设置
│   ├── Data/                       # 数据层
│   ├── Core/                       # 核心工具
│   └── Resources/                  # 资源文件
│       ├── Info.plist
│       └── Assets.xcassets/
├── Modules/                        # 核心模块（Swift Packages）
│   ├── CoreCommon/                 # 通用工具
│   ├── CoreSecurity/               # 安全和加密
│   ├── CoreDatabase/               # 数据库（SQLCipher）
│   ├── CoreDID/                    # DID 身份
│   ├── CoreE2EE/                   # 端到端加密
│   └── CoreP2P/                    # P2P 网络
├── Package.swift                   # Swift Package 定义
├── QUICK_START.md                  # 本文档
├── XCODE_PROJECT_SETUP.md          # 详细设置指南
├── SETUP_GUIDE.md                  # 开发指南
├── create_xcode_project.rb         # 自动化脚本
└── generate_app_icons.py           # 图标生成脚本
```

---

## 功能测试清单

### 认证系统

- [ ] 首次启动设置 PIN
- [ ] PIN 验证正常
- [ ] Face ID/Touch ID 正常（真机）
- [ ] 修改 PIN 功能正常

### 知识库管理

- [ ] 创建笔记
- [ ] 编辑笔记
- [ ] 删除笔记
- [ ] 搜索笔记
- [ ] 添加标签
- [ ] 收藏功能

### AI 对话

- [ ] 配置 LLM 提供商（Ollama/OpenAI/Anthropic）
- [ ] 发送消息
- [ ] 接收流式响应
- [ ] 查看对话历史
- [ ] 切换 LLM 提供商

### 设置

- [ ] 查看应用信息
- [ ] 配置 LLM 设置
- [ ] 修改 PIN
- [ ] 清除数据

---

## 下一步

### 1. 完善核心功能

- **AI 对话持久化**：实现对话历史的数据库存储
- **向量数据库**：添加向量数据持久化
- **RAG 搜索优化**：优化检索性能

### 2. 实现 P2P 功能

- **WebRTC 集成**：完成对等连接实现
- **Signal Protocol**：实现端到端加密
- **P2P 消息 UI**：构建消息界面

### 3. 增强功能

- **图片支持**：集成 SDWebImage/Kingfisher
- **多模态 LLM**：支持图片输入
- **本地化**：添加英文支持
- **单元测试**：添加测试覆盖

### 4. 性能优化

- **内存优化**：减少内存占用
- **启动优化**：加快启动速度
- **电池优化**：降低电量消耗

### 5. 生产准备

- **App Store 准备**：配置元数据
- **TestFlight**：Beta 测试
- **性能测试**：压力测试
- **安全审计**：安全检查

---

## 开发资源

### 文档

- **XCODE_PROJECT_SETUP.md** - 详细的 Xcode 项目设置指南
- **SETUP_GUIDE.md** - 开发环境设置指南
- **DEVELOPMENT_SUMMARY.md** - 开发总结和架构说明
- **LLM_INTEGRATION_UPDATE.md** - LLM 集成详情
- **Assets.xcassets/README.md** - 图标资源指南

### 工具

- **create_xcode_project.rb** - 自动生成 Xcode 项目
- **generate_app_icons.py** - 生成应用图标

### 外部资源

- [Apple Developer Documentation](https://developer.apple.com/documentation/)
- [SwiftUI Tutorials](https://developer.apple.com/tutorials/swiftui)
- [iOS Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/)

---

## 技术支持

### 查看日志

**Xcode 控制台**：
```
Cmd + Shift + Y
```

**Console.app**（系统日志）：
```bash
open /Applications/Utilities/Console.app
```

### 重置应用数据

**模拟器**：
```
Device → Erase All Content and Settings
```

**真机**：
```
设置 → 通用 → iPhone 存储空间 → ChainlessChain → 删除 App
```

### 清理构建

```
Product → Clean Build Folder (Cmd + Shift + K)
```

### 重置 Package 缓存

```
File → Packages → Reset Package Caches
```

---

## 版本信息

- **iOS 应用版本**：v0.2.0 Alpha
- **最低 iOS 版本**：15.0
- **Xcode 要求**：14.0+
- **Swift 版本**：5.9+
- **完成度**：55%

---

## 更新日志

### v0.2.0 (2026-01-19)

- ✅ 完整的 LLM 集成（6 个提供商）
- ✅ RAG 搜索系统
- ✅ P2P 消息框架
- ✅ 图片处理服务框架
- ✅ Xcode 项目设置工具

### v0.1.0 (2026-01-19)

- ✅ 初始项目结构
- ✅ 核心模块（6 个）
- ✅ 认证系统
- ✅ 知识库管理
- ✅ 基础 UI

---

**祝你开发顺利！** 🚀

如有问题，请查看详细文档或提交 Issue。
