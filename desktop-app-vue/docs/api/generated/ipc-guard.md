# ipc-guard

**Source**: `src\main\ipc\ipc-guard.js`

**Generated**: 2026-01-27T06:44:03.852Z

---

## const

```javascript
const
```

* IPC Handler 注册保护机制
 * 防止重复注册和提供统一的注册管理
 *
 * @module ipc-guard
 * @description 提供全局的IPC handler注册状态管理，防止重复注册导致的问题

---

## const registeredChannels = new Map();

```javascript
const registeredChannels = new Map();
```

* 全局注册状态跟踪
 * key: channel名称
 * value: { module: string, timestamp: number }

---

## const registeredModules = new Set();

```javascript
const registeredModules = new Set();
```

* 模块注册状态跟踪
 * key: 模块名称
 * value: boolean (是否已注册)

---

## function isChannelRegistered(channel)

```javascript
function isChannelRegistered(channel)
```

* 检查channel是否已注册
 * @param {string} channel - IPC channel名称
 * @returns {boolean} 是否已注册

---

## function isModuleRegistered(moduleName)

```javascript
function isModuleRegistered(moduleName)
```

* 检查模块是否已注册
 * @param {string} moduleName - 模块名称
 * @returns {boolean} 是否已注册

---

## function markChannelRegistered(channel, moduleName)

```javascript
function markChannelRegistered(channel, moduleName)
```

* 标记channel为已注册
 * @param {string} channel - IPC channel名称
 * @param {string} moduleName - 模块名称

---

## function markModuleRegistered(moduleName)

```javascript
function markModuleRegistered(moduleName)
```

* 标记模块为已注册
 * @param {string} moduleName - 模块名称

---

## function safeRegisterHandler(channel, handler, moduleName = 'unknown')

```javascript
function safeRegisterHandler(channel, handler, moduleName = 'unknown')
```

* 安全注册IPC handler（自动防重复）
 * @param {string} channel - IPC channel名称
 * @param {Function} handler - handler函数
 * @param {string} moduleName - 模块名称（用于日志）
 * @returns {boolean} 是否成功注册（false表示已存在，跳过注册）

---

## function safeRegisterHandlers(handlers, moduleName = 'unknown')

```javascript
function safeRegisterHandlers(handlers, moduleName = 'unknown')
```

* 批量注册IPC handlers（自动防重复）
 * @param {Object} handlers - handler映射对象 { channel: handlerFunction }
 * @param {string} moduleName - 模块名称
 * @returns {Object} { registered: number, skipped: number }

---

## function safeRegisterModule(moduleName, registerFunc)

```javascript
function safeRegisterModule(moduleName, registerFunc)
```

* 注册模块的所有handlers（模块级防重复）
 * @param {string} moduleName - 模块名称
 * @param {Function} registerFunc - 注册函数
 * @returns {boolean} 是否成功注册（false表示模块已注册）

---

## function unregisterChannel(channel)

```javascript
function unregisterChannel(channel)
```

* 移除channel的注册
 * @param {string} channel - IPC channel名称

---

## function unregisterModule(moduleName)

```javascript
function unregisterModule(moduleName)
```

* 移除模块的所有注册
 * @param {string} moduleName - 模块名称

---

## function resetAll()

```javascript
function resetAll()
```

* 重置所有注册状态（用于测试和热重载）

---

## function getStats()

```javascript
function getStats()
```

* 获取注册统计信息
 * @returns {Object} 统计信息

---

## function printStats()

```javascript
function printStats()
```

* 打印注册统计信息

---

