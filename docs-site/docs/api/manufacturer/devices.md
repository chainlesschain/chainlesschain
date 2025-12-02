# 设备管理API

设备管理API提供U盾和SIMKey设备的完整生命周期管理功能。

## 接口列表

| 接口 | 方法 | 路径 | 说明 |
|------|------|------|------|
| [注册设备](#注册设备) | POST | `/api/devices/register` | 单个设备注册 |
| [批量注册设备](#批量注册设备) | POST | `/api/devices/batch-register` | 批量注册设备 |
| [激活设备](#激活设备) | POST | `/api/devices/activate` | 激活设备 |
| [锁定设备](#锁定设备) | POST | `/api/devices/{deviceId}/lock` | 锁定设备 |
| [解锁设备](#解锁设备) | POST | `/api/devices/{deviceId}/unlock` | 解锁设备 |
| [注销设备](#注销设备) | POST | `/api/devices/{deviceId}/deactivate` | 注销设备 |
| [查询设备列表](#查询设备列表) | GET | `/api/devices/list` | 分页查询设备 |
| [查询设备详情](#查询设备详情) | GET | `/api/devices/{deviceId}` | 获取设备详细信息 |
| [更新设备信息](#更新设备信息) | PUT | `/api/devices/{deviceId}` | 更新设备信息 |
| [生成激活码](#生成激活码) | POST | `/api/devices/generate-activation-code` | 生成激活码 |

---

## 注册设备

注册单个U盾或SIMKey设备到系统。

### 请求

```http
POST /api/devices/register
Authorization: Bearer <token>
Content-Type: application/json
```

**请求体**:

```json
{
  "deviceType": "UKEY",
  "serialNumber": "UK20240001",
  "manufacturer": "ChainlessChain",
  "model": "CCU-1000",
  "hardwareVersion": "1.0",
  "firmwareVersion": "1.0.0"
}
```

**参数说明**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| deviceType | string | 是 | 设备类型: UKEY或SIMKEY |
| serialNumber | string | 是 | 设备序列号（唯一） |
| manufacturer | string | 是 | 制造商名称 |
| model | string | 是 | 设备型号 |
| hardwareVersion | string | 否 | 硬件版本 |
| firmwareVersion | string | 否 | 固件版本 |

### 响应

**成功响应** (200):

```json
{
  "code": 200,
  "message": "设备注册成功",
  "data": {
    "deviceId": "DEV-1701589200123",
    "deviceType": "UKEY",
    "serialNumber": "UK20240001",
    "manufacturer": "ChainlessChain",
    "model": "CCU-1000",
    "status": "INACTIVE",
    "activationCode": "ABCD-EFGH-IJKL-MNOP",
    "createdAt": "2024-12-02T10:30:00Z"
  }
}
```

**错误响应**:

```json
{
  "code": 1001,
  "message": "设备序列号已存在",
  "data": null
}
```

### 示例

#### curl

```bash
curl -X POST "http://localhost:8080/api/devices/register" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "deviceType": "UKEY",
    "serialNumber": "UK20240001",
    "manufacturer": "ChainlessChain",
    "model": "CCU-1000"
  }'
```

#### JavaScript

```javascript
const response = await fetch('/api/devices/register', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    deviceType: 'UKEY',
    serialNumber: 'UK20240001',
    manufacturer: 'ChainlessChain',
    model: 'CCU-1000'
  })
})

const result = await response.json()
console.log(result.data.deviceId)
console.log(result.data.activationCode)
```

---

## 批量注册设备

批量注册多个设备到系统。

### 请求

```http
POST /api/devices/batch-register
Authorization: Bearer <token>
Content-Type: application/json
```

**请求体**:

```json
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

### 响应

**成功响应** (200):

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
        "deviceId": "DEV-1701589200123",
        "activationCode": "ABCD-EFGH-IJKL-MNOP",
        "status": "success",
        "message": "注册成功"
      },
      {
        "serialNumber": "SK20240001",
        "deviceId": "DEV-1701589200124",
        "activationCode": "PQRS-TUVW-XYZA-BCDE",
        "status": "success",
        "message": "注册成功"
      }
    ]
  }
}
```

**部分失败响应**:

```json
{
  "code": 200,
  "message": "批量注册完成，部分失败",
  "data": {
    "total": 3,
    "success": 2,
    "failed": 1,
    "results": [
      {
        "serialNumber": "UK20240001",
        "deviceId": "DEV-1701589200123",
        "status": "success",
        "message": "注册成功"
      },
      {
        "serialNumber": "UK20240002",
        "status": "failed",
        "message": "设备序列号已存在"
      },
      {
        "serialNumber": "SK20240001",
        "deviceId": "DEV-1701589200124",
        "status": "success",
        "message": "注册成功"
      }
    ]
  }
}
```

### 示例

#### JavaScript

```javascript
const devices = [
  {
    deviceType: 'UKEY',
    serialNumber: 'UK20240001',
    manufacturer: 'ChainlessChain',
    model: 'CCU-1000'
  },
  {
    deviceType: 'SIMKEY',
    serialNumber: 'SK20240001',
    manufacturer: 'ChainlessChain',
    model: 'CCS-2000'
  }
]

const response = await fetch('/api/devices/batch-register', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ devices })
})

const result = await response.json()
console.log(`成功: ${result.data.success}/${result.data.total}`)

// 处理失败的设备
const failed = result.data.results.filter(r => r.status === 'failed')
failed.forEach(f => {
  console.error(`${f.serialNumber} 失败: ${f.message}`)
})
```

---

## 激活设备

使用激活码激活设备并绑定用户。

### 请求

```http
POST /api/devices/activate
Authorization: Bearer <token>
Content-Type: application/json
```

**请求体**:

```json
{
  "deviceId": "DEV-1701589200123",
  "activationCode": "ABCD-EFGH-IJKL-MNOP",
  "userId": "user123"
}
```

**参数说明**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| deviceId | string | 是 | 设备ID |
| activationCode | string | 是 | 激活码 |
| userId | string | 是 | 用户ID |

### 响应

**成功响应** (200):

```json
{
  "code": 200,
  "message": "设备激活成功",
  "data": {
    "deviceId": "DEV-1701589200123",
    "status": "ACTIVE",
    "userId": "user123",
    "activatedAt": "2024-12-02T11:00:00Z"
  }
}
```

**错误响应**:

```json
{
  "code": 2003,
  "message": "激活码无效或已过期",
  "data": null
}
```

```json
{
  "code": 2002,
  "message": "设备已激活，不能重复激活",
  "data": null
}
```

### 示例

#### curl

```bash
curl -X POST "http://localhost:8080/api/devices/activate" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "deviceId": "DEV-1701589200123",
    "activationCode": "ABCD-EFGH-IJKL-MNOP",
    "userId": "user123"
  }'
```

---

## 锁定设备

锁定异常设备，锁定后设备无法使用。

### 请求

```http
POST /api/devices/{deviceId}/lock
Authorization: Bearer <token>
Content-Type: application/json
```

**请求体**:

```json
{
  "reason": "安全原因：检测到异常登录行为",
  "note": "用户报告设备丢失"
}
```

**参数说明**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| reason | string | 是 | 锁定原因 |
| note | string | 否 | 备注信息 |

### 响应

**成功响应** (200):

```json
{
  "code": 200,
  "message": "设备已锁定",
  "data": {
    "deviceId": "DEV-1701589200123",
    "status": "LOCKED",
    "lockedAt": "2024-12-02T12:00:00Z",
    "lockReason": "安全原因：检测到异常登录行为"
  }
}
```

---

## 解锁设备

解锁已锁定的设备，恢复正常使用。

### 请求

```http
POST /api/devices/{deviceId}/unlock
Authorization: Bearer <token>
Content-Type: application/json
```

**请求体**:

```json
{
  "note": "用户找回设备，确认安全"
}
```

### 响应

**成功响应** (200):

```json
{
  "code": 200,
  "message": "设备已解锁",
  "data": {
    "deviceId": "DEV-1701589200123",
    "status": "ACTIVE",
    "unlockedAt": "2024-12-02T13:00:00Z"
  }
}
```

---

## 注销设备

永久注销设备，注销后无法恢复。

### 请求

```http
POST /api/devices/{deviceId}/deactivate
Authorization: Bearer <token>
Content-Type: application/json
```

**请求体**:

```json
{
  "reason": "设备报废",
  "note": "设备物理损坏，无法修复",
  "confirmPassword": "admin123456"
}
```

**参数说明**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| reason | string | 是 | 注销原因 |
| note | string | 否 | 备注信息 |
| confirmPassword | string | 是 | 管理员密码确认 |

### 响应

**成功响应** (200):

```json
{
  "code": 200,
  "message": "设备已注销",
  "data": {
    "deviceId": "DEV-1701589200123",
    "status": "DEACTIVATED",
    "deactivatedAt": "2024-12-02T14:00:00Z"
  }
}
```

---

## 查询设备列表

分页查询设备列表，支持多种筛选条件。

### 请求

```http
GET /api/devices/list?page=1&size=20&deviceType=UKEY&status=ACTIVE&keyword=UK2024
Authorization: Bearer <token>
```

**查询参数**:

| 参数 | 类型 | 必填 | 说明 | 默认值 |
|------|------|------|------|--------|
| page | int | 否 | 页码（从1开始） | 1 |
| size | int | 否 | 每页数量 | 20 |
| deviceType | string | 否 | 设备类型(UKEY/SIMKEY) | 全部 |
| status | string | 否 | 设备状态 | 全部 |
| keyword | string | 否 | 关键词(设备ID/序列号) | 无 |
| manufacturer | string | 否 | 制造商 | 无 |
| userId | string | 否 | 用户ID | 无 |
| sortBy | string | 否 | 排序字段 | createTime |
| sortOrder | string | 否 | 排序方向(asc/desc) | desc |

**设备状态**:
- `INACTIVE`: 未激活
- `ACTIVE`: 已激活
- `LOCKED`: 已锁定
- `DEACTIVATED`: 已注销

### 响应

**成功响应** (200):

```json
{
  "code": 200,
  "message": "查询成功",
  "data": {
    "list": [
      {
        "deviceId": "DEV-1701589200123",
        "deviceType": "UKEY",
        "serialNumber": "UK20240001",
        "manufacturer": "ChainlessChain",
        "model": "CCU-1000",
        "status": "ACTIVE",
        "userId": "user123",
        "activationCode": "ABCD-EFGH-IJKL-MNOP",
        "createdAt": "2024-12-02T10:30:00Z",
        "activatedAt": "2024-12-02T11:00:00Z",
        "lastUsedAt": "2024-12-02T15:30:00Z"
      },
      {
        "deviceId": "DEV-1701589200124",
        "deviceType": "UKEY",
        "serialNumber": "UK20240002",
        "manufacturer": "ChainlessChain",
        "model": "CCU-1000",
        "status": "INACTIVE",
        "userId": null,
        "activationCode": "FGHI-JKLM-NOPQ-RSTU",
        "createdAt": "2024-12-02T10:31:00Z",
        "activatedAt": null,
        "lastUsedAt": null
      }
    ],
    "pagination": {
      "page": 1,
      "size": 20,
      "total": 150,
      "totalPages": 8
    }
  }
}
```

### 示例

#### JavaScript

```javascript
// 查询第1页，每页20条，只显示U盾，状态为已激活
const params = new URLSearchParams({
  page: 1,
  size: 20,
  deviceType: 'UKEY',
  status: 'ACTIVE'
})

const response = await fetch(`/api/devices/list?${params}`, {
  headers: {
    'Authorization': `Bearer ${token}`
  }
})

const result = await response.json()
const devices = result.data.list
const pagination = result.data.pagination

console.log(`共 ${pagination.total} 台设备，当前第 ${pagination.page}/${pagination.totalPages} 页`)
devices.forEach(device => {
  console.log(`${device.serialNumber} - ${device.status}`)
})
```

---

## 查询设备详情

获取单个设备的详细信息。

### 请求

```http
GET /api/devices/{deviceId}
Authorization: Bearer <token>
```

### 响应

**成功响应** (200):

```json
{
  "code": 200,
  "message": "查询成功",
  "data": {
    "deviceId": "DEV-1701589200123",
    "deviceType": "UKEY",
    "serialNumber": "UK20240001",
    "manufacturer": "ChainlessChain",
    "model": "CCU-1000",
    "hardwareVersion": "1.0",
    "firmwareVersion": "1.0.0",
    "status": "ACTIVE",
    "userId": "user123",
    "userName": "张三",
    "userEmail": "zhangsan@example.com",
    "activationCode": "ABCD-EFGH-IJKL-MNOP",
    "createdAt": "2024-12-02T10:30:00Z",
    "activatedAt": "2024-12-02T11:00:00Z",
    "lastUsedAt": "2024-12-02T15:30:00Z",
    "lockReason": null,
    "lockedAt": null,
    "deactivatedAt": null,
    "statistics": {
      "totalUsageCount": 156,
      "totalUsageDuration": 3600000,
      "backupCount": 3,
      "lastBackupAt": "2024-12-01T20:00:00Z"
    }
  }
}
```

**错误响应**:

```json
{
  "code": 2001,
  "message": "设备不存在",
  "data": null
}
```

---

## 更新设备信息

更新设备的非核心信息。

### 请求

```http
PUT /api/devices/{deviceId}
Authorization: Bearer <token>
Content-Type: application/json
```

**请求体**:

```json
{
  "firmwareVersion": "1.0.1",
  "note": "已更新固件"
}
```

**可更新字段**:
- `firmwareVersion`: 固件版本
- `note`: 备注信息

**不可更新字段**:
- `deviceType`: 设备类型
- `serialNumber`: 序列号
- `manufacturer`: 制造商
- `model`: 型号
- `status`: 状态（需通过专门接口）

### 响应

**成功响应** (200):

```json
{
  "code": 200,
  "message": "设备信息已更新",
  "data": {
    "deviceId": "DEV-1701589200123",
    "firmwareVersion": "1.0.1",
    "note": "已更新固件",
    "updatedAt": "2024-12-02T16:00:00Z"
  }
}
```

---

## 生成激活码

为设备生成新的激活码（旧激活码将失效）。

### 请求

```http
POST /api/devices/generate-activation-code
Authorization: Bearer <token>
Content-Type: application/json
```

**请求体**:

```json
{
  "deviceId": "DEV-1701589200123",
  "validityDays": 365,
  "reason": "原激活码丢失，重新生成"
}
```

**参数说明**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| deviceId | string | 是 | 设备ID |
| validityDays | int | 否 | 有效期（天） | 365 |
| reason | string | 是 | 生成原因 |

### 响应

**成功响应** (200):

```json
{
  "code": 200,
  "message": "激活码生成成功",
  "data": {
    "deviceId": "DEV-1701589200123",
    "activationCode": "VWXY-ZABC-DEFG-HIJK",
    "expiresAt": "2025-12-02T10:00:00Z",
    "oldActivationCode": "ABCD-EFGH-IJKL-MNOP",
    "generatedAt": "2024-12-02T10:00:00Z"
  }
}
```

---

## 错误码

| 错误码 | 说明 | 解决方案 |
|--------|------|----------|
| 2001 | 设备不存在 | 检查设备ID是否正确 |
| 2002 | 设备已激活 | 无需重复激活 |
| 2003 | 激活码无效 | 检查激活码或重新生成 |
| 2004 | 设备已锁定 | 先解锁设备 |
| 2005 | 设备已注销 | 已注销设备无法操作 |
| 2006 | 序列号重复 | 使用唯一的序列号 |
| 2007 | 无权限操作 | 检查用户权限 |

## 使用场景示例

### 场景1: 完整的设备生命周期

```javascript
// 1. 注册设备
const registerResult = await registerDevice({
  deviceType: 'UKEY',
  serialNumber: 'UK20240001',
  manufacturer: 'ChainlessChain',
  model: 'CCU-1000'
})
const { deviceId, activationCode } = registerResult.data

// 2. 用户获得设备和激活码，进行激活
await activateDevice({
  deviceId,
  activationCode,
  userId: 'user123'
})

// 3. 用户使用设备...

// 4. 设备丢失，锁定设备
await lockDevice(deviceId, {
  reason: '用户报告设备丢失'
})

// 5. 用户找回设备，解锁
await unlockDevice(deviceId, {
  note: '用户确认找回'
})

// 6. 设备报废，注销
await deactivateDevice(deviceId, {
  reason: '设备报废',
  confirmPassword: 'admin123456'
})
```

### 场景2: 批量注册并导出激活码

```javascript
// 批量注册100台设备
const devices = []
for (let i = 1; i <= 100; i++) {
  devices.push({
    deviceType: 'UKEY',
    serialNumber: `UK2024${String(i).padStart(4, '0')}`,
    manufacturer: 'ChainlessChain',
    model: 'CCU-1000'
  })
}

const result = await batchRegister({ devices })

// 导出激活码到CSV
const csv = ['序列号,设备ID,激活码']
result.data.results
  .filter(r => r.status === 'success')
  .forEach(r => {
    csv.push(`${r.serialNumber},${r.deviceId},${r.activationCode}`)
  })

downloadCSV(csv.join('\n'), 'activation-codes.csv')
```

---

## 下一步

- [APP版本管理API](/api/manufacturer/app-versions)
- [数据备份API](/api/manufacturer/backups)
- [用户管理API](/api/manufacturer/users)

---

如有问题，请查看 [Swagger文档](http://localhost:8080/api/swagger-ui.html) 或联系技术支持。
