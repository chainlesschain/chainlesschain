# stream-controller-manager

**Source**: `src/main/conversation/stream-controller-manager.js`

**Generated**: 2026-02-21T22:45:05.306Z

---

## const

```javascript
const
```

* StreamController 管理器
 * 负责管理所有活动的流式输出会话
 *
 * @module stream-controller-manager
 * @description 提供全局的StreamController管理，支持暂停、恢复、取消等操作

---

## class StreamControllerManager

```javascript
class StreamControllerManager
```

* StreamController 管理器类
 * 单例模式，全局管理所有流式会话

---

## this.controllers = new Map();

```javascript
this.controllers = new Map();
```

@type {Map<string, StreamController>} 存储所有活动的controller

---

## this.metadata = new Map();

```javascript
this.metadata = new Map();
```

@type {Map<string, Object>} 存储会话元数据

---

## create(conversationId, options =

```javascript
create(conversationId, options =
```

* 创建新的StreamController
   * @param {string} conversationId - 对话ID
   * @param {Object} options - 控制器选项
   * @returns {StreamController} 控制器实例

---

## get(conversationId)

```javascript
get(conversationId)
```

* 获取指定对话的controller
   * @param {string} conversationId - 对话ID
   * @returns {StreamController|null} 控制器实例或null

---

## has(conversationId)

```javascript
has(conversationId)
```

* 检查controller是否存在
   * @param {string} conversationId - 对话ID
   * @returns {boolean} 是否存在

---

## delete(conversationId)

```javascript
delete(conversationId)
```

* 删除controller
   * @param {string} conversationId - 对话ID
   * @returns {boolean} 是否成功删除

---

## pause(conversationId)

```javascript
pause(conversationId)
```

* 暂停流式输出
   * @param {string} conversationId - 对话ID
   * @returns {Object} 操作结果

---

## resume(conversationId)

```javascript
resume(conversationId)
```

* 恢复流式输出
   * @param {string} conversationId - 对话ID
   * @returns {Object} 操作结果

---

## cancel(conversationId, reason = "用户取消")

```javascript
cancel(conversationId, reason = "用户取消")
```

* 取消流式输出
   * @param {string} conversationId - 对话ID
   * @param {string} reason - 取消原因
   * @returns {Object} 操作结果

---

## getStats(conversationId)

```javascript
getStats(conversationId)
```

* 获取流式输出统计信息
   * @param {string} conversationId - 对话ID
   * @returns {Object} 统计信息或错误

---

## getAllActiveSessions()

```javascript
getAllActiveSessions()
```

* 获取所有活动会话
   * @returns {Array<Object>} 会话列表

---

## cleanup()

```javascript
cleanup()
```

* 清理所有已完成或已取消的会话
   * @returns {number} 清理的数量

---

## destroyAll()

```javascript
destroyAll()
```

* 销毁所有controller

---

## getManagerStats()

```javascript
getManagerStats()
```

* 获取管理器状态
   * @returns {Object} 管理器状态信息

---

## function getStreamControllerManager()

```javascript
function getStreamControllerManager()
```

* 获取StreamControllerManager单例
 * @returns {StreamControllerManager} 管理器实例

---

## function resetStreamControllerManager()

```javascript
function resetStreamControllerManager()
```

* 重置管理器（主要用于测试）

---

