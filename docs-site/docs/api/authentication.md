# 认证授权

ChainlessChain API采用基于JWT的认证机制，确保API调用的安全性。

## 认证方式

### 1. API Token认证（推荐）

适用于服务端调用。

#### 获取API Token

```
厂家管理系统:
系统设置 → API管理 → 创建Token

Token名称: 生产环境API
权限范围:
☑ 设备管理
☑ APP版本管理
□ 用户管理
□ 系统管理

有效期:
○ 30天
○ 90天
● 1年
○ 永久

创建Token →
复制保存: ccapi_1234567890abcdef...
```

#### 使用Token

```http
GET /api/v1/devices
Authorization: Bearer ccapi_1234567890abcdef...
```

### 2. OAuth 2.0

适用于第三方应用集成。

#### 授权码流程

```
1. 重定向用户到授权页面
GET https://auth.chainlesschain.com/oauth/authorize
  ?client_id={client_id}
  &redirect_uri={redirect_uri}
  &response_type=code
  &scope=device:read device:write
  &state={random_state}

2. 用户授权后获取授权码
→ {redirect_uri}?code={authorization_code}&state={random_state}

3. 使用授权码换取访问令牌
POST https://auth.chainlesschain.com/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
&code={authorization_code}
&client_id={client_id}
&client_secret={client_secret}
&redirect_uri={redirect_uri}

响应:
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "eyJhbGciOiJIUzI1NiIs...",
  "scope": "device:read device:write"
}

4. 使用访问令牌调用API
GET /api/v1/devices
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

### 3. 用户名密码

仅用于内部系统或测试环境。

```http
POST /api/v1/auth/login
Content-Type: application/json

{
  "username": "admin",
  "password": "********"
}
```

响应：
```json
{
  "code": 0,
  "message": "登录成功",
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIs...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIs...",
    "expiresIn": 3600,
    "tokenType": "Bearer"
  }
}
```

## JWT Token结构

### Header

```json
{
  "alg": "HS256",
  "typ": "JWT"
}
```

### Payload

```json
{
  "sub": "user123",
  "iat": 1704096000,
  "exp": 1704099600,
  "scope": ["device:read", "device:write"],
  "iss": "chainlesschain.com",
  "aud": "api.chainlesschain.com"
}
```

### Signature

```
HMACSHA256(
  base64UrlEncode(header) + "." +
  base64UrlEncode(payload),
  secret
)
```

## 权限范围（Scopes）

### 设备管理

| Scope | 说明 | 权限 |
|-------|------|------|
| device:read | 读取设备信息 | 查看设备列表、详情 |
| device:write | 写入设备信息 | 注册、激活、更新设备 |
| device:delete | 删除设备 | 删除、报废设备 |
| device:manage | 管理设备 | 所有设备操作权限 |

### APP版本管理

| Scope | 说明 | 权限 |
|-------|------|------|
| app:read | 读取APP版本 | 查看版本列表、详情 |
| app:write | 上传APP版本 | 上传新版本 |
| app:publish | 发布APP版本 | 发布版本到生产环境 |
| app:manage | 管理APP版本 | 所有版本操作权限 |

### 用户管理

| Scope | 说明 | 权限 |
|-------|------|------|
| user:read | 读取用户信息 | 查看用户列表、详情 |
| user:write | 写入用户信息 | 创建、更新用户 |
| user:delete | 删除用户 | 删除用户账户 |
| user:manage | 管理用户 | 所有用户操作权限 |

### 系统管理

| Scope | 说明 | 权限 |
|-------|------|------|
| system:read | 读取系统信息 | 查看系统配置、日志 |
| system:write | 写入系统配置 | 更新系统配置 |
| system:manage | 管理系统 | 所有系统操作权限 |

## Token刷新

### 刷新访问令牌

```http
POST /api/v1/auth/refresh
Content-Type: application/json

{
  "refreshToken": "eyJhbGciOiJIUzI1NiIs..."
}
```

响应：
```json
{
  "code": 0,
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIs...",  // 新的访问令牌
    "refreshToken": "eyJhbGciOiJIUzI1NiIs...", // 新的刷新令牌
    "expiresIn": 3600
  }
}
```

### 自动刷新机制

```typescript
class APIClient {
    private accessToken: string
    private refreshToken: string
    private expiresAt: number

    async request(url: string, options: RequestInit) {
        // 检查token是否即将过期（提前5分钟刷新）
        if (Date.now() + 300000 >= this.expiresAt) {
            await this.refreshAccessToken()
        }

        return fetch(url, {
            ...options,
            headers: {
                ...options.headers,
                'Authorization': `Bearer ${this.accessToken}`
            }
        })
    }

