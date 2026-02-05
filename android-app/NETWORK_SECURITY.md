# 🔒 Android 网络安全配置指南

## 概述

从 v0.32.0 开始，ChainlessChain Android 应用强制使用 HTTPS 加密通信，禁止明文流量（Cleartext Traffic），提升数据传输安全性。

## 配置文件

**位置**: `app/src/main/res/xml/network_security_config.xml`

**引用**: `AndroidManifest.xml` 中通过 `android:networkSecurityConfig` 属性启用

## 安全策略

### 1. 默认策略（生产环境）

```xml
<base-config cleartextTrafficPermitted="false">
    <trust-anchors>
        <certificates src="system" />
    </trust-anchors>
</base-config>
```

- ✅ **禁止**所有明文 HTTP 流量
- ✅ **强制**使用 HTTPS/TLS 加密
- ✅ **信任**系统根证书

### 2. 开发环境例外

```xml
<domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="true">localhost</domain>
    <domain includeSubdomains="true">127.0.0.1</domain>
    <domain includeSubdomains="true">10.0.2.2</domain>
    <domain includeSubdomains="true">192.168.1.1</domain>
</domain-config>
```

**仅允许**以下域名使用明文流量：

- `localhost` / `127.0.0.1` - 本机开发服务器
- `10.0.2.2` - Android 模拟器访问宿主机
- `192.168.1.1` - 局域网开发服务器（根据实际调整）

## 使用场景

### ✅ 允许的操作

| 操作            | 协议                             | 说明        |
| --------------- | -------------------------------- | ----------- |
| 访问 API 服务器 | `https://api.chainlesschain.com` | ✅ 生产环境 |
| 本地开发        | `http://localhost:3000`          | ✅ 开发环境 |
| 模拟器开发      | `http://10.0.2.2:8080`           | ✅ 模拟器   |
| 局域网调试      | `http://192.168.1.100:9000`      | ✅ 需配置   |

### ❌ 禁止的操作

| 操作             | 协议                               | 原因          |
| ---------------- | ---------------------------------- | ------------- |
| 访问公网 HTTP    | `http://example.com`               | ❌ 安全风险   |
| 明文 API 请求    | `http://api.unsafe.com`            | ❌ 数据泄露   |
| 第三方 HTTP 资源 | `http://cdn.example.com/image.jpg` | ❌ 中间人攻击 |

## 高级配置

### 证书固定（Certificate Pinning）

用于防止中间人攻击，强制验证服务器证书：

```xml
<domain-config>
    <domain includeSubdomains="true">api.chainlesschain.com</domain>
    <pin-set expiration="2027-01-01">
        <!-- 主证书公钥哈希 -->
        <pin digest="SHA-256">AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=</pin>
        <!-- 备用证书公钥哈希 -->
        <pin digest="SHA-256">BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=</pin>
    </pin-set>
</domain-config>
```

**如何获取证书哈希**:

```bash
# 1. 从服务器下载证书
openssl s_client -servername api.chainlesschain.com \
  -connect api.chainlesschain.com:443 < /dev/null \
  | openssl x509 -outform PEM > server.pem

# 2. 提取公钥
openssl x509 -in server.pem -pubkey -noout > pubkey.pem

# 3. 计算 SHA-256 哈希并转 Base64
openssl pkey -pubin -in pubkey.pem -outform DER \
  | openssl dgst -sha256 -binary | openssl base64
```

### 信任用户证书（调试用）

**⚠️ 仅用于调试，生产环境严禁启用**

```xml
<base-config cleartextTrafficPermitted="false">
    <trust-anchors>
        <certificates src="system" />
        <certificates src="user" />  <!-- 信任用户安装的证书 -->
    </trust-anchors>
</base-config>
```

用途：

- 使用 Charles/Fiddler 抓包调试
- 使用自签名证书的内网服务器

### 允许特定第三方域名

如果必须使用 HTTP 第三方服务（**不推荐**）：

```xml
<domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="false">legacy-api.example.com</domain>
</domain-config>
```

## 常见问题

### Q: 访问本地服务器报错 `CLEARTEXT communication not permitted`

**原因**: 本地服务器地址未在白名单中

**解决方案**:

1. 修改 `network_security_config.xml` 添加域名：

   ```xml
   <domain includeSubdomains="true">192.168.1.xxx</domain>
   ```

2. 或者在本地启用 HTTPS（推荐）

### Q: 如何在开发环境临时禁用限制？

**方案 1**: Build Variant 配置（推荐）

```kotlin
// app/build.gradle.kts
android {
    buildTypes {
        debug {
            // 使用不同的网络安全配置
            manifestPlaceholders["networkSecurityConfig"] = "@xml/network_security_config_debug"
        }
        release {
            manifestPlaceholders["networkSecurityConfig"] = "@xml/network_security_config"
        }
    }
}
```

创建 `network_security_config_debug.xml`：

```xml
<base-config cleartextTrafficPermitted="true" /> <!-- 开发环境全部允许 -->
```

**方案 2**: 临时修改配置（不推荐）

```xml
<base-config cleartextTrafficPermitted="true">
```

### Q: 证书固定失败怎么办？

**错误信息**: `Trust anchor for certification path not found`

**原因**:

1. 证书哈希不正确
2. 证书已过期
3. 服务器证书链不完整

**解决方案**:

1. 重新生成证书哈希
2. 检查 `expiration` 日期
3. 提供备用证书哈希（至少2个）
4. 联系服务器管理员修复证书链

### Q: 如何测试网络安全配置？

```bash
# 1. 测试 HTTPS 连接
adb logcat | grep "NetworkSecurityConfig"

# 2. 测试 HTTP 连接（应该失败）
# 在 APP 中访问 http://example.com

# 3. 预期日志输出
# E/NetworkSecurityConfig: CLEARTEXT communication to example.com not permitted by network security policy
```

## 安全最佳实践

1. ✅ **始终使用 HTTPS** - 生产环境禁止 HTTP
2. ✅ **最小化白名单** - 仅添加必要的开发域名
3. ✅ **启用证书固定** - 关键 API 服务器必须启用
4. ✅ **定期审查配置** - 移除不再使用的域名
5. ✅ **区分环境配置** - Debug/Release 使用不同配置
6. ✅ **监控异常** - 上报网络安全错误到 Crashlytics
7. ❌ **不要信任用户证书** - 生产环境移除 `src="user"`

## 合规性

| 标准                | 要求                       | 本配置  |
| ------------------- | -------------------------- | ------- |
| OWASP Mobile Top 10 | M3: Insecure Communication | ✅ 符合 |
| Google Play 政策    | 禁止明文流量               | ✅ 符合 |
| Android 9+ 默认策略 | 默认禁用 HTTP              | ✅ 符合 |
| ISO 27001           | 数据传输加密               | ✅ 符合 |

## 参考文档

- [Android 网络安全配置官方文档](https://developer.android.com/training/articles/security-config)
- [证书固定最佳实践](https://developer.android.com/training/articles/security-ssl)
- [OWASP Mobile Security](https://owasp.org/www-project-mobile-security/)

## 更新日志

| 版本    | 日期       | 变更                                     |
| ------- | ---------- | ---------------------------------------- |
| v0.32.0 | 2026-02-05 | 初始版本：禁用明文流量，启用网络安全配置 |
