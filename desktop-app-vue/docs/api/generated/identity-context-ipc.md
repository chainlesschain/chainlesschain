# identity-context-ipc

**Source**: `src/main/identity-context/identity-context-ipc.js`

**Generated**: 2026-02-15T07:37:13.830Z

---

## const

```javascript
const
```

* Identity Context IPC 处理器
 * 负责处理身份上下文切换相关的前后端通信（企业版功能）
 *
 * @module identity-context-ipc
 * @description 提供身份上下文的创建、切换、删除、历史记录等 IPC 接口

---

## function registerIdentityContextIPC(

```javascript
function registerIdentityContextIPC(
```

* 注册所有 Identity Context IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Object} dependencies.identityContextManager - 身份上下文管理器

---

## ipcMain.handle("identity:get-all-contexts", async (_event,

```javascript
ipcMain.handle("identity:get-all-contexts", async (_event,
```

* 获取所有身份上下文
   * Channel: 'identity:get-all-contexts'

---

## ipcMain.handle("identity:get-active-context", async (_event,

```javascript
ipcMain.handle("identity:get-active-context", async (_event,
```

* 获取当前激活的上下文
   * Channel: 'identity:get-active-context'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 创建个人上下文
   * Channel: 'identity:create-personal-context'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 创建组织上下文
   * Channel: 'identity:create-organization-context'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 切换身份上下文
   * Channel: 'identity:switch-context'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 删除组织上下文
   * Channel: 'identity:delete-organization-context'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 获取切换历史
   * Channel: 'identity:get-switch-history'

---

