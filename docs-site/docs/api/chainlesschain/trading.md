# 交易API

交易API提供数字资产管理、钱包操作、资产转账和代理经济功能。

## 接口列表

| 接口 | 方法 | 路径 | 说明 |
|------|------|------|------|
| [创建钱包](#创建钱包) | POST | `/api/wallet/create` | 创建数字钱包 |
| [查询资产](#查询资产) | GET | `/api/wallet/assets` | 查询钱包资产 |
| [转账](#转账) | POST | `/api/wallet/transfer` | 资产转账 |
| [交易历史](#交易历史) | GET | `/api/wallet/transactions` | 查询交易记录 |
| [代理支付](#代理支付) | POST | `/api/economy/pay` | 代理间微支付 |
| [资源市场](#资源市场) | GET | `/api/economy/market` | 浏览资源市场 |
| [铸造NFT](#铸造nft) | POST | `/api/economy/nft/mint` | 铸造贡献NFT |
| [查询NFT](#查询nft) | GET | `/api/economy/nft/list` | 查询NFT列表 |

---

## 创建钱包

创建一个新的数字钱包。

### 请求

```http
POST /api/wallet/create
Authorization: Bearer <token>
Content-Type: application/json
```

**请求体**:

```json
{
  "name": "主钱包",
  "type": "standard"
}
```

**参数说明**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name | string | 是 | 钱包名称 |
| type | string | 否 | 钱包类型：standard/hardware，默认standard |

### 响应

**成功响应** (200):

```json
{
  "code": 200,
  "message": "钱包创建成功",
  "data": {
    "walletId": "wallet-1701589200123",
    "name": "主钱包",
    "type": "standard",
    "address": "0x1234567890abcdef...",
    "balance": "0",
    "createdAt": "2024-12-02T10:30:00Z"
  }
}
```

---

## 查询资产

查询钱包中的所有数字资产。

### 请求

```http
GET /api/wallet/assets
Authorization: Bearer <token>
```

### 响应

**成功响应** (200):

```json
{
  "code": 200,
  "message": "success",
  "data": {
    "walletId": "wallet-1701589200123",
    "assets": [
      {
        "assetId": "asset-001",
        "name": "ChainlessToken",
        "symbol": "CLT",
        "balance": "1000.00",
        "type": "fungible"
      },
      {
        "assetId": "nft-001",
        "name": "贡献证书#42",
        "type": "nft",
        "metadata": {
          "description": "代码贡献奖励",
          "mintedAt": "2024-12-01T08:00:00Z"
        }
      }
    ],
    "totalValue": "1000.00"
  }
}
```

---

## 转账

将资产从一个钱包转移到另一个钱包。

### 请求

```http
POST /api/wallet/transfer
Authorization: Bearer <token>
Content-Type: application/json
```

**请求体**:

```json
{
  "assetId": "asset-001",
  "to": "wallet-9876543210",
  "amount": "100.00",
  "memo": "服务费用"
}
```

**参数说明**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| assetId | string | 是 | 资产ID |
| to | string | 是 | 目标钱包地址 |
| amount | string | 是 | 转账数量 |
| memo | string | 否 | 转账备注 |

### 响应

**成功响应** (200):

```json
{
  "code": 200,
  "message": "转账成功",
  "data": {
    "transactionId": "tx-1701589200456",
    "from": "wallet-1701589200123",
    "to": "wallet-9876543210",
    "assetId": "asset-001",
    "amount": "100.00",
    "status": "confirmed",
    "timestamp": "2024-12-02T10:30:00Z"
  }
}
```

**错误响应**:

```json
{
  "code": 6002,
  "message": "余额不足",
  "data": {
    "available": "50.00",
    "required": "100.00"
  }
}
```

---

## 交易历史

查询钱包的交易记录。

### 请求

```http
GET /api/wallet/transactions?page=1&pageSize=20
Authorization: Bearer <token>
```

**查询参数**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| page | number | 否 | 页码，默认1 |
| pageSize | number | 否 | 每页条数，默认20 |
| type | string | 否 | 交易类型：transfer/payment/mint |
| startDate | string | 否 | 开始日期（ISO 8601） |
| endDate | string | 否 | 结束日期（ISO 8601） |

### 响应

**成功响应** (200):

```json
{
  "code": 200,
  "message": "success",
  "data": {
    "items": [
      {
        "transactionId": "tx-1701589200456",
        "type": "transfer",
        "from": "wallet-1701589200123",
        "to": "wallet-9876543210",
        "amount": "100.00",
        "status": "confirmed",
        "timestamp": "2024-12-02T10:30:00Z"
      }
    ],
    "total": 15,
    "page": 1,
    "pageSize": 20
  }
}
```

---

## 代理支付

代理间的微支付功能，用于AI代理之间的资源交换。

### 请求

```http
POST /api/economy/pay
Authorization: Bearer <token>
Content-Type: application/json
```

**请求体**:

```json
{
  "from": "agent-001",
  "to": "agent-002",
  "amount": 100,
  "resource": "compute",
  "description": "GPU计算资源使用费"
}
```

### 响应

**成功响应** (200):

```json
{
  "code": 200,
  "message": "支付成功",
  "data": {
    "paymentId": "pay-1701589200789",
    "from": "agent-001",
    "to": "agent-002",
    "amount": 100,
    "resource": "compute",
    "timestamp": "2024-12-02T10:30:00Z"
  }
}
```

---

## 资源市场

浏览代理资源市场中的可用资源。

### 请求

```http
GET /api/economy/market?category=compute&page=1&pageSize=20
Authorization: Bearer <token>
```

### 响应

**成功响应** (200):

```json
{
  "code": 200,
  "message": "success",
  "data": {
    "items": [
      {
        "listingId": "listing-001",
        "agentId": "agent-003",
        "resource": "compute",
        "description": "GPU推理服务",
        "price": 50,
        "unit": "per-request",
        "available": true
      }
    ],
    "total": 8,
    "page": 1,
    "pageSize": 20
  }
}
```

---

## 铸造NFT

为代理贡献铸造NFT凭证。

### 请求

```http
POST /api/economy/nft/mint
Authorization: Bearer <token>
Content-Type: application/json
```

**请求体**:

```json
{
  "agentId": "agent-001",
  "contribution": "code-review",
  "description": "完成50次代码审查",
  "metadata": {
    "level": "gold",
    "count": 50
  }
}
```

### 响应

**成功响应** (200):

```json
{
  "code": 200,
  "message": "NFT铸造成功",
  "data": {
    "nftId": "nft-1701589200123",
    "agentId": "agent-001",
    "contribution": "code-review",
    "tokenUri": "ipfs://QmXyz...",
    "mintedAt": "2024-12-02T10:30:00Z"
  }
}
```

---

## 查询NFT

查询指定代理的NFT列表。

### 请求

```http
GET /api/economy/nft/list?agentId=agent-001
Authorization: Bearer <token>
```

### 响应

**成功响应** (200):

```json
{
  "code": 200,
  "message": "success",
  "data": {
    "items": [
      {
        "nftId": "nft-1701589200123",
        "agentId": "agent-001",
        "contribution": "code-review",
        "level": "gold",
        "mintedAt": "2024-12-02T10:30:00Z"
      }
    ],
    "total": 3
  }
}
```

---

## 错误码

| 错误码 | 说明 |
|--------|------|
| 6001 | 钱包不存在 |
| 6002 | 余额不足 |
| 6003 | 无效的转账地址 |
| 6004 | 资产不存在 |
| 6005 | 交易确认超时 |
| 6006 | 代理未注册 |
| 6007 | NFT铸造失败 |

## CLI对应命令

```bash
# 钱包管理
chainlesschain wallet create --name "主钱包"
chainlesschain wallet assets
chainlesschain wallet transfer <id> <to>

# 代理经济
chainlesschain economy pay <from> <to> 100
chainlesschain economy market list
chainlesschain economy nft mint <agent>
```
