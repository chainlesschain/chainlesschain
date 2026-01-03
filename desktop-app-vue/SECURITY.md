# ChainlessChain 安全配置指南

本文档详细说明了 ChainlessChain 桌面应用的安全配置和最佳实践。

## 目录

- [安全架构概述](#安全架构概述)
- [IPC 通信安全](#ipc-通信安全)
- [文件上传安全](#文件上传安全)
- [XSS 防护](#xss-防护)
- [代码签名配置](#代码签名配置)
- [安全审计](#安全审计)

---

## 安全架构概述

ChainlessChain 实现了多层安全防护:

### 1. Electron 沙箱隔离

- ✅ **Context Isolation**: 渲染进程与主进程完全隔离
- ✅ **Node Integration**: 已禁用 (nodeIntegration: false)
- ✅ **Preload Script**: 使用 contextBridge 安全暴露 API
- ⚠️ **Sandbox Mode**: 建议在生产环境启用 (需要测试兼容性)

配置位置: `src/main/index.js`

```javascript
webPreferences: {
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: true,  // 建议启用
  preload: path.join(__dirname, '../preload/index.js'),
}
```

### 2. IPC 权限控制

实现了基于角色的访问控制 (RBAC) 系统:

- **权限级别**:
  - `PUBLIC`: 公开访问 (无需认证)
  - `AUTHENTICATED`: 需要用户认证
  - `ADMIN`: 管理员权限
  - `SYSTEM`: 系统级权限

- **速率限制**:
  - 全局: 100 次/分钟
  - 敏感操作: 10 次/分钟
  - 文件操作: 30 次/分钟

- **审计日志**: 所有 IPC 调用都会被记录

模块位置: `src/main/security/ipc-permission-manager.js`

### 3. 文件验证

支持多种文件类型的安全验证:

- ✅ MIME 类型检测
- ✅ 文件头签名验证 (Magic Numbers)
- ✅ 文件大小限制
- ✅ 扩展名白名单
- ✅ 危险文件检测
- ✅ 恶意内容扫描 (SVG/HTML 脚本注入)

模块位置: `src/main/security/file-validator.js`

### 4. XSS 防护

提供全面的 XSS 攻击防护:

- ✅ HTML 内容清理
- ✅ Markdown 内容清理
- ✅ URL 协议验证
- ✅ 脚本注入检测
- ✅ 内容安全策略 (CSP)

模块位置: `src/main/security/xss-sanitizer.js`

---

## IPC 通信安全

### 使用 IPC 权限管理器

**主进程端集成:**

```javascript
const { getIPCPermissionManager } = require('./security/ipc-permission-manager');

// 初始化权限管理器
const permissionManager = getIPCPermissionManager();
await permissionManager.initialize();

// 在 ipcMain.handle 中使用中间件
ipcMain.handle('your-channel', async (event, ...args) => {
  try {
    // 应用权限检查和参数清理
    const sanitizedArgs = permissionManager.middleware('your-channel', args);

    // 执行业务逻辑
    return await yourHandler(...sanitizedArgs);
  } catch (error) {
    console.error('IPC Error:', error);
    throw error;
  }
});

// 用户认证后设置权限级别
permissionManager.authenticate();

// 用户登出时重置权限
permissionManager.logout();
```

**权限配置:**

编辑 `src/main/security/ipc-permission-manager.js` 中的 `IPC_PERMISSIONS` 对象:

```javascript
const IPC_PERMISSIONS = {
  'your-channel': PermissionLevel.AUTHENTICATED,
  'admin:*': PermissionLevel.ADMIN,
};
```

### 审计日志查看

```javascript
// 获取最近的审计日志
const logs = permissionManager.getAuditLog(100);

// 获取统计信息
const stats = permissionManager.getStatistics();
console.log('权限拒绝:', stats.recentDenials);
console.log('速率限制:', stats.recentRateLimits);
```

---

## 文件上传安全

### 使用文件验证器

```javascript
const FileValidator = require('./security/file-validator');

// 验证单个文件
const result = await FileValidator.validateFile('/path/to/file.pdf', 'document');

if (result.valid) {
  console.log('文件验证通过');
  console.log('文件哈希:', result.fileInfo.hash);
} else {
  console.error('验证失败:', result.errors);
  console.warn('警告:', result.warnings);
}

// 批量验证
const results = await FileValidator.validateFiles([
  '/path/to/file1.jpg',
  '/path/to/file2.png',
], 'image');
```

### 支持的文件类型

- **文档**: `.md`, `.txt`, `.pdf`, `.doc`, `.docx` (最大 50MB)
- **图片**: `.jpg`, `.png`, `.gif`, `.webp`, `.svg` (最大 20MB)
- **音频**: `.mp3`, `.wav`, `.ogg`, `.m4a` (最大 100MB)
- **视频**: `.mp4`, `.avi`, `.mkv`, `.mov` (最大 500MB)
- **压缩包**: `.zip`, `.rar`, `.7z` (最大 200MB)
- **代码**: `.js`, `.py`, `.java`, `.c`, `.cpp` (最大 10MB)

### 危险文件黑名单

以下文件类型会被自动拒绝:
- 可执行文件: `.exe`, `.dll`, `.so`, `.dylib`
- 脚本文件: `.bat`, `.cmd`, `.ps1`, `.vbs`
- 安装包: `.msi`, `.app`, `.deb`, `.rpm`

---

## XSS 防护

### 清理 HTML 内容

```javascript
const XSSSanitizer = require('./security/xss-sanitizer');

// 清理 HTML
const cleanHTML = XSSSanitizer.sanitizeHTML(userInput, {
  allowDangerousTags: false,
  encodeSpecialChars: true,
});

// 清理 Markdown
const cleanMarkdown = XSSSanitizer.sanitizeMarkdown(markdownContent);
```

### 验证 URL

```javascript
const urlResult = XSSSanitizer.validateURL(userUrl);

if (urlResult.valid) {
  console.log('URL 安全');
} else {
  console.error('URL 不安全:', urlResult.errors);
}
```

### 检测 XSS 攻击

```javascript
const threats = XSSSanitizer.detectXSS(content);

if (threats.length > 0) {
  console.warn('检测到潜在的 XSS 威胁:', threats);
  // 威胁示例:
  // {
  //   name: 'Script Tag',
  //   severity: 'high',
  //   count: 2,
  //   samples: ['<script>alert(1)</script>']
  // }
}
```

### 渲染进程 XSS 防护

在 Vue 组件中使用 DOMPurify (已集成):

```vue
<template>
  <div v-html="sanitizedContent"></div>
</template>

<script>
import DOMPurify from 'dompurify';

export default {
  data() {
    return {
      userContent: '<script>alert("XSS")</script><p>Safe content</p>',
    };
  },
  computed: {
    sanitizedContent() {
      return DOMPurify.sanitize(this.userContent, {
        ALLOWED_TAGS: ['p', 'a', 'strong', 'em', 'ul', 'ol', 'li'],
        ALLOWED_ATTR: ['href', 'class'],
      });
    },
  },
};
</script>
```

---

## 代码签名配置

代码签名可以防止应用被篡改，并提高用户信任度。

### Windows 平台

**1. 获取代码签名证书**

选择以下任一方式:
- 从 CA 机构购买 (DigiCert, GlobalSign, Sectigo)
- 使用 EV 代码签名证书 (推荐,无需额外验证)
- 测试环境可使用自签名证书

**2. 配置环境变量**

创建 `.env.production` 文件:

```bash
# Windows 代码签名证书
WINDOWS_CERTIFICATE_FILE=/path/to/certificate.pfx
WINDOWS_CERTIFICATE_PASSWORD=your-certificate-password
```

⚠️ **安全提示**:
- 不要将证书文件提交到 Git
- 在 CI/CD 环境中使用加密的环境变量
- 证书密码应存储在安全的密钥管理系统中

**3. 生成自签名证书 (仅测试)**

使用 PowerShell (管理员权限):

```powershell
# 创建自签名证书
$cert = New-SelfSignedCertificate `
  -Type CodeSigningCert `
  -Subject "CN=ChainlessChain Development" `
  -KeyAlgorithm RSA `
  -KeyLength 2048 `
  -Provider "Microsoft Enhanced RSA and AES Cryptographic Provider" `
  -KeyExportPolicy Exportable `
  -CertStoreLocation "Cert:\CurrentUser\My" `
  -NotAfter (Get-Date).AddYears(5)

# 导出为 PFX 文件
$password = ConvertTo-SecureString -String "YourPassword" -Force -AsPlainText
Export-PfxCertificate `
  -Cert $cert `
  -FilePath "certificate.pfx" `
  -Password $password

# 将证书添加到受信任的根证书颁发机构
# (仅在本地测试时需要)
```

**4. 构建签名应用**

```bash
# 设置环境变量
export WINDOWS_CERTIFICATE_FILE=/path/to/certificate.pfx
export WINDOWS_CERTIFICATE_PASSWORD=your-password

# 构建并签名
npm run make:win
```

**5. 验证签名**

右键点击生成的 `.exe` 文件 → 属性 → 数字签名

### macOS 平台

macOS 代码签名需要 Apple Developer 账号 ($99/年)。

**配置 package.json:**

```json
{
  "config": {
    "forge": {
      "packagerConfig": {
        "osxSign": {
          "identity": "Developer ID Application: Your Name (TEAMID)",
          "hardened-runtime": true,
          "entitlements": "entitlements.plist",
          "entitlements-inherit": "entitlements.plist",
          "signature-flags": "library"
        },
        "osxNotarize": {
          "appleId": process.env.APPLE_ID,
          "appleIdPassword": process.env.APPLE_ID_PASSWORD,
          "teamId": process.env.APPLE_TEAM_ID
        }
      }
    }
  }
}
```

**创建 entitlements.plist:**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
  <true/>
  <key>com.apple.security.cs.disable-library-validation</key>
  <true/>
</dict>
</plist>
```

### Linux 平台

Linux 平台暂不支持代码签名，但可以提供 GPG 签名的哈希值文件:

```bash
# 计算文件哈希
sha256sum ChainlessChain-*.deb > SHA256SUMS

# GPG 签名哈希文件
gpg --detach-sign --armor SHA256SUMS

# 验证签名
gpg --verify SHA256SUMS.asc SHA256SUMS
```

---

## 安全审计

### 启用审计日志

审计日志会自动保存到用户数据目录:

```
Windows: C:\Users\<用户名>\AppData\Roaming\chainlesschain-desktop-vue\audit.log
macOS: ~/Library/Application Support/chainlesschain-desktop-vue/audit.log
Linux: ~/.config/chainlesschain-desktop-vue/audit.log
```

### 日志格式

```json
{
  "type": "ipc_call",
  "channel": "knowledge:create",
  "argsLength": 1,
  "timestamp": "2025-01-03T10:30:45.123Z"
}
```

### 监控异常活动

```javascript
// 定期检查审计日志
const permissionManager = getIPCPermissionManager();
const stats = permissionManager.getStatistics();

// 检测异常权限拒绝
if (stats.recentDenials.length > 10) {
  console.warn('检测到频繁的权限拒绝，可能存在攻击尝试');
  // 触发安全警报
}

// 检测速率限制触发
if (stats.recentRateLimits.length > 5) {
  console.warn('检测到频繁的速率限制触发');
  // 可能需要临时封禁
}
```

---

## 最佳实践

### 开发阶段

1. ✅ 始终使用 IPC 权限管理器
2. ✅ 所有用户输入都要经过验证和清理
3. ✅ 文件上传前必须验证
4. ✅ 使用 XSS 防护工具处理用户生成的内容
5. ✅ 定期审查安全日志

### 生产环境

1. ✅ 启用代码签名
2. ✅ 启用 Electron sandbox 模式
3. ✅ 配置内容安全策略 (CSP)
4. ✅ 使用 HTTPS 连接后端服务
5. ✅ 定期更新依赖包
6. ✅ 进行安全扫描和渗透测试

### CI/CD 集成

```yaml
# GitHub Actions 示例
name: Security Checks

on: [push, pull_request]

jobs:
  security:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Install dependencies
        run: npm ci

      - name: Run npm audit
        run: npm audit --audit-level=moderate

      - name: Run security tests
        run: npm run test:security

      - name: Check for sensitive data
        run: |
          git grep -E "(password|api_key|secret)" || true
```

---

## 已知限制

1. ⚠️ **Sandbox 模式**: 目前未启用，需要测试与 U-Key 硬件的兼容性
2. ⚠️ **代码签名**: Windows 需要购买证书，macOS 需要 Apple Developer 账号
3. ⚠️ **CSP 策略**: 由于需要 `unsafe-inline` 和 `unsafe-eval`，CSP 防护有限

---

## 安全更新

请关注以下资源获取安全更新:

- 安全公告: [GitHub Security Advisories](https://github.com/chainlesschain/desktop-app/security/advisories)
- 依赖更新: `npm audit` 和 Dependabot
- Electron 安全: https://www.electronjs.org/docs/latest/tutorial/security

---

## 报告安全问题

如果您发现安全漏洞，请**不要**公开提交 Issue，而是通过以下方式报告:

📧 Email: security@chainlesschain.com
🔒 GPG Key: [公钥链接]

我们会在 24 小时内响应，并在修复后公开致谢。

---

**最后更新**: 2025-01-03
