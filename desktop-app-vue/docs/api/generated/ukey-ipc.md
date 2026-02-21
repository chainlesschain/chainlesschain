# ukey-ipc

**Source**: `src/main/ukey/ukey-ipc.js`

**Generated**: 2026-02-21T20:04:16.189Z

---

## function registerUKeyIPC(

```javascript
function registerUKeyIPC(
```

* U-Key 硬件 IPC 处理器
 * 负责处理 U-Key 硬件设备相关的前后端通信
 *
 * @module ukey-ipc
 * @description 提供 U-Key 硬件检测、PIN验证、签名加密、认证等 IPC 接口

---

## function registerUKeyIPC(

```javascript
function registerUKeyIPC(
```

* 注册所有 U-Key IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Object} dependencies.ukeyManager - U-Key 管理器
 * @param {Object} dependencies.ipcMain - IPC主进程对象（可选，用于测试注入）
 * @param {Object} dependencies.ipcGuard - IPC Guard模块（可选，用于测试注入）

---

## try

```javascript
try
```

* 检测 U-Key 设备
   * Channel: 'ukey:detect'

---

## ipcMain.handle('ukey:verify-pin', async (_event, pin) =>

```javascript
ipcMain.handle('ukey:verify-pin', async (_event, pin) =>
```

* 验证 PIN 码
   * Channel: 'ukey:verify-pin'

---

## ipcMain.handle('ukey:get-device-info', async () =>

```javascript
ipcMain.handle('ukey:get-device-info', async () =>
```

* 获取设备信息
   * Channel: 'ukey:get-device-info'

---

## ipcMain.handle('ukey:sign', async (_event, data) =>

```javascript
ipcMain.handle('ukey:sign', async (_event, data) =>
```

* 数字签名
   * Channel: 'ukey:sign'

---

## ipcMain.handle('ukey:encrypt', async (_event, data) =>

```javascript
ipcMain.handle('ukey:encrypt', async (_event, data) =>
```

* 数据加密
   * Channel: 'ukey:encrypt'

---

## ipcMain.handle('ukey:decrypt', async (_event, encryptedData) =>

```javascript
ipcMain.handle('ukey:decrypt', async (_event, encryptedData) =>
```

* 数据解密
   * Channel: 'ukey:decrypt'

---

## ipcMain.handle('ukey:lock', async () =>

```javascript
ipcMain.handle('ukey:lock', async () =>
```

* 锁定 U-Key
   * Channel: 'ukey:lock'

---

## ipcMain.handle('ukey:get-public-key', async () =>

```javascript
ipcMain.handle('ukey:get-public-key', async () =>
```

* 获取公钥
   * Channel: 'ukey:get-public-key'

---

## ipcMain.handle('auth:verify-password', async (_event, username, password) =>

```javascript
ipcMain.handle('auth:verify-password', async (_event, username, password) =>
```

* 密码认证（用于未检测到U盾时的备用登录方式）
   * Channel: 'auth:verify-password'

---

