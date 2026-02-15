# SSO企业认证系统

## 模块概述

**版本**: v0.34.0
**状态**: ✅ 已实现
**IPC处理器**: 20个
**最后更新**: 2026-02-15

企业级单点登录(SSO)认证系统，支持 SAML 2.0、OAuth 2.0 和 OpenID Connect 三种主流协议。提供 DID 与企业身份双向绑定、加密令牌存储和自动会话刷新。

### 核心特性

- **多协议支持**: SAML 2.0, OAuth 2.0, OpenID Connect (OIDC)
- **PKCE 安全**: OAuth/OIDC 流程强制使用 PKCE (Proof Key for Code Exchange)
- **DID 身份桥接**: 企业SSO身份与 DID 身份双向绑定
- **加密令牌存储**: AES-256-GCM 加密存储所有令牌
- **自动刷新**: 令牌过期前自动刷新，无缝用户体验
- **证书校验**: SAML 签名验证和证书链校验

---

## 1. 架构设计

### 1.1 整体架构图

```
┌──────────────────────────────────────────────────────────────────┐
│                        前端 (Vue3)                                │
├──────────────────────────────────────────────────────────────────┤
│  SSOConfiguration │ SSOLogin │ IdentityLinking │ SessionManager  │
│        ↓                ↓            ↓                ↓           │
│                     Pinia Store: sso.ts                           │
└──────────────────────────────────────────────────────────────────┘
                              ↕ IPC (20个通道)
┌──────────────────────────────────────────────────────────────────┐
│                        主进程 (Electron)                          │
├──────────────────────────────────────────────────────────────────┤
│                      sso-ipc.js (20个处理器)                      │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  SSOManager  │  SAMLProvider  │  OAuthProvider  │  OIDCExt │  │
│  └────────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  SSOSessionManager  │  IdentityBridge  │  Database         │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
                              ↕ HTTPS
┌──────────────────────────────────────────────────────────────────┐
│                     外部身份提供商 (IdP)                          │
├──────────────────────────────────────────────────────────────────┤
│  Azure AD │ Okta │ Google Workspace │ OneLogin │ 自建LDAP/AD     │
└──────────────────────────────────────────────────────────────────┘
```

### 1.2 认证流程 (OAuth 2.0 + PKCE)

```
用户点击SSO登录
    ↓
SSOManager 生成 code_verifier + code_challenge
    ↓
打开浏览器窗口 → IdP 授权页面
    ↓
用户在IdP完成认证
    ↓
IdP 重定向回调 → 携带 authorization_code
    ↓
OAuthProvider 用 code + code_verifier 换取 tokens
    ↓
获取 userinfo → 创建/关联本地会话
    ↓
SSOSessionManager 加密存储 tokens
    ↓
IdentityBridge 绑定 DID ↔ SSO 身份
```

### 1.3 核心组件

| 组件 | 文件 | 行数 | 说明 |
|------|------|------|------|
| SSOManager | `sso-manager.js` | ~500 | 多提供商协调器 |
| SAMLProvider | `saml-provider.js` | ~420 | SAML 2.0 SP实现 |
| OAuthProvider | `oauth-provider.js` | ~380 | OAuth 2.0 + PKCE |
| SSOSessionManager | `sso-session-manager.js` | ~350 | 加密令牌存储 |
| IdentityBridge | `identity-bridge.js` | ~300 | DID ↔ SSO身份桥接 |
| SSOIpc | `sso-ipc.js` | ~320 | 20个IPC处理器 |

---

## 2. 核心模块

### 2.1 SSOManager

多提供商协调器，统一管理所有 SSO 配置和认证流程。

**功能特性**:
- 多提供商同时配置和管理
- 统一的登录/登出接口
- 提供商健康检查
- PKCE 参数生成

**核心方法**:

```javascript
class SSOManager {
  // 获取所有SSO配置
  async getConfigurations() { }

  // 创建SSO配置
  async createConfiguration(data) { }

  // 更新SSO配置
  async updateConfiguration(configId, updates) { }

  // 删除SSO配置
  async deleteConfiguration(configId) { }

  // 测试SSO连接
  async testConnection(configId) { }

  // 发起SSO登录
  async initiateLogin(configId) { }

  // 处理SSO回调
  async handleCallback(configId, callbackData) { }

  // SSO登出
  async logout(configId) { }

  // 生成PKCE参数
  generatePKCE() { }
}
```

