# 🔐 Android 签名配置完成总结

**实施日期**: 2026-02-05
**任务状态**: ✅ 配置完成
**版本**: v0.32.0

---

## 📋 已完成的配置

### 1. Gradle 构建配置 (100%)

**文件**: `app/build.gradle.kts`

#### ✅ 签名配置实现（第 43-65 行）

```kotlin
signingConfigs {
    create("release") {
        // 从 keystore.properties 读取签名配置
        val keystorePropertiesFile = rootProject.file("keystore.properties")
        if (keystorePropertiesFile.exists()) {
            val keystoreProperties = Properties()
            keystoreProperties.load(FileInputStream(keystorePropertiesFile))

            storeFile = file(keystoreProperties["release.storeFile"] as String)
            storePassword = keystoreProperties["release.storePassword"] as String
            keyAlias = keystoreProperties["release.keyAlias"] as String
            keyPassword = keystoreProperties["release.keyPassword"] as String
        } else {
            // 如果配置文件不存在，使用debug密钥（仅用于开发测试）
            logger.warn("keystore.properties not found. Using debug keystore for release build.")
            storeFile = file("../keystore/debug.keystore")
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
        }
    }
}
```

**特性**：

- ✅ 外部化配置（不在代码中硬编码密码）
- ✅ 优雅降级（配置文件不存在时使用 debug keystore）
- ✅ 警告提示（提醒用户创建正式配置）

---

### 2. 模板文件 (100%)

**文件**: `keystore.properties.template`

```properties
# Keystore Configuration Template
# 复制此文件为 keystore.properties 并填入真实签名配置

# Release签名配置
release.storeFile=../keystore/release.keystore
release.storePassword=your_store_password_here
release.keyAlias=your_key_alias_here
release.keyPassword=your_key_password_here

# 如何生成正式签名密钥：
# keytool -genkey -v -keystore release.keystore -alias your_alias -keyalg RSA -keysize 2048 -validity 10000
```

**用途**：用户复制此文件为 `keystore.properties` 并填入真实密码

---

### 3. Git 安全配置 (100%)

**文件**: `.gitignore`（第 36-39 行）

```gitignore
# Keystore files
*.jks
*.keystore
keystore.properties
```

**安全性**：

- ✅ 排除所有 keystore 文件（`*.jks`, `*.keystore`）
- ✅ 排除配置文件（`keystore.properties`）
- ✅ 防止敏感密钥泄露到版本控制

---

### 4. 文档系统 (100%)

#### 中文快速指南

**文件**: `KEYSTORE_SETUP.md`（176 行）

内容包括：

- ✅ 快速开始（3步配置流程）
- ✅ 生成正式签名密钥（keytool 命令）
- ✅ 开发环境快速配置（使用 debug keystore）
- ✅ CI/CD 配置（GitHub Actions Secrets）
- ✅ 常见问题（密码丢失、密钥信息查看、备份）
- ✅ 安全最佳实践（7条规则）

#### 英文完整指南

**文件**: `docs/build-deployment/ANDROID_SIGNING_SETUP.md`（589 行）

内容包括：

- ✅ 前置要求（Java JDK, keytool）
- ✅ 生成 Release Keystore（详细步骤）
- ✅ GitHub Secrets 配置（Base64 编码）
- ✅ 本地验证（环境变量、gradle.properties）
- ✅ CI/CD 验证（GitHub Actions 测试）
- ✅ 安全最佳实践（密码管理、备份策略）
- ✅ 故障排除（5个常见问题）
- ✅ 高级配置（Play App Signing、多构建变体）
- ✅ 快速参考（命令速查）

---

### 5. 目录结构

```
android-app/
├── keystore/
│   └── debug.keystore              # Debug 密钥（已存在）
│   # release.keystore 需用户手动生成
├── keystore.properties.template    # 配置模板（✅ 已创建）
├── keystore.properties             # 实际配置（需用户创建，已被 .gitignore 排除）
├── KEYSTORE_SETUP.md               # 中文快速指南（✅ 已创建）
├── docs/build-deployment/
│   └── ANDROID_SIGNING_SETUP.md    # 英文完整指南（✅ 已创建）
├── .gitignore                      # 安全配置（✅ 已配置）
└── app/build.gradle.kts            # 签名配置（✅ 已实现）
```

---

## 🎯 用户操作指南

### 开发阶段（使用 Debug Keystore）

**无需配置**，构建系统会自动回退到 debug keystore：

```bash
cd android-app
./gradlew assembleRelease  # 使用 debug keystore
```

**警告提示**：

```
> keystore.properties not found. Using debug keystore for release build.
> Please create keystore.properties from keystore.properties.template for production builds.
```

---

### 生产发布（使用正式 Keystore）

#### 步骤 1: 生成 Release Keystore

```bash
cd android-app/keystore
keytool -genkey -v -keystore release.keystore \
  -alias chainlesschain_release \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000
```

**输入信息**：

- 密钥库密码（storePassword）- 建议 16 位以上强密码
- 密钥密码（keyPassword）- 可与密钥库密码相同
- 组织信息（CN, OU, O, L, ST, C）

#### 步骤 2: 创建配置文件

```bash
cd android-app
cp keystore.properties.template keystore.properties
```

编辑 `keystore.properties`：

```properties
release.storeFile=../keystore/release.keystore
release.storePassword=你的实际密钥库密码
release.keyAlias=chainlesschain_release
release.keyPassword=你的实际密钥密码
```

#### 步骤 3: 构建 Release 版本

```bash
./gradlew assembleRelease  # 生成 APK
./gradlew bundleRelease    # 生成 AAB (Google Play)
```

#### 步骤 4: 验证签名

