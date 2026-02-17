# ipc-registry

**Source**: `src/main/ipc/ipc-registry.js`

**Generated**: 2026-02-17T10:13:18.236Z

---

## const

```javascript
const
```

* IPC 注册中心
 * 统一管理所有 IPC 模块的注册
 *
 * @module ipc-registry
 * @description 负责注册所有模块化的 IPC 处理器，实现主进程入口文件的解耦

---

## function removeUndefinedValues(obj)

```javascript
function removeUndefinedValues(obj)
```

* 递归移除对象中的 undefined 值
 * @param {*} obj - 要处理的对象
 * @returns {*} 清理后的对象

---

## function _replaceUndefinedWithNull(obj)

```javascript
function _replaceUndefinedWithNull(obj)
```

* 递归将对象中的 undefined 值替换为 null（用于 IPC 序列化）
 * @param {*} obj - 要处理的对象
 * @returns {*} 处理后的对象

---

## function registerAllIPC(dependencies)

```javascript
function registerAllIPC(dependencies)
```

* 注册所有 IPC 处理器
 * @param {Object} dependencies - 依赖对象，包含所有管理器实例
 * @param {Object} dependencies.app - ChainlessChainApp 实例
 * @param {Object} dependencies.database - 数据库管理器
 * @param {Object} dependencies.mainWindow - 主窗口实例
 * @param {Object} dependencies.llmManager - LLM 管理器
 * @param {Object} dependencies.ragManager - RAG 管理器
 * @param {Object} dependencies.ukeyManager - U-Key 管理器
 * @param {Object} dependencies.gitManager - Git 管理器
 * @param {Object} dependencies.didManager - DID 管理器
 * @param {Object} dependencies.p2pManager - P2P 管理器
 * @param {Object} dependencies.skillManager - 技能管理器
 * @param {Object} dependencies.toolManager - 工具管理器
 * @param {Object} [dependencies.*] - 其他管理器实例...
 * @returns {Object} 返回所有 IPC 模块实例，便于测试和调试

---

## function unregisterAllIPC(ipcMain)

```javascript
function unregisterAllIPC(ipcMain)
```

* 注销所有 IPC 处理器（用于测试和热重载）
 * @param {Object} ipcMain - Electron ipcMain 实例

---

