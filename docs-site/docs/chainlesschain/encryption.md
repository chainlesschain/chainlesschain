# 数据加密

ChainlessChain采用多层加密架构，确保数据在存储、传输和使用过程中的安全。

## 加密架构

```
┌─────────────────────────────────────────┐
│         应用层（明文）                    │
├─────────────────────────────────────────┤
│         加密层                            │
│  ┌──────────────────────────────────┐  │
│  │ 端到端加密 (Signal协议)           │  │
│  │ - 私密消息                        │  │
│  │ - 文件传输                        │  │
│  └──────────────────────────────────┘  │
│  ┌──────────────────────────────────┐  │
│  │ 存储加密 (AES-256)                │  │
│  │ - SQLCipher数据库                │  │
│  │ - 文件系统加密                    │  │
│  │ - Git仓库加密                     │  │
│  └──────────────────────────────────┘  │
│  ┌──────────────────────────────────┐  │
│  │ 传输加密 (TLS 1.3)                │  │
│  │ - HTTPS                          │  │
│  │ - P2P通信                         │  │
│  └──────────────────────────────────┘  │
├─────────────────────────────────────────┤
│         密钥层 (U盾/SIMKey)            │
│  - 主密钥（永不导出）                  │
│  - 派生子密钥                          │
└─────────────────────────────────────────┘
```

## 存储加密

### SQLCipher数据库

ChainlessChain使用SQLCipher加密SQLite数据库：

```sql
-- 设置加密密钥（256位）
PRAGMA key = "x'2DD29CA851E7B56E4697B0E1F08507293D761A05CE4D1B628663F411A8086D99'";

-- 配置加密参数
PRAGMA cipher_page_size = 4096;
PRAGMA kdf_iter = 256000;  -- PBKDF2迭代次数
PRAGMA cipher_hmac_algorithm = HMAC_SHA512;
PRAGMA cipher_kdf_algorithm = PBKDF2_HMAC_SHA512;
```

**加密算法**: AES-256-CBC
**密钥派生**: PBKDF2-HMAC-SHA512
**迭代次数**: 256,000次

### 文件加密

敏感文件使用AES-256-GCM加密：

```typescript
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

function encryptFile(filePath: string, key: Buffer) {
    const iv = randomBytes(16)  // 随机IV
    const cipher = createCipheriv('aes-256-gcm', key, iv)

    const input = fs.createReadStream(filePath)
    const output = fs.createWriteStream(filePath + '.enc')

    // 写入IV
    output.write(iv)

    // 加密数据
    input.pipe(cipher).pipe(output)

    // 获取认证标签
    cipher.on('end', () => {
        const tag = cipher.getAuthTag()
        output.write(tag)
    })
}
```

**加密算法**: AES-256-GCM
**特点**:
- 认证加密（AEAD）
- 防篡改
- 高性能

### Git仓库加密

使用git-crypt透明加密：

```bash
# 初始化git-crypt
git-crypt init

# 导出密钥
git-crypt export-key ../git-crypt-key

# 配置加密规则 (.gitattributes)
*.enc filter=git-crypt diff=git-crypt
social/** filter=git-crypt diff=git-crypt
databases/** filter=git-crypt diff=git-crypt

# 锁定（加密）
git-crypt lock

# 解锁（解密）
git-crypt unlock ../git-crypt-key
```

**工作原理**:
1. Git提交前自动加密指定文件
2. Git检出时自动解密
3. 远程仓库只看到密文
4. 完全透明，无需手动操作

## 传输加密

### HTTPS/TLS

所有网络通信使用TLS 1.3：

```typescript
import https from 'https'

const options = {
    hostname: 'api.chainlesschain.com',
    port: 443,
    path: '/sync',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json'
    },
    // TLS配置
    minVersion: 'TLSv1.3',
    ciphers: [
        'TLS_AES_256_GCM_SHA384',
        'TLS_CHACHA20_POLY1305_SHA256'
    ].join(':')
}
```

