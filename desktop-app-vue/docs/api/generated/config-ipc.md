# config-ipc

**Source**: `src/main/config/config-ipc.js`

**Generated**: 2026-02-21T22:45:05.307Z

---

## const

```javascript
const
```

* 配置 IPC 处理器
 * 负责处理应用配置相关的前后端通信
 *
 * @module config-ipc
 * @description 提供应用配置的读取和设置 IPC 接口

---

## function registerConfigIPC(

```javascript
function registerConfigIPC(
```

* 注册所有配置 IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Object} dependencies.appConfig - 应用配置管理器实例

---

## ipcMain.handle("config:get", async (_event, key, defaultValue = null) =>

```javascript
ipcMain.handle("config:get", async (_event, key, defaultValue = null) =>
```

* 获取配置项
   * Channel: 'config:get'
   *
   * @param {string} key - 配置键（支持点分隔符，如 'app.theme'）
   * @param {any} defaultValue - 默认值（可选）
   * @returns {Promise<any>} 配置值

---

## ipcMain.handle("config:set", async (_event, key, value) =>

```javascript
ipcMain.handle("config:set", async (_event, key, value) =>
```

* 设置配置项
   * Channel: 'config:set'
   *
   * @param {string} key - 配置键
   * @param {any} value - 配置值
   * @returns {Promise<Object>} { success: boolean }

---

## ipcMain.handle("config:get-all", async () =>

```javascript
ipcMain.handle("config:get-all", async () =>
```

* 获取全部配置
   * Channel: 'config:get-all'
   *
   * @returns {Promise<Object>} 全部配置对象

---

## ipcMain.handle("config:update", async (_event, config) =>

```javascript
ipcMain.handle("config:update", async (_event, config) =>
```

* 更新配置（批量设置）
   * Channel: 'config:update'
   *
   * @param {Object} config - 配置对象（可包含多个键值对）
   * @returns {Promise<Object>} { success: boolean }

---

## ipcMain.handle("config:reset", async () =>

```javascript
ipcMain.handle("config:reset", async () =>
```

* 重置配置为默认值
   * Channel: 'config:reset'
   *
   * @returns {Promise<Object>} { success: boolean }

---

## ipcMain.handle("unified-config:get-summary", async () =>

```javascript
ipcMain.handle("unified-config:get-summary", async () =>
```

* 获取统一配置摘要
   * Channel: 'unified-config:get-summary'
   * @returns {Promise<Object>} 配置摘要

---

## ipcMain.handle("unified-config:get-directory-stats", async () =>

```javascript
ipcMain.handle("unified-config:get-directory-stats", async () =>
```

* 获取目录统计信息
   * Channel: 'unified-config:get-directory-stats'
   * @returns {Promise<Object>} 目录统计

---

## ipcMain.handle("unified-config:get-paths", async () =>

```javascript
ipcMain.handle("unified-config:get-paths", async () =>
```

* 获取统一配置路径
   * Channel: 'unified-config:get-paths'
   * @returns {Promise<Object>} 路径配置

---

## ipcMain.handle("unified-config:clear-cache", async (_event, type = "all") =>

```javascript
ipcMain.handle("unified-config:clear-cache", async (_event, type = "all") =>
```

* 清理缓存
   * Channel: 'unified-config:clear-cache'
   * @param {string} type - 缓存类型：'all', 'embeddings', 'queryResults', 'modelOutputs'
   * @returns {Promise<Object>} { success: boolean }

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 清理旧日志
   * Channel: 'unified-config:clean-old-logs'
   * @param {number} maxFiles - 保留的最大文件数
   * @returns {Promise<Object>} { success: boolean, cleaned: number }

---

