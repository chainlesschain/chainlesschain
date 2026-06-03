# 统一密钥管理 + FIDO2 + 跨平台 USB

> **Phase 45 | v1.1.0-alpha | 8 IPC 处理器 | 2 张新数据库表**

## 核心特性

- 🔑 **BIP-32 密钥派生**: 单一主密钥派生无限子密钥，用途隔离（签名/加密/认证）
- 🔐 **FIDO2/WebAuthn**: W3C 标准无密码认证，抗钓鱼攻击，支持 Passkey
- 🔌 **跨平台 USB**: Windows/macOS/Linux/Web 四平台统一 APDU 通信层
- 🚀 **5 种新驱动**: FIDO2/BIP32/TPM2/TEE/SatelliteSIM 驱动扩展
- 🔄 **密钥轮换**: 自动密钥轮换，无缝切换新旧密钥

## 系统架构

```
┌──────────────────────────────────────────────┐
│            统一密钥管理系统                     │
│                                              │
│  ┌──────────┐ ┌──────────┐ ┌──────────────┐ │
│  │ BIP-32   │ │ FIDO2    │ │ 跨平台 USB   │ │
│  │ 密钥派生 │ │ WebAuthn │ │ APDU 通信    │ │
│  └────┬─────┘ └────┬─────┘ └──────┬───────┘ │
│       │            │              │          │
│       ▼            ▼              ▼          │
│  ┌──────────────────────────────────────┐    │
│  │       驱动抽象层 (5 种驱动)           │    │
│  │  FIDO2 | BIP32 | TPM2 | TEE | SIM   │    │
│  └──────────────────┬───────────────────┘    │
│                     ▼                        │
│  ┌──────────────────────────────────────┐    │
│  │     硬件安全层                        │    │
│  │  U-Key 芯片 | YubiKey | HSM | TPM   │    │
│  └──────────────────────────────────────┘    │
└──────────────────────────────────────────────┘
```

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
  password: userInputPassword
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

## 故障排查

### 主密钥生成失败

**现象**: `ukey:generate-master-key` 调用报错或超时。

**排查步骤**:

1. 确认硬件 U-Key 已插入且驱动正常（使用 `ukey:list-drivers` 检查）
2. 检查密码是否满足最低复杂度要求
3. 如果使用 TPM2 驱动，确认 BIOS 中 TPM 已启用
4. 查看日志中 `[UnifiedKeyManager]` 前缀的错误信息

### FIDO2 凭证注册失败

**现象**: `ukey:fido2-make-credential` 返回错误。

**排查步骤**:

1. 确认 FIDO2 设备已插入且被系统识别（如 YubiKey 指示灯闪烁）
2. 检查 `rpId` 配置是否与当前域名匹配
3. 确认设备存储空间未满（Resident Keys 数量有限）
4. 超时时间不足时增大 `timeout` 参数（默认 30000ms）

### USB APDU 通信失败

**现象**: 发送 APDU 命令后收到错误响应码。

**排查步骤**:

1. 检查返回的 SW1/SW2 状态字：`6A82` 表示应用未找到，`6982` 表示安全状态不满足
2. 确认已正确选择目标 Applet（先发送 SELECT 命令）
3. Windows 上检查是否存在驱动冲突（多个 USB 安全设备管理器）
4. 尝试拔插设备或使用不同 USB 接口

### 密钥轮换后旧签名验证失败

**现象**: 轮换密钥后，使用旧密钥签名的数据无法验证。

**排查步骤**:

1. 密钥轮换后旧密钥仍保留在系统中，确认验证时使用了对应的旧公钥
2. 检查 DID 文档是否已更新并包含新旧双公钥
3. 确认对方客户端已拉取最新的 DID 文档

## 配置参考

`.chainlesschain/config.json` 中 `unifiedKey` 字段的完整说明：

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `enabled` | boolean | `true` | 是否启用统一密钥管理模块 |
| `bip32.coinType` | number | `0` | BIP-44 币种编号（0 = Bitcoin 路径兼容） |
| `bip32.accountIndex` | number | `0` | BIP-44 账户索引（多账户时递增） |
| `bip32.passwordProtected` | boolean | `true` | 主密钥是否需要密码保护（PBKDF2 派生） |
| `fido2.rpId` | string | `"chainlesschain.local"` | 依赖方 ID，必须与应用域名匹配 |
| `fido2.rpName` | string | `"ChainlessChain"` | 依赖方显示名称 |
| `fido2.timeout` | number (ms) | `30000` | FIDO2 操作超时（毫秒） |
| `fido2.userVerification` | string | `"preferred"` | 用户验证策略：`required` / `preferred` / `discouraged` |
| `usb.vendorIds` | number[] | `[4176, 2446]` | 允许连接的 USB 设备厂商 ID 白名单（十进制） |
| `usb.reconnectAttempts` | number | `3` | USB 断连后自动重连次数 |
| `usb.reconnectDelay` | number (ms) | `1000` | 相邻重连间隔（毫秒） |

**最小配置示例**（仅 BIP-32，不启用 FIDO2 和 USB）：

```json
{
  "unifiedKey": {
    "enabled": true,
    "bip32": {
      "coinType": 0,
      "accountIndex": 0,
      "passwordProtected": true
    },
    "fido2": { "timeout": 30000, "userVerification": "discouraged" },
    "usb": { "vendorIds": [], "reconnectAttempts": 0 }
  }
}
```

**企业高安全配置**（强制用户验证 + 严格厂商白名单）：

