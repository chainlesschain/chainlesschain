# ChainlessChain 代码签名指南

## 为什么需要代码签名？

未签名的应用程序在 Windows 上会触发 SmartScreen 警告：
- ⚠️ "Windows 已保护你的电脑"
- ⚠️ "未知发布者"
- ⚠️ 用户需要点击"仍要运行"

**代码签名的好处**：
- ✅ 消除 SmartScreen 警告
- ✅ 显示您的公司/组织名称
- ✅ 提升用户信任度
- ✅ 证明软件来源可靠

## 获取代码签名证书

### 方案 1: 购买商业证书（推荐）

**推荐证书颁发机构**：

1. **DigiCert** (最受信任)
   - 价格: ~$400-600/年
   - 网址: https://www.digicert.com/code-signing
   - 优势: 业界标准，微软信任

2. **Sectigo (原 Comodo)**
   - 价格: ~$200-400/年
   - 网址: https://sectigo.com/ssl-certificates-tls/code-signing
   - 优势: 性价比高

3. **GlobalSign**
   - 价格: ~$300-500/年
   - 网址: https://www.globalsign.com/en/code-signing-certificate
   - 优势: 国际认可

**申请流程**：
1. 选择证书类型（个人或组织）
2. 提交申请和身份验证文件
3. 等待审核（1-7 天）
4. 下载证书和私钥

### 方案 2: EV 代码签名证书（最佳）

**Extended Validation (EV) 证书优势**：
- ✅ 立即获得 SmartScreen 信誉
- ✅ 无需积累下载量
- ✅ 最高级别的信任

**要求**：
- 需要硬件令牌（USB Key）
- 更严格的身份验证
- 价格: ~$400-800/年

### 方案 3: 自签名证书（仅测试用）

⚠️ **注意**: 自签名证书不会消除 SmartScreen 警告！

```bash
# 创建自签名证书（PowerShell，仅用于测试）
$cert = New-SelfSignedCertificate `
  -Type CodeSigningCert `
  -Subject "CN=ChainlessChain Team" `
  -KeyAlgorithm RSA `
  -KeyLength 2048 `
  -CertStoreLocation "Cert:\CurrentUser\My"

# 导出为 PFX 文件
$password = ConvertTo-SecureString -String "your-password" -Force -AsPlainText
Export-PfxCertificate `
  -Cert $cert `
  -FilePath "chainlesschain-test.pfx" `
  -Password $password
```

## 配置 Inno Setup 代码签名

### 步骤 1: 安装 Windows SDK

代码签名需要 `signtool.exe`，包含在 Windows SDK 中：

1. 下载 Windows SDK: https://developer.microsoft.com/windows/downloads/windows-sdk/
2. 安装时只选择 "Windows SDK Signing Tools for Desktop Apps"
3. 默认路径: `C:\Program Files (x86)\Windows Kits\10\bin\<version>\x64\signtool.exe`

### 步骤 2: 配置 Inno Setup

在 Inno Setup IDE 中配置签名工具：

1. 打开 Inno Setup Compiler
2. Tools → Configure Sign Tools
3. 添加新的签名工具，名称: `signtool`
4. 命令:

```batch
"C:\Program Files (x86)\Windows Kits\10\bin\10.0.22621.0\x64\signtool.exe" sign /f "path\to\certificate.pfx" /p "password" /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 /d "ChainlessChain" $f
```

**参数说明**：
- `/f` - 证书文件路径 (.pfx 或 .p12)
- `/p` - 证书密码
- `/fd SHA256` - 文件摘要算法
- `/tr` - 时间戳服务器（重要！）
- `/td SHA256` - 时间戳摘要算法
- `/d` - 应用程序描述

### 步骤 3: 修改 installer.iss

```pascal
[Setup]
; ... 其他配置 ...

; 配置签名
SignTool=signtool
SignedUninstaller=yes
```

### 步骤 4: 使用 USB Token (EV 证书)

如果使用 EV 证书（USB Token）：

```batch
"C:\Program Files (x86)\Windows Kits\10\bin\10.0.22621.0\x64\signtool.exe" sign /a /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 /d "ChainlessChain" $f
```

