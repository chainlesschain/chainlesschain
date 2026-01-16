# ChainlessChain移动端 Android打包指南

## 项目状态

**最后更新**: 2026-01-16

项目已修复以下问题：

- ✅ 修复了交易模块中的数据库导入路径错误（5个文件）
- ✅ 修复了logo.png资源路径问题（2个文件）
- ✅ 添加了`getDatabase()`和`getDIDManager()`兼容性函数
- ✅ 将logo.png复制到`src/static/`目录
- ✅ 修复了动态导入问题（settings.vue 中的 import()）
- ✅ 完善了 Android 原生权限配置（15项权限）
- ✅ 添加了原生 SDK 模块配置（SQLite、Fingerprint、Camera、Record等）
- ✅ 优化了 vite.config.js 打包配置（压缩、资源内联等）

**当前状态**: ✅ CLI构建成功，可正常打包

## 打包方式

### 方案一：CLI命令行构建（推荐）

```bash
# 进入项目目录
cd mobile-app-uniapp

# 安装依赖（首次）
npm install

# 构建 App 资源
npm run build:app
```

构建完成后，资源文件位于：`dist/build/app-plus/`

**构建输出说明**：

- `app-service.js` (~2MB): 包含所有业务逻辑的主文件
- `uni-app-view.umd.js` (~344KB): uni-app 运行时
- `app.css` (~42KB): 全局样式
- `pages/` 目录: 各页面的样式文件
- `static/` 目录: 静态资源（图片、字体等）

**总输出大小**: ~3.5MB（压缩后的资源文件）

---

### 方案二：使用HBuilderX可视化打包

#### 步骤：

1. **下载并安装HBuilderX**
   - 官网：https://www.dcloud.io/hbuilderx.html
   - 下载"App开发版"
   - 安装后打开HBuilderX

2. **导入项目**
   - 点击菜单：文件 -> 导入 -> 从本地目录导入
   - 选择路径：`mobile-app-uniapp`
   - 点击"确定"

3. **配置manifest.json**
   - 在项目中打开`src/manifest.json`
   - 点击"源码视图"或"可视化配置"
   - 检查以下配置：
     - App名称：ChainlessChain
     - AppID：**UNI**4F3B0DC
     - 版本号：0.1.0
     - 版本名称：0.1.0

4. **配置Android打包证书（首次需要）**
   - 点击"manifest.json"可视化配置界面
   - 切换到"App常用其他配置"
   - 在"Android设置"中配置证书
   - 如果没有证书，可以使用HBuilderX自带的云打包（DCloud会自动生成测试证书）

5. **开始打包**

   **方法A: 云打包（简单）**
   - 右键项目根目录
   - 选择：发行 -> 原生App-云打包
   - 选择"Android"
   - 勾选"使用DCloud老版证书"（测试用）或"使用自有证书"
   - 点击"打包"
   - 等待云端打包完成（5-15分钟）
   - 下载生成的APK文件

   **方法B: 本地打包（需要Android SDK）**
   - 右键项目根目录
   - 选择：发行 -> 原生App-本地打包 -> 生成本地打包App资源
   - 生成后会在`unpackage/resources/`目录下生成资源文件
   - 使用Android Studio导入`platforms/android`项目
   - 构建APK

6. **安装测试**
   - 将生成的APK文件传输到Android设备
   - 安装并测试应用

---

### 方案三：使用DCloud开发者中心云打包

#### 步骤：

1. **注册DCloud开发者账号**
   - 访问：https://dev.dcloud.net.cn/
   - 注册并登录

2. **上传项目**
   - 在开发者中心创建应用
   - 上传项目代码到DCloud
   - 或使用HBuilderX关联账号后直接云打包

3. **配置并打包**
   - 在开发者中心配置App信息
   - 选择Android平台
   - 点击云打包
   - 下载生成的APK

---

## 已配置的原生模块

manifest.json 中已配置以下原生模块：

| 模块        | 用途              |
| ----------- | ----------------- |
| SQLite      | 本地数据库存储    |
| Fingerprint | 生物识别认证      |
| Camera      | 相机拍照和扫码    |
| Record      | 语音录制          |
| Barcode     | 条形码/二维码扫描 |
| Push        | 推送通知          |
| VideoPlayer | 视频播放          |
| LivePusher  | 直播推流          |

## 已配置的Android权限

| 权限                   | 用途              |
| ---------------------- | ----------------- |
| INTERNET               | 网络访问          |
| ACCESS_NETWORK_STATE   | 网络状态检测      |
| ACCESS_WIFI_STATE      | WiFi状态检测      |
| CHANGE_NETWORK_STATE   | 网络切换          |
| CHANGE_WIFI_STATE      | WiFi切换          |
| READ_EXTERNAL_STORAGE  | 读取存储          |
| WRITE_EXTERNAL_STORAGE | 写入存储          |
| CAMERA                 | 相机              |
| RECORD_AUDIO           | 录音              |
| VIBRATE                | 振动              |
| USE_FINGERPRINT        | 指纹识别（旧API） |
| USE_BIOMETRIC          | 生物识别（新API） |
| WAKE_LOCK              | 保持唤醒          |
| RECEIVE_BOOT_COMPLETED | 开机启动          |
| FLASHLIGHT             | 闪光灯            |

## 预期APK体积

最终生成的APK预计体积：

| 组成部分                  | 大小        |
| ------------------------- | ----------- |
| uni-app 运行时            | ~8-10MB     |
| 应用代码 (app-service.js) | ~2MB        |
| 静态资源和样式            | ~1.5MB      |
| 原生SDK和插件             | ~8-10MB     |
| **总计**                  | **20-40MB** |

这是正常的体积范围，包含了完整的运行时和所有功能模块。

## 注意事项

1. **首次打包**: 推荐使用测试证书，正式发布前再配置自有证书
2. **应用权限**: manifest.json中已配置完整权限
3. **图标配置**: 需要确保`unpackage/res/icons/`目录下有对应尺寸的图标
4. **最低Android版本**: API 23 (Android 6.0)
5. **目标Android版本**: API 34 (Android 14)
6. **支持的CPU架构**: armeabi-v7a, arm64-v8a

## 常见问题

### Q: 云打包失败怎么办？

A: 检查manifest.json配置是否正确，确保AppID唯一，查看HBuilderX控制台的错误信息。

### Q: 安装APK时提示"未知来源"？

A: 这是正常的，在Android设置中允许安装未知来源应用即可。

### Q: 应用闪退怎么办？

A: 连接Android设备，使用`adb logcat`查看日志，或在HBuilderX中使用"真机运行"调试。

### Q: 需要配置哪些SDK？

A: 使用云打包无需本地SDK。使用本地打包需要Android SDK、Gradle等。

### Q: Sass警告如何处理？

A: 构建时的 Sass 弃用警告不影响功能，将在未来版本中使用新的 Sass API 消除。

### Q: 为什么打包只有几MB？

A: `dist/build/app-plus/` 中的 ~3.5MB 是编译后的资源文件（已压缩）。最终APK会包含uni-app运行时和原生SDK，预计20-40MB，这是正常的。

---

## 联系方式

如有问题，请查看：

- uni-app官方文档: https://uniapp.dcloud.net.cn/
- HBuilderX使用文档: https://hx.dcloud.net.cn/
