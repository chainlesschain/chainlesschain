# command-router

**Source**: `src/main/remote/command-router.js`

**Generated**: 2026-02-15T10:10:53.379Z

---

## const

```javascript
const
```

* 命令路由器 - 将命令分发到对应的处理器
 *
 * 功能：
 * - 命令路由分发
 * - 处理器注册管理
 * - 错误处理和响应封装
 * - 命令执行统计
 *
 * @module remote/command-router

---

## const ERROR_CODES =

```javascript
const ERROR_CODES =
```

* 错误码

---

## class CommandRouter

```javascript
class CommandRouter
```

* 命令路由器类

---

## registerHandler(namespace, handler)

```javascript
registerHandler(namespace, handler)
```

* 注册命令处理器
   * @param {string} namespace - 命名空间（如 'ai', 'system', 'file'）
   * @param {Object} handler - 处理器实例（必须实现 handle 方法）

---

## unregisterHandler(namespace)

```javascript
unregisterHandler(namespace)
```

* 取消注册处理器

---

## async route(request, context =

```javascript
async route(request, context =
```

* 路由命令到对应的处理器
   * @param {Object} request - JSON-RPC 请求对象
   * @param {Object} context - 上下文信息（peerId, did, channel 等）
   * @returns {Promise<Object>} JSON-RPC 响应对象

---

## parseMethod(method)

```javascript
parseMethod(method)
```

* 解析方法名（namespace.action）

---

## createSuccessResponse(id, result)

```javascript
createSuccessResponse(id, result)
```

* 创建成功响应

---

## createErrorResponse(id, code, message, data = null)

```javascript
createErrorResponse(id, code, message, data = null)
```

* 创建错误响应

---

## getRegisteredHandlers()

```javascript
getRegisteredHandlers()
```

* 获取已注册的处理器列表

---

## hasHandler(namespace)

```javascript
hasHandler(namespace)
```

* 检查处理器是否已注册

---

## getStats()

```javascript
getStats()
```

* 获取统计信息

---

## resetStats()

```javascript
resetStats()
```

* 重置统计信息

---

