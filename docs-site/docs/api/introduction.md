# API简介

ChainlessChain和厂家管理系统提供完整的RESTful API接口，方便开发者集成和扩展功能。

## API概述

### 基础信息

- **协议**: HTTP/HTTPS
- **数据格式**: JSON
- **字符编码**: UTF-8
- **认证方式**: JWT Token

### API版本

当前API版本：**v1.0**

所有API路径都以 `/api` 为前缀。

### Base URL

#### 厂家管理系统

- **开发环境**: `http://localhost:8080/api`
- **生产环境**: `https://api.chainlesschain.com/api`

#### ChainlessChain系统

- **本地环境**: `http://localhost:3000/api`

## 认证授权

### JWT Token认证

大多数API需要在请求头中携带JWT Token：

```http
Authorization: Bearer <your-jwt-token>
```

### 获取Token

#### 登录接口

```http
POST /api/auth/login
Content-Type: application/json

{
  "username": "admin",
  "password": "admin123456"
}
```

**响应示例**:

```json
{
  "code": 200,
  "message": "登录成功",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "expireTime": "2024-12-03T10:00:00Z",
    "user": {
      "id": "1",
      "username": "admin",
      "role": "ADMIN",
      "email": "admin@chainlesschain.com"
    }
  }
}
```

### Token使用示例

```bash
# curl示例
curl -X GET "http://localhost:8080/api/devices/list" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -H "Content-Type: application/json"
```

```javascript
// JavaScript示例
const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'

fetch('http://localhost:8080/api/devices/list', {
  method: 'GET',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  }
})
.then(response => response.json())
.then(data => console.log(data))
```

```python
# Python示例
import requests

token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
headers = {
    'Authorization': f'Bearer {token}',
    'Content-Type': 'application/json'
}

response = requests.get(
    'http://localhost:8080/api/devices/list',
    headers=headers
)
print(response.json())
```

### Token刷新

Token默认有效期为24小时。过期前可以通过刷新接口获取新Token：

```http
POST /api/auth/refresh
Authorization: Bearer <your-current-token>
```

## 请求格式

### 通用请求头

所有API请求都应包含以下头部：

```http
Content-Type: application/json
Accept: application/json
Authorization: Bearer <token>  (需要认证的接口)
```

### 请求参数类型

#### 1. Path参数

在URL路径中的参数：

```http
GET /api/devices/{deviceId}
```

#### 2. Query参数

在URL查询字符串中的参数：

```http
GET /api/devices/list?page=1&size=20&type=UKEY
```

#### 3. Body参数

在请求体中的JSON数据：

```http
POST /api/devices/register
Content-Type: application/json

{
  "deviceType": "UKEY",
  "serialNumber": "UK20240001",
  "manufacturer": "ChainlessChain",
  "model": "CCU-1000"
}
```

### 分页请求

支持分页的API使用统一的分页参数：

**请求参数**:

| 参数 | 类型 | 必填 | 说明 | 默认值 |
|------|------|------|------|--------|
| page | int | 否 | 页码（从1开始） | 1 |
| size | int | 否 | 每页数量 | 20 |
| sortBy | string | 否 | 排序字段 | createTime |
| sortOrder | string | 否 | 排序方向(asc/desc) | desc |

**请求示例**:

```http
GET /api/devices/list?page=1&size=20&sortBy=createTime&sortOrder=desc
```

## 响应格式

### 统一响应结构

所有API响应都遵循统一的JSON格式：

```json
{
  "code": 200,
  "message": "操作成功",
  "data": {
    // 业务数据
  }
}
```

### 响应字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| code | int | 响应状态码 |
| message | string | 响应消息 |
| data | object/array | 业务数据（可为null） |

### 分页响应格式

```json
{
  "code": 200,
  "message": "查询成功",
  "data": {
    "list": [
      // 数据列表
    ],
    "pagination": {
      "page": 1,
      "size": 20,
      "total": 100,
      "totalPages": 5
    }
  }
}
```

### 状态码说明

#### HTTP状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 成功 |
| 201 | 创建成功 |
| 400 | 请求参数错误 |
| 401 | 未授权（未登录或Token过期） |
| 403 | 禁止访问（无权限） |
| 404 | 资源不存在 |
| 500 | 服务器内部错误 |

#### 业务状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 成功 |
| 1001 | 参数错误 |
| 1002 | 用户不存在 |
| 1003 | 密码错误 |
| 1004 | Token无效 |
| 1005 | Token过期 |
| 2001 | 设备不存在 |
| 2002 | 设备已激活 |
| 2003 | 激活码无效 |
| 2004 | 设备已锁定 |
| 3001 | 备份不存在 |
| 3002 | 恢复失败 |
| 4001 | 版本不存在 |
| 4002 | 文件上传失败 |

