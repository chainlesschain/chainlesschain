# signal-session-manager

**Source**: `src\main\p2p\signal-session-manager.js`

**Generated**: 2026-01-27T06:44:03.831Z

---

## const

```javascript
const
```

* Signal 协议会话管理器
 *
 * 实现端到端加密的消息通信
 * 基于 Signal 协议 (X3DH + Double Ratchet)
 *
 * 核心功能：
 * - 身份密钥管理
 * - 预密钥生成和管理
 * - 会话建立 (X3DH 密钥协商)
 * - 消息加密/解密 (Double Ratchet)
 * - 会话持久化

---

## class SignalSessionManager extends EventEmitter

```javascript
class SignalSessionManager extends EventEmitter
```

* Signal 会话管理器类

---

## async initialize()

```javascript
async initialize()
```

* 初始化 Signal 会话管理器

---

## async loadSignalLibrary()

```javascript
async loadSignalLibrary()
```

* 加载 Signal 协议库

---

## async loadOrGenerateIdentity()

```javascript
async loadOrGenerateIdentity()
```

* 加载或生成身份

---

## async generateIdentity()

```javascript
async generateIdentity()
```

* 生成新身份

---

## async generatePreKeys()

```javascript
async generatePreKeys()
```

* 生成预密钥

---

## async getPreKeyBundle()

```javascript
async getPreKeyBundle()
```

* 获取预密钥包 (Pre Key Bundle)
   * 用于建立新会话

---

## async processPreKeyBundle(recipientId, deviceId, preKeyBundle)

```javascript
async processPreKeyBundle(recipientId, deviceId, preKeyBundle)
```

* 处理预密钥包并建立会话
   * @param {string} recipientId - 接收者 ID
   * @param {number} deviceId - 设备 ID
   * @param {Object} preKeyBundle - 预密钥包

---

## ensureArrayBuffer(data)

```javascript
ensureArrayBuffer(data)
```

* 确保数据是 ArrayBuffer 格式
   * @param {*} data - 输入数据
   * @returns {ArrayBuffer} ArrayBuffer

---

## async encryptMessage(recipientId, deviceId, plaintext)

```javascript
async encryptMessage(recipientId, deviceId, plaintext)
```

* 加密消息
   * @param {string} recipientId - 接收者 ID
   * @param {number} deviceId - 设备 ID
   * @param {string|Buffer|ArrayBuffer} plaintext - 明文消息

---

## async decryptMessage(senderId, deviceId, ciphertext)

```javascript
async decryptMessage(senderId, deviceId, ciphertext)
```

* 解密消息
   * @param {string} senderId - 发送者 ID
   * @param {number} deviceId - 设备 ID
   * @param {Object} ciphertext - 密文消息

---

## async hasSession(recipientId, deviceId)

```javascript
async hasSession(recipientId, deviceId)
```

* 检查是否存在会话
   * @param {string} recipientId - 接收者 ID
   * @param {number} deviceId - 设备 ID

---

## async deleteSession(recipientId, deviceId)

```javascript
async deleteSession(recipientId, deviceId)
```

* 删除会话
   * @param {string} recipientId - 接收者 ID
   * @param {number} deviceId - 设备 ID

---

## async getSessions()

```javascript
async getSessions()
```

* 获取所有会话列表

---

## arrayBufferFromObject(obj)

```javascript
arrayBufferFromObject(obj)
```

* 从 JSON 对象重建 ArrayBuffer
   * @param {Object} obj - JSON 对象 (可能是 { type: 'Buffer', data: [...] } 或数组)
   * @returns {ArrayBuffer} ArrayBuffer

---

## toUint8Array(data)

```javascript
toUint8Array(data)
```

* 将 ArrayBuffer 转换为 Uint8Array（Signal library 期望的格式）
   * @param {ArrayBuffer|Uint8Array|Buffer} data - 输入数据
   * @returns {Uint8Array} Uint8Array

---

## async close()

```javascript
async close()
```

* 关闭会话管理器

---

## class LocalSignalProtocolStore

```javascript
class LocalSignalProtocolStore
```

* Signal Protocol Store 实现
 * 存储会话、身份密钥、预密钥等

---

