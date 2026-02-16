# task-planner-interactive

**Source**: `src/main/ai-engine/task-planner-interactive.js`

**Generated**: 2026-02-16T22:06:51.516Z

---

## const

```javascript
const
```

* 交互式任务规划器（Claude Plan模式）
 *
 * 核心功能：
 * 1. 生成任务计划后先让用户确认
 * 2. 集成模板库，推荐相关模板
 * 3. 集成技能系统，推荐可用工具
 * 4. 支持用户调整参数和需求
 * 5. 质量评估和迭代优化

---

## async startPlanSession(userRequest, projectContext =

```javascript
async startPlanSession(userRequest, projectContext =
```

* 开始Plan模式对话
   * @param {string} userRequest - 用户需求
   * @param {Object} projectContext - 项目上下文
   * @returns {Promise<Object>} Plan会话信息

---

## async generateTaskPlan(userRequest, projectContext)

```javascript
async generateTaskPlan(userRequest, projectContext)
```

* 生成任务计划

---

## async recommendTemplates(userRequest, projectContext, taskPlan)

```javascript
async recommendTemplates(userRequest, projectContext, taskPlan)
```

* 推荐相关模板

---

## async recommendSkills(userRequest, projectContext, taskPlan)

```javascript
async recommendSkills(userRequest, projectContext, taskPlan)
```

* 推荐技能

---

## async recommendTools(userRequest, projectContext, taskPlan)

```javascript
async recommendTools(userRequest, projectContext, taskPlan)
```

* 推荐工具

---

## calculateTemplateRelevance(template, userRequest, taskPlan)

```javascript
calculateTemplateRelevance(template, userRequest, taskPlan)
```

* 计算模板相关度

---

## formatPlanForUser(session)

```javascript
formatPlanForUser(session)
```

* 格式化Plan供用户查看

---

## extractAdjustableParameters(taskPlan)

```javascript
extractAdjustableParameters(taskPlan)
```

* 提取可调整参数

---

## async handleUserResponse(sessionId, userResponse)

```javascript
async handleUserResponse(sessionId, userResponse)
```

* 用户确认或调整Plan
   * @param {string} sessionId - 会话ID
   * @param {Object} userResponse - 用户响应
   * @returns {Promise<Object>} 处理结果

---

## async executeConfirmedPlan(sessionId)

```javascript
async executeConfirmedPlan(sessionId)
```

* 执行已确认的Plan

---

## async adjustPlan(sessionId, adjustments)

```javascript
async adjustPlan(sessionId, adjustments)
```

* 调整Plan参数

---

## async applyTemplate(sessionId, templateId)

```javascript
async applyTemplate(sessionId, templateId)
```

* 应用模板

---

## async generatePlanFromTemplate(template, userRequest, projectContext)

```javascript
async generatePlanFromTemplate(template, userRequest, projectContext)
```

* 从模板生成Plan

---

## extractVariablesFromRequest(request, templateVariables)

```javascript
extractVariablesFromRequest(request, templateVariables)
```

* 从用户请求中提取变量值

---

## replaceVariables(text, variables)

```javascript
replaceVariables(text, variables)
```

* 替换字符串中的变量占位符

---

## async regeneratePlan(sessionId, feedback)

```javascript
async regeneratePlan(sessionId, feedback)
```

* 重新生成Plan

---

## async evaluateQuality(session)

```javascript
async evaluateQuality(session)
```

* 评估生成质量

---

## parseEstimatedDuration(duration)

```javascript
parseEstimatedDuration(duration)
```

* 解析预估时长

---

## getGrade(percentage)

```javascript
getGrade(percentage)
```

* 获取等级

---

## async submitUserFeedback(sessionId, feedback)

```javascript
async submitUserFeedback(sessionId, feedback)
```

* 收集用户反馈
   * @param {string} sessionId - 会话ID
   * @param {Object} feedback - 用户反馈

---

## async saveFeedbackToDatabase(sessionId, feedback)

```javascript
async saveFeedbackToDatabase(sessionId, feedback)
```

* 保存反馈到数据库

---

## getSession(sessionId)

```javascript
getSession(sessionId)
```

* 获取会话信息

---

## cleanupExpiredSessions(maxAge = 24 * 60 * 60 * 1000)

```javascript
cleanupExpiredSessions(maxAge = 24 * 60 * 60 * 1000)
```

* 清理过期会话

---

