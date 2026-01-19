# Xcode 项目设置指南

本文档提供两种方式来创建 ChainlessChain iOS 项目的 Xcode 工程文件。

## 方式一：使用 Xcode GUI（推荐）

### 步骤 1：安装 Xcode

确保你已经安装了完整版的 Xcode（不仅是命令行工具）：

1. 从 App Store 下载并安装 Xcode 14.0+
2. 打开 Xcode 并同意许可协议
3. 验证安装：
   ```bash
   xcode-select --install
   sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
   xcodebuild -version
   ```

### 步骤 2：在 Xcode 中创建新项目

1. **打开 Xcode**，选择 "Create a new Xcode project"

2. **选择模板**：
   - 平台：iOS
   - 模板：App
   - 点击 "Next"

3. **配置项目信息**：
   - Product Name: `ChainlessChain`
   - Team: 选择你的开发团队（或暂时留空）
   - Organization Identifier: `com.chainlesschain`
   - Bundle Identifier: `com.chainlesschain.ChainlessChain`
   - Interface: **SwiftUI**
   - Language: **Swift**
   - Storage: **None** (我们使用自定义的 SQLCipher)
   - 取消勾选 "Include Tests"（我们稍后手动添加）

4. **保存位置**：
   - 选择 `/Users/mac/Documents/code2/chainlesschain/ios-app/`
   - **重要**：Xcode 会创建一个新的 `ChainlessChain` 文件夹，需要将其内容与现有的合并

### 步骤 3：整合现有代码

创建项目后，你会发现 Xcode 生成了默认的项目文件。需要进行以下整合：

1. **删除 Xcode 生成的默认文件**：
   - 在 Xcode 的 Navigator 中删除自动生成的 `ChainlessChainApp.swift` 和 `ContentView.swift`（选择 "Move to Trash"）
   - 删除自动生成的 `Assets.xcassets`（我们使用 Resources 目录中的）

2. **添加现有源代码**：
   - 右键点击项目根目录 → "Add Files to ChainlessChain..."
   - 选择现有的 `ChainlessChain` 文件夹
   - **关键设置**：
     - ✅ 勾选 "Copy items if needed"
     - ✅ 选择 "Create groups"
     - ✅ 勾选 "ChainlessChain" target

3. **添加 Modules（Swift Package 依赖）**：
   - 选择项目文件 → Project 设置 → Package Dependencies 标签
   - 点击 "+" 添加本地包：
     - 点击 "Add Local..."
     - 导航到 `ios-app/Modules/CoreCommon`，添加
     - 重复以上步骤，依次添加：
       - `CoreSecurity`
       - `CoreDatabase`
       - `CoreDID`
       - `CoreE2EE`
       - `CoreP2P`

### 步骤 4：配置 Package Dependencies

1. **添加外部依赖包**：
   - Project 设置 → Package Dependencies → "+"
   - 添加以下 URL（逐个添加）：

```
https://github.com/signalapp/libsignal.git
https://github.com/sqlcipher/sqlcipher.git
https://github.com/stasel/WebRTC.git
https://github.com/daltoniam/Starscream.git
https://github.com/krzyzanowskim/CryptoSwift.git
https://github.com/Flight-School/AnyCodable.git
```

2. **配置版本**：
   - libsignal: 0.30.0 及以上
   - sqlcipher: 4.5.6 及以上
   - WebRTC: 120.0.0 及以上
   - Starscream: 4.0.0 及以上
   - CryptoSwift: 1.8.0 及以上
   - AnyCodable: 0.6.0 及以上

### 步骤 5：配置 Build Settings

1. **Target 设置**：
   - 选择 ChainlessChain target → Build Settings
   - 设置以下选项：

```
Deployment Target: iOS 15.0
Swift Language Version: Swift 5
Enable Bitcode: No (WebRTC 不支持)
Other Swift Flags: -DDEBUG (仅 Debug 配置)
```

2. **Framework Search Paths**：
   - 确保包含 SQLCipher 和 WebRTC 的框架路径

3. **Linker Flags**（如果需要）：
   - Other Linker Flags: `-lsqlite3 -lc++`

### 步骤 6：配置 Info.plist

Info.plist 已经存在于 `ChainlessChain/Resources/Info.plist`，需要在 Build Settings 中指定：

1. Target 设置 → Build Settings
2. 搜索 "Info.plist File"
3. 设置路径为：`ChainlessChain/Resources/Info.plist`

### 步骤 7：配置 Assets 和 Resources

1. **添加 Assets Catalog**：
   - 右键 Resources 文件夹 → New File → Asset Catalog
   - 命名为 `Assets`

2. **添加 App Icon**：
   - 选择 Assets.xcassets → 右键 → App Icons & Launch Images → New iOS App Icon
   - 将 App Icon 资源拖入对应尺寸槽位

