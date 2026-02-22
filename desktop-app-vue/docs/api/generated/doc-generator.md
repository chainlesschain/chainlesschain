# doc-generator

**Source**: `src/main/skill-tool-system/doc-generator.js`

**Generated**: 2026-02-22T01:23:36.677Z

---

## const

```javascript
const
```

* 文档生成器
 * 为技能和工具生成 Markdown 文档

---

## async initialize()

```javascript
async initialize()
```

* 初始化文档目录

---

## async generateSkillDoc(skill, tools = [])

```javascript
async generateSkillDoc(skill, tools = [])
```

* 生成技能文档
   * @param {Object} skill - 技能对象
   * @param {Array} tools - 技能包含的工具列表
   * @returns {Promise<string>} 文档路径

---

## async generateToolDoc(tool)

```javascript
async generateToolDoc(tool)
```

* 生成工具文档
   * @param {Object} tool - 工具对象
   * @returns {Promise<string>} 文档路径

---

## _buildSkillMarkdown(skill, tools)

```javascript
_buildSkillMarkdown(skill, tools)
```

* 构建技能 Markdown 文档
   * @private

---

## _buildToolMarkdown(tool)

```javascript
_buildToolMarkdown(tool)
```

* 构建工具 Markdown 文档
   * @private

---

## _getCategoryDisplayName(category)

```javascript
_getCategoryDisplayName(category)
```

* 获取分类显示名称
   * @private

---

## _getRiskLevelDisplay(level)

```javascript
_getRiskLevelDisplay(level)
```

* 获取风险等级显示
   * @private

---

## _getSkillUseCases(category)

```javascript
_getSkillUseCases(category)
```

* 获取技能使用场景
   * @private

---

## _getConfigDescription(category, key, value)

```javascript
_getConfigDescription(category, key, value)
```

* 获取配置说明
   * @private

---

## _getSkillExample(category, skillName)

```javascript
_getSkillExample(category, skillName)
```

* 获取技能示例
   * @private

---

## _getToolExample(toolName, schema)

```javascript
_getToolExample(toolName, schema)
```

* 获取工具示例
   * @private

---

## _getToolNotes(toolName, riskLevel)

```javascript
_getToolNotes(toolName, riskLevel)
```

* 获取工具注意事项
   * @private

---

## _getRelatedSkills(category)

```javascript
_getRelatedSkills(category)
```

* 获取相关技能
   * @private

---

## _normalizeDocContent(content)

```javascript
_normalizeDocContent(content)
```

* 规范化文档内容用于比较（忽略格式差异）
   * @private
   * @param {string} content - 文档内容
   * @returns {string} 规范化后的内容

---

## async _shouldUpdateDoc(filePath, newContent)

```javascript
async _shouldUpdateDoc(filePath, newContent)
```

* 比较文档内容是否需要更新（忽略格式差异）
   * @private
   * @param {string} filePath - 文件路径
   * @param {string} newContent - 新内容
   * @returns {Promise<boolean>} 是否需要更新

---

## async readSkillDoc(skillId)

```javascript
async readSkillDoc(skillId)
```

* 读取技能文档
   * @param {string} skillId - 技能ID
   * @returns {Promise<string>} 文档内容

---

## async readToolDoc(toolName)

```javascript
async readToolDoc(toolName)
```

* 读取工具文档
   * @param {string} toolName - 工具名称
   * @returns {Promise<string>} 文档内容

---

## async generateAllSkillDocs(skills)

```javascript
async generateAllSkillDocs(skills)
```

* 批量生成技能文档
   * @param {Array} skills - 技能列表（包含关联的工具）
   * @returns {Promise<number>} 生成的文档数量

---

## async generateAllToolDocs(tools)

```javascript
async generateAllToolDocs(tools)
```

* 批量生成工具文档
   * @param {Array} tools - 工具列表
   * @returns {Promise<number>} 生成的文档数量

---

