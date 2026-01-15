# ChainlessChain iOS 打包指南

本文档提供 ChainlessChain 移动端 iOS 应用的完整打包流程。

## 前置要求

### 必备条件

1. **Apple 开发者账号**
   - 个人开发者账号（$99/年）或企业账号（$299/年）
   - 已注册并激活：https://developer.apple.com

2. **开发环境**（三选一）
   - **方式一：HBuilderX IDE**（推荐，最简单）
   - **方式二：macOS + Xcode**（本地打包）
   - **方式三：uni-app CLI 云打包**

3. **证书和配置文件**
   - iOS 开发证书（Development Certificate）
   - iOS 发布证书（Distribution Certificate）
   - App ID
   - Provisioning Profile（开发和发布配置文件）

---

## 打包前准备

### 1. 准备应用图标

iOS 应用需要多个尺寸的图标。创建以下目录和文件：

```bash
cd mobile-app-uniapp
mkdir -p unpackage/res/icons
```

#### 所需图标尺寸

**iPhone 图标**:
- 120x120 (app@2x)
- 180x180 (app@3x)
- 40x40 (notification@2x)
- 60x60 (notification@3x)
- 58x58 (settings@2x)
- 87x87 (settings@3x)
- 80x80 (spotlight@2x)
- 120x120 (spotlight@3x)

**iPad 图标**:
- 76x76 (app)
- 152x152 (app@2x)
- 167x167 (proapp@2x)
- 20x20 (notification)
- 40x40 (notification@2x, spotlight)
- 80x80 (spotlight@2x)
- 29x29 (settings)
- 58x58 (settings@2x)

**App Store**:
- 1024x1024 (appstore)

**提示**: 可以使用在线工具（如 AppIcon.co）从单个 1024x1024 的图标生成所有尺寸。

### 2. 更新 manifest.json 配置

确保 `src/manifest.json` 中的 iOS 配置正确：

```json
{
  "name": "ChainlessChain",
  "appid": "__UNI__4F3B0DC",
  "description": "去中心化个人AI助手平台",
  "versionName": "0.3.0",
  "versionCode": "300",
  "app-plus": {
    "distribute": {
      "ios": {
        "dSYMs": false,
        "privacyDescription": {
          "NSPhotoLibraryUsageDescription": "需要访问相册以上传图片",
          "NSPhotoLibraryAddUsageDescription": "需要保存图片到相册",
          "NSCameraUsageDescription": "需要使用相机拍照或扫描二维码",
          "NSMicrophoneUsageDescription": "需要使用麦克风进行语音输入",
          "NSLocationWhenInUseUsageDescription": "需要获取位置信息以提供更好的服务"
        },
        "capabilities": {
          "entitlements": {
            "com.apple.developer.associated-domains": [
              "applinks:chainlesschain.com"
            ]
          }
        }
      }
    }
  }
}
```

### 3. 检查依赖安装

```bash
cd mobile-app-uniapp
npm install
```

---

## 打包方式

### 方式一：HBuilderX 云打包（推荐）

这是最简单的方式，不需要 macOS 或 Xcode。

#### 步骤：

1. **下载并安装 HBuilderX**
   - 下载地址：https://www.dcloud.io/hbuilderx.html
   - 选择 "App 开发版"

2. **导入项目**
   - 打开 HBuilderX
   - 文件 → 导入 → 从本地目录导入
   - 选择 `mobile-app-uniapp` 目录

3. **配置 iOS 证书**
   - 发行 → 原生App-云打包 → 使用苹果证书
   - 选择 "使用已有证书"
   - 上传以下文件：
     - iOS 发布证书（.p12 文件）
     - Provisioning Profile（.mobileprovision 文件）
   - 输入证书密码

4. **开始打包**
   - 发行 → 原生App-云打包
   - 选择 iOS 平台
   - 选择打包方式：
     - **开发版**：用于测试（需要开发证书）
     - **测试版**：用于 TestFlight（需要 Ad Hoc 证书）
     - **发布版**：用于 App Store（需要发布证书）
   - 点击"打包"

