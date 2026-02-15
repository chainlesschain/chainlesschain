# skill-registry

**Source**: `src/main/ai-engine/cowork/skills/skill-registry.js`

**Generated**: 2026-02-15T07:37:13.876Z

---

## const

```javascript
const
```

* SkillRegistry - 技能注册表
 *
 * 管理所有可用的技能，提供技能注册、查找和执行功能。
 *
 * @module ai-engine/cowork/skills/skill-registry

---

## class SkillRegistry extends EventEmitter

```javascript
class SkillRegistry extends EventEmitter
```

* SkillRegistry 类

---

## register(skill)

```javascript
register(skill)
```

* 注册技能
   * @param {BaseSkill} skill - 技能实例

---

## registerMultiple(skills)

```javascript
registerMultiple(skills)
```

* 批量注册技能
   * @param {Array<BaseSkill>} skills - 技能数组

---

## unregister(skillId)

```javascript
unregister(skillId)
```

* 注销技能
   * @param {string} skillId - 技能 ID

---

## getSkill(skillId)

```javascript
getSkill(skillId)
```

* 获取技能
   * @param {string} skillId - 技能 ID
   * @returns {BaseSkill|undefined}

---

## findSkillsForTask(task, options =

```javascript
findSkillsForTask(task, options =
```

* 查找能处理任务的技能
   * @param {Object} task - 任务对象
   * @param {Object} options - 选项
   * @returns {Array<{skill: BaseSkill, score: number}>}

---

## selectBestSkill(task)

```javascript
selectBestSkill(task)
```

* 选择最佳技能
   * @param {Object} task - 任务对象
   * @returns {BaseSkill|null}

---

## getSkillsByCategory(category)

```javascript
getSkillsByCategory(category)
```

* 按分类获取技能
   * @param {string} category - 分类
   * @returns {Array<BaseSkill>}

---

## getSkillsByFileType(fileType)

```javascript
getSkillsByFileType(fileType)
```

* 按文件类型获取技能
   * @param {string} fileType - 文件类型
   * @returns {Array<BaseSkill>}

---

## getAllSkills()

```javascript
getAllSkills()
```

* 获取所有技能
   * @returns {Array<BaseSkill>}

---

## getEnabledSkills()

```javascript
getEnabledSkills()
```

* 获取已启用的技能
   * @returns {Array<BaseSkill>}

---

## async executeSkill(skillId, task, context =

```javascript
async executeSkill(skillId, task, context =
```

* 执行技能
   * @param {string} skillId - 技能 ID
   * @param {Object} task - 任务对象
   * @param {Object} context - 执行上下文
   * @returns {Promise<any>} 执行结果

---

## async autoExecute(task, context =

```javascript
async autoExecute(task, context =
```

* 自动执行任务（选择最佳技能）
   * @param {Object} task - 任务对象
   * @param {Object} context - 执行上下文
   * @returns {Promise<any>} 执行结果

---

## autoLoadBuiltinSkills()

```javascript
autoLoadBuiltinSkills()
```

* 自动加载内置技能

---

## _attachSkillEventListeners(skill)

```javascript
_attachSkillEventListeners(skill)
```

* 附加技能事件监听器
   * @private

---

## getStats()

```javascript
getStats()
```

* 获取统计信息
   * @returns {Object}

---

## getSkillList()

```javascript
getSkillList()
```

* 获取技能列表信息
   * @returns {Array}

---

## resetAllMetrics()

```javascript
resetAllMetrics()
```

* 重置所有技能指标

---

## _log(message, level = "info")

```javascript
_log(message, level = "info")
```

* 日志输出
   * @private

---

## async findBestSkill(task)

```javascript
async findBestSkill(task)
```

* 查找最佳技能（别名：selectBestSkill）
   * @param {object} task - 任务对象
   * @returns {Promise<object>} 匹配结果

---

## setLoader(loader)

```javascript
setLoader(loader)
```

* 设置技能加载器
   * @param {SkillLoader} loader - 技能加载器实例

---

## async loadAllSkills()

```javascript
async loadAllSkills()
```

* 从加载器加载所有技能（三层加载）
   * @returns {Promise<{loaded: number, registered: number, errors: Array}>}

---

## getSkillsBySource(source)

```javascript
getSkillsBySource(source)
```

* 按来源获取技能
   * @param {'bundled'|'managed'|'workspace'} source - 来源
   * @returns {Array<BaseSkill>}

---

## getUserInvocableSkills()

```javascript
getUserInvocableSkills()
```

* 获取用户可调用的技能
   * @returns {Array<BaseSkill>}

---

## getSkillDefinition(skillId)

```javascript
getSkillDefinition(skillId)
```

* 获取技能定义（原始 SKILL.md 数据）
   * @param {string} skillId - 技能 ID
   * @returns {object|null}

---

## async reloadAllSkills()

```javascript
async reloadAllSkills()
```

* 重新加载所有技能
   * @returns {Promise<object>}

---

## getSkillSources()

```javascript
getSkillSources()
```

* 获取三层目录信息
   * @returns {object|null}

---

## function getSkillRegistry(options =

```javascript
function getSkillRegistry(options =
```

* 获取技能注册表单例
 * @param {Object} options - 配置选项
 * @returns {SkillRegistry}

---