### 2.2 SAMLProvider

SAML 2.0 服务提供商 (SP) 实现。

**功能特性**:
- SP 元数据生成和导出
- AuthnRequest 构建和发送
- SAML Assertion 解析和验证
- 签名和证书验证
- NameID 格式支持 (email, persistent, transient)

**核心方法**:

```javascript
class SAMLProvider {
  // 生成SP元数据
  generateMetadata(config) { }

  // 构建AuthnRequest
  buildAuthnRequest(config) { }

  // 解析SAML Response
  parseResponse(samlResponse) { }

  // 验证Assertion签名
  validateAssertion(assertion, certificate) { }

  // 提取用户属性
  extractAttributes(assertion) { }
}
```

**SAML 配置**:

```javascript
{
  protocol: 'saml',
  entityId: 'chainlesschain-desktop',
  assertionConsumerServiceUrl: 'http://localhost:18800/saml/callback',
  idpMetadataUrl: 'https://idp.example.com/metadata',
  idpCertificate: '-----BEGIN CERTIFICATE-----...',
  nameIdFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
  signRequests: true,
  wantAssertionsSigned: true
}
```

### 2.3 OAuthProvider

OAuth 2.0 授权码 + PKCE 流程实现，同时支持 OpenID Connect 扩展。

**功能特性**:
- 授权码流程 (Authorization Code Grant)
- PKCE 强制启用 (code_challenge_method: S256)
- 令牌刷新 (Refresh Token)
- UserInfo 端点调用
- OIDC ID Token 解析和验证

**核心方法**:

```javascript
class OAuthProvider {
  // 构建授权URL
  buildAuthorizationUrl(config, pkce) { }

  // 用授权码换取令牌
  async exchangeCode(config, code, codeVerifier) { }

  // 刷新令牌
  async refreshToken(config, refreshToken) { }

  // 获取用户信息
  async getUserInfo(config, accessToken) { }

  // 验证ID Token (OIDC)
  async verifyIdToken(config, idToken) { }

  // 撤销令牌
  async revokeToken(config, token) { }
}
```

**OAuth/OIDC 配置**:

```javascript
{
  protocol: 'oauth2', // 或 'oidc'
  clientId: 'chainlesschain-desktop',
  // clientSecret 不存储 (Public Client, 使用PKCE)
  authorizationUrl: 'https://idp.example.com/authorize',
  tokenUrl: 'https://idp.example.com/token',
  userInfoUrl: 'https://idp.example.com/userinfo',
  redirectUri: 'http://localhost:18800/oauth/callback',
  scopes: ['openid', 'profile', 'email'],
  codeChallengeMethod: 'S256'
}
```

### 2.4 SSOSessionManager

SSO 会话管理器，使用 AES-256-GCM 加密存储令牌。

**功能特性**:
- 令牌加密存储 (AES-256-GCM)
- 自动刷新 (过期前 5 分钟)
- 会话状态跟踪
- 多会话管理

**核心方法**:

```javascript
class SSOSessionManager {
  // 创建会话
  async createSession(configId, tokens, userInfo) { }

  // 获取会话
  async getSession(sessionId) { }

  // 获取活跃会话列表
  async getActiveSessions() { }

  // 刷新会话
  async refreshSession(sessionId) { }

  // 销毁会话
  async destroySession(sessionId) { }

  // 检查会话有效性
  async isSessionValid(sessionId) { }

  // 加密令牌
  encryptToken(token) { }

  // 解密令牌
  decryptToken(encryptedToken) { }
}
```

**加密方案**:

```javascript
// AES-256-GCM 加密
const algorithm = 'aes-256-gcm';
const keyDerivation = 'PBKDF2(masterKey, salt, 100000, 32, sha512)';
// IV: 每次加密随机生成12字节
// AuthTag: 16字节认证标签
```

### 2.5 IdentityBridge

DID 与 SSO 身份双向绑定桥接。

**功能特性**:
- DID → SSO 身份查找
- SSO 身份 → DID 查找
- 一个 DID 可绑定多个 SSO 身份
- 绑定/解绑管理
- 身份冲突检测

