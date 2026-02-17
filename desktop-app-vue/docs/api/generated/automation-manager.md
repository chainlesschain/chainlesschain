# automation-manager

**Source**: `src/main/project/automation-manager.js`

**Generated**: 2026-02-17T10:13:18.209Z

---

## const

```javascript
const
```

* 项目自动化管理器
 * 提供定时任务、文件监听、事件触发等自动化功能

---

## async initialize()

```javascript
async initialize()
```

* 初始化自动化管理器

---

## async createTables()

```javascript
async createTables()
```

* 创建数据库表

---

## async loadProjectRules(projectId)

```javascript
async loadProjectRules(projectId)
```

* 加载项目的自动化规则
   * @param {string} projectId - 项目ID
   * @returns {Promise<Array>} 规则列表

---

## async createRule(ruleData)

```javascript
async createRule(ruleData)
```

* 创建自动化规则
   * @param {Object} ruleData - 规则数据
   * @returns {Promise<Object>} 创建的规则

---

## async registerRule(rule)

```javascript
async registerRule(rule)
```

* 注册自动化规则
   * @param {Object} rule - 规则对象

---

## async registerScheduledTask(ruleId, triggerConfig, actionType, actionConfig)

```javascript
async registerScheduledTask(ruleId, triggerConfig, actionType, actionConfig)
```

* 注册定时任务
   * @param {string} ruleId - 规则ID
   * @param {Object} triggerConfig - 触发配置
   * @param {string} actionType - 动作类型
   * @param {Object} actionConfig - 动作配置

---

## async registerFileWatcher(ruleId, triggerConfig, actionType, actionConfig)

```javascript
async registerFileWatcher(ruleId, triggerConfig, actionType, actionConfig)
```

* 注册文件监听
   * @param {string} ruleId - 规则ID
   * @param {Object} triggerConfig - 触发配置
   * @param {string} actionType - 动作类型
   * @param {Object} actionConfig - 动作配置

---

## async executeAction(actionType, actionConfig)

```javascript
async executeAction(actionType, actionConfig)
```

* 执行动作
   * @param {string} actionType - 动作类型
   * @param {Object} actionConfig - 动作配置

---

## async runTask(config)

```javascript
async runTask(config)
```

* 执行任务

---

## async generateReport(config)

```javascript
async generateReport(config)
```

* 生成报告

---

## async sendNotification(config)

```javascript
async sendNotification(config)
```

* 发送通知

---

## async gitCommit(config)

```javascript
async gitCommit(config)
```

* Git提交

---

## async exportFile(config)

```javascript
async exportFile(config)
```

* 导出文件

---

## async runScript(config)

```javascript
async runScript(config)
```

* 运行脚本

---

## async updateLastRun(ruleId)

```javascript
async updateLastRun(ruleId)
```

* 更新最后执行时间

---

## matchesCondition(data, condition)

```javascript
matchesCondition(data, condition)
```

* 条件匹配
   * @param {Object} data - 要匹配的数据
   * @param {Object} condition - 条件配置
   * @returns {boolean} 是否匹配

---

## calculateNextRun(ruleId)

```javascript
calculateNextRun(ruleId)
```

* 计算下次执行时间
   * @param {string} ruleId - 规则ID
   * @returns {number|null} 下次执行的时间戳（毫秒）

---

## getNextCronTime(cronExpression)

```javascript
getNextCronTime(cronExpression)
```

* 解析 cron 表达式并计算下次执行时间
   * 支持标准 5 字段 cron: 分 时 日 月 周
   * @param {string} cronExpression - cron 表达式
   * @returns {number} 下次执行的时间戳

---

## stopRule(ruleId)

```javascript
stopRule(ruleId)
```

* 停止规则
   * @param {string} ruleId - 规则ID

---

## async updateRule(ruleId, updates)

```javascript
async updateRule(ruleId, updates)
```

* 更新规则
   * @param {string} ruleId - 规则ID
   * @param {Object} updates - 更新数据

---

## async deleteRule(ruleId)

```javascript
async deleteRule(ruleId)
```

* 删除规则
   * @param {string} ruleId - 规则ID

---

## getRules(projectId)

```javascript
getRules(projectId)
```

* 获取规则列表
   * @param {string} projectId - 项目ID
   * @returns {Array} 规则列表

---

## getRule(ruleId)

```javascript
getRule(ruleId)
```

* 获取规则详情
   * @param {string} ruleId - 规则ID
   * @returns {Object} 规则详情

---

## async manualTrigger(ruleId)

```javascript
async manualTrigger(ruleId)
```

* 手动触发规则
   * @param {string} ruleId - 规则ID

---

## getStatistics()

```javascript
getStatistics()
```

* 获取统计信息

---

## function getAutomationManager()

```javascript
function getAutomationManager()
```

* 获取自动化管理器实例
 * @returns {AutomationManager}

---

