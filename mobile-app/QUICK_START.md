# ChainlessChain Mobile - 快速启动指南

快速启动您的移动端知识库应用！

## 📋 前置要求

### 通用要求
- ✅ Node.js >= 18.0.0
- ✅ npm >= 9.0.0
- ✅ Git

### Android 开发
- ✅ Android Studio
- ✅ Android SDK (API 33+)
- ✅ JDK 11+
- ✅ Android 模拟器或真机

### iOS 开发 (仅 macOS)
- ✅ Xcode 15+
- ✅ CocoaPods
- ✅ iOS 模拟器或真机

---

## 🚀 5 分钟快速启动

### 1. 安装依赖 (2 分钟)

```bash
cd mobile-app
npm install
```

### 2. 启动应用

#### Android

```bash
# 启动 Android 模拟器
# 或连接 Android 真机

# 运行应用
npm run android
```

#### iOS (仅 macOS)

```bash
# 安装 iOS 依赖
cd ios
pod install
cd ..

# 运行应用
npm run ios
```

### 3. 登录应用

1. 等待应用编译完成
2. 应用自动打开到登录界面
3. 输入任意 4-6 位数字作为 PIN 码（开发模式）
4. 点击"登录"
5. 进入主界面！

### 4. 开始使用

#### 创建第一条笔记
1. 点击右上角"+ 新建"
2. 输入标题："我的第一条笔记"
3. 输入内容（支持 Markdown）：
   ```markdown
   # 欢迎

   这是我的第一条笔记！

   - 支持 Markdown
   - 支持 AI 对话
   - 支持跨设备同步
   ```
4. 点击"保存"

#### 与 AI 对话
1. 点击底部"AI 助手"标签
2. 输入问题："你好"
3. 等待 AI 回复

**注意**: AI 功能需要配置服务器（见下方配置部分）

---

## ⚙️ 配置

### AI 服务配置

如果您有 Ollama 服务：

1. 打开"设置"标签
2. 找到"AI 服务"部分
3. 输入服务器地址（如 `http://192.168.1.100:11434`）
4. 测试连接

### 同步服务配置

如果您有同步服务器：

1. 打开"设置"标签
2. 启用"启用同步"
3. 输入服务器地址
4. 点击"测试连接"
5. 启用"自动同步"（可选）

---

## 🔧 常见问题

### Android

#### Q: Metro Bundler 端口被占用

```bash
# 杀掉占用端口的进程
npx react-native start --reset-cache
```

#### Q: Gradle 下载慢

设置国内镜像，编辑 `android/build.gradle`：

```gradle
repositories {
    maven { url 'https://maven.aliyun.com/repository/public/' }
    maven { url 'https://maven.aliyun.com/repository/google/' }
}
```

#### Q: 设备未连接

```bash
# 查看连接的设备
adb devices

# 重启 ADB
adb kill-server
adb start-server
```

### iOS

#### Q: Pod install 失败

```bash
cd ios
pod deintegrate
pod install
cd ..
```

#### Q: 模拟器启动失败

```bash
# 重置模拟器
xcrun simctl erase all
```

### 通用问题

#### Q: 白屏或应用崩溃

1. 清除缓存：
   ```bash
   npm start -- --reset-cache
   ```

2. 重新安装依赖：
   ```bash
   rm -rf node_modules
   npm install
   ```

3. 查看日志：
   ```bash
   # Android
   npx react-native log-android

   # iOS
   npx react-native log-ios
   ```

#### Q: TypeScript 错误

```bash
# 运行类型检查
npm run type-check
```

---

## 📱 开发模式功能

### 模拟 SIMKey

开发模式下，SIMKey 功能使用模拟实现：

- ✅ 自动检测为"已连接"
- ✅ 接受任意 4-6 位 PIN 码
- ✅ 生成模拟的序列号和公钥
- ✅ 完整的加密/签名接口

### 示例数据

首次登录会自动创建示例笔记，包含：

- 欢迎消息
- Markdown 示例
- 功能介绍

### 开发工具

- **Reload**:
  - iOS: Cmd + R
  - Android: 双击 R

- **Debug Menu**:
  - iOS: Cmd + D
  - Android: Cmd + M (Mac) 或 Ctrl + M (Windows/Linux)

---

## 🎯 下一步

### 1. 集成真实 SIMKey SDK

参考 `android/README.md` 中的详细说明

### 2. 配置 AI 服务

启动本地 Ollama 服务或连接到远程服务器

### 3. 配置同步服务

设置与桌面版同步的服务器

### 4. 自定义功能

根据需求修改和扩展功能

---

## 📚 更多资源

- [完整文档](README.md)
- [开发完成报告](../MOBILE_DEV_COMPLETE.md)
- [Android 集成指南](android/README.md)
- [系统设计文档](../系统设计_个人移动AI管理系统.md)

---

## 💬 获取帮助

遇到问题？

1. 查看 [常见问题](#🔧-常见问题)
2. 查看 [完整文档](README.md)
3. 提交 Issue: https://github.com/yourname/chainlesschain/issues

---

**开始您的移动知识库之旅！** 🚀