**核心方法**:

```javascript
class IdentityBridge {
  // 绑定 DID 和 SSO 身份
  async linkIdentity(did, ssoProvider, ssoUserId, attributes) { }

  // 解绑身份
  async unlinkIdentity(did, ssoProvider) { }

  // DID → SSO 身份查找
  async getSSOIdentities(did) { }

  // SSO → DID 查找
  async getDIDForSSO(ssoProvider, ssoUserId) { }

  // 获取所有身份映射
  async getAllMappings(filters) { }

  // 检查身份冲突
  async checkConflict(ssoProvider, ssoUserId) { }
}
```

---

## 3. 数据模型

### 3.1 sso_configurations

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | 配置ID (UUID) |
| name | TEXT | 显示名称 (如 "Azure AD") |
| protocol | TEXT | 协议类型 (saml/oauth2/oidc) |
| provider_type | TEXT | 提供商类型 (azure_ad/okta/google/custom) |
| config | TEXT(JSON) | 协议配置 (加密存储) |
| enabled | BOOLEAN | 是否启用 |
| metadata | TEXT(JSON) | 提供商元数据 |
| created_at | INTEGER | 创建时间 |
| updated_at | INTEGER | 更新时间 |
| last_tested | INTEGER | 最后测试时间 |
| test_status | TEXT | 测试状态 (success/failed) |

### 3.2 sso_sessions

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | 会话ID (UUID) |
| config_id | TEXT FK | SSO配置ID |
| did | TEXT | 关联的DID |
| access_token | TEXT | 加密的访问令牌 |
| refresh_token | TEXT | 加密的刷新令牌 |
| id_token | TEXT | 加密的ID令牌 (OIDC) |
| token_expires_at | INTEGER | 令牌过期时间 |
| user_info | TEXT(JSON) | 用户信息 |
| status | TEXT | 状态 (active/expired/revoked) |
| created_at | INTEGER | 创建时间 |
| last_refreshed | INTEGER | 最后刷新时间 |

### 3.3 identity_mappings

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | 映射ID (UUID) |
| did | TEXT | DID身份 |
| sso_provider | TEXT | SSO提供商标识 |
| sso_user_id | TEXT | SSO用户ID |
| sso_email | TEXT | SSO邮箱 |
| sso_display_name | TEXT | SSO显示名称 |
| attributes | TEXT(JSON) | 附加属性 |
| linked_at | INTEGER | 绑定时间 |
| last_login | INTEGER | 最后登录时间 |

**唯一约束**: `UNIQUE(sso_provider, sso_user_id)` - 每个 SSO 身份只能绑定一个 DID。

---

## 4. IPC接口 (20个)

### 4.1 SSO配置管理 (6个)

| 通道 | 说明 | 参数 |
|------|------|------|
| `sso:get-configurations` | 获取所有配置 | - |
| `sso:create-configuration` | 创建配置 | data: { name, protocol, providerType, config } |
| `sso:update-configuration` | 更新配置 | configId: string, updates: object |
| `sso:delete-configuration` | 删除配置 | configId: string |
| `sso:test-connection` | 测试连接 | configId: string |
| `sso:get-provider-templates` | 获取预设模板 | - |

### 4.2 认证流程 (4个)

| 通道 | 说明 | 参数 |
|------|------|------|
| `sso:initiate-login` | 发起SSO登录 | configId: string |
| `sso:handle-callback` | 处理回调 | configId: string, callbackData: object |
| `sso:logout` | SSO登出 | configId: string |
| `sso:get-login-url` | 获取登录URL | configId: string |

### 4.3 会话管理 (4个)

| 通道 | 说明 | 参数 |
|------|------|------|
| `sso:get-active-sessions` | 获取活跃会话 | - |
| `sso:refresh-session` | 刷新会话 | sessionId: string |
| `sso:destroy-session` | 销毁会话 | sessionId: string |
| `sso:check-session` | 检查会话有效性 | sessionId: string |

### 4.4 身份桥接 (4个)

| 通道 | 说明 | 参数 |
|------|------|------|
| `sso:link-identity` | 绑定身份 | did: string, ssoProvider: string, ssoUserId: string |
| `sso:unlink-identity` | 解绑身份 | did: string, ssoProvider: string |
| `sso:get-identity-mappings` | 获取映射 | did: string |
| `sso:get-all-mappings` | 获取所有映射 | filters: object |

