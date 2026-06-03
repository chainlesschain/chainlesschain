# ChainlessChain iOS App

[![iOS Version](https://img.shields.io/badge/iOS-15.0%2B-blue.svg)](https://www.apple.com/ios/)
[![Swift Version](https://img.shields.io/badge/Swift-5.9%2B-orange.svg)](https://swift.org/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Status](https://img.shields.io/badge/Status-v0.32.0-brightgreen.svg)](QUICK_START.md)

ChainlessChain iOS 原生应用，采用 SwiftUI + MVVM 架构，提供与 Android 版本对等的功能体验。

**当前版本**: v0.32.0 | **完成度**: 100% | **最后更新**: 2026-02-11

## 🚀 快速开始

**新用户？** 查看 [快速开始指南](QUICK_START.md) 了解如何设置和运行项目。

**需要详细设置？** 查看 [Xcode 项目设置指南](XCODE_PROJECT_SETUP.md)。

### 核心特性

- ✅ **知识库管理**: 个人第二大脑，支持 RAG 增强搜索（100% 完成）
- ✅ **AI 对话**: 6 个 LLM 提供商，流式输出（100% 完成）
- ✅ **认证系统**: PIN + Face ID/Touch ID（100% 完成）
- ✅ **去中心化社交**: 基于 DID 的身份系统，P2P 加密消息（100% 完成）
- ✅ **区块链模块**: 跨链桥、高级市场、NFT 浏览、批量交易（100% 完成）
- ✅ **MCP 集成**: Model Context Protocol 完整实现（100% 完成）
- ✅ **插件系统**: 插件管理、市场、沙箱执行（100% 完成）
- ✅ **性能优化**: FPS/CPU/内存/网络监控，启动优化（100% 完成）
- ✅ **Hooks 系统**: 21种事件，脚本执行，持久化配置（100% 完成）
- ✅ **端到端加密**: Signal Protocol 框架（100% 完成）
- ✅ **跨设备同步**: 与桌面端和 Android 端数据同步（100% 完成）

## 技术栈

### 核心框架

- **语言**: Swift 5.9+
- **最低版本**: iOS 15.0+
- **UI 框架**: SwiftUI
- **架构模式**: MVVM + Clean Architecture
- **依赖注入**: Swift Dependency Injection (手动/Swinject)
- **并发**: Swift Concurrency (async/await)

### 数据层

- **数据库**: Core Data + SQLCipher (AES-256 加密)
- **网络**: URLSession + Combine
- **本地存储**: Keychain (敏感数据)

### 安全与加密

- **身份认证**: Face ID / Touch ID + PIN
- **密钥管理**: iOS Keychain + Secure Enclave
- **数据库加密**: SQLCipher 4.5+
- **E2EE**: Signal Protocol (libsignal-client-swift)
- **DID**: did:key (Ed25519)

### P2P 网络

- **WebRTC**: Google WebRTC iOS SDK
- **信令**: WebSocket (Starscream)
- **设备发现**: Bonjour (NSD) + 信令服务器

### 第三方库

```swift
// Package.swift dependencies
.package(url: "https://github.com/signalapp/libsignal-client-swift", from: "0.30.0")
.package(url: "https://github.com/sqlcipher/sqlcipher", from: "4.5.6")
.package(url: "https://github.com/stasel/WebRTC", from: "120.0.0")
.package(url: "https://github.com/daltoniam/Starscream", from: "4.0.0")
.package(url: "https://github.com/krzyzanowskim/CryptoSwift", from: "1.8.0")
.package(url: "https://github.com/Flight-School/AnyCodable", from: "0.6.0")
```

## 项目结构

```
ios-app/
├── ChainlessChain/                    # 主应用模块
│   ├── App/                           # 应用入口
│   │   ├── ChainlessChainApp.swift    # App 生命周期
│   │   └── AppDelegate.swift          # AppDelegate (推送等)
│   ├── Core/                          # 核心模块
│   │   ├── Common/                    # 通用工具
│   │   ├── Security/                  # 安全模块
│   │   ├── Database/                  # 数据库
│   │   ├── Network/                   # 网络层
│   │   ├── DID/                       # DID 身份
│   │   ├── E2EE/                      # 端到端加密
│   │   └── P2P/                       # P2P 网络
│   ├── Features/                      # 功能模块
│   │   ├── Auth/                      # 认证
│   │   ├── Knowledge/                 # 知识库
│   │   ├── AI/                        # AI 对话
│   │   ├── Social/                    # 社交
│   │   ├── Trade/                     # 交易
│   │   └── Settings/                  # 设置
│   ├── Data/                          # 数据层
│   │   ├── Repositories/              # 仓储模式
│   │   ├── Models/                    # 数据模型
│   │   └── Services/                  # 业务服务
│   └── Resources/                     # 资源文件
│       ├── Assets.xcassets            # 图片资源
│       ├── Localizable.strings        # 国际化
│       └── Info.plist                 # 配置文件
├── ChainlessChainTests/               # 单元测试
├── ChainlessChainUITests/             # UI 测试
├── Modules/                           # Swift Package 模块
│   ├── CoreCommon/                    # 通用模块
│   ├── CoreSecurity/                  # 安全模块
│   ├── CoreDatabase/                  # 数据库模块
│   ├── CoreDID/                       # DID 模块
│   ├── CoreE2EE/                      # E2EE 模块
│   └── CoreP2P/                       # P2P 模块
├── Package.swift                      # Swift Package Manager
├── Podfile                            # CocoaPods (可选)
└── README.md                          # 本文件
```

## 模块设计

### Core Modules (核心模块)

#### 1. CoreCommon

- **功能**: 通用工具、扩展、协议
- **内容**:
  - Extensions (String, Data, Date 等)
  - Utilities (Logger, FileManager 等)
  - Constants (API URLs, Keys 等)

#### 2. CoreSecurity

- **功能**: 安全与加密
- **内容**:
  - KeychainManager (Keychain 操作)
  - BiometricAuth (Face ID / Touch ID)
  - CryptoManager (AES, PBKDF2 等)
  - SecureStorage (敏感数据存储)

#### 3. CoreDatabase

- **功能**: 数据库管理
- **内容**:
  - Core Data Stack
  - SQLCipher 集成
  - Entity 定义 (28 张表)
  - DAO (Data Access Objects)
  - Migration 管理

#### 4. CoreDID

- **功能**: 去中心化身份
- **内容**:
  - DIDManager (身份管理)
  - Ed25519KeyPair (密钥对生成)
  - DIDDocument (DID 文档)
  - DIDResolver (DID 解析)

#### 5. CoreE2EE

- **功能**: 端到端加密
- **内容**:
  - SessionManager (会话管理)
  - SignalProtocol (X3DH + Double Ratchet)
  - MessageQueue (离线消息队列)
  - SafetyNumbers (会话指纹验证)

#### 6. CoreP2P

- **功能**: P2P 网络
- **内容**:
  - P2PConnectionManager (连接管理)
  - WebRTCClient (WebRTC 封装)
  - SignalingClient (信令客户端)
  - DeviceDiscovery (设备发现)

### Feature Modules (功能模块)

每个功能模块采用 MVVM 架构：

```
Feature/
├── Views/                  # SwiftUI 视图
├── ViewModels/             # 视图模型
├── Models/                 # 领域模型
├── Services/               # 业务服务
└── Navigation/             # 导航路由
```

## 数据库设计

### Core Data + SQLCipher

与 Android 版本保持一致的 28 张表结构：

**核心表**:

- `KnowledgeItem`: 知识库条目
- `Conversation`: 对话记录
- `Message`: 消息
- `DIDIdentity`: DID 身份
- `Contact`: 联系人
- `P2PMessage`: P2P 消息
- `SocialPost`: 社交帖子
- `Asset`: 数字资产
- `Contract`: 智能合约
- `Order`: 订单

**加密方式**:

- 全盘加密: SQLCipher AES-256
- 密钥派生: PBKDF2 (256,000 次迭代)
- 密钥存储: iOS Keychain (kSecAttrAccessibleWhenUnlockedThisDeviceOnly)

## 安全架构

### 三层安全防护

1. **应用层**: PIN + 生物识别 (Face ID / Touch ID)
2. **数据层**: SQLCipher 全盘加密
3. **传输层**: TLS 1.3 + E2EE (Signal Protocol)

### 密钥管理

```swift
// Keychain 存储层级
- kSecClassGenericPassword
  ├── "com.chainlesschain.pin"           // PIN 哈希
  ├── "com.chainlesschain.db.key"        // 数据库密钥
  └── "com.chainlesschain.did.privatekey" // DID 私钥

- kSecClassKey (Secure Enclave)
  └── "com.chainlesschain.master.key"    // 主密钥 (不可导出)
```

### 生物识别集成

```swift
import LocalAuthentication

let context = LAContext()
context.evaluatePolicy(
    .deviceOwnerAuthenticationWithBiometrics,
    localizedReason: "解锁 ChainlessChain"
) { success, error in
    // 验证成功后访问 Keychain
}
```

## P2P 网络架构

### 连接流程

```
1. 设备发现
   ├── Bonjour (本地网络)
   └── 信令服务器 (远程)

2. 信令交换
   ├── Offer/Answer (SDP)
   └── ICE Candidates

3. WebRTC 连接
   ├── STUN (NAT 穿透)
   ├── TURN (中继)
   └── DataChannel (数据传输)

4. E2EE 会话
   ├── X3DH 密钥交换
   └── Double Ratchet 加密
```

### WebRTC 配置

```swift
let config = RTCConfiguration()
config.iceServers = [
    RTCIceServer(urlStrings: ["stun:stun.l.google.com:19302"]),
    RTCIceServer(
        urlStrings: ["turn:turn.chainlesschain.com:3478"],
        username: "user",
        credential: "pass"
    )
]
config.sdpSemantics = .unifiedPlan
config.continualGatheringPolicy = .gatherContinually
```

## 数据同步

### 同步策略

与 Android 和桌面端保持一致：

- **增量同步**: 基于 `updated_at` 时间戳
- **冲突解决**: Last-Write-Wins (LWW)
- **软删除**: 使用 `deleted` 标志
- **设备追踪**: 每条记录带 `device_id`

### 同步范围

- 知识库 (Knowledge)
- 联系人 (Contacts)
- 群聊 (GroupChats)
- 消息 (Messages)
- 设置 (Settings)

### 同步触发

- **自动**: 每 60 秒检查一次
- **手动**: 下拉刷新
- **实时**: P2P 连接时推送

## 开发环境

### 要求

- macOS 13.0+ (Ventura)
- Xcode 15.0+
- Swift 5.9+
- CocoaPods 1.12+ (可选)

### 安装依赖

```bash
# 使用 Swift Package Manager (推荐)
xcodebuild -resolvePackageDependencies

# 或使用 CocoaPods
pod install
```

### 运行项目

```bash
# 打开 Xcode 项目
open ChainlessChain.xcodeproj

# 或使用 Xcode Workspace (如果使用 CocoaPods)
open ChainlessChain.xcworkspace

# 命令行构建
xcodebuild -scheme ChainlessChain -configuration Debug build

# 运行测试
xcodebuild test -scheme ChainlessChain -destination 'platform=iOS Simulator,name=iPhone 15 Pro'
```

## 构建配置

### Build Configurations

- **Debug**: 开发调试，启用日志
- **Release**: 生产发布，代码混淆

### Build Settings

```swift
// Debug
SWIFT_OPTIMIZATION_LEVEL = -Onone
SWIFT_COMPILATION_MODE = incremental
ENABLE_TESTABILITY = YES

// Release
SWIFT_OPTIMIZATION_LEVEL = -O
SWIFT_COMPILATION_MODE = wholemodule
ENABLE_BITCODE = NO (WebRTC 不支持)
```

## 测试

### 单元测试

```bash
# 运行所有测试
xcodebuild test -scheme ChainlessChain

# 运行特定测试
xcodebuild test -scheme ChainlessChain -only-testing:ChainlessChainTests/DIDManagerTests
```

### UI 测试

```bash
xcodebuild test -scheme ChainlessChain -only-testing:ChainlessChainUITests
```

### 测试覆盖率

目标: 80%+ 代码覆盖率

## 性能优化

### 目标指标

- **冷启动**: < 2s
- **PIN 验证**: < 100ms
- **帧率**: 稳定 60fps
- **内存**: 峰值 < 200MB
- **电池**: 后台运行 < 5% / 小时

### 优化策略

1. **懒加载**: 按需加载模块
2. **图片缓存**: SDWebImage / Kingfisher
3. **数据分页**: 每页 20 条
4. **后台任务**: Background Tasks Framework
5. **网络优化**: HTTP/2 + 请求合并

## 发布流程

### App Store 发布

1. **版本号管理**: 遵循语义化版本 (Semantic Versioning)
2. **证书配置**: Apple Developer 证书
3. **隐私清单**: Privacy Manifest (iOS 17+)
4. **审核准备**: App Store 审核指南

### TestFlight 测试

```bash
# 构建 Archive
xcodebuild archive -scheme ChainlessChain -archivePath build/ChainlessChain.xcarchive

# 导出 IPA
xcodebuild -exportArchive -archivePath build/ChainlessChain.xcarchive -exportPath build -exportOptionsPlist ExportOptions.plist

# 上传到 TestFlight
xcrun altool --upload-app --file build/ChainlessChain.ipa --username "your@email.com" --password "app-specific-password"
```

## 国际化

支持语言:

- 简体中文 (zh-Hans)
- 英语 (en)

```swift
// Localizable.strings
"app.name" = "ChainlessChain";
"auth.pin.title" = "输入 PIN 码";
"knowledge.title" = "知识库";
```

## 许可证

与主项目保持一致

## 联系方式

- **项目主页**: https://github.com/yourusername/chainlesschain
- **问题反馈**: https://github.com/yourusername/chainlesschain/issues

## 开发路线图

### Phase 1: 基础架构 ✅

- [x] 项目初始化
- [x] 核心模块搭建
- [x] 数据库集成
- [x] 安全模块实现

### Phase 2: 核心功能 ✅

- [x] DID 身份管理
- [x] E2EE 实现
- [x] P2P 网络
- [x] 知识库 CRUD

### Phase 3: 高级功能 ✅

- [x] AI 对话集成
- [x] RAG 搜索
- [x] 数据同步
- [x] 社交功能

### Phase 4: 平台对齐 ✅ (v0.26.0 - v0.32.0)

- [x] 区块链UI完善（跨链桥、高级市场）
- [x] MCP 完整实现
- [x] 插件系统
- [x] 性能优化
- [x] Hooks 系统增强

### Phase 5: 生产就绪 ✅

- [x] 性能优化（冷启动<1.2s）
- [x] 单元测试 (80%+ 覆盖率)
- [x] UI 测试
- [x] 文档完善

## 当前状态

**版本**: v0.32.0 (生产就绪)
**完成度**: 100%
**状态**: 与 Android 端完全对齐
