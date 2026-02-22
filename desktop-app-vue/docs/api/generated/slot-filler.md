# slot-filler

**Source**: `src/main/ai-engine/slot-filler.js`

**Generated**: 2026-02-22T01:23:36.762Z

---

## class SlotFiller

```javascript
class SlotFiller
```

* 槽位填充器 (Slot Filler)
 * 负责识别缺失的必需参数，并通过上下文推断或用户询问来填充
 *
 * 核心功能:
 * 1. 定义每个意图的必需/可选槽位
 * 2. 从上下文智能推断缺失参数
 * 3. 与用户交互获取缺失信息
 * 4. 验证槽位完整性

---

## async fillSlots(intent, context =

```javascript
async fillSlots(intent, context =
```

* 填充槽位
   * @param {Object} intent - 意图识别结果
   * @param {Object} context - 上下文信息
   * @param {Function} askUserCallback - 询问用户的回调函数 (question, options) => Promise<answer>
   * @returns {Promise<Object>} 填充后的实体对象

---

## async inferFromContext(slots, context, currentEntities)

```javascript
async inferFromContext(slots, context, currentEntities)
```

* 从上下文推断槽位值
   * @private

---

## async askUser(slot, askUserCallback)

```javascript
async askUser(slot, askUserCallback)
```

* 询问用户填充槽位
   * @private

---

## async inferOptionalSlot(slot, intent, context, entities)

```javascript
async inferOptionalSlot(slot, intent, context, entities)
```

* 推断可选槽位（使用LLM）
   * @private

---

## validateSlots(intentType, entities)

```javascript
validateSlots(intentType, entities)
```

* 验证槽位完整性
   * @private

---

## extToFileType(ext)

```javascript
extToFileType(ext)
```

* 文件扩展名转文件类型
   * @private

---

## isDataFile(filePath)

```javascript
isDataFile(filePath)
```

* 判断是否为数据文件
   * @private

---

## async recordFillingHistory(userId, intentType, entities)

```javascript
async recordFillingHistory(userId, intentType, entities)
```

* 记录槽位填充历史（用于学习用户偏好）
   * @param {string} userId - 用户ID
   * @param {string} intentType - 意图类型
   * @param {Object} entities - 填充后的实体

---

## async learnUserPreference(userId, intentType, slot)

```javascript
async learnUserPreference(userId, intentType, slot)
```

* 从历史学习用户偏好
   * @param {string} userId - 用户ID
   * @param {string} intentType - 意图类型
   * @param {string} slot - 槽位名
   * @returns {Promise<string|null>} 用户常用的槽位值

---

## getSummary(result)

```javascript
getSummary(result)
```

* 生成槽位摘要（用于日志和调试）

---

