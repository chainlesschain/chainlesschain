# prompt-template-manager

**Source**: `src/main/prompt/prompt-template-manager.js`

**Generated**: 2026-02-16T13:44:34.627Z

---

## const

```javascript
const
```

* 提示词模板管理器
 *
 * 管理 AI 提示词模板，支持变量替换、分类管理、使用统计等功能

---

## class PromptTemplateManager

```javascript
class PromptTemplateManager
```

* 提示词模板管理器类

---

## async initialize()

```javascript
async initialize()
```

* 初始化
   * 创建数据库表并插入内置模板

---

## async createTable()

```javascript
async createTable()
```

* 创建数据库表

---

## async insertBuiltInTemplates()

```javascript
async insertBuiltInTemplates()
```

* 插入内置模板

---

## async createTemplate(templateData)

```javascript
async createTemplate(templateData)
```

* 创建模板
   * @param {Object} templateData - 模板数据
   * @returns {Promise<Object>} 创建的模板

---

## async getTemplates(filters =

```javascript
async getTemplates(filters =
```

* 获取模板列表
   * @param {Object} filters - 过滤条件
   * @returns {Promise<Array>} 模板列表

---

## async getTemplateById(id)

```javascript
async getTemplateById(id)
```

* 根据 ID 获取模板
   * @param {string} id - 模板 ID
   * @returns {Promise<Object|null>} 模板对象

---

## async updateTemplate(id, updates)

```javascript
async updateTemplate(id, updates)
```

* 更新模板
   * @param {string} id - 模板 ID
   * @param {Object} updates - 更新数据
   * @returns {Promise<Object>} 更新后的模板

---

## async deleteTemplate(id)

```javascript
async deleteTemplate(id)
```

* 删除模板
   * @param {string} id - 模板 ID
   * @returns {Promise<boolean>} 是否成功

---

## async fillTemplate(id, values)

```javascript
async fillTemplate(id, values)
```

* 填充模板变量
   * @param {string} id - 模板 ID
   * @param {Object} values - 变量值对象
   * @returns {Promise<string>} 填充后的提示词

---

## async incrementUsage(id)

```javascript
async incrementUsage(id)
```

* 增加使用次数
   * @param {string} id - 模板 ID

---

## async getCategories()

```javascript
async getCategories()
```

* 获取模板分类列表
   * @returns {Promise<Array>} 分类列表

---

## async searchTemplates(query)

```javascript
async searchTemplates(query)
```

* 搜索模板
   * @param {string} query - 搜索关键词
   * @returns {Promise<Array>} 匹配的模板列表

---

## async getStatistics()

```javascript
async getStatistics()
```

* 获取统计信息
   * @returns {Promise<Object>} 统计数据

---

## async exportTemplate(id)

```javascript
async exportTemplate(id)
```

* 导出模板
   * @param {string} id - 模板 ID
   * @returns {Promise<Object>} 导出数据

---

## async importTemplate(importData)

```javascript
async importTemplate(importData)
```

* 导入模板
   * @param {Object} importData - 导入数据
   * @returns {Promise<Object>} 导入的模板

---

