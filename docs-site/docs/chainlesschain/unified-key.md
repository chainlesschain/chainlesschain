# 统一密钥管理 + FIDO2 + 跨平台 USB

> **Phase 45 | v1.1.0-alpha | 8 IPC 处理器 | 2 张新数据库表**

## 概述

Phase 45 引入统一密钥管理系统,支持 BIP-32 分层确定性密钥派生、FIDO2/WebAuthn 无密码认证、跨平台 USB 通信。

**核心目标**:
- 🔑 **BIP-32 密钥派生**: 单一主密钥派生无限子密钥
- 🔐 **FIDO2/WebAuthn**: W3C 标准无密码认证
- 🔌 **跨平台 USB**: Windows/macOS/Linux 统一通信层
- 🚀 **驱动扩展**: 5个新驱动类型

---

## BIP-32 密钥派生

### 什么是 BIP-32?

BIP-32 (Bitcoin Improvement Proposal 32) 是分层确定性 (HD) 密钥派生标准。

**优势**:
- ✅ 单个主密钥派生无限子密钥
- ✅ 用途隔离 (签名/加密/认证)
- ✅ 密钥备份简单 (只需备份主密钥)
- ✅ 支持密钥轮换

### 派生路径

标准派生路径: `m/44'/0'/0'/purpose/index`

```
m/44'/0'/0'/0/0  →  第1个签名密钥
m/44'/0'/0'/0/1  →  第2个签名密钥
m/44'/0'/0'/1/0  →  第1个加密密钥
m/44'/0'/0'/2/0  →  第1个认证密钥
```

**用途编号**:
- `0` - 签名 (Signing)
- `1` - 加密 (Encryption)
- `2` - 认证 (Authentication)

### 使用示例

```javascript
// 生成主密钥
const masterKey = await window.electronAPI.invoke('ukey:generate-master-key', {
  password: 'strong-password-123'
})

// 派生签名密钥
const signingKey = await window.electronAPI.invoke('ukey:derive-purpose-key', {
  purpose: 'signing',
  index: 0
})

console.log(signingKey)
// {
//   keyId: 'key-abc123',
//   publicKey: '0x...',
//   derivationPath: 'm/44\'/0\'/0\'/0/0'
// }

// 使用密钥签名
const signature = await window.electronAPI.invoke('ukey:sign', {
  keyId: signingKey.keyId,
  data: 'message to sign'
})

// 密钥轮换 (生成新密钥)
const newKey = await window.electronAPI.invoke('ukey:rotate-key', {
  keyId: signingKey.keyId
})
```

---

## FIDO2 / WebAuthn

### 什么是 FIDO2?

FIDO2 是由 FIDO Alliance 和 W3C 联合制定的无密码认证标准。

**核心组件**:
- **WebAuthn** - W3C 标准浏览器 API
- **CTAP2** - 客户端到认证器协议

**优势**:
- ✅ 无密码登录 (Passkey)
- ✅ 抗钓鱼攻击
- ✅ 硬件级安全
- ✅ 跨设备同步 (Resident Keys)

### 注册流程

```javascript
// 1. 创建凭证 (注册)
const credential = await window.electronAPI.invoke('ukey:fido2-make-credential', {
  rpId: 'example.com',
  userHandle: 'user-123',
  challenge: randomChallenge,
  displayName: 'Alice'
})

console.log(credential)
// {
//   credentialId: 'cred-abc123',
//   publicKey: '0x...',
//   aaguid: '00000000-0000-0000-0000-000000000000'
// }
```

### 认证流程

```javascript
// 2. 获取断言 (认证)
const assertion = await window.electronAPI.invoke('ukey:fido2-get-assertion', {
  rpId: 'example.com',
  challenge: randomChallenge
})

console.log(assertion)
// {
//   credentialId: 'cred-abc123',
//   signature: '0x...',
//   userHandle: 'user-123',
//   signCount: 1
// }

// 3. 验证签名
const isValid = verifySignature(
  assertion.signature,
  challenge,
  credential.publicKey
)
```

### Resident Keys (Passkey)

Resident Keys 存储在设备上,支持跨设备同步:

```javascript
// 列出所有 Resident Keys
const keys = await window.electronAPI.invoke('ukey:fido2-list-credentials')

keys.forEach(key => {
  console.log(`${key.rpId}: ${key.userHandle}`)
})

// 删除 Resident Key
await window.electronAPI.invoke('ukey:fido2-delete-credential', {
  credentialId: 'cred-abc123'
})
```

---

## 跨平台 USB 通信

### 平台支持

| 平台 | 实现方式 | 状态 |
|------|---------|------|
| **Windows** | node-usb (libusb-win32) | ✅ |
| **macOS** | IOKit (via Koffi FFI) | ✅ |
| **Linux** | libusb | ✅ |
| **Web** | WebUSB API (fallback) | ✅ |

### 设备枚举

