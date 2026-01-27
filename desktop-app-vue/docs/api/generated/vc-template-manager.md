# vc-template-manager

**Source**: `src\main\vc\vc-template-manager.js`

**Generated**: 2026-01-27T06:44:03.788Z

---

## const

```javascript
const
```

* 可验证凭证模板管理器
 *
 * 提供预定义的凭证模板，简化凭证创建流程

---

## const BUILT_IN_TEMPLATES =

```javascript
const BUILT_IN_TEMPLATES =
```

* 内置模板

---

## class VCTemplateManager extends EventEmitter

```javascript
class VCTemplateManager extends EventEmitter
```

* VC 模板管理器类

---

## async initialize()

```javascript
async initialize()
```

* 初始化模板管理器

---

## async ensureTables()

```javascript
async ensureTables()
```

* 确保数据库表存在

---

## getAllTemplates(filters =

```javascript
getAllTemplates(filters =
```

* 获取所有模板（内置 + 用户自定义）
   * @param {Object} filters - 过滤条件
   * @returns {Array} 模板列表

---

## getTemplateById(id)

```javascript
getTemplateById(id)
```

* 根据 ID 获取模板
   * @param {string} id - 模板 ID
   * @returns {Object|null} 模板对象

---

## async createTemplate(templateData)

```javascript
async createTemplate(templateData)
```

* 创建自定义模板
   * @param {Object} templateData - 模板数据
   * @returns {Promise<Object>} 创建的模板

---

## async updateTemplate(id, updates)

```javascript
async updateTemplate(id, updates)
```

* 更新模板
   * @param {string} id - 模板 ID
   * @param {Object} updates - 更新内容
   * @returns {Promise<boolean>} 操作结果

---

## async deleteTemplate(id)

```javascript
async deleteTemplate(id)
```

* 删除模板
   * @param {string} id - 模板 ID
   * @returns {Promise<boolean>} 操作结果

---

## async incrementUsageCount(id)

```javascript
async incrementUsageCount(id)
```

* 增加模板使用次数
   * @param {string} id - 模板 ID

---

## fillTemplateValues(templateId, values)

```javascript
fillTemplateValues(templateId, values)
```

* 从模板填充凭证数据
   * @param {string} templateId - 模板 ID
   * @param {Object} values - 用户填写的值
   * @returns {Object} 凭证声明数据

---

## getStatistics()

```javascript
getStatistics()
```

* 获取模板统计信息
   * @returns {Object} 统计信息

---

## exportTemplate(id)

```javascript
exportTemplate(id)
```

* 导出模板为 JSON
   * @param {string} id - 模板 ID
   * @returns {Object} 模板 JSON 对象

---

## exportTemplates(ids)

```javascript
exportTemplates(ids)
```

* 批量导出模板
   * @param {Array<string>} ids - 模板 ID 数组
   * @returns {Object} 包含多个模板的 JSON 对象

---

## async importTemplate(importData, createdBy, options =

```javascript
async importTemplate(importData, createdBy, options =
```

* 导入模板
   * @param {Object} importData - 导入的 JSON 数据
   * @param {string} createdBy - 创建者 DID
   * @param {Object} options - 导入选项
   * @returns {Promise<Object>} 导入结果

---

## async _importSingleTemplate(templateData, createdBy, options =

```javascript
async _importSingleTemplate(templateData, createdBy, options =
```

* 导入单个模板（内部方法）
   * @param {Object} templateData - 模板数据
   * @param {string} createdBy - 创建者 DID
   * @param {Object} options - 导入选项
   * @returns {Promise<Object>} 创建的模板

---

## async close()

```javascript
async close()
```

* 关闭管理器

---

