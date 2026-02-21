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

### v0.38.0 — 后量子密码学 (Post-Quantum Cryptography)

**目标**: 应对量子计算威胁，在现有加密体系基础上引入 NIST 标准化的抗量子算法，实现平滑迁移

#### CRYSTALS-Kyber 密钥封装

- [ ] **混合密钥交换** — 在 P2P 通信和 WebRTC DataChannel 中采用 X25519 + Kyber-768 混合方案，确保经典安全与量子安全并存
- [ ] **Kyber KEM 集成** — 替代纯 X25519 密钥交换，用于 Signal 协议的初始密钥协商（PreKeyBundle 扩展）
- [ ] **密钥封装 API** — 在 `crypto-toolkit` 技能中新增 `--pq-keygen` / `--pq-encapsulate` / `--pq-decapsulate` 命令

```typescript
// 混合密钥交换示例
interface HybridKeyExchange {
    classical: X25519KeyPair    // 经典密钥（向后兼容）
    postQuantum: KyberKeyPair   // 后量子密钥（抗量子攻击）
    sharedSecret: Buffer        // HKDF(classical_ss || pq_ss)
}
```

#### CRYSTALS-Dilithium 数字签名

- [ ] **混合签名方案** — Ed25519 + Dilithium3 双签名，DID 文档同时包含经典和后量子公钥
- [ ] **U盾固件升级** — 与华大/飞天合作，在安全芯片中实现 Dilithium 签名运算（SM2 + Dilithium 双轨）
- [ ] **签名验证兼容层** — 旧版客户端仅验证 Ed25519 签名，新版同时验证双签名

#### SPHINCS+ 哈希签名

- [ ] **长期文档签名** — 对需要长期（10年+）保存的法律文档、合同等使用 SPHINCS+-256s 签名（纯哈希构造，最强抗量子）
- [ ] **Git 仓库签名** — git-crypt 密钥和 commit 签名可选 SPHINCS+ 后量子模式

#### 迁移工具

- [ ] **加密审计扫描** — 自动扫描数据库和文件系统中使用的算法，标记需要升级的非量子安全组件（RSA-4096、ECDSA）
- [ ] **一键迁移向导** — 设置 → 安全 → 量子迁移，自动将密钥对升级为混合方案，重新加密敏感数据
- [ ] **兼容性回退** — 对端不支持后量子算法时自动降级为经典算法，记录告警日志

---

### v0.39.0 — 零知识证明 (Zero-Knowledge Proofs)

**目标**: 实现隐私保护的身份验证和数据校验，"证明你知道，但不泄露你知道什么"

#### ZK-SNARK 身份验证

- [ ] **DID 匿名凭证** — 基于 Groth16 证明系统，实现"证明持有有效 DID 但不暴露具体 DID 标识符"的匿名认证
- [ ] **年龄/资格证明** — 选择性披露：证明"年龄 ≥ 18"而不暴露准确出生日期，证明"账户余额 ≥ X"而不暴露实际余额
- [ ] **SSO 隐私增强** — SAML/OIDC 登录时，用 ZKP 向服务方证明身份有效性，减少个人信息泄露

```typescript
// 零知识身份验证流程
interface ZKAuthProof {
    statement: string         // "我持有有效的ChainlessChain DID"
    proof: Uint8Array         // zk-SNARK proof（~200字节）
    publicInputs: string[]    // 公开输入（验证者需要的最小信息）
    // 不包含: DID私钥、具体身份信息、属性值
}
```

#### ZK-Rollup 交易隐私

- [ ] **隐私交易** — 去中心化交易模块中引入 ZK-Rollup，交易金额和参与方对第三方不可见
- [ ] **批量验证** — 将多笔交易压缩为单个 ZK 证明，链上验证成本降低 90%
- [ ] **可审计性** — 监管方持有审计密钥，可选择性查看交易细节（合规要求）

#### ZK 数据验证

- [ ] **文件完整性证明** — 生成 ZK 证明表示"文件符合特定格式/规则"，无需暴露文件内容
- [ ] **知识库查询隐私** — RAG 搜索时，证明查询结果来自合法知识库但不暴露查询内容
- [ ] **跨设备同步验证** — P2P 同步时用 ZK 证明数据一致性，减少明文传输

#### 开发者工具

- [ ] **ZKP 电路编辑器** — 可视化编辑 Circom/Noir 电路，集成到 Browser Automation 工作流
- [ ] **证明生成技能** — 新增 `zkp-toolkit` 技能：`/zkp-toolkit --prove` / `--verify` / `--keygen`
- [ ] **基准测试** — 不同证明系统（Groth16 / PLONK / STARKs）的性能对比仪表板

---

### v0.40.0 — 同态加密 (Homomorphic Encryption)

**目标**: 支持在加密数据上直接进行计算，实现"数据可用不可见"

#### 部分同态加密 (PHE)

