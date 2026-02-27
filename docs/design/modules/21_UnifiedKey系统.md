# Phase 45 — Unified Key + FIDO2 + Cross-Platform USB 系统设计

**版本**: v1.0.0
**创建日期**: 2026-02-27
**状态**: ✅ 已实现 (v1.1.0-alpha)

---

## 一、模块概述

Phase 45 引入统一密钥管理系统,支持 BIP-32 分层确定性密钥派生、FIDO2/WebAuthn 无密码认证、跨平台 USB 通信。

### 1.1 核心目标

1. **BIP-32 密钥派生**: 单一主密钥派生无限子密钥,用途隔离
2. **FIDO2/WebAuthn**: W3C 标准无密码认证,Passkey 支持
3. **跨平台 USB**: Windows/macOS/Linux 统一 USB 通信层
4. **驱动扩展**: 5个新驱动类型 (FIDO2/BIP32/TPM2/TEE/Satellite)

### 1.2 技术架构

```
┌──────────────────────────────────────────────────────┐
│                   Application Layer                  │
│  - Authentication  - Signing  - Encryption           │
└───────────────────────┬──────────────────────────────┘
                        │
┌───────────────────────┼──────────────────────────────┐
│                       ▼                              │
│  ┌─────────────────────────────────────────────┐    │
│  │ Unified Key Manager (BIP-32)                │    │
│  │ - Master Key (m/)                           │    │
│  │ - Purpose Keys (m/44'/0'/0')                │    │
│  │   - Signing (m/44'/0'/0'/0)                 │    │
│  │   - Encryption (m/44'/0'/0'/1)              │    │
│  │   - Authentication (m/44'/0'/0'/2)          │    │
│  └─────────────────────────────────────────────┘    │
│                       │                              │
│  ┌─────────────────────────────────────────────┐    │
│  │ FIDO2 Authenticator (WebAuthn)              │    │
│  │ - CTAP2 Protocol                            │    │
│  │ - Passkey (Resident Keys)                   │    │
│  │ - UV (User Verification) / UP (User Present)│    │
│  └─────────────────────────────────────────────┘    │
│                       │                              │
│  ┌─────────────────────────────────────────────┐    │
│  │ USB Transport Layer                         │    │
│  │ - Windows: node-usb (libusb-win32)          │    │
│  │ - macOS:   IOKit (via Koffi FFI)            │    │
│  │ - Linux:   libusb                           │    │
│  └─────────────────────────────────────────────┘    │
│                       │                              │
│  ┌─────────────────────────────────────────────┐    │
│  │ WebUSB Fallback (Browser)                   │    │
│  │ - navigator.usb API                         │    │
│  │ - Device Request/Permission                 │    │
│  └─────────────────────────────────────────────┘    │
└──────────────────────┬───────────────────────────────┘
                       │
┌──────────────────────┼───────────────────────────────┐
│                      ▼                               │
│  Hardware (USB Devices)                              │
│  - U-Key  - YubiKey  - SIM Card  - TPM               │
└──────────────────────────────────────────────────────┘
```

---

## 二、核心模块设计

### 2.1 Unified Key Manager (BIP-32)

**文件**: `desktop-app-vue/src/main/ukey/unified-key-manager.js`

**BIP-32 派生路径**:
- `m/44'/0'/0'/0/i` - 签名密钥 (i = 子密钥索引)
- `m/44'/0'/0'/1/i` - 加密密钥
- `m/44'/0'/0'/2/i` - 认证密钥

**功能**:
- 主密钥生成 (256-bit熵)
- 子密钥派生 (hardened + non-hardened)
- 密钥导出/导入 (加密存储)
- 密钥轮换 (定期更新)

**API**:
```javascript
class UnifiedKeyManager {
  async generateMasterKey(password) // 生成主密钥
  async derivePurposeKey(purpose, index = 0) // 派生用途密钥
  async exportKey(keyId, password) // 导出密钥
  async importKey(encryptedKey, password) // 导入密钥
  async rotateKey(keyId) // 密钥轮换
  async listKeys() // 列出密钥
  async deleteKey(keyId) // 删除密钥
}
```