### 4.5 SAML专用 (2个)

| 通道 | 说明 | 参数 |
|------|------|------|
| `sso:export-sp-metadata` | 导出SP元数据 | configId: string |
| `sso:import-idp-metadata` | 导入IdP元数据 | configId: string, metadataXml: string |

---

## 5. 前端页面

### 5.1 SSOConfigurationPage.vue

SSO 配置管理页:
- 已配置的 SSO 提供商列表
- 新增配置向导 (选择协议 → 填写参数 → 测试连接)
- 预设模板: Azure AD, Okta, Google Workspace, OneLogin
- 连接测试结果显示
- 启用/禁用切换
- SAML SP 元数据导出按钮

### 5.2 SSOLoginPage.vue

SSO 登录页:
- 已启用的 SSO 提供商按钮列表
- 提供商 Logo 和名称展示
- 登录状态反馈 (进行中/成功/失败)
- 回退到本地登录选项

### 5.3 IdentityLinkingPage.vue

身份绑定管理:
- 当前 DID 身份信息展示
- 已绑定的 SSO 身份列表
- 新增绑定流程 (选择提供商 → SSO认证 → 确认绑定)
- 解绑确认对话框
- 身份冲突提示

### 5.4 Pinia Store: sso.ts

```typescript
interface SSOState {
  configurations: SSOConfiguration[];
  activeSessions: SSOSession[];
  identityMappings: IdentityMapping[];
  providerTemplates: ProviderTemplate[];
  loginState: 'idle' | 'pending' | 'success' | 'error';
  currentConfig: SSOConfiguration | null;
  loading: boolean;
}

interface SSOConfiguration {
  id: string;
  name: string;
  protocol: 'saml' | 'oauth2' | 'oidc';
  providerType: string;
  config: Record<string, any>;
  enabled: boolean;
  testStatus: 'success' | 'failed' | null;
}
```

---

## 6. 安全设计

### 6.1 PKCE (Proof Key for Code Exchange)

- OAuth/OIDC 流程强制使用 PKCE
- `code_verifier`: 43-128字符随机字符串
- `code_challenge`: SHA-256(code_verifier) 的 Base64url 编码
- 防止授权码拦截攻击

### 6.2 令牌加密存储

- 所有令牌使用 AES-256-GCM 加密后存储
- 加密密钥通过 PBKDF2 从主密钥派生
- 每个令牌独立的 IV (初始化向量)
- 16字节认证标签确保完整性

### 6.3 证书校验

- SAML Assertion 签名验证
- IdP 证书链校验
- 证书过期检查
- 支持证书轮换

### 6.4 会话安全

- 会话令牌过期前 5 分钟自动刷新
- 异常刷新失败自动销毁会话
- 多设备会话互斥 (可配置)
- 登出时通知 IdP (SAML SLO / OAuth Revoke)

### 6.5 回调安全

- 回调 URL 使用 localhost 端口 (18800)
- state 参数防 CSRF 攻击
- 回调仅接受一次 (Nonce 校验)

---

## 7. 文件结构

```
desktop-app-vue/src/main/sso/
├── sso-manager.js           # 多提供商协调器
├── saml-provider.js         # SAML 2.0 SP实现
├── oauth-provider.js        # OAuth 2.0 + PKCE
├── sso-session-manager.js   # 加密令牌管理
├── identity-bridge.js       # DID ↔ SSO桥接
└── sso-ipc.js               # 20个IPC处理器

desktop-app-vue/src/renderer/
├── pages/sso/
│   ├── SSOConfigurationPage.vue  # SSO配置管理
│   ├── SSOLoginPage.vue          # SSO登录页
│   └── IdentityLinkingPage.vue   # 身份绑定管理
└── stores/sso.ts                 # SSO状态管理
```

---

## 8. 相关文档

- [安全机制设计](../安全机制设计.md)
- [去中心化社交模块](02_去中心化社交模块.md) (DID身份系统)
- [企业版组织模块](05_企业版组织模块.md) (RBAC权限)
- [企业审计系统](11_企业审计系统.md) (审计日志)

---

**文档版本**: 1.0
**最后更新**: 2026-02-15
