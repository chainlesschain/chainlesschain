# feitian-driver

**Source**: `src/main/ukey/feitian-driver.js`

**Generated**: 2026-02-22T01:23:36.661Z

---

## const

```javascript
const
```

* 飞天诚信（FeiTian）U盾驱动
 *
 * 基于SKF标准API
 * 支持飞天诚信的ePass系列U盾

---

## class FeiTianDriver extends SKFDriver

```javascript
class FeiTianDriver extends SKFDriver
```

* 飞天诚信驱动类
 *
 * 支持的产品：
 * - ePass1000
 * - ePass2000
 * - ePass3000
 * - ePass NG系列

---

## findDllPath()

```javascript
findDllPath()
```

* 查找DLL路径
   *
   * 飞天诚信的DLL通常命名为：
   * - ft2k.dll (FeiTian 2K系列)
   * - ShuttleCsp11_3003.dll
   * - FT_SKFAPI.dll

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
   * 飞天诚信特定的检测逻辑

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

* 飞天诚信特定功能：读取设备序列号
   *
   * 注意：这需要SKF API的扩展支持

---

## async getDeviceCertificate()

```javascript
async getDeviceCertificate()
```

* 飞天诚信特定功能：获取设备证书

---

## async checkDeviceHealth()

```javascript
async checkDeviceHealth()
```

* 飞天诚信特定功能：检查设备健康状态

---

