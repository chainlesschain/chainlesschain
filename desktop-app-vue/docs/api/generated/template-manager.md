# template-manager

**Source**: `src/main/template/template-manager.js`

**Generated**: 2026-02-15T08:42:37.176Z

---

## class ProjectTemplateManager

```javascript
class ProjectTemplateManager
```

* 项目模板管理器
 * 负责加载、管理和应用项目模板

---

## initializeTemplateEngine()

```javascript
initializeTemplateEngine()
```

* 初始化模板引擎

---

## registerHelpers()

```javascript
registerHelpers()
```

* 注册 Handlebars 辅助函数

---

## async initialize()

```javascript
async initialize()
```

* 初始化：加载所有内置模板到数据库

---

## async saveTemplate(templateData)

```javascript
async saveTemplate(templateData)
```

* 保存模板到数据库

---

## async getAllTemplates(filters =

```javascript
async getAllTemplates(filters =
```

* 获取所有模板

---

## async getTemplateById(templateId)

```javascript
async getTemplateById(templateId)
```

* 根据ID获取模板

---

## parseTemplateData(template)

```javascript
parseTemplateData(template)
```

* 解析模板数据（JSON字段转换）

---

## validateVariables(variablesSchema, userVariables =

```javascript
validateVariables(variablesSchema, userVariables =
```

* 验证模板变量

---

## renderPrompt(template, userVariables =

```javascript
renderPrompt(template, userVariables =
```

* 渲染模板提示词

---

## async recordTemplateUsage(templateId, userId, projectId, variablesUsed =

```javascript
async recordTemplateUsage(templateId, userId, projectId, variablesUsed =
```

* 记录模板使用

---

## async searchTemplates(keyword, filters =

```javascript
async searchTemplates(keyword, filters =
```

* 搜索模板

---

## async rateTemplate(templateId, userId, rating, review = "")

```javascript
async rateTemplate(templateId, userId, rating, review = "")
```

* 提交模板评价

---

## async getTemplateStats()

```javascript
async getTemplateStats()
```

* 获取模板统计信息

---

## async createTemplate(templateData)

```javascript
async createTemplate(templateData)
```

* 创建新模板

---

## async updateTemplate(templateId, updates)

```javascript
async updateTemplate(templateId, updates)
```

* 更新模板

---

## async deleteTemplate(templateId)

```javascript
async deleteTemplate(templateId)
```

* 删除模板（软删除）

---

## async getRecentTemplates(userId, limit = 10)

```javascript
async getRecentTemplates(userId, limit = 10)
```

* 获取用户最近使用的模板

---

## async getPopularTemplates(limit = 20)

```javascript
async getPopularTemplates(limit = 20)
```

* 获取热门模板

---

## async recommendTemplates(userInput, projectType, userId, options =

```javascript
async recommendTemplates(userInput, projectType, userId, options =
```

* 智能推荐模板
   * 基于用户输入、项目类型和历史使用情况推荐合适的模板

---

## extractKeywords(text)

```javascript
extractKeywords(text)
```

* 提取关键词

---

## calculateKeywordScore(template, keywords)

```javascript
calculateKeywordScore(template, keywords)
```

* 计算关键词匹配分数

---

