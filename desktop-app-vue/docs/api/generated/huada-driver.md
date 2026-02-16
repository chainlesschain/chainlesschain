# huada-driver

**Source**: `src/main/ukey/huada-driver.js`

**Generated**: 2026-02-16T22:06:51.414Z

---

## const

```javascript
const
```

* 华大（ChinaHuada）U盾驱动
 *
 * 基于SKF标准API
 * 支持华大智能卡芯片和U盾产品

---

## class HuadaDriver extends SKFDriver

```javascript
class HuadaDriver extends SKFDriver
```

* 华大驱动类
 *
 * 支持的产品：
 * - 华大HD系列U盾
 * - 华大安全U盾（HDSK系列）
 * - 华大金融IC卡U盾

---

## findDllPath()

```javascript
findDllPath()
```

* 查找DLL路径
   *
   * 华大的DLL通常命名为：
   * - HDSKFAPI.dll
   * - ChinaHuada.dll
   * - HDCSP.dll

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
   * 华大特定的检测逻辑

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

* 华大特定功能：读取设备序列号
   *
   * 注意：这需要SKF API的扩展支持

---

## async getDeviceCertificate()

```javascript
async getDeviceCertificate()
```

* 华大特定功能：获取设备证书

---

## async checkDeviceHealth()

```javascript
async checkDeviceHealth()
```

* 华大特定功能：检查设备健康状态

---

## async getChipInfo()

```javascript
async getChipInfo()
```

* 华大特定功能：获取芯片信息

---

## supportsSM()

```javascript
supportsSM()
```

* 华大特定功能：国密算法支持检查

---

