# skill-manager

**Source**: `src/main/skill-tool-system/skill-manager.js`

**Generated**: 2026-02-16T22:06:51.429Z

---

## const

```javascript
const
```

* 技能管理器 (SkillManager)
 * 负责技能的注册、管理、统计和与工具的关联

---

## async initialize()

```javascript
async initialize()
```

* 初始化技能管理器

---

## async registerSkill(skillData)

```javascript
async registerSkill(skillData)
```

* 注册技能
   * @param {Object} skillData - 技能元数据
   * @returns {Promise<string>} 技能ID

---

## async unregisterSkill(skillId)

```javascript
async unregisterSkill(skillId)
```

* 注销技能
   * @param {string} skillId - 技能ID

---

## async updateSkill(skillId, updates)

```javascript
async updateSkill(skillId, updates)
```

* 更新技能
   * @param {string} skillId - 技能ID
   * @param {Object} updates - 更新的字段

---

## async getSkill(skillId)

```javascript
async getSkill(skillId)
```

* 获取技能
   * @param {string} skillId - 技能ID
   * @returns {Promise<Object|null>} 技能对象

---

## async getAllSkills(options =

```javascript
async getAllSkills(options =
```

* 获取所有技能
   * @param {Object} options - 查询选项
   * @returns {Promise<Array>} 技能列表

---

## async getSkillsByCategory(category)

```javascript
async getSkillsByCategory(category)
```

* 根据分类获取技能
   * @param {string} category - 分类
   * @returns {Promise<Object>} 技能列表

---

## async getEnabledSkills()

```javascript
async getEnabledSkills()
```

* 获取启用的技能
   * @returns {Promise<Array>} 技能列表

---

## async enableSkill(skillId)

```javascript
async enableSkill(skillId)
```

* 启用技能
   * @param {string} skillId - 技能ID

---

## async disableSkill(skillId)

```javascript
async disableSkill(skillId)
```

* 禁用技能
   * @param {string} skillId - 技能ID

---

## async addToolToSkill(skillId, toolId, role = "primary", priority = 0)

```javascript
async addToolToSkill(skillId, toolId, role = "primary", priority = 0)
```

* 添加工具到技能
   * @param {string} skillId - 技能ID
   * @param {string} toolId - 工具ID
   * @param {string} role - 角色 (primary/secondary/optional)
   * @param {number} priority - 优先级

---

## async removeToolFromSkill(skillId, toolId)

```javascript
async removeToolFromSkill(skillId, toolId)
```

* 从技能中移除工具
   * @param {string} skillId - 技能ID
   * @param {string} toolId - 工具ID

---

## async getSkillTools(skillId)

```javascript
async getSkillTools(skillId)
```

* 获取技能包含的工具
   * @param {string} skillId - 技能ID
   * @returns {Promise<Array>} 工具列表

---

## async getSkillsByTool(toolId)

```javascript
async getSkillsByTool(toolId)
```

* 获取使用某个工具的技能列表
   * @param {string} toolId - 工具ID
   * @returns {Promise<Array>} 技能列表

---

## async recordSkillUsage(skillId, success, duration)

```javascript
async recordSkillUsage(skillId, success, duration)
```

* 记录技能使用情况
   * @param {string} skillId - 技能ID
   * @param {boolean} success - 是否成功
   * @param {number} duration - 执行时长(秒)

---

## async updateDailyStats(skillId, success, duration)

```javascript
async updateDailyStats(skillId, success, duration)
```

* 更新每日统计
   * @param {string} skillId - 技能ID
   * @param {boolean} success - 是否成功
   * @param {number} duration - 执行时长(秒)

---

## async getSkillStats(skillId = null, dateRange = null)

```javascript
async getSkillStats(skillId = null, dateRange = null)
```

* 获取技能统计
   * @param {string} skillId - 技能ID
   * @param {Object} dateRange - 日期范围 {start, end}
   * @returns {Promise<Array>} 统计数据

---

## async getSkillDocPath(skillId)

```javascript
async getSkillDocPath(skillId)
```

* 获取技能文档路径
   * @param {string} skillId - 技能ID
   * @returns {Promise<string|null>} 文档路径

---

## async getSuggestedSkills(intent)

```javascript
async getSuggestedSkills(intent)
```

* 根据意图推荐技能
   * @param {string} intent - 用户意图
   * @returns {Promise<Array>} 推荐的技能列表

---

## async loadBuiltInSkills()

```javascript
async loadBuiltInSkills()
```

* 加载内置技能

---

## async loadPluginSkills()

```javascript
async loadPluginSkills()
```

* 加载插件技能

---

## async generateAllDocs()

```javascript
async generateAllDocs()
```

* 生成所有技能的文档

---

## async getSkillDoc(skillId)

```javascript
async getSkillDoc(skillId)
```

* 获取技能文档
   * @param {string} skillId - 技能ID
   * @returns {Promise<string>} 文档内容（Markdown格式）

---

## async regenerateDoc(skillId)

```javascript
async regenerateDoc(skillId)
```

* 重新生成技能文档
   * @param {string} skillId - 技能ID

---

## async recordExecution(skillId, success, duration)

```javascript
async recordExecution(skillId, success, duration)
```

* recordExecution 方法（别名，用于兼容 SkillExecutor）
   * @param {string} skillId - 技能ID
   * @param {boolean} success - 是否成功
   * @param {number} duration - 执行时长(ms)

---

## async createSkill(skillData)

```javascript
async createSkill(skillData)
```

* createSkill 方法（别名，用于兼容测试）
   * @param {Object} skillData - 技能数据
   * @returns {Promise<Object>} 创建结果

---

## async deleteSkill(skillId)

```javascript
async deleteSkill(skillId)
```

* deleteSkill 方法（别名，用于兼容测试）
   * @param {string} skillId - 技能ID
   * @returns {Promise<Object>} 删除结果

---

## async toggleSkillEnabled(skillId, enabled)

```javascript
async toggleSkillEnabled(skillId, enabled)
```

* toggleSkillEnabled 方法（用于兼容测试）
   * @param {string} skillId - 技能ID
   * @param {boolean} enabled - 是否启用
   * @returns {Promise<Object>} 更新结果

---

## async getSkillById(skillId)

```javascript
async getSkillById(skillId)
```

* getSkillById 方法（别名，用于兼容测试）
   * @param {string} skillId - 技能ID
   * @returns {Promise<Object>} 查询结果

---

## async getSkillCount()

```javascript
async getSkillCount()
```

* getSkillCount 方法（用于兼容测试）
   * @returns {Promise<Object>} 技能数量

---

## async _getAllSkillsArray(options =

```javascript
async _getAllSkillsArray(options =
```

* _getAllSkillsArray 内部方法，返回技能数组
   * @param {Object} options - 查询选项
   * @returns {Promise<Array>} 技能列表

---

