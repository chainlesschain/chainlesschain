# workflow-stage

**Source**: `src/main/workflow/workflow-stage.js`

**Generated**: 2026-02-21T20:04:16.183Z

---

## const

```javascript
const
```

* 工作流阶段定义与执行
 *
 * 定义工作流的6个核心阶段:
 * 1. 需求分析 (Analysis)
 * 2. 方案设计 (Design)
 * 3. 内容生成 (Generation)
 * 4. 质量验证 (Validation)
 * 5. 集成优化 (Integration)
 * 6. 交付确认 (Delivery)
 *
 * v0.27.0: 新建文件

---

## const StageStatus =

```javascript
const StageStatus =
```

* 阶段状态枚举

---

## const DEFAULT_STAGES = [

```javascript
const DEFAULT_STAGES = [
```

* 预定义阶段配置

---

## class WorkflowStage extends EventEmitter

```javascript
class WorkflowStage extends EventEmitter
```

* 工作流阶段类

---

## async execute(input, context =

```javascript
async execute(input, context =
```

* 执行阶段
   * @param {Object} input - 输入数据
   * @param {Object} context - 上下文
   * @returns {Object} 执行结果

---

## async _executeDefaultSteps(input, context)

```javascript
async _executeDefaultSteps(input, context)
```

* 默认步骤执行
   * @private

---

## async _executeStep(step, input, context)

```javascript
async _executeStep(step, input, context)
```

* 执行单个步骤
   * @private

---

## async _simulateStepExecution(step, input, context)

```javascript
async _simulateStepExecution(step, input, context)
```

* 模拟步骤执行（默认实现）
   * @private

---

## updateStepProgress(stepId, progress, message = "")

```javascript
updateStepProgress(stepId, progress, message = "")
```

* 更新步骤进度
   * @param {string} stepId - 步骤ID
   * @param {number} progress - 进度 (0-100)
   * @param {string} message - 消息

---

## completeStep(stepId, result =

```javascript
completeStep(stepId, result =
```

* 标记步骤完成
   * @param {string} stepId - 步骤ID
   * @param {Object} result - 结果

---

## failStep(stepId, error)

```javascript
failStep(stepId, error)
```

* 标记步骤失败
   * @param {string} stepId - 步骤ID
   * @param {string} error - 错误信息

---

## _getStageInfo()

```javascript
_getStageInfo()
```

* 获取阶段信息
   * @private

---

## getStatus()

```javascript
getStatus()
```

* 获取当前状态
   * @returns {Object} 阶段状态

---

## reset()

```javascript
reset()
```

* 重置阶段

---

## skip(reason = "")

```javascript
skip(reason = "")
```

* 跳过阶段
   * @param {string} reason - 跳过原因

---

## class WorkflowStageFactory

```javascript
class WorkflowStageFactory
```

* 工作流阶段工厂

---

## static createDefaultStages(executors =

```javascript
static createDefaultStages(executors =
```

* 创建默认阶段集合
   * @param {Object} executors - 阶段执行器映射
   * @returns {Array<WorkflowStage>} 阶段实例数组

---

## static createStage(config)

```javascript
static createStage(config)
```

* 创建单个阶段
   * @param {Object} config - 阶段配置
   * @returns {WorkflowStage} 阶段实例

---

## static getDefaultStageConfigs()

```javascript
static getDefaultStageConfigs()
```

* 获取默认阶段配置
   * @returns {Array} 默认阶段配置

---

