# watchdata-driver

**Source**: `src/main/ukey/watchdata-driver.js`

**Generated**: 2026-02-21T22:45:05.241Z

---

## const

```javascript
const
```

* 握奇（WatchData）U盾驱动
 *
 * 基于SKF标准API
 * 支持握奇的各系列U盾产品

---

## class WatchDataDriver extends SKFDriver

```javascript
class WatchDataDriver extends SKFDriver
```

* 握奇驱动类
 *
 * 支持的产品：
 * - WatchKey系列
 * - TimeCOS系列
 * - 握奇金融USB Key

---

## findDllPath()

```javascript
findDllPath()
```

* 查找DLL路径
   *
   * 握奇的DLL通常命名为：
   * - WDSKFAPI.dll
   * - WatchData.dll
   * - TimeCOS.dll

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
   * 握奇特定的检测逻辑

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

* 握奇特定功能：读取设备序列号
   *
   * 注意：这需要SKF API的扩展支持

---

## async getDeviceCertificate()

```javascript
async getDeviceCertificate()
```

* 握奇特定功能：获取设备证书

---

## async checkDeviceHealth()

```javascript
async checkDeviceHealth()
```

* 握奇特定功能：检查设备健康状态

---

## async setDeviceLabel(label)

```javascript
async setDeviceLabel(label)
```

* 握奇特定功能：设置设备标签

---

