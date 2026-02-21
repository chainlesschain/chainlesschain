# types

**Source**: `src/main/ukey/types.js`

**Generated**: 2026-02-21T22:04:25.766Z

---

## module.exports =

```javascript
module.exports =
```

* U盾类型定义
 *
 * 这个文件定义了所有U盾相关的接口和类型

---

## module.exports =

```javascript
module.exports =
```

* U盾状态
 * @typedef {Object} UKeyStatus
 * @property {boolean} detected - 是否检测到U盾
 * @property {boolean} unlocked - 是否已解锁
 * @property {string} [deviceId] - 设备ID
 * @property {string} [serialNumber] - 序列号
 * @property {string} [manufacturer] - 制造商
 * @property {string} [model] - 型号
 * @property {string} [publicKey] - 公钥（PEM格式）

---

## module.exports =

```javascript
module.exports =
```

* U盾验证结果
 * @typedef {Object} UKeyVerifyResult
 * @property {boolean} success - 是否成功
 * @property {string} [error] - 错误信息
 * @property {number} [remainingAttempts] - 剩余尝试次数

---

## module.exports =

```javascript
module.exports =
```

* U盾签名结果
 * @typedef {Object} UKeySignResult
 * @property {string} signature - 签名（Base64）
 * @property {string} algorithm - 签名算法
 * @property {number} timestamp - 时间戳

---

## module.exports =

```javascript
module.exports =
```

* U盾设备信息
 * @typedef {Object} UKeyDeviceInfo
 * @property {string} id - 设备ID
 * @property {string} serialNumber - 序列号
 * @property {string} manufacturer - 制造商
 * @property {string} model - 型号
 * @property {string} firmware - 固件版本
 * @property {boolean} isConnected - 是否连接

---

## module.exports =

```javascript
module.exports =
```

* U盾驱动类型
 * @typedef {'xinjinke'|'feitian'|'watchdata'|'huada'|'tdr'|'simulated'} UKeyDriverType

---

## module.exports =

```javascript
module.exports =
```

* U盾配置
 * @typedef {Object} UKeyConfig
 * @property {UKeyDriverType} driverType - 驱动类型
 * @property {string} [driverPath] - 驱动路径
 * @property {number} [timeout] - 超时时间（毫秒）
 * @property {boolean} [autoLock] - 是否自动锁定
 * @property {number} [autoLockTimeout] - 自动锁定超时（秒）
 * @property {Object} [driverOptions] - 驱动特定选项

---

