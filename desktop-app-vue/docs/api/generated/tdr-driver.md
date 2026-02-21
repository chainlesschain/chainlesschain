# tdr-driver

**Source**: `src/main/ukey/tdr-driver.js`

**Generated**: 2026-02-21T22:45:05.241Z

---

## const

```javascript
const
```

* 天地融（TDR）U盾驱动
 *
 * 基于SKF标准API
 * 支持天地融支付密码器和U盾产品

---

## class TDRDriver extends SKFDriver

```javascript
class TDRDriver extends SKFDriver
```

* 天地融驱动类
 *
 * 支持的产品：
 * - TDR支付密码器
 * - TDR SecureKey系列
 * - TDR金融USB Key

---

## findDllPath()

```javascript
findDllPath()
```

* 查找DLL路径
   *
   * 天地融的DLL通常命名为：
   * - TDRSKFAPI.dll
   * - TDR_CSP.dll
   * - TianDiRong.dll

---

## async initialize()

```javascript
async initialize()
```

* 初始化驱动

---

## getManufacturerName()

```javascript
getManufacturerName()
```

* 获取制造商名称

---

## getModelName()

```javascript
getModelName()
```

* 获取型号名称

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

## async detect()

```javascript
async detect()
```

* 检测设备
   *
   * 天地融特定的检测逻辑

---

## simulateDetect()

```javascript
simulateDetect()
```

* 模拟检测（用于开发测试）

---

## async getDeviceInfo()

```javascript
async getDeviceInfo()
```

* 获取设备信息

---

## async getDeviceSerial()

```javascript
async getDeviceSerial()
```

* 天地融特定功能：读取设备序列号
   *
   * 注意：这需要SKF API的扩展支持

---

## async getDeviceCertificate()

```javascript
async getDeviceCertificate()
```

* 天地融特定功能：获取设备证书

---

## async checkDeviceHealth()

```javascript
async checkDeviceHealth()
```

* 天地融特定功能：检查设备健康状态

---

## async enablePaymentMode()

```javascript
async enablePaymentMode()
```

* 天地融特定功能：支付密码器模式
   *
   * 天地融设备常用于支付场景，支持PIN输入保护

---

## async getTransactionCounter()

```javascript
async getTransactionCounter()
```

* 天地融特定功能：获取交易计数器
   *
   * 用于支付场景的交易计数

---

## async resetTransactionCounter()

```javascript
async resetTransactionCounter()
```

* 天地融特定功能：重置交易计数器

---