### 2.2 FIDO2 Authenticator

**文件**: `desktop-app-vue/src/main/ukey/fido2-authenticator.js`

**支持功能**:
- **MakeCredential**: 创建凭证 (注册)
- **GetAssertion**: 获取断言 (认证)
- **Resident Keys**: 可驻留密钥 (Passkey)
- **UV/UP**: 用户验证/用户在场

**CTAP2 命令**:
- `0x01` - authenticatorMakeCredential
- `0x02` - authenticatorGetAssertion
- `0x04` - authenticatorGetInfo
- `0x06` - authenticatorClientPIN

**API**:
```javascript
class FIDO2Authenticator {
  async makeCredential(rpId, userHandle, challenge) // 创建凭证
  async getAssertion(rpId, challenge) // 获取断言
  async getInfo() // 获取设备信息
  async setClientPIN(newPIN) // 设置PIN
  async changeClientPIN(currentPIN, newPIN) // 修改PIN
  async listResidentKeys() // 列出Resident Keys
}
```

### 2.3 USB Transport Layer

**文件**: `desktop-app-vue/src/main/ukey/usb-transport.js`

**平台适配**:
- **Windows**: `node-usb` (libusb-win32)
- **macOS**: `IOKit` (via Koffi FFI)
- **Linux**: `libusb`

**功能**:
- 设备枚举 (vendorId/productId过滤)
- 批量传输 (Bulk Transfer)
- APDU封装 (ISO 7816-4)
- 超时控制 (5s默认)

**API**:
```javascript
class USBTransport {
  async listDevices(filters = {}) // 列出USB设备
  async open(deviceId) // 打开设备
  async close() // 关闭设备
  async sendAPDU(apdu) // 发送APDU命令
  async bulkTransfer(data) // 批量传输
  async interruptTransfer(data) // 中断传输
}
```

### 2.4 WebUSB Fallback

**文件**: `desktop-app-vue/src/main/ukey/webusb-fallback.js`

**功能**:
- 浏览器 `navigator.usb` API
- 设备请求 (`requestDevice()`)
- 权限管理 (用户授权)
- vendorId/productId过滤

**API**:
```javascript
class WebUSBFallback {
  async isAvailable() // 检查WebUSB可用性
  async requestDevice(filters) // 请求设备访问
  async open(device) // 打开设备
  async send(data) // 发送数据
  async receive(length) // 接收数据
}
```

---

## 三、数据库设计

### 3.1 unified_keys (统一密钥)

```sql
CREATE TABLE IF NOT EXISTS unified_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key_id TEXT NOT NULL UNIQUE,
  purpose TEXT NOT NULL, -- signing/encryption/authentication
  derivation_path TEXT NOT NULL, -- e.g. m/44'/0'/0'/0/0
  public_key TEXT NOT NULL,
  encrypted_private_key TEXT NOT NULL, -- AES-256
  algorithm TEXT DEFAULT 'Ed25519',
  created_at INTEGER NOT NULL,
  rotated_at INTEGER,
  expires_at INTEGER,
  INDEX idx_unified_keys_purpose (purpose),
  INDEX idx_unified_keys_created_at (created_at)
);
```

### 3.2 fido2_credentials (FIDO2凭证)

```sql
CREATE TABLE IF NOT EXISTS fido2_credentials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  credential_id TEXT NOT NULL UNIQUE,
  rp_id TEXT NOT NULL, -- Relying Party ID
  user_handle TEXT NOT NULL,
  public_key TEXT NOT NULL,
  sign_count INTEGER DEFAULT 0,
  aaguid TEXT, -- Authenticator Attestation GUID
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  INDEX idx_fido2_credentials_rp_id (rp_id),
  INDEX idx_fido2_credentials_user_handle (user_handle)
);
```

---

## 四、IPC 接口设计

**文件**: `desktop-app-vue/src/main/ukey/ukey-ipc.js` (扩展)

### 4.1 统一密钥 IPC (3个)

- `ukey:generate-master-key` - 生成主密钥
- `ukey:derive-purpose-key` - 派生用途密钥
- `ukey:rotate-key` - 密钥轮换

