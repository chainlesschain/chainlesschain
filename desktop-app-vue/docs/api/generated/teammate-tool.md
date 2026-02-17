# teammate-tool

**Source**: `src/main/ai-engine/cowork/teammate-tool.js`

**Generated**: 2026-02-17T10:13:18.286Z

---

## const

```javascript
const
```

* TeammateTool - Claude Cowork 风格的多代理协作工具
 *
 * 基于 Claude Code 的 TeammateTool 设计，实现 13 个核心操作：
 * 1. spawnTeam - 创建团队
 * 2. discoverTeams - 发现团队
 * 3. requestJoin - 请求加入团队
 * 4. assignTask - 分配任务
 * 5. broadcastMessage - 广播消息
 * 6. sendMessage - 发送消息
 * 7. voteOnDecision - 投票决策
 * 8. getTeamStatus - 获取团队状态
 * 9. terminateAgent - 终止代理
 * 10. mergeResults - 合并结果
 * 11. createCheckpoint - 创建检查点
 * 12. listMembers - 列出成员
 * 13. updateTeamConfig - 更新团队配置
 *
 * @module ai-engine/cowork/teammate-tool

---

## const TeamStatus =

```javascript
const TeamStatus =
```

* 团队状态

---

## const AgentStatus =

```javascript
const AgentStatus =
```

* 代理状态

---

## class TeammateTool extends EventEmitter

```javascript
class TeammateTool extends EventEmitter
```

* TeammateTool 类

---

## setDatabase(db)

```javascript
setDatabase(db)
```

* 设置数据库实例
   * @param {Object} db - 数据库实例

---

## async _ensureDataDir()

```javascript
async _ensureDataDir()
```

* 初始化存储目录
   * @private

---

## async spawnTeam(teamName, config =

```javascript
async spawnTeam(teamName, config =
```

* 1. spawnTeam - 创建团队
   * @param {string} teamName - 团队名称
   * @param {Object} config - 团队配置
   * @returns {Promise<Object>} 团队对象

---

## async discoverTeams(filters =

```javascript
async discoverTeams(filters =
```

* 2. discoverTeams - 发现团队
   * @param {Object} filters - 过滤条件
   * @returns {Promise<Array>} 团队列表

---

## async requestJoin(teamId, agentId, agentInfo =

```javascript
async requestJoin(teamId, agentId, agentInfo =
```

* 3. requestJoin - 请求加入团队
   * @param {string} teamId - 团队 ID
   * @param {string} agentId - 代理 ID
   * @param {Object} agentInfo - 代理信息
   * @returns {Promise<Object>} 加入结果

---

## async assignTask(teamId, agentIdOrTask, task)

```javascript
async assignTask(teamId, agentIdOrTask, task)
```

* 4. assignTask - 分配任务
   * @param {string} teamId - 团队 ID
   * @param {string} agentId - 代理 ID（可选，自动选择）
   * @param {Object} task - 任务对象
   * @returns {Promise<Object>} 分配结果

---

## async broadcastMessage(teamId, fromAgent, message)

```javascript
async broadcastMessage(teamId, fromAgent, message)
```

* 5. broadcastMessage - 广播消息
   * @param {string} teamId - 团队 ID
   * @param {string} fromAgent - 发送者代理 ID
   * @param {Object} message - 消息内容
   * @returns {Promise<Object>} 广播结果

---

## async sendMessage(fromAgent, toAgent, message)

```javascript
async sendMessage(fromAgent, toAgent, message)
```

* 6. sendMessage - 发送消息给特定代理
   * @param {string} fromAgent - 发送者代理 ID
   * @param {string} toAgent - 接收者代理 ID
   * @param {Object} message - 消息内容
   * @returns {Promise<Object>} 发送结果

---

## async voteOnDecision(teamId, decision, votes = [])

```javascript
async voteOnDecision(teamId, decision, votes = [])
```

* 7. voteOnDecision - 投票决策
   * @param {string} teamId - 团队 ID
   * @param {Object} decision - 决策对象
   * @param {Array} votes - 投票数组 [{agentId, vote}]
   * @returns {Promise<Object>} 投票结果

---

## async getTeamStatus(teamId)

```javascript
async getTeamStatus(teamId)
```

* 8. getTeamStatus - 获取团队状态
   * @param {string} teamId - 团队 ID
   * @returns {Promise<Object>} 团队状态

---

## async terminateAgent(agentId, reason = "")

```javascript
async terminateAgent(agentId, reason = "")
```