```javascript
// 列出所有 USB 设备
const devices = await window.electronAPI.invoke('ukey:usb-list-devices', {
  vendorId: 0x1050 // YubiKey
})

devices.forEach(device => {
  console.log(`${device.manufacturer} ${device.product}`)
  console.log(`  VID: 0x${device.vendorId.toString(16)}`)
  console.log(`  PID: 0x${device.productId.toString(16)}`)
})
```

### APDU 通信

APDU (Application Protocol Data Unit) 是智能卡通信的标准协议。

```javascript
// 打开设备
await window.electronAPI.invoke('ukey:usb-open', {
  deviceId: 'device-123'
})

// 发送 APDU 命令
const response = await window.electronAPI.invoke('ukey:usb-send-apdu', {
  apdu: [0x00, 0xA4, 0x04, 0x00] // SELECT command
})

console.log(response)
// { sw1: 0x90, sw2: 0x00, data: [...] }

// 关闭设备
await window.electronAPI.invoke('ukey:usb-close')
```

---

## 驱动扩展

### 新增驱动类型

**5 个新驱动类型**:

1. **FIDO2Driver** - FIDO2/WebAuthn 设备
   - YubiKey 5 系列
   - Feitian ePass FIDO
   - Google Titan Security Key

2. **BIP32Driver** - BIP-32 密钥派生设备
   - Ledger Nano S/X
   - Trezor Model T
   - 自定义 HD 钱包

3. **TPM2Driver** - TPM 2.0 可信平台模块
   - Windows TPM
   - Linux TPM
   - 企业级 HSM

4. **TEEDriver** - 可信执行环境
   - ARM TrustZone
   - Intel SGX
   - AMD SEV

5. **SatelliteSIMDriver** - 卫星 SIM 卡驱动
   - Starlink SIM
   - Iridium SIM
   - 自定义卫星通信

### 驱动注册

```javascript
// 查看已注册驱动
const drivers = await window.electronAPI.invoke('ukey:list-drivers')

drivers.forEach(driver => {
  console.log(`${driver.type}: ${driver.name}`)
  console.log(`  Capabilities: ${driver.capabilities.join(', ')}`)
})
```

---

## 配置选项

```json
{
  "unifiedKey": {
    "enabled": true,
    "bip32": {
      "coinType": 0,
      "accountIndex": 0,
      "passwordProtected": true
    },
    "fido2": {
      "rpId": "chainlesschain.local",
      "rpName": "ChainlessChain",
      "timeout": 30000,
      "userVerification": "preferred"
    },
    "usb": {
      "vendorIds": [4176, 2446],
      "reconnectAttempts": 3,
      "reconnectDelay": 1000
    }
  }
}
```

---

## 使用场景

### 场景 1: 设置无密码登录

```javascript
// 1. 注册 FIDO2 凭证
const credential = await window.electronAPI.invoke('ukey:fido2-make-credential', {
  rpId: 'myapp.com',
  userHandle: 'user-123',
  challenge: randomBytes(32),
  displayName: '张三'
})

// 2. 保存 credentialId 到服务器

// 3. 下次登录时验证
const assertion = await window.electronAPI.invoke('ukey:fido2-get-assertion', {
  rpId: 'myapp.com',
  challenge: randomBytes(32)
})

// 4. 验证签名完成登录
```

### 场景 2: 密钥派生和轮换

```javascript
// 1. 首次设置 - 生成主密钥
await window.electronAPI.invoke('ukey:generate-master-key', {
  password: userPassword
})

// 2. 派生签名密钥
const key1 = await window.electronAPI.invoke('ukey:derive-purpose-key', {
  purpose: 'signing',
  index: 0
})

// 3. 使用密钥签名
const sig = await window.electronAPI.invoke('ukey:sign', {
  keyId: key1.keyId,
  data: 'important data'
})

// 4. 定期轮换 (90天后)
const key2 = await window.electronAPI.invoke('ukey:rotate-key', {
  keyId: key1.keyId
})
```

---

## 安全考虑

1. **主密钥保护**: PBKDF2 (100,000迭代) + AES-256 加密
2. **Hardened 派生**: BIP-32 使用 hardened 派生路径
3. **PIN 保护**: FIDO2 PIN 使用 BCrypt 哈希存储
4. **APDU 验证**: USB 命令使用 CRC 校验
5. **设备白名单**: 仅允许已知 vendorId/productId

---

## 性能指标

| 指标 | 目标 | 实际 |
|------|------|------|
| 密钥派生延迟 | <50ms | ~30ms |
| FIDO2 MakeCredential | <500ms | ~400ms |
| FIDO2 GetAssertion | <300ms | ~250ms |
| USB APDU 往返 | <100ms | ~80ms |

---

## 相关文档

- [U盾/SIMKey 基础](/chainlesschain/ukey)
- [SIMKey 企业版](/chainlesschain/simkey-enterprise)
- [加密系统](/chainlesschain/encryption)
- [产品路线图](/chainlesschain/product-roadmap)

---

**文档版本**: 1.0.0
**最后更新**: 2026-02-27
