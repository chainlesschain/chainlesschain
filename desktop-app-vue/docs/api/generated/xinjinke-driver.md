# xinjinke-driver

**Source**: `src/main/ukey/xinjinke-driver.js`

**Generated**: 2026-02-16T13:44:34.600Z

---

## class XinJinKeDriver extends BaseUKeyDriver

```javascript
class XinJinKeDriver extends BaseUKeyDriver
```

* 芯劲科U盾加密狗驱动
 *
 * 基于芯劲科开发文档实现
 * 支持以下功能：
 * - 密码验证（MD5加密）
 * - 读写扇区/簇数据（AES 256加密）
 * - 获取唯一序列号
 * - 获取可用空间
 *
 * 技术规格：
 * - 密码：增强型MD5 + AES 256位加密
 * - 数据：AES 256位加密存储
 * - 扇区：512字节
 * - 簇：4096字节（8个扇区）
 * - 存储空间：1-6MB

---

## findDllPath()

```javascript
findDllPath()
```

* 查找DLL路径

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

* 检测U盾设备

---

## async findRemovableDrives()

```javascript
async findRemovableDrives()
```

* 查找可移动磁盘

---

## async verifyPIN(pin)

```javascript
async verifyPIN(pin)
```

* 验证PIN码
   *
   * 根据文档：
   * - 使用增强型MD5加密
   * - 存储时增加AES 256位加密
   * - 默认密码：888888

---

## async callNativeFunction(funcName, ...args)

```javascript
async callNativeFunction(funcName, ...args)
```

* 调用原生DLL函数（带模拟fallback）

---

## async sign(data)

```javascript
async sign(data)
```

* 数字签名
   *
   * 使用U盾存储的密钥进行签名

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

## async readSector(sectorNumber)

```javascript
async readSector(sectorNumber)
```

* 读取扇区
   *
   * 根据文档：
   * - 每个扇区512字节
   * - 扇区从0开始编号
   * - 函数：xjkReadSector

---

## async writeSector(sectorNumber, data)

```javascript
async writeSector(sectorNumber, data)
```

* 写入扇区
   *
   * 根据文档：
   * - 每个扇区512字节
   * - 函数：xjkWriteSector

---

## async readCluster(clusterNumber)

```javascript
async readCluster(clusterNumber)
```

* 读取簇
   *
   * 根据文档：
   * - 每个簇4096字节（8个扇区）
   * - 函数：xjkReadCluster

---

## async writeCluster(clusterNumber, data)

```javascript
async writeCluster(clusterNumber, data)
```

* 写入簇

---

## async changePassword(oldPassword, newPassword)

```javascript
async changePassword(oldPassword, newPassword)
```

* 更改密码
   *
   * 根据文档：
   * - 函数：xjkChangePwd
   * - 新密码长度<=200
   * - 密码忘记后无法恢复！

---

## async getPublicKey()

```javascript
async getPublicKey()
```

* 获取公钥（生成用于外部验证）

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

## getDriverName()

```javascript
getDriverName()
```

* 获取驱动名称

---