`/a` 参数会自动选择最佳证书。

## 时间戳服务器

**为什么需要时间戳**？
- ✅ 证书过期后签名仍然有效
- ✅ 证明签名时证书是有效的

**推荐的时间戳服务器**：

```
http://timestamp.digicert.com
http://timestamp.sectigo.com
http://timestamp.globalsign.com
http://timestamp.comodoca.com
```

## 签名工作流程

### 手动签名

如果已有证书，可以手动签名：

```bash
# 签名安装程序
signtool sign /f chainlesschain.pfx /p "password" /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 /d "ChainlessChain" ChainlessChain-Setup-0.1.0.exe

# 验证签名
signtool verify /pa ChainlessChain-Setup-0.1.0.exe
```

### 自动签名（集成到构建）

创建签名脚本 `sign-installer.bat`:

```batch
@echo off
set SIGNTOOL="C:\Program Files (x86)\Windows Kits\10\bin\10.0.22621.0\x64\signtool.exe"
set CERT_FILE=chainlesschain.pfx
set CERT_PASSWORD=your-password
set TIMESTAMP_URL=http://timestamp.digicert.com

echo Signing installer...
%SIGNTOOL% sign /f %CERT_FILE% /p %CERT_PASSWORD% /fd SHA256 /tr %TIMESTAMP_URL% /td SHA256 /d "ChainlessChain" %1

if %ERRORLEVEL% EQU 0 (
    echo Successfully signed: %1
    echo.
    echo Verifying signature...
    %SIGNTOOL% verify /pa %1
) else (
    echo Failed to sign: %1
    exit /b 1
)
```

使用：
```bash
sign-installer.bat out\installer\ChainlessChain-Setup-0.1.0.exe
```

## 安全最佳实践

### 1. 保护私钥

⚠️ **重要**: 私钥泄露会导致严重安全问题！

- ✅ 使用强密码保护 PFX 文件
- ✅ 不要提交到 Git 仓库
- ✅ 使用 `.gitignore` 排除证书文件
- ✅ 限制访问权限
- ✅ 定期更换密码

```gitignore
# .gitignore
*.pfx
*.p12
*.cer
*.crt
*.key
sign-config.json
```

### 2. 使用环境变量

不要在脚本中硬编码密码：

```batch
@echo off
REM 从环境变量读取密码
set CERT_PASSWORD=%CHAINLESSCHAIN_CERT_PASSWORD%

if "%CERT_PASSWORD%"=="" (
    echo ERROR: CHAINLESSCHAIN_CERT_PASSWORD environment variable not set
    exit /b 1
)

signtool sign /f chainlesschain.pfx /p %CERT_PASSWORD% ...
```

设置环境变量：
```powershell
[System.Environment]::SetEnvironmentVariable("CHAINLESSCHAIN_CERT_PASSWORD", "your-password", "User")
```

### 3. 使用 Azure Key Vault (高级)

对于团队和 CI/CD：

```bash
# 使用 Azure SignTool
AzureSignTool sign -kvu "https://your-vault.vault.azure.net/" -kvi "client-id" -kvs "client-secret" -kvc "cert-name" -tr http://timestamp.digicert.com -td sha256 Setup.exe
```

## CI/CD 集成

### GitHub Actions 示例

```yaml
name: Build and Sign

on:
  push:
    tags:
      - 'v*'

jobs:
  build:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Install dependencies
        run: npm install
        working-directory: desktop-app-vue

      - name: Build and package
        run: npm run package
        working-directory: desktop-app-vue

      - name: Import certificate
        run: |
          echo "${{ secrets.CERT_BASE64 }}" | base64 --decode > cert.pfx

      - name: Build installer
        run: |
          $env:CERT_PASSWORD = "${{ secrets.CERT_PASSWORD }}"
          & "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" installer.iss
        working-directory: desktop-app-vue

      - name: Sign installer
        run: |
          & "C:\Program Files (x86)\Windows Kits\10\bin\10.0.22621.0\x64\signtool.exe" sign /f cert.pfx /p "${{ secrets.CERT_PASSWORD }}" /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 /d "ChainlessChain" out\installer\ChainlessChain-Setup-*.exe
        working-directory: desktop-app-vue

      - name: Upload artifact
        uses: actions/upload-artifact@v3
        with:
          name: installer
          path: desktop-app-vue/out/installer/*.exe
```

