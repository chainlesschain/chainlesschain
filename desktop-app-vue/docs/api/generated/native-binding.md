# native-binding

**Source**: `src/main/ukey/native-binding.js`

**Generated**: 2026-02-17T10:13:18.177Z

---

## const

```javascript
const
```

* Native Module Binding for XinJinKe U盾
 *
 * 使用 Koffi (Foreign Function Interface) 调用 xjk.dll

---

## class XinJinKeNativeBinding

```javascript
class XinJinKeNativeBinding
```

* XinJinKe Native Binding
 *
 * 根据官方文档绑定所有DLL函数

---

## findDllPath()

```javascript
findDllPath()
```

* 查找DLL路径

---

## load()

```javascript
load()
```

* 加载DLL库

---

## unload()

```javascript
unload()
```

* 卸载DLL库

---

## openKey()

```javascript
openKey()
```

* 打开U盾（默认密码）

---

## openKeyEx(password)

```javascript
openKeyEx(password)
```

* 打开U盾（指定密码）
   * @param {string} password - 密码

---

## closeKey()

```javascript
closeKey()
```

* 关闭U盾

---

## findPort()

```javascript
findPort()
```

* 查找U盾端口

---

## getSerial()

```javascript
getSerial()
```

* 获取序列号
   * @returns {string} 序列号

---

## getSectors()

```javascript
getSectors()
```

* 获取扇区总数

---

## getClusters()

```javascript
getClusters()
```

* 获取簇总数

---

## readSector(sector)

```javascript
readSector(sector)
```

* 读取扇区数据
   * @param {number} sector - 扇区号
   * @returns {Buffer} 512字节数据

---

## writeSector(data, sector)

```javascript
writeSector(data, sector)
```

* 写入扇区数据
   * @param {Buffer} data - 512字节数据
   * @param {number} sector - 扇区号

---

## readCluster(cluster)

```javascript
readCluster(cluster)
```

* 读取簇数据
   * @param {number} cluster - 簇号
   * @returns {Buffer} 4096字节数据

---

## writeCluster(data, cluster)

```javascript
writeCluster(data, cluster)
```

* 写入簇数据
   * @param {Buffer} data - 4096字节数据
   * @param {number} cluster - 簇号

---

## changePassword(oldPassword, newPassword)

```javascript
changePassword(oldPassword, newPassword)
```

* 修改密码
   * @param {string} oldPassword - 旧密码
   * @param {string} newPassword - 新密码

---

## encrypt(data)

```javascript
encrypt(data)
```

* 加密数据
   * @param {Buffer} data - 原始数据
   * @returns {Buffer} 加密后数据

---

## decrypt(encryptedData)

```javascript
decrypt(encryptedData)
```

* 解密数据
   * @param {Buffer} encryptedData - 加密数据
   * @returns {Buffer} 解密后数据

---

## isLibraryLoaded()

```javascript
isLibraryLoaded()
```

* 检查DLL是否已加载

---

