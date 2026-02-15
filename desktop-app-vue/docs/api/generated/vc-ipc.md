# vc-ipc

**Source**: `src/main/vc/vc-ipc.js`

**Generated**: 2026-02-15T10:10:53.356Z

---

## const

```javascript
const
```

* VC (Verifiable Credentials) IPC 处理器
 * 负责处理可验证凭证相关的前后端通信
 *
 * @module vc-ipc
 * @description 提供可验证凭证的创建、验证、撤销、导出、导入、统计等 IPC 接口

---

## function registerVCIPC(

```javascript
function registerVCIPC(
```

* 注册所有 VC IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Object} dependencies.vcManager - 可验证凭证管理器

---

## ipcMain.handle("vc:create", async (_event, params) =>

```javascript
ipcMain.handle("vc:create", async (_event, params) =>
```

* 创建可验证凭证
   * Channel: 'vc:create'

---

## ipcMain.handle("vc:get-all", async (_event, filters) =>

```javascript
ipcMain.handle("vc:get-all", async (_event, filters) =>
```

* 获取所有凭证（支持过滤）
   * Channel: 'vc:get-all'

---

## ipcMain.handle("vc:get", async (_event, id) =>

```javascript
ipcMain.handle("vc:get", async (_event, id) =>
```

* 根据 ID 获取凭证
   * Channel: 'vc:get'

---

## ipcMain.handle("vc:verify", async (_event, vcDocument) =>

```javascript
ipcMain.handle("vc:verify", async (_event, vcDocument) =>
```

* 验证凭证
   * Channel: 'vc:verify'

---

## ipcMain.handle("vc:revoke", async (_event, id, issuerDID) =>

```javascript
ipcMain.handle("vc:revoke", async (_event, id, issuerDID) =>
```

* 撤销凭证
   * Channel: 'vc:revoke'

---

## ipcMain.handle("vc:delete", async (_event, id) =>

```javascript
ipcMain.handle("vc:delete", async (_event, id) =>
```

* 删除凭证
   * Channel: 'vc:delete'

---

## ipcMain.handle("vc:export", async (_event, id) =>

```javascript
ipcMain.handle("vc:export", async (_event, id) =>
```

* 导出凭证
   * Channel: 'vc:export'

---

## ipcMain.handle("vc:generate-share-data", async (_event, id) =>

```javascript
ipcMain.handle("vc:generate-share-data", async (_event, id) =>
```

* 生成分享数据
   * Channel: 'vc:generate-share-data'

---

## ipcMain.handle("vc:import-from-share", async (_event, shareData) =>

```javascript
ipcMain.handle("vc:import-from-share", async (_event, shareData) =>
```

* 从分享数据导入凭证
   * Channel: 'vc:import-from-share'

---

## ipcMain.handle("vc:get-statistics", async (_event, did) =>

```javascript
ipcMain.handle("vc:get-statistics", async (_event, did) =>
```

* 获取凭证统计信息
   * Channel: 'vc:get-statistics'

---

