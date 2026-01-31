# task-manager

**Source**: `src\main\task\task-manager.js`

**Generated**: 2026-01-27T06:44:03.800Z

---

## class TaskManager

```javascript
class TaskManager
```

* 任务管理器 - 企业协作任务管理核心模块
 * Phase 1 - v0.17.0
 *
 * 功能:
 * - 任务CRUD
 * - 任务分配与协作
 * - 任务评论
 * - 任务变更历史
 * - 任务看板管理
 *
 * @class TaskManager

---

## constructor(db, organizationManager)

```javascript
constructor(db, organizationManager)
```

* @param {Object} db - 数据库实例
   * @param {Object} organizationManager - 组织管理器实例

---

## async createTask(taskData, creatorDID)

```javascript
async createTask(taskData, creatorDID)
```

* 创建任务
   * @param {Object} taskData - 任务数据
   * @param {string} taskData.project_id - 项目ID
   * @param {string} taskData.org_id - 组织ID（可选）
   * @param {string} taskData.workspace_id - 工作区ID（可选）
   * @param {string} taskData.title - 任务标题
   * @param {string} taskData.description - 任务描述
   * @param {string} taskData.status - 状态 (pending|in_progress|completed|cancelled)
   * @param {string} taskData.priority - 优先级 (low|medium|high|urgent)
   * @param {string} taskData.assigned_to - 指派给（DID）
   * @param {Array<string>} taskData.collaborators - 协作者列表
   * @param {Array<string>} taskData.labels - 标签列表
   * @param {number} taskData.due_date - 截止日期
   * @param {number} taskData.estimate_hours - 预估工时
   * @param {string} creatorDID - 创建者DID
   * @returns {Promise<Object>} 创建的任务信息

---

## async updateTask(taskId, updates, updaterDID)

```javascript
async updateTask(taskId, updates, updaterDID)
```

* 更新任务
   * @param {string} taskId - 任务ID
   * @param {Object} updates - 更新字段
   * @param {string} updaterDID - 更新者DID
   * @returns {Promise<Object>} 更新结果

---

## async deleteTask(taskId, deleterDID)

```javascript
async deleteTask(taskId, deleterDID)
```

* 删除任务
   * @param {string} taskId - 任务ID
   * @param {string} deleterDID - 删除者DID
   * @returns {Promise<Object>} 删除结果

---

## async getTasks(filters =

```javascript
async getTasks(filters =
```

* 获取任务列表
   * @param {Object} filters - 筛选条件
   * @param {string} filters.org_id - 组织ID
   * @param {string} filters.workspace_id - 工作区ID
   * @param {string} filters.project_id - 项目ID
   * @param {string} filters.status - 状态
   * @param {string} filters.assigned_to - 指派给
   * @param {number} filters.limit - 限制数量
   * @param {number} filters.offset - 偏移量
   * @returns {Promise<Array>} 任务列表

---

## async getTask(taskId)

```javascript
async getTask(taskId)
```

* 获取单个任务详情
   * @param {string} taskId - 任务ID
   * @returns {Promise<Object|null>} 任务信息

---

## async assignTask(taskId, assignedTo, assignerDID)

```javascript
async assignTask(taskId, assignedTo, assignerDID)
```

* 分配任务
   * @param {string} taskId - 任务ID
   * @param {string} assignedTo - 被指派人DID
   * @param {string} assignerDID - 指派人DID
   * @returns {Promise<Object>} 分配结果

---

## async changeStatus(taskId, newStatus, changerDID)

```javascript
async changeStatus(taskId, newStatus, changerDID)
```

* 变更任务状态
   * @param {string} taskId - 任务ID
   * @param {string} newStatus - 新状态
   * @param {string} changerDID - 更改者DID
   * @returns {Promise<Object>} 变更结果

---

## async addComment(taskId, commentData, authorDID)

```javascript
async addComment(taskId, commentData, authorDID)
```

* 添加任务评论
   * @param {string} taskId - 任务ID
   * @param {Object} commentData - 评论数据
   * @param {string} commentData.content - 评论内容
   * @param {Array<string>} commentData.mentions - 提到的成员
   * @param {Array<Object>} commentData.attachments - 附件
   * @param {string} authorDID - 作者DID
   * @returns {Promise<Object>} 评论信息

---

## async getComments(taskId)

```javascript
async getComments(taskId)
```

* 获取任务评论列表
   * @param {string} taskId - 任务ID
   * @returns {Promise<Array>} 评论列表

---

## async deleteComment(commentId, deleterDID)

```javascript
async deleteComment(commentId, deleterDID)
```

* 删除评论
   * @param {string} commentId - 评论ID
   * @param {string} deleterDID - 删除者DID
   * @returns {Promise<Object>} 删除结果

---

## async getChanges(taskId)

```javascript
async getChanges(taskId)
```

* 获取任务变更历史
   * @param {string} taskId - 任务ID
   * @returns {Promise<Array>} 变更历史

---

## async recordChange(taskId, changerDID, changeType, oldValue, newValue)

```javascript
async recordChange(taskId, changerDID, changeType, oldValue, newValue)
```

* 记录任务变更
   * @param {string} taskId - 任务ID
   * @param {string} changerDID - 更改者DID
   * @param {string} changeType - 变更类型
   * @param {string} oldValue - 旧值
   * @param {string} newValue - 新值
   * @returns {Promise<void>}

---

## async createBoard(orgId, boardData, creatorDID)

```javascript
async createBoard(orgId, boardData, creatorDID)
```

* 创建任务看板
   * @param {string} orgId - 组织ID
   * @param {Object} boardData - 看板数据
   * @param {string} boardData.name - 看板名称
   * @param {Array<Object>} boardData.columns - 列配置
   * @param {string} creatorDID - 创建者DID
   * @returns {Promise<Object>} 看板信息

---

## async getBoards(orgId, workspaceId = null)

```javascript
async getBoards(orgId, workspaceId = null)
```

* 获取看板列表
   * @param {string} orgId - 组织ID
   * @param {string} workspaceId - 工作区ID（可选）
   * @returns {Promise<Array>} 看板列表

---