    private async refreshAccessToken() {
        const response = await fetch('/api/v1/auth/refresh', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken: this.refreshToken })
        })

        const data = await response.json()
        this.accessToken = data.data.accessToken
        this.refreshToken = data.data.refreshToken
        this.expiresAt = Date.now() + data.data.expiresIn * 1000
    }
}
```

## 错误处理

### 认证错误码

| 错误码 | HTTP状态码 | 说明 | 解决方法 |
|--------|-----------|------|----------|
| 401001 | 401 | Token缺失 | 提供Authorization头 |
| 401002 | 401 | Token无效 | 使用有效的Token |
| 401003 | 401 | Token过期 | 刷新Token |
| 401004 | 401 | 签名错误 | 检查Token完整性 |
| 403001 | 403 | 权限不足 | 申请相应权限 |
| 403002 | 403 | Scope不足 | 扩展Scope范围 |
| 429001 | 429 | 请求过于频繁 | 降低请求频率 |

### 错误响应示例

```json
{
  "code": 401003,
  "message": "Token已过期",
  "error": "token_expired",
  "timestamp": "2024-01-15T10:30:00Z",
  "path": "/api/v1/devices"
}
```

## 速率限制

### 限制策略

| Token类型 | 限制 | 时间窗口 |
|-----------|------|----------|
| API Token | 1000次 | 1小时 |
| OAuth Token | 500次 | 1小时 |
| 用户登录 | 100次 | 1小时 |

### 响应头

```http
HTTP/1.1 200 OK
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 995
X-RateLimit-Reset: 1704099600
```

### 超出限制

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 1800

{
  "code": 429001,
  "message": "请求过于频繁，请稍后再试",
  "retryAfter": 1800
}
```

## 安全最佳实践

### 1. Token安全

```typescript
// ✅ 推荐：存储在环境变量
const apiToken = process.env.CHAINLESSCHAIN_API_TOKEN

// ❌ 不推荐：硬编码在代码中
const apiToken = 'ccapi_1234567890abcdef...'

// ✅ 推荐：使用HTTPS
const apiUrl = 'https://api.chainlesschain.com'

// ❌ 不推荐：使用HTTP
const apiUrl = 'http://api.chainlesschain.com'
```

### 2. Token轮换

```
定期轮换API Token:
- 生产环境: 每90天
- 测试环境: 每30天
- 开发环境: 根据需要

设置提醒:
系统设置 → API管理 → Token过期提醒
```

### 3. 最小权限原则

```
只申请必要的权限:

// ✅ 推荐：最小权限
scopes: ['device:read']

// ❌ 不推荐：过度权限
scopes: ['device:manage', 'user:manage', 'system:manage']
```

### 4. IP白名单

```
系统设置 → API管理 → IP白名单

添加允许的IP:
- 192.168.1.100
- 10.0.0.0/24
- 2001:db8::/32

启用IP白名单验证
```

## 示例代码

### JavaScript/Node.js

```javascript
const axios = require('axios')

const client = axios.create({
    baseURL: 'https://api.chainlesschain.com/api/v1',
    headers: {
        'Authorization': `Bearer ${process.env.API_TOKEN}`,
        'Content-Type': 'application/json'
    }
})

// 带自动重试的请求
async function requestWithRetry(config, maxRetries = 3) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await client(config)
        } catch (error) {
            if (error.response?.status === 401 && i < maxRetries - 1) {
                // Token过期，刷新后重试
                await refreshToken()
                continue
            }
            throw error
        }
    }
}

// 使用示例
const devices = await requestWithRetry({ url: '/devices' })
```

### Python

```python
import requests
from requests.adapters import HTTPAdapter
from requests.packages.urllib3.util.retry import Retry

class ChainlessChainAPI:
    def __init__(self, api_token):
        self.base_url = 'https://api.chainlesschain.com/api/v1'
        self.session = requests.Session()
        self.session.headers.update({
            'Authorization': f'Bearer {api_token}',
            'Content-Type': 'application/json'
        })

        # 配置自动重试
        retry = Retry(
            total=3,
            backoff_factor=0.3,
            status_forcelist=[500, 502, 503, 504]
        )
        adapter = HTTPAdapter(max_retries=retry)
        self.session.mount('https://', adapter)

    def get_devices(self, page=1, size=20):
        response = self.session.get(
            f'{self.base_url}/devices',
            params={'page': page, 'size': size}
        )
        response.raise_for_status()
        return response.json()

# 使用示例
api = ChainlessChainAPI(os.getenv('API_TOKEN'))
devices = api.get_devices()
```

## 测试工具

### Postman配置

```json
{
  "info": {
    "name": "ChainlessChain API",
    "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },
  "auth": {
    "type": "bearer",
    "bearer": [
      {
        "key": "token",
        "value": "{{api_token}}",
        "type": "string"
      }
    ]
  },
  "variable": [
    {
      "key": "base_url",
      "value": "https://api.chainlesschain.com/api/v1"
    },
    {
      "key": "api_token",
      "value": "ccapi_1234567890abcdef..."
    }
  ]
}
```

### cURL示例

```bash
# 获取设备列表
curl -X GET "https://api.chainlesschain.com/api/v1/devices?page=1&size=20" \
  -H "Authorization: Bearer ccapi_1234567890abcdef..." \
  -H "Content-Type: application/json"

# 注册设备
curl -X POST "https://api.chainlesschain.com/api/v1/devices/register" \
  -H "Authorization: Bearer ccapi_1234567890abcdef..." \
  -H "Content-Type: application/json" \
  -d '{
    "deviceType": "U盾",
    "model": "ePass3003",
    "serialNumber": "UP2024010100001"
  }'
```

## 常见问题

### Token在哪里获取？

登录厂家管理系统 → 系统设置 → API管理 → 创建Token

### Token可以分享吗？

不可以。Token相当于密码，不应分享给他人。每个应用/服务应使用独立的Token。

### 如何撤销Token？

系统设置 → API管理 → Token列表 → 点击"撤销"

### 忘记Token怎么办？

Token不可找回，只能重新生成。建议妥善保管。