```json
{
  "unifiedKey": {
    "enabled": true,
    "bip32": {
      "coinType": 60,
      "accountIndex": 0,
      "passwordProtected": true
    },
    "fido2": {
      "rpId": "corp.example.com",
      "rpName": "Corp Secure Auth",
      "timeout": 60000,
      "userVerification": "required"
    },
    "usb": {
      "vendorIds": [4176],
      "reconnectAttempts": 5,
      "reconnectDelay": 2000
    }
  }
}
```

---

## 测试覆盖率

### 测试文件

| 测试文件 | 覆盖范围 | 用例数 |
|----------|----------|--------|
| `desktop-app-vue/tests/unit/ukey/unified-key-manager.test.js` | BIP-32 派生路径、密钥轮换、主密钥生成 | 22 |
| `desktop-app-vue/tests/unit/ukey/fido2-driver.test.js` | MakeCredential、GetAssertion、Resident Keys、PIN 保护 | 20 |
| `desktop-app-vue/tests/unit/ukey/usb-transport.test.js` | 设备枚举、APDU 收发、平台适配、错误状态字处理 | 18 |
| `desktop-app-vue/tests/unit/ukey/driver-registry.test.js` | 驱动注册、能力查询、5 种驱动类型 | 10 |
| `desktop-app-vue/src/renderer/stores/__tests__/unifiedKey.test.ts` | Pinia store 状态流转与 IPC 调用 | 12 |

**合计**: 82 个测试用例

### 运行测试

```bash
# 所有统一密钥测试
cd desktop-app-vue && npx vitest run tests/unit/ukey/unified-key-manager.test.js \
  tests/unit/ukey/fido2-driver.test.js \
  tests/unit/ukey/usb-transport.test.js \
  tests/unit/ukey/driver-registry.test.js

# Pinia store 测试
cd desktop-app-vue && npx vitest run src/renderer/stores/__tests__/unifiedKey.test.ts
```

### 关键测试场景

```javascript
// 1. BIP-32 派生路径确定性
it('derives deterministic keys from the same master', async () => {
  const key1 = await unifiedKeyManager.derivePurposeKey('signing', 0)
  const key2 = await unifiedKeyManager.derivePurposeKey('signing', 0)
  expect(key1.publicKey).toBe(key2.publicKey)
  expect(key1.derivationPath).toBe("m/44'/0'/0'/0/0")
})

// 2. FIDO2 注册后可成功断言
it('asserts after credential registration', async () => {
  const challenge = crypto.randomBytes(32)
  const cred = await fido2Driver.makeCredential({
    rpId: 'test.local', userHandle: 'u1', challenge, displayName: 'Test'
  })
  const assertion = await fido2Driver.getAssertion({ rpId: 'test.local', challenge })
  expect(assertion.credentialId).toBe(cred.credentialId)
})

// 3. APDU SW1/SW2 错误码解析
it('parses APDU error status words correctly', async () => {
  mockUsb.setResponse([0x6A, 0x82]) // File or application not found
  await expect(usbTransport.sendApdu([0x00, 0xA4, 0x04, 0x00]))
    .rejects.toThrow('6A82')
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

## 使用示例

```javascript
// 1. BIP-32 派生子密钥（hardened）
const child = await window.electronAPI.invoke('ukey:bip32:derive', {
  rootRef: 'master', path: "m/44'/60'/0'/0/0"
})

// 2. FIDO2 MakeCredential（注册硬件密钥）
const cred = await window.electronAPI.invoke('ukey:fido2:make-credential', {
  rp: { id: 'chainlesschain.local', name: 'ChainlessChain' },
  user: { id: '<uid>', name: 'alice' }, pinProtected: true
})

// 3. FIDO2 GetAssertion（登录）
const asrt = await window.electronAPI.invoke('ukey:fido2:get-assertion', {
  rpId: 'chainlesschain.local', challenge: '<nonce>'
})

// 4. 跨平台 USB APDU 通信
await window.electronAPI.invoke('ukey:usb:connect', {
  vendorId: 0x1050, productId: 0x0407
})
const resp = await window.electronAPI.invoke('ukey:usb:send-apdu', {
  cla: 0x00, ins: 0xA4, p1: 0x04, p2: 0x00, data: '<aid>'
})

// 5. 驱动注册（第三方 U 盾接入）
await window.electronAPI.invoke('ukey:driver:register', {
  name: 'MyVendorDriver', module: '/path/to/driver.js'
})
```

---

## 相关文档

- [U盾/SIMKey 基础](/chainlesschain/ukey)
- [SIMKey 企业版](/chainlesschain/simkey-enterprise)
- [加密系统](/chainlesschain/encryption)
- [产品路线图](/chainlesschain/product-roadmap)

---

## 关键文件

| 文件 | 职责 |
|------|------|
| `desktop-app-vue/src/main/ukey/unified-key-manager.js` | BIP-32 密钥派生与统一管理 |
| `desktop-app-vue/src/main/ukey/fido2-driver.js` | FIDO2/WebAuthn 认证驱动 |
| `desktop-app-vue/src/main/ukey/usb-transport.js` | 跨平台 USB APDU 通信层 |
| `desktop-app-vue/src/main/ukey/driver-registry.js` | 驱动注册与管理 |
| `desktop-app-vue/src/renderer/stores/unifiedKey.ts` | Pinia 状态管理 |

---

**文档版本**: 1.0.0
**最后更新**: 2026-02-27
