# 🔐 ChainlessChain 代码签名配置指南

本指南详细说明如何为 Windows 和 macOS 配置代码签名，确保用户下载的应用安全可信。

---

## 📋 目录

- [为什么需要代码签名](#为什么需要代码签名)
- [Windows 代码签名](#windows-代码签名)
- [macOS 代码签名](#macos-代码签名)
- [GitHub Actions 配置](#github-actions-配置)
- [本地签名测试](#本地签名测试)
- [故障排除](#故障排除)

---

## 为什么需要代码签名

### 用户体验

**未签名的应用**：
- ❌ Windows SmartScreen 警告："Windows 已保护您的电脑"
- ❌ macOS Gatekeeper 警告："无法打开，因为它来自身份不明的开发者"
- ❌ 用户需要手动绕过安全警告

**已签名的应用**：
- ✅ 直接安装，无警告
- ✅ 显示开发者身份
- ✅ 增强用户信任

### 安全性

- 🔒 验证应用来源
- 🔒 防止应用被篡改
- 🔒 建立开发者信誉

---

## Windows 代码签名

### 步骤 1: 获取代码签名证书

#### 选项 A: EV 代码签名证书（推荐）

**优势**：
- ✅ 立即建立信誉，无 SmartScreen 警告
- ✅ 最高级别的信任
- ✅ 适合商业应用

**购买渠道**：
- [DigiCert](https://www.digicert.com/signing/code-signing-certificates) - $474/年
- [Sectigo](https://sectigo.com/ssl-certificates-tls/code-signing) - $474/年
- [GlobalSign](https://www.globalsign.com/en/code-signing-certificate) - $599/年

**硬件要求**：
- USB Token（硬件安全模块）用于存储私钥
- Windows 10/11 机器用于签名

#### 选项 B: 标准代码签名证书

**特点**：
- ⚠️ 初期会有 SmartScreen 警告（需要积累信誉）
- ⚠️ 通常需要 3-6 个月和足够下载量才能消除警告
- ✅ 价格较低

**购买渠道**：
- [Certum Open Source Code Signing](https://shop.certum.eu/data-safety/code-signing-certificates/certum-open-source-code-sigining.html) - $86/年（开源项目）
- [Comodo](https://comodosslstore.com/code-signing) - $74/年
- [K Software](https://ksoftware.net/) - $84/年

### 步骤 2: 导出证书（PFX 格式）

使用 EV 证书时，需要从 USB Token 导出：

```powershell
# 1. 插入 USB Token
# 2. 打开证书管理器
certmgr.msc

# 3. 找到证书：个人 > 证书 > 找到你的证书
# 4. 右键 > 所有任务 > 导出
# 5. 选择"是，导出私钥"
# 6. 格式：Personal Information Exchange (.PFX)
# 7. 密码：设置强密码（至少12位，包含大小写字母、数字、符号）
# 8. 保存为：ChainlessChain_CodeSigning.pfx
```

### 步骤 3: 转换为 Base64（用于 GitHub Secrets）

```powershell
# 转换 PFX 为 Base64
$pfxPath = "C:\path\to\ChainlessChain_CodeSigning.pfx"
$bytes = [System.IO.File]::ReadAllBytes($pfxPath)
$base64 = [System.Convert]::ToBase64String($bytes)
$base64 | Out-File -FilePath "certificate_base64.txt"

# 输出的 certificate_base64.txt 内容将用于 GitHub Secret
```

### 步骤 4: 配置 GitHub Secrets

前往仓库设置：`Settings > Secrets and variables > Actions > New repository secret`

添加以下 secrets：

| Secret Name | Value | 说明 |
|-------------|-------|------|
| `WINDOWS_CERTIFICATE_BASE64` | Base64 证书内容 | 从 certificate_base64.txt 复制 |
| `WINDOWS_CERTIFICATE_PASSWORD` | 证书密码 | PFX 文件的密码 |

### 步骤 5: 验证签名

构建完成后，验证签名：

```powershell
# 使用 signtool 验证
signtool verify /pa /v "ChainlessChain-Setup.exe"

# 预期输出：
# Successfully verified: ChainlessChain-Setup.exe
# Signing Certificate Chain:
#     Issued to: ChainlessChain Team
#     Issued by: DigiCert SHA2 Assured ID Code Signing CA
```

---

## macOS 代码签名

### 步骤 1: 加入 Apple Developer Program

**费用**: $99/年

**注册地址**: https://developer.apple.com/programs/enroll/

### 步骤 2: 创建证书

#### 在本地 Mac 上创建证书签名请求 (CSR)

```bash
# 1. 打开"钥匙串访问" (Keychain Access)
# 2. 菜单：钥匙串访问 > 证书助理 > 从证书颁发机构请求证书
# 3. 填写信息：
#    - 用户电子邮件地址：your@email.com
#    - 常用名称：ChainlessChain Team
#    - 请求：保存到磁盘
# 4. 保存为：CertificateSigningRequest.certSigningRequest
```

#### 在 Apple Developer Portal 创建证书

1. 登录 [Apple Developer Portal](https://developer.apple.com/account/resources/certificates/list)
2. 点击 "Certificates" > "+" 创建新证书
3. 选择 "Developer ID Application"（用于在 Mac App Store 外分发）
4. 上传刚才创建的 CSR 文件
5. 下载证书：`developerID_application.cer`

#### 导入证书到钥匙串

```bash
# 双击下载的 .cer 文件导入到"登录"钥匙串
# 或使用命令行：
security import developerID_application.cer -k ~/Library/Keychains/login.keychain
```

### 步骤 3: 创建 App-Specific Password

用于 Notarization（公证）：

1. 访问 [Apple ID 账户](https://appleid.apple.com/)
2. 登录
3. 安全 > App专用密码 > 生成密码
4. 名称：ChainlessChain CI/CD
5. 保存生成的密码（格式：xxxx-xxxx-xxxx-xxxx）

### 步骤 4: 导出证书和私钥（用于 CI/CD）

```bash
# 导出证书和私钥为 .p12 文件
security find-identity -v -p codesigning

# 找到你的 Developer ID Application 证书，记下 SHA-1 哈希
# 例如：1) 3E2A5B... "Developer ID Application: ChainlessChain Team (TEAM_ID)"

# 导出为 .p12
security export -t identities -f pkcs12 \
  -o ChainlessChain_macOS_CodeSigning.p12 \
  -k ~/Library/Keychains/login.keychain \
  -P "YOUR_STRONG_PASSWORD"

# 输入 macOS 登录密码确认
```

### 步骤 5: 转换为 Base64

```bash
# 转换 .p12 为 Base64
base64 -i ChainlessChain_macOS_CodeSigning.p12 -o certificate_base64.txt

# 或一行命令：
base64 ChainlessChain_macOS_CodeSigning.p12 | tr -d '\n' > certificate_base64.txt
```

### 步骤 6: 配置 GitHub Secrets

添加以下 secrets：

| Secret Name | Value | 说明 |
|-------------|-------|------|
| `MACOS_CERTIFICATE_BASE64` | Base64 证书内容 | 从 certificate_base64.txt 复制 |
| `MACOS_CERTIFICATE_PASSWORD` | P12 密码 | 导出时设置的密码 |
| `APPLE_ID` | Apple ID 邮箱 | 用于 notarization |
| `APPLE_APP_PASSWORD` | App专用密码 | 从 Apple ID 账户生成 |
| `APPLE_TEAM_ID` | Team ID | 在 developer.apple.com 查看 |

### 步骤 7: 获取 Team ID

```bash
# 方法1: 从证书查看
security find-identity -v -p codesigning
# 输出示例：
# Developer ID Application: ChainlessChain Team (ABC1234567)
#                                                 ^^^^^^^^^^
#                                                 Team ID

# 方法2: 从 Apple Developer Portal
# https://developer.apple.com/account/#/membership/
# 查看 "Team ID" 字段
```

### 步骤 8: 配置 Notarization

在 `desktop-app-vue/forge.config.js` 中配置：

```javascript
{
  name: '@electron-forge/maker-dmg',
  config: {
    name: 'ChainlessChain',
    icon: path.join(__dirname, 'assets', 'icon.icns'),
    format: 'ULFO',
    overwrite: true,
    // 添加 notarization 配置
    ...(process.env.APPLE_ID && {
      notarize: {
        tool: 'notarytool',
        appleId: process.env.APPLE_ID,
        appleIdPassword: process.env.APPLE_APP_PASSWORD,
        teamId: process.env.APPLE_TEAM_ID
      }
    })
  }
}
```

### 步骤 9: 验证签名和公证

```bash
# 验证签名
codesign --verify --deep --strict --verbose=2 ChainlessChain.app

# 检查签名信息
codesign -dv --verbose=4 ChainlessChain.app

# 验证公证状态
spctl -a -vvv -t install ChainlessChain.app

# 预期输出：
# ChainlessChain.app: accepted
# source=Notarized Developer ID
```

---

## GitHub Actions 配置

### Windows 签名配置

在 `.github/workflows/release.yml` 的 Windows job 中添加：

```yaml
- name: Setup Windows Code Signing
  if: ${{ env.WINDOWS_CERTIFICATE_BASE64 != '' }}
  env:
    WINDOWS_CERTIFICATE_BASE64: ${{ secrets.WINDOWS_CERTIFICATE_BASE64 }}
  run: |
    # 解码证书
    $cert_bytes = [Convert]::FromBase64String($env:WINDOWS_CERTIFICATE_BASE64)
    $cert_path = Join-Path $env:RUNNER_TEMP "cert.pfx"
    [IO.File]::WriteAllBytes($cert_path, $cert_bytes)

    # 导入证书到当前用户存储
    $password = ConvertTo-SecureString "${{ secrets.WINDOWS_CERTIFICATE_PASSWORD }}" -AsPlainText -Force
    Import-PfxCertificate -FilePath $cert_path -CertStoreLocation Cert:\CurrentUser\My -Password $password

    # 设置环境变量供 Electron Forge 使用
    echo "WINDOWS_CERTIFICATE_FILE=$cert_path" >> $env:GITHUB_ENV
    echo "WINDOWS_CERTIFICATE_PASSWORD=${{ secrets.WINDOWS_CERTIFICATE_PASSWORD }}" >> $env:GITHUB_ENV

- name: Package Windows with Signing
  working-directory: desktop-app-vue
  run: npm run make:win
  env:
    SKIP_BACKEND_CHECK: true
    WINDOWS_CERTIFICATE_FILE: ${{ env.WINDOWS_CERTIFICATE_FILE }}
    WINDOWS_CERTIFICATE_PASSWORD: ${{ secrets.WINDOWS_CERTIFICATE_PASSWORD }}
```

### macOS 签名配置

在 `.github/workflows/release.yml` 的 macOS job 中添加：

```yaml
- name: Setup macOS Code Signing
  if: ${{ secrets.MACOS_CERTIFICATE_BASE64 != '' }}
  env:
    MACOS_CERTIFICATE_BASE64: ${{ secrets.MACOS_CERTIFICATE_BASE64 }}
    MACOS_CERTIFICATE_PASSWORD: ${{ secrets.MACOS_CERTIFICATE_PASSWORD }}
  run: |
    # 创建临时钥匙串
    KEYCHAIN_PATH=$RUNNER_TEMP/app-signing.keychain-db
    KEYCHAIN_PASSWORD=$(openssl rand -base64 32)

    # 创建钥匙串
    security create-keychain -p "$KEYCHAIN_PASSWORD" $KEYCHAIN_PATH
    security set-keychain-settings -lut 21600 $KEYCHAIN_PATH
    security unlock-keychain -p "$KEYCHAIN_PASSWORD" $KEYCHAIN_PATH

    # 解码并导入证书
    CERT_PATH=$RUNNER_TEMP/certificate.p12
    echo "$MACOS_CERTIFICATE_BASE64" | base64 --decode > $CERT_PATH
    security import $CERT_PATH -P "$MACOS_CERTIFICATE_PASSWORD" -A -t cert -f pkcs12 -k $KEYCHAIN_PATH

    # 设置钥匙串搜索列表
    security list-keychain -d user -s $KEYCHAIN_PATH

    # 允许 codesign 使用证书
    security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KEYCHAIN_PASSWORD" $KEYCHAIN_PATH

- name: Package macOS with Signing
  working-directory: desktop-app-vue
  run: npm run make
  env:
    SKIP_BACKEND_CHECK: true
    APPLE_ID: ${{ secrets.APPLE_ID }}
    APPLE_APP_PASSWORD: ${{ secrets.APPLE_APP_PASSWORD }}
    APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
```

---

## 本地签名测试

### Windows 本地测试

```powershell
# 设置环境变量
$env:WINDOWS_CERTIFICATE_FILE = "C:\path\to\cert.pfx"
$env:WINDOWS_CERTIFICATE_PASSWORD = "your_password"

# 构建
cd desktop-app-vue
npm run make:win

# 验证签名
signtool verify /pa /v "out\make\squirrel.windows\x64\ChainlessChain-Setup.exe"
```

### macOS 本地测试

```bash
# 设置环境变量
export APPLE_ID="your@email.com"
export APPLE_APP_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="ABC1234567"

# 构建（会自动签名和公证）
cd desktop-app-vue
npm run make

# 验证
codesign --verify --deep --strict --verbose=2 "out/make/ChainlessChain.app"
spctl -a -vvv -t install "out/make/ChainlessChain.app"
```

---

## Forge Config 配置示例

### Windows 签名配置

```javascript
// desktop-app-vue/forge.config.js
const { execSync } = require('child_process');

// Windows 代码签名配置
const windowsSigningConfig = process.env.WINDOWS_CERTIFICATE_FILE
  ? {
      certificateFile: process.env.WINDOWS_CERTIFICATE_FILE,
      certificatePassword: process.env.WINDOWS_CERTIFICATE_PASSWORD
    }
  : {};

module.exports = {
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'chainlesschain',
        authors: 'ChainlessChain Team',
        description: 'ChainlessChain - 去中心化个人AI管理系统',
        setupIcon: path.join(__dirname, 'build', 'icon.ico'),
        ...windowsSigningConfig  // 添加签名配置
      }
    }
  ]
};
```

### macOS 签名配置

```javascript
// desktop-app-vue/forge.config.js
module.exports = {
  makers: [
    {
      name: '@electron-forge/maker-dmg',
      config: {
        name: 'ChainlessChain',
        icon: path.join(__dirname, 'assets', 'icon.icns'),
        format: 'ULFO',
        overwrite: true,
        // Notarization 配置
        ...(process.env.APPLE_ID && {
          notarize: {
            tool: 'notarytool',
            appleId: process.env.APPLE_ID,
            appleIdPassword: process.env.APPLE_APP_PASSWORD,
            teamId: process.env.APPLE_TEAM_ID
          }
        })
      }
    }
  ],

  // macOS 代码签名配置
  packagerConfig: {
    name: 'ChainlessChain',
    executableName: 'chainlesschain',
    icon: path.join(__dirname, 'assets', 'icon'),
    ...(process.env.APPLE_ID && {
      osxSign: {
        identity: 'Developer ID Application: ChainlessChain Team',
        'hardened-runtime': true,
        'gatekeeper-assess': false,
        entitlements: 'entitlements.plist',
        'entitlements-inherit': 'entitlements.plist',
        'signature-flags': 'library'
      }
    })
  }
};
```

---

## 故障排除

### Windows 常见问题

#### 问题 1: "证书导入失败"

```
错误: Import-PfxCertificate: Cannot find path
```

**解决方案**:
- 确保 Base64 编码正确，没有换行符
- 验证证书密码正确
- 检查证书文件完整性

#### 问题 2: "SmartScreen 仍然警告"

**原因**: 使用标准证书，需要积累信誉

**解决方案**:
- 升级到 EV 证书（立即消除警告）
- 持续发布（3-6个月后自动建立信誉）
- 申请 Microsoft SmartScreen 审查

#### 问题 3: "Timestamp 服务器超时"

```
错误: SignTool Error: The specified timestamp server either could not be reached
```

**解决方案**:
```powershell
# 使用备用时间戳服务器
signtool sign /f cert.pfx /p password /tr http://timestamp.digicert.com /td sha256 /fd sha256 app.exe
```

### macOS 常见问题

#### 问题 1: "codesign failed with error 1"

```
错误: errSecInternalComponent
```

**解决方案**:
```bash
# 解锁钥匙串
security unlock-keychain ~/Library/Keychains/login.keychain

# 允许 codesign 访问
security set-key-partition-list -S apple-tool:,apple: -s -k <keychain-password> ~/Library/Keychains/login.keychain
```

#### 问题 2: "Notarization 失败"

```
错误: The request UUID is invalid
```

**解决方案**:
- 验证 Apple ID 和 App专用密码正确
- 确保 Team ID 正确
- 检查 App Bundle ID 唯一且符合规范

#### 问题 3: "钥匙串访问被拒绝"

**解决方案**:
```bash
# 在 CI 环境中创建临时钥匙串
KEYCHAIN_PATH=$RUNNER_TEMP/app-signing.keychain-db
security create-keychain -p "" $KEYCHAIN_PATH
security default-keychain -s $KEYCHAIN_PATH
security unlock-keychain -p "" $KEYCHAIN_PATH
```

---

## 成本估算

### Windows

| 类型 | 价格 | 周期 | 推荐度 |
|------|------|------|--------|
| EV 证书 | $474 | 1年 | ⭐⭐⭐⭐⭐ |
| 标准证书 | $74-$86 | 1年 | ⭐⭐⭐ |
| 开源证书 (Certum) | $86 | 1年 | ⭐⭐⭐⭐ (开源项目) |

### macOS

| 项目 | 价格 | 周期 |
|------|------|------|
| Apple Developer Program | $99 | 1年 |

### 总成本（首年）

- **完整方案**: $573 (Windows EV + macOS)
- **经济方案**: $185 (Windows 标准 + macOS)
- **开源方案**: $185 (Certum开源 + macOS)

---

## 安全最佳实践

### 证书保护

1. ✅ **永远不要**将证书文件提交到 git
2. ✅ 证书密码使用强密码（至少 16 位）
3. ✅ GitHub Secrets 加密存储
4. ✅ 定期轮换密码
5. ✅ 限制证书访问权限

### CI/CD 安全

1. ✅ 使用短期钥匙串（macOS）
2. ✅ 构建完成后删除证书
3. ✅ 最小权限原则
4. ✅ 审计 GitHub Actions 日志

### 证书管理

1. ✅ 设置证书到期提醒
2. ✅ 备份证书和密码（安全位置）
3. ✅ 记录 Team ID 和相关信息
4. ✅ 文档化证书续费流程

---

## 检查清单

### Windows 代码签名

- [ ] 购买代码签名证书
- [ ] 导出 PFX 文件
- [ ] 转换为 Base64
- [ ] 配置 GitHub Secrets
- [ ] 更新 forge.config.js
- [ ] 更新 GitHub Actions workflow
- [ ] 测试本地签名
- [ ] 验证 CI 签名

### macOS 代码签名

- [ ] 加入 Apple Developer Program
- [ ] 创建 Developer ID 证书
- [ ] 导出 P12 文件
- [ ] 转换为 Base64
- [ ] 创建 App专用密码
- [ ] 获取 Team ID
- [ ] 配置 GitHub Secrets
- [ ] 创建 entitlements.plist
- [ ] 更新 forge.config.js
- [ ] 更新 GitHub Actions workflow
- [ ] 测试本地签名和公证
- [ ] 验证 CI 签名和公证

---

## 相关资源

### Windows

- [Microsoft Code Signing Best Practices](https://docs.microsoft.com/en-us/windows-hardware/drivers/dashboard/code-signing-best-practices)
- [SignTool Documentation](https://docs.microsoft.com/en-us/windows/win32/seccrypto/signtool)
- [SmartScreen FAQ](https://docs.microsoft.com/en-us/windows/security/threat-protection/microsoft-defender-smartscreen/microsoft-defender-smartscreen-overview)

### macOS

- [Apple Code Signing Guide](https://developer.apple.com/support/code-signing/)
- [Notarizing macOS Software](https://developer.apple.com/documentation/security/notarizing_macos_software_before_distribution)
- [codesign Man Page](https://ss64.com/osx/codesign.html)

### Electron

- [Electron Code Signing](https://www.electronjs.org/docs/latest/tutorial/code-signing)
- [Electron Forge Configuration](https://www.electronforge.io/config/makers)

---

**最后更新**: 2025-01-20
**维护者**: ChainlessChain Team