3. **添加 Launch Screen Icon**：
   - 在 Assets.xcassets 中创建新的 Image Set，命名为 `LaunchIcon`

4. **配置 Target**：
   - Target → General → App Icons and Launch Screen
   - App Icons Source: `AppIcon`
   - 确认 Info.plist 中的 Launch Screen 配置

### 步骤 8：配置 Capabilities

为了使用 Face ID、Keychain、P2P 等功能，需要启用相应的 Capabilities：

1. Target → Signing & Capabilities
2. 点击 "+ Capability" 添加：
   - **Keychain Sharing**（用于 Keychain 访问）
   - **Background Modes**：
     - ✅ Audio, AirPlay, and Picture in Picture（WebRTC 需要）
     - ✅ Background fetch
   - **Network Extensions**（P2P 需要，可选）

### 步骤 9：配置 Scheme

1. Product → Scheme → Edit Scheme
2. Run → Info：
   - Build Configuration: Debug
   - Executable: ChainlessChain
3. Run → Options：
   - 确保 "Allow Location Simulation" 已勾选（测试时可能需要）

### 步骤 10：验证构建

1. **选择模拟器**：iPhone 14 Pro（iOS 15.0+）
2. **清理构建**：Product → Clean Build Folder (Cmd+Shift+K)
3. **构建项目**：Product → Build (Cmd+B)
4. **运行项目**：Product → Run (Cmd+R)

---

## 方式二：使用脚本自动生成（高级）

如果你熟悉 Ruby 和 xcodeproj gem，可以使用自动化脚本。

### 前置要求

```bash
sudo gem install xcodeproj
```

### 运行脚本

```bash
cd /Users/mac/Documents/code2/chainlesschain/ios-app
ruby create_xcode_project.rb
```

脚本文件：`create_xcode_project.rb`（见下方）

---

## 常见问题排查

### 1. 编译错误：找不到模块

**原因**：Swift Package 依赖未正确添加

**解决方案**：
- File → Packages → Resolve Package Versions
- 清理构建文件夹并重新构建
- 检查 Package Dependencies 中是否所有包都已添加

### 2. SQLCipher 链接错误

**原因**：SQLCipher 需要特殊的链接配置

**解决方案**：
- Build Settings → Other Linker Flags：添加 `-lsqlite3`
- 确保 SQLCipher package 版本 >= 4.5.6

### 3. WebRTC 编译失败

**原因**：Bitcode 冲突

**解决方案**：
- Build Settings → Enable Bitcode：设置为 `No`

### 4. Info.plist 权限警告

**原因**：缺少隐私描述

**解决方案**：
- 已在 `Resources/Info.plist` 中配置，确保路径正确指向该文件

### 5. 模拟器运行白屏

**原因**：数据库路径问题或初始化失败

**解决方案**：
- 检查日志输出（Cmd+Shift+Y 打开控制台）
- 重置模拟器：Device → Erase All Content and Settings

---

## 项目结构验证清单

创建完成后，你的项目结构应该如下：

```
ios-app/
├── ChainlessChain.xcodeproj/       # ← Xcode 项目文件（新建）
│   ├── project.pbxproj
│   └── xcshareddata/
├── ChainlessChain/                 # 主应用
│   ├── App/
│   ├── Features/
│   ├── Data/
│   ├── Core/
│   └── Resources/
│       ├── Info.plist
│       └── Assets.xcassets         # ← 需要手动创建
├── Modules/                        # 核心模块（Swift Packages）
│   ├── CoreCommon/
│   ├── CoreSecurity/
│   ├── CoreDatabase/
│   ├── CoreDID/
│   ├── CoreE2EE/
│   └── CoreP2P/
├── Package.swift                   # Swift Package 定义
└── XCODE_PROJECT_SETUP.md          # 本文档
```

---

## 下一步

项目创建完成后，可以进行以下工作：

1. **测试基本功能**：
   - 运行应用，测试 PIN 设置和 Face ID
   - 测试知识库 CRUD 操作
   - 测试 LLM 对话（需要配置 API）

2. **完善功能**：
   - 实现 AI 对话历史持久化
   - 完成 P2P 消息的具体实现
   - 添加图片处理功能

3. **测试和调试**：
   - 添加单元测试
   - 添加 UI 测试
   - 性能优化

---

## 技术支持

如果遇到问题，可以：

1. 查看日志输出（Console.app 或 Xcode 控制台）
2. 查看 `SETUP_GUIDE.md` 中的详细说明
3. 查看 `DEVELOPMENT_SUMMARY.md` 了解架构细节

---

**版本信息**：
- 文档版本：v1.0
- 创建日期：2026-01-19
- iOS 项目版本：v0.2.0
- 最低 iOS 版本：15.0
- Xcode 要求：14.0+
