# device-pairing-handler

**Source**: `src/main/p2p/device-pairing-handler.js`

**Generated**: 2026-02-16T22:06:51.458Z

---

## const

```javascript
const
```

* Device Pairing Handler - PC端设备配对处理器
 *
 * 功能：
 * - 扫描移动端二维码
 * - 验证配对码有效性
 * - 显示确认对话框
 * - 发送配对确认
 * - 注册移动设备

---

## async handleQRCodeScan(qrCodeData)

```javascript
async handleQRCodeScan(qrCodeData)
```

* 扫描并处理二维码
   * @param {string} qrCodeData - 二维码数据（JSON字符串）
   * @returns {Promise<Object>} 配对结果

---

## validatePairingCode(qrData)

```javascript
validatePairingCode(qrData)
```

* 验证配对码

---

## async showConfirmationDialog(qrData)

```javascript
async showConfirmationDialog(qrData)
```

* 显示确认对话框
   * @returns {Promise<boolean>} 用户是否确认

---

## async sendConfirmation(qrData)

```javascript
async sendConfirmation(qrData)
```

* 发送配对确认到移动端

---

## async registerMobileDevice(qrData)

```javascript
async registerMobileDevice(qrData)
```

* 注册移动设备

---

## async waitForMobileConnection(mobileDid)

```javascript
async waitForMobileConnection(mobileDid)
```

* 等待移动端连接

---

## async startQRCodeScanner()

```javascript
async startQRCodeScanner()
```

* 启动二维码扫描（使用摄像头）
   * @returns {Promise<Object>} 扫描结果

---

## async pairWithCode(pairingCode, mobileDid, deviceInfo)

```javascript
async pairWithCode(pairingCode, mobileDid, deviceInfo)
```

* 手动输入配对码

---

## startCleanupTimer()

```javascript
startCleanupTimer()
```

* 定期清理过期配对请求

---

## getPendingPairings()

```javascript
getPendingPairings()
```

* 获取待处理的配对请求

---

## cancelPairing(pairingCode)

```javascript
cancelPairing(pairingCode)
```

* 取消配对

---