* 9. terminateAgent - 终止代理
   * @param {string} agentId - 代理 ID
   * @param {string} reason - 终止原因
   * @returns {Promise<Object>} 终止结果

---

## async mergeResults(teamId, results, strategy =

```javascript
async mergeResults(teamId, results, strategy =
```

* 10. mergeResults - 合并结果
   * @param {string} teamId - 团队 ID
   * @param {Array} results - 结果数组
   * @param {Object} strategy - 合并策略
   * @returns {Promise<Object>} 合并后的结果

---

## async createCheckpoint(teamId, metadata =

```javascript
async createCheckpoint(teamId, metadata =
```

* 11. createCheckpoint - 创建检查点
   * @param {string} teamId - 团队 ID
   * @param {Object} metadata - 元数据
   * @returns {Promise<Object>} 检查点信息

---

## async listMembers(teamId)

```javascript
async listMembers(teamId)
```

* 12. listMembers - 列出团队成员
   * @param {string} teamId - 团队 ID
   * @returns {Promise<Array>} 成员列表

---

## async updateTeamConfig(teamId, config)

```javascript
async updateTeamConfig(teamId, config)
```

* 13. updateTeamConfig - 更新团队配置
   * @param {string} teamId - 团队 ID
   * @param {Object} config - 新配置
   * @returns {Promise<Object>} 更新结果

---

## async pauseTeam(teamId)

```javascript
async pauseTeam(teamId)
```

* 14. pauseTeam - 暂停团队
   * @param {string} teamId - 团队 ID
   * @returns {Promise<Object>} 暂停结果

---

## async resumeTeam(teamId)

```javascript
async resumeTeam(teamId)
```

* 15. resumeTeam - 恢复团队
   * @param {string} teamId - 团队 ID
   * @returns {Promise<Object>} 恢复结果

---

## _selectAgentForTask(team, task)

```javascript
_selectAgentForTask(team, task)
```

* 选择代理来执行任务
   * @private

---

## async _saveTeamConfig(team)

```javascript
async _saveTeamConfig(team)
```

* 保存团队配置
   * @private

---

## _log(message, level = "info")

```javascript
_log(message, level = "info")
```

* 日志输出
   * @private

---

## getStats()

```javascript
getStats()
```

* 获取统计信息
   * @returns {Object}

---

## async cleanupOldMessages()

```javascript
async cleanupOldMessages()
```

* 清理过期消息

---

## async destroyTeam(teamId)

```javascript
async destroyTeam(teamId)
```

* 销毁团队
   * @param {string} teamId - 团队 ID

---

## async addAgent(teamId, agentInfo =

```javascript
async addAgent(teamId, agentInfo =
```

* 添加代理到团队（别名：requestJoin）
   * @param {string} teamId - 团队ID
   * @param {object} agentInfo - 代理信息
   * @returns {Promise<object>} 代理对象

---

## async listTeams(filters =

```javascript
async listTeams(filters =
```

* 列出所有团队（别名：discoverTeams）
   * @param {object} filters - 筛选条件
   * @returns {Promise<Array>} 团队列表

---

## async disbandTeam(teamId)

```javascript
async disbandTeam(teamId)
```

* 解散团队（别名：destroyTeam）
   * @param {string} teamId - 团队ID
   * @returns {Promise<object>} 结果

---

## async getTeam(teamId)

```javascript
async getTeam(teamId)
```

* 获取团队（别名：getTeamStatus）
   * @param {string} teamId - 团队ID
   * @returns {Promise<object>} 团队对象

---

## async getAgent(agentId)

```javascript
async getAgent(agentId)
```

* 获取代理信息
   * @param {string} agentId - 代理ID
   * @returns {Promise<object>} 代理对象

---

## async getTask(taskId)

```javascript
async getTask(taskId)
```

* 获取任务信息
   * @param {string} taskId - 任务ID
   * @returns {Promise<object>} 任务对象

---

## async updateTaskStatus(taskId, status, result =

```javascript
async updateTaskStatus(taskId, status, result =
```

* 更新任务状态
   * @param {string} taskId - 任务ID
   * @param {string} status - 新状态
   * @param {object} result - 结果数据
   * @returns {Promise<object>} 更新后的任务

---

## async getMetrics(teamId)

```javascript
async getMetrics(teamId)
```

* 获取团队指标（兼容测试API）
   * @param {string} teamId - 团队ID
   * @returns {Promise<object>} 指标数据

---

## async cleanup()

```javascript
async cleanup()
```

* 清理资源（销毁代理池等）

---

## getAgentPoolStatus()

```javascript
getAgentPoolStatus()
```

* 获取代理池状态（调试用）

---