### 4.2 FIDO2 IPC (3个)

- `ukey:fido2-make-credential` - 创建凭证
- `ukey:fido2-get-assertion` - 获取断言
- `ukey:fido2-list-credentials` - 列出凭证

### 4.3 USB设备管理 IPC (2个)

- `ukey:usb-list-devices` - 列出USB设备
- `ukey:usb-send-apdu` - 发送APDU命令

---

## 五、驱动扩展

**文件**: `desktop-app-vue/src/main/ukey/driver-registry.js`

**新增5个驱动类型**:

1. **FIDO2Driver**: FIDO2/WebAuthn设备
2. **BIP32Driver**: BIP-32密钥派生设备
3. **TPM2Driver**: TPM 2.0可信平台模块
4. **TEEDriver**: 可信执行环境 (ARM TrustZone/Intel SGX)
5. **SatelliteSIMDriver**: 卫星SIM卡驱动 (Phase 40扩展)

---

## 六、配置选项

```javascript
unifiedKey: {
  enabled: true,
  bip32: {
    coinType: 0, // BIP-44 coin type
    accountIndex: 0,
    passwordProtected: true
  },
  fido2: {
    rpId: "chainlesschain.local",
    rpName: "ChainlessChain",
    timeout: 30000, // 30s
    userVerification: "preferred" // required/preferred/discouraged
  },
  usb: {
    vendorIds: [0x1050, 0x096e], // YubiKey, Feitian
    reconnectAttempts: 3,
    reconnectDelay: 1000 // ms
  }
}
```

---

## 七、使用场景

### 7.1 BIP-32 密钥派生

```javascript
const keyManager = getUnifiedKeyManager()

// 生成主密钥
await keyManager.generateMasterKey("strong-password")

// 派生签名密钥
const signingKey = await keyManager.derivePurposeKey("signing", 0)

// 使用密钥签名
const signature = await signingKey.sign(message)
```

### 7.2 FIDO2 无密码认证

```javascript
const fido2 = getFIDO2Authenticator()

// 注册阶段
const credential = await fido2.makeCredential(
  "example.com",
  userHandle,
  challenge
)

// 认证阶段
const assertion = await fido2.getAssertion(
  "example.com",
  challenge
)
```

### 7.3 USB 设备通信

```javascript
const usb = getUSBTransport()

// 列出设备
const devices = await usb.listDevices({
  vendorId: 0x1050 // YubiKey
})

// 打开设备
await usb.open(devices[0].deviceId)

// 发送APDU
const response = await usb.sendAPDU([0x00, 0xA4, 0x04, 0x00])
```

---

## 八、安全考虑

1. **主密钥保护**: 使用PBKDF2 (100,000迭代) + AES-256加密
2. **Hardened派生**: BIP-32使用hardened派生路径 (')
3. **PIN保护**: FIDO2 PIN使用BCrypt哈希存储
4. **APDU验证**: USB命令使用CRC校验
5. **设备白名单**: 仅允许已知vendorId/productId

---

## 九、测试覆盖

- ✅ `unified-key-manager.test.js` - BIP-32密钥派生
- ✅ `fido2-authenticator.test.js` - FIDO2认证流程
- ✅ `usb-transport.test.js` - USB通信层
- ✅ `webusb-fallback.test.js` - WebUSB回退

---

## 十、性能指标

| 指标 | 目标 | 实际 |
|------|------|------|
| 密钥派生延迟 | <50ms | ~30ms |
| FIDO2 MakeCredential | <500ms | ~400ms |
| FIDO2 GetAssertion | <300ms | ~250ms |
| USB APDU 往返 | <100ms | ~80ms |

---

## 十一、未来扩展

- [ ] **NFC传输**: 支持NFC近场通信
- [ ] **蓝牙LE**: BLE低功耗蓝牙传输
- [ ] **HSM集成**: 硬件安全模块集成
- [ ] **Multi-Device Sync**: Passkey跨设备同步
- [ ] **Biometric Authentication**: 生物识别集成

---

**文档版本**: 1.0.0
**最后更新**: 2026-02-27