### 错误响应示例

```json
{
  "code": 1001,
  "message": "参数错误: 设备类型不能为空",
  "data": null
}
```

```json
{
  "code": 401,
  "message": "Token已过期，请重新登录",
  "data": null
}
```

## 限流和配额

### 接口限流

为保护服务稳定性，部分接口有频率限制：

| 接口类型 | 限制 |
|----------|------|
| 登录接口 | 5次/分钟 |
| 查询接口 | 100次/分钟 |
| 修改接口 | 30次/分钟 |
| 上传接口 | 10次/小时 |

超出限制会返回`429 Too Many Requests`。

响应头中包含限流信息：

```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1701589200
```

## 文件上传

### 上传APP安装包

```http
POST /api/app-versions/upload
Content-Type: multipart/form-data
Authorization: Bearer <token>

file: (binary)
platform: ANDROID
version: 1.0.0
versionName: 首个正式版本
changelog: 初始版本发布
forceUpdate: false
minSupportVersion: 1.0.0
```

### 文件限制

- **最大文件大小**: 2GB
- **允许的文件类型**:
  - Windows: .exe, .msi
  - macOS: .dmg, .pkg
  - Linux: .deb, .rpm, .AppImage
  - Android: .apk, .aab
  - iOS: .ipa

## 批量操作

### 批量注册设备

```http
POST /api/devices/batch-register
Content-Type: application/json
Authorization: Bearer <token>

{
  "devices": [
    {
      "deviceType": "UKEY",
      "serialNumber": "UK20240001",
      "manufacturer": "ChainlessChain",
      "model": "CCU-1000"
    },
    {
      "deviceType": "SIMKEY",
      "serialNumber": "SK20240001",
      "manufacturer": "ChainlessChain",
      "model": "CCS-2000"
    }
  ]
}
```

**响应示例**:

```json
{
  "code": 200,
  "message": "批量注册完成",
  "data": {
    "total": 2,
    "success": 2,
    "failed": 0,
    "results": [
      {
        "serialNumber": "UK20240001",
        "deviceId": "DEV-1234567890",
        "status": "success"
      },
      {
        "serialNumber": "SK20240001",
        "deviceId": "DEV-1234567891",
        "status": "success"
      }
    ]
  }
}
```

## WebSocket接口

### 实时通知

连接WebSocket接收实时通知：

```javascript
const ws = new WebSocket('ws://localhost:8080/api/ws/notifications?token=' + token)

ws.onopen = () => {
  console.log('WebSocket连接已建立')
}

ws.onmessage = (event) => {
  const notification = JSON.parse(event.data)
  console.log('收到通知:', notification)
}

ws.onerror = (error) => {
  console.error('WebSocket错误:', error)
}

ws.onclose = () => {
  console.log('WebSocket连接已关闭')
}
```

**通知格式**:

```json
{
  "type": "DEVICE_ACTIVATED",
  "timestamp": "2024-12-02T10:30:00Z",
  "data": {
    "deviceId": "DEV-1234567890",
    "deviceType": "UKEY",
    "userId": "user123"
  }
}
```

## API测试工具

### Swagger UI

系统内置Swagger UI，可以直接在浏览器中测试API：

**访问地址**: http://localhost:8080/api/swagger-ui.html

**功能**:
- 查看所有API接口
- 在线测试API
- 查看请求/响应示例
- 导出OpenAPI规范

### Postman Collection

我们提供Postman Collection文件，包含所有API的示例请求：