## SmartScreen 信誉积累

即使有代码签名，新证书可能仍会触发警告。需要：

1. **积累下载量** - 需要成千上万次下载
2. **时间** - 可能需要几周到几个月
3. **无恶意报告** - 保持良好声誉

**加速方法**：
- 使用 EV 证书（立即获得信誉）
- 联系微软提交应用程序审核
- 保持稳定的发布模式

## 验证签名

### 在 Windows 上验证

1. 右键点击 EXE 文件
2. 选择"属性"
3. 查看"数字签名"选项卡
4. 应显示：
   - 签名者名称
   - 时间戳
   - 证书状态

### 使用 signtool 验证

```bash
signtool verify /pa /v ChainlessChain-Setup-0.1.0.exe
```

输出应包含：
- ✅ "Successfully verified"
- ✅ 签名者信息
- ✅ 时间戳信息

## 成本估算

| 证书类型 | 年费用 | SmartScreen | 推荐度 |
|---------|--------|-------------|--------|
| 标准代码签名 | $200-400 | 需积累信誉 | ⭐⭐⭐ |
| EV 代码签名 | $400-800 | 立即信任 | ⭐⭐⭐⭐⭐ |
| 自签名 | 免费 | 无效 | ⭐ (仅测试) |

## 快速开始清单

- [ ] 决定证书类型（标准 vs EV）
- [ ] 选择证书颁发机构
- [ ] 提交申请和验证文件
- [ ] 接收证书（等待 1-7 天）
- [ ] 安装 Windows SDK (signtool)
- [ ] 配置 Inno Setup 签名工具
- [ ] 修改 installer.iss 启用签名
- [ ] 测试签名流程
- [ ] 验证签名有效性
- [ ] 设置环境变量保护密码
- [ ] 更新 .gitignore 排除证书
- [ ] 集成到 CI/CD (可选)

## 常见问题

### Q: 签名后还是有警告？

A: 可能原因：
1. 使用的是标准证书（非 EV），需要积累信誉
2. 证书是新的，没有下载历史
3. 时间戳服务器不可用
4. 签名格式不正确

### Q: 可以使用免费证书吗？

A: Let's Encrypt 不提供代码签名证书，只提供 SSL/TLS 证书。代码签名必须购买。

### Q: 证书过期了怎么办？

A: 如果使用了时间戳，签名在证书过期后仍然有效。但需要续费证书以签名新版本。

### Q: 多少钱值得投资？

A: 如果有以下情况，建议购买 EV 证书：
- 商业产品
- 大量用户
- 重视品牌形象
- 需要立即消除警告

## 临时解决方案（无证书）

如果暂时无法获得证书：

1. **说明文档** - 在下载页面明确说明如何绕过 SmartScreen
2. **视频教程** - 制作安装教程视频
3. **社区信任** - 通过 GitHub Stars、用户评价建立信任
4. **开源透明** - 开源代码让用户验证安全性

**用户安装指南**：
```
遇到 SmartScreen 警告时：
1. 点击"更多信息"
2. 点击"仍要运行"
3. 这是正常的，因为我们是开源项目，暂未购买代码签名证书
```

## 总结

代码签名是提升软件专业度的重要步骤。虽然需要投资，但能显著改善用户体验。

**建议路径**：
1. 开始时使用自签名（开发测试）
2. 产品成熟后购买标准证书
3. 有稳定收入后升级到 EV 证书

---

**参考资源**：
- Microsoft 代码签名: https://docs.microsoft.com/windows/win32/seccrypto/cryptography-tools
- Inno Setup 签名文档: https://jrsoftware.org/ishelp/topic_setup_signtool.htm
- SignTool 文档: https://docs.microsoft.com/windows/win32/seccrypto/signtool
