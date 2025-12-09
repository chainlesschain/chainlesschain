# ChainlessChain Mobile

基于 React Native 的移动端个人 AI 知识库应用

## 功能特性

- 📝 **知识库管理** - 创建、编辑、查看和搜索笔记
- 🔒 **SIMKey 认证** - 基于 SIM 卡的安全认证
- 🤖 **AI 对话助手** - 与 AI 进行智能对话
- 🔄 **跨设备同步** - 与桌面版和服务器同步数据
- ✍️ **Markdown 支持** - 完整的 Markdown 编辑和渲染
- 🔐 **加密存储** - 本地数据加密存储

## 技术栈

- **框架**: React Native 0.73
- **语言**: TypeScript 5.3
- **导航**: React Navigation 6
- **状态管理**: Zustand 4.5
- **网络请求**: Axios 1.6
- **本地存储**: AsyncStorage + EncryptedStorage
- **Markdown**: React Native Markdown Display

## 快速开始

### 环境要求

- Node.js >= 18.0.0
- React Native 开发环境 (Android Studio / Xcode)
- Android SDK (Android 开发) 或 Xcode (iOS 开发)

### 安装依赖

```bash
cd mobile-app
npm install
```

### iOS 开发 (仅 macOS)

```bash
cd ios
pod install
cd ..
npm run ios
```

### Android 开发

```bash
npm run android
```

### 启动开发服务器

```bash
npm start
```

## 项目结构

```
mobile-app/
├── src/
│   ├── screens/          # 页面组件
│   │   ├── LoginScreen.tsx
│   │   ├── KnowledgeListScreen.tsx
│   │   ├── KnowledgeEditScreen.tsx
│   │   ├── KnowledgeViewScreen.tsx
│   │   ├── ChatScreen.tsx
│   │   └── SettingsScreen.tsx
│   ├── services/         # 服务层
│   │   ├── simkey.ts     # SIMKey SDK 集成
│   │   ├── storage.ts    # 本地存储
│   │   ├── llm.ts        # AI 服务
│   │   └── sync.ts       # 同步服务
│   ├── stores/           # 状态管理
│   │   └── useAppStore.ts
│   ├── types/            # TypeScript 类型
│   │   └── index.ts
│   └── App.tsx           # 主应用组件
├── android/              # Android 原生代码
├── ios/                  # iOS 原生代码
├── package.json
├── tsconfig.json
└── README.md
```

## 主要功能

### 1. SIMKey 认证

应用使用 SIM 卡进行安全认证：

```typescript
// services/simkey.ts
const status = await simKeyService.detectSIMKey();
const verified = await simKeyService.verifyPIN({pin: '123456'});
```

**注意**: 当前为模拟实现，需要集成实际的 SIMKey SDK。

### 2. 知识库管理

支持完整的 CRUD 操作：

- 创建新笔记
- 编辑现有笔记
- 查看笔记（Markdown 渲染）
- 搜索笔记（标题、内容、标签）
- 删除笔记

### 3. AI 对话

连接到本地或远程 AI 服务：

```typescript
// services/llm.ts
const response = await llmService.query('你好', context, history);
```

默认连接到 Ollama (http://localhost:11434)

### 4. 数据同步

支持与桌面版和服务器同步：

```typescript
// services/sync.ts
const result = await syncService.sync(knowledgeItems);
```

## 开发指南

### 集成 SIMKey SDK

1. 将 SIMKey SDK 添加到项目依赖
2. 链接原生模块（Android / iOS）
3. 修改 `src/services/simkey.ts` 中的 TODO 部分
4. 替换模拟实现为实际 SDK 调用

示例：

```typescript
// 替换这部分
async detectSIMKey(): Promise<SIMKeyStatus> {
  // TODO: Replace with actual SDK call
  // const result = await SIMKeySDK.detect();

  // 改为
  const result = await SIMKeySDK.detect();
  return {
    connected: result.connected,
    serialNumber: result.serialNumber,
    // ...
  };
}
```

### 配置 AI 服务

在设置页面配置 AI 服务器地址：

1. 打开"设置"标签
2. 输入服务器地址（如 http://your-server:11434）
3. 点击"测试连接"
4. 启用自动同步（可选）

### 配置同步服务

1. 打开"设置"标签
2. 启用"启用同步"
3. 输入同步服务器地址
4. 测试连接
5. 启用"自动同步"（可选）

## 调试

### 启用调试菜单

- **iOS**: Cmd + D
- **Android**: Cmd + M (Mac) 或 Ctrl + M (Windows/Linux)

### 查看日志

```bash
# iOS
npx react-native log-ios

# Android
npx react-native log-android
```

### 常见问题

#### 1. Metro Bundler 无法启动

```bash
# 清除缓存
npm start -- --reset-cache
```

#### 2. Android 编译失败

```bash
cd android
./gradlew clean
cd ..
npm run android
```

#### 3. iOS Pod 安装失败

```bash
cd ios
pod deintegrate
pod install
cd ..
npm run ios
```

## 构建发布版本

### Android

```bash
cd android
./gradlew assembleRelease
```

APK 文件位于: `android/app/build/outputs/apk/release/app-release.apk`

### iOS

1. 在 Xcode 中打开 `ios/ChainlessChain.xcworkspace`
2. 选择 Product > Archive
3. 按照 Apple 的发布流程操作

## 测试

```bash
# 运行测试
npm test

# 类型检查
npm run type-check

# 代码检查
npm run lint
```

## 下一步计划

- [ ] 集成真实的 SIMKey SDK
- [ ] 实现完整的同步协议
- [ ] 添加离线支持
- [ ] 实现推送通知
- [ ] 添加生物识别认证（指纹/面部）
- [ ] 支持更多 Markdown 功能
- [ ] 添加主题切换（深色模式）
- [ ] 实现笔记分享功能

## 贡献

欢迎提交 Issue 和 Pull Request！

## 许可证

MIT

## 联系方式

- 项目主页: https://chainlesschain.com
- 文档: https://docs.chainlesschain.org
- 问题反馈: https://github.com/yourname/chainlesschain/issues
