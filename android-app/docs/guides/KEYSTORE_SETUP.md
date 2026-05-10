# 🔐 Android 签名密钥配置指南

## 概述

从 v0.32.0 开始，ChainlessChain Android 应用使用外部化签名配置，不再硬编码敏感密钥信息。

## 快速开始

### 1. 创建签名配置文件

```bash
cd android-app
cp keystore.properties.template keystore.properties
```

### 2. 生成正式签名密钥（首次配置）

```bash
cd keystore
keytool -genkey -v -keystore release.keystore \
  -alias chainlesschain_release \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000

# 按提示输入：
# - 密钥库密码 (storePassword)
# - 密钥密码 (keyPassword)
# - 组织信息（CN, OU, O, L, ST, C）
```

**重要提示**:

- 密钥有效期 10000 天（约27年）
- 妥善保管密钥文件和密码，丢失将无法更新已发布的应用
- 将 `release.keystore` 存放在安全位置，不要提交到版本控制

### 3. 配置 keystore.properties

编辑 `android-app/keystore.properties`，填入真实配置（路径由 `build.gradle.kts`
里 `rootProject.file()` 从 `android-app/` 起解析，所以 **不要加 `../` 前缀**，否则
会跑到 repo 根目录之外，build 时报 "Keystore not found"）：

```properties
release.storeFile=keystore/release.keystore
release.storePassword=your_actual_store_password
release.keyAlias=chainlesschain_release
release.keyPassword=your_actual_key_password
```

### 4. 构建 Release 版本

```bash
cd android-app
./gradlew assembleRelease  # 生成 APK
./gradlew bundleRelease    # 生成 AAB (Google Play)
```

## 开发环境快速配置

如果仅用于开发测试，可以使用 debug 密钥：

```properties
# keystore.properties (仅开发环境)
release.storeFile=keystore/debug.keystore
release.storePassword=android
release.keyAlias=androiddebugkey
release.keyPassword=android
```

**⚠️ 警告**: Debug 密钥**不能**用于生产发布，否则：

- 无法上传到 Google Play Store
- 用户无法安装更新（签名不匹配）
- 存在安全风险

## 文件安全

### 已忽略的敏感文件

`.gitignore` 已配置排除以下文件：

```gitignore
*.jks
*.keystore
keystore.properties
```

### 验证配置

```bash
# 确认 keystore.properties 未被追踪
git status

# 应该看到：
# nothing to commit, working tree clean
```

## CI/CD 配置

### GitHub Actions

在仓库设置中添加 Secrets：

- `KEYSTORE_FILE` - Base64 编码的 keystore 文件
- `KEYSTORE_PASSWORD` - 密钥库密码
- `KEY_ALIAS` - 密钥别名
- `KEY_PASSWORD` - 密钥密码

示例工作流：

```yaml
- name: Decode Keystore
  working-directory: android-app
  run: |
    mkdir -p keystore
    echo "${{ secrets.KEYSTORE_FILE }}" | base64 -d > keystore/release.keystore

- name: Create keystore.properties
  working-directory: android-app
  run: |
    cat > keystore.properties <<EOF
    release.storeFile=keystore/release.keystore
    release.storePassword=${{ secrets.KEYSTORE_PASSWORD }}
    release.keyAlias=${{ secrets.KEY_ALIAS }}
    release.keyPassword=${{ secrets.KEY_PASSWORD }}
    EOF

- name: Build Release
  working-directory: android-app
  run: ./gradlew bundleRelease
```

## 常见问题

### Q: keystore.properties 文件不存在时会怎样？

A: 构建系统会自动回退到 debug 密钥，并输出警告：

```
> keystore.properties not found. Using debug keystore for release build.
> Please create keystore.properties from keystore.properties.template for production builds.
```

### Q: 如何查看密钥信息？

```bash
keytool -list -v -keystore keystore/release.keystore -alias chainlesschain_release
```

### Q: 忘记密钥密码怎么办？

A: 密钥密码**无法找回**。如果丢失：

- 开发阶段：重新生成密钥
- 已发布应用：无法更新，只能发布新的应用包名

### Q: 如何备份密钥？

```bash
# 1. 复制密钥文件到安全位置
cp keystore/release.keystore ~/Documents/Backups/chainlesschain_release_$(date +%Y%m%d).keystore

# 2. 加密保存密码（推荐使用密码管理器）
# - storePassword
# - keyPassword

# 3. 异地备份（云存储、U盘等）
```

## 安全最佳实践

1. ✅ **不要**将 `keystore.properties` 和 `*.keystore` 文件提交到版本控制
2. ✅ **不要**在代码、日志、文档中明文记录密码
3. ✅ **不要**使用弱密码（建议16位以上随机字符）
4. ✅ **定期**备份密钥文件和密码
5. ✅ **限制**密钥文件的访问权限（仅开发者）
6. ✅ **使用**密码管理器（如 1Password、Bitwarden）
7. ✅ **考虑**使用硬件密钥存储（如 HSM）

## 参考文档

- [Android 应用签名官方文档](https://developer.android.com/studio/publish/app-signing)
- [保护您的应用签名密钥](https://developer.android.com/studio/publish/app-signing#secure-key)
- [keytool 命令参考](https://docs.oracle.com/javase/8/docs/technotes/tools/unix/keytool.html)
