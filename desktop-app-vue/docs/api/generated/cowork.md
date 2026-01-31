# cowork

**Source**: `src\renderer\stores\cowork.js`

**Generated**: 2026-01-27T06:44:03.892Z

---

## import

```javascript
import
```

* Cowork Store - Pinia 状态管理
 * 管理多代理协作系统的团队、任务、技能、统计等状态
 *
 * @module cowork-store
 * @version 1.0.0
 * @since 2026-01-27

---

## filteredTeams: (state) =>

```javascript
filteredTeams: (state) =>
```

* 根据筛选条件过滤后的团队列表

---

## activeTeams: (state) =>

```javascript
activeTeams: (state) =>
```

* 活跃的团队列表

---

## pausedTeams: (state) =>

```javascript
pausedTeams: (state) =>
```

* 暂停的团队列表

---

## completedTeams: (state) =>

```javascript
completedTeams: (state) =>
```

* 已完成的团队列表

---

## hasSelectedTeams: (state) =>

```javascript
hasSelectedTeams: (state) =>
```

* 是否有选中的团队

---

## selectedTeamCount: (state) =>

```javascript
selectedTeamCount: (state) =>
```

* 选中的团队数量

---

## filteredTasks: (state) =>

```javascript
filteredTasks: (state) =>
```

* 根据筛选条件过滤后的任务列表

---

## runningTasks: (state) =>

```javascript
runningTasks: (state) =>
```

* 运行中的任务列表

---

## pendingTasks: (state) =>

```javascript
pendingTasks: (state) =>
```

* 待处理的任务列表

---

## completedTasks: (state) =>

```javascript
completedTasks: (state) =>
```

* 已完成的任务列表

---

## failedTasks: (state) =>

```javascript
failedTasks: (state) =>
```

* 失败的任务列表

---

## hasSelectedTasks: (state) =>

```javascript
hasSelectedTasks: (state) =>
```

* 是否有选中的任务

---

## selectedTaskCount: (state) =>

```javascript
selectedTaskCount: (state) =>
```

* 选中的任务数量

---

## skillsByType: (state) =>

```javascript
skillsByType: (state) =>
```

* 按类型分组的技能

---

## officeSkills: (state) =>

```javascript
officeSkills: (state) =>
```

* Office 类型的技能

---

## isLoading: (state) =>

```javascript
isLoading: (state) =>
```

* 是否正在加载任何内容

---

## isLoadingTeams: (state) =>

```javascript
isLoadingTeams: (state) =>
```

* 是否正在加载团队

---

## isLoadingTasks: (state) =>

```javascript
isLoadingTasks: (state) =>
```

* 是否正在加载任务

---

## async createTeam(teamName, config =

```javascript
async createTeam(teamName, config =
```

* 创建团队

---

## async loadTeams(options =

```javascript
async loadTeams(options =
```

* 加载团队列表

---

## async loadTeamDetail(teamId)

```javascript
async loadTeamDetail(teamId)
```

* 加载团队详情

---

## async updateTeamConfig(teamId, config)

```javascript
async updateTeamConfig(teamId, config)
```

* 更新团队配置

---

## async destroyTeam(teamId, reason = "")

```javascript
async destroyTeam(teamId, reason = "")
```

* 销毁团队

---

## async requestJoinTeam(teamId, agentId, agentInfo =

```javascript
async requestJoinTeam(teamId, agentId, agentInfo =
```

* 请求加入团队

---

## async listTeamMembers(teamId)

```javascript
async listTeamMembers(teamId)
```

* 列出团队成员

---

## async terminateAgent(teamId, agentId, reason = "")

```javascript
async terminateAgent(teamId, agentId, reason = "")
```

* 终止代理

---

## async assignTask(teamId, agentId, task)

```javascript
async assignTask(teamId, agentId, task)
```

* 分配任务

---

## async loadActiveTasks()

```javascript
async loadActiveTasks()
```

* 加载所有活跃任务

---

## async loadTaskDetail(taskId)

```javascript
async loadTaskDetail(taskId)
```

* 加载任务详情

---

## async pauseTask(taskId)

```javascript
async pauseTask(taskId)
```

* 暂停任务

---

## async resumeTask(taskId)

```javascript
async resumeTask(taskId)
```

* 恢复任务

---

## async cancelTask(taskId, reason = "")

```javascript
async cancelTask(taskId, reason = "")
```

* 取消任务

---

## async loadSkills()

```javascript
async loadSkills()
```

* 加载已注册技能列表

---

## async testSkillMatch(task)

```javascript
async testSkillMatch(task)
```

* 测试技能匹配

---

## async autoExecuteTask(task, context =

```javascript
async autoExecuteTask(task, context =
```

* 自动执行任务（使用最佳技能）

---

## async loadStats()

```javascript
async loadStats()
```

* 加载全局统计信息

---

## initEventListeners()

```javascript
initEventListeners()
```

* 初始化事件监听器

---

## cleanupEventListeners()

```javascript
cleanupEventListeners()
```

* 清理事件监听器

---

## toggleTeamSelection(teamId)

```javascript
toggleTeamSelection(teamId)
```

* 选择/取消选择团队

---

## clearTeamSelection()

```javascript
clearTeamSelection()
```

* 清空团队选择

---

## toggleTaskSelection(taskId)

```javascript
toggleTaskSelection(taskId)
```

* 选择/取消选择任务

---

## clearTaskSelection()

```javascript
clearTaskSelection()
```

* 清空任务选择

---

## setTeamFilters(filters)

```javascript
setTeamFilters(filters)
```

* 设置团队筛选条件

---

## clearTeamFilters()

```javascript
clearTeamFilters()
```

* 清空团队筛选条件

---

## setTaskFilters(filters)

```javascript
setTaskFilters(filters)
```

* 设置任务筛选条件

---

## clearTaskFilters()

```javascript
clearTaskFilters()
```

* 清空任务筛选条件

---

## reset()

```javascript
reset()
```

* 重置所有状态（用于登出或切换用户）

---

