# workflow

**Source**: `src\renderer\stores\workflow.js`

**Generated**: 2026-01-27T06:44:03.889Z

---

## import

```javascript
import
```

* 工作流状态管理 Store
 *
 * 管理工作流的创建、执行、监控等状态
 *
 * v0.27.0: 新建文件

---

## const runningWorkflows = computed(() =>

```javascript
const runningWorkflows = computed(() =>
```

* 获取运行中的工作流

---

## const completedWorkflows = computed(() =>

```javascript
const completedWorkflows = computed(() =>
```

* 获取已完成的工作流

---

## const failedWorkflows = computed(() =>

```javascript
const failedWorkflows = computed(() =>
```

* 获取失败的工作流

---

## const isCurrentRunning = computed(() =>

```javascript
const isCurrentRunning = computed(() =>
```

* 当前工作流是否正在运行

---

## const isCurrentPaused = computed(() =>

```javascript
const isCurrentPaused = computed(() =>
```

* 当前工作流是否已暂停

---

## const currentProgress = computed(() =>

```javascript
const currentProgress = computed(() =>
```

* 当前工作流进度

---

## async function loadWorkflows()

```javascript
async function loadWorkflows()
```

* 加载所有工作流

---

## async function createWorkflow(options)

```javascript
async function createWorkflow(options)
```

* 创建工作流
   * @param {Object} options - 工作流选项
   * @returns {Object|null} 创建结果

---

## async function createAndStartWorkflow(options)

```javascript
async function createAndStartWorkflow(options)
```

* 创建并启动工作流
   * @param {Object} options - 工作流选项
   * @returns {Object|null} 创建结果

---

## async function startWorkflow(workflowId, input, context =

```javascript
async function startWorkflow(workflowId, input, context =
```

* 启动工作流
   * @param {string} workflowId - 工作流ID
   * @param {Object} input - 输入数据
   * @param {Object} context - 上下文

---

## async function pauseWorkflow(workflowId)

```javascript
async function pauseWorkflow(workflowId)
```

* 暂停工作流
   * @param {string} workflowId - 工作流ID

---

## async function resumeWorkflow(workflowId)

```javascript
async function resumeWorkflow(workflowId)
```

* 恢复工作流
   * @param {string} workflowId - 工作流ID

---

## async function cancelWorkflow(workflowId, reason = '用户取消')

```javascript
async function cancelWorkflow(workflowId, reason = '用户取消')
```

* 取消工作流
   * @param {string} workflowId - 工作流ID
   * @param {string} reason - 取消原因

---

## async function retryWorkflow(workflowId)

```javascript
async function retryWorkflow(workflowId)
```

* 重试工作流
   * @param {string} workflowId - 工作流ID

---

## async function deleteWorkflow(workflowId)

```javascript
async function deleteWorkflow(workflowId)
```

* 删除工作流
   * @param {string} workflowId - 工作流ID

---

## async function selectWorkflow(workflowId)

```javascript
async function selectWorkflow(workflowId)
```

* 选择工作流
   * @param {string} workflowId - 工作流ID

---

## async function loadWorkflowDetail(workflowId)

```javascript
async function loadWorkflowDetail(workflowId)
```

* 加载工作流详情
   * @param {string} workflowId - 工作流ID

---

## async function overrideQualityGate(workflowId, gateId, reason = '手动覆盖')

```javascript
async function overrideQualityGate(workflowId, gateId, reason = '手动覆盖')
```

* 覆盖质量门禁
   * @param {string} workflowId - 工作流ID
   * @param {string} gateId - 门禁ID
   * @param {string} reason - 原因

---

## function handleWorkflowProgress(data)

```javascript
function handleWorkflowProgress(data)
```

* 处理工作流进度更新
   * @param {Object} data - 进度数据

---

## function initEventListeners()

```javascript
function initEventListeners()
```

* 初始化事件监听

---

## function cleanupEventListeners()

```javascript
function cleanupEventListeners()
```

* 清理事件监听

---

