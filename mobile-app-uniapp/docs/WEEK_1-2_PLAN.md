# Week 1-2 实施计划：安全基础

**时间：** Week 1-2（14天）
**目标：** 建立安全的身份和加密基础设施

---

## 第1天：DID身份系统 - 环境搭建

### 任务清单
- [x] 安装加密库依赖
- [ ] 创建DID服务层文件
- [ ] 设计DID数据结构
- [ ] 创建DID数据库表

### 技术选型
```json
{
  "dependencies": {
    "@stablelib/ed25519": "^1.0.3",      // Ed25519签名
    "@stablelib/x25519": "^1.0.3",       // X25519加密
    "@stablelib/random": "^1.0.2",       // 安全随机数
    "tweetnacl": "^1.0.3",               // 备选加密库
    "tweetnacl-util": "^0.15.1"          // 工具函数
  }
}
```

### DID标识符格式
```
did:chainlesschain:<public_key_hash>
示例: did:chainlesschain:5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty
```

### 数据库表设计
```sql
-- DID身份表
CREATE TABLE identities (
  did TEXT PRIMARY KEY,                    -- DID标识符
  nickname TEXT,                           -- 昵称
  avatar_path TEXT,                        -- 头像路径
  bio TEXT,                                -- 个人简介
  public_key_sign TEXT NOT NULL,          -- 签名公钥（Ed25519）
  public_key_encrypt TEXT NOT NULL,       -- 加密公钥（X25519）
  private_key_encrypted BLOB NOT NULL,    -- 加密的私钥（PIN码保护）
  did_document TEXT NOT NULL,             -- DID文档JSON
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  is_default INTEGER DEFAULT 0,           -- 是否默认身份
  is_active INTEGER DEFAULT 1
);

-- DID服务端点表
CREATE TABLE did_services (
  id TEXT PRIMARY KEY,
  did TEXT NOT NULL,
  service_type TEXT NOT NULL,             -- 'relay', 'storage', 'messaging'
  service_endpoint TEXT NOT NULL,         -- 服务URL
  created_at INTEGER NOT NULL,
  FOREIGN KEY (did) REFERENCES identities(did) ON DELETE CASCADE
);
```

---

## 第2-3天：DID服务层实现

### DID服务核心方法
```javascript
class DIDService {
  // 生成新的DID身份
  async generateDID(nickname, pin)

  // 从加密私钥恢复DID
  async recoverDID(encryptedPrivateKey, pin)

  // 导出DID身份（加密备份）
  async exportDID(did, pin)

  // 导入DID身份
  async importDID(encryptedData, pin)

  // 签名数据
  async signData(did, data, pin)

  // 验证签名
  async verifySignature(did, data, signature)

  // 加密数据（给某个DID）
  async encryptFor(recipientDID, data, senderDID, pin)

  // 解密数据
  async decrypt(encryptedData, recipientDID, pin)

  // 生成DID二维码
  async generateQRCode(did)

  // 解析DID二维码
  async parseDIDFromQR(qrData)
}
```

---

## 第4天：身份管理UI

### 页面创建
- `pages/identity/list.vue` - 身份列表
- `pages/identity/create.vue` - 创建身份
- `pages/identity/detail.vue` - 身份详情
- `pages/identity/import.vue` - 导入身份

### 身份列表功能
```
┌─────────────────────────────────┐
│ 我的身份                        │
├─────────────────────────────────┤
│ ┌─────────────────────────────┐ │
│ │ 👤 Alice (默认)             │ │
│ │ did:chainless...694ty       │ │
│ │ 创建于 2025-12-20           │ │
│ └─────────────────────────────┘ │
│ ┌─────────────────────────────┐ │
│ │ 👤 Bob (工作用)             │ │
│ │ did:chainless...8h3kl       │ │
│ │ 创建于 2025-12-19           │ │
│ └─────────────────────────────┘ │
├─────────────────────────────────┤
│ [+ 创建新身份] [导入身份]       │
└─────────────────────────────────┘
```

---

## 第5-6天：密码和生物识别

### 密码管理
```javascript
class AuthService {
  // 设置PIN码（首次）
  async setupPIN(pin)

  // 验证PIN码
  async verifyPIN(pin)

  // 修改PIN码
  async changePIN(oldPIN, newPIN)

  // 启用生物识别
  async enableBiometric()

  // 生物识别验证
  async verifyBiometric()

  // 检查是否已设置PIN
  async hasPIN()

  // 重置PIN（需要助记词）
  async resetPIN(mnemonic, newPIN)
}
```

### 生物识别集成
```javascript
// UniApp生物识别API
uni.startSoterAuthentication({
  requestAuthModes: ['facial', 'fingerprint'],
  challenge: '123456',
  authContent: '请验证身份',
  success(res) {
    // 验证成功
  }
})
```

