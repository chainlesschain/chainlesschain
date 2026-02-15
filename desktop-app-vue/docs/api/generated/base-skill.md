# base-skill

**Source**: `src/main/ai-engine/cowork/skills/base-skill.js`

**Generated**: 2026-02-15T10:10:53.463Z

---

## const

```javascript
const
```

* BaseSkill - 技能基类
 *
 * 所有专业化技能的基类，定义标准接口和通用功能。
 *
 * @module ai-engine/cowork/skills/base-skill

---

## class BaseSkill extends EventEmitter

```javascript
class BaseSkill extends EventEmitter
```

* BaseSkill 抽象类

---

## canHandle(task)

```javascript
canHandle(task)
```

* 检查是否可以处理任务
   * @param {Object} task - 任务对象
   * @returns {number} 匹配分数 (0-100)

---

## async execute(task, context =

```javascript
async execute(task, context =
```

* 执行技能（子类必须实现）
   * @param {Object} task - 任务对象
   * @param {Object} context - 执行上下文
   * @returns {Promise<any>} 执行结果

---

## async executeWithMetrics(task, context =

```javascript
async executeWithMetrics(task, context =
```

* 执行技能（带性能跟踪）
   * @param {Object} task - 任务对象
   * @param {Object} context - 执行上下文
   * @returns {Promise<any>} 执行结果

---

## validateInput(input, schema)

```javascript
validateInput(input, schema)
```

* 验证输入
   * @param {Object} input - 输入数据
   * @param {Object} schema - 验证模式
   * @returns {Object} { valid: boolean, errors?: Array }

---

## _extractKeywords(text)

```javascript
_extractKeywords(text)
```

* 提取关键词
   * @private

---

## _log(message, level = 'info')

```javascript
_log(message, level = 'info')
```

* 日志输出
   * @protected

---

## getInfo()

```javascript
getInfo()
```

* 获取技能信息
   * @returns {Object}

---

## setEnabled(enabled)

```javascript
setEnabled(enabled)
```

* 启用/禁用技能
   * @param {boolean} enabled

---

## resetMetrics()

```javascript
resetMetrics()
```

* 重置指标

---