5. **下载安装包**
   - 打包完成后会生成 `.ipa` 文件
   - 下载到本地
   - 位置：`unpackage/release/ios/`

#### 云打包费用
- DCloud 会员：免费
- 非会员：限制打包次数，需购买云打包点数

---

### 方式二：本地打包（需要 macOS）

需要 macOS 系统和 Xcode。

#### 步骤：

1. **安装 Xcode**
   - 从 App Store 安装最新版 Xcode
   - 安装 Command Line Tools：
     ```bash
     xcode-select --install
     ```

2. **生成 iOS 项目**
   ```bash
   cd mobile-app-uniapp
   npm run build:app
   ```

3. **在 HBuilderX 中生成 iOS 离线打包资源**
   - 发行 → 原生App-本地打包 → 生成本地打包App资源
   - 选择 iOS 平台
   - 生成位置：`unpackage/resources/`

4. **集成到 Xcode 项目**

   如果没有 Xcode 项目模板，下载 uni-app 离线打包 SDK：
   - 下载地址：https://nativesupport.dcloud.net.cn/AppDocs/download/ios
   - 解压后找到 `HBuilder-uniPluginDemo` 项目

   将生成的资源复制到 Xcode 项目：
   ```bash
   # 复制资源到 Xcode 项目的 Pandora/apps/__UNI__4F3B0DC/www 目录
   cp -r unpackage/resources/__UNI__4F3B0DC/* /path/to/HBuilder-uniPluginDemo/HBuilder-uniPluginDemo/Pandora/apps/__UNI__4F3B0DC/www/
   ```

5. **配置 Xcode 项目**
   - 打开 `HBuilder-uniPluginDemo.xcworkspace`
   - 设置 Bundle Identifier（与 App ID 一致）
   - 设置 Team（选择你的开发者账号）
   - 配置签名证书和 Provisioning Profile

6. **构建和打包**
   - 选择目标设备（Generic iOS Device）
   - Product → Archive
   - 归档完成后，选择 Distribute App
   - 选择发布方式：
     - **App Store Connect**: 上传到 App Store
     - **Ad Hoc**: 测试版，需要添加设备 UDID
     - **Enterprise**: 企业内部分发
     - **Development**: 开发版

7. **导出 IPA**
   - 按照向导完成导出
   - IPA 文件保存到指定位置

---

### 方式三：uni-app CLI 云打包

使用命令行工具进行云打包。

#### 步骤：

1. **安装 uni-app CLI**
   ```bash
   npm install -g @dcloudio/uvm
   uvm install
   ```

2. **登录 DCloud 账号**
   ```bash
   npx uniCloud login
   ```

3. **配置证书**

   在 `mobile-app-uniapp` 目录下创建 `ios-cert` 目录：
   ```bash
   mkdir ios-cert
   ```

   放入以下文件：
   - `ios_distribution.p12` (发布证书)
   - `ios_distribution.mobileprovision` (配置文件)

4. **执行打包命令**
   ```bash
   cd mobile-app-uniapp
   npx uniCloud app publish \
     --platform ios \
     --type release \
     --cert ios-cert/ios_distribution.p12 \
     --password "证书密码" \
     --provision ios-cert/ios_distribution.mobileprovision
   ```

5. **等待打包完成**
   - 打包过程需要 5-15 分钟
   - 完成后 IPA 文件在 `unpackage/release/ios/` 目录

---

## Apple 证书配置详解

### 1. 创建 App ID

