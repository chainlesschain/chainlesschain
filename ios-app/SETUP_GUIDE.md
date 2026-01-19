# ChainlessChain iOS App - 构建与运行指南

## 📋 目录

- [快速开始](#快速开始)
- [项目结构](#项目结构)
- [环境要求](#环境要求)
- [安装依赖](#安装依赖)
- [构建步骤](#构建步骤)
- [运行项目](#运行项目)
- [常见问题](#常见问题)

## 🚀 快速开始

### 1. 创建 Xcode 项目

由于当前只有源代码文件,需要手动创建 Xcode 项目:

```bash
cd ios-app
```

在 Xcode 中:
1. 打开 Xcode → File → New → Project
2. 选择 "iOS" → "App" → Next
3. 配置项目:
   - Product Name: `ChainlessChain`
   - Team: 选择你的开发团队
   - Organization Identifier: `com.chainlesschain`
   - Bundle Identifier: `com.chainlesschain.ios`
   - Interface: `SwiftUI`
   - Language: `Swift`
   - Storage: `None` (我们使用 SQLite)
   - 取消勾选 "Include Tests"
4. 保存到 `ios-app/` 目录

### 2. 配置 Swift Package Manager

项目已包含 `Package.swift`,Xcode 会自动识别并解析依赖。

### 3. 添加本地 Package

在 Xcode 项目中:
1. File → Add Package Dependencies
2. 选择 "Add Local..."
3. 添加 `ios-app/` 目录作为本地 Package
4. 选择以下模块添加到主 Target:
   - CoreCommon
   - CoreSecurity
   - CoreDatabase
   - CoreDID
   - CoreE2EE
   - CoreP2P

### 4. 导入源文件

将以下目录的文件导入到 Xcode 项目:

```
ChainlessChain/
├── App/
│   ├── ChainlessChainApp.swift
│   ├── AppState.swift
│   └── ContentView.swift
├── Features/
│   ├── Auth/
│   ├── Knowledge/
│   ├── AI/
│   ├── Social/
│   └── Settings/
└── Data/
    └── Repositories/
```

**导入步骤**:
1. 在 Xcode Project Navigator 中右键点击项目
2. Add Files to "ChainlessChain"
3. 选择对应文件夹
4. 勾选 "Create groups"
5. Target 选择主应用 Target

### 5. 配置 Info.plist

将 `ChainlessChain/Resources/Info.plist` 的内容复制到项目的 Info.plist 中。

## 📁 项目结构

```
ios-app/
├── Package.swift                           # Swift Package Manager 配置
├── Modules/                                # 核心模块 (Swift Packages)
│   ├── CoreCommon/                         # ✅ 完成
│   ├── CoreSecurity/                       # ✅ 完成
│   ├── CoreDatabase/                       # ✅ 完成
│   ├── CoreDID/                            # ✅ 完成
│   ├── CoreE2EE/                           # ✅ 完成
│   └── CoreP2P/                            # ✅ 完成
└── ChainlessChain/                         # 主应用 (需要创建 .xcodeproj)
    ├── App/                                # ✅ 应用入口
    │   ├── ChainlessChainApp.swift
    │   ├── AppState.swift
    │   └── ContentView.swift
    ├── Features/                           # ✅ 功能模块
    │   ├── Auth/                           # 认证 (PIN + 生物识别)
    │   ├── Knowledge/                      # 知识库管理
    │   ├── AI/                             # AI 对话
    │   ├── Social/                         # 社交 & P2P 消息
    │   └── Settings/                       # 设置
    ├── Data/                               # ✅ 数据层
    │   └── Repositories/
    └── Resources/                          # ✅ 资源文件
        ├── Info.plist
        └── Assets.xcassets/
```

## 💻 环境要求

- **macOS**: 13.0+ (Ventura)
- **Xcode**: 15.0+
- **Swift**: 5.9+
- **iOS Deployment Target**: 15.0+

## 📦 依赖管理

项目使用 **Swift Package Manager** 管理依赖:

### 核心依赖

| 依赖 | 版本 | 用途 |
|------|------|------|
| libsignal | 0.30.0+ | Signal Protocol (E2EE) |
| sqlcipher | 4.5.6+ | SQLite 加密数据库 |
| WebRTC | 120.0.0+ | WebRTC P2P 连接 |
| Starscream | 4.0.0+ | WebSocket 客户端 |
| CryptoSwift | 1.8.0+ | 加密工具 |
| AnyCodable | 0.6.0+ | 动态类型编解码 |

### 解析依赖

Xcode 会自动解析 `Package.swift` 中定义的依赖:

```bash
# 或使用命令行
swift package resolve
```

## 🔨 构建步骤

### 方式 1: Xcode GUI

1. 打开 `ChainlessChain.xcodeproj`
2. 选择 Target: `ChainlessChain`
3. 选择 Device: `iPhone 15 Pro` (或任何 iOS 15+ 设备)
4. Product → Build (⌘ + B)

### 方式 2: 命令行

```bash
cd ios-app

# 构建 Debug 版本
xcodebuild -scheme ChainlessChain -configuration Debug build

# 构建 Release 版本
xcodebuild -scheme ChainlessChain -configuration Release build

# 构建并运行到模拟器
xcodebuild -scheme ChainlessChain \
  -destination 'platform=iOS Simulator,name=iPhone 15 Pro' \
  build
```

## 📱 运行项目

### 在模拟器中运行

1. Xcode → Product → Destination → 选择模拟器
2. Product → Run (⌘ + R)

**推荐模拟器**:
- iPhone 15 Pro (iOS 17+)
- iPhone 14 Pro (iOS 16+)

### 在真机上运行

1. 连接 iPhone/iPad 设备
2. Xcode → Product → Destination → 选择设备
3. 配置签名:
   - Target → Signing & Capabilities
   - Team: 选择你的 Apple Developer Team
   - Bundle Identifier: `com.chainlesschain.ios`
4. Product → Run (⌘ + R)

**注意**: 真机运行需要 Apple Developer 账号。

## ✅ 功能完成度

### ✅ 已完成 (约 40%)

1. **核心模块** (100%)
   - ✅ CoreCommon (通用工具)
   - ✅ CoreSecurity (Keychain + 生物识别 + 加密)
   - ✅ CoreDatabase (SQLite + SQLCipher)
   - ✅ CoreDID (DID 身份管理)
   - ✅ CoreE2EE (Signal Protocol 框架)
   - ✅ CoreP2P (P2P 网络框架)

2. **认证模块** (100%)
   - ✅ PIN 设置与验证
   - ✅ Face ID / Touch ID 集成
   - ✅ 首次启动引导
   - ✅ DID 自动生成

3. **知识库模块** (95%)
   - ✅ 列表、搜索、分类、标签
   - ✅ CRUD 操作
   - ✅ 收藏功能
   - ✅ 统计信息
   - ⚠️ RAG 搜索 (待集成)

4. **AI 对话模块** (60%)
   - ✅ 对话列表
   - ✅ 聊天界面
   - ⚠️ LLM API 集成 (占位)
   - ⚠️ 流式响应 (待实现)

5. **应用框架** (100%)
   - ✅ SwiftUI 应用入口
   - ✅ 全局状态管理
   - ✅ 导航系统
   - ✅ 启动流程

### ⚠️ 待完成 (约 60%)

1. **P2P 消息** (20%)
   - ⚠️ WebRTC 连接实现
   - ⚠️ Signal Protocol 集成
   - ⚠️ 消息加密解密
   - ⚠️ 离线消息队列

2. **社交功能** (10%)
   - ⚠️ 社交帖子
   - ⚠️ 评论点赞
   - ⚠️ 好友系统

3. **数据同步** (0%)
   - ⚠️ 增量同步
   - ⚠️ 冲突解决
   - ⚠️ 跨设备同步

4. **高级功能**
   - ⚠️ 图片处理
   - ⚠️ 文件上传下载
   - ⚠️ 推送通知
   - ⚠️ 后台任务

## 🐛 常见问题

### 1. 依赖解析失败

**问题**: Swift Package Manager 无法解析依赖

**解决方案**:
```bash
# 清除缓存
rm -rf ~/Library/Developer/Xcode/DerivedData
rm -rf .build

# 重新解析
swift package resolve
```

### 2. 模块导入错误

**问题**: `import CoreCommon` 报错

**解决方案**:
- 确保已在 Xcode 项目中添加本地 Package
- 检查 Target → Build Phases → Link Binary With Libraries

### 3. SQLCipher 编译错误

**问题**: `sqlcipher` 编译失败

**解决方案**:
- 确保 Xcode Command Line Tools 已安装:
  ```bash
  xcode-select --install
  ```

### 4. 签名错误

**问题**: "Failed to register bundle identifier"

**解决方案**:
- 修改 Bundle Identifier 为唯一值
- 例如: `com.yourname.chainlesschain`

### 5. 生物识别不可用

**问题**: Face ID/Touch ID 在模拟器中不工作

**解决方案**:
- 模拟器: Features → Face ID → Enrolled
- 真机: 设置 → Face ID 与密码

## 🎯 下一步开发建议

### 优先级 1: 完善核心功能

1. **集成真实 LLM API**
   - 参考 `desktop-app-vue/src/main/llm/llm-manager.js`
   - 支持 Ollama 本地模型

2. **实现 RAG 搜索**
   - 参考 `desktop-app-vue/src/main/rag/`
   - 集成 Qdrant 向量数据库

3. **完善 P2P 消息**
   - 参考 `desktop-app-vue/src/main/p2p/`
   - 实现 WebRTC DataChannel

### 优先级 2: 用户体验优化

1. **图片处理**
   - 添加 SDWebImage/Kingfisher
   - 实现图片缓存

2. **性能优化**
   - 列表虚拟化
   - 数据分页加载

3. **国际化**
   - 添加 Localizable.strings
   - 支持中英文切换

### 优先级 3: 高级功能

1. **数据同步**
   - 实现增量同步算法
   - 冲突解决策略

2. **推送通知**
   - APNs 集成
   - 本地通知

3. **Widget 支持**
   - iOS 14+ Widget
   - 快捷访问知识库

## 📝 开发规范

### 代码风格

- 遵循 Swift API Design Guidelines
- 使用 SwiftLint 进行代码检查
- MVVM 架构模式

### Git Commit

使用语义化提交:
```
feat(ios): add knowledge search feature
fix(ios): resolve database encryption issue
docs(ios): update setup guide
```

### 分支策略

- `main`: 稳定版本
- `develop`: 开发分支
- `feature/ios-*`: 功能分支
- `fix/ios-*`: 修复分支

## 📚 参考资源

- [Swift 官方文档](https://swift.org/documentation/)
- [SwiftUI 教程](https://developer.apple.com/tutorials/swiftui)
- [Apple Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/)
- [Signal Protocol 文档](https://signal.org/docs/)

## 📞 获取帮助

- **Issues**: [GitHub Issues](https://github.com/yourusername/chainlesschain/issues)
- **讨论**: [GitHub Discussions](https://github.com/yourusername/chainlesschain/discussions)

---

**当前版本**: v0.1.0 (Alpha)
**完成度**: 40%
**最后更新**: 2026-01-19
