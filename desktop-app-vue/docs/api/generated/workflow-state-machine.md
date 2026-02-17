# workflow-state-machine

**Source**: `src/main/workflow/workflow-state-machine.js`

**Generated**: 2026-02-17T10:13:18.170Z

---

## const

```javascript
const
```

* 工作流状态机
 *
 * 管理工作流的状态转换和生命周期
 *
 * 状态流转:
 * idle -> running -> (paused -> running) -> completed/failed/cancelled
 *
 * v0.27.0: 新建文件

---

## const WorkflowState =

```javascript
const WorkflowState =
```

* 工作流状态枚举

---

## const STATE_TRANSITIONS =

```javascript
const STATE_TRANSITIONS =
```

* 状态转换配置

---

## class WorkflowStateMachine extends EventEmitter

```javascript
class WorkflowStateMachine extends EventEmitter
```

* 工作流状态机类

---

## getState()

```javascript
getState()
```

* 获取当前状态
   * @returns {string} 当前状态

---

## canTransitionTo(targetState)

```javascript
canTransitionTo(targetState)
```

* 检查是否可以转换到目标状态
   * @param {string} targetState - 目标状态
   * @returns {boolean} 是否可转换

---

## transitionTo(targetState, reason = '')

```javascript
transitionTo(targetState, reason = '')
```

* 转换状态
   * @param {string} targetState - 目标状态
   * @param {string} reason - 转换原因
   * @returns {boolean} 是否成功

---

## start()

```javascript
start()
```

* 启动工作流
   * @returns {boolean} 是否成功

---

## pause()

```javascript
pause()
```

* 暂停工作流
   * @returns {boolean} 是否成功

---

## resume()

```javascript
resume()
```

* 恢复工作流
   * @returns {boolean} 是否成功

---

## complete()

```javascript
complete()
```

* 完成工作流
   * @returns {boolean} 是否成功

---

## fail(error = '')

```javascript
fail(error = '')
```

* 标记工作流失败
   * @param {string} error - 错误信息
   * @returns {boolean} 是否成功

---

## cancel(reason = 'user cancelled')

```javascript
cancel(reason = 'user cancelled')
```

* 取消工作流
   * @param {string} reason - 取消原因
   * @returns {boolean} 是否成功

---

## retry()

```javascript
retry()
```

* 重试工作流（从失败状态）
   * @returns {boolean} 是否成功

---

## isTerminal()

```javascript
isTerminal()
```

* 检查是否为终态
   * @returns {boolean} 是否为终态

---

## isRunning()

```javascript
isRunning()
```

* 检查是否正在运行
   * @returns {boolean} 是否运行中

---

## isPaused()

```javascript
isPaused()
```

* 检查是否已暂停
   * @returns {boolean} 是否已暂停

---

## setMetadata(key, value)

```javascript
setMetadata(key, value)
```

* 设置元数据
   * @param {string} key - 键
   * @param {any} value - 值

---

## getMetadata(key)

```javascript
getMetadata(key)
```

* 获取元数据
   * @param {string} key - 键
   * @returns {any} 值

---

## getHistory()

```javascript
getHistory()
```

* 获取状态历史
   * @returns {Array} 状态历史

---

## _recordStateChange(from, to, reason)

```javascript
_recordStateChange(from, to, reason)
```

* 记录状态变更
   * @private

---

## toJSON()

```javascript
toJSON()
```

* 序列化状态机
   * @returns {Object} 序列化对象

---

## static fromJSON(data)

```javascript
static fromJSON(data)
```

* 从序列化对象恢复
   * @param {Object} data - 序列化对象
   * @returns {WorkflowStateMachine} 状态机实例

---