### PIN码存储方案
```
用户PIN码
    ↓
PBKDF2派生（100000次迭代）
    ↓
主密钥（Master Key）
    ├─→ 加密私钥
    ├─→ 加密数据库
    └─→ 加密备份
```

---

## 第7-8天：数据加密增强

### 加密层级
```javascript
// Level 1: 数据库整体加密（SQLCipher）
// 已实现

// Level 2: 敏感字段额外加密
class EncryptionService {
  // 加密知识内容
  async encryptContent(content, pin)

  // 解密知识内容
  async decryptContent(encryptedContent, pin)

  // 加密私钥
  async encryptPrivateKey(privateKey, pin)

  // 解密私钥
  async decryptPrivateKey(encryptedKey, pin)

  // 加密备份数据
  async encryptBackup(data, pin)

  // 解密备份数据
  async decryptBackup(encryptedData, pin)
}
```

### 端到端加密消息
```javascript
// 发送加密消息
async function sendEncryptedMessage(recipientDID, message, senderDID, pin) {
  // 1. 获取接收者公钥
  const recipientPubKey = await getPublicKey(recipientDID)

  // 2. 获取发送者私钥
  const senderPrivKey = await decryptPrivateKey(senderDID, pin)

  // 3. ECDH密钥交换
  const sharedSecret = nacl.box.before(recipientPubKey, senderPrivKey)

  // 4. 加密消息
  const encrypted = nacl.box.after(message, nonce, sharedSecret)

  // 5. 发送
  return encrypted
}
```

---

## 第9-10天：完善和测试

### 单元测试
```javascript
describe('DID服务测试', () => {
  test('生成DID', async () => {
    const did = await DIDService.generateDID('Alice', '123456')
    expect(did).toMatch(/^did:chainlesschain:/)
  })

  test('签名和验证', async () => {
    const signature = await DIDService.signData(did, data, pin)
    const isValid = await DIDService.verifySignature(did, data, signature)
    expect(isValid).toBe(true)
  })

  test('加密和解密', async () => {
    const encrypted = await DIDService.encryptFor(bobDID, data, aliceDID, pin)
    const decrypted = await DIDService.decrypt(encrypted, bobDID, pin)
    expect(decrypted).toBe(data)
  })
})
```

### 集成测试
- [ ] 创建身份流程
- [ ] 导入导出身份
- [ ] 签名验证流程
- [ ] 端到端加密通信

---

## 第11-12天：UI完善和文档

### 创建组件
- `components/identity/IdentityCard.vue` - 身份卡片
- `components/identity/PINInput.vue` - PIN码输入
- `components/identity/BiometricButton.vue` - 生物识别按钮
- `components/identity/DIDQRCode.vue` - DID二维码

### 用户引导
```
首次启动流程：
1. 欢迎页 → 2. 设置PIN码 → 3. 创建身份 → 4. 启用生物识别（可选） → 5. 完成
```

### 文档编写
- [ ] API文档
- [ ] 使用指南
- [ ] 安全最佳实践
- [ ] 故障排除

---

## 第13-14天：优化和准备Week 3-4

### 性能优化
- [ ] 密钥缓存（内存中，应用生命周期）
- [ ] 签名批处理
- [ ] 加密操作异步化

### 安全审查
- [ ] 私钥是否安全清除
- [ ] PIN码是否明文存储（应该没有）
- [ ] 加密算法是否正确
- [ ] 随机数生成是否安全

### 准备Week 3-4
- [ ] 设计好友数据结构
- [ ] 调研Signal协议实现
- [ ] 搭建WebSocket测试服务器

---

## 验收标准

### 功能验收
- ✅ 用户可以创建DID身份
- ✅ 用户可以设置和验证PIN码
- ✅ 用户可以启用生物识别
- ✅ 用户可以导出和导入身份
- ✅ 用户可以使用DID签名和验证数据
- ✅ 用户可以使用DID加密和解密数据

### 安全验收
- ✅ 私钥加密存储
- ✅ PIN码使用PBKDF2派生
- ✅ 敏感数据使用后清除
- ✅ 无明文密钥日志

### 性能验收
- ✅ DID生成 < 2秒
- ✅ 签名操作 < 100ms
- ✅ 加密操作 < 200ms

---

## 依赖和风险

### 外部依赖
- ✅ 加密库兼容性（UniApp环境）
- ⚠️ 生物识别API平台差异
- ⚠️ SQLCipher性能

### 潜在风险
1. **加密库在小程序中不可用** - 备选方案：禁用小程序端DID功能
2. **生物识别兼容性问题** - 降级到仅PIN码
3. **性能问题** - 使用Web Worker异步处理

---

**下一步：** 开始编码实施！