### P2P通信加密

使用Noise Protocol Framework：

```typescript
import { NoiseProtocol } from '@libp2p/noise'

const noise = new NoiseProtocol()

// 建立加密通道
const connection = await noise.secureOutbound(rawConnection, {
    remotePublicKey: peerPublicKey
})

// 所有数据自动加密传输
connection.write(Buffer.from('Hello'))
```

**特点**:
- 前向安全
- 抗重放攻击
- 低延迟

## 端到端加密

### Signal协议

私密消息使用Signal协议：

```typescript
import { SessionBuilder, SessionCipher } from '@signalapp/libsignal-client'

// 发送方
async function sendMessage(recipientAddress, message) {
    // 1. 建立会话
    const sessionBuilder = new SessionBuilder(store, recipientAddress)
    await sessionBuilder.processPreKey(preKeyBundle)

    // 2. 加密消息
    const sessionCipher = new SessionCipher(store, recipientAddress)
    const ciphertext = await sessionCipher.encrypt(message)

    // 3. 发送
    await send(ciphertext)
}

// 接收方
async function receiveMessage(senderAddress, ciphertext) {
    const sessionCipher = new SessionCipher(store, senderAddress)
    const plaintext = await sessionCipher.decrypt(ciphertext)
    return plaintext
}
```

**特性**:
- ✅ 端到端加密
- ✅ 前向安全（Forward Secrecy）
- ✅ 未来安全（Future Secrecy）
- ✅ 可验证性
- ✅ 可否认性

### 双棘轮算法

Signal协议的核心是双棘轮算法：

```
Alice                                    Bob
  │                                       │
  │ ┌─────────────────────────────────┐  │
  ├─┤ DH棘轮: 每次对话生成新的DH密钥对 │  │
  │ └─────────────────────────────────┘  │
  │                                       │
  │ ┌─────────────────────────────────┐  │
  ├─┤ 对称密钥棘轮: 每条消息派生新密钥 │──┤
  │ └─────────────────────────────────┘  │
  │                                       │
  │  加密消息1 (密钥K1)                   │
  ├──────────────────────────────────────>│
  │  加密消息2 (密钥K2, K2≠K1)            │
  ├──────────────────────────────────────>│
  │                          加密消息3     │
  │<──────────────────────────────────────┤
```

**优势**:
- 每条消息使用不同密钥
- 密钥泄露只影响部分消息
- 自我修复能力

## 密钥管理

### 密钥层次结构

```
主密钥 (Master Key, 256-bit)
  │ 由U盾/SIMKey生成和保护
  │ 永不导出
  │
  ├─ HKDF-SHA256派生
  │
  ├─ 数据库加密密钥 (DB_Key)
  │   └─ 用于SQLCipher
  │
  ├─ 文件加密密钥 (File_Key)
  │   └─ 用于AES-256-GCM文件加密
  │
  ├─ Git加密密钥 (Git_Key)
  │   └─ 用于git-crypt
  │
  ├─ 设备签名密钥 (Sign_Key)
  │   └─ 用于Ed25519签名
  │
  └─ 设备加密密钥 (Encrypt_Key)
      └─ 用于X25519密钥交换
```

### 密钥派生

使用HKDF（HMAC-based Key Derivation Function）：

```typescript
import { hkdf } from '@noble/hashes/hkdf'
import { sha256 } from '@noble/hashes/sha256'

function deriveKey(masterKey: Uint8Array, purpose: string): Uint8Array {
    const info = Buffer.from(purpose, 'utf8')
    const salt = Buffer.from('chainlesschain-v1')

    return hkdf(sha256, masterKey, salt, info, 32)  // 派生32字节密钥
}

// 派生不同用途的密钥
const dbKey = deriveKey(masterKey, 'database-encryption')
const fileKey = deriveKey(masterKey, 'file-encryption')
const gitKey = deriveKey(masterKey, 'git-encryption')
```

