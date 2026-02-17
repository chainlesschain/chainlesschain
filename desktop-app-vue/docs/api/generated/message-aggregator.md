# message-aggregator

**Source**: `src/main/utils/message-aggregator.js`

**Generated**: 2026-02-17T10:13:18.174Z

---

## const

```javascript
const
```

* 消息聚合器
 *
 * 功能：
 * 1. 批量推送IPC消息到前端，避免消息轰炸
 * 2. 按事件类型分组
 * 3. 可配置批量间隔（默认100ms）
 * 4. 自动清理和性能优化
 *
 * 优化效果：
 * - 减少50%前端渲染压力
 * - 避免大量任务时的卡顿（50个任务=150+条消息 → 批量发送）

---

## push(event, data)

```javascript
push(event, data)
```

* 推送消息到队列
   * @param {string} event - 事件名称
   * @param {any} data - 消息数据

---

## flush()

```javascript
flush()
```

* 刷新队列，批量发送消息

---

## flushNow()

```javascript
flushNow()
```

* 立即刷新（强制发送）

---

## setWindow(window)

```javascript
setWindow(window)
```

* 设置窗口实例（用于延迟初始化）
   * @param {BrowserWindow} window - 窗口实例

---

## getStats()

```javascript
getStats()
```

* 获取统计信息
   * @returns {Object} 统计数据

---

## resetStats()

```javascript
resetStats()
```

* 重置统计

---

## destroy()

```javascript
destroy()
```

* 销毁聚合器

---

## function getMessageAggregator(window = null)

```javascript
function getMessageAggregator(window = null)
```

* 获取全局消息聚合器
 * @param {BrowserWindow} window - 窗口实例（可选）
 * @returns {MessageAggregator}

---

## function destroyGlobalAggregator()

```javascript
function destroyGlobalAggregator()
```

* 销毁全局聚合器

---

