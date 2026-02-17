# base-driver

**Source**: `src/main/ukey/base-driver.js`

**Generated**: 2026-02-17T10:13:18.178Z

---

## class BaseUKeyDriver

```javascript
class BaseUKeyDriver
```

* U盾驱动基类
 *
 * 所有U盾驱动都必须实现这个基类的方法

---

## async initialize()

```javascript
async initialize()
```

* 初始化驱动
   * @returns {Promise<boolean>}

---

## async detect()

```javascript
async detect()
```

* 检测U盾设备
   * @returns {Promise<UKeyStatus>}

---

## async verifyPIN(pin)

```javascript
async verifyPIN(pin)
```

* 验证PIN码
   * @param {string} pin - PIN码
   * @returns {Promise<UKeyVerifyResult>}

---

## async sign(data)

```javascript
async sign(data)
```

* 数字签名
   * @param {string} data - 待签名数据
   * @returns {Promise<string>} 签名结果（Base64）

---

## async verifySignature(data, signature)

```javascript
async verifySignature(data, signature)
```

* 验证签名
   * @param {string} data - 原始数据
   * @param {string} signature - 签名（Base64）
   * @returns {Promise<boolean>}

---

## async encrypt(data)

```javascript
async encrypt(data)
```

* 加密数据
   * @param {string} data - 待加密数据
   * @returns {Promise<string>} 加密结果（Base64）

---

## async decrypt(encryptedData)

```javascript
async decrypt(encryptedData)
```

* 解密数据
   * @param {string} encryptedData - 加密数据（Base64）
   * @returns {Promise<string>} 解密结果

---

## async getPublicKey()

```javascript
async getPublicKey()
```

* 获取公钥
   * @returns {Promise<string>} 公钥（PEM格式）

---

## async getDeviceInfo()

```javascript
async getDeviceInfo()
```

* 获取设备信息
   * @returns {Promise<UKeyDeviceInfo>}

---

## lock()

```javascript
lock()
```

* 锁定U盾

---

## isDeviceUnlocked()

```javascript
isDeviceUnlocked()
```

* 检查是否已解锁
   * @returns {boolean}

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
   * @returns {string}

---

## getDriverVersion()

```javascript
getDriverVersion()
```

* 获取驱动版本
   * @returns {string}

---

## sleep(ms)

```javascript
sleep(ms)
```

* 辅助方法：延迟执行
   * @param {number} ms - 延迟时间（毫秒）
   * @returns {Promise<void>}

---

