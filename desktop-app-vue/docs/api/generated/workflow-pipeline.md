# workflow-pipeline

**Source**: `src/main/workflow/workflow-pipeline.js`

**Generated**: 2026-02-17T10:13:18.170Z

---

## const

```javascript
const
```

* 工作流管道核心
 *
 * 管理项目创建到交付的完整流程
 *
 * 功能:
 * - 6阶段流程执行
 * - 质量门禁检查
 * - 进度事件发送
 * - 暂停/恢复/取消
 * - 错误恢复
 *
 * v0.27.0: 新建文件

---

## class WorkflowPipeline extends EventEmitter

```javascript
class WorkflowPipeline extends EventEmitter
```

* 工作流管道类

---

## _initializeStages()

```javascript
_initializeStages()
```

* 初始化默认阶段
   * @private

---

## _setupStateMachineListeners()

```javascript
_setupStateMachineListeners()
```

* 设置状态机监听器
   * @private

---

## _setupQualityGateListeners()

```javascript
_setupQualityGateListeners()
```

* 设置质量门禁监听器
   * @private

---

## registerStageExecutor(stageId, executor)

```javascript
registerStageExecutor(stageId, executor)
```

* 注册阶段执行器
   * @param {string} stageId - 阶段ID
   * @param {Function} executor - 执行函数

---

## async execute(input, context =

```javascript
async execute(input, context =
```

* 执行工作流
   * @param {Object} input - 输入数据
   * @param {Object} context - 上下文
   * @returns {Object} 执行结果

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

## cancel(reason = '用户取消')

```javascript
cancel(reason = '用户取消')
```

* 取消工作流
   * @param {string} reason - 取消原因
   * @returns {boolean} 是否成功

---

## async retry()

```javascript
async retry()
```

* 重试失败的工作流
   * @returns {Object} 执行结果

---

## async _continueFromStage(startIndex)

```javascript
async _continueFromStage(startIndex)
```

* 从指定阶段继续执行
   * @private

---

## async _checkPause()

```javascript
async _checkPause()
```

* 检查暂停状态
   * @private

---

## overrideQualityGate(gateId, reason = '手动覆盖')

```javascript
overrideQualityGate(gateId, reason = '手动覆盖')
```

* 手动覆盖质量门禁
   * @param {string} gateId - 门禁ID
   * @param {string} reason - 原因
   * @returns {boolean} 是否成功

---

## getStatus()

```javascript
getStatus()
```

* 获取工作流状态
   * @returns {Object} 工作流状态

---

## getStages()

```javascript
getStages()
```

* 获取阶段列表
   * @returns {Array} 阶段信息列表

---

## getQualityGates()

```javascript
getQualityGates()
```

* 获取质量门禁状态
   * @returns {Object} 门禁状态映射

---

## getLogs(limit = 100)

```javascript
getLogs(limit = 100)
```

* 获取执行日志
   * @param {number} limit - 限制数量
   * @returns {Array} 日志列表

---

## _log(level, message)

```javascript
_log(level, message)
```

* 记录日志
   * @private

---

## _getWorkflowInfo()

```javascript
_getWorkflowInfo()
```

* 获取工作流信息
   * @private

---

## _calculateOverallProgress()

```javascript
_calculateOverallProgress()
```

* 计算整体进度
   * @private

---

## _emitProgress()

```javascript
_emitProgress()
```

* 发送进度事件
   * @private

---

## toJSON()

```javascript
toJSON()
```

* 序列化工作流
   * @returns {Object} 序列化对象

---

## class WorkflowManager extends EventEmitter

```javascript
class WorkflowManager extends EventEmitter
```

* 工作流管理器
 * 管理多个工作流实例

---

## setMainWindow(window)

```javascript
setMainWindow(window)
```

* 设置主窗口
   * @param {BrowserWindow} window - Electron 主窗口

---

## createWorkflow(options =

```javascript
createWorkflow(options =
```

* 创建工作流
   * @param {Object} options - 工作流选项
   * @returns {WorkflowPipeline} 工作流实例

---

## getWorkflow(workflowId)

```javascript
getWorkflow(workflowId)
```

* 获取工作流
   * @param {string} workflowId - 工作流ID
   * @returns {WorkflowPipeline|null} 工作流实例

---

## getAllWorkflows()

```javascript
getAllWorkflows()
```

* 获取所有工作流
   * @returns {Array} 工作流列表

---

## deleteWorkflow(workflowId)

```javascript
deleteWorkflow(workflowId)
```

* 删除工作流
   * @param {string} workflowId - 工作流ID
   * @returns {boolean} 是否成功

---

## _forwardWorkflowEvents(workflow)

```javascript
_forwardWorkflowEvents(workflow)
```

* 转发工作流事件
   * @private

---