### 密钥存储

```
密钥存储位置:

PC端:
  ├─ U盾安全芯片（主密钥）
  │   - 永不导出
  │   - PIN码保护
  │
  ├─ 操作系统密钥链（派生密钥）
  │   - Windows: DPAPI
  │   - macOS: Keychain
  │   - Linux: libsecret
  │
  └─ 配置文件（加密后的密钥）
      - 使用主密钥加密

移动端:
  ├─ SIMKey（主密钥）
  │   - SIM卡安全芯片
  │   - PIN码保护
  │
  ├─ Android Keystore / iOS Keychain（派生密钥）
  │
  └─ 应用沙箱（加密后的密钥）
```

## 密码学算法

### 对称加密

| 算法 | 密钥长度 | 用途 | 安全等级 |
|------|----------|------|----------|
| AES-256-GCM | 256-bit | 文件加密 | ⭐⭐⭐⭐⭐ |
| AES-256-CBC | 256-bit | 数据库加密 | ⭐⭐⭐⭐⭐ |
| ChaCha20-Poly1305 | 256-bit | P2P通信 | ⭐⭐⭐⭐⭐ |

### 非对称加密

| 算法 | 密钥长度 | 用途 | 安全等级 |
|------|----------|------|----------|
| Ed25519 | 256-bit | 数字签名 | ⭐⭐⭐⭐⭐ |
| X25519 | 256-bit | 密钥交换 | ⭐⭐⭐⭐⭐ |
| RSA-4096 | 4096-bit | U盾签名 | ⭐⭐⭐⭐ |

### 哈希函数

| 算法 | 输出长度 | 用途 | 碰撞抗性 |
|------|----------|------|----------|
| SHA-256 | 256-bit | 通用哈希 | ⭐⭐⭐⭐⭐ |
| SHA-512 | 512-bit | HMAC | ⭐⭐⭐⭐⭐ |
| BLAKE3 | 256-bit | 文件完整性 | ⭐⭐⭐⭐⭐ |

### 密钥派生

| 算法 | 迭代次数 | 用途 | 抗暴力破解 |
|------|----------|------|------------|
| PBKDF2-SHA512 | 256,000 | 数据库密钥 | ⭐⭐⭐⭐ |
| HKDF-SHA256 | - | 子密钥派生 | ⭐⭐⭐⭐⭐ |
| Argon2id | - | 密码哈希 | ⭐⭐⭐⭐⭐ |

## 安全特性

### 前向安全

即使密钥泄露，也无法解密过去的消息：

```
时间线:
t1: Alice ─(消息1, 密钥K1)→ Bob
t2: Alice ─(消息2, 密钥K2)→ Bob
t3: Alice ─(消息3, 密钥K3)→ Bob
t4: ⚠️ K3泄露

影响:
✓ 消息1和消息2仍然安全 (K1, K2无法从K3推导)
✗ 消息3可被解密
✓ 未来消息仍然安全 (使用新密钥K4, K5...)
```

### 可验证性

所有加密操作都可验证：

```typescript
// 1. 加密 + 签名
function encryptAndSign(data: Buffer, encryptKey: Buffer, signKey: Buffer) {
    // 加密
    const encrypted = encrypt(data, encryptKey)

    // 签名
    const signature = sign(encrypted, signKey)

    return { encrypted, signature }
}

// 2. 验证 + 解密
function verifyAndDecrypt(encrypted: Buffer, signature: Buffer,
                           decryptKey: Buffer, verifyKey: Buffer) {
    // 验证签名
    if (!verify(encrypted, signature, verifyKey)) {
        throw new Error('签名验证失败')
    }

    // 解密
    return decrypt(encrypted, decryptKey)
}
```

### 防重放攻击

使用nonce和时间戳：