- [ ] **Paillier 加法同态** — 在加密数据上执行求和、计数、平均值等聚合操作，适用于隐私统计
- [ ] **加密搜索** — 对加密的知识库文档执行关键词搜索，服务端无法获知搜索内容和结果
- [ ] **隐私评分** — 去中心化交易中的信用评分计算在密文上完成，评分方无法看到原始数据

```typescript
// 同态加密统计示例
interface HomomorphicStats {
    encryptedValues: PaillierCiphertext[]  // 加密的数值序列
    encryptedSum: PaillierCiphertext       // 加密求和（密文上计算）
    encryptedCount: PaillierCiphertext     // 加密计数
    // 解密后得到: sum, count → average = sum / count
    // 计算方全程无法获知单个值
}
```

#### 全同态加密 (FHE) 探索

- [ ] **TFHE 库集成** — 基于 TFHE-rs (WebAssembly 编译)，在浏览器中实现布尔电路级 FHE
- [ ] **加密 SQL 查询** — 在 SQLCipher 基础上增加 FHE 层，支持对加密字段的条件查询和排序
- [ ] **AI 隐私推理** — LLM 推理输入加密传输，Ollama 本地推理中间态保护（实验性）

#### 应用场景

- [ ] **隐私数据分析** — `data-analysis` 技能支持对加密 CSV/JSON 执行统计分析
- [ ] **安全多方统计** — 多个 Cowork 代理各自持有加密数据，协同计算聚合结果
- [ ] **加密备份验证** — 云端备份保持加密，可在不解密的情况下验证数据完整性和一致性

#### 性能优化

- [ ] **GPU 加速** — CUDA/Metal 加速同态运算，FHE 计算时间从分钟级降至秒级
- [ ] **分层策略** — 热数据用 PHE（快速），冷数据用 FHE（安全），自动分级

---

### v0.41.0 — 多方安全计算 (Secure Multi-Party Computation)

**目标**: 多个参与方在不泄露各自私密输入的情况下，共同计算出正确结果

#### 秘密共享 (Secret Sharing)

- [ ] **Shamir 秘密分享** — 将 U盾主密钥拆分为 N 份（阈值 T），任意 T 份可恢复，少于 T 份无法获取任何信息
- [ ] **社交恢复** — 用户丢失 U盾时，N 个可信联系人各持有一份密钥碎片，T 人协作即可恢复账户
- [ ] **分布式密钥生成 (DKG)** — 多设备联合生成主密钥，任何单一设备都不持有完整密钥

```typescript
// Shamir秘密共享
interface ShamirConfig {
    threshold: number  // T: 恢复所需最少碎片数
    shares: number     // N: 总碎片数
    // 推荐: T=3, N=5 (5个信任方，任意3个可恢复)
}

// 社交恢复流程
// 1. 用户选择5位可信联系人
// 2. 主密钥拆分为5份，每人持有1份（加密传输）
// 3. 恢复时: 联系至少3位 → 各自提交碎片 → 重建主密钥
```

#### 安全多方计算协议

- [ ] **Garbled Circuit (混淆电路)** — 两方安全计算，适用于 P2P 交易中的价格匹配（买卖双方不暴露底价）
- [ ] **Oblivious Transfer (不经意传输)** — 发送方不知道接收方选择了哪个数据，接收方只获得所选数据
- [ ] **SPDZ 协议** — 多方通用安全计算框架，支持加法和乘法门电路

#### 跨设备 MPC

- [ ] **分布式签名 (TSS)** — 跨桌面端、Android、iOS 三端的阈值签名，私钥碎片分散存储在不同设备
- [ ] **联合身份验证** — 多设备联合认证，即使一台设备被攻破也无法伪造签名
- [ ] **P2P MPC 通道** — 基于现有 WebRTC DataChannel 建立 MPC 通信通道，支持低延迟安全计算

#### 实际应用

- [ ] **隐私拍卖** — 去中心化交易中的密封拍卖，出价加密提交，仅揭示中标结果
- [ ] **联合机器学习** — 多个 Cowork 代理在不共享训练数据的前提下联合训练模型（联邦学习 + MPC）
- [ ] **合规数据共享** — 企业间数据协作时，仅计算交集/统计量，不暴露原始数据集

---

### v0.42.0 — 硬件安全模块 (HSM) 深度集成

**目标**: 从现有 U盾/PKCS#11 基础升级到企业级 HSM 支持，满足金融级安全要求

#### 企业级 HSM 支持

- [ ] **Thales Luna HSM** — 支持 Luna Network HSM 7 系列，FIPS 140-2 Level 3 认证
- [ ] **AWS CloudHSM** — 云端 HSM 集成，支持跨区域密钥同步和灾备
- [ ] **Azure Dedicated HSM** — Microsoft 托管 HSM 服务集成
- [ ] **国密 HSM** — 渔翁信息、江南天安等国产密码机集成（SM2/SM3/SM4 硬件加速）

