# task

**Source**: `src\renderer\stores\task.js`

**Generated**: 2026-01-27T06:44:03.890Z

---

## export const useTaskStore = defineStore("task", () =>

```javascript
export const useTaskStore = defineStore("task", () =>
```

* 任务管理Store - Phase 1
 * 负责管理任务的CRUD操作、评论、变更历史和看板

---

## function safeParseJSON(value, defaultValue = null)

```javascript
function safeParseJSON(value, defaultValue = null)
```

* 安全解析 JSON 字符串
   * @param {string|any} value - 要解析的值
   * @param {any} defaultValue - 解析失败时的默认值
   * @returns {any} 解析后的值或默认值

---

## const tasksByStatus = computed(() =>

```javascript
const tasksByStatus = computed(() =>
```

* 按状态分组的任务

---

## const tasksByPriority = computed(() =>

```javascript
const tasksByPriority = computed(() =>
```

* 按优先级分组的任务

---

## const myTasks = computed(() =>

```javascript
const myTasks = computed(() =>
```

* 我的任务（已分配给当前用户）

---

## const inProgressTasks = computed(() =>

```javascript
const inProgressTasks = computed(() =>
```

* 进行中的任务

---

## const pendingTasks = computed(() =>

```javascript
const pendingTasks = computed(() =>
```

* 待处理的任务

---

## const completedTasks = computed(() =>

```javascript
const completedTasks = computed(() =>
```

* 已完成的任务

---

## const overdueTasks = computed(() =>

```javascript
const overdueTasks = computed(() =>
```

* 过期的任务

---

## const taskStats = computed(() =>

```javascript
const taskStats = computed(() =>
```

* 任务统计

---

## async function loadTasks(queryFilters =

```javascript
async function loadTasks(queryFilters =
```

* 加载任务列表
   * @param {object} queryFilters - 查询筛选条件

---

## async function createTask(taskData)

```javascript
async function createTask(taskData)
```

* 创建任务
   * @param {object} taskData - 任务数据

---

## async function updateTask(taskId, updates)

```javascript
async function updateTask(taskId, updates)
```

* 更新任务
   * @param {string} taskId - 任务ID
   * @param {object} updates - 更新数据

---

## async function deleteTask(taskId)

```javascript
async function deleteTask(taskId)
```

* 删除任务
   * @param {string} taskId - 任务ID

---

## async function loadTaskDetail(taskId)

```javascript
async function loadTaskDetail(taskId)
```

* 加载任务详情
   * @param {string} taskId - 任务ID

---

## async function assignTask(taskId, assignedTo)

```javascript
async function assignTask(taskId, assignedTo)
```

* 分配任务
   * @param {string} taskId - 任务ID
   * @param {string} assignedTo - 被分配人DID

---

## async function changeStatus(taskId, status)

```javascript
async function changeStatus(taskId, status)
```

* 变更任务状态
   * @param {string} taskId - 任务ID
   * @param {string} status - 新状态

---

## async function loadTaskComments(taskId)

```javascript
async function loadTaskComments(taskId)
```

* 加载任务评论
   * @param {string} taskId - 任务ID

---

## async function addComment(taskId, content, mentions = [])

```javascript
async function addComment(taskId, content, mentions = [])
```

* 添加任务评论
   * @param {string} taskId - 任务ID
   * @param {string} content - 评论内容
   * @param {Array} mentions - @提及的用户DID列表

---

## async function deleteComment(commentId)

```javascript
async function deleteComment(commentId)
```

* 删除任务评论
   * @param {string} commentId - 评论ID

---

## async function loadTaskChanges(taskId)

```javascript
async function loadTaskChanges(taskId)
```

* 加载任务变更历史
   * @param {string} taskId - 任务ID

---

## async function loadBoards(orgId, workspaceId = null)

```javascript
async function loadBoards(orgId, workspaceId = null)
```

* 加载任务看板列表
   * @param {string} orgId - 组织ID
   * @param {string} workspaceId - 工作区ID（可选）

---

## async function createBoard(orgId, boardData)

```javascript
async function createBoard(orgId, boardData)
```

* 创建任务看板
   * @param {string} orgId - 组织ID
   * @param {object} boardData - 看板数据

---

## function updateFilters(newFilters)

```javascript
function updateFilters(newFilters)
```

* 更新筛选条件
   * @param {object} newFilters - 新的筛选条件

---

## function clearFilters()

```javascript
function clearFilters()
```

* 清除筛选条件

---

## async function openTaskDetail(taskId)

```javascript
async function openTaskDetail(taskId)
```

* 打开任务详情
   * @param {string} taskId - 任务ID

---

## function closeTaskDetail()

```javascript
function closeTaskDetail()
```

* 关闭任务详情

---

## function reset()

```javascript
function reset()
```

* 重置Store

---