```typescript
interface EncryptedMessage {
    ciphertext: Buffer
    nonce: Buffer  // 随机数，确保唯一性
    timestamp: number  // 时间戳
    signature: Buffer
}

function validateMessage(msg: EncryptedMessage) {
    // 1. 检查时间戳（5分钟内有效）
    if (Date.now() - msg.timestamp > 5 * 60 * 1000) {
        throw new Error('消息已过期')
    }

    // 2. 检查nonce是否已使用
    if (nonceCache.has(msg.nonce)) {
        throw new Error('检测到重放攻击')
    }

    // 3. 记录nonce
    nonceCache.add(msg.nonce)

    return true
}
```

## 性能优化

### 硬件加速

使用硬件AES加速：

```typescript
import { createCipheriv } from 'crypto'

// Node.js会自动使用硬件AES-NI（如果可用）
const cipher = createCipheriv('aes-256-gcm', key, iv)

// 性能提升: 3-5倍
```

### 批量加密

```typescript
// 不推荐：逐个文件加密
files.forEach(file => {
    encrypt(file)
})

// 推荐：批量加密
encryptBatch(files, {
    parallel: 4,  // 4个并行任务
    chunkSize: 1024 * 1024  // 1MB chunks
})
```

## 审计和合规

### 加密审计日志

```typescript
interface EncryptionLog {
    timestamp: number
    operation: 'encrypt' | 'decrypt' | 'sign' | 'verify'
    dataType: string
    algorithm: string
    keyId: string
    success: boolean
    error?: string
}

// 记录所有加密操作
logger.log({
    timestamp: Date.now(),
    operation: 'encrypt',
    dataType: 'database',
    algorithm: 'AES-256-CBC',
    keyId: 'db_key_v1',
    success: true
})
```

### 密钥轮换

定期更换密钥（建议每年一次）：

```
设置 → 安全 → 密钥管理 → 密钥轮换

步骤:
1. 生成新密钥
2. 使用新密钥重新加密所有数据
3. 安全删除旧密钥
4. 更新密钥引用
5. 同步到所有设备
```

### 合规性

ChainlessChain加密符合以下标准：

- ✅ **FIPS 140-2**: 美国联邦信息处理标准
- ✅ **PCI DSS**: 支付卡行业数据安全标准
- ✅ **GDPR**: 欧盟通用数据保护条例
- ✅ **等保2.0**: 中国网络安全等级保护

## 常见问题

### 加密会影响性能吗?

```
影响很小:
- 现代CPU支持AES-NI硬件加速
- 加密开销 < 5%
- 用户基本感知不到

实测数据:
- 1GB文件加密: ~2秒
- 数据库查询: 延迟 < 1ms
- 消息加密: 延迟 < 10ms
```

### 如果忘记密码/丢失U盾怎么办?

```
如果有备份:
✓ 使用助记词恢复
✓ 使用备份U盾
✓ 使用PUK码重置

如果没有备份:
❌ 无法恢复数据
❌ 所有加密数据永久丢失

所以备份非常重要！
```

### 量子计算会破解加密吗?

```
当前:
✓ AES-256: 量子安全
✓ SHA-256/512: 量子安全
✗ RSA-4096: 量子不安全
✗ ECC: 量子不安全

未来计划:
- 迁移到抗量子算法
- Kyber (密钥交换)
- Dilithium (签名)
- SPHINCS+ (哈希签名)
```

## 最佳实践

1. ✅ **定期备份密钥**: 助记词、备份U盾
2. ✅ **强密码**: 使用复杂的PIN码
3. ✅ **密钥轮换**: 每年更换一次密钥
4. ✅ **审计日志**: 定期检查加密日志
5. ✅ **及时更新**: 使用最新版本修复安全漏洞

## 未来功能

- [ ] 后量子密码学算法
- [ ] 零知识证明
- [ ] 同态加密（计算加密数据）
- [ ] 多方安全计算
- [ ] 硬件安全模块(HSM)集成
