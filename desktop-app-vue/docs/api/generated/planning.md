# planning

**Source**: `src\renderer\stores\planning.js`

**Generated**: 2026-01-27T06:44:03.891Z

---

## export const usePlanningStore = defineStore('planning', () =>

```javascript
export const usePlanningStore = defineStore('planning', () =>
```

* 交互式任务规划Store
 * 实现类似Claude Plan模式的对话式任务规划

---

## const isPlanning = computed(() =>

```javascript
const isPlanning = computed(() =>
```

* 是否正在规划中

---

## const isAwaitingConfirmation = computed(() =>

```javascript
const isAwaitingConfirmation = computed(() =>
```

* 是否等待确认

---

## const isExecuting = computed(() =>

```javascript
const isExecuting = computed(() =>
```

* 是否正在执行

---

## const isCompleted = computed(() =>

```javascript
const isCompleted = computed(() =>
```

* 是否已完成

---

## const isFailed = computed(() =>

```javascript
const isFailed = computed(() =>
```

* 是否失败

---

## const progressPercentage = computed(() =>

```javascript
const progressPercentage = computed(() =>
```

* 执行进度百分比

---

## async function startPlanSession(userRequest, projectContext =

```javascript
async function startPlanSession(userRequest, projectContext =
```

* 开始Plan会话
   * @param {string} userRequest - 用户请求描述
   * @param {object} projectContext - 项目上下文（可选）

---

## async function respondToPlan(action, data =

```javascript
async function respondToPlan(action, data =
```

* 用户响应Plan（确认、调整、应用模板、重新生成、取消）
   * @param {string} action - 动作类型
   * @param {object} data - 动作相关数据

---

## async function submitFeedback(feedback)

```javascript
async function submitFeedback(feedback)
```

* 提交用户反馈
   * @param {object} feedback - 反馈数据

---

## async function getSession(sessionId)

```javascript
async function getSession(sessionId)
```

* 获取会话信息
   * @param {string} sessionId - 会话ID

---

## async function openPlanDialog(userRequest, projectContext =

```javascript
async function openPlanDialog(userRequest, projectContext =
```

* 打开Plan对话框
   * @param {string} userRequest - 用户请求
   * @param {object} projectContext - 项目上下文

---

## function closePlanDialog()

```javascript
function closePlanDialog()
```

* 关闭Plan对话框

---

## function reset()

```javascript
function reset()
```

* 重置Store

---

## if (window.ipc)

```javascript
if (window.ipc)
```

* 监听Plan生成事件

---

## window.ipc.on('interactive-planning:execution-started', (data) =>

```javascript
window.ipc.on('interactive-planning:execution-started', (data) =>
```

* 监听执行开始事件

---

## window.ipc.on('interactive-planning:execution-progress', (data) =>

```javascript
window.ipc.on('interactive-planning:execution-progress', (data) =>
```

* 监听执行进度事件

---

## window.ipc.on('interactive-planning:execution-completed', (data) =>

```javascript
window.ipc.on('interactive-planning:execution-completed', (data) =>
```

* 监听执行完成事件

---

## window.ipc.on('interactive-planning:execution-failed', (data) =>

```javascript
window.ipc.on('interactive-planning:execution-failed', (data) =>
```

* 监听执行失败事件

---

## window.ipc.on('interactive-planning:feedback-submitted', (data) =>

```javascript
window.ipc.on('interactive-planning:feedback-submitted', (data) =>
```

* 监听反馈提交事件

---

