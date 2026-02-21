# ukey-manager

**Source**: `src/main/ukey/ukey-manager.js`

**Generated**: 2026-02-21T22:04:25.765Z

---

## const

```javascript
const
```

* U盾管理器
 *
 * 统一管理多种U盾驱动
 * 支持国产U盾（鑫金科、飞天、握奇、华大、天地融）
 * 支持跨平台 PKCS#11 标准驱动

---

## const DriverTypes =

```javascript
const DriverTypes =
```

* U盾驱动类型

---

## class UKeyManager extends EventEmitter

```javascript
class UKeyManager extends EventEmitter
```

* U盾管理器类
 *
 * 功能：
 * - 管理多种U盾驱动
 * - 自动检测U盾类型
 * - 统一的API接口
 * - 设备热插拔监听

---

## async initialize()

```javascript
async initialize()
```

* 初始化管理器

---

## async createDriver(driverType)

```javascript
async createDriver(driverType)
```

* 创建驱动实例
   * @param {string} driverType - 驱动类型

---

## async switchDriver(driverType)

```javascript
async switchDriver(driverType)
```

* 切换驱动类型
   * @param {string} driverType - 驱动类型

---

## async autoDetect()

```javascript
async autoDetect()
```

* 自动检测U盾类型
   *
   * 尝试不同的驱动，看哪个能成功检测到设备
   * Windows: 优先使用国产驱动，然后 PKCS#11
   * macOS/Linux: 优先使用 PKCS#11（跨平台支持）

---

## async detect()

```javascript
async detect()
```

* 检测U盾设备

---

## async verifyPIN(pin)

```javascript
async verifyPIN(pin)
```

* 验证PIN码

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

* 锁定U盾

---

## isUnlocked()

```javascript
isUnlocked()
```

* 检查是否已解锁

---

## getDriverType()

```javascript
getDriverType()
```

* 获取当前驱动类型

---

## getDriverName()

```javascript
getDriverName()
```

* 获取当前驱动名称

---

## getDriverVersion()

```javascript
getDriverVersion()
```

* 获取当前驱动版本

---

## async close()

```javascript
async close()
```

* 关闭管理器

---

## startDeviceMonitor(interval = 5000)

```javascript
startDeviceMonitor(interval = 5000)
```

* 监听设备变化（热插拔）
   *
   * 使用轮询方式检测设备变化

---

## stopDeviceMonitor()

```javascript
stopDeviceMonitor()
```

* 停止设备监听

---

