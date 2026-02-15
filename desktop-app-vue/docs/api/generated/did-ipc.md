# did-ipc

**Source**: `src/main/did/did-ipc.js`

**Generated**: 2026-02-15T07:37:13.838Z

---

## function registerDIDIPC(

```javascript
function registerDIDIPC(
```

* DID（去中心化身份）IPC 处理器
 * 负责处理 DID 身份管理相关的前后端通信
 *
 * @module did-ipc
 * @description 提供 DID 身份 CRUD、文档管理、DHT 发布、自动重新发布、助记词管理等 IPC 接口

---

## function registerDIDIPC(

```javascript
function registerDIDIPC(
```

* 注册所有 DID IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Object} dependencies.didManager - DID 管理器
 * @param {Object} dependencies.ipcMain - IPC主进程对象（可选，用于测试注入）

---

## ipcMain.handle("did:create-identity", async (_event, profile, options) =>

```javascript
ipcMain.handle("did:create-identity", async (_event, profile, options) =>
```

* 创建 DID 身份
   * Channel: 'did:create-identity'

---

## ipcMain.handle("did:get-all-identities", async () =>

```javascript
ipcMain.handle("did:get-all-identities", async () =>
```

* 获取所有身份
   * Channel: 'did:get-all-identities'

---

## ipcMain.handle("did:get-identity", async (_event, did) =>

```javascript
ipcMain.handle("did:get-identity", async (_event, did) =>
```

* 根据 DID 获取身份
   * Channel: 'did:get-identity'

---

## ipcMain.handle("did:get-current-identity", async () =>

```javascript
ipcMain.handle("did:get-current-identity", async () =>
```

* 获取当前身份
   * Channel: 'did:get-current-identity'

---

## ipcMain.handle("did:set-default-identity", async (_event, did) =>

```javascript
ipcMain.handle("did:set-default-identity", async (_event, did) =>
```

* 设置默认身份
   * Channel: 'did:set-default-identity'

---

## ipcMain.handle("did:update-identity", async (_event, did, updates) =>

```javascript
ipcMain.handle("did:update-identity", async (_event, did, updates) =>
```

* 更新身份信息
   * Channel: 'did:update-identity'

---

## ipcMain.handle("did:delete-identity", async (_event, did) =>

```javascript
ipcMain.handle("did:delete-identity", async (_event, did) =>
```

* 删除身份
   * Channel: 'did:delete-identity'

---

## ipcMain.handle("did:export-document", async (_event, did) =>

```javascript
ipcMain.handle("did:export-document", async (_event, did) =>
```

* 导出 DID 文档
   * Channel: 'did:export-document'

---

## ipcMain.handle("did:generate-qrcode", async (_event, did) =>

```javascript
ipcMain.handle("did:generate-qrcode", async (_event, did) =>
```

* 生成 DID 二维码
   * Channel: 'did:generate-qrcode'

---

## ipcMain.handle("did:verify-document", async (_event, document) =>

```javascript
ipcMain.handle("did:verify-document", async (_event, document) =>
```

* 验证 DID 文档
   * Channel: 'did:verify-document'

---

## ipcMain.handle("did:publish-to-dht", async (_event, did) =>

```javascript
ipcMain.handle("did:publish-to-dht", async (_event, did) =>
```

* 发布 DID 到 DHT
   * Channel: 'did:publish-to-dht'

---

## ipcMain.handle("did:resolve-from-dht", async (_event, did) =>

```javascript
ipcMain.handle("did:resolve-from-dht", async (_event, did) =>
```

* 从 DHT 解析 DID
   * Channel: 'did:resolve-from-dht'

---

## ipcMain.handle("did:unpublish-from-dht", async (_event, did) =>

```javascript
ipcMain.handle("did:unpublish-from-dht", async (_event, did) =>
```

* 从 DHT 取消发布 DID
   * Channel: 'did:unpublish-from-dht'

---

## ipcMain.handle("did:is-published-to-dht", async (_event, did) =>

```javascript
ipcMain.handle("did:is-published-to-dht", async (_event, did) =>
```

* 检查 DID 是否已发布到 DHT
   * Channel: 'did:is-published-to-dht'

---

## ipcMain.handle("did:start-auto-republish", async (_event, interval) =>

```javascript
ipcMain.handle("did:start-auto-republish", async (_event, interval) =>
```

* 启动自动重新发布
   * Channel: 'did:start-auto-republish'

---

## ipcMain.handle("did:stop-auto-republish", async () =>

```javascript
ipcMain.handle("did:stop-auto-republish", async () =>
```

* 停止自动重新发布
   * Channel: 'did:stop-auto-republish'

---

## ipcMain.handle("did:get-auto-republish-status", async () =>

```javascript
ipcMain.handle("did:get-auto-republish-status", async () =>
```

* 获取自动重新发布状态
   * Channel: 'did:get-auto-republish-status'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 设置自动重新发布间隔
   * Channel: 'did:set-auto-republish-interval'

---

## ipcMain.handle("did:republish-all", async () =>

```javascript
ipcMain.handle("did:republish-all", async () =>
```

* 重新发布所有 DID
   * Channel: 'did:republish-all'

---

## ipcMain.handle("did:generate-mnemonic", async (_event, strength) =>

```javascript
ipcMain.handle("did:generate-mnemonic", async (_event, strength) =>
```

* 生成助记词
   * Channel: 'did:generate-mnemonic'

---

## ipcMain.handle("did:validate-mnemonic", async (_event, mnemonic) =>

```javascript
ipcMain.handle("did:validate-mnemonic", async (_event, mnemonic) =>
```

* 验证助记词
   * Channel: 'did:validate-mnemonic'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 从助记词创建身份
   * Channel: 'did:create-from-mnemonic'

---

## ipcMain.handle("did:export-mnemonic", async (_event, did) =>

```javascript
ipcMain.handle("did:export-mnemonic", async (_event, did) =>
```

* 导出助记词
   * Channel: 'did:export-mnemonic'

---

## ipcMain.handle("did:has-mnemonic", async (_event, did) =>

```javascript
ipcMain.handle("did:has-mnemonic", async (_event, did) =>
```

* 检查是否有助记词
   * Channel: 'did:has-mnemonic'

---

