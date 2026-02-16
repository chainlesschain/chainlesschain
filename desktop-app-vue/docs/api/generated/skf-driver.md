# skf-driver

**Source**: `src/main/ukey/skf-driver.js`

**Generated**: 2026-02-16T22:06:51.413Z

---

## const

```javascript
const
```

* SKF标准驱动基类
 *
 * 基于中国国家标准 GM/T 0016-2012（智能密码钥匙应用接口规范）
 *
 * 此基类实现了SKF API的核心功能，供飞天诚信、握奇等厂商驱动继承使用

---

## const SKF_ERROR_CODES =

```javascript
const SKF_ERROR_CODES =
```

* SKF错误码

---

## class SKFDriver extends BaseUKeyDriver

```javascript
class SKFDriver extends BaseUKeyDriver
```

* SKF驱动基类
 *
 * 实现SKF标准API的封装和调用

---

## findDllPath()

```javascript
findDllPath()
```

* 查找DLL路径
   * 子类应该重写此方法以指定具体的DLL文件名

---

## loadLibrary()

```javascript
loadLibrary()
```

* 加载DLL库

---

## bindSKFFunctions()

```javascript
bindSKFFunctions()
```

* 绑定SKF API函数

---

## async initialize()

```javascript
async initialize()
```

* 初始化驱动

---

## async detect()

```javascript
async detect()
```

* 检测设备

---

## async enumerateDevices()

```javascript
async enumerateDevices()
```

* 枚举设备

---

## async connectDevice(deviceName)

```javascript
async connectDevice(deviceName)
```

* 连接设备

---

## async verifyPIN(pin)

```javascript
async verifyPIN(pin)
```

* 验证PIN码

---

## async openOrCreateApplication()

```javascript
async openOrCreateApplication()
```

* 打开或创建应用

---

## async openOrCreateContainer()

```javascript
async openOrCreateContainer()
```

* 打开或创建容器

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

## async generateSessionKey()

```javascript
async generateSessionKey()
```

* 生成会话密钥

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

## async close()

```javascript
async close()
```

* 关闭驱动

---

## getManufacturerName()

```javascript
getManufacturerName()
```

* 获取制造商名称（子类重写）

---

## getModelName()

```javascript
getModelName()
```

* 获取型号名称（子类重写）

---

