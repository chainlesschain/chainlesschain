# 去中心化身份 2.0

> **版本: v4.2.0 | 状态: ✅ 生产就绪 | 8 IPC Handlers | 3 数据库表 | Phase 90**

ChainlessChain DID v2.0 实现 W3C DID 规范的完整支持，提供可验证展示（Verifiable Presentations）、身份恢复（社交恢复 + 多因子）、跨平台漫游（Desktop↔Mobile↔Web）和信誉可移植性，为下一代去中心化身份管理奠定基础。

## 核心特性

- 🌐 **W3C DID v2.0 完整规范**: 支持 DID Document、DID Resolution、DID URL 语法等完整 W3C DID Core v2.0 规范
- 📜 **可验证展示 (VP)**: 将多个 Verifiable Credentials 打包为 Verifiable Presentation，支持选择性披露和零知识证明
- 🔑 **DID 恢复机制**: 社交恢复（N-of-M 可信联系人）+ 多因子恢复（硬件密钥 + 助记词 + 生物识别）
- 🔄 **跨平台漫游**: 在 Desktop、Mobile、Web 三端之间无缝迁移 DID 身份，支持离线同步
- ⭐ **信誉可移植性**: DID 绑定的信誉评分可跨应用、跨链迁移，支持聚合多来源信誉

## 创建 DID v2

```javascript
const result = await window.electron.ipcRenderer.invoke("did-v2:create", {
  method: "chainless", // chainless | key | web | peer
  keyType: "Ed25519",
  services: [
    { type: "MessagingService", endpoint: "https://msg.example.com" },
    { type: "LinkedDomains", endpoint: "https://example.com" },
  ],
  recoveryConfig: {
    socialRecovery: {
      threshold: 3,
      trustees: [
        "did:chainless:alice",
        "did:chainless:bob",
        "did:chainless:carol",
        "did:chainless:dave",
      ],
    },
    multiFactor: ["hardwareKey", "mnemonic"],
  },
});
// {
//   success: true,
//   did: "did:chainless:z6Mkf5rGMoatrSj1f...",
//   document: { id, verificationMethod, authentication, service, ... },
//   recoveryKeyShares: 4
// }
```

## 解析 DID

```javascript
const result = await window.electron.ipcRenderer.invoke("did-v2:resolve", {
  did: "did:chainless:z6Mkf5rGMoatrSj1f...",
  accept: "application/did+ld+json",
});
// { success: true, document: { ... }, metadata: { created, updated, deactivated } }
```

## 创建可验证展示

```javascript
const result = await window.electron.ipcRenderer.invoke("did-v2:present", {
  holderDid: "did:chainless:z6Mkf5rGMoatrSj1f...",
  credentials: ["vc-id-001", "vc-id-002"],
  selectiveDisclosure: {
    "vc-id-001": ["name", "email"], // 仅披露指定字段
  },
  challenge: "random-challenge-string",
  domain: "https://verifier.example.com",
});
// { success: true, presentation: { type: "VerifiablePresentation", verifiableCredential: [...], proof: { ... } } }
```

## 验证展示

```javascript
const result = await window.electron.ipcRenderer.invoke("did-v2:verify", {
  presentation: {
    /* VP JSON-LD object */
  },
  challenge: "random-challenge-string",
  domain: "https://verifier.example.com",
});
// { success: true, valid: true, checks: ["signature", "expiry", "revocation"], holder: "did:chainless:z6Mkf5..." }
```

## 恢复 DID

```javascript
const result = await window.electron.ipcRenderer.invoke("did-v2:recover", {
  did: "did:chainless:z6Mkf5rGMoatrSj1f...",
  method: "social", // social | multiFactor
  socialProofs: [
    { trusteeDid: "did:chainless:alice", signature: "..." },
    { trusteeDid: "did:chainless:bob", signature: "..." },
    { trusteeDid: "did:chainless:carol", signature: "..." },
  ],
  newKeyPair: { publicKey: "...", keyType: "Ed25519" },
});
// { success: true, recovered: true, newDocument: { ... }, rotatedKeys: true }
```

## 跨平台漫游

```javascript
const result = await window.electron.ipcRenderer.invoke("did-v2:roam", {
  did: "did:chainless:z6Mkf5rGMoatrSj1f...",
  targetPlatform: "mobile", // mobile | web | desktop
  transferMethod: "qrCode", // qrCode | bluetooth | cloud
  includeCredentials: true,
  includeReputation: true,
});
// { success: true, roamingPackage: { encryptedPayload: "...", qrCode: "data:image/png;base64,..." }, expiresAt: 1710000000000 }
```

## 聚合信誉

```javascript
const result = await window.electron.ipcRenderer.invoke(
  "did-v2:aggregate-reputation",
  {
    did: "did:chainless:z6Mkf5rGMoatrSj1f...",
    sources: ["marketplace", "social", "federation"],
    algorithm: "weighted", // weighted | average | median
  },
);
// { success: true, aggregatedScore: 4.6, breakdown: { marketplace: 4.8, social: 4.5, federation: 4.4 }, totalReviews: 127 }
```

## 导出 DID

