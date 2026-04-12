# 去中心化身份 2.0

> **版本: v4.2.0 | 状态: ✅ 生产就绪 | 8 IPC Handlers | 3 数据库表 | Phase 90**

## 概述

DID v2.0 实现 W3C DID Core v2.0 完整规范，在 v1.0 基础上新增可验证展示（VP）、身份恢复（社交恢复 + 多因子）、跨平台漫游（Desktop/Mobile/Web 三端无缝迁移）和信誉可移植性。支持选择性披露和零知识证明，为去中心化身份管理提供生产级解决方案。

## 核心特性

- 🌐 **W3C DID v2.0 完整规范**: 支持 DID Document、DID Resolution、DID URL 语法等完整 W3C DID Core v2.0 规范
- 📜 **可验证展示 (VP)**: 将多个 Verifiable Credentials 打包为 Verifiable Presentation，支持选择性披露和零知识证明
- 🔑 **DID 恢复机制**: 社交恢复（N-of-M 可信联系人）+ 多因子恢复（硬件密钥 + 助记词 + 生物识别）
- 🔄 **跨平台漫游**: 在 Desktop、Mobile、Web 三端之间无缝迁移 DID 身份，支持离线同步
- ⭐ **信誉可移植性**: DID 绑定的信誉评分可跨应用、跨链迁移，支持聚合多来源信誉

## 系统架构

```
┌─────────────────────────────────────────────────┐
│              应用层 (8 IPC Handlers)              │
│  create │ resolve │ present │ verify │ recover  │
│  roam   │ aggregate-reputation │ export          │
├─────────┴─────────┴─────────┴────────┴──────────┤
│              DID v2.0 Engine                     │
├──────────┬──────────┬──────────┬────────────────┤
│ W3C DID  │  VP/VC   │ 恢复机制  │ 跨平台漫游     │
│ Document │ 选择性   │ 社交恢复  │ Desktop↔Mobile │
│ 解析器    │ 披露     │ +多因子   │ ↔Web (QR/BLE) │
├──────────┴──────────┴──────────┴────────────────┤
│           信誉聚合 (weighted/average/median)      │
├─────────────────────────────────────────────────┤
│  SQLite (did_v2_documents, presentations, rep)   │
└─────────────────────────────────────────────────┘
```

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

### 身份恢复失败详细排查

**现象**: `did-v2:recover` 返回恢复失败，DID 密钥未轮换。

**排查步骤**:
1. **社交恢复**: 确认收集的 `socialProofs` 数量 >= `threshold`（默认 3），且每个 trustee 签名有效
2. 确认提供的 `trusteeDid` 均在创建时配置的 `trustees` 列表中
3. **多因子恢复**: 检查硬件密钥是否可用，助记词是否正确匹配
4. 确认 `newKeyPair` 中的公钥格式和 `keyType` 与原始 DID 配置一致
5. 检查 `recoveryTimeout`（默认 7 天），超时后需重新发起恢复流程

### VP 验证错误

**现象**: `did-v2:verify` 返回 `valid: false`，展示验证不通过。

**排查步骤**:
1. 确认 `challenge` 和 `domain` 值与创建展示时使用的值完全一致
2. 检查 VP 中包含的 VC 是否有过期或已被撤销的凭证
3. 确认签名算法（Ed25519）匹配，且 holder DID 的公钥可正常解析
4. 若使用选择性披露，确认披露字段集合与验证方要求一致

### 跨平台漫游同步失败

**现象**: `did-v2:roam` 生成的漫游包在目标平台无法恢复身份。

**排查步骤**:
1. 检查漫游包是否在有效期内（QR 码默认 5 分钟过期，`qrCodeExpiry` 可配置）
2. 确认 `transferMethod` 匹配目标平台能力（移动端支持 QR/BLE，Web 端仅支持 QR/cloud）
3. 若 `includeCredentials: true`，确认 VC 数据量未超过传输方式限制
4. BLE 传输需确认双方设备已配对且蓝牙处于开启状态

## 关键文件

| 文件 | 职责 |
| --- | --- |
| `desktop-app-vue/src/main/did/did-v2-manager.js` | DID v2.0 核心管理器 |
| `desktop-app-vue/src/main/did/vp-manager.js` | 可验证展示（VP）管理 |
| `desktop-app-vue/src/main/did/did-recovery.js` | 社交恢复 + 多因子恢复 |
| `desktop-app-vue/src/main/did/did-roaming.js` | 跨平台漫游（QR/BLE/Cloud） |
| `desktop-app-vue/src/main/did/reputation-aggregator.js` | 信誉聚合计算 |
| `desktop-app-vue/src/main/did/did-v2-ipc.js` | DID v2 的 8 个 IPC Handler |

