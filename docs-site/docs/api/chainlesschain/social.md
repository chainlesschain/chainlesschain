# 社交API

社交API提供去中心化身份（DID）、P2P加密消息、联系人管理和社交互动功能。

## 接口列表

| 接口 | 方法 | 路径 | 说明 |
|------|------|------|------|
| [创建DID身份](#创建did身份) | POST | `/api/did/create` | 创建去中心化身份 |
| [DID列表](#did列表) | GET | `/api/did/list` | 查询DID身份列表 |
| [DID签名](#did签名) | POST | `/api/did/sign` | 使用DID签名消息 |
| [DID验证](#did验证) | POST | `/api/did/verify` | 验证DID签名 |
| [添加联系人](#添加联系人) | POST | `/api/social/contacts` | 添加联系人 |
| [联系人列表](#联系人列表) | GET | `/api/social/contacts` | 查询联系人列表 |
| [发送消息](#发送消息) | POST | `/api/p2p/send` | 发送P2P加密消息 |
| [好友请求](#好友请求) | POST | `/api/social/friend/add` | 发送好友请求 |
| [发布动态](#发布动态) | POST | `/api/social/posts` | 发布社交动态 |
| [社交统计](#社交统计) | GET | `/api/social/stats` | 获取社交统计数据 |

---

## 创建DID身份

创建基于Ed25519的去中心化身份。

### 请求

```http
POST /api/did/create
Authorization: Bearer <token>
Content-Type: application/json
```

**请求体**:

```json
{
  "alias": "我的主身份",
  "method": "key"
}
```

**参数说明**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| alias | string | 否 | 身份别名 |
| method | string | 否 | DID方法，默认key（支持key、web） |

### 响应

**成功响应** (200):

```json
{
  "code": 200,
  "message": "DID创建成功",
  "data": {
    "did": "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK",
    "alias": "我的主身份",
    "method": "key",
    "publicKey": "z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK",
    "createdAt": "2024-12-02T10:30:00Z"
  }
}
```

---

## DID列表

查询当前用户的所有DID身份。

### 请求

```http
GET /api/did/list
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
        "did": "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK",
        "alias": "我的主身份",
        "method": "key",
        "isDefault": true,
        "createdAt": "2024-12-02T10:30:00Z"
      }
    ],
    "total": 1
  }
}
```

---

## DID签名

使用默认DID对消息进行数字签名。

### 请求

```http
POST /api/did/sign
Authorization: Bearer <token>
Content-Type: application/json
```

**请求体**:

```json
{
  "message": "需要签名的消息内容",
  "did": "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK"
}
```

### 响应

**成功响应** (200):

```json
{
  "code": 200,
  "message": "签名成功",
  "data": {
    "signature": "3045022100...",
    "did": "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK",
    "algorithm": "Ed25519",
    "timestamp": "2024-12-02T10:30:00Z"
  }
}
```

---

## DID验证

验证DID签名的有效性。

### 请求

```http
POST /api/did/verify
Authorization: Bearer <token>
Content-Type: application/json
```

**请求体**:

```json
{
  "message": "需要验证的消息内容",
  "signature": "3045022100...",
  "did": "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK"
}
```

### 响应

**成功响应** (200):

```json
{
  "code": 200,
  "message": "验证完成",
  "data": {
    "valid": true,
    "did": "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK",
    "algorithm": "Ed25519"
  }
}
```

---

## 添加联系人

添加一个新联系人。

### 请求

```http
POST /api/social/contacts
Authorization: Bearer <token>
Content-Type: application/json
```

**请求体**:

```json
{
  "name": "Alice",
  "did": "did:key:z6MkpTHR8VNs5xhqeLfTkb...",
  "note": "技术社区认识的朋友"
}
```

### 响应

**成功响应** (200):

```json
{
  "code": 200,
  "message": "联系人添加成功",
  "data": {
    "contactId": "contact-1701589200123",
    "name": "Alice",
    "did": "did:key:z6MkpTHR8VNs5xhqeLfTkb...",
    "createdAt": "2024-12-02T10:30:00Z"
  }
}
```

---

## 联系人列表

分页查询联系人列表。

### 请求

```http
GET /api/social/contacts?page=1&pageSize=20
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
        "contactId": "contact-1701589200123",
        "name": "Alice",
        "did": "did:key:z6MkpTHR8VNs5xhqeLfTkb...",
        "status": "active",
        "createdAt": "2024-12-02T10:30:00Z"
      }
    ],
    "total": 5,
    "page": 1,
    "pageSize": 20
  }
}
```

---

## 发送消息

通过P2P网络发送端到端加密消息。

### 请求

```http
POST /api/p2p/send
Authorization: Bearer <token>
Content-Type: application/json
```

**请求体**:

```json
{
  "peerId": "peer-abc123",
  "message": "你好，这是一条加密消息",
  "encrypt": true
}
```

**参数说明**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| peerId | string | 是 | 目标节点ID |
| message | string | 是 | 消息内容 |
| encrypt | boolean | 否 | 是否加密，默认true |

### 响应

**成功响应** (200):

```json
{
  "code": 200,
  "message": "消息发送成功",
  "data": {
    "messageId": "msg-1701589200456",
    "peerId": "peer-abc123",
    "encrypted": true,
    "sentAt": "2024-12-02T10:30:00Z"
  }
}
```

---

## 好友请求

向指定联系人发送好友请求。

### 请求

```http
POST /api/social/friend/add
Authorization: Bearer <token>
Content-Type: application/json
```

**请求体**:

```json
{
  "contactId": "contact-1701589200123",
  "message": "你好，我是Bob，希望加你为好友"
}
```

### 响应

**成功响应** (200):

```json
{
  "code": 200,
  "message": "好友请求已发送",
  "data": {
    "requestId": "req-1701589200789",
    "contactId": "contact-1701589200123",
    "status": "pending",
    "sentAt": "2024-12-02T10:30:00Z"
  }
}
```

---

## 发布动态

发布一条社交动态。

### 请求

```http
POST /api/social/posts
Authorization: Bearer <token>
Content-Type: application/json
```

**请求体**:

```json
{
  "content": "今天学习了ChainlessChain的DID功能，非常强大！",
  "visibility": "public"
}
```

**参数说明**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| content | string | 是 | 动态内容 |
| visibility | string | 否 | 可见性：public/friends/private，默认public |

### 响应

**成功响应** (200):

```json
{
  "code": 200,
  "message": "动态发布成功",
  "data": {
    "postId": "post-1701589200123",
    "content": "今天学习了ChainlessChain的DID功能，非常强大！",
    "visibility": "public",
    "createdAt": "2024-12-02T10:30:00Z"
  }
}
```

---

## 社交统计

获取当前用户的社交统计数据。

### 请求

```http
GET /api/social/stats
Authorization: Bearer <token>
```

### 响应

**成功响应** (200):

```json
{
  "code": 200,
  "message": "success",
  "data": {
    "contacts": 15,
    "friends": 8,
    "posts": 42,
    "messages": 256,
    "peers": 3
  }
}
```

---

## 错误码

| 错误码 | 说明 |
|--------|------|
| 5001 | DID创建失败 |
| 5002 | DID不存在 |
| 5003 | 签名验证失败 |
| 5004 | 联系人不存在 |
| 5005 | 好友请求已存在 |
| 5006 | P2P节点不可达 |
| 5007 | 消息加密失败 |

## CLI对应命令

```bash
# DID管理
chainlesschain did create
chainlesschain did list
chainlesschain did sign "message"

# P2P消息
chainlesschain p2p peers
chainlesschain p2p send <peer> "msg"

# 社交功能
chainlesschain social contact add "Alice"
chainlesschain social contact list
chainlesschain social friend add <contact-id>
chainlesschain social post publish "Hello"
chainlesschain social chat send <user> "msg"
chainlesschain social stats
```
