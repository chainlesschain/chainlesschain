# stream-controller

**Source**: `src/main/llm/stream-controller.js`

**Generated**: 2026-02-16T13:44:34.652Z

---

## const

```javascript
const
```

* 流式输出控制器
 * 提供暂停、恢复、取消等流式输出控制功能
 *
 * @module stream-controller
 * @description 管理流式输出的生命周期，支持AbortController和自定义控制逻辑

---

## const StreamStatus =

```javascript
const StreamStatus =
```

* 流式输出状态

---

## class StreamController extends EventEmitter

```javascript
class StreamController extends EventEmitter
```

* 流式输出控制器类

---

## get signal()

```javascript
get signal()
```

* 获取AbortSignal

---

## start()

```javascript
start()
```

* 开始流式输出

---

## async processChunk(chunk)

```javascript
async processChunk(chunk)
```

* 处理chunk
   * @param {Object} chunk - chunk数据
   * @returns {Promise<boolean>} 是否继续处理

---

## pause()

```javascript
pause()
```

* 暂停流式输出

---

## resume()

```javascript
resume()
```

* 恢复流式输出

---

## waitForResume()

```javascript
waitForResume()
```

* 等待恢复
   * @returns {Promise<void>}

---

## cancel(reason = "用户取消")

```javascript
cancel(reason = "用户取消")
```

* 取消流式输出
   * @param {string} reason - 取消原因

---

## complete(result =

```javascript
complete(result =
```

* 完成流式输出
   * @param {Object} result - 最终结果

---

## error(error)

```javascript
error(error)
```

* 标记错误
   * @param {Error} error - 错误对象

---

## getStats()

```javascript
getStats()
```

* 获取统计信息
   * @returns {Object} 统计信息

---

## getBuffer()

```javascript
getBuffer()
```

* 获取缓冲的内容
   * @returns {Array} 缓冲的chunks

---

## clearBuffer()

```javascript
clearBuffer()
```

* 清空缓冲

---

## reset()

```javascript
reset()
```

* 重置控制器

---

## destroy()

```javascript
destroy()
```

* 销毁控制器

---

## function createStreamController(options =

```javascript
function createStreamController(options =
```

* 创建流式输出控制器
 * @param {Object} options - 配置选项
 * @returns {StreamController} 控制器实例

---

