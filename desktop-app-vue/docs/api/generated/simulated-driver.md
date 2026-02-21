# simulated-driver

**Source**: `src/main/ukey/simulated-driver.js`

**Generated**: 2026-02-21T20:04:16.190Z

---

## const

```javascript
const
```

* 模拟U盾驱动
 *
 * 用于开发和测试，不需要实际的硬件设备
 * 模拟完整的U盾功能，包括：
 * - PIN验证
 * - 数字签名
 * - 加密/解密
 * - 设备信息

---

## class SimulatedDriver extends BaseUKeyDriver

```javascript
class SimulatedDriver extends BaseUKeyDriver
```

* 模拟驱动类
 *
 * 特点：
 * - 不依赖任何硬件
 * - 使用文件系统存储状态
 * - 完全兼容BaseUKeyDriver接口
 * - 适合开发、测试、演示

---

## generateDeviceId()

```javascript
generateDeviceId()
```

* 生成设备ID

---

## generateSerialNumber()

```javascript
generateSerialNumber()
```

* 生成序列号

---

## getStateFilePath()

```javascript
getStateFilePath()
```

* 获取状态文件路径

---

## loadState()

```javascript
loadState()
```

* 加载状态

---

## saveState()

```javascript
saveState()
```

* 保存状态

---

## async initialize()

```javascript
async initialize()
```

* 初始化驱动

---

## generateKeyPair()

```javascript
generateKeyPair()
```

* 生成模拟密钥对

---

## async detect()

```javascript
async detect()
```

* 检测设备

---

## async verifyPIN(pin)

```javascript
async verifyPIN(pin)
```

* 验证PIN码

---

## async changePIN(oldPin, newPin)

```javascript
async changePIN(oldPin, newPin)
```

* 修改PIN码

---

## async sign(data)

```javascript
async sign(data)
```

* 数字签名

---

## async verifySignature(data, signature)

```javascript
async verifySignature(data, signature)
```

* 验证签名

---

## async encrypt(data)

```javascript
async encrypt(data)
```

* 加密数据

---

## async decrypt(encryptedData)

```javascript
async decrypt(encryptedData)
```

* 解密数据

---

## async getPublicKey()

```javascript
async getPublicKey()
```

* 获取公钥

---

## async getDeviceInfo()

```javascript
async getDeviceInfo()
```

* 获取设备信息

---

## lock()

```javascript
lock()
```

* 锁定设备

---

## unlockForTesting()

```javascript
unlockForTesting()
```

* 解锁设备（仅用于测试）

---

## resetForTesting()

```javascript
resetForTesting()
```

* 重置设备（仅用于测试）

---

## async close()

```javascript
async close()
```

* 关闭驱动

---

## getDriverName()

```javascript
getDriverName()
```

* 获取驱动名称

---

## getDriverVersion()

```javascript
getDriverVersion()
```

* 获取驱动版本

---

## setAutoDetect(enabled)

```javascript
setAutoDetect(enabled)
```

* 设置自动检测

---

## getStateFile()

```javascript
getStateFile()
```

* 获取状态文件路径（用于调试）

---