```
HSM 集成架构:
┌─────────────────────────────────────────────┐
│              应用层 (desktop-app-vue)         │
├─────────────────────────────────────────────┤
│          统一密钥管理器 (key-manager.js)       │
│     ┌──────────────────────────────────┐    │
│     │       HSM 抽象层 (新增)           │    │
│     │  ┌─────┐ ┌─────┐ ┌──────┐      │    │
│     │  │U盾  │ │PKCS │ │云HSM │      │    │
│     │  │驱动 │ │#11  │ │客户端│      │    │
│     │  └──┬──┘ └──┬──┘ └──┬───┘      │    │
│     └─────┼───────┼───────┼──────────┘    │
├───────────┼───────┼───────┼────────────────┤
│  ┌────────┴┐ ┌────┴────┐ ┌┴────────────┐  │
│  │U盾芯片  │ │本地HSM  │ │CloudHSM/KMS│  │
│  │(SKF/芯片)│ │(Luna等) │ │(AWS/Azure) │  │
│  └─────────┘ └─────────┘ └─────────────┘  │
└─────────────────────────────────────────────┘
```

#### 密钥生命周期管理

- [ ] **密钥创建策略** — 基于安全策略自动选择密钥生成位置（U盾 / 本地HSM / 云HSM）
- [ ] **密钥轮换自动化** — 定时密钥轮换，自动重新加密受影响数据，零停机迁移
- [ ] **密钥销毁审计** — 密钥过期或废弃时安全擦除，留下不可逆的销毁证明
- [ ] **密钥备份与恢复** — HSM 间密钥安全复制（M-of-N 授权），支持灾难恢复

#### 高可用与性能

- [ ] **HSM 集群** — 多台 HSM 负载均衡，故障自动切换，99.99% 可用性
- [ ] **批量加密加速** — HSM 硬件加速批量文件加密，吞吐量提升 10x（相比纯软件）
- [ ] **密钥缓存策略** — 安全的内存密钥缓存（短生命周期），减少 HSM 调用延迟

#### 合规认证

- [ ] **FIPS 140-3** — 升级到最新联邦标准认证（Level 3 物理防篡改）
- [ ] **CC EAL4+** — Common Criteria 认证，满足政府和国防需求
- [ ] **GM/T 0028-2014** — 中国密码模块安全技术要求三级认证
- [ ] **PCI HSM** — 支付行业 HSM 安全标准

---

### v0.43.0 — 高级加密特性

**目标**: 引入前沿密码学技术，构建下一代隐私保护基础设施

#### 可搜索加密 (Searchable Encryption)

- [ ] **对称可搜索加密 (SSE)** — 在 SQLCipher 加密数据上建立安全索引，支持关键词搜索而不解密全部数据
- [ ] **模糊搜索** — 支持加密文本的近似匹配搜索（编辑距离 ≤ 2），适用于知识库检索
- [ ] **RAG 加密增强** — 向量嵌入在加密域计算相似度，RAG Manager 全程不接触明文

#### 代理重加密 (Proxy Re-Encryption)

- [ ] **数据共享** — Alice 加密的文件，通过代理重加密密钥转换后，Bob 可用自己的私钥解密，代理无法获知明文
- [ ] **P2P 文件分享** — 去中心化文件传输中，中继节点仅转发重加密密文，无法窥视内容
- [ ] **权限委托** — 与 RBAC Permission Engine 联动，权限委托时自动生成重加密密钥

#### 可验证计算 (Verifiable Computation)

- [ ] **远程计算验证** — Cowork 代理委派到远程设备执行的任务，返回结果附带计算正确性证明
- [ ] **LLM 输出验证** — 验证 AI 模型输出确实由指定模型在指定输入上生成（实验性）
- [ ] **审计证明** — Enterprise Audit Logger 的日志条目附带不可篡改的密码学证明

#### 密码学基础设施

- [ ] **密码敏捷性框架** — 统一的算法注册表，支持运行时切换加密算法（应对未来算法破解）
- [ ] **密钥托管协议** — 企业场景下的密钥托管和紧急访问机制（双人控制原则）
- [ ] **安全随机数增强** — 混合硬件 TRNG（U盾 / Intel RDRAND）和软件 CSPRNG，提升随机数质量

---

### 长期愿景 (2026 H2+)

| 方向 | 目标 | 关键指标 |
|------|------|----------|
| **全面抗量子** | 所有密码学组件升级到后量子安全 | 量子安全覆盖率 100% |
| **隐私计算平台** | ZKP + FHE + MPC 三位一体的隐私保护 | 数据零泄露 |
| **去中心化密钥基础设施** | 基于 DID 的分布式密钥管理网络 | 支持 1000+ 节点 |
| **密码即服务** | 通过 MCP SDK 向第三方提供密码学能力 | API 响应 < 50ms |
| **自适应安全** | 根据威胁情报自动调整加密强度和算法 | 威胁响应 < 1 分钟 |
| **国密全覆盖** | SM2/SM3/SM4/SM9 全系列硬件加速 | 国密合规率 100% |