```bash
jarsigner -verify -verbose -certs app/build/outputs/apk/release/app-release.apk
# 应显示: jar verified.
```

---

## 🔒 安全要点

### ✅ 必须做的

1. **妥善保管**：将 release.keystore 和密码存放在安全位置
2. **多地备份**：至少 3 个备份（云存储加密、U盘、密码管理器）
3. **不要提交**：确保 keystore.properties 和 \*.keystore 被 .gitignore 排除
4. **强密码**：使用 16 位以上随机密码
5. **定期审计**：检查密钥有效期（10000 天约 27 年）

### ❌ 不要做的

1. ❌ 不要将 keystore 文件提交到版本控制（已被 .gitignore 排除）
2. ❌ 不要在代码、日志、文档中明文记录密码
3. ❌ 不要使用弱密码（"password", "123456" 等）
4. ❌ 不要丢失 keystore 文件（无法恢复，无法更新已发布应用）
5. ❌ 不要在生产环境使用 debug keystore

---

## 📊 CI/CD 配置（GitHub Actions）

### GitHub Secrets 设置

在仓库设置中添加以下 Secrets（`Settings → Secrets → Actions`）：

| Secret 名称         | 说明          | 获取方式                                                 |
| ------------------- | ------------- | -------------------------------------------------------- |
| `KEYSTORE_BASE64`   | Base64 编码的 | `base64 -i release.keystore -o keystore.base64`          |
| `KEYSTORE_PASSWORD` | 密钥库密码    | 创建 keystore 时设置的 storePassword                     |
| `KEY_ALIAS`         | 密钥别名      | `chainlesschain_release`                                 |
| `KEY_PASSWORD`      | 密钥密码      | 创建 keystore 时设置的 keyPassword（可与密钥库密码相同） |

### Workflow 示例

```yaml
# .github/workflows/release.yml
- name: Decode Keystore
  run: |
    echo "${{ secrets.KEYSTORE_BASE64 }}" | base64 -d > android-app/keystore.jks

- name: Create keystore.properties
  run: |
    cat > android-app/keystore.properties <<EOF
    release.storeFile=../keystore.jks
    release.storePassword=${{ secrets.KEYSTORE_PASSWORD }}
    release.keyAlias=${{ secrets.KEY_ALIAS }}
    release.keyPassword=${{ secrets.KEY_PASSWORD }}
    EOF

- name: Build Release
  run: cd android-app && ./gradlew bundleRelease

- name: Clean up
  if: always()
  run: |
    rm -f android-app/keystore.jks
    rm -f android-app/keystore.properties
```

---

## 📝 常见问题

### Q1: 如何查看 keystore 信息？

```bash
keytool -list -v -keystore keystore/release.keystore -alias chainlesschain_release
```

### Q2: 忘记密码怎么办？

**密钥密码无法找回**。如果丢失：

- **开发阶段**：重新生成密钥
- **已发布应用**：无法更新，只能发布新的应用包名

**建议**：使用密码管理器（1Password、Bitwarden）保存密码

### Q3: 如何备份密钥？

```bash
# 1. 复制密钥文件
cp keystore/release.keystore ~/Backups/chainlesschain_release_$(date +%Y%m%d).keystore

# 2. 上传到云存储（加密文件夹）
# - Google Drive
# - Dropbox
# - 密码管理器附件

# 3. 硬件备份（加密 U 盘）
```

### Q4: keystore.properties 文件不存在时会怎样？

构建系统会自动回退到 debug keystore，并输出警告：

```
> keystore.properties not found. Using debug keystore for release build.
```

**仅用于开发测试**，生产环境必须配置正式 keystore。

---

## ✅ 验证清单

### 开发环境

- [ ] `keystore.properties.template` 文件存在
- [ ] `.gitignore` 已排除 `*.keystore` 和 `keystore.properties`
- [ ] `app/build.gradle.kts` 签名配置正确
- [ ] `keystore/debug.keystore` 存在
- [ ] 文档 `KEYSTORE_SETUP.md` 和 `ANDROID_SIGNING_SETUP.md` 存在

### 生产发布

- [ ] 已生成 `keystore/release.keystore`
- [ ] 已创建 `keystore.properties` 并填入真实密码
- [ ] 密钥密码已保存到密码管理器
- [ ] keystore 文件已备份到 3 个安全位置
- [ ] `git status` 确认 keystore 文件未被追踪
- [ ] Release APK 签名验证通过（`jarsigner -verify`）

### CI/CD

- [ ] GitHub Secrets 已配置（`KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD`）
- [ ] Workflow 可成功解码 keystore
- [ ] Workflow 自动清理敏感文件
- [ ] CI 构建的 APK 签名验证通过

---

## 🚀 下一步

1. **开发阶段**：
   - ✅ 配置已完成，可直接使用 debug keystore 进行开发测试
   - `./gradlew assembleRelease` 会自动使用 debug keystore

2. **准备发布时**：
   - 参考 `KEYSTORE_SETUP.md` 生成正式 release.keystore
   - 创建 `keystore.properties` 配置文件
   - 备份密钥文件和密码

3. **CI/CD 集成**：
   - 参考 `docs/build-deployment/ANDROID_SIGNING_SETUP.md` 配置 GitHub Secrets
   - 测试自动化构建流程

---

## 📖 参考文档

- **快速开始**: `KEYSTORE_SETUP.md`
- **完整指南**: `docs/build-deployment/ANDROID_SIGNING_SETUP.md`
- **Android 官方文档**: https://developer.android.com/studio/publish/app-signing
- **keytool 命令**: https://docs.oracle.com/javase/8/docs/technotes/tools/unix/keytool.html

---

**文档版本**: 1.0
**最后更新**: 2026-02-05
**状态**: ✅ 配置完成，待用户生成正式密钥