```javascript
const result = await window.electron.ipcRenderer.invoke("did-v2:export", {
  did: "did:chainless:z6Mkf5rGMoatrSj1f...",
  format: "json-ld", // json-ld | jwt | cbor
  includePrivateKeys: false,
  password: "***", // user-provided encryption password
});
// { success: true, exported: { format: "json-ld", encryptedPackage: "...", checksum: "sha256:..." } }
```

## IPC 接口完整列表

### DID v2.0 操作（8 个）

| 通道                          | 功能           | 说明                           |
| ----------------------------- | -------------- | ------------------------------ |
| `did-v2:create`               | 创建 DID       | 支持多种 DID 方法和恢复配置    |
| `did-v2:resolve`              | 解析 DID       | W3C DID Resolution 完整实现    |
| `did-v2:present`              | 创建可验证展示 | 打包 VC 为 VP，支持选择性披露  |
| `did-v2:verify`               | 验证展示       | 验证 VP 签名、过期、撤销状态   |
| `did-v2:recover`              | 恢复 DID       | 社交恢复或多因子恢复           |
| `did-v2:roam`                 | 跨平台漫游     | Desktop↔Mobile↔Web 身份迁移    |
| `did-v2:aggregate-reputation` | 聚合信誉       | 多来源信誉聚合计算             |
| `did-v2:export`               | 导出 DID       | 支持 JSON-LD/JWT/CBOR 格式导出 |

## 数据库 Schema

**3 张核心表**:

| 表名                   | 用途           | 关键字段                                       |
| ---------------------- | -------------- | ---------------------------------------------- |
| `did_v2_documents`     | DID 文档存储   | id, did, document, method, recovery_config     |
| `did_v2_presentations` | 可验证展示记录 | id, holder_did, credentials, challenge, domain |
| `did_v2_reputation`    | 信誉记录       | id, did, source, score, reviews_count          |

### did_v2_documents 表

```sql
CREATE TABLE IF NOT EXISTS did_v2_documents (
  id TEXT PRIMARY KEY,
  did TEXT NOT NULL UNIQUE,
  method TEXT NOT NULL,              -- chainless | key | web | peer
  document TEXT NOT NULL,            -- JSON-LD DID Document
  key_type TEXT DEFAULT 'Ed25519',
  recovery_config TEXT,              -- JSON: social recovery + multi-factor config
  roaming_enabled INTEGER DEFAULT 1,
  status TEXT DEFAULT 'active',      -- active | deactivated | recovered
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
  updated_at INTEGER DEFAULT (strftime('%s','now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_did_v2_did ON did_v2_documents(did);
CREATE INDEX IF NOT EXISTS idx_did_v2_method ON did_v2_documents(method);
```

### did_v2_presentations 表

```sql
CREATE TABLE IF NOT EXISTS did_v2_presentations (
  id TEXT PRIMARY KEY,
  holder_did TEXT NOT NULL,
  credentials TEXT NOT NULL,         -- JSON: array of VC IDs
  selective_disclosure TEXT,          -- JSON: field-level disclosure config
  challenge TEXT,
  domain TEXT,
  verified INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_did_v2_vp_holder ON did_v2_presentations(holder_did);
```

### did_v2_reputation 表

```sql
CREATE TABLE IF NOT EXISTS did_v2_reputation (
  id TEXT PRIMARY KEY,
  did TEXT NOT NULL,
  source TEXT NOT NULL,              -- marketplace | social | federation | custom
  score REAL NOT NULL DEFAULT 0,
  reviews_count INTEGER DEFAULT 0,
  aggregated_score REAL,
  last_aggregated_at INTEGER,
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
  updated_at INTEGER DEFAULT (strftime('%s','now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_did_v2_rep_did ON did_v2_reputation(did);
CREATE INDEX IF NOT EXISTS idx_did_v2_rep_source ON did_v2_reputation(source);
```

## 配置

在 `.chainlesschain/config.json` 中配置：

```json
{
  "didV2": {
    "enabled": true,
    "defaultMethod": "chainless",
    "defaultKeyType": "Ed25519",
    "recovery": {
      "socialRecoveryThreshold": 3,
      "maxTrustees": 7,
      "recoveryTimeout": 604800000,
      "multiFactorRequired": ["hardwareKey"]
    },
    "roaming": {
      "enabled": true,
      "qrCodeExpiry": 300000,
      "cloudSyncEnabled": false,
      "autoSyncCredentials": true
    },
    "reputation": {
      "aggregationAlgorithm": "weighted",
      "sources": ["marketplace", "social", "federation"],
      "cacheExpiry": 3600000
    }
  }
}
```

## 故障排除

| 问题                 | 解决方案                                  |
| -------------------- | ----------------------------------------- |
| 社交恢复签名不足     | 确保收集到 threshold 数量的可信联系人签名 |
| 跨平台漫游二维码过期 | 默认 5 分钟有效期，请重新生成             |
| 信誉聚合分数异常     | 检查各来源信誉数据是否同步                |
| DID 文档解析失败     | 确认 DID 方法是否已注册，检查网络连接     |

## 相关文档

- [DID 身份管理](/chainlesschain/social)
- [代理联邦网络](/chainlesschain/agent-federation)
- [隐私计算框架](/chainlesschain/privacy-computing)