[下载Postman Collection](https://github.com/chainlesschain/manufacturer-system/blob/main/docs/postman/manufacturer-api.json)

导入Postman后，设置环境变量：

```json
{
  "base_url": "http://localhost:8080/api",
  "token": "your-jwt-token"
}
```

### curl示例

#### 登录

```bash
curl -X POST "http://localhost:8080/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123456"}'
```

#### 查询设备列表

```bash
curl -X GET "http://localhost:8080/api/devices/list?page=1&size=20" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json"
```

#### 激活设备

```bash
curl -X POST "http://localhost:8080/api/devices/activate" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "deviceId": "DEV-1234567890",
    "activationCode": "ABCD-EFGH-IJKL-MNOP",
    "userId": "user123"
  }'
```

## SDK和客户端库

### JavaScript/TypeScript

```bash
npm install @chainlesschain/manufacturer-sdk
```

```javascript
import { ManufacturerClient } from '@chainlesschain/manufacturer-sdk'

const client = new ManufacturerClient({
  baseURL: 'http://localhost:8080/api',
  token: 'your-jwt-token'
})

// 查询设备列表
const devices = await client.devices.list({
  page: 1,
  size: 20,
  type: 'UKEY'
})

// 激活设备
await client.devices.activate({
  deviceId: 'DEV-1234567890',
  activationCode: 'ABCD-EFGH-IJKL-MNOP',
  userId: 'user123'
})
```

### Python

```bash
pip install chainlesschain-manufacturer-sdk
```

```python
from chainlesschain.manufacturer import ManufacturerClient

client = ManufacturerClient(
    base_url='http://localhost:8080/api',
    token='your-jwt-token'
)

# 查询设备列表
devices = client.devices.list(page=1, size=20, device_type='UKEY')

# 激活设备
client.devices.activate(
    device_id='DEV-1234567890',
    activation_code='ABCD-EFGH-IJKL-MNOP',
    user_id='user123'
)
```

### Java

```xml
<dependency>
    <groupId>com.chainlesschain</groupId>
    <artifactId>manufacturer-sdk</artifactId>
    <version>1.0.0</version>
</dependency>
```

```java
import com.chainlesschain.manufacturer.ManufacturerClient;

ManufacturerClient client = new ManufacturerClient.Builder()
    .baseUrl("http://localhost:8080/api")
    .token("your-jwt-token")
    .build();

// 查询设备列表
DeviceListResponse devices = client.devices().list(
    new DeviceListRequest()
        .setPage(1)
        .setSize(20)
        .setType(DeviceType.UKEY)
);

// 激活设备
client.devices().activate(
    new ActivateDeviceRequest()
        .setDeviceId("DEV-1234567890")
        .setActivationCode("ABCD-EFGH-IJKL-MNOP")
        .setUserId("user123")
);
```

## 最佳实践

### 1. 错误处理

始终检查API响应的状态码：

```javascript
async function activateDevice(deviceId, activationCode, userId) {
  try {
    const response = await fetch('/api/devices/activate', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ deviceId, activationCode, userId })
    })

    const result = await response.json()

    if (result.code === 200) {
      console.log('激活成功')
      return result.data
    } else {
      console.error('激活失败:', result.message)
      throw new Error(result.message)
    }
  } catch (error) {
    console.error('请求失败:', error)
    throw error
  }
}
```

### 2. Token管理

实现Token自动刷新：

```javascript
class APIClient {
  constructor(baseURL, token) {
    this.baseURL = baseURL
    this.token = token
  }

  async request(endpoint, options = {}) {
    let response = await fetch(`${this.baseURL}${endpoint}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        ...options.headers
      }
    })

    // Token过期，自动刷新
    if (response.status === 401) {
      await this.refreshToken()
      // 重试请求
      response = await fetch(`${this.baseURL}${endpoint}`, {
        ...options,
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json',
          ...options.headers
        }
      })
    }

    return response.json()
  }

  async refreshToken() {
    const response = await fetch(`${this.baseURL}/auth/refresh`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.token}`
      }
    })
    const result = await response.json()
    this.token = result.data.token
  }
}
```

### 3. 请求重试

对临时失败的请求进行重试：

```javascript
async function requestWithRetry(url, options, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(url, options)
      if (response.ok) return response.json()

      // 5xx错误重试
      if (response.status >= 500 && i < maxRetries - 1) {
        await sleep(1000 * (i + 1)) // 指数退避
        continue
      }

      throw new Error(`HTTP ${response.status}`)
    } catch (error) {
      if (i === maxRetries - 1) throw error
      await sleep(1000 * (i + 1))
    }
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
```

### 4. 并发控制

控制并发请求数量：

```javascript
class RequestQueue {
  constructor(concurrency = 5) {
    this.concurrency = concurrency
    this.running = 0
    this.queue = []
  }

  async add(fn) {
    while (this.running >= this.concurrency) {
      await new Promise(resolve => this.queue.push(resolve))
    }

    this.running++

    try {
      return await fn()
    } finally {
      this.running--
      const resolve = this.queue.shift()
      if (resolve) resolve()
    }
  }
}

// 使用
const queue = new RequestQueue(5)

const devices = ['DEV-001', 'DEV-002', 'DEV-003', /* ... */]
const results = await Promise.all(
  devices.map(deviceId =>
    queue.add(() => client.devices.get(deviceId))
  )
)
```

## 下一步

- [厂家管理系统API](/api/manufacturer/devices) - 设备管理接口
- [APP版本API](/api/manufacturer/app-versions) - APP版本管理接口
- [备份管理API](/api/manufacturer/backups) - 数据备份接口

---

如有API问题，请查看 [Swagger文档](http://localhost:8080/api/swagger-ui.html) 或联系技术支持。