## 使用示例

### 完整身份管理流程

```javascript
// 1. 创建 DID 并配置社交恢复
const did = await window.electron.ipcRenderer.invoke("did-v2:create", {
  method: "chainless",
  keyType: "Ed25519",
  recoveryConfig: {
    socialRecovery: { threshold: 3, trustees: ["did:chainless:alice", "did:chainless:bob", "did:chainless:carol", "did:chainless:dave"] },
  },
});

// 2. 创建可验证展示并选择性披露
const vp = await window.electron.ipcRenderer.invoke("did-v2:present", {
  holderDid: did.did,
  credentials: ["vc-age-001"],
  selectiveDisclosure: { "vc-age-001": ["ageOver18"] },
  challenge: "verifier-challenge-123",
});

// 3. 漫游到移动端
const roam = await window.electron.ipcRenderer.invoke("did-v2:roam", {
  did: did.did,
  targetPlatform: "mobile",
  transferMethod: "qrCode",
  includeCredentials: true,
});
// 用户扫描 roam.roamingPackage.qrCode 即可在移动端恢复身份
```

## 故障排查

### 常见问题

| 症状 | 可能原因 | 解决方案 |
| --- | --- | --- |
| 社交恢复失败 | 恢复联系人数量不足或签名过期 | 确认已收集足够恢复签名，检查签名有效期 |
| VP 验证错误 | 可验证表述格式不规范或签发者 DID 已撤销 | 使用 `did vp-validate` 检查格式，确认签发者状态 |
| 跨平台漫游断开 | 同步通道中断或设备授权过期 | 重新建立 P2P 连接，刷新设备授权 `did device-reauth` |
| DID 解析失败 | DID 文档未发布或解析器配置错误 | 确认 DID 文档已注册，检查解析器端点配置 |
| 密钥轮换后旧凭证失效 | 轮换未同步到所有验证方 | 广播密钥轮换事件，通知验证方更新缓存 |

### 常见错误修复

**错误: `SOCIAL_RECOVERY_FAILED` 社交恢复未达阈值**

```bash
# 查看恢复状态和已收集签名数
chainlesschain did recovery-status

# 向恢复联系人发送签名请求
chainlesschain did recovery-request --contacts <contact1,contact2>
```

**错误: `VP_VERIFICATION_FAILED` 可验证表述验证失败**

```bash
# 验证 VP 格式和签名
chainlesschain did vp-validate --file <vp.json>

# 检查签发者 DID 状态
chainlesschain did resolve <issuer-did>
```

**错误: `ROAMING_DISCONNECTED` 跨平台漫游断开**

```bash
# 重新授权设备
chainlesschain did device-reauth --device-id <id>

# 检查 P2P 同步通道状态
chainlesschain p2p peers --did <your-did>
```

## 安全考虑

### 密钥安全
- **私钥存储**: DID 私钥通过 SQLCipher 加密存储在本地数据库中，支持硬件密钥（U-Key/SIMKey）绑定，私钥永不离开安全存储区域
- **密钥轮换**: 恢复 DID 时强制进行密钥轮换（`rotatedKeys: true`），确保旧密钥立即失效，防止被盗密钥继续使用
- **多因子恢复**: 建议同时启用社交恢复和硬件密钥恢复，单一恢复途径存在被社会工程攻击的风险

### 可验证展示安全
- **挑战值验证**: 创建和验证 VP 时必须使用一次性 `challenge` 值，防止重放攻击；`domain` 字段绑定验证方身份
- **最小披露**: 使用 `selectiveDisclosure` 仅披露验证方所需的最少字段，避免不必要的个人信息泄露
- **VP 有效期**: 可验证展示建议设置短有效期，过期后需重新生成，降低被盗用风险

### 跨平台漫游安全
- **漫游包加密**: 跨平台传输的漫游包（`roamingPackage`）使用端到端加密，QR 码默认 5 分钟过期
- **蓝牙传输**: BLE 传输仅在配对设备间进行，自动协商加密通道，传输完成后立即断开
- **信誉数据完整性**: 聚合信誉分数包含来源签名，防止篡改单一来源的信誉评分

## 相关文档

- [DID 身份管理](/chainlesschain/social)
- [代理联邦网络](/chainlesschain/agent-federation)
- [隐私计算框架](/chainlesschain/privacy-computing)