1. 访问 [Apple Developer](https://developer.apple.com/account/)
2. Certificates, Identifiers & Profiles → Identifiers
3. 点击 "+" 创建新的 App ID
4. 选择 "App IDs" → "App"
5. 填写信息：
   - **Description**: ChainlessChain
   - **Bundle ID**: `com.chainlesschain.mobile`（显式 App ID）
6. 选择 Capabilities（根据需要）：
   - Push Notifications（推送通知）
   - Associated Domains（深度链接）
   - iCloud（云存储）
7. 注册

### 2. 创建证书

#### 开发证书（Development Certificate）

1. Certificates → "+" → "iOS App Development"
2. 在 Mac 上生成证书请求（CSR）：
   - 打开"钥匙串访问" (Keychain Access)
   - 钥匙串访问 → 证书助理 → 从证书颁发机构请求证书
   - 填写邮箱，选择"存储到磁盘"
   - 保存 `.certSigningRequest` 文件
3. 上传 CSR 文件
4. 下载证书（.cer 文件）
5. 双击安装到钥匙串

#### 发布证书（Distribution Certificate）

1. Certificates → "+" → "iOS Distribution"
2. 同样生成并上传 CSR
3. 下载并安装证书

### 3. 导出 P12 文件

1. 打开"钥匙串访问"
2. 找到安装的证书
3. 右键 → 导出项目
4. 选择 `.p12` 格式
5. 设置密码并保存

### 4. 创建 Provisioning Profile

#### 开发配置文件

1. Profiles → "+" → "iOS App Development"
2. 选择之前创建的 App ID
3. 选择开发证书
4. 选择测试设备（添加设备的 UDID）
5. 命名并生成
6. 下载 `.mobileprovision` 文件

#### 发布配置文件（App Store）

1. Profiles → "+" → "App Store"
2. 选择 App ID
3. 选择发布证书
4. 命名并生成
5. 下载文件

---

## 测试和发布

### 1. 安装测试

#### Ad Hoc 方式（内部测试）

1. 使用 Ad Hoc 配置文件打包
2. 添加测试设备的 UDID 到开发者账号
3. 通过以下方式分发：
   - iTunes 安装
   - TestFlight（推荐）
   - 第三方工具（蒲公英、fir.im）

#### TestFlight（推荐）

1. 使用 App Store 配置文件打包
2. 上传到 App Store Connect
3. 在 TestFlight 中添加测试人员
4. 测试人员通过 TestFlight App 安装

### 2. 上传到 App Store

#### 使用 Xcode

1. Archive 后选择 "Distribute App"
2. 选择 "App Store Connect"
3. 上传到 Apple 服务器

#### 使用 Transporter（推荐）

1. 从 App Store 下载 Transporter
2. 打开并登录 Apple ID
3. 拖拽 IPA 文件到 Transporter
4. 点击 "交付"

### 3. App Store Connect 配置

1. 访问 [App Store Connect](https://appstoreconnect.apple.com/)
2. 我的 App → "+" → 新建 App
3. 填写 App 信息：
   - **名称**: ChainlessChain
   - **主要语言**: 中文（简体）
   - **Bundle ID**: 选择之前创建的
   - **SKU**: `CHAINLESSCHAIN001`
4. 填写 App 详情：
   - 截图（至少3张，多个尺寸）
   - 描述
   - 关键词
   - 技术支持 URL
   - 营销 URL
   - 隐私政策 URL
5. 选择上传的构建版本
6. 提交审核

### 4. 审核注意事项

- **隐私说明**: 必须说明为什么需要相机、相册、麦克风等权限
- **测试账号**: 如果需要登录，提供测试账号
- **演示视频**: 复杂功能建议提供演示
- **内容审核**: 确保无违规内容（成人内容、赌博、暴力等）
- **首次审核**: 通常需要 1-3 天
- **更新审核**: 通常更快，1-2 天

---

## 常见问题

### Q1: 打包失败，提示证书无效

**解决方法**:
- 检查证书是否过期
- 确认 Bundle ID 与 App ID 一致
- 重新下载 Provisioning Profile
- 清理 Xcode 派生数据：`rm -rf ~/Library/Developer/Xcode/DerivedData/*`

### Q2: 无法安装到真机

**解决方法**:
- 确认设备 UDID 已添加到配置文件
- 检查配置文件类型（Development/Ad Hoc）
- 设备信任开发者证书

### Q3: 上传 IPA 到 App Store 失败

**解决方法**:
- 使用最新版 Xcode 或 Transporter
- 检查 App Store Connect 中是否已创建 App
- 确认 Bundle ID 一致
- 查看详细错误信息

### Q4: TestFlight 无法安装

**解决方法**:
- 确认测试人员已接受邀请
- 检查构建版本状态（处理中/可供测试）
- 更新 TestFlight App 到最新版

### Q5: 审核被拒

**常见原因**:
- 缺少隐私政策
- 未说明权限用途
- Crash 或严重 Bug
- 违反 App Store 审核指南

**处理方式**:
- 阅读拒绝原因
- 修复问题
- 在"解决方案中心"回复
- 重新提交审核

---

## 快速打包命令总结

### 使用 HBuilderX 云打包
1. 导入项目到 HBuilderX
2. 发行 → 原生App-云打包
3. 配置证书，点击打包
4. 下载 IPA

### 使用 CLI 云打包
```bash
cd mobile-app-uniapp
npx uniCloud app publish --platform ios --type release
```

### 本地打包（macOS）
```bash
cd mobile-app-uniapp
npm run build:app
# 在 HBuilderX 中生成离线资源
# 然后在 Xcode 中打包
```

---

## 相关资源

- **uni-app 官方文档**: https://uniapp.dcloud.net.cn/
- **iOS 离线打包**: https://nativesupport.dcloud.net.cn/AppDocs/usesdk/ios
- **Apple 开发者中心**: https://developer.apple.com/
- **App Store Connect**: https://appstoreconnect.apple.com/
- **TestFlight**: https://testflight.apple.com/

---

## 附录：图标生成脚本

如果你有 1024x1024 的原始图标，可以使用以下脚本批量生成所需尺寸（需要安装 ImageMagick）：

```bash
#!/bin/bash

# 安装 ImageMagick: brew install imagemagick

SOURCE="assets/logo.png"
OUTPUT_DIR="unpackage/res/icons"

mkdir -p $OUTPUT_DIR

# iPhone 图标
convert $SOURCE -resize 120x120 $OUTPUT_DIR/120x120.png
convert $SOURCE -resize 180x180 $OUTPUT_DIR/180x180.png
convert $SOURCE -resize 40x40 $OUTPUT_DIR/40x40.png
convert $SOURCE -resize 60x60 $OUTPUT_DIR/60x60.png
convert $SOURCE -resize 58x58 $OUTPUT_DIR/58x58.png
convert $SOURCE -resize 87x87 $OUTPUT_DIR/87x87.png
convert $SOURCE -resize 80x80 $OUTPUT_DIR/80x80.png

# iPad 图标
convert $SOURCE -resize 76x76 $OUTPUT_DIR/76x76.png
convert $SOURCE -resize 152x152 $OUTPUT_DIR/152x152.png
convert $SOURCE -resize 167x167 $OUTPUT_DIR/167x167.png
convert $SOURCE -resize 20x20 $OUTPUT_DIR/20x20.png
convert $SOURCE -resize 29x29 $OUTPUT_DIR/29x29.png

# App Store
convert $SOURCE -resize 1024x1024 $OUTPUT_DIR/1024x1024.png

# Android 图标（顺便生成）
convert $SOURCE -resize 192x192 $OUTPUT_DIR/192x192.png
convert $SOURCE -resize 144x144 $OUTPUT_DIR/144x144.png
convert $SOURCE -resize 96x96 $OUTPUT_DIR/96x96.png
convert $SOURCE -resize 72x72 $OUTPUT_DIR/72x72.png

echo "图标生成完成！"
```

保存为 `generate-icons.sh`，然后执行：

```bash
chmod +x generate-icons.sh
./generate-icons.sh
```

---

**祝你打包顺利！如有问题，请查阅 uni-app 官方文档或联系技术支持。**
